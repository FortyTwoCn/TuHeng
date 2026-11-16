import 'dotenv/config';
import { readFile, appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
import { prisma } from '@tuheng/database';
import {
  encryptSecret,
  decryptSecret,
  secretKeys,
} from '../packages/infrastructure/src/secret-store';
if (!process.argv.includes('--initialize') && !process.argv.includes('--rotate'))
  throw new Error(
    'Use --initialize or --rotate. Keys are written only to the ignored local deployment .env.',
  );
const file = '.env',
  env = parse(await readFile(file));
const existing = env.TUHENG_SECRET_KEYS
  ? (JSON.parse(env.TUHENG_SECRET_KEYS) as Record<string, string>)
  : {};
if (Object.keys(existing).length && process.argv.includes('--initialize')) {
  console.log('SecretStore already configured; no key replaced.');
} else {
  const keyId = 'local-' + Date.now(),
    key = randomBytes(32).toString('base64'),
    keys = { ...existing, [keyId]: key };
  await appendFile(
    file,
    `\n# SecretStore deployment master keys; keep separately from database backups.\nTUHENG_SECRET_KEYS='${JSON.stringify(keys)}'\nTUHENG_SECRET_ACTIVE_KEY=${keyId}\n`,
  );
  process.env.TUHENG_SECRET_KEYS = JSON.stringify(keys);
  process.env.TUHENG_SECRET_ACTIVE_KEY = keyId;
  secretKeys();
  let count = 0;
  if (process.argv.includes('--rotate'))
    for (const row of await prisma.secretRecord.findMany({ where: { revokedAt: null } })) {
      if (row.expiresAt && row.expiresAt <= new Date()) continue;
      const encrypted = encryptSecret(decryptSecret(row), row.purpose, row.id);
      const { id, ...data } = encrypted;
      await prisma.secretRecord.update({ where: { id }, data });
      count++;
    }
  console.log(
    JSON.stringify({
      status: 'CONFIGURED',
      rewrappedSecrets: count,
      oldKeysRetainedForBackupRecovery: true,
    }),
  );
}
await prisma.$disconnect();
