import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { m } from '$shared/paraglide/messages.js';

// ============================================================================
// Types & Constants (re-exported from old store)
// ============================================================================

/**
 * Empty string means "no explicit background model configured": consumers
 * omit `model` on the wire so the provider CLI/daemon default applies
 * (PROTOCOL §5.31/§5.32). There is intentionally no hardcoded model id here.
 */
export const DEFAULT_BACKGROUND_MODEL = '';

export type BackgroundAgentType = 'commit' | 'pr' | 'review' | 'fast';

// Localized copy uses getters so it re-evaluates with the active locale.
export const BACKGROUND_AGENT_TYPE_INFO: Record<
  BackgroundAgentType,
  { label: string; description: string }
> = {
  commit: {
    get label() {
      return m.settings_backgroundAgents_commit_label();
    },
    get description() {
      return m.settings_backgroundAgents_commit_description();
    },
  },
  pr: {
    get label() {
      return m.settings_backgroundAgents_pr_label();
    },
    get description() {
      return m.settings_backgroundAgents_pr_description();
    },
  },
  review: {
    get label() {
      return m.settings_backgroundAgents_review_label();
    },
    get description() {
      return m.settings_backgroundAgents_review_description();
    },
  },
  fast: {
    get label() {
      return m.settings_backgroundAgents_fast_label();
    },
    get description() {
      return m.settings_backgroundAgents_fast_description();
    },
  },
};

/** Shape of per-provider cached settings */
interface ProviderBgSettings {
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

const DEFAULT_TYPE_OVERRIDES: Record<BackgroundAgentType, string> = {
  commit: '',
  pr: '',
  review: '',
  fast: '',
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
  'backgroundAgentSettings/setDefaultModel',
);

export const setTypeOverride = createAction<
  [payload: { type: BackgroundAgentType; model: string }]
>('backgroundAgentSettings/setTypeOverride');

/** Hydrate full state from localStorage (used by init saga) */
export const hydrateSettings = createAction<
  [payload: { defaultModel: string; typeOverrides: Record<BackgroundAgentType, string> }]
>('backgroundAgentSettings/hydrateSettings');

// ============================================================================
// Reducer
// ============================================================================

export const backgroundAgentSettingsReducer =
  createReducer<BackgroundAgentSettingsState>(initialState);

backgroundAgentSettingsReducer.with(setDefaultModel, (state, { payload: [model] }) => ({
  ...state,
  defaultModel: model,
}));
backgroundAgentSettingsReducer.with(setTypeOverride, (state, { payload: [{ type, model }] }) => ({
  ...state,
  typeOverrides: { ...state.typeOverrides, [type]: model },
}));
backgroundAgentSettingsReducer.with(
  hydrateSettings,
  (state, { payload: [{ defaultModel, typeOverrides }] }) => ({
    ...state,
    defaultModel: defaultModel || DEFAULT_BACKGROUND_MODEL,
    typeOverrides: {
      commit: typeOverrides?.commit || '',
      pr: typeOverrides?.pr || '',
      review: typeOverrides?.review || '',
      fast: typeOverrides?.fast || '',
    },
  }),
);
