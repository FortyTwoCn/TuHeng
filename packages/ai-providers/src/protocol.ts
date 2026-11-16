import { z } from 'zod';
import type { AIOutputMode, ProviderResponse } from '@tuheng/contracts';

export class ProviderError extends Error {
  constructor(
    public code: string,
    public retryable: boolean,
    public billingUncertain = false,
  ) {
    super(code);
  }
}
export interface ModelConfig {
  baseUrl: string;
  model: string;
  outputMode: z.infer<typeof AIOutputMode>;
  timeoutMs: number;
  apiKey: string;
  endpoint?: string | null;
  temperature?: number | null;
  maxOutputTokens?: number;
  tokenParameter?: 'max_tokens' | 'max_completion_tokens';
  systemRole?: 'system' | 'developer';
  anthropicVersion?: '2023-06-01' | '2026-10-21';
  anthropicAuthentication?: 'X_API_KEY' | 'BEARER';
}
export function providerURL(config: ModelConfig, defaultEndpoint: string) {
  const base = new URL(config.baseUrl);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new ProviderError('INVALID_PROVIDER_URL', false);
  const endpoint = config.endpoint ?? defaultEndpoint;
  if (!/^\/[a-zA-Z0-9_/-]+$/.test(endpoint) || endpoint.startsWith('//'))
    throw new ProviderError('INVALID_PROVIDER_ENDPOINT', false);
  const prefix = base.pathname.replace(/\/$/, '');
  // Base URL includes the API prefix (e.g. /v1); an override is relative to that prefix.
  base.pathname = prefix.endsWith(endpoint) ? prefix : `${prefix}${endpoint}`;
  return base.href;
}
export async function providerPost(
  config: ModelConfig,
  endpoint: string,
  headers: Record<string, string>,
  body: unknown,
  transport: typeof fetch,
) {
  if (!config.apiKey || !config.model) throw new ProviderError('BLOCKED_CONFIG', false);
  try {
    const response = await transport(providerURL(config, endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? 'MODEL_AUTH_FAILED'
          : response.status === 404
            ? 'MODEL_NOT_FOUND'
            : response.status === 429
              ? 'MODEL_RATE_LIMIT'
              : `PROVIDER_HTTP_${response.status}`;
      throw new ProviderError(
        code,
        response.status === 429 || response.status >= 500,
        response.status >= 500,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new ProviderError('INVALID_JSON', false);
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e instanceof Error && ['TimeoutError', 'AbortError'].includes(e.name))
      throw new ProviderError('MODEL_TIMEOUT', true, true);
    // Do not expose request URLs, credentials or remote response bodies through errors.
    throw new ProviderError('MODEL_UNAVAILABLE', true, true);
  }
}
export function jsonResponse(
  content: string,
  body: unknown,
  model: string,
  durationMs: number,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): ProviderResponse {
  try {
    return {
      data: JSON.parse(content),
      raw: body,
      model,
      durationMs,
      inputTokens: inputTokens ?? null,
      outputTokens: outputTokens ?? null,
    };
  } catch {
    throw new ProviderError('INVALID_JSON', false);
  }
}
const tokens = z.number().int().nonnegative().optional();
export const ChatResponse = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          refusal: z.string().nullable().optional(),
          content: z
            .union([
              z.string(),
              z.array(z.object({ type: z.string(), text: z.string().optional() })),
            ])
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: tokens, completion_tokens: tokens }).optional(),
});
export function parseChatResponse(
  body: unknown,
  model: string,
  durationMs: number,
): ProviderResponse {
  const result = ChatResponse.safeParse(body);
  if (!result.success) throw new ProviderError('MODEL_RESPONSE_INVALID', false);
  const b = result.data,
    c = b.choices[0];
  if (c.message.refusal || c.finish_reason === 'content_filter')
    throw new ProviderError('MODEL_REFUSED', false);
  if (c.finish_reason === 'length') throw new ProviderError('MODEL_TRUNCATED', false);
  if (c.finish_reason && c.finish_reason !== 'stop')
    throw new ProviderError('MODEL_STOP_UNSUPPORTED', false);
  const content =
    typeof c.message.content === 'string'
      ? c.message.content
      : (c.message.content ?? [])
          .filter((p) => p.type === 'text')
          .map((p) => p.text ?? '')
          .join('');
  return jsonResponse(
    content,
    body,
    b.model ?? model,
    durationMs,
    b.usage?.prompt_tokens,
    b.usage?.completion_tokens,
  );
}
const MessagesResponse = z.object({
  model: z.string(),
  stop_reason: z.string().nullable(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: tokens, output_tokens: tokens }).optional(),
});
export function parseMessagesResponse(
  body: unknown,
  model: string,
  durationMs: number,
): ProviderResponse {
  const result = MessagesResponse.safeParse(body);
  if (!result.success) throw new ProviderError('MODEL_RESPONSE_INVALID', false);
  const b = result.data;
  if (b.stop_reason === 'refusal' || b.content.some((p) => p.type === 'refusal'))
    throw new ProviderError('MODEL_REFUSED', false);
  if (b.stop_reason === 'max_tokens' || b.stop_reason === 'model_context_window_exceeded')
    throw new ProviderError('MODEL_TRUNCATED', false);
  if (b.stop_reason !== 'end_turn') throw new ProviderError('MODEL_STOP_UNSUPPORTED', false);
  return jsonResponse(
    b.content
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join(''),
    body,
    b.model ?? model,
    durationMs,
    b.usage?.input_tokens,
    b.usage?.output_tokens,
  );
}
