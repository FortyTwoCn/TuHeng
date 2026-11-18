import type { Actor, DataPort, Entities } from './entities';
export class DomainError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export function ensure(condition: unknown, code: string, status = 400): asserts condition {
  if (!condition) throw new DomainError(code, status);
}
export const hasRole = (a: Actor, ...roles: string[]) => a.roles.some((r) => roles.includes(r));
export function requireRole(a: Actor, ...roles: string[]) {
  ensure(hasRole(a, ...roles), 'FORBIDDEN', 403);
}
export async function requireClass(db: DataPort, a: Actor, classId: string, write = false) {
  const cls = await db.get('teachingClass', classId);
  if (cls?.schoolId) {
    ensure(a.schoolId === cls.schoolId, 'SCHOOL_FORBIDDEN', 403);
    ensure((await db.get('school', cls.schoolId))?.active, 'SCHOOL_DISABLED', 403);
  }
  if (write) {
    requireRole(a, 'TEACHER', 'TEACHING_ASSISTANT');
    ensure(
      (await db.list('teachingGrant', { userId: a.id, classId })).length,
      'CLASS_FORBIDDEN',
      403,
    );
  } else {
    const enrolled = await db.list('enrollment', { userId: a.id, classId });
    const grant = hasRole(a, 'TEACHER', 'TEACHING_ASSISTANT')
      ? await db.list('teachingGrant', { userId: a.id, classId })
      : [];
    ensure(enrolled.length || grant.length, 'CLASS_FORBIDDEN', 403);
  }
}
export async function attemptContext(db: DataPort, a: Actor, id: string, write = false) {
  const attempt = await db.get('submissionAttempt', id);
  ensure(attempt, 'NOT_FOUND', 404);
  if (attempt.source !== 'ASSIGNMENT') {
    ensure(attempt.ownerId === a.id && !write, 'PRIVATE_SELFTEST', 403);
    return { attempt, assignment: null, item: null };
  }
  const submission = await db.get('submission', attempt.submissionId!);
  ensure(submission, 'NOT_FOUND', 404);
  const item = await db.get('assignmentItem', submission.itemId);
  ensure(item, 'NOT_FOUND', 404);
  const assignment = await db.get('assignment', item.assignmentId);
  ensure(assignment, 'NOT_FOUND', 404);
  if (write || attempt.ownerId !== a.id)
    await requireAssignmentReviewer(db, a, assignment, attempt.ownerId);
  else if (assignment.audienceRevision) await requireAssignmentRecipient(db, a, assignment);
  return { attempt, assignment, item };
}
export function checkSubmissionWindow(
  a: Pick<Entities['assignment'], 'status' | 'startsAt' | 'dueAt' | 'allowLate'>,
  now: Date,
) {
  ensure(a.status === 'PUBLISHED', 'NOT_PUBLISHED');
  ensure(now >= a.startsAt, 'NOT_STARTED');
  ensure(a.allowLate || now <= a.dueAt, 'DEADLINE_PASSED');
}
export async function audit(
  db: DataPort,
  a: Actor,
  action: string,
  resourceId: string,
  details: unknown = {},
) {
  await db.create('auditLog', { actorId: a.id, action, resourceId, details });
}

export async function requireAssignmentRecipient(
  db: DataPort,
  a: Actor,
  assignment: Entities['assignment'],
) {
  if (assignment.audienceRevision) {
    ensure(a.kind === 'STUDENT' && a.schoolId === assignment.schoolId, 'ASSIGNMENT_FORBIDDEN', 403);
    ensure((await db.get('school', assignment.schoolId!))?.active, 'SCHOOL_DISABLED', 403);
    const row = (
      await db.list('assignmentRecipient', {
        assignmentId: assignment.id,
        studentId: a.id,
        active: true,
      })
    )[0];
    ensure(row, 'ASSIGNMENT_RECIPIENT_REQUIRED', 403);
    return row;
  }
  ensure(assignment.classId, 'ASSIGNMENT_RECIPIENT_REQUIRED', 403);
  ensure(
    (await db.list('enrollment', { userId: a.id, classId: assignment.classId })).length,
    'ENROLLMENT_REQUIRED',
    403,
  );
  return null;
}
export async function requireAssignmentReviewer(
  db: DataPort,
  a: Actor,
  assignment: Entities['assignment'],
  studentId?: string,
) {
  requireRole(a, 'TEACHER', 'TEACHING_ASSISTANT');
  if (!assignment.audienceRevision) {
    ensure(assignment.classId, 'REVIEWER_NOT_ASSIGNED', 403);
    await requireClass(db, a, assignment.classId, true);
    return;
  }
  ensure(
    a.schoolId === assignment.schoolId && (await db.get('school', assignment.schoolId!))?.active,
    'SCHOOL_FORBIDDEN',
    403,
  );
  const rows = await db.list('assignmentRecipient', {
    assignmentId: assignment.id,
    active: true,
    ...(studentId ? { studentId } : {}),
  });
  ensure(
    rows.some((r) => r.reviewerIds.includes(a.id)),
    'REVIEWER_NOT_ASSIGNED',
    403,
  );
}
export async function isAssignmentReviewer(
  db: DataPort,
  a: Actor,
  assignment: Entities['assignment'],
  studentId?: string,
) {
  try {
    await requireAssignmentReviewer(db, a, assignment, studentId);
    return true;
  } catch (e) {
    if (e instanceof DomainError && e.status === 403) return false;
    throw e;
  }
}
export async function requireAssignmentManager(
  db: DataPort,
  a: Actor,
  assignment: Entities['assignment'],
) {
  if (assignment.audience) {
    ensure(
      assignment.schoolId && (await db.get('school', assignment.schoolId))?.active,
      'SCHOOL_DISABLED',
      403,
    );
    ensure(a.kind === 'SITE_ADMIN' || a.schoolId === assignment.schoolId, 'SCHOOL_FORBIDDEN', 403);
    ensure(
      assignment.creatorId === a.id || ['SITE_ADMIN', 'SCHOOL_ADMIN'].includes(a.kind ?? ''),
      'ASSIGNMENT_FORBIDDEN',
      403,
    );
  } else {
    ensure(assignment.classId, 'ASSIGNMENT_FORBIDDEN', 403);
    await requireClass(db, a, assignment.classId, true);
  }
}
