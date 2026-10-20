import { Queue } from 'bullmq';
import { prisma } from '@tuheng/database';
export function redisOptions() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
export function queueFor(lane: string) {
  return new Queue(`${process.env.QUEUE_NAMESPACE ?? 'tuheng'}-${lane}`, {
    connection: redisOptions(),
  });
}
export async function dispatchOutbox(runIds?: string[]) {
  const events = await prisma.outboxEvent.findMany({
    where: { deliveredAt: null, ...(runIds ? { runId: { in: runIds } } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  for (const event of events) {
    const queue = queueFor(event.lane);
    try {
      await queue.add(
        'grade',
        { runId: event.runId },
        {
          jobId: event.runId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 500,
          removeOnFail: 1000,
        },
      );
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { deliveredAt: new Date() },
      });
    } finally {
      await queue.close();
    }
  }
  return events.length;
}
// Database compensation also repairs queues lost after a successful outbox delivery.
export async function reconcileQueuedRuns(runIds?: string[]) {
  const jobs = await prisma.backgroundJob.findMany({
    where: {
      ...(runIds ? { runId: { in: runIds } } : {}),
      status: { in: ['QUEUED', 'RETRYING'] },
      updatedAt: { lt: new Date(Date.now() - 30000) },
    },
    take: 100,
  });
  for (const job of jobs) {
    const queue = queueFor(job.lane);
    try {
      const queued = await queue.getJob(job.runId);
      const state = queued ? await queued.getState() : null;
      if (state === 'completed' || state === 'failed') await queued!.remove();
      if (!state || state === 'completed' || state === 'failed')
        await prisma.outboxEvent.update({
          where: { runId: job.runId },
          data: { deliveredAt: null },
        });
    } finally {
      await queue.close();
    }
  }
  return jobs.length;
}
