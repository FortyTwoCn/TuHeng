import {
  AIProviderConfig,
  AIModelConfig,
  AITaskParameters,
  AISnapshot,
  aiConfigurationError,
  type AITaskKey,
  type GradingRequest,
} from '@tuheng/contracts';
import type { DataPort } from './entities';

// Only actual business entry points. Each retains its own input/output contract.
export const AITaskRegistry = {
  'grading.assignment': {
    name: '作业批改建议',
    inputSchema: 'GradingRequest/1',
    outputSchema: 'GradingResult/1',
    lane: 'formal',
  },
  'grading.selftest': {
    name: '自测与错题练习',
    inputSchema: 'GradingRequest/1',
    outputSchema: 'GradingResult/1',
    lane: 'selftest',
  },
} as const;
export function requiredGradingCapabilities(input: GradingRequest) {
  return {
    text: true as const,
    images:
      input.question.assets.length + input.reference.assets.length + input.submissionAssets.length >
      0,
  };
}
export async function planAIInvocation(
  tx: DataPort,
  taskKey: AITaskKey,
  request: GradingRequest,
): Promise<{ snapshot: AISnapshot | null; errorCode: string | null }> {
  const binding = (
    await tx.list('aITaskBindingVersion', { taskKey }, { orderBy: 'version', desc: true, take: 1 })
  )[0];
  if (!binding?.enabled) return { snapshot: null, errorCode: 'AI_BINDING_NOT_CONFIGURED' };
  const modelRow = await tx.get('aIModel', binding.modelId);
  if (!modelRow?.enabled || modelRow.archived)
    return { snapshot: null, errorCode: 'AI_MODEL_DISABLED' };
  const providerRow = await tx.get('aIProvider', modelRow.providerId);
  if (!providerRow?.enabled || providerRow.archived)
    return { snapshot: null, errorCode: 'AI_PROVIDER_DISABLED' };
  const pv = (
    await tx.list('aIProviderVersion', {
      providerId: providerRow.id,
      version: providerRow.currentVersion,
    })
  )[0];
  const mv = (
    await tx.list('aIModelVersion', { modelId: modelRow.id, version: modelRow.currentVersion })
  )[0];
  if (!pv?.secretId || !mv) return { snapshot: null, errorCode: 'AI_CREDENTIAL_NOT_CONFIGURED' };
  const provider = AIProviderConfig.safeParse(pv.config),
    model = AIModelConfig.safeParse(mv.config),
    parameters = AITaskParameters.safeParse(binding.parameters);
  if (!provider.success || !model.success || !parameters.success)
    return { snapshot: null, errorCode: 'AI_CONFIGURATION_INVALID' };
  const required = requiredGradingCapabilities(request);
  const errorCode = aiConfigurationError(
    provider.data,
    model.data,
    parameters.data,
    required.images,
  );
  if (errorCode) return { snapshot: null, errorCode };
  return {
    errorCode: null,
    snapshot: AISnapshot.parse({
      schemaVersion: 'tuheng.ai/1',
      taskKey,
      bindingId: binding.id,
      bindingVersion: binding.version,
      providerId: providerRow.id,
      providerVersionId: pv.id,
      providerVersion: pv.version,
      modelId: modelRow.id,
      modelVersionId: mv.id,
      modelVersion: mv.version,
      secretId: pv.secretId,
      provider: provider.data,
      model: model.data,
      parameters: parameters.data,
      required,
      capabilityCheck: 'PASSED',
      promptVersion: request.promptVersion,
      strategyVersion: request.strategyVersion,
    }),
  };
}
