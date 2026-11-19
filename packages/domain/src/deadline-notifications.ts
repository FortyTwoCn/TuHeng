import type { DataPort, Entities } from './entities';
import { assignmentDeadlineNotice, recordNotifications } from './notification-events';

export async function scanAssignmentDeadlines(
  db: DataPort,
  now = new Date(),
  pageSize = 100,
  maxPages = 10,
) {
  let cursor = '';
  let count = 0;
  for (let page = 0; page < maxPages; page++) {
    const result = await db.transaction(async (tx) => {
      const rows = await tx.deadlineCandidates(now, cursor, pageSize);
      await tx.lockNotificationRecipients(rows.map((r) => r.studentId));
      const groups = new Map<string, { row: (typeof rows)[number]; ids: string[] }>();
      for (const row of rows) {
        const key = JSON.stringify([row.id, row.missing]);
        const group = groups.get(key) ?? { row, ids: [] };
        group.ids.push(row.studentId);
        groups.set(key, group);
      }
      let notified = 0;
      for (const { row, ids } of groups.values())
        notified += await recordNotifications(
          tx,
          ids,
          assignmentDeadlineNotice(row, row.missing),
          now,
        );
      return { rows, notified };
    });
    count += result.notified;
    if (result.rows.length < pageSize) break;
    cursor = result.rows[result.rows.length - 1].recipientId;
  }
  return count;
}

export async function missingAssignmentItems(
  db: DataPort,
  assignmentId: string,
  studentId: string,
) {
  const items = await db.list('assignmentItem', { assignmentId });
  const submissions = await db.list('submission', {
    itemId: { in: items.map((i) => i.id) },
    userId: studentId,
  });
  const attempts = await db.list('submissionAttempt', {
    submissionId: { in: submissions.map((s) => s.id) },
    ownerId: studentId,
    source: 'ASSIGNMENT',
  });
  const submitted = new Set(attempts.map((a) => a.submissionId));
  return items.length - submissions.filter((s) => submitted.has(s.id)).length;
}
export function reminderStillCurrent(
  assignment: Entities['assignment'],
  deadlineAt: Date | null,
  recipient: Entities['assignmentRecipient'],
  now: Date,
) {
  return (
    !!deadlineAt &&
    +assignment.dueAt === +deadlineAt &&
    assignment.startsAt <= now &&
    assignment.dueAt > now &&
    +assignment.dueAt <= +now + 24 * 3600_000 &&
    +recipient.activeSince <= +now - 30 * 60_000
  );
}
