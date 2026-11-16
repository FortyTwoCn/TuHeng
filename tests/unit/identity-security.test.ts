import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { NewPassword, normalizedEmail } from '@tuheng/contracts';
import { accountRoles, needsOnboarding, requireIdentityManager } from '@tuheng/domain';
import { encryptSecret, decryptSecret } from '../../packages/infrastructure/src/secret-store';
import { isPublicAddress } from '../../packages/infrastructure/src/outbound';
afterEach(() => vi.unstubAllEnvs());
describe('identity security contracts', () => {
  it('normalizes case without merging plus aliases or dots', () => {
    expect(normalizedEmail(' A.B+tag@Example.com ')).toBe('a.b+tag@example.com');
  });
  it('rejects bcrypt truncation and permits input containing unicode within byte limit', () => {
    expect(NewPassword.safeParse('图'.repeat(25)).success).toBe(false);
    expect(NewPassword.safeParse('图'.repeat(12)).success).toBe(true);
  });
  it('requires first change for every kind and verified email only in STAFF', () => {
    expect(
      needsOnboarding({ mustChangePassword: true, realm: 'STUDENT', emailVerifiedAt: null }),
    ).toBe(true);
    expect(
      needsOnboarding({ mustChangePassword: false, realm: 'STUDENT', emailVerifiedAt: null }),
    ).toBe(false);
    expect(
      needsOnboarding({ mustChangePassword: false, realm: 'STAFF', emailVerifiedAt: null }),
    ).toBe(true);
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
