import { Worker } from 'bullmq';
import {
  dispatchRosterImports,
  executeRosterImport,
} from '../../../packages/infrastructure/src/roster-import';
import { purgeExpiredSecrets } from '../../../packages/infrastructure/src/secret-store';
import { database, prisma } from '@tuheng/database';
import { scanAssignmentDeadlines } from '@tuheng/domain';
import {
  archivePendingAssets,
  cleanExpiredAssets,
} from '../../../packages/infrastructure/src/asset-maintenance';
import { dispatchNotificationMail } from '../../../packages/infrastructure/src/notification-delivery';
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
            ? Number(process.env.WORKER_FORMAL_CONCURRENCY ?? 4)
            : Number(process.env.WORKER_SELFTEST_CONCURRENCY ?? 2),
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
void tick();
const timer = setInterval(tick, 3000);
function periodic(label: string, work: () => Promise<unknown>, interval: number) {
  let pending: Promise<unknown> | undefined;
  function run() {
    if (pending) return;
    pending = work()
      .catch(() => {
        console.error(JSON.stringify({ event: label + '-failed', recoverable: true }));
      })
      .finally(() => {
        pending = undefined;
      });
  }
  run();
  const timer = setInterval(run, interval);
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
const stopBackground = [
  periodic('archive-assets', archivePendingAssets, 3000),
  periodic('clean-assets', cleanExpiredAssets, 60_000),
  periodic('deadline-scan', () => scanAssignmentDeadlines(database), 60_000),
  periodic('teaching-mail', dispatchNotificationMail, 5000),
];
console.log('TuHeng Worker ready: grading, roster, assets and notifications');
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, async () => {
    clearInterval(timer);
    await Promise.all([...workers.map((w) => w.close()), ...stopBackground.map((stop) => stop())]);
    await prisma.$disconnect();
    process.exit(0);
  });
