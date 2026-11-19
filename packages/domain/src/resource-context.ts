import {
  AssetArchiveContext,
  AnswerStorageContext,
  type AssetUploadTarget,
} from '@tuheng/contracts';
import type { Actor, DataPort, Entities } from './entities';
import { requireSchoolScope } from './identity';
import { checkSubmissionWindow, ensure, requireAssignmentRecipient, requireRole } from './policy';
import { archiveAssetKey } from './resource-paths';

export async function questionScope(
  db: DataPort,
  actor: Actor,
  target: { questionId?: string; schoolId?: string | null; selfTest?: boolean },
) {
  const existing = target.questionId ? await db.get('question', target.questionId) : null;
  if (target.questionId) {
    ensure(
      existing?.ownerId === actor.id && existing.selfTest === !!target.selfTest,
      'QUESTION_FORBIDDEN',
      403,
    );
    ensure(
      target.schoolId === undefined || target.schoolId === existing.schoolId,
      'SCOPE_MISMATCH',
      403,
    );
  }
  requireRole(actor, ...(target.selfTest ? ['STUDENT'] : ['TEACHER', 'SCHOOL_ADMIN', 'ADMIN']));
  const schoolId = existing
    ? existing.schoolId
    : target.schoolId === undefined
      ? (actor.schoolId ?? null)
      : target.schoolId;
  if (schoolId) {
    requireSchoolScope(actor, schoolId);
    ensure((await db.get('school', schoolId))?.active, 'SCHOOL_DISABLED', 403);
  } else {
    ensure(actor.kind === 'SITE_ADMIN' || !actor.schoolId, 'SCHOOL_FORBIDDEN', 403);
  }
  return { existing, schoolId };
}

type AnswerTarget = Extract<AssetUploadTarget, { kind: AnswerStorageContext['kind'] }>;
export async function answerStorageContext(
  db: DataPort,
  actor: Actor,
  target: AnswerTarget,
  now = new Date(),
): Promise<{ context: AnswerStorageContext; questionVersionId: string }> {
  requireRole(actor, 'STUDENT');
  const base = { schoolId: actor.schoolId ?? null, userId: actor.id };
  switch (target.kind) {
    case 'ASSIGNMENT_ANSWER': {
      const item = await db.get('assignmentItem', target.itemId);
      const assignment = item && (await db.get('assignment', item.assignmentId));
      ensure(item && assignment, 'NOT_FOUND', 404);
      await requireAssignmentRecipient(db, actor, assignment);
      checkSubmissionWindow(assignment, now);
      ensure(!assignment.schoolId || assignment.schoolId === base.schoolId, 'SCOPE_MISMATCH', 403);
      return {
        context: { ...base, kind: target.kind, assignmentId: assignment.id, itemId: item.id },
        questionVersionId: item.questionVersionId,
      };
    }
    case 'SELFTEST_ANSWER': {
      const item = await db.get('selfTestItem', target.itemId);
      const set = item && (await db.get('selfTestSet', item.setId));
      ensure(item && set?.ownerId === actor.id, 'PRIVATE_SELFTEST', 403);
      return {
        context: { ...base, kind: target.kind, setId: set.id, itemId: item.id },
        questionVersionId: item.questionVersionId,
      };
    }
    case 'REVIEW_ANSWER': {
      const entry = await db.get('errorBookEntry', target.entryId);
      ensure(entry?.ownerId === actor.id && !entry.archived, 'FORBIDDEN', 403);
      return {
        context: { ...base, kind: target.kind, entryId: entry.id },
        questionVersionId: entry.questionVersionId,
      };
    }
  }
}

export async function uploadTargetSchool(db: DataPort, actor: Actor, target: AssetUploadTarget) {
  if (target.kind === 'QUESTION' || target.kind === 'REFERENCE')
    return (await questionScope(db, actor, target)).schoolId;
  if (target.kind === 'DOCUMENT') return actor.schoolId ?? null;
  return (await answerStorageContext(db, actor, target)).context.schoolId;
}

function acceptsUpload(session: Entities['assetUploadSession'], context: AssetArchiveContext) {
  const { target } = session;
  if (context.kind === 'GRADING_PROCESSED' || context.kind === 'AVATAR') return false;
  if (session.targetSchoolId !== context.schoolId) return false;
  if (context.kind === 'QUESTION')
    return (
      (target.kind === 'QUESTION' || target.kind === 'REFERENCE') &&
      context.selfTest === !!target.selfTest &&
      (!target.questionId || target.questionId === context.questionId)
    );
  if (context.kind === 'REVIEW_ANSWER')
    return target.kind === context.kind && target.entryId === context.entryId;
  if (context.kind === 'DOCUMENT') return target.kind === context.kind;
  return target.kind === context.kind && target.itemId === context.itemId;
}

/** Called in the same transaction as the first immutable reference or saved draft. */
export async function bindUploadedAssets(
  tx: DataPort,
  actor: Actor,
  ids: string[],
  context: AssetArchiveContext,
  reusableQuestionAssets: ReadonlySet<string> = new Set(),
) {
  ensure(new Set(ids).size === ids.length, 'DUPLICATE_ASSETS');
  const visited = new Set<string>();
  const answer = AnswerStorageContext.safeParse(context);
  const bind = async (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const asset = await tx.get('storedAsset', id);
    ensure(asset?.ownerId === actor.id, 'ASSET_FORBIDDEN', 403);
    ensure(
      context.kind === 'QUESTION'
        ? ['QUESTION', 'REFERENCE'].includes(asset.purpose)
        : context.kind === asset.purpose ||
            (answer.success &&
              ['ASSIGNMENT_ANSWER', 'SELFTEST_ANSWER', 'REVIEW_ANSWER'].includes(asset.purpose)),
      'ASSET_CONTEXT_MISMATCH',
      403,
    );
    ensure(['STAGED', 'ARCHIVING', 'ARCHIVED'].includes(asset.state), 'ASSET_UNAVAILABLE', 409);
    const targetKey = archiveAssetKey(context, id, asset.mime, asset.parentId);
    if (asset.storageContext) {
      const prior = AssetArchiveContext.parse(asset.storageContext);
      const archivedAnswer = AnswerStorageContext.safeParse(prior);
      ensure(
        archiveAssetKey(prior, id, asset.mime, asset.parentId) === targetKey ||
          (context.kind === 'QUESTION' &&
            prior.kind === 'QUESTION' &&
            reusableQuestionAssets.has(id) &&
            !context.selfTest &&
            !prior.selfTest &&
            context.schoolId === prior.schoolId) ||
          (answer.success &&
            archivedAnswer.success &&
            archivedAnswer.data.userId === answer.data.userId &&
            archivedAnswer.data.schoolId === answer.data.schoolId),
        'ASSET_CONTEXT_MISMATCH',
        409,
      );
      return;
    }
    ensure(asset.state === 'STAGED' && asset.uploadSessionId, 'ASSET_UNAVAILABLE', 409);
    const session = await tx.get('assetUploadSession', asset.uploadSessionId);
    ensure(
      session &&
        !session.cancelledAt &&
        session.expiresAt > new Date() &&
        session.ownerId === actor.id &&
        session.schoolId === (actor.schoolId ?? null),
      'UPLOAD_SESSION_EXPIRED',
      409,
    );
    ensure(acceptsUpload(session, context), 'ASSET_CONTEXT_MISMATCH', 403);
    if (asset.parentId) await bind(asset.parentId);
    await tx.update('storedAsset', id, {
      state: 'ARCHIVING',
      storageContext: context,
      discardAfter: null,
    });
    await tx.create('assetArchiveTask', {
      assetId: id,
      sourceKey: asset.objectKey,
      sourceChecksum: asset.checksum,
      targetKey,
    });
  };
  for (const id of ids) await bind(id);
}
