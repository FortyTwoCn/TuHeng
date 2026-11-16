import { QuestionInput, Rubric } from '@tuheng/contracts';
import type { AudienceSelection } from '@tuheng/contracts';
import { resolveAudience, freezeAssignmentAudience } from './audience';
import { requireAssignmentManager } from './policy';
import type { Actor, DataPort } from './entities';
import { ensure, requireRole, requireClass, audit } from './policy';
export async function ownAssets(db: DataPort, a: Actor, ids: string[], purpose?: string) {
  ensure(new Set(ids).size === ids.length, 'DUPLICATE_ASSETS');
  for (const id of ids) {
    const asset = await db.get('storedAsset', id);
    ensure(
      asset && asset.ownerId === a.id && (!purpose || asset.purpose === purpose),
      'ASSET_FORBIDDEN',
      403,
    );
  }
}
export async function createQuestion(
  db: DataPort,
  a: Actor,
  input: unknown,
  privateSelf = false,
  questionId?: string,
) {
  const data = QuestionInput.parse(input);
  if (data.geometryDocument) {
    const stemLayer = data.geometryDocument.layers.find((l) => l.role === 'PROBLEM_STEM')!.id;
    ensure(
      data.geometryDocument.entities.every((e) => e.layerId === stemLayer),
      'QUESTION_GEOMETRY_MUST_BE_STEM',
    );
  }
  if (!privateSelf) requireRole(a, 'TEACHER', 'SCHOOL_ADMIN', 'ADMIN');
  else {
    data.confirmed = false;
    data.reference.verified = false;
    data.reference.source = 'STUDENT';
  }
  await ownAssets(db, a, [...new Set([...data.assetIds, ...data.reference.assetIds])]);
  for (const id of data.knowledgeIds)
    ensure(await db.get('knowledgePoint', id), 'UNKNOWN_KNOWLEDGE');
  ensure(
    data.rubric.items.every((i) => i.knowledgeIds.every((k) => data.knowledgeIds.includes(k))),
    'RUBRIC_KNOWLEDGE_MISMATCH',
  );
  if (!privateSelf && data.confirmed) ensure(data.reference.verified, 'REFERENCE_NOT_VERIFIED');
  return db.transaction(async (tx) => {
    const existing = questionId ? await tx.get('question', questionId) : null;
    if (questionId) ensure(existing?.ownerId === a.id, 'QUESTION_FORBIDDEN', 403);
    const q =
      existing ??
      (await tx.create('question', { ownerId: a.id, visibility: 'PRIVATE', courseId: null }));
    const versions = await tx.list(
      'questionVersion',
      { questionId: q.id },
      { orderBy: 'version', desc: true, take: 1 },
    );
    const version = await tx.create('questionVersion', {
      ...data,
      questionId: q.id,
      version: (versions[0]?.version ?? 0) + 1,
      maxPoints: data.rubric.maxPoints,
      analysis: null,
    });
    await audit(tx, a, 'QUESTION_VERSION_CREATED', version.id);
    return version;
  });
}
export async function createAssignment(
  db: DataPort,
  a: Actor,
  input: {
    title: string;
    classId?: string;
    audience?: AudienceSelection;
    rosterVersion?: number;
    reviewerIds?: string[];
    questionVersionIds: string[];
    startsAt: Date;
    dueAt: Date;
    allowLate: boolean;
    maxAttempts: number;
    releaseAnswers: boolean;
  },
) {
  requireRole(a, 'TEACHER', 'SCHOOL_ADMIN', 'ADMIN');
  let audience = input.audience;
  if (!audience && a.schoolId && input.classId)
    audience = {
      version: 1,
      schoolId: a.schoolId,
      include: { allEligibleInScope: false, classIds: [input.classId], studentIds: [] },
      exclude: { studentIds: [] },
    };
  const resolved = audience ? await resolveAudience(db, a, audience) : null;
  if (!resolved) {
    ensure(input.classId, 'AUDIENCE_REQUIRED');
    await requireClass(db, a, input.classId, true);
  }
  if (resolved && input.rosterVersion !== undefined)
    ensure(resolved.rosterVersion === input.rosterVersion, 'AUDIENCE_PREVIEW_STALE', 409);
  ensure(input.dueAt > input.startsAt, 'INVALID_DATES');
  ensure(input.questionVersionIds.length > 0, 'EMPTY_ASSIGNMENT');
  for (const id of input.questionVersionIds) {
    const v = await db.get('questionVersion', id);
    ensure(v, 'QUESTION_NOT_FOUND');
    const q = await db.get('question', v.questionId);
    ensure(q?.ownerId === a.id && q.active, 'QUESTION_FORBIDDEN', 403);
    Rubric.parse(v.rubric);
    ensure(v.confirmed && v.reference.verified, 'QUESTION_NOT_CONFIRMED');
  }
  return db.transaction(async (tx) => {
    const { questionVersionIds, reviewerIds } = input;
    const data = {
      title: input.title,
      classId: input.classId ?? null,
      startsAt: input.startsAt,
      dueAt: input.dueAt,
      allowLate: input.allowLate,
      maxAttempts: input.maxAttempts,
      releaseAnswers: input.releaseAnswers,
    };
    const assignment = await tx.create('assignment', {
      ...data,
      creatorId: a.id,
      status: 'DRAFT',
      ...(resolved
        ? {
            schoolId: resolved.selection.schoolId,
            audience: {
              ...resolved.selection,
              reviewerIds: a.kind === 'TEACHER' ? [a.id] : (reviewerIds ?? []),
              rosterVersion: resolved.rosterVersion,
            },
          }
        : {}),
    });
    for (const [position, id] of questionVersionIds.entries())
      await tx.create('assignmentItem', {
        assignmentId: assignment.id,
        questionVersionId: id,
        position,
      });
    await audit(tx, a, 'ASSIGNMENT_CREATED', assignment.id);
    return assignment;
  });
}
export async function publishAssignment(
  db: DataPort,
  a: Actor,
  id: string,
  rosterVersion?: number,
) {
  requireRole(a, 'TEACHER', 'SCHOOL_ADMIN', 'ADMIN');
  return db.transaction(async (tx) => {
    const ass = await tx.get('assignment', id);
    ensure(ass, 'NOT_FOUND', 404);
    await requireAssignmentManager(tx, a, ass);
    ensure(ass.status === 'DRAFT', 'ALREADY_PUBLISHED');
    ensure((await tx.list('assignmentItem', { assignmentId: id })).length, 'EMPTY_ASSIGNMENT');
    if (ass.audience) await freezeAssignmentAudience(tx, a, ass, rosterVersion);
    await tx.update('assignment', id, { status: 'PUBLISHED' });
    await audit(tx, a, 'ASSIGNMENT_PUBLISHED', id);
    return { id };
  });
}
export async function importRoster(db: DataPort, a: Actor, classId: string, emails: string[]) {
  requireRole(a, 'TEACHER');
  await requireClass(db, a, classId, true);
  return db.transaction(async (tx) => {
    let added = 0;
    for (const email of [...new Set(emails.map((e) => e.trim().toLowerCase()))]) {
      const user = (await tx.list('user', { email }))[0];
      ensure(user?.active && user.roles.includes('STUDENT'), 'STUDENT_ACCOUNT_NOT_FOUND');
      if (!(await tx.list('enrollment', { userId: user.id, classId })).length) {
        await tx.create('enrollment', { userId: user.id, classId });
        added++;
      }
    }
    await audit(tx, a, 'ROSTER_IMPORTED', classId, { added });
    return { added };
  });
}
