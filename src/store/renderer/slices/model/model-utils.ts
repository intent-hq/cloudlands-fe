/**
 * Model utility functions.
 *
 * These are standalone async functions that fetch models for a specific provider
 * WITHOUT updating Redux state. Used by components like ModelPicker that need
 * models for a provider different from the global active provider.
 */
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { getAuggieModels } from '$features/auggie/auggie-models.client';
import type { ClaudeCodeModel } from '$features/claude-code/claude-code-models.client';
import { getClaudeCodeModels } from '$features/claude-code/claude-code-models.client';
import type { CodexModel } from '$features/codex/codex-models.client';
import { getCodexModelsWithMetadata } from '$features/codex/codex-models.client';
import type { CortexModel } from '$features/cortex/cortex-models.client';
import { getCortexModels } from '$features/cortex/cortex-models.client';
import type { DroidModel } from '$features/droid/droid-models.client';
import { getDroidModels } from '$features/droid/droid-models.client';
import type { OpenCodeModel } from '$features/opencode/opencode-models.client';
import { getOpencodeModels } from '$features/opencode/opencode-models.client';
import {
  ACP_PROVIDERS,
  getDefaultProviderId,
  getProviderConfig,
} from '$shared/config/provider-config';
/** Union type for all provider model types */
export type ProviderModel =
  | AuggieModel
  | ClaudeCodeModel
  | CodexModel
  | CortexModel
  | DroidModel
  | OpenCodeModel;

type ProviderModelsWithWarning = {
  models: ProviderModel[];
  warning?: string;
};

/**
 * Fetch raw models for a specific provider.
 * Maps provider ID to the appropriate model fetching function.
 * Normalizes aliases (e.g. 'acp' → 'auggie') via getProviderConfig().
 */
async function fetchProviderModelsWithWarning(
  providerId: string,
): Promise<ProviderModelsWithWarning> {
  const normalizedId = getProviderConfig(providerId).id;
  switch (normalizedId) {
    case 'auggie':
      return { models: await getAuggieModels() };
    case 'claude-code':
      return { models: await getClaudeCodeModels() };
    case 'codex':
      return await getCodexModelsWithMetadata();
    case 'cortex':
      return { models: await getCortexModels() };
    case 'droid':
      return { models: await getDroidModels() };
    case 'opencode':
      return { models: await getOpencodeModels() };
    case 'mock':
      return { models: [] };
    default:
      throw new Error(`Unsupported model provider: ${providerId}`);
  }
}

export async function fetchModelsForProvider(providerId: string): Promise<ProviderModel[]> {
  return (await fetchProviderModelsWithWarning(providerId)).models;
}

function prefixModelsForProvider(providerId: string, models: ProviderModel[]): AuggieModel[] {
  if (models.length === 0) {
    return [];
  }
  const defaultProviderId = getDefaultProviderId();
  return models.map((model) => {
    if (providerId !== defaultProviderId) {
      return {
        ...model,
        value: `${providerId}:${model.value}`,
      } as AuggieModel;
    }
    return model as AuggieModel;
  });
}

export async function getModelsForProviderForLoadingState(providerId: string): Promise<{
  models: AuggieModel[];
  warning?: string;
}> {
  const normalizedId = getProviderConfig(providerId).id;
  const result = await fetchProviderModelsWithWarning(normalizedId);
  return {
    models: prefixModelsForProvider(normalizedId, result.models),
    warning: result.warning,
  };
}

/**
 * Fetch and return models for a specific provider ID.
 * Unlike the load-models saga, this does NOT update Redux state.
 * Used by ModelPicker when an agent's provider differs from the global active provider.
 *
 * Applies the same provider-ID prefixing logic as the load-models saga.
 */
export async function getModelsForProvider(providerId: string): Promise<AuggieModel[]> {
  return (await getModelsForProviderForLoadingState(providerId)).models;
}
/**
 * Get models grouped by provider.
 * Utility function that takes explicit params instead of reading from stores.
 */
export function getGroupedModels(
  activeProviderId: string,
  availableModels: AuggieModel[],
): Array<{
  providerId: string;
  providerDisplayName: string;
  models: AuggieModel[];
}> {
  const providerConfig = ACP_PROVIDERS[activeProviderId];
  if (!providerConfig || availableModels.length === 0) {
    return [];
  }
  return [
    {
      providerId: providerConfig.id,
      providerDisplayName: providerConfig.displayName,
      models: availableModels,
    },
  ];
}
