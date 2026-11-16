import 'dotenv/config';
import { prisma } from '@tuheng/database';
import {
  AIProviderConfig,
  AIModelConfig,
  AITaskParameters,
  AIProtocol,
  AIOutputMode,
} from '@tuheng/contracts';
import { ensure } from '@tuheng/domain';
import { encryptSecret } from '../packages/infrastructure/src/secret-store';
import { resolveOutbound } from '../packages/infrastructure/src/outbound';

const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
ensure(
  process.argv.includes('--confirm-import') &&
    process.argv.includes('--legacy-id') &&
    process.argv.includes('--protocol'),
  'Use --legacy-id ID --protocol OPENAI_CHAT_COMPLETIONS|ANTHROPIC_MESSAGES --confirm-import [--images]. Imported configurations remain disabled.',
);
const legacy = await prisma.modelConfigurationVersion.findUniqueOrThrow({
  where: { id: arg('--legacy-id') },
});
ensure(/^AI_[A-Z0-9_]+$/.test(legacy.keyEnv), 'LEGACY_KEY_ENV_NOT_ALLOWED');
const root = await prisma.user.findFirstOrThrow({ where: { kind: 'SITE_ADMIN' } });
ensure(
  root.active && !root.mustChangePassword && !!root.emailVerifiedAt && root.installationComplete,
  'COMPLETE_ADMIN_INSTALLATION_FIRST',
);
const providerConfig = AIProviderConfig.parse({
  baseUrl: legacy.baseUrl,
  protocol: AIProtocol.parse(arg('--protocol')),
  timeoutMs: legacy.timeoutMs,
  concurrency: legacy.concurrency,
});
const url = new URL(providerConfig.baseUrl);
await resolveOutbound(
  url.hostname,
  Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
  'AI',
);
const mode = AIOutputMode.parse(legacy.outputMode);
const modelConfig = AIModelConfig.parse({
  model: legacy.model,
  images: process.argv.includes('--images'),
  outputModes: [mode],
});
const parameters = AITaskParameters.parse({ outputMode: mode });
try {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72651324)`;
    ensure(
      !(await tx.auditLog.findFirst({
        where: { action: 'LEGACY_AI_IMPORTED', resourceId: legacy.id },
      })),
      'LEGACY_AI_ALREADY_IMPORTED',
    );
    const key = process.env[legacy.keyEnv]?.trim();
    const secret = key
      ? await tx.secretRecord.create({ data: encryptSecret(key, 'AI_API_KEY') })
      : null;
    const provider = await tx.aIProvider.create({
      data: {
        name: '迁移 · ' + legacy.provider,
        brand: legacy.provider,
        enabled: false,
        currentVersion: 1,
        versions: { create: { version: 1, config: providerConfig, secretId: secret?.id } },
      },
    });
    const model = await tx.aIModel.create({
      data: {
        providerId: provider.id,
        name: legacy.model,
        enabled: false,
        currentVersion: 1,
        versions: { create: { version: 1, config: modelConfig, testStatus: {} } },
      },
    });
    for (const taskKey of ['grading.assignment', 'grading.selftest']) {
      const prior = await tx.aITaskBindingVersion.findFirst({
        where: { taskKey },
        orderBy: { version: 'desc' },
      });
      // Do not replace an existing administrator binding.
      if (!prior)
        await tx.aITaskBindingVersion.create({
          data: { taskKey, version: 1, modelId: model.id, enabled: false, parameters },
        });
    }
    await tx.auditLog.create({
      data: {
        actorId: root.id,
        action: 'LEGACY_AI_IMPORTED',
        resourceId: legacy.id,
        details: { providerId: provider.id, modelId: model.id, credentialImported: !!secret },
      },
    });
    return {
      providerId: provider.id,
      modelId: model.id,
      credentialImported: !!secret,
      enabled: false,
    };
  });
  console.log(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
