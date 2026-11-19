import { z } from 'zod';

const id = z.string().min(1).max(200);
const questionTarget = {
  schoolId: id.nullish(),
  questionId: id.optional(),
  selfTest: z.literal(true).optional(),
};

export const AssetUploadTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('QUESTION'), ...questionTarget }),
  z.strictObject({ kind: z.literal('REFERENCE'), ...questionTarget }),
  z.strictObject({ kind: z.literal('ASSIGNMENT_ANSWER'), itemId: id }),
  z.strictObject({ kind: z.literal('SELFTEST_ANSWER'), itemId: id }),
  z.strictObject({ kind: z.literal('REVIEW_ANSWER'), entryId: id }),
  z.strictObject({ kind: z.literal('DOCUMENT') }),
]);
export type AssetUploadTarget = z.infer<typeof AssetUploadTarget>;

const answerScope = { schoolId: id.nullable(), userId: id };
export const AnswerStorageContext = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ASSIGNMENT_ANSWER'), ...answerScope, assignmentId: id, itemId: id }),
  z.object({ kind: z.literal('SELFTEST_ANSWER'), ...answerScope, setId: id, itemId: id }),
  z.object({ kind: z.literal('REVIEW_ANSWER'), ...answerScope, entryId: id }),
]);
export type AnswerStorageContext = z.infer<typeof AnswerStorageContext>;
export const AssetArchiveContext = z.union([
  z.object({
    kind: z.literal('QUESTION'),
    schoolId: id.nullable(),
    questionId: id,
    selfTest: z.boolean(),
  }),
  AnswerStorageContext,
  z.object({ kind: z.literal('DOCUMENT'), ...answerScope, documentId: id }),
  z.object({
    kind: z.literal('AVATAR'),
    ...answerScope,
    versionId: id,
    variant: z.enum(['original', 'small', 'large']),
  }),
  z.object({
    kind: z.literal('GRADING_PROCESSED'),
    answer: AnswerStorageContext,
    attemptId: id,
    runId: id,
  }),
]);
export type AssetArchiveContext = z.infer<typeof AssetArchiveContext>;
export type AssetPurpose = AssetUploadTarget['kind'] | 'AVATAR' | 'GRADING_PROCESSED';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MAX_PIXELS = 16_000_000;
export const AvatarCrop = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  zoom: z.number().min(1).max(4),
});
export type AvatarCrop = z.infer<typeof AvatarCrop>;

export function avatarCropBox(width: number, height: number, crop: AvatarCrop) {
  const edge = Math.max(1, Math.floor(Math.min(width, height) / crop.zoom));
  return {
    edge,
    left: Math.round((width - edge) * crop.x),
    top: Math.round((height - edge) * crop.y),
  };
}
