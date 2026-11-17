import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import { prisma } from '@tuheng/database';
import {
  ensure,
  initialCredentialIsAvailable,
  requireIdentityManager,
  requireSchoolScope,
  type Actor,
} from '@tuheng/domain';
import { AccountKind } from '@tuheng/contracts';
import { requireRecentAuthentication } from './identity-security';
import { securityDigest } from './security-throttle';
import { readSecret } from './secret-store';
import { requireManagedAccount } from './organization';
export async function listCredentialDeliveries(actor: Actor, schoolId: string, page = 0) {
  requireSchoolScope(actor, schoolId);
  requireIdentityManager(actor, schoolId, 'STUDENT');
  const allowedKinds =
    actor.kind === 'SITE_ADMIN'
      ? ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT']
      : actor.kind === 'SCHOOL_ADMIN'
        ? ['TEACHER', 'STUDENT']
        : ['STUDENT'];
  const where = { schoolId, ...(actor.kind === 'TEACHER' ? { creatorId: actor.id } : {}) };
  const [batches, total] = await Promise.all([
    prisma.credentialDeliveryBatch.findMany({
      where,
      include: { items: true },
      take: 10,
      skip: Math.max(0, page) * 10,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.credentialDeliveryBatch.count({ where }),
  ]);
  const allItems = batches.flatMap((b) => b.items);
  const [accounts, secrets] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { in: allItems.map((i) => i.accountId) },
        schoolId,
        ...(actor.kind === 'TEACHER'
          ? {
              enrollments: {
                some: {
                  teachingClass: {
                    schoolId,
                    archived: false,
                    grants: { some: { userId: actor.id } },
                  },
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        kind: true,
        active: true,
        mustChangePassword: true,
        credentialVersion: true,
        passwordExpiresAt: true,
      },
    }),
    prisma.secretRecord.findMany({
      where: { id: { in: allItems.map((i) => i.secretId) } },
      select: { id: true, purpose: true, revokedAt: true, expiresAt: true },
    }),
  ]);
  const byAccount = new Map(accounts.map((a) => [a.id, a])),
    bySecret = new Map(secrets.map((s) => [s.id, s])),
    now = new Date();
  return {
    page,
    total,
    items: batches.map((b) => ({
      id: b.id,
      createdAt: b.createdAt,
      expiresAt: b.expiresAt,
      expired: b.expiresAt <= now,
      kinds: allowedKinds.map((kind) => {
        const items = b.items.filter((i) => byAccount.get(i.accountId)?.kind === kind);
        const available = items.filter((i) =>
          initialCredentialIsAvailable(
            byAccount.get(i.accountId),
            i,
            bySecret.get(i.secretId),
            b.expiresAt,
            now,
          ),
        ).length;
        return { kind, total: items.length, available, unavailable: items.length - available };
      }),
    })),
  };
}
export async function requireCredentialBatch(actor: Actor, batchId: string) {
  const batch = await prisma.credentialDeliveryBatch.findUnique({ where: { id: batchId } });
  ensure(batch?.schoolId && batch.expiresAt > new Date(), 'CREDENTIAL_DELIVERY_EXPIRED', 410);
  requireSchoolScope(actor, batch.schoolId);
  ensure(
    actor.kind !== 'STUDENT' && (actor.kind !== 'TEACHER' || batch.creatorId === actor.id),
    'FORBIDDEN',
    403,
  );
  return batch;
}
export async function prepareCredentialDownload(
  actor: Actor,
  batchId: string,
  kind: 'TEACHER' | 'STUDENT' | 'SCHOOL_ADMIN',
  proof: string,
) {
  const batch = await requireCredentialBatch(actor, batchId);
  await requireRecentAuthentication(actor, proof);
  requireIdentityManager(actor, batch.schoolId!, kind);
  const token = randomBytes(32).toString('base64url');
  await prisma.credentialDownload.create({
    data: {
      id: securityDigest(token),
      batchId,
      actorId: actor.id,
      kind,
      expiresAt: new Date(Date.now() + 120000),
    },
  });
  return { token, expiresInSeconds: 120 };
}
export type SchoolCredentialCard = {
  school: string;
  name: string;
  loginId: string;
  password: string;
  expiresAt: string;
};
type CredentialFile = { bytes: Buffer; filename: string };
export function downloadCredentials(actor: Actor, token: string): Promise<CredentialFile>;
export function downloadCredentials(
  actor: Actor,
  token: string,
  format: 'card',
): Promise<SchoolCredentialCard>;
export async function downloadCredentials(
  actor: Actor,
  token: string,
  format: 'xlsx' | 'card' = 'xlsx',
): Promise<CredentialFile | SchoolCredentialCard> {
  const ticket = await prisma.$transaction(async (tx) => {
    const id = securityDigest(token);
    await tx.$queryRaw`SELECT id FROM "CredentialDownload" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.credentialDownload.findUnique({ where: { id } });
    ensure(
      row && row.actorId === actor.id && !row.consumedAt && row.expiresAt > new Date(),
      'DOWNLOAD_EXPIRED',
      410,
    );
    await tx.credentialDownload.update({ where: { id }, data: { consumedAt: new Date() } });
    return row;
  });
  ensure(format !== 'card' || ticket.kind === 'SCHOOL_ADMIN', 'CARD_KIND_FORBIDDEN', 403);
  const batch = await requireCredentialBatch(actor, ticket.batchId);
  requireIdentityManager(actor, batch.schoolId!, AccountKind.parse(ticket.kind));
  const school = await prisma.school.findUniqueOrThrow({ where: { id: batch.schoolId! } });
  const items = await prisma.credentialDeliveryItem.findMany({
    where: { batchId: batch.id },
  });
  const secrets = await prisma.secretRecord.findMany({
    where: { id: { in: items.map((i) => i.secretId) } },
    select: { id: true, purpose: true, revokedAt: true, expiresAt: true },
  });
  const bySecret = new Map(secrets.map((s) => [s.id, s]));
  const rows: string[][] = [];
  let unavailable = 0;
  for (const item of items) {
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: item.accountId },
      include: { enrollments: { include: { teachingClass: true } } },
    });
    if (u.kind !== ticket.kind) continue;
    if (!initialCredentialIsAvailable(u, item, bySecret.get(item.secretId), batch.expiresAt)) {
      unavailable++;
      continue;
    }
    await requireManagedAccount(actor, u.id);
    const password = await readSecret(item.secretId, 'TEMPORARY_PASSWORD');
    const classes = u.enrollments.map((e) => e.teachingClass.name).join('、');
    rows.push(
      ticket.kind === 'STUDENT'
        ? [
            school.name,
            school.code,
            classes,
            u.studentNumber!,
            u.name,
            password,
            u.passwordExpiresAt!.toISOString(),
            '首次登录必须改密；邮箱可选绑定',
          ]
        : [
            school.name,
            u.name,
            u.loginId!,
            password,
            u.passwordExpiresAt!.toISOString(),
            '首次登录必须改密并验证邮箱',
          ],
    );
  }
  ensure(rows.length, 'NO_AVAILABLE_INITIAL_CREDENTIALS', 410);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('初始凭据');
  const headers =
    ticket.kind === 'STUDENT'
      ? ['学校', '学校编号', '班级', '学号', '学生姓名', '临时密码', '密码有效期', '首次设置说明']
      : ['学校', '姓名', '登录 ID', '临时密码', '密码有效期', '首次设置说明'];
  sheet.addRow(['含敏感初始凭据，请安全交付。服务器过期无法撤回已下载的本地副本。']);
  sheet.addRow(headers);
  rows.forEach((r) => sheet.addRow(r));
  sheet.columns.forEach((c) => {
    c.width = 24;
    c.numFmt = '@';
  });
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: 'INITIAL_CREDENTIALS_DOWNLOADED',
      resourceId: batch.id,
      details: { kind: ticket.kind, available: rows.length, unavailable },
    },
  });
  if (format === 'card') {
    const [school, name, loginId, password, expiresAt] = rows[0];
    return { school, name, loginId, password, expiresAt };
  }
  return {
    bytes: Buffer.from(await workbook.xlsx.writeBuffer()),
    filename:
      ticket.kind === 'STUDENT'
        ? 'student-initial-credentials.xlsx'
        : ticket.kind === 'TEACHER'
          ? 'teacher-initial-credentials.xlsx'
          : 'school-administrator-credentials.xlsx',
  };
}
