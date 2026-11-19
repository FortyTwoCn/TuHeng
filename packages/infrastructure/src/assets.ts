import { createHash } from 'node:crypto';
import { database, prisma } from '@tuheng/database';
import { inspectImage, preprocess } from '@tuheng/image-pipeline';
import { AnswerStorageContext, AssetArchiveContext, AssetUploadTarget } from '@tuheng/contracts';
import {
  archiveAssetKey,
  archiveScope,
  audit,
  bindUploadedAssets,
  canReadAsset,
  DomainError,
  ensure,
  stagingKey,
  uploadTargetSchool,
  type Actor,
  type DataPort,
  type Entities,
} from '@tuheng/domain';
import { putObject, getObject } from './storage';

export const assetChecksum = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const day = 24 * 3600_000;
type AssetMetadata = {
  mime: string;
  width: number | null;
  height: number | null;
  name: string;
};

export async function currentResourceActor(tx: DataPort, actor: Actor) {
  const account = await tx.get('user', actor.id);
  ensure(
    account?.active &&
      (actor.tokenVersion === undefined || actor.tokenVersion === account.tokenVersion),
    'SESSION_REVOKED',
    401,
  );
  const schoolId = account.schoolId ?? null;
  ensure(!schoolId || (await tx.get('school', schoolId))?.active, 'SCHOOL_DISABLED', 403);
  return { ...actor, schoolId };
}

async function writeStaged(
  actor: Actor,
  buffer: Buffer,
  metadata: AssetMetadata,
  targetInput: AssetUploadTarget,
  source?: { id: string; transform: unknown; archive?: AssetArchiveContext | null },
) {
  const id = crypto.randomUUID();
  const asset = await database.transaction(async (tx) => {
    const current = await currentResourceActor(tx, actor);
    const targetSchoolId = await uploadTargetSchool(tx, current, targetInput);
    const expiresAt = new Date(Date.now() + day);
    if (source) {
      const parent = await tx.get('storedAsset', source.id);
      ensure(
        parent?.ownerId === current.id &&
          ['STAGED', 'ARCHIVING', 'ARCHIVED'].includes(parent.state),
        'ASSET_UNAVAILABLE',
        409,
      );
      if (parent.state === 'STAGED') {
        const upload =
          parent.uploadSessionId && (await tx.get('assetUploadSession', parent.uploadSessionId));
        ensure(
          upload && !upload.cancelledAt && upload.expiresAt > new Date(),
          'UPLOAD_SESSION_EXPIRED',
          409,
        );
        // A child remains usable for its whole upload window.
        await tx.update('assetUploadSession', upload.id, { expiresAt });
        await tx.update('storedAsset', parent.id, { discardAfter: expiresAt });
      }
    }
    const session = await tx.create('assetUploadSession', {
      ownerId: current.id,
      schoolId: current.schoolId,
      targetSchoolId,
      target: targetInput,
      expiresAt,
    });
    return tx.create('storedAsset', {
      id,
      ...metadata,
      ownerId: current.id,
      purpose: targetInput.kind,
      storageSchoolId: current.schoolId,
      storageSubjectUserId: current.id,
      uploadSessionId: session.id,
      discardAfter: expiresAt,
      checksum: assetChecksum(buffer),
      bytes: buffer.length,
      state: 'WRITING',
      objectKey: stagingKey(current.schoolId, current.id, session.id, id, metadata.mime),
      ...(source ? { parentId: source.id, transform: source.transform } : {}),
    });
  });

  // Reservation precedes the write. Ambiguous failures leave a known key for the reaper.
  await putObject(asset.objectKey, buffer, metadata.mime);
  await database.transaction(async (tx) => {
    const current = await currentResourceActor(tx, actor);
    const pending = await tx.get('storedAsset', id);
    ensure(pending?.state === 'WRITING', 'ASSET_UNAVAILABLE', 409);
    await tx.update('storedAsset', id, { state: 'STAGED' });
    if (targetInput.kind === 'DOCUMENT') {
      const prior = source?.archive;
      await bindUploadedAssets(tx, current, [id], {
        kind: 'DOCUMENT',
        schoolId: current.schoolId,
        userId: current.id,
        documentId: prior?.kind === 'DOCUMENT' ? prior.documentId : id,
      });
    }
    await audit(tx, current, source ? 'ASSET_TRANSFORMED' : 'ASSET_UPLOADED', id, {
      mime: metadata.mime,
      bytes: buffer.length,
    });
  });
  return { id, name: asset.name, mime: asset.mime };
}

export async function uploadAsset(
  actor: Actor,
  input: { file: { name: string; bytes: Buffer }; target: AssetUploadTarget },
) {
  const { file } = input;
  const target = AssetUploadTarget.parse(input.target);
  ensure(
    file.bytes.length > 0 && file.bytes.length <= Number(process.env.UPLOAD_MAX_BYTES ?? 15728640),
    'UPLOAD_SIZE_LIMIT',
    413,
  );
  let info: Pick<AssetMetadata, 'mime' | 'width' | 'height'>;
  if (file.bytes.subarray(0, 5).toString() === '%PDF-') {
    ensure(['QUESTION', 'REFERENCE', 'DOCUMENT'].includes(target.kind), 'SUBMISSION_MUST_BE_IMAGE');
    info = { mime: 'application/pdf', width: null, height: null };
  } else {
    const { mime, width, height } = await inspectImage(file.bytes).catch(() => {
      throw new DomainError('INVALID_IMAGE_CONTENT');
    });
    info = { mime, width, height };
  }
  return writeStaged(
    actor,
    file.bytes,
    {
      ...info,
      name: file.name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 200) || '上传文件',
    },
    target,
  );
}

export async function cancelStagedAsset(actor: Actor, id: string) {
  return database.transaction(async (tx) => {
    const asset = await tx.get('storedAsset', id);
    ensure(asset?.ownerId === actor.id, 'ASSET_FORBIDDEN', 403);
    if (asset.state !== 'STAGED' || !asset.uploadSessionId) return;
    if ((await tx.list('storedAsset', { parentId: id }, { take: 1 })).length) return;
    const now = new Date();
    await tx.update('assetUploadSession', asset.uploadSessionId, {
      cancelledAt: now,
      expiresAt: now,
    });
    await tx.update('storedAsset', id, { discardAfter: now });
  });
}

export async function downloadAsset(actor: Actor, id: string) {
  const asset = await canReadAsset(database, actor, id);
  return { asset, buffer: await getObject(asset.objectKey) };
}

export async function transformAsset(
  actor: Actor,
  input: { id: string; options: Parameters<typeof preprocess>[1]; target: AssetUploadTarget },
) {
  const { id, options } = input;
  const asset = await canReadAsset(database, actor, id);
  ensure(
    asset.ownerId === actor.id && asset.uploadSessionId && asset.mime !== 'application/pdf',
    'ASSET_FORBIDDEN',
    403,
  );
  const session = await database.get('assetUploadSession', asset.uploadSessionId);
  ensure(session, 'ASSET_UNAVAILABLE', 409);
  const prior = asset.storageContext ? AssetArchiveContext.parse(asset.storageContext) : null;
  const target = AssetUploadTarget.parse(input.target);
  const school = await uploadTargetSchool(database, actor, target);
  ensure(school === session.targetSchoolId, 'ASSET_CONTEXT_MISMATCH', 403);
  if (!prior) {
    ensure(
      JSON.stringify(target) === JSON.stringify(AssetUploadTarget.parse(session.target)),
      'ASSET_CONTEXT_MISMATCH',
      403,
    );
  } else if (prior.kind === 'QUESTION') {
    ensure(
      (target.kind === 'QUESTION' || target.kind === 'REFERENCE') && target.questionId,
      'ASSET_CONTEXT_MISMATCH',
      403,
    );
    const versions = await database.questionVersionsUsingAsset(id);
    ensure(
      target.questionId === prior.questionId ||
        versions.some((v) => v.questionId === target.questionId),
      'ASSET_CONTEXT_MISMATCH',
      403,
    );
  } else if (prior.kind === 'DOCUMENT') {
    ensure(target.kind === 'DOCUMENT', 'ASSET_CONTEXT_MISMATCH', 403);
  } else {
    ensure(
      AnswerStorageContext.safeParse(prior).success &&
        ['ASSIGNMENT_ANSWER', 'SELFTEST_ANSWER', 'REVIEW_ANSWER'].includes(target.kind),
      'ASSET_CONTEXT_MISMATCH',
      403,
    );
  }
  const result = await preprocess(await getObject(asset.objectKey), options);
  return writeStaged(
    actor,
    result.buffer,
    {
      name: asset.name,
      mime: result.mime,
      width: result.width,
      height: result.height,
    },
    target,
    { id, transform: result.record, archive: prior },
  );
}

/** A grading attempt owns the placement; the original owner still controls access. */
export async function storeGradingImage(
  parent: Pick<Entities['storedAsset'], 'id' | 'ownerId' | 'name'>,
  context: Extract<AssetArchiveContext, { kind: 'GRADING_PROCESSED' }>,
  buffer: Buffer,
  record: unknown,
) {
  const id = crypto.randomUUID();
  const { width, height } = await inspectImage(buffer);
  const objectKey = archiveAssetKey(context, id, 'image/png', parent.id);
  await database.create('storedAsset', {
    id,
    ownerId: parent.ownerId,
    objectKey,
    name: `处理图-${parent.name}`,
    parentId: parent.id,
    purpose: 'GRADING_PROCESSED',
    mime: 'image/png',
    bytes: buffer.length,
    width,
    height,
    checksum: assetChecksum(buffer),
    storageContext: context,
    ...archiveScope(context),
    state: 'WRITING',
    discardAfter: new Date(Date.now() + day),
    transform: record,
  });
  await putObject(objectKey, buffer, 'image/png');
  const updated = await prisma.storedAsset.updateMany({
    where: { id, state: 'WRITING' },
    data: { state: 'ARCHIVED' },
  });
  ensure(updated.count, 'ASSET_UNAVAILABLE', 409);
  return id;
}
