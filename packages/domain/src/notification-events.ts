import {
  defaultNotificationPreferences,
  NotificationCategory,
  NotificationPreferences,
  type NotificationKind,
  type NotificationResource,
} from '@tuheng/contracts';
import type { Actor, DataPort, Entities } from './entities';
import { audit, ensure } from './policy';

export const notificationCategories: Record<NotificationKind, NotificationCategory> = {
  ASSIGNMENT_PUBLISHED: 'ASSIGNMENT',
  ASSIGNMENT_ADDED: 'ASSIGNMENT',
  ASSIGNMENT_REMOVED: 'ASSIGNMENT',
  ASSIGNMENT_DUE: 'DEADLINE',
  GRADE_PUBLISHED: 'GRADE',
  GRADE_UPDATED: 'GRADE',
  APPEAL_OPENED: 'APPEAL',
  APPEAL_RESOLVED: 'APPEAL',
  ANNOUNCEMENT_PUBLISHED: 'ANNOUNCEMENT',
};

export function notificationPreferences(user: Pick<Entities['user'], 'notificationPreferences'>) {
  const parsed = NotificationPreferences.safeParse(user.notificationPreferences);
  return parsed.success ? parsed.data : defaultNotificationPreferences;
}

export function allowsTeachingMail(user: Entities['user'], category: NotificationCategory) {
  const prefs = notificationPreferences(user);
  return prefs.emailEnabled && prefs.categories[category];
}

export async function saveNotificationPreferences(db: DataPort, actor: Actor, input: unknown) {
  const preferences = NotificationPreferences.parse(input);
  return db.transaction(async (tx) => {
    const user = await tx.get('user', actor.id);
    ensure(
      user?.active &&
        !actor.onboarding &&
        (actor.tokenVersion === undefined || user.tokenVersion === actor.tokenVersion),
      'SESSION_REVOKED',
      401,
    );
    const consent = { ...user.notificationConsent };
    for (const category of NotificationCategory.options)
      if (
        allowsTeachingMail(user, category) !==
        (preferences.emailEnabled && preferences.categories[category])
      )
        consent[category] = (consent[category] ?? 0) + 1;
    await tx.update('user', user.id, {
      notificationPreferences: preferences,
      notificationConsent: consent,
    });
    await audit(tx, actor, 'NOTIFICATION_PREFERENCES_UPDATED', user.id);
    return preferences;
  });
}

type NotificationEvent = {
  kind: NotificationKind;
  eventKey: string;
  resourceType: NotificationResource;
  resourceId: string;
  title: string;
  summary: string;
  schoolId?: string | null;
  revision?: number;
  deadlineAt?: Date;
};

/** The writer's transaction includes the business event, receipts and SMTP work. */
export async function recordNotifications(
  tx: DataPort,
  userIds: Iterable<string>,
  event: NotificationEvent,
  now = new Date(),
) {
  const ids = [...new Set(userIds)].sort();
  if (!ids.length) return 0;
  // Assign sequence numbers only after serializing writers for each recipient.
  await tx.lockNotificationRecipients(ids);
  const existing = new Set(
    (
      await tx.list(
        'userNotification',
        { userId: { in: ids }, eventKey: event.eventKey },
        { take: ids.length },
      )
    ).map((row) => row.userId),
  );
  const users = await tx.list('user', { id: { in: ids }, active: true }, { take: ids.length });
  const category = notificationCategories[event.kind];
  const notices = [];
  const deliveries = [];
  for (const user of users) {
    if (existing.has(user.id)) continue;
    const id = crypto.randomUUID();
    notices.push({
      ...event,
      id,
      userId: user.id,
      category,
      createdAt: now,
      schoolId: event.schoolId ?? null,
    });
    if (user.emailVerifiedAt && user.emailNormalized && allowsTeachingMail(user, category))
      deliveries.push({
        notificationId: id,
        consentVersion: user.notificationConsent?.[category] ?? 0,
        expiresAt: event.deadlineAt ?? new Date(+now + 48 * 3600_000),
      });
  }
  await tx.createMany('userNotification', notices);
  await tx.createMany('notificationDelivery', deliveries);
  return notices.length;
}

export function assignmentNotice(
  assignment: Pick<Entities['assignment'], 'id' | 'schoolId' | 'title'>,
  kind: 'ASSIGNMENT_PUBLISHED' | 'ASSIGNMENT_ADDED' | 'ASSIGNMENT_REMOVED',
  revision: number,
): NotificationEvent {
  const titles = {
    ASSIGNMENT_PUBLISHED: '新作业已发布',
    ASSIGNMENT_ADDED: '你已加入作业名单',
    ASSIGNMENT_REMOVED: '你已移出作业名单',
  };
  return {
    kind,
    title: titles[kind],
    revision,
    eventKey: `assignment:${assignment.id}:${kind}:${revision}`,
    resourceType: 'ASSIGNMENT',
    resourceId: assignment.id,
    schoolId: assignment.schoolId,
    summary: kind === 'ASSIGNMENT_REMOVED' ? '这份作业已从你的作业列表移除。' : assignment.title,
  };
}

export function assignmentDeadlineNotice(
  assignment: Pick<Entities['assignment'], 'id' | 'schoolId' | 'title' | 'dueAt'>,
  missing: number,
): NotificationEvent {
  return {
    kind: 'ASSIGNMENT_DUE',
    title: '作业即将截止',
    eventKey: `deadline:${assignment.id}:${assignment.dueAt.toISOString()}`,
    resourceType: 'ASSIGNMENT',
    resourceId: assignment.id,
    schoolId: assignment.schoolId,
    deadlineAt: assignment.dueAt,
    summary: `${assignment.title} · 还有 ${missing} 题未提交。`,
  };
}
