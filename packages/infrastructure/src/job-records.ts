import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, database } from '@tuheng/database';
import { AISnapshot, GradingRequest } from '@tuheng/contracts';
import {
  AITaskRegistry,
  requireRole,
  ensure,
  gradingJobActions,
  planAIInvocation,
  requiredGradingCapabilities,
  type Actor,
} from '@tuheng/domain';
import { canManageAI } from './ai-admin';
import { jobSnapshotError } from './job-readiness';

export const JobFilters = z.object({
  page: z.coerce.number().int().min(0).max(10000).default(0),
  q: z.string().max(200).optional(),
  lane: z.enum(['formal', 'selftest']).optional(),
  status: z
    .enum(['QUEUED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'BLOCKED_CONFIG'])
    .optional(),
  schoolId: z.string().max(100).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export async function listGradingJobs(actor: Actor, filters: z.infer<typeof JobFilters>) {
  requireRole(actor, 'ADMIN', 'PLATFORM_OPERATOR');
  ensure(actor.realm === 'STAFF' && !actor.onboarding, 'FORBIDDEN', 403);
  const manageable = canManageAI(actor);
  const where: Prisma.BackgroundJobWhereInput = {
    ...(filters.q ? { OR: [{ runId: filters.q }, { run: { attemptId: filters.q } }] } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.lane ? { lane: filters.lane } : {}),
    run: {
      ...(filters.schoolId ? { attempt: { owner: { schoolId: filters.schoolId } } } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    },
  };
  const [rows, counts] = await Promise.all([
    prisma.backgroundJob.findMany({
      where,
      skip: filters.page * 30,
      take: 30,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        run: {
          select: {
            id: true,
            status: true,
            attemptId: true,
            createdAt: true,
            startedAt: true,
            finishedAt: true,
            promptVersion: true,
            strategyVersion: true,
            request: true,
            attempt: {
              select: {
                version: true,
                source: true,
                publishedDecisionId: true,
                ownerId: true,
                owner: {
                  select: {
                    active: true,
                    schoolId: true,
                    school: { select: { name: true, active: true } },
                  },
                },
                questionVersion: { select: { id: true, version: true, title: true } },
              },
            },
          },
        },
      },
    }),
    prisma.backgroundJob.groupBy({ by: ['status'], where, _count: { _all: true } }),
  ]);
  const runIds = rows.map((r) => r.runId);
  const [invocations, links] = await Promise.all([
    prisma.aIInvocation.findMany({
      where: { runId: { in: runIds } },
      select: { runId: true, taskKey: true, actorId: true, schoolId: true, snapshot: true },
    }),
    prisma.auditLog.findMany({
      where: {
        action: 'RUN_NEW_CONFIGURATION',
        OR: [
          { resourceId: { in: runIds } },
          ...runIds.map((id) => ({ details: { path: ['previousRunId'], equals: id } })),
        ],
      },
      select: { resourceId: true, details: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }),
  ]);
  // The current route has at most two capability variants per task; reuse its diagnostic per page.
  const plans = new Map<string, ReturnType<typeof planAIInvocation>>();
  const readiness = new Map<string, Promise<string | null>>();
  function ready(value: AISnapshot, ownerId: string, schoolId: string | null) {
    const key = [value.providerId, value.modelId, value.secretId, ownerId, schoolId].join('|');
    if (!readiness.has(key))
      readiness.set(key, jobSnapshotError(database, value, ownerId, schoolId));
    return readiness.get(key)!;
  }
  const items = await Promise.all(
    rows.map(async (row) => {
      const inv = invocations.find((i) => i.runId === row.runId),
        parsed = AISnapshot.safeParse(inv?.snapshot);
      const snapshot = parsed.success ? parsed.data : null,
        request = GradingRequest.safeParse(row.run.request);
      const attempt = row.run.attempt,
        taskKey = attempt.source === 'ASSIGNMENT' ? 'grading.assignment' : 'grading.selftest';
      let currentError: string | null = 'RUN_REQUEST_INCOMPATIBLE';
      if (request.success) {
        const key = taskKey + ':' + requiredGradingCapabilities(request.data).images;
        if (!plans.has(key)) plans.set(key, planAIInvocation(database, taskKey, request.data));
        const plan = await plans.get(key)!;
        currentError =
          plan.errorCode ??
          (plan.snapshot
            ? await ready(plan.snapshot, attempt.ownerId, attempt.owner.schoolId)
            : 'AI_CONFIGURATION_REQUIRED');
      }
      const originalError =
        snapshot && inv ? await ready(snapshot, inv.actorId, inv.schoolId) : 'AI_SNAPSHOT_REQUIRED';
      const sourceLink = links.find((l) => l.resourceId === row.runId);
      const previousRunId =
        sourceLink && (sourceLink.details as { previousRunId?: string }).previousRunId;
      return {
        id: row.id,
        runId: row.runId,
        attemptId: row.run.attemptId,
        lane: row.lane,
        status: row.status,
        attempts: row.attempts,
        errorCode: row.errorCode
          ? /^[A-Z][A-Z0-9_]{0,99}$/.test(row.errorCode)
            ? row.errorCode
            : 'DIAGNOSTIC_UNAVAILABLE'
          : null,
        taskKey,
        taskName: AITaskRegistry[taskKey].name,
        title: attempt.questionVersion.title,
        schoolId: attempt.owner.schoolId,
        schoolName: attempt.owner.school?.name ?? '无学校范围',
        questionVersion: attempt.questionVersion.version,
        questionVersionId: attempt.questionVersion.id,
        attemptVersion: attempt.version,
        officialGradePublished: !!attempt.publishedDecisionId,
        createdAt: row.run.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        startedAt: row.run.startedAt?.toISOString() ?? null,
        finishedAt: row.run.finishedAt?.toISOString() ?? null,
        promptVersion: row.run.promptVersion,
        strategyVersion: row.run.strategyVersion,
        inputVersion: request.success ? 'GradingRequest/1' : '旧契约，需核对',
        outputVersion: 'GradingResult/1',
        snapshot: snapshot
          ? {
              bindingId: snapshot.bindingId,
              bindingVersion: snapshot.bindingVersion,
              providerId: snapshot.providerId,
              providerVersion: snapshot.providerVersion,
              modelId: snapshot.modelId,
              modelVersion: snapshot.modelVersion,
              model: snapshot.model.model,
              protocol: snapshot.model.protocol ?? snapshot.provider.protocol,
              requiredImages: snapshot.required.images,
            }
          : null,
        actions: gradingJobActions({
          status: row.run.status,
          originalError,
          currentError,
          manageable,
        }),
        previousRunId: previousRunId ?? null,
        nextRunIds: links
          .filter((l) => (l.details as { previousRunId?: string }).previousRunId === row.runId)
          .map((l) => l.resourceId),
      };
    }),
  );
  return {
    items,
    manageable,
    counts: counts.map((c) => ({ status: c.status, count: c._count._all })),
    total: counts.reduce((s, c) => s + c._count._all, 0),
    page: filters.page,
    updatedAt: new Date().toISOString(),
  };
}
