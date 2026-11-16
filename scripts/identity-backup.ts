import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const target = path.resolve('.runtime/identity-backup');
await mkdir(target, { recursive: true });
const url = new URL(process.env.DATABASE_URL!);
const file = path.join(target, `before-${Date.now()}.dump`);
const binary =
  process.platform === 'win32' ? 'D:\\Program Files\\PostgreSQL\\bin\\pg_dump.exe' : 'pg_dump';
const result = spawnSync(binary, ['--format=custom', '--file', file, '--no-owner', '--no-acl'], {
  env: {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1),
  },
  encoding: 'utf8',
  windowsHide: true,
});
if (result.status !== 0) throw new Error('DATABASE_BACKUP_FAILED');
console.log(`Database backup created: ${file}`);
