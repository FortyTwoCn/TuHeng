import type { VisionProvider, ProviderResponse } from '@tuheng/contracts';
import { type ModelConfig, providerPost, parseChatResponse } from './protocol';
export * from './protocol';
export * from './anthropic';
export class OpenAICompatibleVisionProvider implements VisionProvider {
  constructor(
    private config: ModelConfig,
    private transport: typeof fetch = fetch,
  ) {}
  async evaluate(input: Parameters<VisionProvider['evaluate']>[0]): Promise<ProviderResponse> {
    const c = this.config,
      started = Date.now();
    const response_format =
      c.outputMode === 'json_schema'
        ? {
            type: 'json_schema',
            json_schema: { name: 'tuheng_output', strict: true, schema: input.schema },
          }
        : c.outputMode === 'json_object'
          ? { type: 'json_object' }
          : undefined;
    const body = await providerPost(
      c,
      '/chat/completions',
      { Authorization: `Bearer ${c.apiKey}` },
      {
        model: c.model,
        ...(response_format ? { response_format } : {}),
        ...(c.temperature != null ? { temperature: c.temperature } : {}),
        ...(c.maxOutputTokens
          ? { [c.tokenParameter ?? 'max_completion_tokens']: c.maxOutputTokens }
          : {}),
        messages: [
          { role: c.systemRole ?? 'system', content: input.system },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${input.user}\nReturn JSON matching schema: ${JSON.stringify(input.schema)}`,
              },
              ...input.images.flatMap((i) => [
                { type: 'text', text: `${i.role} assetId=${i.assetId} version=${i.version}` },
                { type: 'image_url', image_url: { url: i.dataUrl, detail: 'high' } },
              ]),
            ],
          },
        ],
      },
      this.transport,
    );
    return parseChatResponse(body, c.model, Date.now() - started);
  }
}
// Tests must explicitly inject this adapter; production composition never imports it.
export class MockVisionProvider implements VisionProvider {
  constructor(private response: unknown) {
    if (process.env.NODE_ENV !== 'test') throw new Error('Mock Provider is test-only');
  }
  async evaluate(): Promise<ProviderResponse> {
    return {
      data: this.response,
      raw: { testOnly: true, response: this.response },
      model: 'MOCK_TEST_ONLY',
      durationMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}
