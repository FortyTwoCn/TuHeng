import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@tuheng/database';
import { AISnapshot } from '@tuheng/contracts';
import { ensure, type Actor } from '@tuheng/domain';

export const InvocationFilters = z.object({
  page: z.coerce.number().int().min(0).max(10000).default(0),
  schoolId: z.string().max(100).optional(),
  actorId: z.string().max(100).optional(),
  providerId: z.string().max(100).optional(),
  taskKey: z.string().max(100).optional(),
  status: z.string().max(50).optional(),
  runId: z.string().max(100).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export async function listAIInvocations(actor: Actor, filters: z.infer<typeof InvocationFilters>) {
  ensure(
    actor.kind === 'SITE_ADMIN' && actor.realm === 'STAFF' && !actor.onboarding,
    'FORBIDDEN',
    403,
  );
  const where: Prisma.AIInvocationWhereInput = {
    ...(filters.schoolId ? { schoolId: filters.schoolId } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.taskKey ? { taskKey: filters.taskKey } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.runId ? { runId: filters.runId } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(filters.to) } : {}),
          },
        }
      : {}),
    ...(filters.providerId
      ? { snapshot: { path: ['providerId'], equals: filters.providerId } }
      : {}),
  };
  const [records, total, providers] = await Promise.all([
    prisma.aIInvocation.findMany({
      where,
      skip: filters.page * 30,
      take: 30,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { callAttempts: { orderBy: { ordinal: 'asc' } } },
    }),
    prisma.aIInvocation.count({ where }),
    prisma.aIProvider.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return {
    total,
    page: filters.page,
    providers,
    updatedAt: new Date().toISOString(),
    items: records.map((row) => {
      const parsed = AISnapshot.safeParse(row.snapshot),
        snapshot = parsed.success ? parsed.data : null;
      return {
        id: row.id,
        runId: row.runId,
        taskKey: row.taskKey,
        resourceId: row.resourceId,
        schoolId: row.schoolId,
        actorId: row.actorId,
        createdAt: row.createdAt,
        status: row.status,
        attempts: row.attempts,
        errorCode: row.errorCode,
        durationMs: row.durationMs,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        estimatedCost: row.estimatedCost,
        costCurrency: row.costCurrency,
        billingUncertain: row.billingUncertain,
        providerName:
          providers.find((p) => p.id === snapshot?.providerId)?.name ?? '尚无供应商快照',
        snapshot: snapshot
          ? {
              schemaVersion: snapshot.schemaVersion,
              taskKey: snapshot.taskKey,
              providerId: snapshot.providerId,
              providerVersion: snapshot.providerVersion,
              modelId: snapshot.modelId,
              model: snapshot.model.model,
              modelVersion: snapshot.modelVersion,
              bindingVersion: snapshot.bindingVersion,
              protocol: snapshot.model.protocol ?? snapshot.provider.protocol,
              outputMode: snapshot.parameters.outputMode,
              pricing: snapshot.model.pricing,
              promptVersion: snapshot.promptVersion,
              strategyVersion: snapshot.strategyVersion,
            }
          : null,
        callAttempts: row.callAttempts.map((a) => ({
          ordinal: a.ordinal,
          createdAt: a.createdAt,
          status: a.status,
          providerId: a.providerId,
          modelId: a.modelId,
          errorCode: a.errorCode,
          durationMs: a.durationMs,
          inputTokens: a.inputTokens,
          outputTokens: a.outputTokens,
          estimatedCost: a.estimatedCost,
          costCurrency: a.costCurrency,
          billingUncertain: a.billingUncertain,
        })),
      };
    }),
  };
}
