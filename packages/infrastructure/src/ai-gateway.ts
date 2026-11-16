import { prisma } from '@tuheng/database';
import { AISnapshot, type VisionProvider } from '@tuheng/contracts';
import {
  AnthropicMessagesProvider,
  OpenAICompatibleVisionProvider,
  ProviderError,
} from '@tuheng/ai-providers';
import { readSecret } from './secret-store';
import { guardedFetch } from './outbound';
import { reserveAIBudget } from './ai-budget';

export function adapterForSnapshot(snapshot: AISnapshot, apiKey: string): VisionProvider {
  const config = {
    baseUrl: snapshot.model.baseUrl ?? snapshot.provider.baseUrl,
    model: snapshot.model.model,
    endpoint: snapshot.model.endpoint,
    outputMode: snapshot.parameters.outputMode,
    timeoutMs: snapshot.provider.timeoutMs,
    apiKey,
    temperature: snapshot.parameters.temperature,
    maxOutputTokens: snapshot.parameters.maxOutputTokens,
    tokenParameter: snapshot.model.tokenParameter,
    systemRole: snapshot.model.systemRole,
    anthropicVersion: snapshot.provider.anthropicVersion,
    anthropicAuthentication: snapshot.provider.anthropicAuthentication,
  };
  return (snapshot.model.protocol ?? snapshot.provider.protocol) === 'ANTHROPIC_MESSAGES'
    ? new AnthropicMessagesProvider(config, guardedFetch)
    : new OpenAICompatibleVisionProvider(config, guardedFetch);
}
export async function invocationProvider(invocationId: string): Promise<VisionProvider> {
  return {
    async evaluate(input) {
      const invocation = await prisma.aIInvocation.findUniqueOrThrow({
        where: { id: invocationId },
      });
      const parsed = AISnapshot.safeParse(invocation.snapshot);
      if (!parsed.success) throw new ProviderError('AI_SNAPSHOT_REQUIRED', false);
      const snapshot = parsed.data;
      const [provider, model, owner, school] = await Promise.all([
        prisma.aIProvider.findUnique({ where: { id: snapshot.providerId } }),
        prisma.aIModel.findUnique({ where: { id: snapshot.modelId } }),
        prisma.user.findUnique({ where: { id: invocation.actorId } }),
        invocation.schoolId
          ? prisma.school.findUnique({ where: { id: invocation.schoolId } })
          : null,
      ]);
      if (!provider?.enabled || provider.archived)
        throw new ProviderError('AI_PROVIDER_DISABLED', false);
      if (!model?.enabled || model.archived || model.providerId !== provider.id)
        throw new ProviderError('AI_MODEL_DISABLED', false);
      if (
        !owner?.active ||
        (invocation.schoolId && (!school?.active || owner.schoolId !== invocation.schoolId))
      )
        throw new ProviderError('AI_SCOPE_DISABLED', false);
      if (input.images.length && !snapshot.model.images)
        throw new ProviderError('AI_CAPABILITY_MISMATCH', false);
      let apiKey: string;
      try {
        apiKey = await readSecret(snapshot.secretId, 'AI_API_KEY');
      } catch {
        throw new ProviderError('AI_CREDENTIAL_UNAVAILABLE', false);
      }
      // Current emergency budgets can tighten an old snapshot without changing its model/parameters.
      const current = await prisma.aIProviderVersion.findUnique({
        where: {
          providerId_version: { providerId: provider.id, version: provider.currentVersion },
        },
      });
      const currentConfig = (await import('@tuheng/contracts')).AIProviderConfig.safeParse(
        current?.config,
      );
      const budgets = currentConfig.success
        ? {
            ...snapshot,
            provider: {
              ...snapshot.provider,
              concurrency: Math.min(snapshot.provider.concurrency, currentConfig.data.concurrency),
              requestsPerDay: Math.min(
                snapshot.provider.requestsPerDay,
                currentConfig.data.requestsPerDay,
              ),
            },
          }
        : snapshot;
      const release = await reserveAIBudget(budgets, invocation.actorId, invocation.schoolId);
      const started = Date.now();
      let attemptId: string | undefined;
      try {
        const updated = await prisma.aIInvocation.update({
          where: { id: invocationId },
          data: {
            attempts: { increment: 1 },
            status: 'RUNNING',
            startedAt: new Date(),
            errorCode: null,
          },
        });
        const attempt = await prisma.aIInvocationAttempt.create({
          data: {
            invocationId,
            ordinal: updated.attempts,
            providerId: provider.id,
            modelId: model.id,
            status: 'RUNNING',
          },
        });
        attemptId = attempt.id;
        const response = await adapterForSnapshot(snapshot, apiKey).evaluate(input);
        const price = snapshot.model.pricing;
        const estimatedCost =
          price && response.inputTokens !== null && response.outputTokens !== null
            ? (response.inputTokens * price.inputPerMillion +
                response.outputTokens * price.outputPerMillion) /
              1000000
            : null;
        const usage = {
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          durationMs: response.durationMs,
          estimatedCost,
          costCurrency: price?.currency ?? null,
        };
        await prisma.$transaction([
          prisma.aIInvocationAttempt.update({
            where: { id: attempt.id },
            data: { ...usage, status: 'RECEIVED' },
          }),
          prisma.aIInvocation.update({
            where: { id: invocationId },
            data: { ...usage, status: 'RECEIVED', finishedAt: new Date() },
          }),
        ]);
        return response;
      } catch (error) {
        if (!attemptId) throw error;
        const code = error instanceof ProviderError ? error.code : 'AI_REQUEST_FAILED';
        const billingUncertain = error instanceof ProviderError && error.billingUncertain;
        await prisma.$transaction([
          prisma.aIInvocationAttempt.update({
            where: { id: attemptId },
            data: {
              status: 'FAILED',
              errorCode: code,
              durationMs: Date.now() - started,
              billingUncertain,
            },
          }),
          prisma.aIInvocation.update({
            where: { id: invocationId },
            data: {
              status: 'FAILED',
              errorCode: code,
              ...(billingUncertain ? { billingUncertain: true } : {}),
              finishedAt: new Date(),
            },
          }),
        ]);
        throw error;
      } finally {
        apiKey = '';
        await release();
      }
    },
  };
}
