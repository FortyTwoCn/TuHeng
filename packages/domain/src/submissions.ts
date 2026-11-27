import { planAIInvocation } from './ai-routing';
import { GradingRequest } from '@tuheng/contracts';
import { exportGeometryBundle } from '@tuheng/geometry-core';
import { validateAnswerGeometry } from './geometry';
import type { Actor, DataPort, Entities } from './entities';
import { ensure, audit } from './policy';
import { answerStorageContext, bindUploadedAssets } from './resource-context';
export async function scheduleRun(
  tx: DataPort,
  attempt: Entities['submissionAttempt'],
  assetIds: string[],
) {
  const question = await tx.get('questionVersion', attempt.questionVersionId);
  ensure(question, 'QUESTION_NOT_FOUND');
  const ref = async (id: string) => {
    const a = await tx.get('storedAsset', id);
    ensure(a, 'ASSET_NOT_FOUND');
    return { id: a.id, version: 'original', mime: a.mime };
  };
  const id = crypto.randomUUID();
  const bundle = attempt.geometryAnswer ? exportGeometryBundle(attempt.geometryAnswer) : undefined;
  const problemDocument = question.geometryDocument && { ...question.geometryDocument };
  if (problemDocument) delete problemDocument.constructionAnimation;
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
    ...(bundle
      ? {
          geometryEvidence: {
            schemaVersion: bundle.document.schemaVersion,
            editorType: bundle.document.editorType,
            problemDocument,
            answerDocument: bundle.document,
            derivedRelations: bundle.derivedRelations,
            narrative: bundle.narrative,
          },
        }
      : {}),
    imageOptions: { maxDimension: 2000, rotate: 0, crop: null },
    strategyVersion: 'geometry-v1',
    promptVersion: bundle
      ? bundle.document.schemaVersion === 'tuheng.geometry/3.0.0'
        ? 'geometry-review/1.5.0'
        : bundle.document.schemaVersion === 'tuheng.geometry/2.2.0'
          ? 'geometry-review/1.4.0'
          : bundle.document.schemaVersion === 'tuheng.geometry/2.1.0'
            ? 'geometry-review/1.3.0'
            : bundle.document.schemaVersion === 'tuheng.geometry/2.0.0'
              ? 'geometry-review/1.2.0'
              : 'geometry-review/1.1.0'
      : 'geometry-review/1.0.0',
    modelConfigId: null,
  });
  const taskKey = attempt.source === 'ASSIGNMENT' ? 'grading.assignment' : 'grading.selftest';
  const plan = await planAIInvocation(tx, taskKey, request);
  request.modelConfigId = plan.snapshot?.bindingId ?? null;
  const owner = await tx.get('user', attempt.ownerId);
  const status = plan.snapshot ? 'QUEUED' : 'BLOCKED_CONFIG';
  const run = await tx.create('gradingRun', {
    id,
    attemptId: attempt.id,
    configId: null,
    status,
    errorCode: plan.errorCode,
    strategyVersion: request.strategyVersion,
    promptVersion: request.promptVersion,
    request,
  });
  const lane = attempt.source === 'ASSIGNMENT' ? 'formal' : 'selftest';
  await tx.create('aIInvocation', {
    runId: id,
    taskKey,
    actorId: attempt.ownerId,
    schoolId: owner?.schoolId ?? null,
    resourceId: attempt.id,
    ...(plan.snapshot ? { snapshot: plan.snapshot } : {}),
    status,
    errorCode: plan.errorCode,
  });
  await tx.create('backgroundJob', { runId: id, lane, status, errorCode: plan.errorCode });
  await tx.create('outboxEvent', { runId: id, lane });
  return run;
}
export async function saveDraft(
  db: DataPort,
  a: Actor,
  itemId: string,
  assetIds: string[],
  geometry?: unknown,
) {
  return db.transaction(async (tx) => {
    const { context, questionVersionId } = await answerStorageContext(tx, a, {
      kind: 'ASSIGNMENT_ANSWER',
      itemId,
    });
    await bindUploadedAssets(tx, a, assetIds, context);
    const question = await tx.get('questionVersion', questionVersionId);
    const draftGeometry = validateAnswerGeometry(question?.geometryDocument, geometry);
    const s = (await tx.list('submission', { userId: a.id, itemId }))[0];
    return s
      ? tx.update('submission', s.id, {
          draftAssetIds: assetIds,
          ...(draftGeometry ? { draftGeometry } : {}),
        })
      : tx.create('submission', {
          userId: a.id,
          itemId,
          draftAssetIds: assetIds,
          ...(draftGeometry ? { draftGeometry } : {}),
        });
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
    geometry?: unknown;
  },
  quota = 20,
) {
  ensure(
    (input.assetIds.length > 0 || input.geometry != null) && input.assetIds.length <= 10,
    'ANSWER_EVIDENCE_REQUIRED',
  );
  ensure(
    [input.itemId, input.selfTestItemId, input.reviewEntryId].filter(Boolean).length === 1,
    'ANSWER_TARGET_REQUIRED',
  );
  return db.transaction(async (tx) => {
    const prior = (
      await tx.list('submissionAttempt', { ownerId: a.id, idempotencyKey: input.idempotencyKey })
    )[0];
    if (prior) return prior;
    const { context, questionVersionId } = await answerStorageContext(
      tx,
      a,
      input.itemId
        ? { kind: 'ASSIGNMENT_ANSWER', itemId: input.itemId }
        : input.reviewEntryId
          ? { kind: 'REVIEW_ANSWER', entryId: input.reviewEntryId }
          : { kind: 'SELFTEST_ANSWER', itemId: input.selfTestItemId! },
    );
    await bindUploadedAssets(tx, a, input.assetIds, context);
    let submissionId: string | null = null,
      selfTestItemId: string | null = null,
      source = 'ASSIGNMENT',
      version = 1;
    if (context.kind === 'ASSIGNMENT_ANSWER') {
      const ass = await tx.get('assignment', context.assignmentId);
      ensure(ass, 'NOT_FOUND', 404);
      let s = (await tx.list('submission', { userId: a.id, itemId: context.itemId }))[0];
      if (!s)
        s = await tx.create('submission', {
          userId: a.id,
          itemId: context.itemId,
          draftAssetIds: [],
        });
      const attempts = await tx.list('submissionAttempt', { submissionId: s.id });
      ensure(attempts.length < ass.maxAttempts, 'ATTEMPT_LIMIT');
      version = Math.max(0, ...attempts.map((at) => at.version)) + 1;
      submissionId = s.id;
    } else {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const attempts = await tx.list('submissionAttempt', {
        ownerId: a.id,
        source: { in: ['SELFTEST', 'REVIEW'] },
        submittedAt: { gt: today },
      });
      ensure(attempts.length < quota, 'SELFTEST_QUOTA');
      source = context.kind === 'REVIEW_ANSWER' ? 'REVIEW' : 'SELFTEST';
      if (context.kind === 'SELFTEST_ANSWER') selfTestItemId = context.itemId;
    }
    const question = await tx.get('questionVersion', questionVersionId);
    const geometryAnswer = validateAnswerGeometry(question?.geometryDocument, input.geometry);
    ensure(
      input.assetIds.length ||
        geometryAnswer?.entities.some(
          (e) => geometryAnswer.layers.find((l) => l.id === e.layerId)?.role !== 'PROBLEM_STEM',
        ),
      'ANSWER_EVIDENCE_REQUIRED',
    );
    const attempt = await tx.create('submissionAttempt', {
      ownerId: a.id,
      submissionId,
      selfTestItemId,
      questionVersionId,
      source,
      version,
      idempotencyKey: input.idempotencyKey,
      storageContext: context,
      ...(geometryAnswer
        ? { geometryAnswer, geometrySchemaVersion: geometryAnswer.schemaVersion }
        : {}),
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
