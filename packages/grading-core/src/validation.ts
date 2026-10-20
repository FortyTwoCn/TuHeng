import {
  GradingResult,
  ModelEvaluation,
  type GradingRequest,
  type ProviderResponse,
} from '@tuheng/contracts';
export class GradingError extends Error {
  constructor(
    public code: string,
    message = code,
  ) {
    super(message);
  }
}
export function validateEvaluation(
  request: GradingRequest,
  response: ProviderResponse,
  qualityWarnings: string[] = [],
): GradingResult {
  const parsed = ModelEvaluation.safeParse(response.data);
  if (!parsed.success) throw new GradingError('INVALID_MODEL_OUTPUT', parsed.error.message);
  const raw = parsed.data;
  const expected = new Set(request.rubric.items.map((i) => i.id));
  if (
    raw.items.length !== expected.size ||
    new Set(raw.items.map((i) => i.criterionId)).size !== expected.size ||
    raw.items.some((i) => !expected.has(i.criterionId))
  )
    throw new GradingError('MISSING_OR_UNKNOWN_CRITERIA');
  const reasons = [...qualityWarnings];
  if (!request.reference.verified) reasons.push('参考答案未经教师确认');
  if (raw.status !== 'JUDGED') reasons.push(raw.status);
  if (raw.confidence < 0.8) reasons.push('模型自报把握不足，须人工核验（非校准准确率）');
  const causes = new Map<string, Set<string>>();
  for (const e of raw.errors) {
    if (!expected.has(e.criterionId)) throw new GradingError('UNKNOWN_ERROR_CRITERION');
    const k = request.rubric.items.find((i) => i.id === e.criterionId)!.knowledgeIds;
    if (e.knowledgeIds.some((id) => !k.includes(id))) throw new GradingError('UNKNOWN_KNOWLEDGE');
    if (!e.evidence.trim()) reasons.push('错误缺少证据');
    const set = causes.get(e.causeId) ?? new Set<string>();
    set.add(e.criterionId);
    causes.set(e.causeId, set);
  }
  const duplicate = new Set([...causes.values()].filter((s) => s.size > 1).flatMap((s) => [...s]));
  if (duplicate.size) reasons.push('相同根因涉及多个评分项，待复核排除重复扣分');
  const items = request.rubric.items.map((c) => {
    const v = raw.items.find((i) => i.criterionId === c.id)!;
    if (v.points !== null && v.points > c.maxPoints) throw new GradingError('SCORE_OUT_OF_RANGE');
    let points = v.points;
    if (
      points === null ||
      !v.evidence.trim() ||
      duplicate.has(c.id) ||
      ['UNREADABLE', 'POOR_IMAGE', 'BAD_REFERENCE', 'UNCLEAR_RUBRIC'].includes(raw.status)
    ) {
      points = null;
      reasons.push(`评分项「${c.name}」证据不足或无法判断`);
    }
    if (points !== null && c.deductionCap !== null && c.maxPoints - points > c.deductionCap) {
      points = c.maxPoints - c.deductionCap;
      reasons.push(`评分项「${c.name}」已应用扣分上限`);
    }
    return { ...v, points, maxPoints: c.maxPoints };
  });
  const totalPoints = items.some((i) => i.points === null)
    ? null
    : items.reduce((s, i) => s + i.points!, 0);
  if (raw.totalPoints !== totalPoints) reasons.push('模型合计与程序计算不一致，采用程序计算');
  const assets = new Map(request.submissionAssets.map((a) => [a.id, a.version]));
  const annotations = raw.annotations.filter((a) => {
    const valid =
      assets.get(a.assetId) === a.assetVersion &&
      (!a.errorId || raw.errors.some((e) => e.id === a.errorId));
    if (!valid) reasons.push('忽略了无法对应作答图版本的定位');
    return valid;
  });
  const knowledgePerformance = request.question.knowledgeIds.map((knowledgeId) => {
    const related = items.filter((i) =>
      request.rubric.items.find((c) => c.id === i.criterionId)!.knowledgeIds.includes(knowledgeId),
    );
    return {
      knowledgeId,
      earned:
        related.length && related.every((i) => i.points !== null)
          ? related.reduce((s, i) => s + i.points!, 0)
          : null,
      possible: related.reduce((s, i) => s + i.maxPoints, 0),
      evidence: related.map((i) => i.evidence).filter(Boolean),
    };
  });
  return GradingResult.parse({
    contractVersion: '1',
    runId: request.runId,
    status: raw.status,
    totalPoints,
    maxPoints: request.rubric.maxPoints,
    items,
    correctParts: raw.correctParts,
    errors: raw.errors,
    annotations,
    analysis: raw.analysis,
    knowledgePerformance,
    requiresReview: true,
    reviewReasons: [...new Set(reasons.length ? reasons : ['正式作业须教师确认'])],
    guidance: raw.guidance,
    versions: {
      model: response.model,
      config: request.modelConfigId,
      prompt: request.promptVersion,
      preprocessing: 'sharp-conservative/1.0.0',
      strategy: request.strategyVersion,
    },
    usage: {
      durationMs: response.durationMs,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    },
  });
}
