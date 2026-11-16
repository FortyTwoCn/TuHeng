import { hash } from 'bcryptjs';
import { database, prisma } from '@tuheng/database';
import { GradingRequest, Role } from '@tuheng/contracts';
import { ensure, requireRole, audit, planAIInvocation, type Actor } from '@tuheng/domain';
import { dispatchOutbox } from './queue';
import { aiCenter, requireAIAdmin } from './ai-admin';
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
  requireAIAdmin(a);
  await database.transaction(async (tx) => {
    const run = await tx.get('gradingRun', id);
    ensure(run && ['FAILED', 'BLOCKED_CONFIG'].includes(run.status), 'RUN_NOT_RETRYABLE');
    const job = (await tx.list('backgroundJob', { runId: id }))[0];
    const invocation = (await tx.list('aIInvocation', { runId: id }))[0];
    ensure(invocation, 'LEGACY_RUN_REQUIRES_NEW_CONFIGURATION');
    if (!invocation.snapshot) {
      const request = GradingRequest.parse(run.request);
      const plan = await planAIInvocation(
        tx,
        invocation.taskKey === 'grading.assignment' ? 'grading.assignment' : 'grading.selftest',
        request,
      );
      ensure(plan.snapshot, plan.errorCode ?? 'AI_CONFIGURATION_REQUIRED');
      request.modelConfigId = plan.snapshot.bindingId;
      await tx.update('aIInvocation', invocation.id, {
        snapshot: plan.snapshot,
        status: 'QUEUED',
        errorCode: null,
      });
      await tx.update('gradingRun', id, { request });
    } else await tx.update('aIInvocation', invocation.id, { status: 'QUEUED', errorCode: null });
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
  return aiCenter(a);
}
export async function testModel(a: Actor) {
  requireAIAdmin(a);
  ensure(false, 'USE_AI_CENTER_EXPLICIT_TEST', 410);
}
export async function rerunCurrentConfig(a: Actor, id: string) {
  requireAIAdmin(a);
  return database.transaction(async (tx) => {
    const prior = await tx.get('gradingRun', id);
    ensure(
      prior && ['FAILED', 'BLOCKED_CONFIG', 'SUCCEEDED'].includes(prior.status),
      'RUN_NOT_TERMINAL',
    );
    const attempt = await tx.get('submissionAttempt', prior.attemptId);
    ensure(attempt, 'ATTEMPT_NOT_FOUND');
    const owner = await tx.get('user', attempt.ownerId);
    ensure(owner?.active, 'ACCOUNT_DISABLED');
    const taskKey = attempt.source === 'ASSIGNMENT' ? 'grading.assignment' : 'grading.selftest';
    const nextId = crypto.randomUUID(),
      request = GradingRequest.parse({
        ...GradingRequest.parse(prior.request),
        runId: nextId,
        modelConfigId: null,
      });
    const plan = await planAIInvocation(tx, taskKey, request);
    request.modelConfigId = plan.snapshot?.bindingId ?? null;
    const status = plan.snapshot ? 'QUEUED' : 'BLOCKED_CONFIG';
    const run = await tx.create('gradingRun', {
      id: nextId,
      attemptId: prior.attemptId,
      configId: null,
      status,
      strategyVersion: prior.strategyVersion,
      promptVersion: prior.promptVersion,
      request,
      errorCode: plan.errorCode,
    });
    await tx.create('aIInvocation', {
      runId: nextId,
      taskKey,
      actorId: owner.id,
      schoolId: owner.schoolId ?? null,
      resourceId: attempt.id,
      ...(plan.snapshot ? { snapshot: plan.snapshot } : {}),
      status,
      errorCode: plan.errorCode,
    });
    const job = (await tx.list('backgroundJob', { runId: id }))[0];
    await tx.create('backgroundJob', {
      runId: nextId,
      lane: job.lane,
      status,
      errorCode: plan.errorCode,
    });
    await tx.create('outboxEvent', { runId: nextId, lane: job.lane });
    await audit(tx, a, 'RUN_NEW_CONFIGURATION', nextId, {
      previousRunId: id,
      bindingId: plan.snapshot?.bindingId ?? null,
    });
    return run;
  });
}
