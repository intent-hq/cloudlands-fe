import { store } from '../../store';
import {
  getItem,
  getItems,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { getAgentProvider } from '$shared/types/agent-session';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import {
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
} from '../provider-settings/provider-settings-selectors';
import { resolveDefaultModel } from './model-selection-utils';
import type { ModelLoadingState } from './model-types';
import { selectEffectiveDefaultProviderId } from '../provider-catalog/provider-catalog-selectors';

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
  // Catalog rows carry bare ids; provenance lives in availableModelsProviderId.
  const catalogModels =
    state.model.availableModelsProviderId === effectiveProviderId
      ? getItems<AuggieModel, 'value'>(state.model.availableModels)
      : [];
  const persisted = state.model.providerModels[effectiveProviderId];
  if (persisted) {
    if (catalogModels.length === 0) return persisted;
    if (catalogModels.some((model) => model.value === persisted)) return persisted;
    return resolveDefaultModel(catalogModels);
  }

  const isAvailable = selectAvailableEnabledProviderIds.select(state).includes(effectiveProviderId);
  if (!isAvailable) return '';

  return resolveDefaultModel(catalogModels);
});

/** Whether `selectSelectedModel` resolved to an actual model for the effective provider. */
export const selectHasResolvableModel = store.createSelector(
  (state, providerId?: string): boolean => {
    return selectSelectedModel.select(state, providerId) !== '';
  },
);

/**
 * Whether launching an agent with unpinned config would carry a resolvable
 * provider or model. Mirrors the launch saga's resolution (`launchAgent`):
 * `model` falls back to `selectSelectedModel` and `provider` to the active
 * provider id, so when both resolve to '' (fresh backend, `providers.active`
 * unset) the daemon rejects `agent.create` with "no default provider/model
 * is configured". Auto-start flows (e.g. the Chief thread) gate on this to
 * skip silently until a provider is configured.
 *
 * Known corner: the daemon's own `derived_default_provider` can also resolve
 * from a compound daemon-side `model.default` (config-file/CLI only) with
 * `providers.active` unset. The FE cannot see that config, so this selector
 * reports false there and gated auto-starts skip even though the daemon
 * would accept the call — accepted as unreachable through the app UI.
 */
export const selectHasResolvableProvider = store.createSelector((state): boolean => {
  // With no active provider id the model resolution keys off provider '' and
  // `selectHasResolvableModel` is false too, so today this reduces to
  // `activeProviderId !== ''`. The disjunct stays as a defensive mirror of
  // the saga's fallback pair — do not read it as model-only resolvability.
  return selectActiveProviderId.select(state) !== '' || selectHasResolvableModel.select(state);
});

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
 * Pretty display name (catalog `label`) for a (provider, bare model id) pair,
 * or `undefined` on a lookup miss (catalog not loaded for that provider /
 * unknown model). Catalog rows carry bare ids: the active catalog resolves
 * when its `availableModelsProviderId` provenance matches, and other
 * providers resolve through the session-lifetime provider-models cache.
 */
export const selectModelDisplayName = store.createSelector(
  (state, providerId: string, modelId: string): string | undefined => {
    const bareId = splitLegacyCompoundId(modelId).modelId;
    const models: Collection<AuggieModel, 'value'> | undefined = state.model?.availableModels;
    if (models && (!providerId || providerId === state.model.availableModelsProviderId)) {
      const label = getItem(models, bareId)?.label;
      if (label) return label;
    }
    if (providerId) {
      const cached = state.providerModels?.byProviderId[providerId];
      return cached?.models.find((model) => model.value === bareId)?.label;
    }
    return undefined;
  },
);

/**
 * Supported reasoning-effort levels for a model id (catalog `effortLevels`
 * metadata, PROTOCOL §5.30/§6.7 — collapsed codex rows plus claude-code rows
 * carry them). Legacy compound `provider:model` ids and codex `{model}/{effort}`
 * suffixes are stripped down to the bare base id before the catalog lookup so
 * pre-migration session models still resolve their base row. `undefined` on
 * lookup miss (catalog not loaded / model without effort support).
 */
export const selectModelEffortLevels = store.createSelector(
  (state, modelId: string | null | undefined): string[] | undefined => {
    if (!modelId) return undefined;
    const models: Collection<AuggieModel, 'value'> | undefined = state.model?.availableModels;
    if (!models) return undefined;
    const bareId = splitLegacyCompoundId(modelId).modelId;
    const slashIndex = bareId.indexOf('/');
    const baseId = slashIndex > 0 ? bareId.slice(0, slashIndex) : bareId;
    return getItem(models, baseId)?.effortLevels;
  },
);

/**
 * Effort levels for the model an agent session currently uses — the
 * session-scoped companion to `selectAgentReasoningEffort`. The session's own
 * daemon-served `effortLevels` (the provider's `thought_level` select
 * discovered at session open, §5.5) take precedence when present; otherwise
 * the catalog metadata lookup applies (codex static catalog etc.).
 * Sessions that inherit their provider model resolve through `selectSelectedModel`.
 * `undefined` when the session is unknown or neither the session nor the loaded
 * catalog advertises effort support.
 */
export const selectAgentModelEffortLevels = store.createSelector(
  (state, agentId: string): string[] | undefined => {
    const session = state.agentSessions?.byAgentId[agentId];
    if (!session) return undefined;
    if (Array.isArray(session.effortLevels) && session.effortLevels.length > 0) {
      return session.effortLevels;
    }
    const providerId = getAgentProvider(session, selectEffectiveDefaultProviderId.select(state));
    const model = session.model ?? selectSelectedModel.select(state, providerId);
    return selectModelEffortLevels.select(state, model);
  },
);
