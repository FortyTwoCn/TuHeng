import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { NewPassword, normalizedEmail } from '@tuheng/contracts';
import {
  accountRoles,
  needsOnboarding,
  requireIdentityManager,
  schoolAdministratorPolicy,
} from '@tuheng/domain';
import { encryptSecret, decryptSecret } from '../../packages/infrastructure/src/secret-store';
import { isPublicAddress } from '../../packages/infrastructure/src/outbound';
afterEach(() => vi.unstubAllEnvs());
describe('identity security contracts', () => {
  it.each([
    [0, false, false],
    [1, false, true],
    [2, true, true],
  ])('protects a school with %i enabled administrators', (count, canDisable, canEnableSchool) => {
    expect(schoolAdministratorPolicy(count as number)).toEqual({ canDisable, canEnableSchool });
  });
  it('normalizes case without merging plus aliases or dots', () => {
    expect(normalizedEmail(' A.B+tag@Example.com ')).toBe('a.b+tag@example.com');
  });
  it('rejects bcrypt truncation and permits input containing unicode within byte limit', () => {
    expect(NewPassword.safeParse('图'.repeat(25)).success).toBe(false);
    expect(NewPassword.safeParse('图'.repeat(12)).success).toBe(true);
  });
  it.each([
    { kind: 'SITE_ADMIN', realm: 'STAFF', emailRequired: false },
    { kind: 'SCHOOL_ADMIN', realm: 'STAFF', emailRequired: true },
    { kind: 'TEACHER', realm: 'STAFF', emailRequired: true },
    { kind: 'STUDENT', realm: 'STUDENT', emailRequired: false },
  ])('requires first password change for $kind; email requirement: $emailRequired', (account) => {
    expect(needsOnboarding({ ...account, mustChangePassword: true, emailVerifiedAt: null })).toBe(
      true,
    );
    expect(needsOnboarding({ ...account, mustChangePassword: false, emailVerifiedAt: null })).toBe(
      account.emailRequired,
    );
    expect(
      needsOnboarding({ ...account, mustChangePassword: false, emailVerifiedAt: new Date() }),
    ).toBe(false);
    expect(accountRoles('SCHOOL_ADMIN')).toEqual(['SCHOOL_ADMIN']);
  });
  it('separates organization administration from teaching permissions', () => {
    const school = {
      id: 's',
      name: 'school',
      roles: ['SCHOOL_ADMIN'] as const,
      kind: 'SCHOOL_ADMIN' as const,
      schoolId: 's1',
    };
    expect(() =>
      requireIdentityManager({ ...school, roles: [...school.roles] }, 's2', 'STUDENT'),
    ).toThrow('SCHOOL_FORBIDDEN');
    expect(() =>
      requireIdentityManager({ ...school, roles: [...school.roles] }, 's1', 'SITE_ADMIN'),
    ).toThrow('IDENTITY_FORBIDDEN');
  });
  it('authenticated encryption rejects swapped purpose, id, tamper and missing key', () => {
    vi.stubEnv('TUHENG_SECRET_KEYS', JSON.stringify({ test: randomBytes(32).toString('base64') }));
    vi.stubEnv('TUHENG_SECRET_ACTIVE_KEY', 'test');
    const a = encryptSecret('test-secret-do-not-log', 'SMTP'),
      b = encryptSecret('test-secret-do-not-log', 'SMTP');
    expect(a.nonce).not.toBe(b.nonce);
    expect(decryptSecret(a)).toBe('test-secret-do-not-log');
    expect(() => decryptSecret({ ...a, purpose: 'AI' })).toThrow('SECRET_UNREADABLE');
    expect(() => decryptSecret({ ...a, id: b.id })).toThrow('SECRET_UNREADABLE');
    expect(() => decryptSecret({ ...a, ciphertext: b.ciphertext })).toThrow('SECRET_UNREADABLE');
    vi.stubEnv('TUHENG_SECRET_KEYS', '{}');
    expect(() => encryptSecret('x', 'SMTP')).toThrow('SECRET_KEY_UNAVAILABLE');
  });
  it('blocks private, loopback, link-local and mapped addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '192.168.0.35',
      '169.254.169.254',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      '0.0.0.0',
    ])
      expect(isPublicAddress(address), address).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);
  });
});
