import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '@tuheng/database';
import { DomainError, ensure } from '@tuheng/domain';

export interface EncryptedSecret {
  id: string;
  purpose: string;
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  suffix: string;
}
export function secretKeys() {
  try {
    const values: unknown = JSON.parse(process.env.TUHENG_SECRET_KEYS ?? '{}');
    ensure(
      values && typeof values === 'object' && !Array.isArray(values),
      'SECRET_KEY_UNAVAILABLE',
      503,
    );
    const keys: Record<string, Buffer> = {};
    for (const [id, value] of Object.entries(values)) {
      ensure(
        typeof value === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value),
        'SECRET_KEY_UNAVAILABLE',
        503,
      );
      const key = Buffer.from(value, 'base64');
      ensure(key.length === 32, 'SECRET_KEY_UNAVAILABLE', 503);
      keys[id] = key;
    }
    const active = process.env.TUHENG_SECRET_ACTIVE_KEY ?? '';
    ensure(keys[active], 'SECRET_KEY_UNAVAILABLE', 503);
    return { keys, active };
  } catch {
    throw new DomainError('SECRET_KEY_UNAVAILABLE', 503);
  }
}
export function encryptSecret(value: string, purpose: string, id = randomUUID()): EncryptedSecret {
  const { keys, active } = secretKeys();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys[active], nonce);
  cipher.setAAD(Buffer.from(`tuheng:v1:${id}:${purpose}`));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    id,
    purpose,
    keyId: active,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    suffix: purpose === 'TEMPORARY_PASSWORD' ? '' : value.slice(-4),
  };
}
export function decryptSecret(record: EncryptedSecret): string {
  try {
    const key = secretKeys().keys[record.keyId];
    ensure(key, 'SECRET_KEY_UNAVAILABLE', 503);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.nonce, 'base64'));
    decipher.setAAD(Buffer.from(`tuheng:v1:${record.id}:${record.purpose}`));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new DomainError('SECRET_UNREADABLE', 503);
  }
}
export async function storeSecret(value: string, purpose: string, expiresAt?: Date) {
  return prisma.secretRecord.create({ data: { ...encryptSecret(value, purpose), expiresAt } });
}
export async function readSecret(id: string, purpose: string) {
  const row = await prisma.secretRecord.findUnique({ where: { id } });
  ensure(
    row &&
      row.purpose === purpose &&
      !row.revokedAt &&
      (!row.expiresAt || row.expiresAt > new Date()),
    'SECRET_REVOKED_OR_EXPIRED',
    503,
  );
  return decryptSecret(row);
}
export async function revokeSecret(id: string) {
  await prisma.secretRecord.update({
    where: { id },
    data: { revokedAt: new Date(), ciphertext: '', tag: '', nonce: '' },
  });
}
export async function purgeExpiredSecrets() {
  return prisma.secretRecord.updateMany({
    where: { expiresAt: { lt: new Date() }, revokedAt: null },
    data: { revokedAt: new Date(), ciphertext: '', tag: '', nonce: '' },
  });
}
