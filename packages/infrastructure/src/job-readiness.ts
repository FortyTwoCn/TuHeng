import { AISnapshot } from '@tuheng/contracts';
import type { DataPort } from '@tuheng/domain';
import { prisma } from '@tuheng/database';

/** Metadata-only preflight. Gateway still verifies credentials and budgets at execution. */
export async function jobSnapshotError(
  db: DataPort,
  value: unknown,
  ownerId: string,
  schoolId: string | null,
) {
  const parsed = AISnapshot.safeParse(value);
  if (!parsed.success) return 'AI_SNAPSHOT_REQUIRED';
  const snapshot = parsed.data;
  const [provider, model, secret, owner, school] = await Promise.all([
    db.get('aIProvider', snapshot.providerId),
    db.get('aIModel', snapshot.modelId),
    prisma.secretRecord.findUnique({
      where: { id: snapshot.secretId },
      select: { purpose: true, revokedAt: true, expiresAt: true },
    }),
    db.get('user', ownerId),
    schoolId ? db.get('school', schoolId) : null,
  ]);
  if (!provider?.enabled || provider.archived) return 'AI_PROVIDER_DISABLED';
  if (!model?.enabled || model.archived || model.providerId !== provider.id)
    return 'AI_MODEL_DISABLED';
  if (!owner?.active || (schoolId && (!school?.active || owner.schoolId !== schoolId)))
    return 'AI_SCOPE_DISABLED';
  if (
    !secret ||
    secret.revokedAt ||
    (secret.expiresAt && secret.expiresAt <= new Date()) ||
    secret.purpose !== 'AI_API_KEY'
  )
    return 'AI_CREDENTIAL_UNAVAILABLE';
  return null;
}
