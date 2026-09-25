import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createBooleanPreference } from '@augmentcode/themis/utils/store/boolean-preference';
import { SYSTEM_LANGUAGE_PREFERENCE } from '$shared/i18n/locale-matcher';
import type { GithubLinkDefaultAction } from '$shared/utils/link-helpers';
import type { UpdateChannel } from '$features/auto-update/types';
import type { AgentRulesEditorState, UserPreferencesStoreState } from './user-preferences-types';
import {
  SHORTCUT_DEFAULTS,
  isShortcutId,
  normalizeShortcut,
  sanitizeShortcutOverrides,
  type ShortcutId,
  type ShortcutOverrides,
} from '$lib/utils/shortcut-bindings';

export const SYSTEM_DEFAULT_FONT =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace";

export type FontStyle = 'sans' | 'monospace';
export type AgentFontStyle = FontStyle;
export type NoteFontStyle = FontStyle | 'serif';

export const FONT_STYLES: FontStyle[] = ['sans', 'monospace'];
const NOTE_FONT_STYLES: NoteFontStyle[] = ['sans', 'serif', 'monospace'];

export interface FontOption {
  value: string;
  label: string;
  fontFamily: string;
}

interface ActivityLogFiltersPreference {
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
  updateChannel: UpdateChannel;
  spellcheckEnabled: boolean;
  zoomFactor: number;
  showArchived: boolean;
  groupByRepo: boolean;
  hasCompletedProviderSetup: boolean;
  /** Whether reasoning (thinking) dropdowns are shown in chat transcripts. */
  showReasoningBlocks: boolean;
  chatAuroraEnabled: boolean;
  shellTransparencyEnabled: boolean;
  /** Whether motion is reduced while the machine runs on battery. */
  reduceMotionOnBattery: boolean;
  /** Whether the experimental Labs tab is visible in Settings. */
  labsSettingsVisible: boolean;
  /** Whether the Multiplayer lab (experimental) is enabled. */
  labsMultiplayerEnabled: boolean;
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
  shortcutOverrides: ShortcutOverrides;
};

type FontSettingsState = Pick<
  UserPreferencesState,
  'agentFontStyle' | 'noteFontStyle' | 'codeFontFamily' | 'systemFonts'
>;

type NotificationSettingsState = Pick<
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

const emptyAgentRulesEditor: AgentRulesEditorState = {
  active: false,
  generation: 0,
  content: '',
  originalContent: '',
  persistedContent: '',
  loading: true,
  errorMessage: null,
  saveStatus: 'idle',
};

export const initialState: UserPreferencesStoreState = {
  agentRulesEditor: emptyAgentRulesEditor,
  updateChannel: 'stable',
  spellcheckEnabled: false,
  zoomFactor: 1.0,
  showArchived: false,
  groupByRepo: true,
  hasCompletedProviderSetup: false,
  showReasoningBlocks: false,
  chatAuroraEnabled: true,
  shellTransparencyEnabled: true,
  reduceMotionOnBattery: false,
  labsSettingsVisible: false,
  labsMultiplayerEnabled: false,
  ...fontSettingsInitialState,
  ...notificationSettingsInitialState,
  activityLogPresets: [],
  languagePreference: SYSTEM_LANGUAGE_PREFERENCE,
  githubLinkDefaultAction: 'show-choices',
  shortcutOverrides: {},
};

export const setUpdateChannel = createAction<[channel: UpdateChannel]>(
  'userPreferences/setUpdateChannel',
);

export const agentRulesEditorOpened = createAction('userPreferences/agentRulesEditorOpened');
export const agentRulesEditorClosed = createAction('userPreferences/agentRulesEditorClosed');
export const agentRulesContentChanged = createAction<[content: string]>(
  'userPreferences/agentRulesContentChanged',
);
export const undoAgentRulesChanges = createAction('userPreferences/undoAgentRulesChanges');
export const saveAgentRules = createAction('userPreferences/saveAgentRules');
export const agentRulesLoaded = createAction<[generation: number, content: string]>(
  'userPreferences/agentRulesLoaded',
);
export const agentRulesSaveStarted = createAction<[generation: number]>(
  'userPreferences/agentRulesSaveStarted',
);
export const agentRulesSaved = createAction<[generation: number, content: string]>(
  'userPreferences/agentRulesSaved',
);
export const agentRulesFailed = createAction<[generation: number, message: string]>(
  'userPreferences/agentRulesFailed',
);
export const agentRulesErrorCleared = createAction<[generation: number]>(
  'userPreferences/agentRulesErrorCleared',
);
export const agentRulesSaveStatusCleared = createAction<[generation: number]>(
  'userPreferences/agentRulesSaveStatusCleared',
);

const spellcheckPreference = createBooleanPreference<UserPreferencesStoreState>({
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

export const hydrateShortcutOverrides = createAction<[overrides: unknown]>(
  'userPreferences/hydrateShortcutOverrides',
);

export const setShortcutOverride = createAction<[id: ShortcutId, shortcut: string]>(
  'userPreferences/setShortcutOverride',
);

export const resetShortcutOverride = createAction<[id: ShortcutId]>(
  'userPreferences/resetShortcutOverride',
);

export const resetAllShortcutOverrides = createAction('userPreferences/resetAllShortcutOverrides');

const showArchivedPreference = createBooleanPreference<UserPreferencesStoreState>({
  sliceName: 'userPreferences',
  field: 'showArchived',
  setActionName: 'setShowArchived',
  toggleActionName: 'toggleShowArchived',
});

export const setShowArchived = showArchivedPreference.setAction;

export const toggleShowArchived = showArchivedPreference.toggleAction;

const groupByRepoPreference = createBooleanPreference<UserPreferencesStoreState>({
  sliceName: 'userPreferences',
  field: 'groupByRepo',
  setActionName: 'setGroupByRepo',
  toggleActionName: 'toggleGroupByRepo',
});

export const setGroupByRepo = groupByRepoPreference.setAction;

export const toggleGroupByRepo = groupByRepoPreference.toggleAction;

const hasCompletedProviderSetupPreference = createBooleanPreference<UserPreferencesStoreState>({
  sliceName: 'userPreferences',
  field: 'hasCompletedProviderSetup',
  setActionName: 'setHasCompletedProviderSetup',
  toggleActionName: 'toggleHasCompletedProviderSetup',
});

export const setHasCompletedProviderSetup = hasCompletedProviderSetupPreference.setAction;

export const toggleHasCompletedProviderSetup = hasCompletedProviderSetupPreference.toggleAction;

const showReasoningBlocksPreference = createBooleanPreference<UserPreferencesStoreState>({
  sliceName: 'userPreferences',
  field: 'showReasoningBlocks',
  setActionName: 'setShowReasoningBlocks',
  toggleActionName: 'toggleShowReasoningBlocks',
});

export const setShowReasoningBlocks = showReasoningBlocksPreference.setAction;

export const toggleShowReasoningBlocks = showReasoningBlocksPreference.toggleAction;

const chatAuroraPreference = createBooleanPreference<UserPreferencesStoreState>({
  sliceName: 'userPreferences',
  field: 'chatAuroraEnabled',
  setActionName: 'setChatAuroraEnabled',
  toggleActionName: 'toggleChatAurora',
});

export const setChatAuroraEnabled = chatAuroraPreference.setAction;

export const toggleChatAurora = chatAuroraPreference.toggleAction;

const shellTransparencyPreference = createBooleanPreference<UserPreferencesStoreState>({
  sliceName: 'userPreferences',
  field: 'shellTransparencyEnabled',
  setActionName: 'setShellTransparencyEnabled',
  toggleActionName: 'toggleShellTransparency',
});

export const setShellTransparencyEnabled = shellTransparencyPreference.setAction;

export const toggleShellTransparency = shellTransparencyPreference.toggleAction;

const reduceMotionOnBatteryPreference = createBooleanPreference<UserPreferencesStoreState>({
  sliceName: 'userPreferences',
  field: 'reduceMotionOnBattery',
  setActionName: 'setReduceMotionOnBattery',
  toggleActionName: 'toggleReduceMotionOnBattery',
});

export const setReduceMotionOnBattery = reduceMotionOnBatteryPreference.setAction;

export const toggleReduceMotionOnBattery = reduceMotionOnBatteryPreference.toggleAction;

const labsSettingsVisibilityPreference = createBooleanPreference<UserPreferencesStoreState>({
  sliceName: 'userPreferences',
  field: 'labsSettingsVisible',
  setActionName: 'setLabsSettingsVisible',
  toggleActionName: 'toggleLabsSettingsVisibility',
});

export const setLabsSettingsVisible = labsSettingsVisibilityPreference.setAction;

export const toggleLabsSettingsVisibility = labsSettingsVisibilityPreference.toggleAction;

const labsMultiplayerPreference = createBooleanPreference<UserPreferencesStoreState>({
  sliceName: 'userPreferences',
  field: 'labsMultiplayerEnabled',
  setActionName: 'setLabsMultiplayerEnabled',
  toggleActionName: 'toggleLabsMultiplayer',
});

export const setLabsMultiplayerEnabled = labsMultiplayerPreference.setAction;

export const toggleLabsMultiplayer = labsMultiplayerPreference.toggleAction;

export const userPreferencesReducer = createReducer<UserPreferencesStoreState>(initialState);
userPreferencesReducer.with(agentRulesEditorOpened, (state) => ({
  ...state,
  agentRulesEditor: {
    ...emptyAgentRulesEditor,
    active: true,
    generation: state.agentRulesEditor.generation + 1,
  },
}));
userPreferencesReducer.with(agentRulesEditorClosed, (state) =>
  !state.agentRulesEditor.active
    ? state
    : {
        ...state,
        agentRulesEditor: {
          ...state.agentRulesEditor,
          active: false,
          loading: false,
          saveStatus: 'idle',
        },
      },
);
userPreferencesReducer.with(agentRulesContentChanged, (state, { payload: [content] }) =>
  !state.agentRulesEditor.active || state.agentRulesEditor.content === content
    ? state
    : { ...state, agentRulesEditor: { ...state.agentRulesEditor, content, saveStatus: 'idle' } },
);
userPreferencesReducer.with(undoAgentRulesChanges, (state) => {
  const editor = state.agentRulesEditor;
  return !editor.active || editor.content === editor.originalContent
    ? state
    : {
        ...state,
        agentRulesEditor: { ...editor, content: editor.originalContent, saveStatus: 'idle' },
      };
});
userPreferencesReducer.with(agentRulesLoaded, (state, { payload: [generation, content] }) =>
  !state.agentRulesEditor.active || state.agentRulesEditor.generation !== generation
    ? state
    : {
        ...state,
        agentRulesEditor: {
          ...state.agentRulesEditor,
          content,
          originalContent: content,
          persistedContent: content.trim(),
          loading: false,
        },
      },
);
userPreferencesReducer.with(agentRulesSaveStarted, (state, { payload: [generation] }) =>
  !state.agentRulesEditor.active || state.agentRulesEditor.generation !== generation
    ? state
    : {
        ...state,
        agentRulesEditor: { ...state.agentRulesEditor, saveStatus: 'saving', errorMessage: null },
      },
);
userPreferencesReducer.with(agentRulesSaved, (state, { payload: [generation, content] }) =>
  !state.agentRulesEditor.active || state.agentRulesEditor.generation !== generation
    ? state
    : {
        ...state,
        agentRulesEditor: {
          ...state.agentRulesEditor,
          persistedContent: content,
          saveStatus: state.agentRulesEditor.content.trim() === content ? 'saved' : 'saving',
        },
      },
);
userPreferencesReducer.with(agentRulesFailed, (state, { payload: [generation, message] }) =>
  !state.agentRulesEditor.active || state.agentRulesEditor.generation !== generation
    ? state
    : {
        ...state,
        agentRulesEditor: {
          ...state.agentRulesEditor,
          loading: false,
          saveStatus: 'idle',
          errorMessage: message,
        },
      },
);
userPreferencesReducer.with(agentRulesErrorCleared, (state, { payload: [generation] }) =>
  state.agentRulesEditor.generation !== generation || state.agentRulesEditor.errorMessage === null
    ? state
    : { ...state, agentRulesEditor: { ...state.agentRulesEditor, errorMessage: null } },
);
userPreferencesReducer.with(agentRulesSaveStatusCleared, (state, { payload: [generation] }) =>
  state.agentRulesEditor.generation !== generation || state.agentRulesEditor.saveStatus === 'idle'
    ? state
    : { ...state, agentRulesEditor: { ...state.agentRulesEditor, saveStatus: 'idle' } },
);
spellcheckPreference.register(userPreferencesReducer);
showArchivedPreference.register(userPreferencesReducer);
groupByRepoPreference.register(userPreferencesReducer);
hasCompletedProviderSetupPreference.register(userPreferencesReducer);
showReasoningBlocksPreference.register(userPreferencesReducer);
chatAuroraPreference.register(userPreferencesReducer);
shellTransparencyPreference.register(userPreferencesReducer);
reduceMotionOnBatteryPreference.register(userPreferencesReducer);
labsSettingsVisibilityPreference.register(userPreferencesReducer);
labsMultiplayerPreference.register(userPreferencesReducer);
userPreferencesReducer.with(setUpdateChannel, (state, { payload: [channel] }) => ({
  ...state,
  updateChannel: channel,
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
userPreferencesReducer.with(hydrateShortcutOverrides, (state, { payload: [overrides] }) => ({
  ...state,
  shortcutOverrides: sanitizeShortcutOverrides(overrides),
}));
userPreferencesReducer.with(setShortcutOverride, (state, { payload: [id, shortcut] }) => {
  if (!isShortcutId(id)) return state;
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return state;
  const shortcutOverrides = { ...state.shortcutOverrides };
  if (normalized === SHORTCUT_DEFAULTS[id]) delete shortcutOverrides[id];
  else shortcutOverrides[id] = normalized;
  return { ...state, shortcutOverrides };
});
userPreferencesReducer.with(resetShortcutOverride, (state, { payload: [id] }) => {
  if (!(id in state.shortcutOverrides)) return state;
  const shortcutOverrides = { ...state.shortcutOverrides };
  delete shortcutOverrides[id];
  return { ...state, shortcutOverrides };
});
userPreferencesReducer.with(resetAllShortcutOverrides, (state) => {
  if (Object.keys(state.shortcutOverrides).length === 0) return state;
  return { ...state, shortcutOverrides: {} };
});
