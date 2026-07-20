import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import { MODEL_DEFAULTS } from "$shared/constants/agent-services";
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import type { ModelFallbackResult } from "$lib/utils/model-fallback";
import { findBestAvailableModel } from "$lib/utils/model-fallback";

// ============================================================================
// Types & Constants (re-exported from old store)
// ============================================================================

export const DEFAULT_BACKGROUND_MODEL = MODEL_DEFAULTS.BACKGROUND_AGENT_MODEL;

export type BackgroundAgentType = "commit" | "pr" | "review" | "fast";

export const BACKGROUND_AGENT_TYPE_INFO: Record<
  BackgroundAgentType,
  { label: string; description: string }
> = {
  commit: {
    label: "Commit message",
    description: "Generates git commit messages from staged changes",
  },
  pr: {
    label: "PR description",
    description: "Generates pull request titles and descriptions",
  },
  review: {
    label: "Code review",
    description: "Performs automated code reviews on changes",
  },
  fast: {
    label: "Quick tasks",
    description: "Prompt enhancement, layout suggestions, and setup scripts",
  },
};

/** Shape of per-provider cached settings */
export interface ProviderBgSettings {
  defaultModel: string;
  typeOverrides: Record<BackgroundAgentType, string>;
}

// ============================================================================
// State
// ============================================================================

export type BackgroundAgentSettingsState = {
  defaultModel: string;
  typeOverrides: Record<BackgroundAgentType, string>;
  /** Per-provider settings cache (provider ID → settings snapshot). Map→Record for serialization. */
  providerSettings: Record<string, ProviderBgSettings>;
};

export const STORAGE_KEY = "workspaces-background-agent-settings";
export const PROVIDER_SETTINGS_KEY = "workspaces-bg-agent-settings-per-provider";

const DEFAULT_TYPE_OVERRIDES: Record<BackgroundAgentType, string> = {
  commit: "",
  pr: "",
  review: "",
  fast: "",
};

export const initialState: BackgroundAgentSettingsState = {
  defaultModel: DEFAULT_BACKGROUND_MODEL,
  typeOverrides: { ...DEFAULT_TYPE_OVERRIDES },
  providerSettings: {},
};

// ============================================================================
// Reducer Actions (pure state updates)
// ============================================================================

export const setDefaultModel = createAction<[model: string]>(
  "backgroundAgentSettings/setDefaultModel"
);

export const setTypeOverride = createAction<
  [payload: { type: BackgroundAgentType; model: string }]
>("backgroundAgentSettings/setTypeOverride");

export const clearTypeOverride = createAction<[type: BackgroundAgentType]>(
  "backgroundAgentSettings/clearTypeOverride"
);

export const resetSettings = createAction(
  "backgroundAgentSettings/resetSettings"
);

/** Hydrate full state from localStorage (used by init saga) */
export const hydrateSettings = createAction<
  [payload: { defaultModel: string; typeOverrides: Record<BackgroundAgentType, string> }]
>("backgroundAgentSettings/hydrateSettings");

/** Hydrate provider settings cache from localStorage */
export const hydrateProviderSettings = createAction<
  [providerSettings: Record<string, ProviderBgSettings>]
>("backgroundAgentSettings/hydrateProviderSettings");

/** Save current settings for a provider (used by switchProvider saga) */
export const saveProviderSnapshot = createAction<
  [payload: { providerId: string; settings: ProviderBgSettings }]
>("backgroundAgentSettings/saveProviderSnapshot");

/** Restore settings for a provider (used by switchProvider saga) */
export const restoreProviderSettings = createAction<
  [payload: { defaultModel: string; typeOverrides: Record<BackgroundAgentType, string> }]
>("backgroundAgentSettings/restoreProviderSettings");

// ============================================================================
// Saga Trigger Actions (dispatched by consumers, handled by sagas)
// ============================================================================

export const switchProvider = createAction<
  [payload: { newProviderId: string; previousProviderId: string }]
>("backgroundAgentSettings/switchProvider");

// ============================================================================
// Utility function (not a selector — takes runtime params)
// ============================================================================

export function getValidatedModelForType(
  type: BackgroundAgentType,
  defaultModel: string,
  typeOverrides: Record<BackgroundAgentType, string>,
  availableModels: AuggieModel[]
): ModelFallbackResult {
  const override = typeOverrides[type];
  const requestedModel = override && override.length > 0 ? override : defaultModel;
  return findBestAvailableModel(requestedModel, availableModels);
}

// ============================================================================
// Reducer
// ============================================================================

export const backgroundAgentSettingsReducer =
  createReducer<BackgroundAgentSettingsState>(initialState)
    .with(setDefaultModel, (state, { payload: [model] }) => ({
      ...state,
      defaultModel: model,
    }))
    .with(setTypeOverride, (state, { payload: [{ type, model }] }) => ({
      ...state,
      typeOverrides: { ...state.typeOverrides, [type]: model },
    }))
    .with(clearTypeOverride, (state, { payload: [type] }) => ({
      ...state,
      typeOverrides: { ...state.typeOverrides, [type]: "" },
    }))
    .with(resetSettings, () => ({
      ...initialState,
      typeOverrides: { ...initialState.typeOverrides },
      providerSettings: {},
    }))
    .with(hydrateSettings, (state, { payload: [{ defaultModel, typeOverrides }] }) => ({
      ...state,
      defaultModel: defaultModel || DEFAULT_BACKGROUND_MODEL,
      typeOverrides: {
        commit: typeOverrides?.commit || "",
        pr: typeOverrides?.pr || "",
        review: typeOverrides?.review || "",
        fast: typeOverrides?.fast || "",
      },
    }))
    .with(hydrateProviderSettings, (state, { payload: [providerSettings] }) => ({
      ...state,
      providerSettings,
    }))
    .with(saveProviderSnapshot, (state, { payload: [{ providerId, settings }] }) => ({
      ...state,
      providerSettings: { ...state.providerSettings, [providerId]: settings },
    }))
    .with(restoreProviderSettings, (state, { payload: [{ defaultModel, typeOverrides }] }) => ({
      ...state,
      defaultModel,
      typeOverrides: {
        commit: typeOverrides.commit || "",
        pr: typeOverrides.pr || "",
        review: typeOverrides.review || "",
        fast: typeOverrides.fast || "",
      },
    }))
;

