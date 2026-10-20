import type { VisionProvider, ProviderResponse } from '@tuheng/contracts';
import { EnvHttpProxyAgent } from 'undici';
let proxyAgent: EnvHttpProxyAgent | undefined;
function proxyOptions() {
  if (!process.env.HTTPS_PROXY && !process.env.HTTP_PROXY) return {};
  proxyAgent ??= new EnvHttpProxyAgent();
  return { dispatcher: proxyAgent };
}
export class ProviderError extends Error {
  constructor(
    public code: string,
    public retryable: boolean,
  ) {
    super(code);
  }
}
export interface ModelConfig {
  baseUrl: string;
  model: string;
  outputMode: 'json_object' | 'json_schema';
  timeoutMs: number;
  apiKey: string;
}
export function parseChatResponse(
  body: unknown,
  model: string,
  durationMs: number,
): ProviderResponse {
  const b = body as {
    choices?: {
      message?: { content?: string | { type: string; text?: string }[]; refusal?: string };
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const m = b?.choices?.[0]?.message;
  if (!m || m.refusal) throw new ProviderError('MODEL_REFUSED', false);
  const content =
    typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text ?? '')
            .join('')
        : '';
  try {
    return {
      data: JSON.parse(content),
      raw: body,
      model: b.model ?? model,
      durationMs,
      inputTokens: b.usage?.prompt_tokens ?? null,
      outputTokens: b.usage?.completion_tokens ?? null,
    };
  } catch {
    throw new ProviderError('INVALID_JSON', false);
  }
}
export class OpenAICompatibleVisionProvider implements VisionProvider {
  constructor(
    private config: ModelConfig,
    private transport: typeof fetch = fetch,
  ) {}
  async evaluate(input: Parameters<VisionProvider['evaluate']>[0]): Promise<ProviderResponse> {
    if (!this.config.apiKey || !this.config.model) throw new ProviderError('BLOCKED_CONFIG', false);
    const url = new URL(this.config.baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new ProviderError('INVALID_PROVIDER_URL', false);
    const response_format =
      this.config.outputMode === 'json_schema'
        ? {
            type: 'json_schema',
            json_schema: { name: 'engineering_grading_v1', strict: true, schema: input.schema },
          }
        : { type: 'json_object' };
    const started = Date.now();
    try {
      const res = await this.transport(
        `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          ...proxyOptions(),
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(this.config.timeoutMs),
          redirect: 'error',
          body: JSON.stringify({
            model: this.config.model,
            temperature: 0,
            response_format,
            messages: [
              { role: 'system', content: input.system },
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
          }),
        },
      );
      if (!res.ok)
        throw new ProviderError(
          `PROVIDER_HTTP_${res.status}`,
          res.status === 429 || res.status >= 500,
        );
      return parseChatResponse(await res.json(), this.config.model, Date.now() - started);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (e instanceof Error && ['TimeoutError', 'AbortError'].includes(e.name))
        throw new ProviderError('MODEL_TIMEOUT', true);
      throw new ProviderError('MODEL_UNAVAILABLE', true);
    }
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
