import { expect, it } from 'vitest';
import { aiRouteDiagnostic } from '@tuheng/domain';
const provider = {
  enabled: true,
  archived: false,
  credentialConfigured: true,
  config: { baseUrl: 'https://example.test/v1', protocol: 'OPENAI_CHAT_COMPLETIONS' },
};
const model = {
  enabled: true,
  archived: false,
  config: { model: 'test', outputModes: ['prompt_json'], images: false },
};
const binding = { enabled: true, parameters: { outputMode: 'prompt_json' } };
it('distinguishes conditional image requirements, disabled routes and missing secrets without invoking a model', () => {
  expect(aiRouteDiagnostic(provider, model, binding)).toBeNull();
  expect(aiRouteDiagnostic(provider, model, binding, true)).not.toBeNull();
  expect(aiRouteDiagnostic({ ...provider, credentialConfigured: false }, model, binding)).toBe(
    'AI_CREDENTIAL_NOT_CONFIGURED',
  );
  expect(aiRouteDiagnostic({ ...provider, enabled: false }, model, binding)).toBe(
    'AI_PROVIDER_DISABLED',
  );
  expect(aiRouteDiagnostic(provider, { ...model, archived: true }, binding)).toBe(
    'AI_MODEL_DISABLED',
  );
  expect(aiRouteDiagnostic(provider, model, { ...binding, enabled: false })).toBe(
    'AI_BINDING_NOT_CONFIGURED',
  );
  expect(aiRouteDiagnostic(provider, { ...model, config: {} }, binding)).toBe(
    'AI_CONFIGURATION_INVALID',
  );
});
