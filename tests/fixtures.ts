import { GradingRequest, ModelEvaluation } from '@tuheng/contracts';
export function requestFixture() {
  return GradingRequest.parse({
    contractVersion: '1',
    runId: 'run-test',
    question: {
      id: 'q',
      version: 1,
      title: '点的三面投影',
      content: '已知 a、a′，作 a″，满足长对正、高平齐、宽相等。',
      type: 'POINT_PROJECTION',
      assets: [],
      knowledgeIds: ['point'],
    },
    reference: {
      version: 'ref1',
      content: '三面投影对应关系正确',
      assetIds: [],
      assets: [],
      verified: true,
      source: 'TEACHER',
    },
    rubric: {
      version: 'rubric1',
      maxPoints: 100,
      items: [
        {
          id: 'geometry',
          name: '投影关系',
          maxPoints: 80,
          knowledgeIds: ['point'],
          correctness: '投影关系正确',
          partialCredit: '步骤部分正确可得分',
          deductions: '独立根因扣分',
          deductionCap: null,
        },
        {
          id: 'drawing',
          name: '图线规范',
          maxPoints: 20,
          knowledgeIds: ['point'],
          correctness: '辅助线保留',
          partialCredit: '局部正确',
          deductions: '图线错误',
          deductionCap: null,
        },
      ],
    },
    submissionAssets: [{ id: 'answer', version: 'original', mime: 'image/png' }],
    imageOptions: { maxDimension: 2000, rotate: 0, crop: null },
    strategyVersion: 'geometry-v1',
    promptVersion: 'geometry-review/1.0.0',
    modelConfigId: 'config1',
  });
}
export function evaluationFixture() {
  return ModelEvaluation.parse({
    analysis: {
      requirements: ['求第三投影'],
      objects: ['点A'],
      knownConditions: ['两面投影'],
      relations: ['长对正、高平齐、宽相等'],
      referenceSteps: ['转移宽度'],
      equivalentMethods: ['45度辅助线或圆弧'],
      warnings: [],
    },
    status: 'JUDGED',
    items: [
      {
        criterionId: 'geometry',
        points: 76,
        evidence: '第三投影与正面投影高平齐，但宽度存在偏差',
        explanation: '宽度转移有局部误差',
      },
      {
        criterionId: 'drawing',
        points: 18,
        evidence: '两条辅助线有一条不够轻细',
        explanation: '图线需更规范',
      },
    ],
    totalPoints: 94,
    correctParts: ['高度对应正确'],
    errors: [
      {
        id: 'e1',
        name: '第三投影宽度偏差',
        category: 'PROJECTION',
        criterionId: 'geometry',
        knowledgeIds: ['point'],
        evidence: '第三投影宽度与水平投影不一致',
        explanation: '宽相等关系未满足',
        correctRelation: '第三投影宽度应与水平投影一致',
        suggestion: '通过45度辅助线转移宽度',
        severity: 'MINOR',
        causeId: 'width-transfer',
        requiresConfirmation: true,
      },
    ],
    annotations: [],
    confidence: 0.9,
    guidance: '核对宽度转移线，保留细辅助线。',
  });
}
