import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  activeProviderAccepted,
  atomicDefaultModelAccepted,
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
export const BG_MODEL_MIGRATION_MARKER_KEY = 'bg-model-haiku45-migrated';

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
  typeReasoningEffortOverrides?: Record<string, string>;
  defaultModel: string;
  typeOverrides: Record<BackgroundAgentType, string>;
}

// ============================================================================
// State
// ============================================================================

export type BackgroundSettingsValues = Required<ProviderBgSettings> & {
  providerSettings: Record<string, ProviderBgSettings>;
};
export const backgroundFields = [
  'defaultModel',
  'typeOverrides',
  'defaultReasoningEffort',
  'typeReasoningEffortOverrides',
  'providerSettings',
] as const satisfies readonly (keyof BackgroundSettingsValues)[];
type BackgroundField = (typeof backgroundFields)[number];
type LocalField =
  | BackgroundField
  | `typeOverrides.${BackgroundAgentType}`
  | `typeReasoningEffortOverrides.${string}`;

export type BackgroundAgentSettingsState = {
  /** Last local intent per field (map edits also track individual entries). */
  pendingFields?: Partial<Record<LocalField, number>>;
  /** Latest actual daemon values, independently of optimistic local edits. */
  authoritativeSettings?: {
    values: BackgroundSettingsValues;
    revisions: Partial<Record<BackgroundField, number | undefined>>;
    providerRevision?: number;
    providerId?: string;
  };
  /** Local intent protects the entire provider bundle from delayed settings echoes. */
  persistenceGeneration?: number;
  persistencePending?: boolean;
  providerSwitchPending?: boolean;
  providerId?: string;
  defaultReasoningEffort: string;
  typeReasoningEffortOverrides: Record<string, string>;
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
export const setTypeReasoningEffortOverrides = createAction<[overrides: Record<string, string>]>(
  'backgroundAgentSettings/setTypeReasoningEffortOverrides',
);
export const backgroundProviderSwitchBlocked = createAction<[providerId: string]>(
  'backgroundAgentSettings/providerSwitchBlocked',
);
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
      revision?: number;
      changedFields?: readonly BackgroundField[];
      providerChanged?: boolean;
    },
  ]
>('backgroundAgentSettings/hydrateSettings');

export const backgroundSettingsSaveSettled = createAction<
  [
    payload: {
      generation: number;
      providerId?: string;
      revision?: number;
      authoritativeProviderId?: string;
      savedValues?: BackgroundSettingsValues;
    },
  ]
>('backgroundAgentSettings/saveSettled');

// Every local edit/switch advances the bundle's intent. A response may retire
// only the intent it saved, never another click that arrived during the request.
function pending(
  state: BackgroundAgentSettingsState,
  fields: readonly LocalField[] = backgroundFields,
) {
  return {
    ...state,
    persistenceGeneration: (state.persistenceGeneration ?? 0) + 1,
    persistencePending: true,
    pendingFields: {
      ...state.pendingFields,
      ...Object.fromEntries(fields.map((field) => [field, (state.persistenceGeneration ?? 0) + 1])),
    },
  };
}

export const backgroundSettingsHydrationRequested = createAction<
  [settings: Parameters<typeof hydrateSettings>[0]]
>('backgroundAgentSettings/hydrationRequested');
export const backgroundSettingsMigrationRequested = createAction(
  'backgroundAgentSettings/migrationRequested',
);

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

backgroundAgentSettingsReducer.with(backgroundSettingsMigrationRequested, (state) =>
  pending(state),
);
backgroundAgentSettingsReducer.with(setDefaultModel, (state, { payload: [model] }) => ({
  ...pending(state, ['defaultModel']),
  defaultModel: model,
}));
backgroundAgentSettingsReducer.with(setTypeOverride, (state, { payload: [{ type, model }] }) => ({
  ...pending(state, [`typeOverrides.${type}`]),
  typeOverrides: { ...state.typeOverrides, [type]: model },
}));
backgroundAgentSettingsReducer.with(clearTypeOverride, (state, { payload: [type] }) => ({
  ...pending(state, [`typeOverrides.${type}`]),
  typeOverrides: { ...state.typeOverrides, [type]: '' },
}));
backgroundAgentSettingsReducer.with(resetSettings, (state) => ({
  ...pending(state),
  providerId: state.providerId,
  ...initialState,
  typeOverrides: { ...initialState.typeOverrides },
  providerSettings: {},
}));
backgroundAgentSettingsReducer.with(hydrateSettings, (state, { payload: [payload] }) => {
  const values: BackgroundSettingsValues = {
    providerSettings: payload.providerSettings ?? state.providerSettings,
    defaultReasoningEffort: payload.defaultReasoningEffort?.trim() || '',
    typeReasoningEffortOverrides: normalizeEffortOverrides(payload.typeReasoningEffortOverrides),
    defaultModel: payload.defaultModel || DEFAULT_BACKGROUND_MODEL,
    typeOverrides: { ...DEFAULT_TYPE_OVERRIDES, ...payload.typeOverrides },
  };
  const previous = state.authoritativeSettings;
  const authoritative = {
    values: { ...(previous?.values ?? values) },
    revisions: { ...previous?.revisions },
    providerId:
      payload.providerChanged || !previous?.providerId ? payload.providerId : previous.providerId,
    providerRevision: payload.providerChanged ? payload.revision : previous?.providerRevision,
  };
  for (const field of payload.changedFields ?? backgroundFields) {
    Object.assign(authoritative.values, { [field]: values[field] });
    authoritative.revisions[field] = payload.revision;
  }
  return state.persistencePending
    ? { ...state, authoritativeSettings: authoritative }
    : {
        ...state,
        ...values,
        providerId: payload.providerId ?? state.providerId,
        authoritativeSettings: authoritative,
      };
});
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
  ...pending(state, ['defaultReasoningEffort']),
  defaultReasoningEffort: effort.trim(),
}));
backgroundAgentSettingsReducer.with(
  setTypeReasoningEffortOverride,
  (state, { payload: [{ type, effort }] }) => {
    const overrides = { ...state.typeReasoningEffortOverrides };
    if (effort.trim()) overrides[type] = effort.trim();
    else delete overrides[type];
    return {
      ...pending(state, [`typeReasoningEffortOverrides.${type}`]),
      typeReasoningEffortOverrides: overrides,
    };
  },
);
backgroundAgentSettingsReducer.with(resetTypeOverride, (state, { payload: [type] }) => {
  const overrides = { ...state.typeReasoningEffortOverrides };
  delete overrides[type];
  return {
    ...pending(state, [`typeOverrides.${type}`, `typeReasoningEffortOverrides.${type}`]),
    typeOverrides: { ...state.typeOverrides, [type]: '' },
    typeReasoningEffortOverrides: overrides,
  };
});

function switchProvider(
  state: BackgroundAgentSettingsState,
  providerId: string,
): BackgroundAgentSettingsState {
  if (!providerId) return state;
  if (providerId === state.providerId)
    return { ...state, persistencePending: state.persistencePending ?? false };
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
    providerSwitchPending: true,
    providerSettings,
    defaultModel: next?.defaultModel ?? '',
    typeOverrides: { ...DEFAULT_TYPE_OVERRIDES, ...next?.typeOverrides },
    defaultReasoningEffort: next?.defaultReasoningEffort?.trim() ?? '',
    typeReasoningEffortOverrides: normalizeEffortOverrides(next?.typeReasoningEffortOverrides),
  };
}
backgroundAgentSettingsReducer.with(activeProviderAccepted, (state, { payload: [providerId] }) =>
  switchProvider(state, providerId),
);
backgroundAgentSettingsReducer.with(
  atomicDefaultModelAccepted,
  (state, { payload: [{ providerId }] }) => switchProvider(state, providerId),
);

backgroundAgentSettingsReducer.with(
  setTypeReasoningEffortOverrides,
  (state, { payload: [overrides] }) => ({
    ...pending(state, ['typeReasoningEffortOverrides']),
    typeReasoningEffortOverrides: normalizeEffortOverrides(overrides),
  }),
);

/** Merge a settled write by revision, then reapply only still-unsaved local intent. */
export function reconcileBackgroundSettings(
  state: BackgroundAgentSettingsState,
  ack: Parameters<typeof backgroundSettingsSaveSettled>[0],
): BackgroundAgentSettingsState {
  const previous = state.authoritativeSettings;
  const authoritative = {
    values: {
      ...(previous?.values ?? {
        defaultModel: state.defaultModel,
        typeOverrides: state.typeOverrides,
        defaultReasoningEffort: state.defaultReasoningEffort,
        typeReasoningEffortOverrides: state.typeReasoningEffortOverrides,
        providerSettings: state.providerSettings,
      }),
    },
    revisions: { ...previous?.revisions },
    providerId: previous?.providerId ?? state.providerId,
    providerRevision: previous?.providerRevision,
  };
  if (ack.revision !== undefined && ack.savedValues) {
    for (const field of backgroundFields) {
      // Zero is the legacy client's synthetic revision, not an ordering token.
      if (ack.revision > 0 && (authoritative.revisions[field] ?? -1) > ack.revision) continue;
      Object.assign(authoritative.values, { [field]: ack.savedValues[field] });
      authoritative.revisions[field] = ack.revision;
    }
    if (ack.revision === 0 || (authoritative.providerRevision ?? -1) <= ack.revision) {
      authoritative.providerId = ack.providerId;
      authoritative.providerRevision = ack.revision;
    }
  }
  // The write can settle after another control selected a different provider.
  // Its authority is retained, but its values cannot replace that local bundle.
  if (ack.providerId !== state.providerId)
    return { ...state, authoritativeSettings: authoritative };
  const next = { ...state, ...authoritative.values };
  for (const field of backgroundFields) {
    if ((state.pendingFields?.[field] ?? 0) > ack.generation) {
      Object.assign(next, { [field]: state[field] });
    } else if (field === 'typeOverrides' || field === 'typeReasoningEffortOverrides') {
      const map: Record<string, string> = { ...next[field] };
      for (const [path, generation] of Object.entries(state.pendingFields ?? {})) {
        if ((generation ?? 0) <= ack.generation || !path.startsWith(`${field}.`)) continue;
        const key = path.slice(field.length + 1);
        const current: Record<string, string> = state[field];
        if (key in current) map[key] = current[key];
        else delete map[key];
      }
      Object.assign(next, { [field]: map });
    }
  }
  const settled = ack.generation === state.persistenceGeneration;
  // A later local edit is still addressed to the chosen provider. Do not mix a
  // foreign authoritative bundle into it while that edit waits for the lock.
  if (!settled && authoritative.providerId !== state.providerId)
    return {
      ...state,
      authoritativeSettings: authoritative,
    };
  return {
    ...next,
    providerId: settled ? authoritative.providerId : state.providerId,
    authoritativeSettings: authoritative,
    pendingFields: Object.fromEntries(
      Object.entries(state.pendingFields ?? {}).filter(
        ([, generation]) => (generation ?? 0) > ack.generation,
      ),
    ),
    providerSwitchPending: settled ? false : state.providerSwitchPending,
    persistencePending: settled ? false : state.persistencePending,
  };
}
backgroundAgentSettingsReducer.with(backgroundSettingsSaveSettled, (state, { payload: [ack] }) =>
  reconcileBackgroundSettings(state, ack),
);
