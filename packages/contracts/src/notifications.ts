import { z } from 'zod';

export const NotificationCategory = z.enum([
  'ASSIGNMENT',
  'DEADLINE',
  'GRADE',
  'APPEAL',
  'ANNOUNCEMENT',
]);
export type NotificationCategory = z.infer<typeof NotificationCategory>;
export const NotificationPreferences = z.strictObject({
  emailEnabled: z.boolean(),
  categories: z.record(NotificationCategory, z.boolean()),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;
export const defaultNotificationPreferences: NotificationPreferences = {
  emailEnabled: false,
  categories: { ASSIGNMENT: true, DEADLINE: true, GRADE: true, APPEAL: true, ANNOUNCEMENT: true },
};
export const notificationCategoryLabels: Record<NotificationCategory, string> = {
  ASSIGNMENT: '作业发布和名单变化',
  DEADLINE: '临近截止',
  GRADE: '成绩发布和更新',
  APPEAL: '申诉',
  ANNOUNCEMENT: '公告',
};
export type NotificationKind =
  | 'ASSIGNMENT_PUBLISHED'
  | 'ASSIGNMENT_ADDED'
  | 'ASSIGNMENT_REMOVED'
  | 'ASSIGNMENT_DUE'
  | 'GRADE_PUBLISHED'
  | 'GRADE_UPDATED'
  | 'APPEAL_OPENED'
  | 'APPEAL_RESOLVED'
  | 'ANNOUNCEMENT_PUBLISHED';
export type NotificationResource = 'ASSIGNMENT' | 'GRADE_DECISION' | 'APPEAL' | 'ANNOUNCEMENT';
export type NotificationItem = {
  id: string;
  category: NotificationCategory;
  title: string;
  summary: string;
  createdAt: string;
  readAt: string | null;
  href: string | null;
};
export type NotificationPage = {
  items: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
  readThrough: string;
};

const ids = z.array(z.string().min(1).max(200)).max(500);
export const AnnouncementAudience = z.strictObject({
  scope: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('SCHOOL'), schoolId: z.string().min(1).max(200) }),
    z.strictObject({ kind: z.literal('PLATFORM') }),
  ]),
  allStudents: z.boolean(),
  allTeachers: z.boolean(),
  studentClassIds: ids,
  teacherClassIds: ids,
  personIds: ids,
  excludeIds: ids,
});
export type AnnouncementAudience = z.infer<typeof AnnouncementAudience>;
export const AnnouncementInput = z.strictObject({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(12000),
  audience: AnnouncementAudience,
});
export type AnnouncementInput = z.infer<typeof AnnouncementInput>;
