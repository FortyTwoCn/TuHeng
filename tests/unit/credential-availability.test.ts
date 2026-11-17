import { expect, it } from 'vitest';
import { initialCredentialIsAvailable } from '@tuheng/domain';

const now = new Date('2026-01-01T00:00:00Z'),
  later = new Date('2026-01-02T00:00:00Z');
const account = {
  active: true,
  mustChangePassword: true,
  credentialVersion: 2,
  passwordExpiresAt: later,
};
const item = { credentialVersion: 2, expiresAt: later };
const secret = { purpose: 'TEMPORARY_PASSWORD', revokedAt: null, expiresAt: later };

it('only offers the still-current initial credential within every validity window', () => {
  expect(initialCredentialIsAvailable(account, item, secret, later, now)).toBe(true);
  for (const change of [
    { active: false },
    { mustChangePassword: false },
    { credentialVersion: 3 },
    { passwordExpiresAt: now },
    { passwordExpiresAt: null },
  ]) {
    expect(initialCredentialIsAvailable({ ...account, ...change }, item, secret, later, now)).toBe(
      false,
    );
  }
  expect(
    initialCredentialIsAvailable(account, item, { ...secret, revokedAt: now }, later, now),
  ).toBe(false);
  expect(
    initialCredentialIsAvailable(account, item, { ...secret, expiresAt: now }, later, now),
  ).toBe(false);
  expect(
    initialCredentialIsAvailable(account, { ...item, expiresAt: now }, secret, later, now),
  ).toBe(false);
  expect(initialCredentialIsAvailable(account, item, secret, now, now)).toBe(false);
  expect(initialCredentialIsAvailable(account, item, undefined, later, now)).toBe(false);
  expect(initialCredentialIsAvailable(undefined, item, secret, later, now)).toBe(false);
});
