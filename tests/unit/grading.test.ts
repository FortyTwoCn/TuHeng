import { describe, it, expect } from 'vitest';
import { GradingRequest, GradingResult, Rubric } from '@tuheng/contracts';
import { validateEvaluation, GeometryGradingEngine } from '@tuheng/grading-core';
import {
  MockVisionProvider,
  OpenAICompatibleVisionProvider,
  parseChatResponse,
} from '@tuheng/ai-providers';
import { requestFixture, evaluationFixture } from '../fixtures';
const response = (data: unknown) => ({
  data,
  raw: data,
  model: 'unit-vision',
  durationMs: 12,
  inputTokens: 10,
  outputTokens: 20,
});
describe('independent grading core', () => {
  it('calculates integer tenths without float drift', () => {
    const r = validateEvaluation(requestFixture(), response(evaluationFixture()));
    expect(r.totalPoints).toBe(94);
    expect(r.versions.prompt).toBe('geometry-review/1.0.0');
    expect(r.requiresReview).toBe(true);
    GradingResult.parse(r);
  });
  it.each([
    [-1, 20],
    [81, 20],
    [50.5, 20],
  ])('rejects invalid score %s', (a, b) => {
    const e = evaluationFixture();
    e.items[0].points = a;
    e.items[1].points = b;
    expect(() => validateEvaluation(requestFixture(), response(e))).toThrow();
  });
  it('rejects rubric sums and duplicate IDs', () => {
    const r = requestFixture().rubric;
    r.maxPoints = 99;
    expect(() => Rubric.parse(r)).toThrow();
    r.maxPoints = 100;
    r.items[1].id = 'geometry';
    expect(() => Rubric.parse(r)).toThrow();
  });
  it('rejects missing and unknown criteria', () => {
    const e = evaluationFixture();
    e.items.pop();
    expect(() => validateEvaluation(requestFixture(), response(e))).toThrow(
      'MISSING_OR_UNKNOWN_CRITERIA',
    );
  });
  it('rejects malformed model output', () => {
    expect(() => validateEvaluation(requestFixture(), response({}))).toThrow('Invalid');
  });
  it('unknown criterion remains null, never zero', () => {
    const e = evaluationFixture();
    e.items[0].points = null;
    const r = validateEvaluation(requestFixture(), response(e));
    expect(r.totalPoints).toBeNull();
    expect(r.items[0].points).toBeNull();
  });
  it('missing evidence prevents automatic scoring', () => {
    const e = evaluationFixture();
    e.items[0].evidence = '';
    const r = validateEvaluation(requestFixture(), response(e));
    expect(r.items[0].points).toBeNull();
    expect(r.totalPoints).toBeNull();
  });
  it('recomputes inconsistent model total', () => {
    const e = evaluationFixture();
    e.totalPoints = 1;
    expect(validateEvaluation(requestFixture(), response(e)).totalPoints).toBe(94);
  });
  it('enforces deduction cap centrally', () => {
    const req = requestFixture();
    req.rubric.items[0].deductionCap = 2;
    expect(validateEvaluation(req, response(evaluationFixture())).items[0].points).toBe(78);
  });
  it('flags correlated deductions instead of double penalizing', () => {
    const e = evaluationFixture();
    e.errors.push({ ...e.errors[0], id: 'e2', criterionId: 'drawing' });
    const r = validateEvaluation(requestFixture(), response(e));
    expect(r.totalPoints).toBeNull();
    expect(r.reviewReasons.join()).toContain('重复扣分');
  });
  it.each(['POOR_IMAGE', 'UNREADABLE', 'BAD_REFERENCE', 'UNCLEAR_RUBRIC'] as const)(
    'does not score %s as zero',
    (status) => {
      const e = evaluationFixture();
      e.status = status;
      expect(validateEvaluation(requestFixture(), response(e)).totalPoints).toBeNull();
    },
  );
  it('marks unverified references and confidence for review', () => {
    const req = requestFixture();
    req.reference.verified = false;
    const e = evaluationFixture();
    e.confidence = 0.2;
    expect(validateEvaluation(req, response(e)).reviewReasons.length).toBeGreaterThan(1);
  });
  it('rejects mismatched knowledge', () => {
    const e = evaluationFixture();
    e.errors[0].knowledgeIds = ['unknown'];
    expect(() => validateEvaluation(requestFixture(), response(e))).toThrow('UNKNOWN_KNOWLEDGE');
  });
  it('filters annotations for unknown image versions', () => {
    const e = evaluationFixture();
    e.annotations = [
      {
        id: 'a',
        assetId: 'answer',
        assetVersion: 'wrong',
        kind: 'point',
        point: { x: 0.1, y: 0.2 },
        category: 'ERROR',
        errorId: 'e1',
        text: '定位',
      },
    ];
    expect(validateEvaluation(requestFixture(), response(e)).annotations).toHaveLength(0);
  });
  it('runs without Next/database/Redis', async () => {
    const engine = new GeometryGradingEngine(new MockVisionProvider(evaluationFixture()), {
      prepare: async () => ({
        images: [
          {
            role: 'SUBMISSION',
            assetId: 'answer',
            version: 'original',
            dataUrl: 'data:image/png;base64,TEST',
          },
        ],
        warnings: [],
        records: [],
      }),
    });
    expect((await engine.grade(requestFixture())).result.totalPoints).toBe(94);
  });
  it('propagates unreadable question assets', async () => {
    const engine = new GeometryGradingEngine(new MockVisionProvider(evaluationFixture()), {
      prepare: async () => {
        throw new Error('ASSET_UNREADABLE');
      },
    });
    await expect(engine.grade(requestFixture())).rejects.toThrow('ASSET_UNREADABLE');
  });
  it('rejects an empty image pipeline', async () => {
    const engine = new GeometryGradingEngine(new MockVisionProvider(evaluationFixture()), {
      prepare: async () => ({ images: [], warnings: [], records: [] }),
    });
    await expect(engine.grade(requestFixture())).rejects.toThrow('UNREADABLE_SUBMISSION');
  });
  it('contract rejects unknown strategy versions', () => {
    expect(() =>
      GradingRequest.parse({ ...requestFixture(), strategyVersion: 'unknown' }),
    ).toThrow();
  });
});
describe('visual provider boundary', () => {
  it('adapts string and content-array response formats', () => {
    for (const content of [
      JSON.stringify(evaluationFixture()),
      [{ type: 'text', text: JSON.stringify(evaluationFixture()) }],
    ])
      expect(parseChatResponse({ choices: [{ message: { content } }] }, 'm', 1).data).toEqual(
        evaluationFixture(),
      );
  });
  it('rejects invalid JSON and refusal', () => {
    expect(() =>
      parseChatResponse({ choices: [{ message: { content: 'no json' } }] }, 'm', 1),
    ).toThrow('INVALID_JSON');
    expect(() =>
      parseChatResponse({ choices: [{ message: { refusal: 'cannot' } }] }, 'm', 1),
    ).toThrow('MODEL_REFUSED');
  });
  it('never invokes model without credentials', async () => {
    const p = new OpenAICompatibleVisionProvider({
      baseUrl: 'https://unit.invalid',
      model: 'm',
      outputMode: 'json_object',
      timeoutMs: 10,
      apiKey: '',
    });
    await expect(p.evaluate({ system: '', user: '', images: [], schema: {} })).rejects.toThrow(
      'BLOCKED_CONFIG',
    );
  });
  it('adapts structured output modes and sends multiple images', async () => {
    for (const mode of ['json_object', 'json_schema'] as const) {
      let captured: Record<string, unknown> = {};
      const transport: typeof fetch = async (_u, init) => {
        captured = JSON.parse(String(init?.body));
        return Response.json({ choices: [{ message: { content: '{}' } }] });
      };
      const p = new OpenAICompatibleVisionProvider(
        {
          baseUrl: 'https://unit.invalid/v1',
          model: 'm',
          outputMode: mode,
          timeoutMs: 10,
          apiKey: 'TEST',
        },
        transport,
      );
      await p.evaluate({
        system: 's',
        user: 'u',
        images: [
          { role: 'QUESTION', assetId: 'a', version: 'original', dataUrl: 'data:one' },
          { role: 'SUBMISSION', assetId: 'b', version: 'original', dataUrl: 'data:two' },
        ],
        schema: { type: 'object' },
      });
      expect(captured.response_format).toMatchObject({ type: mode });
    }
  });
  it('classifies timeout and rate limit', async () => {
    const cfg = {
      baseUrl: 'https://unit.invalid',
      model: 'm',
      outputMode: 'json_object' as const,
      timeoutMs: 1,
      apiKey: 'TEST',
    };
    const input = { system: '', user: '', images: [], schema: {} };
    await expect(
      new OpenAICompatibleVisionProvider(cfg, async () => {
        throw new DOMException('timeout', 'TimeoutError');
      }).evaluate(input),
    ).rejects.toMatchObject({ code: 'MODEL_TIMEOUT', retryable: true });
    await expect(
      new OpenAICompatibleVisionProvider(
        cfg,
        async () => new Response('', { status: 429 }),
      ).evaluate(input),
    ).rejects.toMatchObject({ code: 'PROVIDER_HTTP_429', retryable: true });
  });
});
