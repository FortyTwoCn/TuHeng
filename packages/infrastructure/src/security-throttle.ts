import { createHmac } from 'node:crypto';
import { prisma } from '@tuheng/database';
import { ensure } from '@tuheng/domain';

export function securityDigest(value: string) {
  const key = process.env.AUTH_SECRET;
  ensure(key && key.length >= 32, 'AUTH_CONFIGURATION_REQUIRED', 503);
  return createHmac('sha256', key).update(`identity-v1:${value}`).digest('hex');
}
export async function rateLimit(key: string, limit: number, windowMs: number) {
  const id = securityDigest(key);
  const now = new Date();
  const until = new Date(now.getTime() + windowMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "SecurityThrottle" (id, count, "expiresAt") VALUES (${id}, 1, ${until})
    ON CONFLICT (id) DO UPDATE SET count = CASE WHEN "SecurityThrottle"."expiresAt" <= ${now} THEN 1 ELSE "SecurityThrottle".count + 1 END,
    "expiresAt" = CASE WHEN "SecurityThrottle"."expiresAt" <= ${now} THEN ${until} ELSE "SecurityThrottle"."expiresAt" END
    RETURNING count`;
  ensure(rows[0].count <= limit, 'RATE_LIMITED', 429);
}
