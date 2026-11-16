import { Worker } from 'bullmq';
import {
  dispatchRosterImports,
  executeRosterImport,
} from '../../../packages/infrastructure/src/roster-import';
import { purgeExpiredSecrets } from '../../../packages/infrastructure/src/secret-store';
import { prisma } from '@tuheng/database';
import { dispatchOutbox, redisOptions, reconcileQueuedRuns } from '@tuheng/infrastructure';
import {
  executeGradingRun,
  recoverExpiredRuns,
} from '../../../packages/infrastructure/src/grading-runner';
const workers = ['formal', 'selftest'].map(
  (lane) =>
    new Worker(
      `${process.env.QUEUE_NAMESPACE ?? 'tuheng'}-${lane}`,
      async (job) => executeGradingRun(job.data.runId),
      {
        connection: redisOptions(),
        concurrency:
          lane === 'formal'
            ? Number(process.env.AI_CONCURRENCY ?? 2)
            : Number(process.env.SELFTEST_CONCURRENCY ?? 1),
      },
    ),
);
workers.push(
  new Worker(
    `${process.env.QUEUE_NAMESPACE ?? 'tuheng'}-roster`,
    async (job) => executeRosterImport(job.data.batchId),
    { connection: redisOptions(), concurrency: 1 },
  ),
);
for (const w of workers)
  w.on('error', () => console.error(JSON.stringify({ event: 'worker-error', queue: w.name }))).on(
    'failed',
    (job) =>
      console.error(JSON.stringify({ event: 'job-retry-or-failed', runId: job?.data.runId })),
  );
let dispatching = false;
async function tick() {
  if (dispatching) return;
  dispatching = true;
  try {
    await recoverExpiredRuns();
    await reconcileQueuedRuns();
    await dispatchOutbox();
    await dispatchRosterImports();
    await purgeExpiredSecrets();
  } catch {
    console.error(JSON.stringify({ event: 'outbox-dispatch-failed', recoverable: true }));
  } finally {
    dispatching = false;
  }
}
await tick();
const timer = setInterval(tick, 3000);
console.log('TuHeng Worker ready: formal and selftest queues');
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, async () => {
    clearInterval(timer);
    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
    process.exit(0);
  });
