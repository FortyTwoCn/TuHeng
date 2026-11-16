import 'dotenv/config';
import { Client } from 'pg';

// Read-only preflight: output counts and ambiguous IDs, never emails, hashes or credentials.
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const roles = await client.query('SELECT roles, count(*)::int AS count FROM "User" GROUP BY roles');
  const conflicts = await client.query('SELECT id, roles FROM "User" WHERE cardinality(roles) <> 1');
  const duplicateEmails = await client.query('SELECT count(*)::int AS count FROM (SELECT lower(trim(email)) FROM "User" GROUP BY lower(trim(email)) HAVING count(*) > 1) d');
  const counts: Record<string, number> = {};
  for (const table of ['User', 'TeachingClass', 'Enrollment', 'TeachingGrant', 'Assignment', 'SubmissionAttempt', 'StoredAsset', 'GradeDecision', 'GradingRun', 'SelfTestSet', 'ErrorBookEntry']) {
    counts[table] = Number((await client.query(`SELECT count(*) FROM "${table}"`)).rows[0].count);
  }
  const jobs = await client.query('SELECT status, count(*)::int AS count FROM "GradingRun" GROUP BY status');
  console.log(JSON.stringify({ mode: 'READ_ONLY', counts, roles: roles.rows, ambiguousAccounts: conflicts.rows, duplicateNormalizedEmails: duplicateEmails.rows[0].count, jobs: jobs.rows, schoolMapping: 'Explicit mapping required before cutover; no global demo-school inference.', legacyEmail: 'Not verified by migration.', secrets: 'Not inspected or emitted.' }, null, 2));
  await client.query('COMMIT');
} finally {
  await client.end();
}
