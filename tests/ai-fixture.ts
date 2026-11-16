import { randomBytes } from 'node:crypto';
import { prisma } from '@tuheng/database';
import { AIModelConfig, AIProviderConfig, AITaskParameters } from '@tuheng/contracts';
import { encryptSecret } from '../packages/infrastructure/src/secret-store';
export async function aiFixture(baseUrl = 'https://protocol-test.invalid/v1') {
  if (process.env.NODE_ENV !== 'test') throw new Error('TEST_ONLY');
  const keyId = `test-${crypto.randomUUID()}`;
  process.env.TUHENG_SECRET_KEYS = JSON.stringify({
    ...JSON.parse(process.env.TUHENG_SECRET_KEYS ?? '{}'),
    [keyId]: randomBytes(32).toString('base64'),
  });
  process.env.TUHENG_SECRET_ACTIVE_KEY = keyId;
  const secret = await prisma.secretRecord.create({
    data: encryptSecret('test-credential-not-for-real-provider', 'AI_API_KEY'),
  });
  const provider = await prisma.aIProvider.create({
    data: {
      name: '[TEST] protocol fixture',
      brand: 'TEST_ONLY',
      enabled: true,
      versions: {
        create: {
          version: 1,
          secretId: secret.id,
          config: AIProviderConfig.parse({
            baseUrl,
            protocol: 'OPENAI_CHAT_COMPLETIONS',
            concurrency: 1,
          }),
        },
      },
    },
  });
  const model = await prisma.aIModel.create({
    data: {
      providerId: provider.id,
      name: '[TEST] protocol fixture model',
      enabled: true,
      versions: {
        create: {
          version: 1,
          config: AIModelConfig.parse({
            model: 'test-model',
            images: true,
            outputModes: ['json_schema', 'prompt_json'],
          }),
          testStatus: {},
        },
      },
    },
  });
  async function bind(taskKey: 'grading.assignment' | 'grading.selftest', enabled = true) {
    const previous = await prisma.aITaskBindingVersion.findFirst({
      where: { taskKey },
      orderBy: { version: 'desc' },
    });
    return prisma.aITaskBindingVersion.create({
      data: {
        taskKey,
        version: (previous?.version ?? 0) + 1,
        modelId: model.id,
        enabled,
        parameters: AITaskParameters.parse({ outputMode: 'prompt_json' }),
      },
    });
  }
  return { provider, model, secret, bind };
}
