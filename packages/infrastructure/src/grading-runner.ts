import { Prisma } from '@prisma/client';
import { prisma, database } from '@tuheng/database';
import { GradingRequest, type VisionProvider } from '@tuheng/contracts';
import { GeometryGradingEngine, GradingError } from '@tuheng/grading-core';
import { OpenAICompatibleVisionProvider, ProviderError } from '@tuheng/ai-providers';
import { SharpImagePipeline } from '@tuheng/image-pipeline';
import { putObject, getObject } from './storage';
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function executeGradingRun(
  runId: string,
  options: { provider?: VisionProvider; testMode?: boolean } = {},
) {
  if (options.provider && !(options.testMode && process.env.NODE_ENV === 'test'))
    throw new Error('TEST_PROVIDER_FORBIDDEN');
  const token = crypto.randomUUID();
  const now = new Date();
  const claimed = await prisma.gradingRun.updateMany({
    where: {
      id: runId,
      OR: [
        { status: { in: ['QUEUED', 'RETRYING'] } },
        { status: 'RUNNING', leaseUntil: { lt: now } },
      ],
    },
    data: {
      status: 'RUNNING',
      leaseToken: token,
      leaseUntil: new Date(Date.now() + 300000),
      startedAt: now,
    },
  });
  if (!claimed.count) return;
  const run = await prisma.gradingRun.findUniqueOrThrow({
    where: { id: runId },
    include: { config: true },
  });
  await prisma.backgroundJob.update({
    where: { runId },
    data: { status: 'RUNNING', attempts: { increment: 1 }, errorCode: null },
  });
  try {
    const apiKey = process.env[run.config.keyEnv] ?? '';
    if (!options.provider && (!apiKey || !run.config.model))
      throw new ProviderError('BLOCKED_CONFIG', false);
    const provider =
      options.provider ??
      new OpenAICompatibleVisionProvider({
        baseUrl: run.config.baseUrl,
        model: run.config.model,
        outputMode: run.config.outputMode === 'json_schema' ? 'json_schema' : 'json_object',
        timeoutMs: run.config.timeoutMs,
        apiKey,
      });
    const pipeline = new SharpImagePipeline(
      async (id) => {
        const asset = await prisma.storedAsset.findUniqueOrThrow({ where: { id } });
        return getObject(asset.objectKey);
      },
      async (parentId, buffer, record) => {
        const parent = await prisma.storedAsset.findUniqueOrThrow({ where: { id: parentId } });
        const objectKey = `private/${parent.ownerId}/processed/${runId}/${crypto.randomUUID()}`;
        await putObject(objectKey, buffer, 'image/png');
        const a = await prisma.storedAsset.create({
          data: {
            ownerId: parent.ownerId,
            objectKey,
            name: `处理图-${parent.name}`,
            mime: 'image/png',
            bytes: buffer.length,
            purpose: 'PROCESSED',
            parentId,
            transform: json(record),
          },
        });
        return a.id;
      },
    );
    const result = await new GeometryGradingEngine(provider, pipeline).grade(
      GradingRequest.parse(run.request),
    );
    await prisma.$transaction(async (tx) => {
      const owned = await tx.gradingRun.updateMany({
        where: { id: runId, status: 'RUNNING', leaseToken: token },
        data: {
          status: 'SUCCEEDED',
          leaseToken: null,
          leaseUntil: null,
          finishedAt: new Date(),
          errorCode: null,
        },
      });
      if (!owned.count) return;
      await tx.gradingSuggestion.create({
        data: {
          runId,
          result: json(result.result),
          rawResponse: json(result.raw),
          processedAssets: json(result.processedAssets),
        },
      });
      await tx.backgroundJob.update({ where: { runId }, data: { status: 'SUCCEEDED' } });
      const attempt = await tx.submissionAttempt.findUniqueOrThrow({
        where: { id: run.attemptId },
      });
      if (
        attempt.source !== 'ASSIGNMENT' &&
        result.result.totalPoints !== null &&
        result.result.totalPoints < result.result.maxPoints
      )
        await tx.errorBookEntry.upsert({
          where: { ownerId_attemptId: { ownerId: attempt.ownerId, attemptId: attempt.id } },
          create: {
            ownerId: attempt.ownerId,
            attemptId: attempt.id,
            questionVersionId: attempt.questionVersionId,
          },
          update: {},
        });
    });
  } catch (e) {
    const code =
      e instanceof ProviderError || e instanceof GradingError
        ? e.code
        : e instanceof Error && /^[A-Z_]+$/.test(e.message)
          ? e.message
          : 'GRADING_INVALID_OR_FAILED';
    const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { runId } });
    const retryable = e instanceof ProviderError && e.retryable && job.attempts < 3;
    const status = code === 'BLOCKED_CONFIG' ? 'BLOCKED_CONFIG' : retryable ? 'RETRYING' : 'FAILED';
    await prisma.$transaction(async (tx) => {
      const owned = await tx.gradingRun.updateMany({
        where: { id: runId, leaseToken: token },
        data: {
          status,
          errorCode: code,
          leaseUntil: null,
          leaseToken: null,
          finishedAt: retryable ? null : new Date(),
        },
      });
      if (owned.count)
        await tx.backgroundJob.update({ where: { runId }, data: { status, errorCode: code } });
    });
    if (retryable) throw e;
  }
}
export async function recoverExpiredRuns() {
  const expired = await prisma.gradingRun.findMany({
    where: { status: 'RUNNING', leaseUntil: { lt: new Date() } },
  });
  for (const run of expired)
    await database.transaction(async (tx) => {
      const fresh = await tx.get('gradingRun', run.id);
      if (fresh?.status !== 'RUNNING' || !fresh.leaseUntil || fresh.leaseUntil >= new Date())
        return;
      const job = (await tx.list('backgroundJob', { runId: run.id }))[0];
      await tx.update('gradingRun', run.id, {
        status: job.attempts >= 3 ? 'FAILED' : 'RETRYING',
        leaseUntil: null,
        leaseToken: null,
        errorCode: 'LEASE_EXPIRED',
      });
      await tx.update('backgroundJob', job.id, {
        status: job.attempts >= 3 ? 'FAILED' : 'QUEUED',
        errorCode: 'LEASE_EXPIRED',
      });
      if (job.attempts < 3) {
        const event = (await tx.list('outboxEvent', { runId: run.id }))[0];
        await tx.update('outboxEvent', event.id, { deliveredAt: null });
      }
    });
  return expired.length;
}
