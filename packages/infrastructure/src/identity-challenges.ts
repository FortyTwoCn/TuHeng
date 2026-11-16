import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@tuheng/database';
import {
  AuthRealm,
  VerificationPurpose,
  normalizedEmail,
  type AuthRealm as Realm,
  type VerificationPurpose as Purpose,
} from '@tuheng/contracts';
import { ensure, type Actor } from '@tuheng/domain';
import { securityDigest, rateLimit } from './security-throttle';
import { equalDigest, requireRecentAuthentication } from './identity-security';
import { sendVerificationMail } from './email';

export async function requestVerification(input: {
  realm: Realm;
  purpose: Purpose;
  email: string;
  actor?: Actor;
  proof?: string;
  ipKey?: string;
}) {
  const realm = AuthRealm.parse(input.realm),
    purpose = VerificationPurpose.parse(input.purpose),
    email = normalizedEmail(input.email);
  ensure(
    await prisma.sMTPConfigurationVersion.findFirst({ where: { enabled: true } }),
    'SMTP_NOT_CONFIGURED',
    503,
  );
  await rateLimit(`mail-target:${realm}:${purpose}:${email}`, 1, 60000);
  await rateLimit(`mail-daily:${realm}:${email}`, 20, 86400000);
  await rateLimit(`mail-ip:${input.ipKey ?? 'unknown'}`, 300, 60000);
  await rateLimit('mail-platform', 2000, 60000);
  let account = input.actor
    ? await prisma.user.findUnique({ where: { id: input.actor.id } })
    : await prisma.user.findUnique({
        where: { realm_emailNormalized: { realm, emailNormalized: email } },
      });
  if (['BIND_EMAIL', 'CHANGE_EMAIL', 'SENSITIVE_REAUTH'].includes(purpose)) {
    ensure(input.actor && account?.realm === realm, 'UNAUTHENTICATED', 401);
    ensure(!account.mustChangePassword, 'PASSWORD_CHANGE_REQUIRED', 403);
    if (purpose !== 'BIND_EMAIL') await requireRecentAuthentication(input.actor, input.proof);
    if (purpose === 'BIND_EMAIL') ensure(!account.emailVerifiedAt, 'EMAIL_ALREADY_BOUND');
    if (purpose === 'SENSITIVE_REAUTH') ensure(account.emailNormalized === email, 'EMAIL_MISMATCH');
    const owner = await prisma.user.findUnique({
      where: { realm_emailNormalized: { realm, emailNormalized: email } },
    });
    ensure(!owner || owner.id === account.id, 'EMAIL_UNAVAILABLE');
  } else {
    ensure(!input.actor, 'INVALID_VERIFICATION_CONTEXT');
    if (!account?.emailVerifiedAt) account = null;
  }
  const id = randomUUID();
  // Uniform public response for unknown/disabled accounts; no email existence disclosure.
  if (
    !account?.active ||
    (account.schoolId &&
      !(await prisma.school.findUnique({ where: { id: account.schoolId } }))?.active)
  )
    return { challengeId: id, expiresInSeconds: 300, resendInSeconds: 60 };
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: account.id }, data: { lastLoginAt: account.lastLoginAt } });
    await tx.verificationChallenge.updateMany({
      where: { accountId: account.id, realm, purpose, consumedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.verificationChallenge.create({
      data: {
        id,
        realm,
        purpose,
        accountId: account.id,
        targetEmail: email,
        digest: securityDigest(`${id}:${realm}:${purpose}:${account.id}:${email}:${code}`),
        expiresAt: new Date(Date.now() + 300000),
      },
    });
  });
  await sendVerificationMail(id, code);
  return { challengeId: id, expiresInSeconds: 300, resendInSeconds: 60 };
}
export async function consumeVerification(input: {
  challengeId: string;
  realm: Realm;
  purpose: Purpose;
  code: string;
  accountId?: string;
  email?: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    // Lock only this challenge. A failed attempt must commit its counter; throw after transaction.
    await tx.$queryRaw`SELECT id FROM "VerificationChallenge" WHERE id = ${input.challengeId} FOR UPDATE`;
    const row = await tx.verificationChallenge.findUnique({ where: { id: input.challengeId } });
    if (
      !row ||
      row.realm !== input.realm ||
      row.purpose !== input.purpose ||
      row.revokedAt ||
      row.consumedAt ||
      row.expiresAt <= new Date() ||
      row.failures >= 5 ||
      (input.accountId && row.accountId !== input.accountId) ||
      (input.email && row.targetEmail !== normalizedEmail(input.email))
    )
      return null;
    const digest = securityDigest(
      `${row.id}:${row.realm}:${row.purpose}:${row.accountId}:${row.targetEmail}:${input.code}`,
    );
    if (!/^\d{6}$/.test(input.code) || !equalDigest(row.digest, digest)) {
      await tx.verificationChallenge.update({
        where: { id: row.id },
        data: { failures: { increment: 1 } },
      });
      return null;
    }
    await tx.verificationChallenge.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return row;
  });
  ensure(result, 'INVALID_OR_EXPIRED_CODE', 400);
  return result;
}
