import { prisma, database } from '@tuheng/database';
import { AccountKind, AuthRealm, type NotificationPreferences } from '@tuheng/contracts';
import { notificationPreferences, type Actor } from '@tuheng/domain';

export type OwnProfile = {
  name: string;
  kind: ReturnType<typeof AccountKind.parse>;
  realm: ReturnType<typeof AuthRealm.parse>;
  school: string | null;
  loginId: string | null;
  studentNumber: string | null;
  emailHint: string | null;
  emailVerified: boolean;
  smtpConfigured: boolean;
  avatarAssetId: string | null;
  avatarRevision: number;
  preferences: NotificationPreferences;
};
export async function ownProfile(actor: Actor): Promise<OwnProfile> {
  const [user, smtp, preferences] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: {
        name: true,
        kind: true,
        realm: true,
        loginId: true,
        studentNumber: true,
        emailNormalized: true,
        emailVerifiedAt: true,
        avatarAssetId: true,
        avatarRevision: true,
        school: { select: { name: true } },
      },
    }),
    prisma.sMTPConfigurationVersion.count({ where: { enabled: true } }),
    database.get('user', actor.id).then((row) => notificationPreferences(row ?? {})),
  ]);
  return {
    name: user.name,
    kind: AccountKind.parse(user.kind),
    realm: AuthRealm.parse(user.realm),
    school: user.school?.name ?? null,
    loginId: user.loginId,
    studentNumber: user.studentNumber,
    emailHint: user.emailNormalized?.replace(/^(.).*(@.+)$/, '$1***$2') ?? null,
    emailVerified: !!user.emailVerifiedAt,
    smtpConfigured: smtp > 0,
    avatarAssetId: user.avatarAssetId,
    avatarRevision: user.avatarRevision,
    preferences,
  };
}
