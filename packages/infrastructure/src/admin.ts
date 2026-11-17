import { hash } from 'bcryptjs';
import { database, prisma } from '@tuheng/database';
import { AISnapshot, GradingRequest, Role } from '@tuheng/contracts';
import {
  ensure,
  requireRole,
  audit,
  planAIInvocation,
  gradingJobActions,
  type Actor,
} from '@tuheng/domain';
import { dispatchOutbox } from './queue';
import { aiCenter, requireAIAdmin } from './ai-admin';
import { jobSnapshotError } from './job-readiness';
import { readSecret } from './secret-store';
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
export async function retryRun(a: Actor, id: string, requestId?: string) {
  requireAIAdmin(a);
  const dispatch = await database.transaction(async (tx) => {
    if (requestId) {
      const receipt = await tx.get('auditLog', requestId);
      if (receipt) {
        ensure(
          receipt.actorId === a.id && receipt.action === 'RUN_RETRIED' && receipt.resourceId === id,
          'IDEMPOTENCY_CONFLICT',
          409,
        );
        return false;
      }
    }
    const run = await tx.get('gradingRun', id);
    ensure(run, 'RUN_NOT_FOUND', 404);
    const job = (await tx.list('backgroundJob', { runId: id }))[0];
    const invocation = (await tx.list('aIInvocation', { runId: id }))[0];
    const originalError = invocation
      ? await jobSnapshotError(tx, invocation.snapshot, invocation.actorId, invocation.schoolId)
      : 'AI_SNAPSHOT_REQUIRED';
    const action = gradingJobActions({
      status: run.status,
      originalError,
      currentError: null,
    }).retryOriginal;
    ensure(action.allowed, action.reason ?? 'RUN_NOT_RETRYABLE', 409);
    ensure(job && invocation, 'JOB_STATE_INVALID', 409);
    const snapshot = AISnapshot.parse(invocation.snapshot);
    // Readability is checked here without changing the immutable snapshot or returning the key.
    await readSecret(snapshot.secretId, 'AI_API_KEY');
    const event = (await tx.list('outboxEvent', { runId: id }))[0];
    ensure(event, 'JOB_STATE_INVALID', 409);
    await tx.update('aIInvocation', invocation.id, { status: 'QUEUED', errorCode: null });
    await tx.update('gradingRun', id, { status: 'QUEUED', errorCode: null });
    // Hold the run row lock and remove only a terminal queue entry before publishing
    // the pending outbox event. A dispatcher cannot reuse the stale retained entry.
    const { queueFor } = await import('./queue');
    const queue = queueFor(job.lane);
    try {
      const old = await queue.getJob(id);
      if (old) {
        const state = await old.getState();
        ensure(['completed', 'failed', 'unknown'].includes(state), 'RUN_QUEUE_NOT_TERMINAL', 409);
        if (state !== 'unknown') await old.remove();
      }
    } finally {
      await queue.close();
    }
    await tx.update('backgroundJob', job.id, { status: 'QUEUED', attempts: 0, errorCode: null });
    await tx.update('outboxEvent', event.id, { deliveredAt: null });
    await tx.create('auditLog', {
      ...(requestId ? { id: requestId } : {}),
      actorId: a.id,
      action: 'RUN_RETRIED',
      resourceId: id,
      details: {},
    });
    return true;
  });
  if (!dispatch) return { id };
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
export async function rerunCurrentConfig(a: Actor, id: string, requestId?: string) {
  requireAIAdmin(a);
  const nextId = requestId ?? crypto.randomUUID();
  return database.transaction(async (tx) => {
    const existing = await tx.get('gradingRun', nextId);
    if (existing) {
      const receipt = (
        await tx.list('auditLog', {
          action: 'RUN_NEW_CONFIGURATION',
          resourceId: nextId,
          actorId: a.id,
        })
      )[0];
      ensure(
        receipt && (receipt.details as { previousRunId?: string })?.previousRunId === id,
        'IDEMPOTENCY_CONFLICT',
        409,
      );
      return { id: existing.id, status: existing.status };
    }
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
    const request = GradingRequest.parse({
      ...GradingRequest.parse(prior.request),
      runId: nextId,
      modelConfigId: null,
    });
    const plan = await planAIInvocation(tx, taskKey, request);
    const currentError =
      plan.errorCode ??
      (plan.snapshot
        ? await jobSnapshotError(tx, plan.snapshot, owner.id, owner.schoolId ?? null)
        : 'AI_CONFIGURATION_REQUIRED');
    const action = gradingJobActions({
      status: prior.status,
      originalError: null,
      currentError,
    }).newCurrent;
    ensure(action.allowed && plan.snapshot, action.reason ?? 'AI_CONFIGURATION_REQUIRED', 409);
    await readSecret(plan.snapshot.secretId, 'AI_API_KEY');
    request.modelConfigId = plan.snapshot.bindingId;
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
    return { id: run.id, status: run.status };
  });
}
