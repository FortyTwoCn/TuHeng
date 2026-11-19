import { Prisma } from '@prisma/client';
import { prisma } from '@tuheng/database';
import { AssetArchiveContext } from '@tuheng/contracts';
import { archiveScope, ensure } from '@tuheng/domain';
import { assetChecksum } from './assets';
import { copyObject, deleteObject, getObject } from './storage';

const pending = (now: Date): Prisma.AssetArchiveTaskWhereInput => ({
  OR: [
    { state: 'PENDING', nextAttemptAt: { lte: now } },
    { state: 'RUNNING', leaseUntil: { lte: now } },
  ],
});
export async function archivePendingAssets(limit = 16, assetId?: string) {
  const tasks = await prisma.assetArchiveTask.findMany({
    where: { ...pending(new Date()), ...(assetId ? { assetId } : {}) },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });
  for (const task of tasks) await archiveOne(task.id);
  return tasks.length;
}
async function archiveOne(id: string) {
  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const claimed = await prisma.assetArchiveTask.updateMany({
    where: { id, ...pending(now) },
    data: {
      state: 'RUNNING',
      attempts: { increment: 1 },
      leaseToken,
      leaseUntil: new Date(+now + 300_000),
    },
  });
  if (!claimed.count) return;
  const task = await prisma.assetArchiveTask.findUniqueOrThrow({
    where: { id },
    include: { asset: true },
  });
  try {
    const asset = task.asset;
    ensure(
      asset.state === 'ARCHIVING' &&
        asset.objectKey === task.sourceKey &&
        asset.checksum === task.sourceChecksum,
      'ARCHIVE_SOURCE_CHANGED',
      409,
    );
    const context = AssetArchiveContext.parse(asset.storageContext);
    await copyObject(task.sourceKey, task.targetKey);
    const result = await getObject(task.targetKey);
    ensure(
      result.length === asset.bytes && assetChecksum(result) === task.sourceChecksum,
      'ARCHIVE_TARGET_INVALID',
    );
    await prisma.$transaction(async (tx) => {
      const owned = await tx.assetArchiveTask.updateMany({
        where: { id, state: 'RUNNING', leaseToken },
        data: {
          state: 'COMPLETE',
          leaseToken: null,
          leaseUntil: null,
          errorCode: null,
          finishedAt: new Date(),
        },
      });
      if (!owned.count) return;
      const switched = await tx.storedAsset.updateMany({
        where: {
          id: task.assetId,
          objectKey: task.sourceKey,
          checksum: task.sourceChecksum,
          state: 'ARCHIVING',
        },
        data: { objectKey: task.targetKey, state: 'ARCHIVED', ...archiveScope(context) },
      });
      ensure(switched.count, 'ARCHIVE_SOURCE_CHANGED', 409);
      await tx.assetObjectGarbage.create({
        data: { objectKey: task.sourceKey, deleteAfter: new Date(Date.now() + 3_600_000) },
      });
    });
  } catch (error) {
    await prisma.assetArchiveTask.updateMany({
      where: { id, state: 'RUNNING', leaseToken },
      data: {
        state: 'PENDING',
        leaseToken: null,
        leaseUntil: null,
        nextAttemptAt: new Date(
          Date.now() + Math.min(3_600_000, 5000 * 2 ** Math.min(task.attempts, 10)),
        ),
        errorCode:
          error instanceof Error && /^ARCHIVE_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'ARCHIVE_STORAGE_FAILED',
      },
    });
  }
}

async function claimDiscard(id: string, now: Date) {
  return prisma.$transaction(
    async (tx) => {
      const asset = await tx.storedAsset.findUnique({
        where: { id },
        include: { uploadSession: true, archiveTask: true },
      });
      if (
        !asset ||
        asset.state === 'ARCHIVING' ||
        !asset.discardAfter ||
        asset.discardAfter > now ||
        asset.archiveTask ||
        (asset.uploadSession &&
          asset.uploadSession.expiresAt > now &&
          !asset.uploadSession.cancelledAt)
      )
        return null;
      if (asset.state === 'DELETING') return asset;
      const refs = await tx.$queryRaw<{ used: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM "SubmissionAsset" WHERE "assetId" = ${id}
        UNION ALL SELECT 1 FROM "Submission" WHERE ${id} = ANY("draftAssetIds")
        UNION ALL SELECT 1 FROM "QuestionVersion"
          WHERE ${id} = ANY("assetIds") OR reference->'assetIds' @> jsonb_build_array(${id}::text)
        UNION ALL SELECT 1 FROM "GradingRun" WHERE
          request->'question'->'assets' @> jsonb_build_array(jsonb_build_object('id', ${id}::text))
          OR request->'reference'->'assets' @> jsonb_build_array(jsonb_build_object('id', ${id}::text))
          OR request->'submissionAssets' @> jsonb_build_array(jsonb_build_object('id', ${id}::text))
        UNION ALL SELECT 1 FROM "GradingSuggestion" WHERE
          "processedAssets" @> jsonb_build_array(jsonb_build_object('processedId', ${id}::text))
          OR "processedAssets" @> jsonb_build_array(jsonb_build_object('originalId', ${id}::text))
        UNION ALL SELECT 1 FROM "GradeDecision"
          WHERE annotations @> jsonb_build_array(jsonb_build_object('assetId', ${id}::text))
        UNION ALL SELECT 1 FROM "StoredAsset" WHERE "parentId" = ${id}
        UNION ALL SELECT 1 FROM "User" WHERE "avatarAssetId" = ${id}
      ) used`;
      if (refs[0].used) return null;
      const claimed = await tx.storedAsset.updateMany({
        where: { id, state: asset.state, objectKey: asset.objectKey, discardAfter: { lte: now } },
        data: { state: 'DELETING' },
      });
      return claimed.count ? asset : null;
    },
    { isolationLevel: 'Serializable' },
  );
}
export async function cleanExpiredAssets(now = new Date(), limit = 32) {
  const candidates = await prisma.storedAsset.findMany({
    where: {
      state: { in: ['WRITING', 'STAGED', 'ARCHIVED', 'DELETING'] },
      discardAfter: { lte: now },
      children: { none: {} },
      currentAvatar: null,
      archiveTask: null,
    },
    orderBy: [{ discardAfter: 'asc' }, { id: 'asc' }],
    select: { id: true },
    take: limit,
  });
  for (const { id } of candidates) {
    const asset = await claimDiscard(id, now).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        return null;
      throw error;
    });
    if (!asset) continue;
    try {
      await deleteObject(asset.objectKey);
      await prisma.storedAsset.deleteMany({ where: { id, state: 'DELETING' } });
    } catch {
      await prisma.storedAsset.updateMany({
        where: { id, state: 'DELETING' },
        data: { discardAfter: new Date(Date.now() + 60_000) },
      });
    }
  }
  await prisma.assetUploadSession.deleteMany({
    where: { expiresAt: { lte: now }, assets: { none: {} } },
  });
  const garbage = await prisma.assetObjectGarbage.findMany({
    where: { deleteAfter: { lte: now } },
    orderBy: { deleteAfter: 'asc' },
    take: limit,
  });
  for (const row of garbage) {
    if (
      await prisma.storedAsset.findUnique({
        where: { objectKey: row.objectKey },
        select: { id: true },
      })
    )
      continue;
    try {
      await deleteObject(row.objectKey);
      await prisma.assetObjectGarbage.deleteMany({ where: { id: row.id } });
    } catch {
      await prisma.assetObjectGarbage.updateMany({
        where: { id: row.id },
        data: { attempts: { increment: 1 }, deleteAfter: new Date(Date.now() + 60_000) },
      });
    }
  }
}
