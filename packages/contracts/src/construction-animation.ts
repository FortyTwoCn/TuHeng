import { z } from 'zod';
import { EditorType, geometryId as id, Vec2 } from './geometry-values';

export const CONSTRUCTION_ANIMATION_VERSION = 'tuheng.construction-animation/1.0.0';
const title = z.string().trim().min(1).max(120);
const order = z.number().int().min(0).max(199);
const ids = z.array(id).max(2000);
const label = z.string().trim().min(1).max(80).optional();
export const constructionReferenceFields = [
  'entityIds',
  'constructionEntityIds',
  'eraseEntityIds',
] as const;

export const ConstructionAnimationPhase = z.object({ id, order, title }).strict();
export type ConstructionAnimationPhase = z.infer<typeof ConstructionAnimationPhase>;

export const ConstructionAnimationStep = z
  .object({
    id,
    order,
    phaseId: id.optional(),
    title,
    narration: z.string().trim().min(1).max(4000),
    kind: z.enum(['CENTERLINE', 'CONSTRUCT', 'DRAW', 'ERASE', 'DEEPEN']),
    entityIds: ids.describe('按笔顺排列的正式图元 ID，最先作图的实体排在最前。'),
    constructionEntityIds: ids.optional(),
    temporaryGuides: z
      .array(
        z
          .object({
            id,
            viewId: id.optional(),
            kind: z.enum(['PROJECTION', 'MITER', 'EXTENSION', 'ALIGNMENT']),
            from: Vec2,
            to: Vec2,
            label,
          })
          .strict(),
      )
      .max(120)
      .optional()
      .describe('统一图纸毫米坐标。viewId 用于标记所属视图。'),
    focusPoints: z
      .array(
        z
          .object({
            id,
            position: Vec2,
            kind: z.enum(['SPECIAL', 'GENERAL']),
            label,
          })
          .strict(),
      )
      .max(120)
      .optional(),
    eraseEntityIds: ids.optional(),
    highlightRole: z.literal('INTERSECTION_CURVE').optional(),
    durationMs: z.number().int().min(250).max(30000).optional(),
  })
  .strict();
export type ConstructionAnimationStep = z.infer<typeof ConstructionAnimationStep>;

type Issue = (path: (string | number)[], message: string) => void;

function unique(
  values: readonly string[],
  path: (string | number)[],
  issue: Issue,
  field?: string,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) issue([...path, index, ...(field ? [field] : [])], `ID「${value}」重复`);
    seen.add(value);
  });
}

export const ConstructionAnimationDocument = z
  .object({
    schemaVersion: z.literal(CONSTRUCTION_ANIMATION_VERSION),
    editorType: EditorType.optional(),
    title,
    description: z.string().trim().max(4000),
    phases: z.array(ConstructionAnimationPhase).max(64),
    steps: z.array(ConstructionAnimationStep).min(1).max(200),
  })
  .strict()
  .superRefine((animation, context) => {
    const issue: Issue = (path, message) => context.addIssue({ code: 'custom', path, message });
    for (const field of ['phases', 'steps'] as const) {
      unique(
        animation[field].map(({ id }) => id),
        [field],
        issue,
        'id',
      );
      animation[field].forEach(({ order }, index) => {
        if (order !== index)
          issue([field, index, 'order'], `顺序须从 0 连续递增，此处应为 ${index}`);
      });
    }
    const phases = new Set(animation.phases.map(({ id }) => id));
    animation.steps.forEach((step, index) => {
      const path = ['steps', index];
      if (step.phaseId && !phases.has(step.phaseId))
        issue([...path, 'phaseId'], `阶段「${step.phaseId}」不存在`);
      for (const field of constructionReferenceFields)
        unique(step[field] ?? [], [...path, field], issue);
      for (const field of ['temporaryGuides', 'focusPoints'] as const)
        unique(step[field]?.map(({ id }) => id) ?? [], [...path, field], issue, 'id');
      step.temporaryGuides?.forEach(({ from, to }, guideIndex) => {
        if (Math.hypot(from.x - to.x, from.y - to.y) < 1e-6)
          issue([...path, 'temporaryGuides', guideIndex, 'to'], '辅助线起点和终点必须不同');
      });
      if (step.kind !== 'ERASE' && step.eraseEntityIds?.length)
        issue([...path, 'eraseEntityIds'], '擦除对象只能用于擦除步骤');
    });
  });
export type ConstructionAnimationDocument = z.infer<typeof ConstructionAnimationDocument>;

/** 同一套跨对象验证用于独立文件、内嵌文档和 AI 结果。 */
export function checkConstructionAnimationReferences(
  animation: ConstructionAnimationDocument,
  drawing: {
    editorType: EditorType;
    entities: readonly { id: string }[];
    views: readonly { id: string }[];
  },
  issue: Issue,
) {
  if (animation.editorType && animation.editorType !== drawing.editorType)
    issue(
      ['editorType'],
      `动画类型 ${animation.editorType} 与图纸类型 ${drawing.editorType} 不一致`,
    );
  const entities = new Set(drawing.entities.map(({ id }) => id));
  const views = new Set(drawing.views.map(({ id }) => id));
  animation.steps.forEach((step, index) => {
    for (const field of constructionReferenceFields)
      step[field]?.forEach((id, refIndex) => {
        if (!entities.has(id)) issue(['steps', index, field, refIndex], `图纸实体「${id}」不存在`);
      });
    step.temporaryGuides?.forEach(({ viewId }, guideIndex) => {
      if (viewId && !views.has(viewId))
        issue(
          ['steps', index, 'temporaryGuides', guideIndex, 'viewId'],
          `图纸视图「${viewId}」不存在`,
        );
    });
  });
}

export function constructionAnimationJsonSchema() {
  return {
    ...z.toJSONSchema(ConstructionAnimationDocument, { target: 'draft-2020-12' }),
    title: '图衡分步作图动画 1.0',
    description:
      '阶段和步骤的 order 均从 0 连续递增。ID 唯一性、阶段归属和实体引用由图衡导入时校验。',
  };
}
