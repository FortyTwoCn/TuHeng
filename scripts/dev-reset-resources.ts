import 'dotenv/config';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { deleteObject, queueFor } from '@tuheng/infrastructure';
import { z } from 'zod';

const local = new Set(['localhost', '127.0.0.1', '[::1]']);
const db = new URL(process.env.DATABASE_URL ?? '');
const s3 = new URL(process.env.S3_ENDPOINT ?? 'https://s3.amazonaws.com');
const redis = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const schema = db.searchParams.get('schema') ?? 'public';
const bucket = process.env.S3_BUCKET ?? 'tuheng-private';
const ns = process.env.QUEUE_NAMESPACE ?? 'tuheng';
if (process.env.NODE_ENV === 'production' || !local.has(db.hostname))
  throw new Error('Development resource reset requires a non-production loopback database.');
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema) || !/^[\w.-]+$/.test(bucket) || !/^[\w.-]+$/.test(ns))
  throw new Error('Invalid reset target configuration.');

const target = `${db.host}${db.pathname}/${schema}|${s3.origin}/${bucket}/private/|${redis.host}${redis.pathname}:${ns}`;
const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm=' + target);
const journalName =
  '.runtime/dev-resource-reset/' + createHash('sha256').update(target).digest('hex') + '.json';
console.log(
  JSON.stringify({
    target,
    database: db.pathname.slice(1),
    schema,
    bucket,
    prefix: 'private/ (only exact keys associated with reset records)',
    queueNamespace: ns,
    apply,
  }),
);
if (apply && !confirmed)
  throw new Error('Pass --confirm with the exact target printed by the dry run.');

const job = z.object({ id: z.string().min(1), lane: z.enum(['formal', 'selftest']) });
const journalSchema = z.object({
  target: z.literal(target),
  keys: z.string().startsWith('private/').array(),
  jobs: job.array(),
});
type Journal = z.infer<typeof journalSchema>;
async function readJournal(): Promise<Journal> {
  try {
    return journalSchema.parse(JSON.parse(await readFile(journalName, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { target, keys: [], jobs: [] };
  }
}
function isOldKey(key: string, ownerId: string) {
  const prefix = `private/${ownerId}/`;
  const suffix = key.slice(prefix.length);
  return (
    key.startsWith(prefix) &&
    /^(?:processed\/[^/]+\/)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(suffix)
  );
}
async function queueJobs(jobs: Journal['jobs'], remove: boolean) {
  for (const lane of ['formal', 'selftest'] as const) {
    const ids = jobs.filter((row) => row.lane === lane).map((row) => row.id);
    if (!ids.length) continue;
    const queue = queueFor(lane);
    try {
      for (const id of ids) {
        const row = await queue.getJob(id);
        if (!row) continue;
        if ((await row.getState()) === 'active')
          throw new Error(
            'Affected grading jobs are active. Stop the development Worker before applying.',
          );
        if (remove) await row.remove();
      }
    } finally {
      await queue.close();
    }
  }
}

const client = new Client({ connectionString: db.href });
await client.connect();
try {
  await client.query('SELECT pg_advisory_lock(84262107)');
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await client.query(`SET LOCAL search_path TO "${schema}"`);
  const alreadyMigrated = (
    await client.query<{ present: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='StoredAsset' AND column_name='checksum') AS present`,
      [schema],
    )
  ).rows[0].present;
  const journal = await readJournal();
  if (!alreadyMigrated) {
    const assets = await client.query<{ ownerId: string; objectKey: string }>(
      'SELECT "ownerId", "objectKey" FROM "StoredAsset"',
    );
    if (assets.rows.some((a) => !isOldKey(a.objectKey, a.ownerId)))
      throw new Error(
        'The database contains keys outside the verified pre-cutover layout. No changes made.',
      );
    await client.query(
      await readFile(new URL('./dev-resource-cutover.sql', import.meta.url), 'utf8'),
    );
    const counts = (
      await client.query(`SELECT
      (SELECT count(*)::int FROM reset_assets) assets,
      (SELECT count(*)::int FROM reset_versions) "questionVersions",
      (SELECT count(*)::int FROM reset_assignments) assignments,
      (SELECT count(*)::int FROM reset_sets) "selfTestSets",
      (SELECT count(*)::int FROM reset_submissions) submissions,
      (SELECT count(*)::int FROM "Submission" WHERE "draftAssetIds" && (SELECT ARRAY(SELECT id FROM reset_assets))) "affectedDrafts",
      (SELECT count(*)::int FROM reset_attempts) attempts,
      (SELECT count(*)::int FROM reset_runs) "gradingRuns",
      (SELECT count(*)::int FROM "GradeDecision" WHERE "attemptId" IN (SELECT id FROM reset_attempts)) "gradeDecisions",
      (SELECT count(*)::int FROM "Appeal" WHERE "attemptId" IN (SELECT id FROM reset_attempts)) appeals,
      (SELECT count(*)::int FROM "UserNotification") notifications`)
    ).rows[0];
    console.log(JSON.stringify({ changes: counts }));
    const jobs = job.array().parse((await client.query('SELECT id, lane FROM reset_runs')).rows);
    if (apply) {
      await queueJobs(jobs, false);
      journal.keys = [...new Set([...journal.keys, ...assets.rows.map((row) => row.objectKey)])];
      journal.jobs = [
        ...new Map(
          [...journal.jobs, ...jobs].map((row) => [`${row.lane}:${row.id}`, row]),
        ).values(),
      ];
      await mkdir('.runtime/dev-resource-reset', { recursive: true });
      const pendingJournal = journalName + '.' + crypto.randomUUID();
      await writeFile(pendingJournal, JSON.stringify(journal), { mode: 0o600, flag: 'wx' });
      await rename(pendingJournal, journalName);
      await client.query(
        await readFile(new URL('./dev-resource-delete.sql', import.meta.url), 'utf8'),
      );
    }
  } else {
    console.log(
      JSON.stringify({
        alreadyMigrated,
        pendingObjectCleanup: journal.keys.length,
        pendingQueueCleanup: journal.jobs.length,
      }),
    );
  }
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  if (apply) {
    for (const key of journal.keys) {
      const referenced = await client.query(
        `SELECT 1 FROM "${schema}"."StoredAsset" WHERE "objectKey"=$1`,
        [key],
      );
      if (!referenced.rowCount) await deleteObject(key);
    }
    const deletable = [];
    for (const row of journal.jobs) {
      const referenced = await client.query(`SELECT 1 FROM "${schema}"."GradingRun" WHERE id=$1`, [
        row.id,
      ]);
      if (!referenced.rowCount) deletable.push(row);
    }
    await queueJobs(deletable, true);
    await rm(journalName, { force: true });
    console.log(
      'Development cutover cleanup completed. Run db:migrate and restart Web and Worker.',
    );
  }
} finally {
  await client.end();
}
