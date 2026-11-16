import type { AccountKind, AuthRealm } from '@tuheng/contracts';
import type { Actor } from './entities';
import { ensure } from './policy';

export const realmForKind = (kind: AccountKind): AuthRealm =>
  kind === 'STUDENT' ? 'STUDENT' : 'STAFF';
export function accountRoles(kind: AccountKind) {
  return [kind === 'SITE_ADMIN' ? 'ADMIN' : kind] as Actor['roles'];
}
export function needsOnboarding(account: {
  mustChangePassword: boolean;
  realm: string;
  emailVerifiedAt: Date | null;
}) {
  return account.mustChangePassword || (account.realm === 'STAFF' && !account.emailVerifiedAt);
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
export function requireSMTPManager(actor: Actor, bootstrap: boolean) {
  ensure(actor.kind === 'SITE_ADMIN' && (!actor.onboarding || bootstrap), 'FORBIDDEN', 403);
}
