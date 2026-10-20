import { GradingRequest } from '@tuheng/contracts';
import type { Actor, DataPort, Entities } from './entities';
import { ensure, requireClass, checkSubmissionWindow, audit } from './policy';
import { ownAssets } from './teaching';
export async function scheduleRun(
  tx: DataPort,
  attempt: Entities['submissionAttempt'],
  assetIds: string[],
) {
  const question = await tx.get('questionVersion', attempt.questionVersionId);
  ensure(question, 'QUESTION_NOT_FOUND');
  const config = (
    await tx.list(
      'modelConfigurationVersion',
      { active: true },
      { orderBy: 'createdAt', desc: true, take: 1 },
    )
  )[0];
  ensure(config, 'MODEL_CONFIG_MISSING');
  const ref = async (id: string) => {
    const a = await tx.get('storedAsset', id);
    ensure(a, 'ASSET_NOT_FOUND');
    return { id: a.id, version: 'original', mime: a.mime };
  };
  const id = crypto.randomUUID();
  const request = GradingRequest.parse({
    contractVersion: '1',
    runId: id,
    question: {
      id: question.id,
      version: question.version,
      title: question.title,
      content: question.content,
      type: question.type,
      assets: await Promise.all(question.assetIds.map(ref)),
      knowledgeIds: question.knowledgeIds,
    },
    reference: {
      ...question.reference,
      assets: await Promise.all(question.reference.assetIds.map(ref)),
    },
    rubric: question.rubric,
    submissionAssets: await Promise.all(assetIds.map(ref)),
    imageOptions: { maxDimension: 2000, rotate: 0, crop: null },
    strategyVersion: 'geometry-v1',
    promptVersion: 'geometry-review/1.0.0',
    modelConfigId: config.id,
  });
  const run = await tx.create('gradingRun', {
    id,
    attemptId: attempt.id,
    configId: config.id,
    status: 'QUEUED',
    strategyVersion: request.strategyVersion,
    promptVersion: request.promptVersion,
    request,
  });
  const lane = attempt.source === 'ASSIGNMENT' ? 'formal' : 'selftest';
  await tx.create('backgroundJob', { runId: id, lane, status: 'QUEUED' });
  await tx.create('outboxEvent', { runId: id, lane });
  return run;
}
export async function saveDraft(db: DataPort, a: Actor, itemId: string, assetIds: string[]) {
  await ownAssets(db, a, assetIds, 'SUBMISSION');
  const item = await db.get('assignmentItem', itemId);
  ensure(item, 'NOT_FOUND', 404);
  const ass = await db.get('assignment', item.assignmentId);
  ensure(ass, 'NOT_FOUND', 404);
  await requireClass(db, a, ass.classId);
  checkSubmissionWindow(ass, new Date());
  ensure(
    (await db.list('enrollment', { userId: a.id, classId: ass.classId })).length,
    'ENROLLMENT_REQUIRED',
    403,
  );
  return db.transaction(async (tx) => {
    const s = (await tx.list('submission', { userId: a.id, itemId }))[0];
    return s
      ? tx.update('submission', s.id, { draftAssetIds: assetIds })
      : tx.create('submission', { userId: a.id, itemId, draftAssetIds: assetIds });
  });
}
export async function submitAnswer(
  db: DataPort,
  a: Actor,
  input: {
    itemId?: string;
    selfTestItemId?: string;
    reviewEntryId?: string;
    assetIds: string[];
    idempotencyKey: string;
  },
  quota = 20,
) {
  ensure(input.assetIds.length > 0 && input.assetIds.length <= 10, 'ANSWER_IMAGES_REQUIRED');
  await ownAssets(db, a, input.assetIds, 'SUBMISSION');
  for (const id of input.assetIds)
    ensure(
      (await db.get('storedAsset', id))?.mime !== 'application/pdf',
      'SUBMISSION_MUST_BE_IMAGE',
    );
  return db.transaction(async (tx) => {
    const prior = (
      await tx.list('submissionAttempt', { ownerId: a.id, idempotencyKey: input.idempotencyKey })
    )[0];
    if (prior) return prior;
    let submissionId: string | null = null,
      selfTestItemId: string | null = null,
      questionVersionId: string,
      source = 'ASSIGNMENT',
      version = 1;
    if (input.itemId) {
      const item = await tx.get('assignmentItem', input.itemId);
      ensure(item, 'NOT_FOUND', 404);
      const ass = await tx.get('assignment', item.assignmentId);
      ensure(ass, 'NOT_FOUND', 404);
      ensure(
        (await tx.list('enrollment', { userId: a.id, classId: ass.classId })).length,
        'ENROLLMENT_REQUIRED',
        403,
      );
      checkSubmissionWindow(ass, new Date());
      let s = (await tx.list('submission', { userId: a.id, itemId: item.id }))[0];
      if (!s)
        s = await tx.create('submission', { userId: a.id, itemId: item.id, draftAssetIds: [] });
      const attempts = await tx.list('submissionAttempt', { submissionId: s.id });
      ensure(attempts.length < ass.maxAttempts, 'ATTEMPT_LIMIT');
      version = attempts.length + 1;
      submissionId = s.id;
      questionVersionId = item.questionVersionId;
    } else {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const attempts = await tx.list('submissionAttempt', {
        ownerId: a.id,
        source: { in: ['SELFTEST', 'REVIEW'] },
        submittedAt: { gt: today },
      });
      ensure(attempts.length < quota, 'SELFTEST_QUOTA');
      source = input.reviewEntryId ? 'REVIEW' : 'SELFTEST';
      if (input.reviewEntryId) {
        const entry = await tx.get('errorBookEntry', input.reviewEntryId);
        ensure(entry?.ownerId === a.id, 'FORBIDDEN', 403);
        questionVersionId = entry.questionVersionId;
      } else {
        const item = await tx.get('selfTestItem', input.selfTestItemId ?? '');
        ensure(item, 'NOT_FOUND', 404);
        const set = await tx.get('selfTestSet', item.setId);
        ensure(set?.ownerId === a.id, 'PRIVATE_SELFTEST', 403);
        selfTestItemId = item.id;
        questionVersionId = item.questionVersionId;
      }
    }
    const attempt = await tx.create('submissionAttempt', {
      ownerId: a.id,
      submissionId,
      selfTestItemId,
      questionVersionId,
      source,
      version,
      idempotencyKey: input.idempotencyKey,
    });
    for (const [position, assetId] of input.assetIds.entries())
      await tx.create('submissionAsset', { attemptId: attempt.id, assetId, position });
    if (input.reviewEntryId)
      await tx.create('reviewAttempt', { entryId: input.reviewEntryId, attemptId: attempt.id });
    await scheduleRun(tx, attempt, input.assetIds);
    await audit(tx, a, 'ANSWER_SUBMITTED', attempt.id, { source });
    return attempt;
  });
}
