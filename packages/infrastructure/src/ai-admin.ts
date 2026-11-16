import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { database, prisma } from '@tuheng/database';
import {
  AIProviderConfig,
  AIModelConfig,
  AITaskKey,
  AITaskParameters,
  AISnapshot,
  aiConfigurationError,
} from '@tuheng/contracts';
import { AITaskRegistry, audit, ensure, type Actor } from '@tuheng/domain';
import { requireRecentAuthentication } from './identity-security';
import { encryptSecret } from './secret-store';
import { resolveOutbound } from './outbound';
import { invocationProvider } from './ai-gateway';
import { ProviderError } from '@tuheng/ai-providers';

const name = z.string().trim().min(1).max(100),
  id = z.string().min(1).max(100);
const mutation = { proof: z.string(), expectedVersion: z.number().int().nonnegative() };
export const AICommands = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('provider'),
    ...mutation,
    id: id.optional(),
    name,
    brand: name,
    enabled: z.boolean(),
    archived: z.boolean().default(false),
    config: AIProviderConfig,
    apiKey: z.string().max(4096).optional(),
  }),
  z.object({
    operation: z.literal('model'),
    ...mutation,
    id: id.optional(),
    providerId: id,
    name,
    enabled: z.boolean(),
    archived: z.boolean().default(false),
    config: AIModelConfig,
  }),
  z.object({
    operation: z.literal('binding'),
    ...mutation,
    taskKey: AITaskKey,
    modelId: id,
    enabled: z.boolean(),
    parameters: AITaskParameters,
  }),
  z.object({ operation: z.literal('revoke-key'), proof: z.string(), providerId: id, secretId: id }),
  z.object({
    operation: z.literal('rollback'),
    proof: z.string(),
    kind: z.enum(['provider', 'model', 'binding']),
    id,
    version: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
  }),
  z.object({
    operation: z.literal('test'),
    proof: z.string(),
    modelId: id,
    kind: z.enum(['connection', 'text', 'image', 'structured']),
    costConfirmed: z.literal(true),
    outputMode: z.enum(['json_schema', 'json_object', 'prompt_json']),
  }),
]);
export function requireAIAdmin(actor: Actor) {
  ensure(
    actor.kind === 'SITE_ADMIN' && actor.realm === 'STAFF' && !actor.onboarding,
    'FORBIDDEN',
    403,
  );
}
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
async function validateURL(value: string) {
  const u = new URL(value);
  await resolveOutbound(u.hostname, Number(u.port || (u.protocol === 'https:' ? 443 : 80)), 'AI');
}
export async function saveAIConfiguration(
  actor: Actor,
  input: z.infer<typeof AICommands>,
): Promise<{ id: string } | { status: string; errorCode: string | null; invocationId: string }> {
  requireAIAdmin(actor);
  await requireRecentAuthentication(actor, input.proof);
  if (input.operation === 'test') return testAIModel(actor, input);
  if (input.operation === 'revoke-key') {
    return prisma.$transaction(async (tx) => {
      ensure(
        await tx.aIProviderVersion.findFirst({
          where: { providerId: input.providerId, secretId: input.secretId },
        }),
        'SECRET_REFERENCE_FORBIDDEN',
        403,
      );
      await tx.secretRecord.update({
        where: { id: input.secretId },
        data: { revokedAt: new Date(), ciphertext: '', nonce: '', tag: '' },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'AI_KEY_REVOKED',
          resourceId: input.providerId,
          details: { secretId: input.secretId },
        },
      });
      return { id: input.providerId };
    });
  }
  if (input.operation === 'rollback') return rollbackAI(actor, input);
  if (input.operation === 'provider') await validateURL(input.config.baseUrl);
  if (input.operation === 'model' && input.config.baseUrl) await validateURL(input.config.baseUrl);
  return prisma.$transaction(
    async (tx) => {
      let resourceId: string;
      if (input.operation === 'provider') {
        const old = input.id ? await tx.aIProvider.findUnique({ where: { id: input.id } }) : null;
        ensure(
          input.id
            ? !!old && old.currentVersion === input.expectedVersion
            : input.expectedVersion === 0,
          'CONFIGURATION_CHANGED',
          409,
        );
        const previous = old
          ? await tx.aIProviderVersion.findUnique({
              where: { providerId_version: { providerId: old.id, version: old.currentVersion } },
            })
          : null;
        let secretId = previous?.secretId ?? null;
        if (input.apiKey?.trim()) {
          ensure(!/[\s*•]/.test(input.apiKey), 'INVALID_API_KEY');
          secretId = (
            await tx.secretRecord.create({ data: encryptSecret(input.apiKey, 'AI_API_KEY') })
          ).id;
        }
        const version = (old?.currentVersion ?? 0) + 1;
        const data = {
          name: input.name,
          brand: input.brand,
          enabled: input.enabled && !input.archived,
          archived: input.archived,
          currentVersion: version,
        };
        const provider = old
          ? await tx.aIProvider.update({ where: { id: old.id }, data })
          : await tx.aIProvider.create({ data });
        await tx.aIProviderVersion.create({
          data: { providerId: provider.id, version, config: json(input.config), secretId },
        });
        resourceId = provider.id;
      } else if (input.operation === 'model') {
        const provider = await tx.aIProvider.findUnique({ where: { id: input.providerId } });
        ensure(provider && !provider.archived, 'PROVIDER_NOT_AVAILABLE');
        const old = input.id ? await tx.aIModel.findUnique({ where: { id: input.id } }) : null;
        ensure(
          input.id
            ? !!old &&
                old.currentVersion === input.expectedVersion &&
                old.providerId === input.providerId
            : input.expectedVersion === 0,
          'CONFIGURATION_CHANGED',
          409,
        );
        const version = (old?.currentVersion ?? 0) + 1,
          data = {
            providerId: provider.id,
            name: input.name,
            enabled: input.enabled && !input.archived,
            archived: input.archived,
            currentVersion: version,
          };
        const model = old
          ? await tx.aIModel.update({ where: { id: old.id }, data })
          : await tx.aIModel.create({ data });
        await tx.aIModelVersion.create({
          data: { modelId: model.id, version, config: json(input.config), testStatus: {} },
        });
        resourceId = model.id;
      } else {
        const old = await tx.aITaskBindingVersion.findFirst({
          where: { taskKey: input.taskKey },
          orderBy: { version: 'desc' },
        });
        ensure((old?.version ?? 0) === input.expectedVersion, 'CONFIGURATION_CHANGED', 409);
        const model = await tx.aIModel.findUnique({
          where: { id: input.modelId },
          include: { provider: true },
        });
        ensure(model, 'MODEL_NOT_FOUND');
        const mv = await tx.aIModelVersion.findUniqueOrThrow({
          where: { modelId_version: { modelId: model.id, version: model.currentVersion } },
        });
        const pv = await tx.aIProviderVersion.findUniqueOrThrow({
          where: {
            providerId_version: {
              providerId: model.providerId,
              version: model.provider.currentVersion,
            },
          },
        });
        const error = aiConfigurationError(
          AIProviderConfig.parse(pv.config),
          AIModelConfig.parse(mv.config),
          input.parameters,
          false,
        );
        ensure(!error, error ?? 'INVALID_BINDING');
        if (input.enabled)
          ensure(
            model.enabled && !model.archived && model.provider.enabled && !model.provider.archived,
            'MODEL_OR_PROVIDER_DISABLED',
          );
        const binding = await tx.aITaskBindingVersion.create({
          data: {
            taskKey: input.taskKey,
            version: (old?.version ?? 0) + 1,
            modelId: model.id,
            parameters: json(input.parameters),
            enabled: input.enabled,
          },
        });
        resourceId = binding.id;
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: `AI_${input.operation.toUpperCase()}_VERSION_CREATED`,
          resourceId,
          details: { previousVersion: input.expectedVersion },
        },
      });
      return { id: resourceId };
    },
    { isolationLevel: 'Serializable' },
  );
}
async function rollbackAI(
  actor: Actor,
  input: Extract<z.infer<typeof AICommands>, { operation: 'rollback' }>,
): Promise<{ id: string } | { status: string; errorCode: string | null; invocationId: string }> {
  // A rollback is a new version; never update rows referenced by existing invocations.
  if (input.kind === 'binding') {
    const old = await prisma.aITaskBindingVersion.findUniqueOrThrow({ where: { id: input.id } });
    const row = await prisma.aITaskBindingVersion.findUniqueOrThrow({
      where: { taskKey_version: { taskKey: old.taskKey, version: input.version } },
    });
    return saveAIConfiguration(actor, {
      ...input,
      operation: 'binding',
      taskKey: AITaskKey.parse(row.taskKey),
      modelId: row.modelId,
      enabled: row.enabled,
      parameters: AITaskParameters.parse(row.parameters),
    });
  }
  if (input.kind === 'model') {
    const old = await prisma.aIModel.findUniqueOrThrow({ where: { id: input.id } });
    const row = await prisma.aIModelVersion.findUniqueOrThrow({
      where: { modelId_version: { modelId: old.id, version: input.version } },
    });
    return saveAIConfiguration(actor, {
      ...input,
      operation: 'model',
      providerId: old.providerId,
      name: old.name,
      enabled: old.enabled,
      archived: old.archived,
      config: AIModelConfig.parse(row.config),
    });
  }
  const old = await prisma.aIProvider.findUniqueOrThrow({ where: { id: input.id } });
  const row = await prisma.aIProviderVersion.findUniqueOrThrow({
    where: { providerId_version: { providerId: old.id, version: input.version } },
  });
  // Keep the current credential. A rollback must never resurrect a revoked key.
  return saveAIConfiguration(actor, {
    ...input,
    operation: 'provider',
    name: old.name,
    brand: old.brand,
    enabled: old.enabled,
    archived: old.archived,
    config: AIProviderConfig.parse(row.config),
  });
}
export async function aiCenter(actor: Actor, query = '') {
  requireAIAdmin(actor);
  const [providers, models, bindings, usage] = await Promise.all([
    prisma.aIProvider.findMany({
      include: { versions: { orderBy: { version: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.aIModel.findMany({
      where: query ? { name: { contains: query, mode: 'insensitive' } } : {},
      include: { versions: { orderBy: { version: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.aITaskBindingVersion.findMany({ orderBy: { version: 'desc' } }),
    prisma.aIInvocation.groupBy({ by: ['taskKey', 'status'], _count: true }),
  ]);
  const safeProviders = await Promise.all(
    providers.map(async (p) => ({
      ...p,
      versions: await Promise.all(
        p.versions.map(async (v) => {
          const key = v.secretId
            ? await prisma.secretRecord.findUnique({
                where: { id: v.secretId },
                select: { suffix: true, revokedAt: true, createdAt: true },
              })
            : null;
          return {
            ...v,
            key: key
              ? { configured: !key.revokedAt, suffix: key.suffix, updatedAt: key.createdAt }
              : null,
          };
        }),
      ),
    })),
  );
  return { providers: safeProviders, models, bindings, tasks: AITaskRegistry, usage };
}
async function testAIModel(
  actor: Actor,
  input: Extract<z.infer<typeof AICommands>, { operation: 'test' }>,
) {
  const row = await prisma.aIModel.findUniqueOrThrow({
    where: { id: input.modelId },
    include: { provider: true },
  });
  const pv = await prisma.aIProviderVersion.findUniqueOrThrow({
    where: {
      providerId_version: { providerId: row.providerId, version: row.provider.currentVersion },
    },
  });
  const mv = await prisma.aIModelVersion.findUniqueOrThrow({
    where: { modelId_version: { modelId: row.id, version: row.currentVersion } },
  });
  const provider = AIProviderConfig.parse(pv.config),
    model = AIModelConfig.parse(mv.config),
    parameters = AITaskParameters.parse({ outputMode: input.outputMode, maxOutputTokens: 256 });
  ensure(pv.secretId, 'AI_CREDENTIAL_NOT_CONFIGURED');
  const mismatch = aiConfigurationError(provider, model, parameters, input.kind === 'image');
  ensure(!mismatch, mismatch ?? 'AI_CAPABILITY_MISMATCH');
  const snapshot = AISnapshot.parse({
    schemaVersion: 'tuheng.ai/1',
    taskKey: 'grading.assignment',
    bindingId: 'admin-protocol-test',
    bindingVersion: 0,
    providerId: row.providerId,
    providerVersionId: pv.id,
    providerVersion: pv.version,
    modelId: row.id,
    modelVersionId: mv.id,
    modelVersion: mv.version,
    secretId: pv.secretId,
    provider,
    model,
    parameters,
    required: { text: true, images: input.kind === 'image' },
    capabilityCheck: 'PASSED',
    promptVersion: 'protocol-test/1',
    strategyVersion: 'protocol-test/1',
  });
  const invocation = await prisma.aIInvocation.create({
    data: {
      taskKey: 'admin.model-test',
      actorId: actor.id,
      resourceId: row.id,
      snapshot: json(snapshot),
      status: 'QUEUED',
    },
  });
  let code: string | null = null;
  try {
    const provider = await invocationProvider(invocation.id);
    const image =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFUAAAAASUVORK5CYII=';
    const response = await provider.evaluate({
      system: 'Return JSON only.',
      user: 'Protocol test without personal data. Return {"ok":true}.',
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
      images:
        input.kind === 'image'
          ? [
              {
                assetId: 'test',
                version: '1',
                role: 'QUESTION',
                dataUrl: `data:image/png;base64,${image}`,
              },
            ]
          : [],
    });
    if (
      !z
        .object({ ok: z.literal(true) })
        .strict()
        .safeParse(response.data).success
    )
      code = 'MODEL_SCHEMA_INVALID';
  } catch (error) {
    code = error instanceof ProviderError ? error.code : 'MODEL_TEST_FAILED';
  }
  const status = code ? 'FAILED' : 'PASSED';
  const current = await prisma.aIModelVersion.findUniqueOrThrow({ where: { id: mv.id } });
  await prisma.aIModelVersion.update({
    where: { id: mv.id },
    data: {
      testStatus: {
        ...(current.testStatus as Record<string, Prisma.InputJsonValue>),
        [input.kind]: {
          status,
          errorCode: code,
          at: new Date().toISOString(),
          providerVersion: pv.version,
          outputMode: input.outputMode,
        },
      },
    },
  });
  await prisma.aIInvocation.update({
    where: { id: invocation.id },
    data: { status: code ? 'FAILED' : 'SUCCEEDED', errorCode: code, finishedAt: new Date() },
  });
  await audit(database, actor, 'AI_MODEL_TEST', row.id, {
    kind: input.kind,
    status,
    invocationId: invocation.id,
  });
  return { status, errorCode: code, invocationId: invocation.id };
}
