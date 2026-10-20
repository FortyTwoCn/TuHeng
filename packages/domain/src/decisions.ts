import { ScoreDecisionInput, Annotation } from '@tuheng/contracts';
import type { Actor, DataPort } from './entities';
import { ensure, requireRole, attemptContext, audit } from './policy';
export async function reviewGrade(db: DataPort, a: Actor, input: unknown) {
  const data = ScoreDecisionInput.parse(input);
  return db.transaction(async (tx) => {
    const { attempt } = await attemptContext(tx, a, data.attemptId, true);
    const q = await tx.get('questionVersion', attempt.questionVersionId);
    ensure(q, 'NOT_FOUND');
    const ids = new Set(data.items.map((i) => i.criterionId));
    ensure(
      ids.size === q.rubric.items.length &&
        data.items.length === ids.size &&
        q.rubric.items.every((i) => ids.has(i.id)),
      'CRITERIA_MISMATCH',
    );
    for (const i of data.items) {
      const criterion = q.rubric.items.find((c) => c.id === i.criterionId)!;
      ensure(i.points <= criterion.maxPoints, 'SCORE_OUT_OF_RANGE');
      if (criterion.deductionCap !== null)
        ensure(criterion.maxPoints - i.points <= criterion.deductionCap, 'DEDUCTION_CAP');
    }
    const assets = await tx.list('submissionAsset', { attemptId: attempt.id });
    for (const annotation of data.annotations) {
      Annotation.parse(annotation);
      ensure(
        annotation.assetVersion === 'original' &&
          assets.some((s) => s.assetId === annotation.assetId),
        'ANNOTATION_ASSET_MISMATCH',
      );
    }
    const last = (
      await tx.list(
        'gradeDecision',
        { attemptId: attempt.id },
        { orderBy: 'revision', desc: true, take: 1 },
      )
    )[0];
    const decision = await tx.create('gradeDecision', {
      ...data,
      teacherId: a.id,
      revision: (last?.revision ?? 0) + 1,
      points: data.items.reduce((s, i) => s + i.points, 0),
    });
    await audit(tx, a, 'GRADE_REVIEWED', decision.id, { revision: decision.revision });
    return decision;
  });
}
export async function publishGrade(db: DataPort, a: Actor, decisionId: string) {
  requireRole(a, 'TEACHER');
  return db.transaction(async (tx) => {
    const decision = await tx.get('gradeDecision', decisionId);
    ensure(decision, 'NOT_FOUND', 404);
    const { attempt } = await attemptContext(tx, a, decision.attemptId, true);
    if (decision.publishedAt) return decision;
    const latest = (
      await tx.list(
        'gradeDecision',
        { attemptId: attempt.id },
        { orderBy: 'revision', desc: true, take: 1 },
      )
    )[0];
    ensure(latest.id === decision.id, 'STALE_DECISION');
    const q = await tx.get('questionVersion', attempt.questionVersionId);
    ensure(q, 'NOT_FOUND');
    const now = new Date();
    await tx.update('gradeDecision', decision.id, { publishedAt: now });
    await tx.update('submissionAttempt', attempt.id, { publishedDecisionId: decision.id });
    const items = decision.items as { criterionId: string; points: number; evidence: string }[];
    for (const knowledgeId of q.knowledgeIds) {
      const related = q.rubric.items.filter((i) => i.knowledgeIds.includes(knowledgeId));
      if (!related.length) continue;
      await tx.create('knowledgeEvidence', {
        ownerId: attempt.ownerId,
        knowledgeId,
        decisionId: decision.id,
        earned: related.reduce((s, c) => s + items.find((i) => i.criterionId === c.id)!.points, 0),
        possible: related.reduce((s, c) => s + c.maxPoints, 0),
        evidence: related
          .map((c) => items.find((i) => i.criterionId === c.id)!.evidence)
          .join('\n'),
      });
    }
    if (
      decision.points < q.maxPoints &&
      !(await tx.list('errorBookEntry', { ownerId: attempt.ownerId, attemptId: attempt.id })).length
    )
      await tx.create('errorBookEntry', {
        ownerId: attempt.ownerId,
        attemptId: attempt.id,
        questionVersionId: q.id,
      });
    await audit(tx, a, 'GRADE_PUBLISHED', decision.id);
    return { ...decision, publishedAt: now };
  });
}
export async function appealGrade(db: DataPort, a: Actor, attemptId: string, reason: string) {
  return db.transaction(async (tx) => {
    const { attempt } = await attemptContext(tx, a, attemptId);
    ensure(attempt.ownerId === a.id && attempt.publishedDecisionId, 'NO_PUBLISHED_GRADE');
    ensure(!(await tx.list('appeal', { attemptId, status: 'OPEN' })).length, 'APPEAL_ALREADY_OPEN');
    const appeal = await tx.create('appeal', { attemptId, userId: a.id, reason });
    await audit(tx, a, 'APPEAL_CREATED', appeal.id);
    return appeal;
  });
}
export async function resolveAppeal(db: DataPort, a: Actor, id: string, response: string) {
  requireRole(a, 'TEACHER');
  return db.transaction(async (tx) => {
    const appeal = await tx.get('appeal', id);
    ensure(appeal, 'NOT_FOUND');
    await attemptContext(tx, a, appeal.attemptId, true);
    ensure(appeal.status === 'OPEN', 'APPEAL_CLOSED');
    await tx.update('appeal', id, { response, status: 'RESOLVED' });
    await audit(tx, a, 'APPEAL_RESOLVED', id);
    return { id };
  });
}
