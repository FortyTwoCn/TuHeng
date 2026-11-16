import { randomBytes, timingSafeEqual } from 'node:crypto';
import { compare } from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '@tuheng/database';
import { ensure, type Actor } from '@tuheng/domain';
import { securityDigest, rateLimit } from './security-throttle';

export const temporaryPassword = () => randomBytes(15).toString('base64url');
export const equalDigest = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function reauthenticate(actor: Actor, password: string) {
  await rateLimit(`reauth:${actor.id}`, 8, 5 * 60000);
  const account = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  ensure(account.active && (await compare(password, account.passwordHash)), 'REAUTH_FAILED', 403);
  const proof = randomBytes(32).toString('base64url');
  await prisma.reauthentication.create({
    data: {
      id: securityDigest(proof),
      accountId: actor.id,
      realm: account.realm,
      tokenVersion: account.tokenVersion,
      expiresAt: new Date(Date.now() + 10 * 60000),
    },
  });
  return { proof, expiresInSeconds: 600 };
}
export async function requireRecentAuthentication(actor: Actor, proof?: string) {
  const row = proof
    ? await prisma.reauthentication.findUnique({ where: { id: securityDigest(proof) } })
    : null;
  const account = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  ensure(
    row &&
      row.accountId === actor.id &&
      row.realm === account.realm &&
      row.tokenVersion === account.tokenVersion &&
      row.expiresAt > new Date(),
    'RECENT_AUTH_REQUIRED',
    403,
  );
}
export async function invalidateCredentials(tx: Prisma.TransactionClient, accountId: string) {
  const items = await tx.credentialDeliveryItem.findMany({
    where: { accountId },
    select: { secretId: true },
  });
  await tx.secretRecord.updateMany({
    where: { id: { in: items.map((i) => i.secretId) } },
    data: { revokedAt: new Date(), ciphertext: '', tag: '', nonce: '' },
  });
  await tx.verificationChallenge.updateMany({
    where: { accountId, consumedAt: null },
    data: { revokedAt: new Date() },
  });
  await tx.reauthentication.deleteMany({ where: { accountId } });
}
