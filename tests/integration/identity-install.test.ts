import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

it('ID01/ID02: CLI install is unique; optional root email migration preserves credentials and first-password restrictions', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!url.pathname.endsWith('_test')) throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
  const schema = 'identity_install_test_' + randomUUID().replaceAll('-', '');
  url.searchParams.delete('options');
  url.searchParams.delete('schema');
  const db = new Client({ connectionString: url.href });
  await db.connect();
  try {
    await db.query('CREATE SCHEMA "' + schema + '"');
    await db.query('SET search_path TO "' + schema + '"');
    url.searchParams.set('options', '-c search_path=' + schema);
    url.searchParams.set('schema', schema);
    const env = { ...process.env, DATABASE_URL: url.href };
    const run = (file: string, args: string[]) =>
      spawnSync(process.execPath, ['--import', 'tsx', file, ...args], {
        env,
        encoding: 'utf8',
        windowsHide: true,
      });
    const migrated = run('scripts/migrate.ts', []);
    expect(migrated.status, migrated.stderr).toBe(0);
    const installed = run('scripts/identity-bootstrap.ts', [
      '--output',
      '.runtime/' + schema + '.txt',
    ]);
    expect(installed.status, installed.stderr).toBe(0);
    const read = async () => (await db.query('SELECT * FROM "User"')).rows;
    const before = await read();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      loginId: 'admin',
      kind: 'SITE_ADMIN',
      realm: 'STAFF',
      mustChangePassword: true,
      installationComplete: false,
      emailVerifiedAt: null,
    });
    const repeated = run('scripts/identity-bootstrap.ts', [
      '--output',
      '.runtime/' + schema + '-second.txt',
    ]);
    expect(repeated.status).not.toBe(0);
    expect(repeated.stderr).toContain('ROOT_ALREADY_EXISTS');
    expect(await read()).toEqual(before);
    const emailMigration = await readFile(
      'packages/database/prisma/migrations/2026111701_admin_optional_email/migration.sql',
      'utf8',
    );
    await db.query(emailMigration);
    expect(await read()).toEqual(before); // An unchanged initial password still restricts setup.
    await db.query('UPDATE "User" SET "mustChangePassword"=false');
    const changedPassword = (await read())[0];
    await db.query(emailMigration);
    expect((await read())[0]).toEqual({ ...changedPassword, installationComplete: true });
    await db.query(emailMigration);
    expect((await read())[0]).toEqual({ ...changedPassword, installationComplete: true });
    await expect(
      db.query(
        'INSERT INTO "User" (id,name,email,"passwordHash",roles,kind,realm,"loginId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        ['second-root', 'duplicate', '', 'invalid', ['ADMIN'], 'SITE_ADMIN', 'STAFF', 'admin'],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await db.query(
      'UPDATE "User" SET "emailNormalized"=$1,"emailVerifiedAt"=now(),"installationComplete"=true,"mustChangePassword"=false',
      ['lost@test.invalid'],
    );
    const reset = run('scripts/identity-bootstrap.ts', [
      '--reset-root',
      '--recover-mailbox',
      '--output',
      '.runtime/' + schema + '-recovery.txt',
    ]);
    expect(reset.status, reset.stderr).toBe(0);
    const recovered = (await read())[0];
    expect(recovered.id).toBe(before[0].id);
    expect(recovered).toMatchObject({
      emailNormalized: null,
      emailVerifiedAt: null,
      mustChangePassword: true,
      installationComplete: false,
      tokenVersion: before[0].tokenVersion + 1,
    });
    expect(recovered.passwordHash).not.toBe(before[0].passwordHash);
    expect(
      (
        await db.query('SELECT count(*)::int n FROM "AuditLog" WHERE action=$1', [
          'ROOT_CLI_MAILBOX_RECOVERY',
        ])
      ).rows[0].n,
    ).toBe(1);
    // Keep the isolated schema as a drill artifact; no production or historical table is reset.
  } finally {
    await db.end();
  }
}, 60000);
