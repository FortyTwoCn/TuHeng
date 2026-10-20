import { hash } from 'bcryptjs';
import { database, prisma } from '@tuheng/database';
import { Role } from '@tuheng/contracts';
import { ensure, requireRole, audit, type Actor } from '@tuheng/domain';
import { dispatchOutbox } from './queue';
import { OpenAICompatibleVisionProvider } from '@tuheng/ai-providers';
export async function createUser(
  a: Actor,
  input: { email: string; name: string; password: string; roles: string[] },
) {
  requireRole(a, 'ADMIN');
  const roles = input.roles.map((r) => Role.parse(r));
  ensure(input.password.length >= 12, 'PASSWORD_TOO_SHORT');
  return database.transaction(async (tx) => {
    const user = await tx.create('user', {
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: await hash(input.password, 12),
      roles,
    });
    await audit(tx, a, 'USER_CREATED', user.id);
    return { id: user.id };
  });
}
export async function updateUser(
  a: Actor,
  id: string,
  input: { active?: boolean; roles?: string[]; password?: string },
) {
  requireRole(a, 'ADMIN');
  ensure(id !== a.id, 'SELF_MODIFICATION_FORBIDDEN');
  const roles = input.roles?.map((r) => Role.parse(r));
  if (input.password) ensure(input.password.length >= 12, 'PASSWORD_TOO_SHORT');
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: {
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(roles ? { roles } : {}),
        ...(input.password ? { passwordHash: await hash(input.password, 12) } : {}),
        tokenVersion: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: a.id,
        action: 'USER_UPDATED',
        resourceId: id,
        details: { active: input.active, roles, passwordReset: !!input.password },
      },
    });
    return { id: u.id };
  });
}
export async function retryRun(a: Actor, id: string) {
  requireRole(a, 'ADMIN', 'PLATFORM_OPERATOR');
  await database.transaction(async (tx) => {
    const run = await tx.get('gradingRun', id);
    ensure(run && ['FAILED', 'BLOCKED_CONFIG'].includes(run.status), 'RUN_NOT_RETRYABLE');
    const job = (await tx.list('backgroundJob', { runId: id }))[0];
    await tx.update('gradingRun', id, { status: 'QUEUED', errorCode: null });
    await tx.update('backgroundJob', job.id, { status: 'QUEUED', attempts: 0, errorCode: null });
    const event = (await tx.list('outboxEvent', { runId: id }))[0];
    await tx.update('outboxEvent', event.id, { deliveredAt: null });
    await audit(tx, a, 'RUN_RETRIED', id);
  });
  // A retained BullMQ terminal job must be removed before reuse of the deterministic id.
  const { queueFor } = await import('./queue');
  const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { runId: id } });
  const queue = queueFor(job.lane);
  try {
    const old = await queue.getJob(id);
    if (old && ['completed', 'failed'].includes(await old.getState())) await old.remove();
  } finally {
    await queue.close();
  }
  await dispatchOutbox();
  return { id };
}
export async function modelStatus(a: Actor) {
  requireRole(a, 'ADMIN', 'PLATFORM_OPERATOR');
  const config = await prisma.modelConfigurationVersion.findFirstOrThrow({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });
  const { keyEnv, ...safe } = config;
  return {
    ...safe,
    keyConfigured: !!process.env[keyEnv],
    usage: await prisma.gradingRun.groupBy({ by: ['status'], _count: true }),
  };
}
export async function testModel(a: Actor) {
  requireRole(a, 'ADMIN');
  const c = await prisma.modelConfigurationVersion.findFirstOrThrow({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });
  const provider = new OpenAICompatibleVisionProvider({
    baseUrl: c.baseUrl,
    model: c.model,
    outputMode: c.outputMode === 'json_schema' ? 'json_schema' : 'json_object',
    timeoutMs: c.timeoutMs,
    apiKey: process.env[c.keyEnv] ?? '',
  });
  const image =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFUAAAAASUVORK5CYII=';
  await provider.evaluate({
    system: 'Return JSON only.',
    user: 'This is a connectivity test. Return {"ok":true}.',
    images: [
      {
        role: 'QUESTION',
        assetId: 'connection-test',
        version: 'original',
        dataUrl: `data:image/png;base64,${image}`,
      },
    ],
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
  });
  await audit(database, a, 'MODEL_CONNECTION_TEST', c.id);
  return { ok: true };
}
export async function rerunCurrentConfig(a: Actor, id: string) {
  requireRole(a, 'ADMIN', 'PLATFORM_OPERATOR');
  return database.transaction(async (tx) => {
    const prior = await tx.get('gradingRun', id);
    ensure(
      prior && ['FAILED', 'BLOCKED_CONFIG', 'SUCCEEDED'].includes(prior.status),
      'RUN_NOT_TERMINAL',
    );
    const config = (
      await tx.list(
        'modelConfigurationVersion',
        { active: true },
        { orderBy: 'createdAt', desc: true, take: 1 },
      )
    )[0];
    ensure(config, 'MODEL_CONFIG_MISSING');
    const nextId = crypto.randomUUID();
    const request = {
      ...(prior.request as Record<string, unknown>),
      runId: nextId,
      modelConfigId: config.id,
    };
    const run = await tx.create('gradingRun', {
      id: nextId,
      attemptId: prior.attemptId,
      configId: config.id,
      status: 'QUEUED',
      strategyVersion: prior.strategyVersion,
      promptVersion: prior.promptVersion,
      request,
    });
    const job = (await tx.list('backgroundJob', { runId: id }))[0];
    await tx.create('backgroundJob', { runId: nextId, lane: job.lane });
    await tx.create('outboxEvent', { runId: nextId, lane: job.lane });
    await audit(tx, a, 'RUN_NEW_CONFIGURATION', nextId, { previousRunId: id, configId: config.id });
    return run;
  });
}
