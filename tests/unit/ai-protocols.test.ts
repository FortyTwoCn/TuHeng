import { describe, it, expect } from 'vitest';
import {
  AnthropicMessagesProvider,
  OpenAICompatibleVisionProvider,
  parseMessagesResponse,
  parseChatResponse,
  providerURL,
} from '@tuheng/ai-providers';
import {
  AIProviderConfig,
  AIModelConfig,
  AITaskParameters,
  aiConfigurationError,
} from '@tuheng/contracts';
import { requiredGradingCapabilities } from '@tuheng/domain';
import { requestFixture } from '../fixtures';
const input = {
  system: 'system-instruction',
  user: 'evidence',
  schema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  },
  images: [
    {
      role: 'QUESTION' as const,
      assetId: 'a',
      version: '1',
      dataUrl: 'data:image/png;base64,AAAA',
    },
  ],
};
const base = {
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test-only',
  model: 'manual-model',
  timeoutMs: 1000,
  outputMode: 'json_schema' as const,
  maxOutputTokens: 512,
  temperature: null,
};
describe('AI protocol adapters use real protocol envelopes, without external service calls', () => {
  it('OpenAI uses Bearer, developer role, native JSON Schema, image_url and capability-selected token parameter', async () => {
    const p = new OpenAICompatibleVisionProvider(
      { ...base, systemRole: 'developer', tokenParameter: 'max_completion_tokens' },
      async (url, init) => {
        expect(url).toBe('https://example.invalid/v1/chat/completions');
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-only' });
        const b = JSON.parse(String(init?.body));
        expect(b.max_completion_tokens).toBe(512);
        expect(b).not.toHaveProperty('temperature');
        expect(b.messages[0]).toEqual({ role: 'developer', content: input.system });
        expect(b.messages[1].content.at(-1).image_url.url).toBe(input.images[0].dataUrl);
        expect(b.response_format.json_schema.schema).toEqual(input.schema);
        return Response.json({
          model: 'real-returned-model',
          choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
        });
      },
    );
    expect(await p.evaluate(input)).toMatchObject({
      data: { ok: true },
      inputTokens: null,
      outputTokens: null,
    });
  });
  it('Anthropic uses separate system, x-api-key/version, base64 image blocks, required max_tokens and output_config', async () => {
    const p = new AnthropicMessagesProvider(base, async (url, init) => {
      expect(url).toBe('https://example.invalid/v1/messages');
      expect(init?.headers).toMatchObject({
        'x-api-key': 'test-only',
        'anthropic-version': '2023-06-01',
      });
      expect(init?.headers).not.toHaveProperty('Authorization');
      const b = JSON.parse(String(init?.body));
      expect(b.system).toBe(input.system);
      expect(b.max_tokens).toBe(512);
      expect(b).not.toHaveProperty('response_format');
      expect(b.output_config.format.schema).toEqual(input.schema);
      expect(b.messages[0].content.at(-1)).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
      });
      return Response.json({
        model: 'm',
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', text: 'hidden' },
          { type: 'text', text: '{"ok":true}' },
        ],
        usage: { input_tokens: 12, output_tokens: 4 },
      });
    });
    expect(await p.evaluate(input)).toMatchObject({
      data: { ok: true },
      inputTokens: 12,
      outputTokens: 4,
    });
  });
  it('handles refusals, truncation, unsupported tool stops and invalid JSON without numeric extraction', () => {
    for (const [finish, code] of [
      ['length', 'MODEL_TRUNCATED'],
      ['content_filter', 'MODEL_REFUSED'],
      ['tool_calls', 'MODEL_STOP_UNSUPPORTED'],
    ])
      expect(() =>
        parseChatResponse(
          { choices: [{ finish_reason: finish, message: { content: '{"ok":true}' } }] },
          'm',
          1,
        ),
      ).toThrow(code);
    for (const [stop, code] of [
      ['max_tokens', 'MODEL_TRUNCATED'],
      ['refusal', 'MODEL_REFUSED'],
      ['tool_use', 'MODEL_STOP_UNSUPPORTED'],
    ])
      expect(() =>
        parseMessagesResponse(
          { model: 'm', stop_reason: stop, content: [{ type: 'text', text: '{"ok":true}' }] },
          'm',
          1,
        ),
      ).toThrow(code);
    expect(() =>
      parseChatResponse(
        { choices: [{ finish_reason: 'stop', message: { content: 'grade: 90' } }] },
        'm',
        1,
      ),
    ).toThrow('INVALID_JSON');
  });
  it('requires image capability for all evidence, rejects invalid parameters and keeps optional temperature absent', () => {
    const request = requestFixture();
    request.submissionAssets = [];
    request.question.assets = [{ id: 'stem', version: '1', mime: 'image/png' }];
    expect(requiredGradingCapabilities(request).images).toBe(true);
    const provider = AIProviderConfig.parse({
        baseUrl: base.baseUrl,
        protocol: 'ANTHROPIC_MESSAGES',
      }),
      model = AIModelConfig.parse({ model: 'm', outputModes: ['json_object', 'prompt_json'] });
    expect(
      aiConfigurationError(
        provider,
        model,
        AITaskParameters.parse({ outputMode: 'prompt_json' }),
        true,
      ),
    ).toBe('AI_CAPABILITY_MISMATCH');
    expect(
      aiConfigurationError(
        provider,
        model,
        AITaskParameters.parse({ outputMode: 'json_object' }),
        false,
      ),
    ).toBe('AI_PROTOCOL_OUTPUT_UNSUPPORTED');
    expect(
      aiConfigurationError(
        provider,
        model,
        AITaskParameters.parse({ outputMode: 'prompt_json', temperature: 0 }),
        false,
      ),
    ).toBe('AI_PARAMETER_UNSUPPORTED');
  });
  it('joins API prefix once and rejects injected host/query credentials', () => {
    expect(
      providerURL({ ...base, baseUrl: 'https://example.invalid/v1/messages' }, '/messages'),
    ).toBe('https://example.invalid/v1/messages');
    expect(() => providerURL({ ...base, endpoint: '//metadata' }, '/messages')).toThrow(
      'INVALID_PROVIDER_ENDPOINT',
    );
    expect(() =>
      providerURL({ ...base, baseUrl: 'https://secret@example.invalid/v1' }, '/messages'),
    ).toThrow('INVALID_PROVIDER_URL');
  });
});
