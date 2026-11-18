import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, prisma } from '@tuheng/database';
import { readSiteSettings, saveSiteSettings, type Actor } from '@tuheng/domain';
import { loadIdentity } from '../../packages/infrastructure/src/identity-auth';

let admin: Actor;
let originalNumber: string;
beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
    throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: 'admin' } });
  admin = await loadIdentity(user.id, 'STAFF', user.tokenVersion, false);
  originalNumber = (await readSiteSettings(database)).filingNumber;
});
afterAll(async () => {
  if (admin && originalNumber !== undefined) {
    const current = await readSiteSettings(database);
    await saveSiteSettings(database, admin, {
      filingNumber: originalNumber,
      expectedVersion: current.version,
    });
  }
  await prisma.$disconnect();
});

describe.sequential('site settings use real persistence and versioned authorization', () => {
  it('saves trimmed text and clears it without deleting versions; returns public fields only', async () => {
    const initial = await readSiteSettings(database);
    const saved = await saveSiteSettings(database, admin, {
      filingNumber: '  测试备案号 20261118-1  ',
      expectedVersion: initial.version,
    });
    expect(saved).toEqual({ filingNumber: '测试备案号 20261118-1', version: initial.version + 1 });
    expect(await readSiteSettings(database)).toEqual(saved);
    const row = await prisma.siteConfigurationVersion.findUniqueOrThrow({
      where: { version: saved.version },
    });
    expect(
      await prisma.auditLog.findFirst({
        where: {
          action: 'SITE_SETTINGS_UPDATED',
          actorId: admin.id,
          resourceId: row.id,
        },
      }),
    ).not.toBeNull();
    const cleared = await saveSiteSettings(database, admin, {
      filingNumber: '   ',
      expectedVersion: saved.version,
    });
    expect(cleared.filingNumber).toBe('');
    expect(
      (await prisma.siteConfigurationVersion.findUniqueOrThrow({ where: { id: row.id } }))
        .filingNumber,
    ).toBe(saved.filingNumber);
  });

  it('rejects unauthorized identities and invalid input without writing a version', async () => {
    const before = await readSiteSettings(database);
    for (const forbidden of [
      { ...admin, kind: 'SCHOOL_ADMIN' as const },
      { ...admin, kind: 'TEACHER' as const },
      { ...admin, kind: 'STUDENT' as const, realm: 'STUDENT' as const },
      { ...admin, onboarding: true },
      { ...admin, realm: 'STUDENT' as const },
      { ...admin, kind: undefined, roles: ['PLATFORM_OPERATOR'] as Actor['roles'] },
    ]) {
      await expect(
        saveSiteSettings(database, forbidden, {
          filingNumber: 'unauthorized',
          expectedVersion: before.version,
        }),
      ).rejects.toThrow('FORBIDDEN');
    }
    for (const filingNumber of ['x'.repeat(121), 'first\nsecond', 123, null]) {
      await expect(
        saveSiteSettings(database, admin, { filingNumber, expectedVersion: before.version }),
      ).rejects.toThrow();
    }
    expect(await readSiteSettings(database)).toEqual(before);
  });

  it('concurrent editors cannot overwrite each other or leave an extra audit event', async () => {
    const before = await readSiteSettings(database);
    const results = await Promise.allSettled(
      ['测试备案号 A', '测试备案号 B'].map((filingNumber) =>
        saveSiteSettings(database, admin, { filingNumber, expectedVersion: before.version }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason.code).toBe('CONFIGURATION_CHANGED');
    const current = await readSiteSettings(database);
    expect(current.version).toBe(before.version + 1);
    await expect(
      saveSiteSettings(database, admin, {
        filingNumber: 'stale',
        expectedVersion: before.version,
      }),
    ).rejects.toThrow('CONFIGURATION_CHANGED');
    expect(await readSiteSettings(database)).toEqual(current);
  });
});
