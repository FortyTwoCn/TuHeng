import { AudienceSelection, ReviewerAssignment } from '@tuheng/contracts';
import type { Actor, DataPort, Entities } from './entities';
import { ensure, audit } from './policy';
import { requireSchoolScope } from './identity';
export async function audienceScope(db: DataPort, actor: Actor, schoolId: string) {
  requireSchoolScope(actor, schoolId);
  const school = await db.get('school', schoolId);
  ensure(school?.active, 'SCHOOL_DISABLED', 403);
  ensure(['SITE_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(actor.kind ?? ''), 'FORBIDDEN', 403);
  let classes = await db.list('teachingClass', { schoolId });
  const courses = await db.list('course', { schoolId, archived: false });
  const offerings = await db.list('courseOffering', {
    courseId: { in: courses.map((c) => c.id) },
    archived: false,
  });
  const available = new Set(offerings.map((o) => o.id));
  classes = classes.filter((c) => !c.archived && available.has(c.offeringId));
  if (actor.kind === 'TEACHER') {
    const grants = await db.list('teachingGrant', { userId: actor.id });
    classes = classes.filter((c) => grants.some((g) => g.classId === c.id));
  }
  const members = await db.list('enrollment', { classId: { in: classes.map((c) => c.id) } });
  let students = await db.list('user', { schoolId, kind: 'STUDENT', active: true });
  if (actor.kind === 'TEACHER')
    students = students.filter((s) => members.some((m) => m.userId === s.id));
  return { school, classes, members, students };
}
export async function resolveAudience(db: DataPort, actor: Actor, input: unknown) {
  const selection = AudienceSelection.parse(input),
    scope = await audienceScope(db, actor, selection.schoolId);
  const classIds = new Set(scope.classes.map((c) => c.id)),
    eligible = new Set(scope.students.map((s) => s.id));
  ensure(
    selection.include.classIds.every((id) => classIds.has(id)) &&
      [...selection.include.studentIds, ...selection.exclude.studentIds].every((id) =>
        eligible.has(id),
      ),
    'AUDIENCE_SCOPE_FORBIDDEN',
    403,
  );
  const ids = new Set<string>(
    selection.include.allEligibleInScope ? eligible : selection.include.studentIds,
  );
  for (const member of scope.members)
    if (selection.include.classIds.includes(member.classId) && eligible.has(member.userId))
      ids.add(member.userId);
  for (const id of selection.exclude.studentIds) ids.delete(id);
  const recipients = scope.students
    .filter((s) => ids.has(s.id))
    .map((s) => ({
      studentId: s.id,
      name: s.name,
      studentNumber: s.studentNumber,
      classIds: [...new Set(scope.members.filter((m) => m.userId === s.id).map((m) => m.classId))],
    }));
  return {
    selection,
    rosterVersion: scope.school.rosterVersion,
    recipients,
    count: recipients.length,
    excluded: selection.exclude.studentIds.length,
    eligibleCount: eligible.size,
  };
}
export async function freezeAssignmentAudience(
  db: DataPort,
  actor: Actor,
  assignment: Entities['assignment'],
  expectedRosterVersion?: number,
) {
  ensure(assignment.audience, 'AUDIENCE_REQUIRED');
  const resolved = await resolveAudience(db, actor, assignment.audience);
  ensure(
    resolved.rosterVersion === (expectedRosterVersion ?? assignment.audience.rosterVersion),
    'AUDIENCE_PREVIEW_STALE',
    409,
  );
  ensure(resolved.count, 'AUDIENCE_EMPTY');
  const reviewerIds = actor.kind === 'TEACHER' ? [actor.id] : assignment.audience.reviewerIds;
  ensure(reviewerIds.length, 'REVIEWER_REQUIRED');
  for (const id of reviewerIds) {
    const u = await db.get('user', id);
    ensure(
      u?.schoolId === resolved.selection.schoolId && u.kind === 'TEACHER' && u.active,
      'REVIEWER_SCOPE_FORBIDDEN',
      403,
    );
  }
  const reviewerMap = await resolveReviewerAssignments(
    db,
    actor,
    resolved,
    reviewerIds,
    assignment.audience.reviewerAssignments ?? [],
  );
  const revision = (assignment.audienceRevision ?? 0) + 1;
  for (const person of resolved.recipients) {
    await db.create('assignmentRecipient', {
      assignmentId: assignment.id,
      studentId: person.studentId,
      schoolId: resolved.selection.schoolId,
      classIds: person.classIds,
      reviewerIds: reviewerMap.get(person.studentId)!,
      revision,
      active: true,
      inferred: false,
    });
    await db.create('userNotification', {
      userId: person.studentId,
      assignmentId: assignment.id,
      kind: 'ASSIGNMENT_PUBLISHED',
      revision,
    });
  }
  await db.update('assignment', assignment.id, { audienceRevision: revision });
  await audit(db, actor, 'ASSIGNMENT_AUDIENCE_FROZEN', assignment.id, {
    revision,
    count: resolved.count,
    rosterVersion: resolved.rosterVersion,
  });
}
export async function reviseAssignmentAudience(
  db: DataPort,
  actor: Actor,
  id: string,
  input: unknown,
  expectedRevision: number,
  expectedRosterVersion: number,
  reviewerIds: string[],
  reviewerAssignments: ReviewerAssignment[] = [],
) {
  return db.transaction(async (tx) => {
    const ass = await tx.get('assignment', id);
    ensure(ass?.audience && ass.status === 'PUBLISHED', 'PUBLISHED_AUDIENCE_REQUIRED');
    ensure(
      ass.creatorId === actor.id || actor.kind === 'SCHOOL_ADMIN' || actor.kind === 'SITE_ADMIN',
      'FORBIDDEN',
      403,
    );
    ensure(ass.audienceRevision === expectedRevision, 'AUDIENCE_REVISION_CONFLICT', 409);
    const resolved = await resolveAudience(tx, actor, input);
    ensure(resolved.selection.schoolId === ass.schoolId, 'SCOPE_MISMATCH', 403);
    ensure(resolved.rosterVersion === expectedRosterVersion, 'AUDIENCE_PREVIEW_STALE', 409);
    const reviewers = actor.kind === 'TEACHER' ? [actor.id] : reviewerIds;
    ensure(reviewers.length, 'REVIEWER_REQUIRED');
    for (const teacherId of reviewers) {
      const u = await tx.get('user', teacherId);
      ensure(
        u?.kind === 'TEACHER' && u.schoolId === ass.schoolId && u.active,
        'REVIEWER_SCOPE_FORBIDDEN',
        403,
      );
    }
    const reviewerMap = await resolveReviewerAssignments(
      tx,
      actor,
      resolved,
      reviewers,
      reviewerAssignments,
    );
    const old = await tx.list('assignmentRecipient', { assignmentId: id }),
      ids = new Set(resolved.recipients.map((r) => r.studentId)),
      revision = expectedRevision + 1;
    const items = await tx.list('assignmentItem', { assignmentId: id });
    for (const row of old) {
      if (!ids.has(row.studentId)) {
        const submissions = await tx.list('submission', {
          userId: row.studentId,
          itemId: { in: items.map((i) => i.id) },
        });
        const attempts = await tx.list('submissionAttempt', {
          submissionId: { in: submissions.map((s) => s.id) },
        });
        ensure(!attempts.length, 'CANNOT_REMOVE_SUBMITTED_RECIPIENT', 409);
        await tx.update('assignmentRecipient', row.id, { active: false, revision });
        if (row.active)
          await tx.create('userNotification', {
            userId: row.studentId,
            assignmentId: id,
            kind: 'ASSIGNMENT_REMOVED',
            revision,
          });
      }
    }
    for (const person of resolved.recipients) {
      const existing = old.find((r) => r.studentId === person.studentId);
      const data = {
        assignmentId: id,
        studentId: person.studentId,
        schoolId: resolved.selection.schoolId,
        classIds: person.classIds,
        reviewerIds: reviewerMap.get(person.studentId)!,
        revision,
        active: true,
        inferred: false,
      };
      if (existing) await tx.update('assignmentRecipient', existing.id, data);
      else await tx.create('assignmentRecipient', data);
      if (!existing?.active)
        await tx.create('userNotification', {
          userId: person.studentId,
          assignmentId: id,
          kind: 'ASSIGNMENT_ADDED',
          revision,
        });
    }
    await tx.update('assignment', id, {
      audience: {
        ...resolved.selection,
        reviewerIds: reviewers,
        reviewerAssignments,
        rosterVersion: resolved.rosterVersion,
      },
      audienceRevision: revision,
    });
    await audit(tx, actor, 'ASSIGNMENT_AUDIENCE_REVISED', id, {
      revision,
      added: resolved.recipients
        .filter((p) => !old.some((o) => o.studentId === p.studentId))
        .map((p) => p.studentId),
      removed: old.filter((o) => !ids.has(o.studentId)).map((o) => o.studentId),
    });
    return { revision, count: resolved.count };
  });
}

export async function resolveReviewerAssignments(
  db: DataPort,
  actor: Actor,
  resolved: Awaited<ReturnType<typeof resolveAudience>>,
  defaults: string[],
  input: unknown,
) {
  const rules = ReviewerAssignment.array().max(50).parse(input);
  ensure(actor.kind !== 'TEACHER' || rules.length === 0, 'REVIEWER_DELEGATION_FORBIDDEN', 403);
  const allTeachers = [...new Set([...defaults, ...rules.map((r) => r.teacherId)])];
  for (const id of allTeachers) {
    const user = await db.get('user', id);
    ensure(
      user?.kind === 'TEACHER' && user.active && user.schoolId === resolved.selection.schoolId,
      'REVIEWER_SCOPE_FORBIDDEN',
      403,
    );
  }
  const allowed = new Set(resolved.recipients.map((r) => r.studentId)),
    overrides = new Map<string, Set<string>>();
  for (const rule of rules) {
    ensure(
      rule.selection.schoolId === resolved.selection.schoolId,
      'REVIEWER_SCOPE_FORBIDDEN',
      403,
    );
    const subset = await resolveAudience(db, actor, rule.selection);
    ensure(
      subset.recipients.every((r) => allowed.has(r.studentId)),
      'REVIEWER_OUTSIDE_AUDIENCE',
    );
    for (const person of subset.recipients) {
      const teachers = overrides.get(person.studentId) ?? new Set<string>();
      teachers.add(rule.teacherId);
      overrides.set(person.studentId, teachers);
    }
  }
  const result = new Map<string, string[]>();
  for (const person of resolved.recipients) {
    const teachers = [...(overrides.get(person.studentId) ?? new Set(defaults))];
    ensure(teachers.length, 'REVIEWER_REQUIRED');
    result.set(person.studentId, teachers);
  }
  return result;
}
