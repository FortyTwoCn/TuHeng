import { compare, hash } from 'bcryptjs';
import { prisma } from '@tuheng/database';
import {
  LoginInput,
  NewPassword,
  AccountKind,
  AuthRealm,
  normalizedEmail,
} from '@tuheng/contracts';
import { accountRoles, ensure, needsOnboarding, type Actor } from '@tuheng/domain';
import { consumeVerification } from './identity-challenges';
import { invalidateCredentials } from './identity-security';
import { sendSecurityNotice } from './email';
import { rateLimit } from './security-throttle';

export async function authenticate(input: unknown, context?: { ipKey: string }) {
  const parsed = LoginInput.safeParse(input);
  if (!parsed.success) return null;
  const value = parsed.data;
  await rateLimit(`login-network:${value.realm}:${context?.ipKey ?? 'unknown'}`, 600, 60000);
  await rateLimit('login-platform', 3000, 60000);
  await rateLimit(
    `login:${value.realm}:${value.schoolId ?? ''}:${value.identifier.toLowerCase()}`,
    20,
    15 * 60000,
  );
  const email = value.identifier.includes('@');
  const account = email
    ? await prisma.user.findUnique({
        where: {
          realm_emailNormalized: {
            realm: value.realm,
            emailNormalized: normalizedEmail(value.identifier),
          },
        },
      })
    : value.realm === 'STAFF'
      ? await prisma.user.findFirst({
          where: { realm: 'STAFF', loginId: { equals: value.identifier, mode: 'insensitive' } },
        })
      : value.schoolId
        ? await prisma.user.findUnique({
            where: {
              schoolId_studentNumber: { schoolId: value.schoolId, studentNumber: value.identifier },
            },
          })
        : null;
  const school = account?.schoolId
    ? await prisma.school.findUnique({ where: { id: account.schoolId } })
    : null;
  let valid = false;
  if (value.method === 'PASSWORD') {
    valid = await compare(
      value.password ?? '',
      account?.passwordHash ?? '$2b$12$W8X7WOfB8gHxYRxQbGy.rOIJfbdU72u2H0vghdOsmQGykb00lVjKq',
    );
    if (account?.passwordExpiresAt && account.passwordExpiresAt <= new Date()) valid = false;
  } else if (email && account?.emailVerifiedAt && value.challengeId && value.code) {
    try {
      await consumeVerification({
        challengeId: value.challengeId,
        code: value.code,
        realm: value.realm,
        purpose: 'LOGIN',
        accountId: account.id,
        email: value.identifier,
      });
      valid = true;
    } catch {
      valid = false;
    }
  }
  if (
    !valid ||
    !account?.active ||
    account.realm !== value.realm ||
    (account.schoolId && !school?.active)
  )
    return null;
  await prisma.user.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  return {
    id: account.id,
    name: account.name,
    email: account.emailNormalized,
    realm: account.realm,
    tokenVersion: account.tokenVersion,
    onboarding: needsOnboarding(account),
  };
}
export async function loadIdentity(
  id: string,
  realm: string,
  tokenVersion: number,
  onboarding: boolean,
): Promise<Actor> {
  const u = await prisma.user.findUnique({ where: { id } });
  ensure(u?.active && u.realm === realm && u.tokenVersion === tokenVersion, 'SESSION_REVOKED', 401);
  if (u.schoolId)
    ensure(
      (await prisma.school.findUnique({ where: { id: u.schoolId } }))?.active,
      'SCHOOL_DISABLED',
      403,
    );
  const kind = AccountKind.parse(u.kind);
  return {
    id,
    name: u.name,
    kind,
    realm: AuthRealm.parse(realm),
    schoolId: u.schoolId,
    tokenVersion,
    roles: accountRoles(kind),
    onboarding: onboarding || needsOnboarding(u),
  };
}
export async function changeOwnPassword(actor: Actor, current: string, next: string) {
  NewPassword.parse(next);
  await rateLimit(`password:${actor.id}`, 8, 5 * 60000);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  ensure(user.active && user.tokenVersion === actor.tokenVersion, 'SESSION_REVOKED', 401);
  ensure(await compare(current, user.passwordHash), 'CURRENT_PASSWORD_INVALID');
  ensure(!(await compare(next, user.passwordHash)), 'PASSWORD_MUST_CHANGE');
  await prisma.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: { id: actor.id, tokenVersion: user.tokenVersion, active: true },
      data: {
        passwordHash: await hash(next, 12),
        mustChangePassword: false,
        passwordExpiresAt: null,
        tokenVersion: { increment: 1 },
        credentialVersion: { increment: 1 },
      },
    });
    ensure(changed.count === 1, 'SESSION_REVOKED', 401);
    await invalidateCredentials(tx, actor.id);
    await tx.auditLog.create({
      data: { actorId: actor.id, action: 'PASSWORD_CHANGED', resourceId: actor.id, details: {} },
    });
  });
  await sendSecurityNotice(user.id, user.emailNormalized, 'PASSWORD_CHANGED');
}
export async function bindVerifiedEmail(
  actor: Actor,
  input: { challengeId: string; code: string; purpose: 'BIND_EMAIL' | 'CHANGE_EMAIL' },
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  ensure(user.active && user.tokenVersion === actor.tokenVersion, 'SESSION_REVOKED', 401);
  ensure(!user.mustChangePassword, 'PASSWORD_CHANGE_REQUIRED');
  ensure(
    input.purpose === (user.emailVerifiedAt ? 'CHANGE_EMAIL' : 'BIND_EMAIL'),
    'INVALID_VERIFICATION_PURPOSE',
  );
  const challenge = await consumeVerification({
    ...input,
    realm: AuthRealm.parse(user.realm),
    accountId: user.id,
  });
  await prisma.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: { id: user.id, tokenVersion: challenge.tokenVersion, active: true },
      data: {
        email: challenge.targetEmail,
        emailNormalized: challenge.targetEmail,
        emailVerifiedAt: new Date(),
        tokenVersion: { increment: 1 },
        ...(user.kind === 'SITE_ADMIN' ? { installationComplete: true } : {}),
      },
    });
    ensure(changed.count === 1, 'SESSION_REVOKED', 401);
    await invalidateCredentials(tx, user.id);
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: input.purpose,
        resourceId: user.id,
        details: { hadPreviousEmail: !!user.emailVerifiedAt },
      },
    });
  });
  if (user.emailNormalized && user.emailNormalized !== challenge.targetEmail)
    await sendSecurityNotice(user.id, user.emailNormalized, 'EMAIL_CHANGED');
}
export async function recoverPassword(input: {
  realm: 'STAFF' | 'STUDENT';
  challengeId: string;
  code: string;
  password: string;
}) {
  NewPassword.parse(input.password);
  const challenge = await consumeVerification({ ...input, purpose: 'RESET_PASSWORD' });
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: challenge.accountId } });
    ensure(
      user.active && user.emailNormalized === challenge.targetEmail,
      'INVALID_OR_EXPIRED_CODE',
    );
    // Recovery never bypasses an unfinished first-password requirement.
    const changed = await tx.user.updateMany({
      where: { id: user.id, tokenVersion: challenge.tokenVersion, active: true },
      data: {
        passwordHash: await hash(input.password, 12),
        passwordExpiresAt: null,
        tokenVersion: { increment: 1 },
        credentialVersion: { increment: 1 },
      },
    });
    ensure(changed.count === 1, 'SESSION_REVOKED', 401);
    await invalidateCredentials(tx, user.id);
    await tx.auditLog.create({
      data: { actorId: user.id, action: 'PASSWORD_RECOVERED', resourceId: user.id, details: {} },
    });
  });
  await sendSecurityNotice(challenge.accountId, challenge.targetEmail, 'PASSWORD_RECOVERED');
}
