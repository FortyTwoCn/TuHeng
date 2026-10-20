import 'dotenv/config';
import { z } from 'zod';
import { prisma } from '@tuheng/database';
const c = z
  .object({
    baseUrl: z.url(),
    model: z.string().min(1),
    outputMode: z.enum(['json_object', 'json_schema']),
    timeoutMs: z.coerce.number().int().min(1000).max(120000),
    concurrency: z.coerce.number().int().min(1).max(10),
  })
  .parse({
    baseUrl: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
    outputMode: process.env.AI_OUTPUT_MODE ?? 'json_object',
    timeoutMs: process.env.AI_TIMEOUT_MS ?? 60000,
    concurrency: process.env.AI_CONCURRENCY ?? 2,
  });
const u = new URL(c.baseUrl);
if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
  throw new Error('Invalid base URL');
const result = await prisma.$transaction(async (tx) => {
  await tx.modelConfigurationVersion.updateMany({
    where: { active: true },
    data: { active: false },
  });
  return tx.modelConfigurationVersion.create({
    data: { ...c, provider: 'openai-compatible-vision', keyEnv: 'AI_API_KEY', active: true },
  });
});
console.log(
  `New model configuration version: ${result.id}; key configured: ${!!process.env.AI_API_KEY}. Restart web and worker to load updated environment.`,
);
await prisma.$disconnect();
