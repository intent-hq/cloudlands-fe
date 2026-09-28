import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  setActiveProvider,
  setAtomicDefaultModel,
} from '../provider-settings/provider-settings-slice';
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
export interface ProviderBgSettings {
  defaultReasoningEffort?: string;
  typeReasoningEffortOverrides?: Partial<Record<BackgroundAgentType, string>>;
  defaultModel: string;
  typeOverrides: Record<BackgroundAgentType, string>;
}

// ============================================================================
// State
// ============================================================================

export type BackgroundAgentSettingsState = {
  /** Local intent protects the entire provider bundle from delayed settings echoes. */
  persistenceGeneration?: number;
  persistencePending?: boolean;
  providerId?: string;
  defaultReasoningEffort: string;
  typeReasoningEffortOverrides: Partial<Record<BackgroundAgentType, string>>;
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

function normalizeEffortOverrides(overrides?: ProviderBgSettings['typeReasoningEffortOverrides']) {
  return Object.fromEntries(
    Object.entries(overrides ?? {}).flatMap(([type, effort]) =>
      effort?.trim() ? [[type, effort.trim()]] : [],
    ),
  );
}

export const initialState: BackgroundAgentSettingsState = {
  defaultReasoningEffort: '',
  typeReasoningEffortOverrides: {},
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

export const clearTypeOverride = createAction<[type: BackgroundAgentType]>(
  'backgroundAgentSettings/clearTypeOverride',
);

export const setDefaultReasoningEffort = createAction<[effort: string]>(
  'backgroundAgentSettings/setDefaultReasoningEffort',
);
export const setTypeReasoningEffortOverride = createAction<
  [payload: { type: BackgroundAgentType; effort: string }]
>('backgroundAgentSettings/setTypeReasoningEffortOverride');
export const resetTypeOverride = createAction<[type: BackgroundAgentType]>(
  'backgroundAgentSettings/resetTypeOverride',
);

export const resetSettings = createAction('backgroundAgentSettings/resetSettings');

/** Hydrate active settings from the daemon snapshot or a reconciled settings delta */
export const hydrateSettings = createAction<
  [
    payload: ProviderBgSettings & {
      providerId?: string;
      providerSettings?: Record<string, ProviderBgSettings>;
    },
  ]
>('backgroundAgentSettings/hydrateSettings');

export const backgroundSettingsSaveSettled = createAction<
  [payload: { generation: number; providerId?: string }]
>('backgroundAgentSettings/saveSettled');

// Every local edit/switch advances the bundle's intent. A response may retire
// only the intent it saved, never another click that arrived during the request.
function pending(state: BackgroundAgentSettingsState) {
  return {
    ...state,
    persistenceGeneration: (state.persistenceGeneration ?? 0) + 1,
    persistencePending: true,
  };
}

/** Hydrate provider settings snapshots from the daemon */
export const hydrateProviderSettings = createAction<
  [providerSettings: Record<string, ProviderBgSettings>]
>('backgroundAgentSettings/hydrateProviderSettings');

/** Save current settings for a provider (used by switchProvider saga) */
export const saveProviderSnapshot = createAction<
  [payload: { providerId: string; settings: ProviderBgSettings }]
>('backgroundAgentSettings/saveProviderSnapshot');

/** Restore settings for a provider (used by switchProvider saga) */
export const restoreProviderSettings = createAction<[payload: ProviderBgSettings]>(
  'backgroundAgentSettings/restoreProviderSettings',
);

// ============================================================================
// Reducer
// ============================================================================

export const backgroundAgentSettingsReducer =
  createReducer<BackgroundAgentSettingsState>(initialState);

backgroundAgentSettingsReducer.with(setDefaultModel, (state, { payload: [model] }) => ({
  ...pending(state),
  defaultModel: model,
}));
backgroundAgentSettingsReducer.with(setTypeOverride, (state, { payload: [{ type, model }] }) => ({
  ...pending(state),
  typeOverrides: { ...state.typeOverrides, [type]: model },
}));
backgroundAgentSettingsReducer.with(clearTypeOverride, (state, { payload: [type] }) => ({
  ...pending(state),
  typeOverrides: { ...state.typeOverrides, [type]: '' },
}));
backgroundAgentSettingsReducer.with(resetSettings, (state) => ({
  ...pending(state),
  providerId: state.providerId,
  ...initialState,
  typeOverrides: { ...initialState.typeOverrides },
  providerSettings: {},
}));
backgroundAgentSettingsReducer.with(
  hydrateSettings,
  (
    state,
    {
      payload: [
        {
          defaultModel,
          typeOverrides,
          defaultReasoningEffort,
          typeReasoningEffortOverrides,
          providerId,
          providerSettings,
        },
      ],
    },
  ) =>
    state.persistencePending
      ? state
      : {
          ...state,
          providerId: providerId ?? state.providerId,
          providerSettings: providerSettings ?? state.providerSettings,
          defaultReasoningEffort: defaultReasoningEffort?.trim() || '',
          typeReasoningEffortOverrides: normalizeEffortOverrides(typeReasoningEffortOverrides),
          defaultModel: defaultModel || DEFAULT_BACKGROUND_MODEL,
          typeOverrides: {
            commit: typeOverrides?.commit || '',
            pr: typeOverrides?.pr || '',
            review: typeOverrides?.review || '',
            fast: typeOverrides?.fast || '',
          },
        },
);
backgroundAgentSettingsReducer.with(
  hydrateProviderSettings,
  (state, { payload: [providerSettings] }) => ({
    ...state,
    providerSettings,
  }),
);
backgroundAgentSettingsReducer.with(
  saveProviderSnapshot,
  (state, { payload: [{ providerId, settings }] }) => ({
    ...state,
    providerSettings: { ...state.providerSettings, [providerId]: settings },
  }),
);
backgroundAgentSettingsReducer.with(
  restoreProviderSettings,
  (
    state,
    {
      payload: [
        { defaultModel, typeOverrides, defaultReasoningEffort, typeReasoningEffortOverrides },
      ],
    },
  ) => ({
    ...state,
    defaultModel,
    defaultReasoningEffort: defaultReasoningEffort?.trim() || '',
    typeReasoningEffortOverrides: normalizeEffortOverrides(typeReasoningEffortOverrides),
    typeOverrides: {
      commit: typeOverrides.commit || '',
      pr: typeOverrides.pr || '',
      review: typeOverrides.review || '',
      fast: typeOverrides.fast || '',
    },
  }),
);

backgroundAgentSettingsReducer.with(setDefaultReasoningEffort, (state, { payload: [effort] }) => ({
  ...pending(state),
  defaultReasoningEffort: effort.trim(),
}));
backgroundAgentSettingsReducer.with(
  setTypeReasoningEffortOverride,
  (state, { payload: [{ type, effort }] }) => {
    const overrides = { ...state.typeReasoningEffortOverrides };
    if (effort.trim()) overrides[type] = effort.trim();
    else delete overrides[type];
    return { ...pending(state), typeReasoningEffortOverrides: overrides };
  },
);
backgroundAgentSettingsReducer.with(resetTypeOverride, (state, { payload: [type] }) => {
  const overrides = { ...state.typeReasoningEffortOverrides };
  delete overrides[type];
  return {
    ...pending(state),
    typeOverrides: { ...state.typeOverrides, [type]: '' },
    typeReasoningEffortOverrides: overrides,
  };
});

function switchProvider(
  state: BackgroundAgentSettingsState,
  providerId: string,
): BackgroundAgentSettingsState {
  if (!providerId) return state;
  if (providerId === state.providerId) return pending(state);
  const { defaultModel, typeOverrides, defaultReasoningEffort, typeReasoningEffortOverrides } =
    state;
  const providerSettings = { ...state.providerSettings };
  if (state.providerId)
    providerSettings[state.providerId] = {
      defaultModel,
      typeOverrides,
      defaultReasoningEffort,
      typeReasoningEffortOverrides,
    };
  const next = providerSettings[providerId];
  return {
    ...pending(state),
    providerId,
    providerSettings,
    defaultModel: next?.defaultModel ?? '',
    typeOverrides: { ...DEFAULT_TYPE_OVERRIDES, ...next?.typeOverrides },
    defaultReasoningEffort: next?.defaultReasoningEffort?.trim() ?? '',
    typeReasoningEffortOverrides: normalizeEffortOverrides(next?.typeReasoningEffortOverrides),
  };
}
backgroundAgentSettingsReducer.with(setActiveProvider, (state, { payload: [providerId] }) =>
  switchProvider(state, providerId),
);
backgroundAgentSettingsReducer.with(setAtomicDefaultModel, (state, { payload: [{ providerId }] }) =>
  switchProvider(state, providerId),
);

backgroundAgentSettingsReducer.with(backgroundSettingsSaveSettled, (state, { payload: [ack] }) => ({
  ...state,
  persistencePending:
    ack.generation === state.persistenceGeneration && ack.providerId === state.providerId
      ? false
      : state.persistencePending,
}));
