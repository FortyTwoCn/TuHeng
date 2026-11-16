import Redis from 'ioredis';
import type { AISnapshot } from '@tuheng/contracts';
import { ProviderError } from '@tuheng/ai-providers';
import { redisOptions } from './queue';

// One atomic reservation for shared provider concurrency and all daily quotas.
const reserve = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 'AI_CONCURRENCY_LIMIT' end
for i=2,4 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i+3]) then return 'AI_DAILY_BUDGET_LIMIT' end
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[8])
redis.call('PEXPIRE', KEYS[1], 240000)
for i=2,4 do redis.call('INCR', KEYS[i]); redis.call('EXPIRE', KEYS[i], 172800) end
return 'OK'`;
export async function reserveAIBudget(
  snapshot: AISnapshot,
  actorId: string,
  schoolId: string | null,
) {
  const redis = new Redis({ ...redisOptions(), maxRetriesPerRequest: 1, connectTimeout: 3000 });
  redis.on('error', () => {}); // Never log connection strings or authentication errors.
  const prefix = `${process.env.QUEUE_NAMESPACE ?? 'tuheng'}:ai`,
    day = new Date().toISOString().slice(0, 10),
    token = crypto.randomUUID();
  const keys = [
    `${prefix}:active:${snapshot.providerId}`,
    `${prefix}:day:${day}:provider:${snapshot.providerId}`,
    `${prefix}:day:${day}:task:${snapshot.taskKey}:school:${schoolId ?? 'none'}`,
    `${prefix}:day:${day}:task:${snapshot.taskKey}:user:${actorId}`,
  ];
  try {
    const result = await redis.eval(
      reserve,
      keys.length,
      ...keys,
      Date.now(),
      Date.now() + 210000,
      snapshot.provider.concurrency,
      'unused',
      snapshot.provider.requestsPerDay,
      snapshot.parameters.perSchoolPerDay,
      snapshot.parameters.perUserPerDay,
      token,
    );
    if (result !== 'OK') throw new ProviderError(String(result), false);
    return async () => {
      try {
        await redis.zrem(keys[0], token);
      } catch {
        // The lease expires independently; a release outage must not retry a paid request.
      } finally {
        redis.disconnect();
      }
    };
  } catch (error) {
    redis.disconnect();
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('AI_BUDGET_UNAVAILABLE', false);
  }
}
