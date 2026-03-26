/**
 * Model utility functions.
 *
 * These are standalone async functions that fetch models for a specific provider
 * WITHOUT updating Redux state. Used by components like ModelPicker that need
 * models for a provider different from the global active provider.
 */
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import { getAuggieModels } from "$features/auggie/auggie-models.client";
import type { ClaudeCodeModel } from "$features/claude-code/claude-code-models.client";
import { getClaudeCodeModels } from "$features/claude-code/claude-code-models.client";
import type { CodexModel } from "$features/codex/codex-models.client";
import { getCodexModels } from "$features/codex/codex-models.client";
import type { CortexModel } from "$features/cortex/cortex-models.client";
import { getCortexModels } from "$features/cortex/cortex-models.client";
import type { OpenCodeModel } from "$features/opencode/opencode-models.client";
import { getOpencodeModels } from "$features/opencode/opencode-models.client";
import { ACP_PROVIDERS, getDefaultProviderId, getProviderConfig, } from "$shared/config/provider-config";
/** Union type for all provider model types */
type ProviderModel = AuggieModel | ClaudeCodeModel | CodexModel | CortexModel | OpenCodeModel;
/**
 * Fetch raw models for a specific provider.
 * Maps provider ID to the appropriate model fetching function.
 * Normalizes aliases (e.g. 'acp' → 'auggie') via getProviderConfig().
 */
export async function fetchModelsForProvider(providerId: string): Promise<ProviderModel[]> {
    const normalizedId = getProviderConfig(providerId).id;
    switch (normalizedId) {
        case "auggie":
            return getAuggieModels().catch((err) => {
                return [];
            });
        case "claude-code":
            return getClaudeCodeModels().catch((err) => {
                return [];
            });
        case "codex":
            return getCodexModels().catch((err) => {
                return [];
            });
        case "cortex":
            return getCortexModels().catch((err) => {
                return [];
            });
        case "opencode":
            return getOpencodeModels().catch((err) => {
                return [];
            });
        default:
            return [];
    }
}
/**
 * Fetch and return models for a specific provider ID.
 * Unlike the load-models saga, this does NOT update Redux state.
 * Used by ModelPicker when an agent's provider differs from the global active provider.
 *
 * Applies the same provider-ID prefixing logic as the load-models saga.
 */
export async function getModelsForProvider(providerId: string): Promise<AuggieModel[]> {
    const normalizedId = getProviderConfig(providerId).id;
    const models = await fetchModelsForProvider(normalizedId);
    if (models.length === 0) {
        return [];
    }
    // Apply the same prefixing logic as the load-models saga
    const defaultProviderId = getDefaultProviderId();
    return models.map((model) => {
        if (normalizedId !== defaultProviderId) {
            return {
                ...model,
                value: `${normalizedId}:${model.value}`,
            } as AuggieModel;
        }
        return model as AuggieModel;
    });
}
/**
 * Get models grouped by provider.
 * Utility function that takes explicit params instead of reading from stores.
 */
export function getGroupedModels(activeProviderId: string, availableModels: AuggieModel[]): Array<{
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
