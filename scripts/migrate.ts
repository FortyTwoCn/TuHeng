import 'dotenv/config';
import { Client } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('SELECT pg_advisory_lock(84262107)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS "_tuheng_migrations" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  for (const name of (await readdir('packages/database/prisma/migrations'))
    .filter((n) => /^\d/.test(n))
    .sort()) {
    const sql = await readFile(`packages/database/prisma/migrations/${name}/migration.sql`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const result = await client.query('SELECT checksum FROM "_tuheng_migrations" WHERE name=$1', [
      name,
    ]);
    if (result.rowCount) {
      if (result.rows[0].checksum !== checksum)
        throw new Error(`Migration checksum changed: ${name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO "_tuheng_migrations" (name, checksum) VALUES ($1,$2)', [
        name,
        checksum,
      ]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(84262107)');
  await client.end();
}
