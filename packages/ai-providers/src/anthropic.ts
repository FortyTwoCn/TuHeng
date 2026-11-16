import type { VisionProvider } from '@tuheng/contracts';
import { type ModelConfig, ProviderError, providerPost, parseMessagesResponse } from './protocol';

export class AnthropicMessagesProvider implements VisionProvider {
  constructor(
    private config: ModelConfig,
    private transport: typeof fetch = fetch,
  ) {}
  async evaluate(input: Parameters<VisionProvider['evaluate']>[0]) {
    const c = this.config;
    if (c.outputMode === 'json_object')
      throw new ProviderError('AI_PROTOCOL_OUTPUT_UNSUPPORTED', false);
    const images = input.images.flatMap((image) => {
      const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(
        image.dataUrl,
      );
      if (!match) throw new ProviderError('IMAGE_FORMAT_UNSUPPORTED', false);
      return [
        { type: 'text', text: `${image.role} assetId=${image.assetId} version=${image.version}` },
        { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } },
      ];
    });
    const started = Date.now();
    const auth: Record<string, string> =
      c.anthropicAuthentication === 'BEARER'
        ? { Authorization: `Bearer ${c.apiKey}` }
        : { 'x-api-key': c.apiKey };
    const body = await providerPost(
      c,
      '/messages',
      { ...auth, 'anthropic-version': c.anthropicVersion ?? '2023-06-01' },
      {
        model: c.model,
        system: input.system,
        max_tokens: c.maxOutputTokens ?? 4096,
        ...(c.temperature != null ? { temperature: c.temperature } : {}),
        ...(c.outputMode === 'json_schema'
          ? { output_config: { format: { type: 'json_schema', schema: input.schema } } }
          : {}),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${input.user}\nReturn JSON matching schema: ${JSON.stringify(input.schema)}`,
              },
              ...images,
            ],
          },
        ],
      },
      this.transport,
    );
    return parseMessagesResponse(body, c.model, Date.now() - started);
  }
}
