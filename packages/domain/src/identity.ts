import type { AccountKind, AuthRealm } from '@tuheng/contracts';
import type { Actor } from './entities';
import { ensure } from './policy';

export const realmForKind = (kind: AccountKind): AuthRealm =>
  kind === 'STUDENT' ? 'STUDENT' : 'STAFF';
export function accountRoles(kind: AccountKind) {
  return [kind === 'SITE_ADMIN' ? 'ADMIN' : kind] as Actor['roles'];
}
export function requiresVerifiedEmail(account: { kind: string; realm: string }) {
  return account.realm === 'STAFF' && account.kind !== 'SITE_ADMIN';
}
export function needsOnboarding(account: {
  kind: string;
  mustChangePassword: boolean;
  realm: string;
  emailVerifiedAt: Date | null;
}) {
  return account.mustChangePassword || (requiresVerifiedEmail(account) && !account.emailVerifiedAt);
}
export function requireSchoolScope(actor: Actor, schoolId: string) {
  ensure(!actor.onboarding, 'ONBOARDING_REQUIRED', 403);
  ensure(
    actor.kind === 'SITE_ADMIN' || (!!schoolId && actor.schoolId === schoolId),
    'SCHOOL_FORBIDDEN',
    403,
  );
}
export function requireIdentityManager(actor: Actor, schoolId: string, target: AccountKind) {
  requireSchoolScope(actor, schoolId);
  const allowed =
    actor.kind === 'SITE_ADMIN' ||
    (actor.kind === 'SCHOOL_ADMIN' && ['TEACHER', 'STUDENT'].includes(target)) ||
    (actor.kind === 'TEACHER' && target === 'STUDENT');
  ensure(allowed && target !== 'SITE_ADMIN', 'IDENTITY_FORBIDDEN', 403);
}
/** The same account state gates delivery metadata and the sensitive download. */
export function initialCredentialIsAvailable(
  account:
    | {
        active: boolean;
        mustChangePassword: boolean;
        credentialVersion: number;
        passwordExpiresAt: Date | null;
      }
    | undefined,
  item: { credentialVersion: number; expiresAt: Date },
  secret: { purpose: string; revokedAt: Date | null; expiresAt: Date | null } | undefined,
  batchExpiresAt: Date,
  now = new Date(),
) {
  return (
    !!account &&
    !!secret &&
    account.active &&
    account.mustChangePassword &&
    account.credentialVersion === item.credentialVersion &&
    !!account.passwordExpiresAt &&
    account.passwordExpiresAt > now &&
    item.expiresAt > now &&
    batchExpiresAt > now &&
    secret.purpose === 'TEMPORARY_PASSWORD' &&
    !secret.revokedAt &&
    (!secret.expiresAt || secret.expiresAt > now)
  );
}
export function requireSMTPManager(actor: Actor) {
  ensure(actor.kind === 'SITE_ADMIN' && !actor.onboarding, 'FORBIDDEN', 403);
}
