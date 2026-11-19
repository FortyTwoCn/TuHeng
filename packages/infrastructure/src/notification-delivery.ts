import type { Prisma } from '@prisma/client';
import { prisma, database } from '@tuheng/database';
import { AccountKind, AuthRealm, NotificationCategory } from '@tuheng/contracts';
import {
  accountRoles,
  allowsTeachingMail,
  DomainError,
  notificationDestination,
  type Actor,
} from '@tuheng/domain';
import { sendTeachingMail, TeachingMailError, type TeachingMail } from './email';

const ready = (now: Date): Prisma.NotificationDeliveryWhereInput => ({
  state: 'PENDING',
  nextAttemptAt: { lte: now },
  expiresAt: { gt: now },
});
const attemptLimit = 10;

export async function dispatchNotificationMail(limit = 8, notificationId?: string) {
  const now = new Date();
  const scope = notificationId ? { notificationId } : {};
  await prisma.notificationDelivery.updateMany({
    where: { ...scope, state: 'PROCESSING', leaseUntil: { lte: now }, sendingAt: { not: null } },
    data: {
      state: 'UNCERTAIN',
      finishedAt: now,
      errorCode: 'SMTP_SEND_STATUS_UNKNOWN',
      leaseUntil: null,
      leaseToken: null,
    },
  });
  await prisma.notificationDelivery.updateMany({
    where: { ...scope, state: 'PROCESSING', leaseUntil: { lte: now }, sendingAt: null },
    data: { state: 'PENDING', leaseUntil: null, leaseToken: null },
  });
  await prisma.notificationDelivery.updateMany({
    where: { ...scope, state: 'PENDING', expiresAt: { lte: now } },
    data: { state: 'SKIPPED', finishedAt: now, errorCode: 'DELIVERY_EXPIRED' },
  });
  const tasks = await prisma.notificationDelivery.findMany({
    where: { ...scope, ...ready(now) },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  for (const { id } of tasks) await deliver(id);
  return tasks.length;
}

async function deliver(id: string) {
  const now = new Date(),
    leaseToken = crypto.randomUUID();
  const claimed = await prisma.notificationDelivery.updateMany({
    where: { id, ...ready(now) },
    data: {
      state: 'PROCESSING',
      leaseUntil: new Date(+now + 600_000),
      leaseToken,
      attempts: { increment: 1 },
      sendingAt: null,
    },
  });
  if (!claimed.count) return;
  const task = await prisma.notificationDelivery.findUniqueOrThrow({
    where: { id },
    include: { notification: true },
  });
  const owned = { id, leaseToken, state: 'PROCESSING' };
  const finish = (data: Prisma.NotificationDeliveryUpdateManyMutationInput) =>
    prisma.notificationDelivery.updateMany({
      where: owned,
      data: { leaseUntil: null, leaseToken: null, ...data },
    });

  async function prepare(): Promise<TeachingMail | null> {
    const notice = task.notification;
    const currentTime = new Date();
    if (task.expiresAt <= currentTime) return null;
    return database.transaction(async (tx) => {
      await tx.lockNotificationRecipients([notice.userId]);
      const user = await tx.get('user', notice.userId);
      const category = NotificationCategory.parse(notice.category);
      if (
        !user?.active ||
        !user.emailVerifiedAt ||
        !user.emailNormalized ||
        !allowsTeachingMail(user, category) ||
        (user.notificationConsent?.[category] ?? 0) !== task.consentVersion
      )
        return null;
      const school = user.schoolId ? await tx.get('school', user.schoolId) : null;
      if (user.schoolId && !school?.active) return null;
      const kind = AccountKind.parse(user.kind);
      const actor: Actor = {
        id: user.id,
        name: user.name,
        kind,
        roles: accountRoles(kind),
        realm: AuthRealm.parse(user.realm),
        schoolId: user.schoolId,
      };
      const destination = await notificationDestination(tx, actor, notice, true, currentTime);
      if (!destination) return null;
      const area = {
        STUDENT: 'student',
        TEACHER: 'teacher',
        SCHOOL_ADMIN: 'school',
        SITE_ADMIN: 'admin',
      }[kind];
      return {
        to: user.emailNormalized,
        title: notice.title,
        summary: destination.summary ?? notice.summary,
        schoolName: school?.name,
        detailPath: destination.href,
        profilePath: `/${area}/profile#notification-settings`,
        createdAt: notice.createdAt,
        deadlineAt: notice.deadlineAt,
      };
    });
  }
  try {
    // Skip ineligible work even if SMTP is unavailable. Recheck after resolving its connection.
    if (!(await prepare())) {
      await finish({ state: 'SKIPPED', finishedAt: new Date(), errorCode: 'NOT_ELIGIBLE' });
      return;
    }
    const sent = await sendTeachingMail(id, async () => {
      const content = await prepare();
      if (!content) return null;
      const started = await prisma.notificationDelivery.updateMany({
        where: { ...owned, expiresAt: { gt: new Date() }, sendingAt: null },
        data: { sendingAt: new Date() },
      });
      return started.count ? content : null;
    });
    await finish({
      state: sent ? 'SUBMITTED_TO_SMTP' : 'SKIPPED',
      finishedAt: new Date(),
      errorCode: sent ? null : 'NOT_ELIGIBLE',
    });
  } catch (error) {
    const failure = error instanceof TeachingMailError ? error : null;
    // If a database failure followed sending, keep the in-flight marker so recovery records UNCERTAIN.
    if (!failure) {
      const state = await prisma.notificationDelivery.findUnique({
        where: { id },
        select: { sendingAt: true },
      });
      if (state?.sendingAt) return;
    }
    const code =
      failure?.code ?? (error instanceof DomainError ? error.code : 'SMTP_TEMPORARILY_UNAVAILABLE');
    const nextAttemptAt = new Date(
      Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(task.attempts - 1, 6)),
    );
    if (
      (!failure || failure.disposition === 'RETRY') &&
      task.attempts < attemptLimit &&
      nextAttemptAt < task.expiresAt
    )
      await finish({ state: 'PENDING', nextAttemptAt, sendingAt: null, errorCode: code });
    else
      await finish({
        state: failure?.disposition === 'UNCERTAIN' ? 'UNCERTAIN' : 'FAILED',
        finishedAt: new Date(),
        errorCode: code,
      });
  }
}
