import type { ProviderReadState } from '../provider-catalog/provider-read-types';
import {
  getHostExecutionContext,
  getHostExecutionGeneration,
  getIsHostMember,
} from '../host-execution/host-execution-projections';
import { getHostRole, getPrincipalActionContext } from '../principal/principal-projections';
import {
  getItem,
  getItems,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import type { ProviderModelInfo as AuggieModel } from '$shared/models/wire-model-info';
import { getAgentProvider } from '$shared/types/agent-session';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { modelIdForDisplay, resolveModelDisplayName } from '$shared/utils/model-display-name';
import { getLearnedModelDisplayName } from '../provider-models/provider-models-projections';
import {
  getActiveProviderId,
  getAvailableEnabledProviderIds,
} from '../provider-settings/provider-settings-projections';
import { resolveDefaultModel } from './model-selection-utils';
import type { ModelLoadingState } from './model-types';
import {
  getEffectiveDefaultProviderId,
  getNormalizedProviderId,
} from '../provider-catalog/provider-catalog-projections';

/** Persistence/hydration ownership; UI selectors use the selected fields only. */
export const getModelSelectionState = (state: ProviderReadState) => state.model;

/** Unscoped catalogs belong to one admitted owner/member and provider projection. */
export const getModelBootContext = (state: ProviderReadState): string | null => {
  const admission = getPrincipalActionContext(state);
  const role = getHostRole(state);
  if (!admission || (role !== 'owner' && role !== 'member')) return null;
  const provider = getActiveProviderId(state);
  // Members get defaults from host.executionContext, never owner settings.
  if (role === 'member' && !provider) return null;
  return JSON.stringify([
    admission,
    provider,
    role === 'member' ? getHostExecutionGeneration(state) : null,
  ]);
};

function getEffectiveProviderId(state: ProviderReadState, providerId?: string): string {
  return providerId ?? getActiveProviderId(state);
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
 * resolvable; pair with `getHasResolvableModel` to detect that state.
 */
export const getSelectedModel = (state: ProviderReadState, providerId?: string): string => {
  const effectiveProviderId = getEffectiveProviderId(state, providerId);
  // Catalog rows carry bare ids; provenance lives in availableModelsProviderId.
  const catalogModels =
    state.model.availableModelsProviderId === effectiveProviderId
      ? getItems<AuggieModel, 'value'>(state.model.availableModels)
      : [];
  const context = getHostExecutionContext(state);
  const persisted = getIsHostMember(state)
    ? context?.defaultProviderId === effectiveProviderId
      ? context.defaultModelId
      : null
    : state.model.providerModels[effectiveProviderId];
  // Catalogs can be cold, stale, or partial. They supply defaults only when
  // the user has no persisted choice; absence is not a new model selection.
  if (persisted) return persisted;

  const isAvailable = getAvailableEnabledProviderIds(state).includes(effectiveProviderId);
  if (!isAvailable) return '';

  return resolveDefaultModel(catalogModels);
};

/** Whether `getSelectedModel` resolved to an actual model for the effective provider. */
export const getHasResolvableModel = (state: ProviderReadState, providerId?: string): boolean => {
  return getSelectedModel(state, providerId) !== '';
};

/**
 * Whether launching an agent with unpinned config would carry a resolvable
 * provider or model. Mirrors the launch saga's resolution (`launchAgent`):
 * `model` falls back to `getSelectedModel` and `provider` to the active
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
export const getHasResolvableProvider = (state: ProviderReadState): boolean => {
  // With no active provider id the model resolution keys off provider '' and
  // `getHasResolvableModel` is false too, so today this reduces to
  // `activeProviderId !== ''`. The disjunct stays as a defensive mirror of
  // the saga's fallback pair — do not read it as model-only resolvability.
  return getActiveProviderId(state) !== '' || getHasResolvableModel(state);
};

const getAvailableModelsCollection = (
  state: ProviderReadState,
): Collection<AuggieModel, 'value'> => {
  return state.model.availableModels;
};

export const getAvailableModels = (state: ProviderReadState): AuggieModel[] => {
  return getItems(getAvailableModelsCollection(state));
};

/**
 * Provider the global `availableModels` catalog was loaded for ('' before
 * the first load). Consumers rendering the catalog under a provider label
 * (e.g. the picker's disabled-provider fallback group) must check this
 * matches, or stale rows from a previous provider get mislabeled.
 */
export const getAvailableModelsProviderId = (state: ProviderReadState): string => {
  return state.model.availableModelsProviderId;
};

const getProviderLoadingState = (
  state: ProviderReadState,
  providerId?: string,
): ModelLoadingState | null => {
  const effectiveProviderId = getEffectiveProviderId(state, providerId);
  return state.model.loadingState[effectiveProviderId] ?? null;
};

export const getIsLoadingModels = (state: ProviderReadState, providerId?: string): boolean => {
  return getProviderLoadingState(state, providerId)?.status === 'loading';
};

/** Select the load error message */
export const getLoadError = (state: ProviderReadState, providerId?: string): string | null => {
  const loadingState = getProviderLoadingState(state, providerId);
  if (loadingState?.status !== 'error') {
    return null;
  }

  return loadingState.error ?? null;
};

export const getAllProviderWarnings = (state: ProviderReadState): Record<string, string> => {
  const warnings: Record<string, string> = {};

  for (const [providerId, loadingState] of Object.entries(state.model.loadingState)) {
    if (loadingState.warning) {
      warnings[providerId] = loadingState.warning;
    }
  }

  return warnings;
};

/**
 * Provider ids whose current `warning` accompanies a last-known-good (stale)
 * model list rather than a degraded static fallback.
 */
export const getAllProviderStaleFlags = (state: ProviderReadState): Record<string, boolean> => {
  const stale: Record<string, boolean> = {};

  for (const [providerId, loadingState] of Object.entries(state.model.loadingState)) {
    if (loadingState.stale) {
      stale[providerId] = true;
    }
  }

  return stale;
};

/** Select all provider models */
export const getProviderModels = (state: ProviderReadState): Record<string, string> => {
  return state.model.providerModels;
};

/**
 * Default reasoning-effort level paired with the default-model setting
 * (`model.defaultReasoningEffort`), or '' when unset.
 */
export const getDefaultReasoningEffort = (state: ProviderReadState): string => {
  return state.model.defaultReasoningEffort;
};

export const getModelPickerCollapsedGroups = (state: ProviderReadState): string[] => {
  return state.model.modelPickerCollapsedGroups;
};

export const getModelFallbackInfo = (state: ProviderReadState, agentId: string) => {
  return state.model.fallbackInfoByAgentId[agentId] ?? null;
};

/** Authoritative model metadata only; learned display names never establish capabilities. */
export const getModelCatalogEntry = (
  state: ProviderReadState,
  providerId: string,
  modelId: string,
  workspaceId?: string,
): AuggieModel | undefined => {
  const normalize = (id: string) => getNormalizedProviderId(state, id, workspaceId);
  const provider = normalize(providerId);
  const bareId = modelIdForDisplay(modelId, provider, normalize);
  const models: Collection<AuggieModel, 'value'> | undefined = state.model?.availableModels;
  if (!workspaceId && models && (!provider || provider === state.model.availableModelsProviderId)) {
    const row = getItem(models, modelId) ?? getItem(models, bareId);
    if (row) return row;
  }
  const cached = workspaceId
    ? state.providerModels?.byWorkspaceId?.[workspaceId]?.[provider]
    : state.providerModels?.byProviderId?.[provider];
  return (
    cached?.models.find((model) => model.value === modelId) ??
    cached?.models.find((model) => modelIdForDisplay(model.value, provider, normalize) === bareId)
  );
};

/** Live labels in the requested scope win; persisted names are a synchronous display-only fallback. */
export const getModelDisplayName = (
  state: ProviderReadState,
  providerId: string,
  modelId: string,
  workspaceId?: string,
): string | undefined => {
  const normalize = (id: string) => getNormalizedProviderId(state, id, workspaceId);
  const provider = normalize(providerId);
  const bareId = modelIdForDisplay(modelId, provider, normalize);
  const live = (id: string) => getModelCatalogEntry(state, provider, id, workspaceId)?.label;
  const learned = (id: string) => getLearnedModelDisplayName(state, provider, id);
  return (
    resolveModelDisplayName(modelId, live) ??
    (bareId !== modelId ? resolveModelDisplayName(bareId, live) : undefined) ??
    learned(modelId) ??
    resolveModelDisplayName(bareId, learned)
  );
};

/**
 * Supported reasoning-effort levels for a model id (catalog `effortLevels`
 * metadata, PROTOCOL §5.30/§6.7 — collapsed codex rows plus claude-code rows
 * carry them). Legacy compound `provider:model` ids and codex `{model}/{effort}`
 * suffixes are stripped down to the bare base id before the catalog lookup so
 * pre-migration session models still resolve their base row. `undefined` on
 * lookup miss (catalog not loaded / model without effort support).
 */
export const getModelEffortLevels = (
  state: ProviderReadState,
  modelId: string | null | undefined,
): string[] | undefined => {
  if (!modelId) return undefined;
  const models: Collection<AuggieModel, 'value'> | undefined = state.model?.availableModels;
  if (!models) return undefined;
  const baseId = toBaseModelId(modelId);
  return getItem(models, baseId)?.effortLevels;
};

/** Bare base id: legacy compound prefix and `{model}/{effort}` suffix stripped. */
function toBaseModelId(modelId: string): string {
  const bareId = splitLegacyCompoundId(modelId).modelId;
  const slashIndex = bareId.indexOf('/');
  return slashIndex > 0 ? bareId.slice(0, slashIndex) : bareId;
}

/**
 * Provider-aware companion to `getModelEffortLevels` for surfaces holding
 * an explicit (provider, model) pair (e.g. specialist `modelOptions` triples,
 * PROTOCOL §5.11). Mirrors `getModelDisplayName`: the active catalog
 * resolves when its `availableModelsProviderId` provenance matches (or no
 * provider is given); other providers resolve through the session-lifetime
 * provider-models cache, whose rows may carry compound `provider:model`
 * values. `undefined` on lookup miss.
 */
export const getProviderModelEffortLevels = (
  state: ProviderReadState,
  providerId: string | undefined,
  modelId: string | null | undefined,
  workspaceId?: string,
): string[] | undefined => {
  if (!modelId) return undefined;
  if (!workspaceId && (!providerId || providerId === state.model?.availableModelsProviderId)) {
    const levels = getModelEffortLevels(state, modelId);
    if (levels) return levels;
  }
  if (providerId) {
    const baseId = toBaseModelId(modelId);
    const cached = workspaceId
      ? state.providerModels?.byWorkspaceId?.[workspaceId]?.[providerId]
      : state.providerModels?.byProviderId[providerId];
    return cached?.models.find((model) => toBaseModelId(model.value) === baseId)?.effortLevels;
  }
  return undefined;
};

/**
 * Effort levels for the model an agent session currently uses — the
 * session-scoped companion to `getAgentReasoningEffort`. The session's own
 * daemon-served `effortLevels` (the provider's `thought_level` select
 * discovered at session open, §5.5) take precedence when present; otherwise
 * the catalog metadata lookup applies (codex static catalog etc.).
 * Sessions that inherit their provider model resolve through `getSelectedModel`.
 * `undefined` when the session is unknown or neither the session nor the loaded
 * catalog advertises effort support.
 */
export const getAgentModelEffortLevels = (
  state: ProviderReadState,
  agentId: string,
): string[] | undefined => {
  const session = state.agentSessions?.byAgentId[agentId];
  if (!session) return undefined;
  if (Array.isArray(session.effortLevels) && session.effortLevels.length > 0) {
    return session.effortLevels;
  }
  const settings = session.workspaceId
    ? (state.providerCatalog?.byWorkspaceId?.[session.workspaceId]?.settings ?? [])
    : undefined;
  const configuredProvider = settings?.find(
    (entry) => entry.path === 'model.defaultProvider',
  )?.value;
  const fallbackProvider = settings
    ? typeof configuredProvider === 'string'
      ? configuredProvider
      : ''
    : getEffectiveDefaultProviderId(state);
  const rawProviderId = getAgentProvider(session, fallbackProvider);
  const providerId = getNormalizedProviderId(
    state,
    rawProviderId ?? fallbackProvider,
    session.workspaceId,
  );
  const defaults = settings?.find((entry) => entry.path === 'model.providerDefaults')?.value;
  const configuredModel =
    defaults && typeof defaults === 'object'
      ? (defaults as Record<string, unknown>)[providerId]
      : undefined;
  const model =
    session.model ??
    (settings
      ? typeof configuredModel === 'string'
        ? configuredModel
        : ''
      : getSelectedModel(state, providerId));
  return getProviderModelEffortLevels(state, providerId, model, session.workspaceId);
};
