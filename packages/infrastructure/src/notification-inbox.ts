import { database, prisma } from '@tuheng/database';
import { NotificationCategory, type NotificationPage } from '@tuheng/contracts';
import { notificationDestination, type Actor } from '@tuheng/domain';

export async function notificationPage(
  actor: Actor,
  filters: {
    unread?: boolean;
    category?: NotificationCategory;
    before?: number;
    pageSize?: number;
  },
): Promise<NotificationPage> {
  const take = filters.pageSize ?? 25;
  const userId = actor.id;
  const [rows, unreadCount, latest] = await prisma.$transaction(
    [
      prisma.userNotification.findMany({
        where: {
          userId,
          ...(filters.unread ? { readAt: null } : {}),
          category: filters.category,
          sequence: filters.before ? { lt: filters.before } : undefined,
        },
        orderBy: { sequence: 'desc' },
        take: take + 1,
      }),
      prisma.userNotification.count({ where: { userId, readAt: null } }),
      prisma.userNotification.findFirst({
        where: { userId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      }),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  const items = await Promise.all(
    rows.slice(0, take).map(async (row) => {
      const destination = await notificationDestination(database, actor, row);
      return {
        id: row.id,
        category: NotificationCategory.parse(row.category),
        title: destination ? row.title : '这条通知的内容已不可访问',
        summary: destination ? row.summary : '相关内容可能已撤销，或访问权限已变更。',
        href: destination?.href ?? null,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    }),
  );
  return {
    items,
    unreadCount,
    readThrough: String(latest?.sequence ?? 0),
    nextCursor: rows.length > take ? String(rows[take - 1].sequence) : null,
  };
}
export async function markNotificationsRead(
  actor: Actor,
  selection: { ids: string[] } | { through: number },
) {
  const userId = actor.id;
  const eligible =
    'ids' in selection ? { id: { in: selection.ids } } : { sequence: { lte: selection.through } };
  const updated = await prisma.userNotification.updateMany({
    where: { ...eligible, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return {
    count: updated.count,
    unreadCount: await prisma.userNotification.count({ where: { userId, readAt: null } }),
  };
}
