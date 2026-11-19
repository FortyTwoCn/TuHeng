import type { Actor, DataPort } from './entities';
import { announcementForRecipient } from './announcements';
import { missingAssignmentItems, reminderStillCurrent } from './deadline-notifications';
import {
  attemptContext,
  DomainError,
  requireAssignmentRecipient,
  requireAssignmentReviewer,
} from './policy';

type NoticeTarget = {
  resourceType: string;
  resourceId: string;
  kind: string;
  schoolId: string | null;
  revision: number | null;
  deadlineAt: Date | null;
};
type Destination = { href: string | null; summary?: string };
const pathId = encodeURIComponent;

export async function notificationDestination(
  db: DataPort,
  actor: Actor,
  notice: NoticeTarget,
  delivery = false,
  now = new Date(),
): Promise<Destination | null> {
  if (notice.schoolId && actor.schoolId !== notice.schoolId) return null;
  try {
    switch (notice.resourceType) {
      case 'ASSIGNMENT': {
        const assignment = await db.get('assignment', notice.resourceId);
        if (!assignment || assignment.status !== 'PUBLISHED' || actor.kind !== 'STUDENT')
          return null;
        if (notice.kind === 'ASSIGNMENT_REMOVED') {
          const row = (
            await db.list('assignmentRecipient', {
              assignmentId: assignment.id,
              studentId: actor.id,
            })
          )[0];
          return row && (!delivery || (!row.active && row.revision >= (notice.revision ?? 0)))
            ? { href: null }
            : null;
        }
        const recipient = await requireAssignmentRecipient(db, actor, assignment);
        if (
          delivery &&
          notice.kind === 'ASSIGNMENT_ADDED' &&
          recipient &&
          recipient.revision < (notice.revision ?? 0)
        )
          return null;
        if (delivery && notice.kind === 'ASSIGNMENT_DUE') {
          if (!recipient || !reminderStillCurrent(assignment, notice.deadlineAt, recipient, now))
            return null;
          const missing = await missingAssignmentItems(db, assignment.id, actor.id);
          if (!missing) return null;
          return {
            href: `/student/assignments/${pathId(assignment.id)}`,
            summary: `${assignment.title} · 还有 ${missing} 题未提交。`,
          };
        }
        return {
          href:
            now < assignment.startsAt
              ? '/student/assignments'
              : `/student/assignments/${pathId(assignment.id)}`,
        };
      }
      case 'GRADE_DECISION': {
        const decision = await db.get('gradeDecision', notice.resourceId);
        if (!decision?.publishedAt || actor.kind !== 'STUDENT') return null;
        const { attempt } = await attemptContext(db, actor, decision.attemptId);
        if (
          attempt.ownerId !== actor.id ||
          (delivery && attempt.publishedDecisionId !== decision.id)
        )
          return null;
        return { href: `/student/results/${pathId(attempt.id)}` };
      }
      case 'APPEAL': {
        const appeal = await db.get('appeal', notice.resourceId);
        if (!appeal) return null;
        const { assignment, attempt } = await attemptContext(db, actor, appeal.attemptId);
        if (!assignment) return null;
        if (notice.kind === 'APPEAL_OPENED') {
          if (actor.kind !== 'TEACHER' || (delivery && appeal.status !== 'OPEN')) return null;
          await requireAssignmentReviewer(db, actor, assignment, attempt.ownerId);
          return { href: `/teacher/reviews/${pathId(attempt.id)}#appeals` };
        }
        return appeal.status === 'RESOLVED' &&
          appeal.userId === actor.id &&
          actor.kind === 'STUDENT'
          ? { href: `/student/results/${pathId(attempt.id)}#appeals` }
          : null;
      }
      case 'ANNOUNCEMENT': {
        const record = await db.get('announcement', notice.resourceId);
        if (
          !record ||
          record.revision !== notice.revision ||
          !(await announcementForRecipient(db, actor, record))
        )
          return null;
        const area = actor.kind === 'STUDENT' ? 'student' : 'teacher';
        return { href: `/${area}/announcements/${pathId(record.id)}` };
      }
      default:
        return null;
    }
  } catch (error) {
    if (error instanceof DomainError && [403, 404].includes(error.status)) return null;
    throw error;
  }
}
