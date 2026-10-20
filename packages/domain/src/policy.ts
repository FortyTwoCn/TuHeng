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
  if (write || attempt.ownerId !== a.id) await requireClass(db, a, assignment.classId, true);
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
