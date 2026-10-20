import { GradingResult } from '@tuheng/contracts';
import type { Actor, DataPort, Entities } from './entities';
import { ensure, hasRole, requireRole, requireClass, attemptContext } from './policy';
export async function visibleClasses(db: DataPort, a: Actor) {
  const grants = hasRole(a, 'TEACHER', 'TEACHING_ASSISTANT')
    ? await db.list('teachingGrant', { userId: a.id })
    : [];
  const enrollments = await db.list('enrollment', { userId: a.id });
  const ids = [...new Set([...grants, ...enrollments].map((g) => g.classId))];
  return db.list('teachingClass', { id: { in: ids } });
}
export async function listAssignments(db: DataPort, a: Actor) {
  const classes = await visibleClasses(db, a);
  const assignments = await db.list(
    'assignment',
    { classId: { in: classes.map((c) => c.id) } },
    { orderBy: 'dueAt', desc: true },
  );
  return assignments.filter(
    (v) => v.status === 'PUBLISHED' || hasRole(a, 'TEACHER', 'TEACHING_ASSISTANT'),
  );
}
export async function assignmentDetails(db: DataPort, a: Actor, id: string) {
  const assignment = await db.get('assignment', id);
  ensure(assignment, 'NOT_FOUND', 404);
  await requireClass(db, a, assignment.classId);
  const teacher =
    hasRole(a, 'TEACHER', 'TEACHING_ASSISTANT') &&
    (await db.list('teachingGrant', { userId: a.id, classId: assignment.classId })).length > 0;
  ensure(
    teacher || (assignment.status === 'PUBLISHED' && new Date() >= assignment.startsAt),
    'NOT_AVAILABLE',
    403,
  );
  const items = await db.list('assignmentItem', { assignmentId: id }, { orderBy: 'position' });
  return {
    assignment,
    teacher,
    items: await Promise.all(
      items.map(async (item) => {
        const q = await db.get('questionVersion', item.questionVersionId);
        ensure(q, 'NOT_FOUND');
        const submissions = await db.list('submission', {
          itemId: item.id,
          ...(!teacher ? { userId: a.id } : {}),
        });
        const attempts = await db.list(
          'submissionAttempt',
          { submissionId: { in: submissions.map((s) => s.id) } },
          { orderBy: 'submittedAt', desc: true },
        );
        const allowedReference =
          teacher ||
          (assignment.releaseAnswers &&
            attempts.some((at) => at.ownerId === a.id && at.publishedDecisionId));
        return {
          ...item,
          question: allowedReference
            ? q
            : {
                ...q,
                reference: { ...q.reference, content: '成绩发布且教师开放后可见', assetIds: [] },
                analysis: null,
              },
          submissions,
          attempts,
        };
      }),
    ),
  };
}
export async function viewAttempt(db: DataPort, a: Actor, id: string) {
  const { attempt, assignment } = await attemptContext(db, a, id);
  const q = await db.get('questionVersion', attempt.questionVersionId);
  ensure(q, 'NOT_FOUND');
  const teacher =
    attempt.source === 'ASSIGNMENT' &&
    hasRole(a, 'TEACHER', 'TEACHING_ASSISTANT') &&
    assignment &&
    (await db.list('teachingGrant', { userId: a.id, classId: assignment.classId })).length > 0;
  const showSuggestions = teacher || attempt.source !== 'ASSIGNMENT';
  const runs = await db.list('gradingRun', { attemptId: id }, { orderBy: 'createdAt', desc: true });
  const suggestions = showSuggestions
    ? await db.list('gradingSuggestion', { runId: { in: runs.map((r) => r.id) } })
    : [];
  const decisions = teacher
    ? await db.list('gradeDecision', { attemptId: id }, { orderBy: 'revision', desc: true })
    : attempt.publishedDecisionId
      ? [await db.get('gradeDecision', attempt.publishedDecisionId)]
      : [];
  const assets = await db.list('submissionAsset', { attemptId: id }, { orderBy: 'position' });
  const showReference =
    teacher ||
    attempt.source !== 'ASSIGNMENT' ||
    (assignment?.releaseAnswers && attempt.publishedDecisionId);
  return {
    attempt,
    assignment,
    teacher: !!teacher,
    question: showReference
      ? q
      : {
          ...q,
          reference: { ...q.reference, content: '参考答案未开放', assetIds: [] },
          analysis: null,
        },
    assets: await db.list('storedAsset', { id: { in: assets.map((s) => s.assetId) } }),
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      errorCode: r.errorCode,
      createdAt: r.createdAt,
    })),
    suggestions: suggestions.map((s) => ({
      id: s.id,
      runId: s.runId,
      result: GradingResult.parse(s.result),
      processedAssets: s.processedAssets,
    })),
    decisions,
    appeals: await db.list('appeal', { attemptId: id }),
  };
}
export async function listReviews(db: DataPort, a: Actor) {
  requireRole(a, 'TEACHER', 'TEACHING_ASSISTANT');
  const assignments = await listAssignments(db, a);
  const items = await db.list('assignmentItem', {
    assignmentId: { in: assignments.map((v) => v.id) },
  });
  const submissions = await db.list('submission', { itemId: { in: items.map((v) => v.id) } });
  const attempts = await db.list(
    'submissionAttempt',
    { submissionId: { in: submissions.map((s) => s.id) } },
    { orderBy: 'submittedAt', desc: true, take: 200 },
  );
  return Promise.all(
    attempts.map(async (attempt) => ({
      attempt,
      question: await db.get('questionVersion', attempt.questionVersionId),
      owner: (await db.get('user', attempt.ownerId))?.name,
      run: (
        await db.list(
          'gradingRun',
          { attemptId: attempt.id },
          { orderBy: 'createdAt', desc: true, take: 1 },
        )
      )[0],
    })),
  );
}
export async function listQuestions(db: DataPort, a: Actor) {
  requireRole(a, 'TEACHER');
  const qs = await db.list('question', { ownerId: a.id, active: true });
  return db.list(
    'questionVersion',
    { questionId: { in: qs.map((q) => q.id) } },
    { orderBy: 'createdAt', desc: true },
  );
}
export async function listSelfTests(db: DataPort, a: Actor) {
  const sets = await db.list(
    'selfTestSet',
    { ownerId: a.id },
    { orderBy: 'createdAt', desc: true },
  );
  return Promise.all(
    sets.map(async (s) => ({
      ...s,
      items: await db.list('selfTestItem', { setId: s.id }, { orderBy: 'position' }),
    })),
  );
}
export async function listErrors(db: DataPort, a: Actor) {
  const entries = await db.list(
    'errorBookEntry',
    { ownerId: a.id, archived: false },
    { orderBy: 'createdAt', desc: true },
  );
  return Promise.all(
    entries.map(async (e) => ({
      ...e,
      question: await db.get('questionVersion', e.questionVersionId),
      attempt: await db.get('submissionAttempt', e.attemptId),
      reviews: await db.list('reviewAttempt', { entryId: e.id }),
    })),
  );
}
export async function mastery(db: DataPort, a: Actor) {
  const evidence = await db.list('knowledgeEvidence', { ownerId: a.id });
  const attempts = await db.list('submissionAttempt', {
    ownerId: a.id,
    publishedDecisionId: { not: null },
  });
  const active = new Set(attempts.map((at) => at.publishedDecisionId));
  const current = evidence.filter((e) => active.has(e.decisionId));
  const knowledge = await db.list('knowledgePoint');
  return knowledge.map((k) => {
    const rows = current.filter((e) => e.knowledgeId === k.id);
    return {
      ...k,
      earned: rows.reduce((s, e) => s + e.earned, 0),
      possible: rows.reduce((s, e) => s + e.possible, 0),
      evidenceCount: rows.length,
    };
  });
}
export async function canReadAsset(
  db: DataPort,
  a: Actor,
  id: string,
): Promise<Entities['storedAsset']> {
  const asset = await db.get('storedAsset', id);
  ensure(asset, 'NOT_FOUND', 404);
  if (asset.ownerId === a.id) return asset;
  if (asset.parentId) {
    await canReadAsset(db, a, asset.parentId);
    return asset;
  }
  const submissionRefs = await db.list('submissionAsset', { assetId: id });
  for (const ref of submissionRefs) {
    try {
      await attemptContext(db, a, ref.attemptId, true);
      return asset;
    } catch {
      /* test other permitted references */
    }
  }
  const questions = await db.list('questionVersion', {}, { take: 10000 });
  for (const q of questions) {
    const stem = q.assetIds.includes(id),
      reference = q.reference.assetIds.includes(id);
    if (!stem && !reference) continue;
    const owner = await db.get('question', q.questionId);
    if (owner?.ownerId === a.id) return asset;
    const items = await db.list('assignmentItem', { questionVersionId: q.id });
    for (const item of items) {
      const ass = await db.get('assignment', item.assignmentId);
      if (!ass) continue;
      const grant =
        hasRole(a, 'TEACHER', 'TEACHING_ASSISTANT') &&
        (await db.list('teachingGrant', { userId: a.id, classId: ass.classId })).length;
      if (grant) return asset;
      const enrolled = (await db.list('enrollment', { userId: a.id, classId: ass.classId })).length;
      if (enrolled && ass.status === 'PUBLISHED' && new Date() >= ass.startsAt) {
        if (stem) return asset;
        if (ass.releaseAnswers) {
          const s = (await db.list('submission', { userId: a.id, itemId: item.id }))[0];
          if (
            s &&
            (
              await db.list('submissionAttempt', {
                submissionId: s.id,
                publishedDecisionId: { not: null },
              })
            ).length
          )
            return asset;
        }
      }
    }
  }
  ensure(false, 'ASSET_FORBIDDEN', 403);
}
