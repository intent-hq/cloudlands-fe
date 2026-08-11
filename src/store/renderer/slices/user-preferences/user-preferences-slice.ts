import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createBooleanPreference } from '@augmentcode/themis/utils/store/boolean-preference';
import { SYSTEM_LANGUAGE_PREFERENCE } from '$shared/i18n/locale-matcher';
import type { GithubLinkDefaultAction } from '$shared/utils/link-helpers';

export const SYSTEM_DEFAULT_FONT =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace";

export type FontStyle = 'sans' | 'monospace';
export type AgentFontStyle = FontStyle;
export type NoteFontStyle = FontStyle | 'serif';

export const FONT_STYLES: FontStyle[] = ['sans', 'monospace'];
export const NOTE_FONT_STYLES: NoteFontStyle[] = ['sans', 'serif', 'monospace'];

export interface FontOption {
  value: string;
  label: string;
  fontFamily: string;
}

export interface ActivityLogFiltersPreference {
  showFileChanges: boolean;
  showAgentActivity: boolean;
  showSystemEvents: boolean;
  showErrors: boolean;
  searchQuery: string;
  dateRange: string;
  actorFilter: string;
}

export interface ActivityLogPresetPreference {
  name: string;
  filters: ActivityLogFiltersPreference;
}

export type UserPreferencesState = {
  betaUpdatesEnabled: boolean;
  spellcheckEnabled: boolean;
  zoomFactor: number;
  showArchived: boolean;
  groupByRepo: boolean;
  hasCompletedProviderSetup: boolean;
  /** Whether reasoning (thinking) dropdowns are shown in chat transcripts. */
  showReasoningBlocks: boolean;
  agentFontStyle: AgentFontStyle;
  noteFontStyle: NoteFontStyle;
  codeFontFamily: string;
  systemFonts: string[];
  enabled: boolean;
  soundEnabled: boolean;
  soundOnlyWhenUnfocused: boolean;
  volume: number;
  activityLogPresets: ActivityLogPresetPreference[];
  /** BCP-47 locale tag of an available catalog, or "system" to follow the OS. */
  languagePreference: string;
  githubLinkDefaultAction: GithubLinkDefaultAction;
};

export type FontSettingsState = Pick<
  UserPreferencesState,
  'agentFontStyle' | 'noteFontStyle' | 'codeFontFamily' | 'systemFonts'
>;

export type NotificationSettingsState = Pick<
  UserPreferencesState,
  'enabled' | 'soundEnabled' | 'soundOnlyWhenUnfocused' | 'volume'
>;

const fontSettingsInitialState: FontSettingsState = {
  agentFontStyle: 'sans',
  noteFontStyle: 'sans',
  codeFontFamily: 'system-default',
  systemFonts: [],
};

const notificationSettingsInitialState: NotificationSettingsState = {
  enabled: true,
  soundEnabled: true,
  soundOnlyWhenUnfocused: true,
  volume: 0.5,
};

export const initialState: UserPreferencesState = {
  betaUpdatesEnabled: false,
  spellcheckEnabled: false,
  zoomFactor: 1.0,
  showArchived: false,
  groupByRepo: true,
  hasCompletedProviderSetup: false,
  showReasoningBlocks: false,
  ...fontSettingsInitialState,
  ...notificationSettingsInitialState,
  activityLogPresets: [],
  languagePreference: SYSTEM_LANGUAGE_PREFERENCE,
  githubLinkDefaultAction: 'show-choices',
};

const betaUpdatesPreference = createBooleanPreference<UserPreferencesState>({
  sliceName: 'userPreferences',
  field: 'betaUpdatesEnabled',
  setActionName: 'setBetaUpdatesEnabled',
  toggleActionName: 'toggleBetaUpdates',
});

export const setBetaUpdatesEnabled = betaUpdatesPreference.setAction;

export const toggleBetaUpdates = betaUpdatesPreference.toggleAction;

export const loadBetaUpdatesSettings = createAction<[enabled: boolean]>(
  'userPreferences/loadBetaUpdatesSettings',
);

const spellcheckPreference = createBooleanPreference<UserPreferencesState>({
  sliceName: 'userPreferences',
  field: 'spellcheckEnabled',
  setActionName: 'setSpellcheckEnabled',
  toggleActionName: 'toggleSpellcheck',
});

export const setSpellcheckEnabled = spellcheckPreference.setAction;

export const toggleSpellcheck = spellcheckPreference.toggleAction;

export const setZoomFactor = createAction<[factor: number]>('userPreferences/setZoomFactor');

export const setAgentFontStyle = createAction<[style: AgentFontStyle]>(
  'fontSettings/setAgentFontStyle',
);

export const cycleFontStyle = createAction('fontSettings/cycleFontStyle');

export const setNoteFontStyle = createAction<[style: NoteFontStyle]>(
  'fontSettings/setNoteFontStyle',
);

export const cycleNoteFontStyle = createAction('fontSettings/cycleNoteFontStyle');

export const setCodeFontFamily = createAction<[fontFamily: string]>(
  'fontSettings/setCodeFontFamily',
);

export const setSystemFonts = createAction<[fonts: string[]]>('fontSettings/setSystemFonts');

export const setNotificationEnabled = createAction<[value: boolean]>(
  'notificationSettings/setNotificationEnabled',
);

export const setSoundEnabled = createAction<[value: boolean]>(
  'notificationSettings/setSoundEnabled',
);

export const setSoundOnlyWhenUnfocused = createAction<[value: boolean]>(
  'notificationSettings/setSoundOnlyWhenUnfocused',
);

export const setVolume = createAction<[value: number]>('notificationSettings/setVolume');

export const resetNotificationSettings = createAction(
  'notificationSettings/resetNotificationSettings',
);

export const hydrateActivityLogPresets = createAction<[presets: ActivityLogPresetPreference[]]>(
  'userPreferences/hydrateActivityLogPresets',
);

export const saveActivityLogPreset = createAction<[preset: ActivityLogPresetPreference]>(
  'userPreferences/saveActivityLogPreset',
);

export const deleteActivityLogPreset = createAction<[index: number]>(
  'userPreferences/deleteActivityLogPreset',
);

export const setLanguagePreference = createAction<[preference: string]>(
  'userPreferences/setLanguagePreference',
);

export const setGithubLinkDefaultAction = createAction<[action: GithubLinkDefaultAction]>(
  'userPreferences/setGithubLinkDefaultAction',
);

const showArchivedPreference = createBooleanPreference<UserPreferencesState>({
  sliceName: 'userPreferences',
  field: 'showArchived',
  setActionName: 'setShowArchived',
  toggleActionName: 'toggleShowArchived',
});

export const setShowArchived = showArchivedPreference.setAction;

export const toggleShowArchived = showArchivedPreference.toggleAction;

const groupByRepoPreference = createBooleanPreference<UserPreferencesState>({
  sliceName: 'userPreferences',
  field: 'groupByRepo',
  setActionName: 'setGroupByRepo',
  toggleActionName: 'toggleGroupByRepo',
});

export const setGroupByRepo = groupByRepoPreference.setAction;

export const toggleGroupByRepo = groupByRepoPreference.toggleAction;

const hasCompletedProviderSetupPreference = createBooleanPreference<UserPreferencesState>({
  sliceName: 'userPreferences',
  field: 'hasCompletedProviderSetup',
  setActionName: 'setHasCompletedProviderSetup',
  toggleActionName: 'toggleHasCompletedProviderSetup',
});

export const setHasCompletedProviderSetup = hasCompletedProviderSetupPreference.setAction;

export const toggleHasCompletedProviderSetup = hasCompletedProviderSetupPreference.toggleAction;

const showReasoningBlocksPreference = createBooleanPreference<UserPreferencesState>({
  sliceName: 'userPreferences',
  field: 'showReasoningBlocks',
  setActionName: 'setShowReasoningBlocks',
  toggleActionName: 'toggleShowReasoningBlocks',
});

export const setShowReasoningBlocks = showReasoningBlocksPreference.setAction;

export const toggleShowReasoningBlocks = showReasoningBlocksPreference.toggleAction;

export const userPreferencesReducer = createReducer<UserPreferencesState>(initialState);
betaUpdatesPreference.register(userPreferencesReducer);
spellcheckPreference.register(userPreferencesReducer);
showArchivedPreference.register(userPreferencesReducer);
groupByRepoPreference.register(userPreferencesReducer);
hasCompletedProviderSetupPreference.register(userPreferencesReducer);
showReasoningBlocksPreference.register(userPreferencesReducer);
userPreferencesReducer.with(loadBetaUpdatesSettings, (state, { payload: [enabled] }) => ({
  ...state,
  betaUpdatesEnabled: enabled,
}));
userPreferencesReducer.with(setZoomFactor, (state, { payload: [factor] }) => {
  if (!Number.isFinite(factor) || factor <= 0) return state;
  if (factor === state.zoomFactor) return state;
  return { ...state, zoomFactor: factor };
});
userPreferencesReducer.with(setAgentFontStyle, (state, { payload: [style] }) => ({
  ...state,
  agentFontStyle: style,
}));
userPreferencesReducer.with(cycleFontStyle, (state) => ({
  ...state,
  agentFontStyle: FONT_STYLES[(FONT_STYLES.indexOf(state.agentFontStyle) + 1) % FONT_STYLES.length],
}));
userPreferencesReducer.with(setNoteFontStyle, (state, { payload: [style] }) => ({
  ...state,
  noteFontStyle: style,
}));
userPreferencesReducer.with(cycleNoteFontStyle, (state) => ({
  ...state,
  noteFontStyle:
    NOTE_FONT_STYLES[(NOTE_FONT_STYLES.indexOf(state.noteFontStyle) + 1) % NOTE_FONT_STYLES.length],
}));
userPreferencesReducer.with(setCodeFontFamily, (state, { payload: [fontFamily] }) => ({
  ...state,
  codeFontFamily: fontFamily,
}));
userPreferencesReducer.with(setSystemFonts, (state, { payload: [fonts] }) => ({
  ...state,
  systemFonts: fonts,
}));
userPreferencesReducer.with(setNotificationEnabled, (state, { payload: [value] }) => ({
  ...state,
  enabled: value,
}));
userPreferencesReducer.with(setSoundEnabled, (state, { payload: [value] }) => ({
  ...state,
  soundEnabled: value,
}));
userPreferencesReducer.with(setSoundOnlyWhenUnfocused, (state, { payload: [value] }) => ({
  ...state,
  soundOnlyWhenUnfocused: value,
}));
userPreferencesReducer.with(setVolume, (state, { payload: [value] }) => ({
  ...state,
  volume: Math.max(0, Math.min(1, value)),
}));
userPreferencesReducer.with(resetNotificationSettings, (state) => ({
  ...state,
  ...notificationSettingsInitialState,
}));
userPreferencesReducer.with(hydrateActivityLogPresets, (state, { payload: [presets] }) => ({
  ...state,
  activityLogPresets: presets,
}));
userPreferencesReducer.with(saveActivityLogPreset, (state, { payload: [preset] }) => ({
  ...state,
  activityLogPresets: [...state.activityLogPresets, preset],
}));
userPreferencesReducer.with(deleteActivityLogPreset, (state, { payload: [index] }) => ({
  ...state,
  activityLogPresets: state.activityLogPresets.filter((_, i) => i !== index),
}));
userPreferencesReducer.with(setLanguagePreference, (state, { payload: [preference] }) => ({
  ...state,
  languagePreference: preference,
}));
userPreferencesReducer.with(setGithubLinkDefaultAction, (state, { payload: [action] }) => ({
  ...state,
  githubLinkDefaultAction: action,
}));
