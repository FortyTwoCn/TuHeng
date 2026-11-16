import { z } from 'zod';

export const AIProtocol = z.enum(['OPENAI_CHAT_COMPLETIONS', 'ANTHROPIC_MESSAGES']);
export const AIOutputMode = z.enum(['json_schema', 'json_object', 'prompt_json']);
export const AITaskKey = z.enum(['grading.assignment', 'grading.selftest']);
export type AITaskKey = z.infer<typeof AITaskKey>;
export const AIBaseURL = z
  .url()
  .max(500)
  .refine((value) => {
    const u = new URL(value);
    return (
      ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash
    );
  }, '只允许不含凭据、查询参数的 HTTP(S) Base URL');
export const AIProviderConfig = z
  .object({
    baseUrl: AIBaseURL,
    protocol: AIProtocol,
    timeoutMs: z.number().int().min(1000).max(180000).default(90000),
    concurrency: z.number().int().min(1).max(64).default(2),
    requestsPerDay: z.number().int().min(1).max(1000000).default(5000),
    anthropicVersion: z.enum(['2023-06-01', '2026-10-21']).default('2023-06-01'),
    anthropicAuthentication: z.enum(['X_API_KEY', 'BEARER']).default('X_API_KEY'),
  })
  .strict();
export type AIProviderConfig = z.infer<typeof AIProviderConfig>;
export const AIModelConfig = z
  .object({
    model: z.string().trim().min(1).max(200),
    protocol: AIProtocol.nullable().default(null),
    baseUrl: AIBaseURL.nullable().default(null),
    // Relative endpoint override, never a second host or arbitrary request template.
    endpoint: z
      .string()
      .regex(/^\/[a-zA-Z0-9_/-]+$/)
      .max(150)
      .refine((s) => !s.startsWith('//'))
      .nullable()
      .default(null),
    text: z.boolean().default(true),
    images: z.boolean().default(false),
    outputModes: z.array(AIOutputMode).min(1),
    temperature: z.boolean().default(false),
    temperatureMax: z.number().min(0).max(2).default(1),
    tokenParameter: z
      .enum(['max_tokens', 'max_completion_tokens'])
      .default('max_completion_tokens'),
    maxOutputTokens: z.number().int().min(128).max(128000).default(8192),
    systemRole: z.enum(['system', 'developer']).default('system'),
    pricing: z
      .object({
        currency: z.enum(['CNY', 'USD']),
        inputPerMillion: z.number().nonnegative(),
        outputPerMillion: z.number().nonnegative(),
      })
      .nullable()
      .default(null),
  })
  .strict();
export type AIModelConfig = z.infer<typeof AIModelConfig>;
export const AITaskParameters = z
  .object({
    outputMode: AIOutputMode,
    maxOutputTokens: z.number().int().min(128).max(128000).default(4096),
    temperature: z.number().min(0).max(2).nullable().default(null),
    perSchoolPerDay: z.number().int().min(1).max(1000000).default(3000),
    perUserPerDay: z.number().int().min(1).max(10000).default(100),
  })
  .strict();
export type AITaskParameters = z.infer<typeof AITaskParameters>;
export const AISnapshot = z
  .object({
    schemaVersion: z.literal('tuheng.ai/1'),
    taskKey: AITaskKey,
    bindingId: z.string(),
    bindingVersion: z.number().int(),
    providerId: z.string(),
    providerVersionId: z.string(),
    providerVersion: z.number().int(),
    modelId: z.string(),
    modelVersionId: z.string(),
    modelVersion: z.number().int(),
    secretId: z.string(),
    provider: AIProviderConfig,
    model: AIModelConfig,
    parameters: AITaskParameters,
    required: z.object({ text: z.literal(true), images: z.boolean() }),
    capabilityCheck: z.literal('PASSED'),
    promptVersion: z.string(),
    strategyVersion: z.string(),
  })
  .strict();
export type AISnapshot = z.infer<typeof AISnapshot>;
export function aiConfigurationError(
  provider: AIProviderConfig,
  model: AIModelConfig,
  parameters: AITaskParameters,
  needsImages: boolean,
): string | null {
  if (!model.text || (needsImages && !model.images)) return 'AI_CAPABILITY_MISMATCH';
  if (!model.outputModes.includes(parameters.outputMode)) return 'AI_OUTPUT_MODE_UNSUPPORTED';
  if (
    parameters.maxOutputTokens > model.maxOutputTokens ||
    (parameters.temperature !== null &&
      (!model.temperature || parameters.temperature > model.temperatureMax))
  )
    return 'AI_PARAMETER_UNSUPPORTED';
  if (
    (model.protocol ?? provider.protocol) === 'ANTHROPIC_MESSAGES' &&
    parameters.outputMode === 'json_object'
  )
    return 'AI_PROTOCOL_OUTPUT_UNSUPPORTED';
  return null;
}
