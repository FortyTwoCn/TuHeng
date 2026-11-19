import type { AnswerStorageContext, AssetArchiveContext } from '@tuheng/contracts';
import { ensure } from './policy';

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
function part(id: string) {
  ensure(id && id !== '.' && id !== '..', 'INVALID_RESOURCE_ID');
  return encodeURIComponent(id);
}
function scopeRoot(schoolId: string | null) {
  return schoolId === null ? 'private/platform' : `private/schools/${part(schoolId)}`;
}
function accountRoot(schoolId: string | null, userId: string) {
  return `${scopeRoot(schoolId)}/users/${part(userId)}`;
}
function answerRoot(answer: AnswerStorageContext) {
  const root = accountRoot(answer.schoolId, answer.userId);
  switch (answer.kind) {
    case 'ASSIGNMENT_ANSWER':
      return `${root}/assignments/${part(answer.assignmentId)}/items/${part(answer.itemId)}`;
    case 'SELFTEST_ANSWER':
      return `${root}/self-tests/${part(answer.setId)}/items/${part(answer.itemId)}`;
    case 'REVIEW_ANSWER':
      return `${root}/error-book/${part(answer.entryId)}`;
  }
}
function filename(id: string, mime: string) {
  const ext = extensions[mime];
  ensure(ext, 'UNSUPPORTED_ASSET_FORMAT');
  return `${part(id)}.${ext}`;
}
export function stagingKey(
  schoolId: string | null,
  userId: string,
  batchId: string,
  id: string,
  mime: string,
) {
  return `${accountRoot(schoolId, userId)}/staging/${part(batchId)}/${filename(id, mime)}`;
}
export function archiveAssetKey(
  context: AssetArchiveContext,
  assetId: string,
  mime: string,
  parentId: string | null = null,
) {
  if (context.kind === 'AVATAR') {
    const name =
      context.variant === 'original' ? filename('original', mime) : `${context.variant}.webp`;
    return `${accountRoot(context.schoolId, context.userId)}/avatars/${part(context.versionId)}/${name}`;
  }
  if (context.kind === 'DOCUMENT') {
    const root = `${accountRoot(context.schoolId, context.userId)}/documents/${part(context.documentId)}`;
    return parentId
      ? `${root}/edits/${filename(assetId, mime)}`
      : `${root}/${filename('original', mime)}`;
  }
  if (context.kind === 'GRADING_PROCESSED') {
    ensure(parentId && mime === 'image/png', 'INVALID_PROCESSED_ASSET');
    return `${answerRoot(context.answer)}/attempts/${part(context.attemptId)}/grading-runs/${part(context.runId)}/processed/${part(parentId)}/${filename(assetId, mime)}`;
  }
  const root =
    context.kind === 'QUESTION'
      ? `${scopeRoot(context.schoolId)}/question-bank/questions/${part(context.questionId)}`
      : answerRoot(context);
  return parentId
    ? `${root}/assets/edits/${part(parentId)}/${filename(assetId, mime)}`
    : `${root}/assets/originals/${filename(assetId, mime)}`;
}
export function archiveScope(context: AssetArchiveContext) {
  const subject = context.kind === 'GRADING_PROCESSED' ? context.answer : context;
  return {
    storageSchoolId: subject.schoolId,
    storageSubjectUserId: subject.kind === 'QUESTION' ? null : subject.userId,
  };
}
