import { z } from 'zod';
export const Points = z.number().int().min(0).max(100000);
export const Role = z.enum([
  'STUDENT',
  'TEACHER',
  'TEACHING_ASSISTANT',
  'COURSE_MANAGER',
  'ADMIN',
  'PLATFORM_OPERATOR',
]);
export type Role = z.infer<typeof Role>;
export const AssetRef = z.object({
  id: z.string(),
  version: z.string().default('original'),
  mime: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
});
export type AssetRef = z.infer<typeof AssetRef>;
export const Criterion = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  maxPoints: Points.positive(),
  knowledgeIds: z.array(z.string()),
  correctness: z.string().min(1),
  partialCredit: z.string(),
  deductions: z.string(),
  deductionCap: Points.nullable().default(null),
});
export const Rubric = z
  .object({ version: z.string(), maxPoints: Points.positive(), items: z.array(Criterion).min(1) })
  .superRefine((v, c) => {
    if (v.items.reduce((s, i) => s + i.maxPoints, 0) !== v.maxPoints)
      c.addIssue({ code: 'custom', message: '评分项满分合计必须等于题目满分' });
    if (new Set(v.items.map((i) => i.id)).size !== v.items.length)
      c.addIssue({ code: 'custom', message: '评分项 ID 重复' });
    for (const i of v.items)
      if (i.deductionCap !== null && i.deductionCap > i.maxPoints)
        c.addIssue({ code: 'custom', message: '扣分上限超过评分项满分' });
  });
export type Rubric = z.infer<typeof Rubric>;
export const Reference = z.object({
  version: z.string(),
  content: z.string(),
  assetIds: z.array(z.string()),
  verified: z.boolean(),
  source: z.enum(['TEACHER', 'STUDENT', 'AI_UNVERIFIED']),
});
const Position = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const AnnotationBase = {
  id: z.string(),
  assetId: z.string(),
  assetVersion: z.string(),
  errorId: z.string().nullable(),
  category: z.enum(['ERROR', 'GUIDE', 'CORRECT']),
  text: z.string().max(2000),
};
export const Annotation = z.discriminatedUnion('kind', [
  z.object({ ...AnnotationBase, kind: z.literal('point'), point: Position }),
  z.object({ ...AnnotationBase, kind: z.literal('rectangle'), from: Position, to: Position }),
  z.object({ ...AnnotationBase, kind: z.literal('line'), from: Position, to: Position }),
  z.object({ ...AnnotationBase, kind: z.literal('polyline'), points: z.array(Position).min(2) }),
  z.object({ ...AnnotationBase, kind: z.literal('text'), point: Position }),
]);
export type Annotation = z.infer<typeof Annotation>;
export const QuestionInput = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(12000),
  type: z.enum([
    'POINT_PROJECTION',
    'LINE_PROJECTION',
    'PLANE_PROJECTION',
    'PROJECTION_RELATION',
    'THREE_VIEWS',
    'GEOMETRIC_CONSTRUCTION',
    'OTHER',
  ]),
  chapter: z.string().max(200),
  knowledgeIds: z.array(z.string()).max(20),
  assetIds: z.array(z.string()).max(10),
  reference: Reference,
  rubric: Rubric,
  confirmed: z.boolean(),
});
export type QuestionInput = z.infer<typeof QuestionInput>;
export const GradingRequest = z.object({
  contractVersion: z.literal('1'),
  runId: z.string(),
  question: z.object({
    id: z.string(),
    version: z.number().int(),
    title: z.string(),
    content: z.string(),
    type: z.string(),
    assets: z.array(AssetRef),
    knowledgeIds: z.array(z.string()),
  }),
  reference: Reference.extend({ assets: z.array(AssetRef) }),
  rubric: Rubric,
  submissionAssets: z.array(AssetRef).min(1),
  imageOptions: z.object({
    maxDimension: z.number().int().min(512).max(3000),
    rotate: z.number(),
    crop: z
      .object({ left: z.number(), top: z.number(), width: z.number(), height: z.number() })
      .nullable(),
  }),
  strategyVersion: z.literal('geometry-v1'),
  promptVersion: z.literal('geometry-review/1.0.0'),
  modelConfigId: z.string(),
  teacherRequirements: z.string().max(4000).optional(),
});
export type GradingRequest = z.infer<typeof GradingRequest>;
export const Analysis = z.object({
  requirements: z.array(z.string()),
  objects: z.array(z.string()),
  knownConditions: z.array(z.string()),
  relations: z.array(z.string()),
  referenceSteps: z.array(z.string()),
  equivalentMethods: z.array(z.string()),
  warnings: z.array(z.string()),
});
export const Diagnosis = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(['GEOMETRY', 'PROJECTION', 'LINE_STYLE', 'DIMENSION', 'INCOMPLETE', 'OTHER']),
  criterionId: z.string(),
  knowledgeIds: z.array(z.string()),
  evidence: z.string(),
  explanation: z.string(),
  correctRelation: z.string(),
  suggestion: z.string(),
  severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']),
  causeId: z.string(),
  requiresConfirmation: z.boolean(),
});
export const ModelEvaluation = z.object({
  analysis: Analysis,
  status: z.enum([
    'JUDGED',
    'UNCERTAIN',
    'POOR_IMAGE',
    'BAD_REFERENCE',
    'UNCLEAR_RUBRIC',
    'UNREADABLE',
  ]),
  items: z.array(
    z.object({
      criterionId: z.string(),
      points: Points.nullable(),
      evidence: z.string(),
      explanation: z.string(),
    }),
  ),
  totalPoints: Points.nullable(),
  correctParts: z.array(z.string()),
  errors: z.array(Diagnosis),
  annotations: z.array(Annotation),
  confidence: z.number().min(0).max(1),
  guidance: z.string(),
});
export type ModelEvaluation = z.infer<typeof ModelEvaluation>;
export const GradingResult = z.object({
  contractVersion: z.literal('1'),
  runId: z.string(),
  status: ModelEvaluation.shape.status,
  totalPoints: Points.nullable(),
  maxPoints: Points,
  items: z.array(
    z.object({
      criterionId: z.string(),
      points: Points.nullable(),
      maxPoints: Points,
      evidence: z.string(),
      explanation: z.string(),
    }),
  ),
  correctParts: z.array(z.string()),
  errors: z.array(Diagnosis),
  annotations: z.array(Annotation),
  analysis: Analysis,
  knowledgePerformance: z.array(
    z.object({
      knowledgeId: z.string(),
      earned: Points.nullable(),
      possible: Points,
      evidence: z.array(z.string()),
    }),
  ),
  requiresReview: z.boolean(),
  reviewReasons: z.array(z.string()),
  guidance: z.string(),
  versions: z.object({
    model: z.string(),
    config: z.string(),
    prompt: z.string(),
    preprocessing: z.string(),
    strategy: z.string(),
  }),
  usage: z.object({
    durationMs: z.number(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
  }),
});
export type GradingResult = z.infer<typeof GradingResult>;
export interface VisionImage {
  role: 'QUESTION' | 'REFERENCE' | 'SUBMISSION';
  assetId: string;
  version: string;
  dataUrl: string;
}
export interface ProviderResponse {
  data: unknown;
  raw: unknown;
  model: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface VisionProvider {
  evaluate(input: {
    system: string;
    user: string;
    images: VisionImage[];
    schema: Record<string, unknown>;
  }): Promise<ProviderResponse>;
}
export const ScoreDecisionInput = z.object({
  attemptId: z.string(),
  items: z.array(
    z.object({ criterionId: z.string(), points: Points, evidence: z.string().min(1) }),
  ),
  feedback: z.string().min(1).max(12000),
  annotations: z.array(Annotation).max(100),
  aiIncorrect: z.boolean().default(false),
});
export const formatPoints = (p: number | null | undefined) =>
  p == null ? '待判断' : (p / 10).toFixed(1);
