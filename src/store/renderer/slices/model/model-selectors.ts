import { store } from "../../store";
import {
  getItem,
  getItems,
  type Collection,
} from '$lib/store-shim/utils/collections/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { isModelValidForProvider } from '$shared/utils/compound-model-id';
import {
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
} from '../provider-settings/provider-settings-selectors';
import { resolveDefaultModel } from './model-selection-utils';
import type { ModelLoadingState } from './model-types';

function getEffectiveProviderId(state: any, providerId?: string): string {
  return providerId ?? selectActiveProviderId.select(state);
}

/**
 * Select the currently selected model value.
 *
 * Prefers the persisted model for the effective provider. When nothing is
 * persisted, falls back to the provider catalog's default (the row the CLI
 * marks `isDefault`, else the first available row) only if the effective
 * provider is actually available — per decision D1(B) we never fabricate a
 * default model for a provider that isn't installed, since that would mask
 * the failure instead of surfacing it. Returns `''` when nothing is
 * resolvable; pair with `selectHasResolvableModel` to detect that state.
 */
export const selectSelectedModel = store.createSelector((state, providerId?: string): string => {
  const effectiveProviderId = getEffectiveProviderId(state, providerId);
  const persisted = state.model.providerModels[effectiveProviderId];
  if (persisted) return persisted;

  const isAvailable = selectAvailableEnabledProviderIds.select(state).includes(effectiveProviderId);
  if (!isAvailable) return '';

  const models = getItems<AuggieModel, 'value'>(state.model.availableModels).filter((m) =>
    isModelValidForProvider(m.value, effectiveProviderId, state.model.defaultProviderId),
  );
  return resolveDefaultModel(models);
});

/** Whether `selectSelectedModel` resolved to an actual model for the effective provider. */
export const selectHasResolvableModel = store.createSelector(
  (state, providerId?: string): boolean => {
    return selectSelectedModel.select(state, providerId) !== '';
  }
);

const selectAvailableModelsCollection = store.createSelector(
  (state): Collection<AuggieModel, 'value'> => {
    return state.model.availableModels;
  },
);

export const selectAvailableModels = store.createSelector((state): AuggieModel[] => {
  return getItems(selectAvailableModelsCollection.select(state));
});

/**
 * Provider the global `availableModels` catalog was loaded for ('' before
 * the first load). Consumers rendering the catalog under a provider label
 * (e.g. the picker's disabled-provider fallback group) must check this
 * matches, or stale rows from a previous provider get mislabeled.
 */
export const selectAvailableModelsProviderId = store.createSelector((state): string => {
  return state.model.availableModelsProviderId;
});

const selectProviderLoadingState = store.createSelector(
  (state, providerId?: string): ModelLoadingState | null => {
    const effectiveProviderId = getEffectiveProviderId(state, providerId);
    return state.model.loadingState[effectiveProviderId] ?? null;
  },
);

export const selectIsLoadingModels = store.createSelector((state, providerId?: string): boolean => {
  return selectProviderLoadingState.select(state, providerId)?.status === 'loading';
});

export const selectModelsLoaded = store.createSelector((state, providerId?: string): boolean => {
  return selectProviderLoadingState.select(state, providerId)?.status === 'success';
});

/** Select the load error message */
export const selectLoadError = store.createSelector((state, providerId?: string): string | null => {
  const loadingState = selectProviderLoadingState.select(state, providerId);
  if (loadingState?.status !== 'error') {
    return null;
  }

  return loadingState.error ?? null;
});

export const selectAllProviderWarnings = store.createSelector((state): Record<string, string> => {
  const warnings: Record<string, string> = {};

  for (const [providerId, loadingState] of Object.entries(state.model.loadingState)) {
    if (loadingState.warning) {
      warnings[providerId] = loadingState.warning;
    }
  }

  return warnings;
});

/**
 * Provider ids whose current `warning` accompanies a last-known-good (stale)
 * model list rather than a degraded static fallback.
 */
export const selectAllProviderStaleFlags = store.createSelector(
  (state): Record<string, boolean> => {
    const stale: Record<string, boolean> = {};

    for (const [providerId, loadingState] of Object.entries(state.model.loadingState)) {
      if (loadingState.stale) {
        stale[providerId] = true;
      }
    }

    return stale;
  },
);

export const selectRetryAttempt = store.createSelector((state, providerId?: string): number => {
  return selectProviderLoadingState.select(state, providerId)?.retryAttempt ?? 0;
});

export const selectIsLoadingModelsForProvider = selectIsLoadingModels;

export const selectModelsLoadedForProvider = selectModelsLoaded;

/** Select all provider models */
export const selectProviderModels = store.createSelector((state): Record<string, string> => {
  return state.model.providerModels;
});

/**
 * Default reasoning-effort level paired with the default-model setting
 * (`model.defaultReasoningEffort`), or '' when unset.
 */
export const selectDefaultReasoningEffort = store.createSelector((state): string => {
  return state.model.defaultReasoningEffort;
});

export const selectModelPickerCollapsedGroups = store.createSelector((state): string[] => {
  return state.model.modelPickerCollapsedGroups;
});

export const selectModelFallbackInfo = store.createSelector((state, agentId: string) => {
  return state.model.fallbackInfoByAgentId[agentId] ?? null;
});

/**
 * Pretty display name (catalog `label`) for a (provider, raw model id) pair,
 * or `undefined` on a lookup miss (catalog not loaded / unknown model).
 * Catalog values are bare for the registry default provider and
 * `provider:model` otherwise (see `prefixModelsForProvider` in model-utils).
 */
export const selectModelDisplayName = store.createSelector(
  (state, providerId: string, modelId: string): string | undefined => {
    const models: Collection<AuggieModel, 'value'> | undefined = state.model?.availableModels;
    if (!models) return undefined;
    const compound = getItem(models, `${providerId}:${modelId}`);
    if (compound) return compound.label;
    if (providerId === state.model.defaultProviderId) {
      return getItem(models, modelId)?.label;
    }
    return undefined;
  },
);

/**
 * Supported reasoning-effort levels for a model id (catalog `effortLevels`
 * metadata, PROTOCOL §5.30/§6.7 — collapsed codex rows plus claude-code rows
 * carry them). Accepts bare or `provider:model` ids; a legacy codex compound
 * `{model}/{effort}` suffix is stripped before the catalog lookup so
 * pre-migration session models still resolve their base row. `undefined` on
 * lookup miss (catalog not loaded / model without effort support).
 */
export const selectModelEffortLevels = store.createSelector(
  (state, modelId: string | null | undefined): string[] | undefined => {
    if (!modelId) return undefined;
    const models: Collection<AuggieModel, 'value'> | undefined = state.model?.availableModels;
    if (!models) return undefined;
    const slashIndex = modelId.indexOf('/');
    const baseId = slashIndex > 0 ? modelId.slice(0, slashIndex) : modelId;
    const row = getItem(models, baseId);
    if (row?.effortLevels) return row.effortLevels;
    // Bare id from a session may be stored compound in the catalog under the
    // default provider prefix (see prefixModelsForProvider in model-utils).
    if (!baseId.includes(':') && state.model.defaultProviderId) {
      return getItem(models, `${state.model.defaultProviderId}:${baseId}`)?.effortLevels;
    }
    return undefined;
  },
);

/**
 * Effort levels for the model an agent session currently uses — the
 * session-scoped companion to `selectAgentReasoningEffort`. `undefined` when
 * the session is unknown, uses the provider default model, or the model has
 * no effort support in the loaded catalog.
 */
export const selectAgentModelEffortLevels = store.createSelector(
  (state, agentId: string): string[] | undefined => {
    const model = state.agentSessions?.byAgentId[agentId]?.model;
    return selectModelEffortLevels.select(state, model);
  },
);
