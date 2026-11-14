import { z } from 'zod';
import {
  GradingRequest,
  ModelEvaluation,
  GeometryAnnotation,
  type VisionProvider,
  type VisionImage,
  type GradingResult,
} from '@tuheng/contracts';
import { PROMPTS } from './prompts';
import { GradingError, validateEvaluation } from './validation';
export { GradingError, validateEvaluation } from './validation';
export { PROMPTS } from './prompts';
export interface ImagePreprocessor {
  prepare(
    request: GradingRequest,
  ): Promise<{ images: VisionImage[]; warnings: string[]; records: unknown[] }>;
}
export interface GradingEngine {
  grade(
    request: GradingRequest,
  ): Promise<{ result: GradingResult; raw: unknown; processedAssets: unknown[] }>;
}
// Logical stages deliberately share one visual request in v1. Stages may be replaced independently.
export const QuestionAnalysis = (r: GradingRequest) => ({
  title: r.question.title,
  content: r.question.content,
  type: r.question.type,
  knowledgeIds: r.question.knowledgeIds,
});
export const ReferenceAnalysis = (r: GradingRequest) => r.reference;
export const RubricResolution = (r: GradingRequest) => r.rubric;
export const SubmissionAnalysis = (images: VisionImage[]) =>
  images.filter((i) => i.role === 'SUBMISSION');
export class GeometryGradingEngine implements GradingEngine {
  constructor(
    private provider: VisionProvider,
    private images: ImagePreprocessor,
  ) {}
  async grade(input: GradingRequest) {
    const request = GradingRequest.parse(input);
    const prompt = PROMPTS[request.promptVersion];
    if (!prompt) throw new GradingError('UNKNOWN_PROMPT_VERSION');
    const processed = await this.images.prepare(request);
    if (!SubmissionAnalysis(processed.images).length && !request.geometryEvidence)
      throw new GradingError('UNREADABLE_SUBMISSION');
    const response = await this.provider.evaluate({
      system: prompt,
      user: JSON.stringify({
        question: QuestionAnalysis(request),
        reference: ReferenceAnalysis(request),
        rubric: RubricResolution(request),
        teacherRequirements: request.teacherRequirements,
        geometryEvidence: request.geometryEvidence,
        images: processed.images.map(({ role, assetId, version }) => ({ role, assetId, version })),
      }),
      images: processed.images,
      schema: z.toJSONSchema(
        request.geometryEvidence
          ? ModelEvaluation.extend({ geometryAnnotations: z.array(GeometryAnnotation).max(100) })
          : ModelEvaluation.omit({ geometryAnnotations: true }),
      ) as Record<string, unknown>,
    });
    return {
      result: validateEvaluation(request, response, processed.warnings),
      raw: response.raw,
      processedAssets: processed.records,
    };
  }
}
