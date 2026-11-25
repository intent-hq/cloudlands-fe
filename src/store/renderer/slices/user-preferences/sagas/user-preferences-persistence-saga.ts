import { dockShortcutSettingsSaga } from './dock-shortcut-settings-saga';
import { isDockShortcutId } from '$shared/dock-shortcut-settings';
import type { Action, ActionPattern } from '@redux-saga/types';
import { buffers, channel } from 'redux-saga';
import { call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { agentRulesSaga } from './agent-rules-saga';

import { isElectron } from '$lib/electron-bridge';
import { applyLanguagePreference } from '$lib/i18n/locale';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';
import {
  isGithubLinkDefaultAction,
  type GithubLinkDefaultAction,
} from '$shared/utils/link-helpers';
import { isChatContentWidth, type ChatContentWidth } from '$shared/chat-content-width';
import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '$store/renderer/utils/backend-storage-namespace';
import { getLocalStorageJSON } from '$store/renderer/utils/safe-local-storage-saga';
import {
  hydrateSharedPreference,
  isSharedPreferenceHydration,
  persistSharedPreference,
  watchSharedPreference,
  type SharedPreferenceSagaOptions,
} from '$store/renderer/utils/shared-preference-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import {
  selectActivityLogPresets,
  selectAgentFontStyle,
  selectChatAuroraEnabled,
  selectChatContentWidth,
  selectCollapseToolRuns,
  selectCodeFontFamily,
  selectGroupByRepo,
  selectGithubLinkDefaultAction,
  selectHasCompletedProviderSetup,
  selectLabsSettingsVisible,
  selectLabsRemoteAgentsEnabled,
  selectLabsPlainFolderWorkspacesEnabled,
  selectLabsTabGroupsEnabled,
  selectLabsSshMachineSetupEnabled,
  selectLanguagePreference,
  selectNoteFontStyle,
  selectMenuBarAutoHide,
  selectPauseAnimationsWhenUnfocused,
  selectReduceMotionOnBattery,
  selectShowArchived,
  selectShowReasoningBlocks,
  selectShellTransparencyEnabled,
  selectShortcutOverrides,
  selectSpellcheckEnabled,
} from '../user-preferences-selectors';
import {
  cycleNoteFontStyle,
  deleteActivityLogPreset,
  FONT_STYLES,
  hydrateActivityLogPresets,
  hydrateShortcutOverrides,
  userPreferencesHydrated,
  resetAllShortcutOverrides,
  resetShortcutOverride,
  saveActivityLogPreset,
  setAgentFontStyle,
  setChatAuroraEnabled,
  setChatContentWidth,
  setCollapseToolRuns,
  setCodeFontFamily,
  setGroupByRepo,
  setGithubLinkDefaultAction,
  setHasCompletedProviderSetup,
  providerSetupHydrated,
  setLabsSettingsVisible,
  setLabsRemoteAgentsEnabled,
  setLabsPlainFolderWorkspacesEnabled,
  setLabsTabGroupsEnabled,
  setLabsSshMachineSetupEnabled,
  setLanguagePreference,
  setNoteFontStyle,
  setMenuBarAutoHide,
  setPauseAnimationsWhenUnfocused,
  setReduceMotionOnBattery,
  setShowArchived,
  setShowReasoningBlocks,
  setShellTransparencyEnabled,
  setShortcutOverride,
  setSpellcheckEnabled,
  setSystemFonts,
  toggleGroupByRepo,
  toggleHasCompletedProviderSetup,
  toggleChatAurora,
  toggleCollapseToolRuns,
  toggleLabsSettingsVisibility,
  toggleLabsRemoteAgents,
  toggleLabsPlainFolderWorkspaces,
  toggleLabsTabGroups,
  toggleLabsSshMachineSetup,
  togglePauseAnimationsWhenUnfocused,
  toggleReduceMotionOnBattery,
  toggleShowArchived,
  toggleShowReasoningBlocks,
  toggleShellTransparency,
  toggleMenuBarAutoHide,
  toggleSpellcheck,
  type ActivityLogPresetPreference,
  type FontStyle,
  type NoteFontStyle,
} from '../user-preferences-slice';

const SPELLCHECK_STORAGE_KEY = 'note-spellcheck-settings';
const SHOW_ARCHIVED_STORAGE_KEY = 'workspace-list:showArchived';
const GROUP_BY_REPO_STORAGE_KEY = 'workspace-list:groupByRepo';
const COMPLETED_PROVIDER_SETUP_STORAGE_KEY = 'workspace-list:completedProviderSetup';
const SHOW_REASONING_BLOCKS_STORAGE_KEY = 'chat:showReasoningBlocks';
const CHAT_AURORA_STORAGE_KEY = 'chat:auroraEnabled';
const CHAT_CONTENT_WIDTH_STORAGE_KEY = 'chat:contentWidth';
const COLLAPSE_TOOL_RUNS_STORAGE_KEY = 'chat:collapseToolRuns';
const SHELL_TRANSPARENCY_STORAGE_KEY = 'appearance:shellTransparencyEnabled';
const MENU_BAR_AUTO_HIDE_STORAGE_KEY = 'appearance:menuBarAutoHide';
const REDUCE_MOTION_ON_BATTERY_STORAGE_KEY = 'appearance:reduceMotionOnBattery';
const PAUSE_ANIMATIONS_WHEN_UNFOCUSED_STORAGE_KEY = 'appearance:pauseAnimationsWhenUnfocused';
const LABS_SETTINGS_VISIBLE_STORAGE_KEY = 'labs:settingsVisible';
const LABS_REMOTE_AGENTS_STORAGE_KEY = 'labs:remoteAgentsEnabled';
const LABS_PLAIN_FOLDER_WORKSPACES_STORAGE_KEY = 'labs:plainFolderWorkspacesEnabled';
const LABS_TAB_GROUPS_STORAGE_KEY = 'labs:tabGroupsEnabled';
const LABS_SSH_MACHINE_SETUP_STORAGE_KEY = 'labs:sshMachineSetupEnabled';
const AGENT_STORAGE_KEY = 'agent-font-settings';
const NOTE_STORAGE_KEY = 'note-font-settings';
const CODE_STORAGE_KEY = 'code-font-settings';
const ACTIVITY_LOG_PRESETS_STORAGE_KEY = 'activityLogPresets';
const LANGUAGE_PREFERENCE_STORAGE_KEY = 'language-preference';
const GITHUB_LINK_DEFAULT_ACTION_STORAGE_KEY = 'github-links:defaultAction';
const SHORTCUT_OVERRIDES_STORAGE_KEY = 'keyboard-shortcut-overrides';

type ListSystemFontsResponse = {
  success?: boolean;
  data?: unknown;
};

function hasFontStyle(value: unknown): value is { fontStyle: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fontStyle' in value &&
    typeof value.fontStyle === 'string'
  );
}

function validAgentFont(value: unknown): value is { fontStyle: FontStyle } {
  return hasFontStyle(value) && FONT_STYLES.includes(value.fontStyle as FontStyle);
}

function validNoteFont(value: unknown): value is { fontStyle: NoteFontStyle } {
  return validAgentFont(value) || (hasFontStyle(value) && value.fontStyle === 'serif');
}

function parseSystemFontsResponse(response: unknown): string[] | null {
  if (typeof response !== 'object' || response === null) return null;
  const { success, data } = response as ListSystemFontsResponse;
  if (success !== true || !Array.isArray(data)) return null;
  if (!data.every((font): font is string => typeof font === 'string')) return null;
  return data;
}

async function requestSystemFonts(): Promise<string[] | null> {
  if (!isElectron() || typeof window === 'undefined' || !window.electronAPI?.invoke) return null;
  try {
    const response = await window.electronAPI.invoke(SYSTEM_CHANNELS.LIST_FONTS, undefined);
    return parseSystemFontsResponse(response);
  } catch {
    return null;
  }
}

export function* loadSystemFontsWorker() {
  const fonts = yield* call(requestSystemFonts);
  if (fonts !== null) yield* put(setSystemFonts(fonts));
}

/** One persisted preference: its boot load, and its save and cross-view watchers. */
interface PersistedPreference {
  hydrate: () => SagaGenerator<void>;
  watch: () => SagaGenerator<void>;
}

function persisted<T>(options: SharedPreferenceSagaOptions<T>): PersistedPreference {
  return {
    hydrate: () => hydrateSharedPreference(options),
    watch: () => watchSharedPreference(options),
  };
}

const parseBoolean = (stored: unknown): boolean | undefined =>
  typeof stored === 'boolean' ? stored : undefined;

/** A boolean saved as bare JSON under one key for every host view of this app. */
function booleanPreference(
  key: string,
  set: (value: boolean) => Action,
  persistOn: ActionPattern,
  select: () => SagaGenerator<boolean | undefined>,
): PersistedPreference {
  return persisted<boolean>({
    key,
    scope: 'app',
    parse: parseBoolean,
    hydrate: (value) => (value === undefined ? null : set(value)),
    persistOn,
    select,
  });
}

/**
 * `workspace-list:completedProviderSetup` is backend-scoped: the flag answers
 * "has provider setup been completed on THIS backend", so the local machine's
 * value must not leak into remote-backend sessions. The local sidecar keeps
 * the bare legacy key; remote backends get the `backend:<id>:` prefix.
 */
const providerSetupPreference: SharedPreferenceSagaOptions<boolean> = {
  *key() {
    return namespaceBackendKey(
      COMPLETED_PROVIDER_SETUP_STORAGE_KEY,
      yield* selectActiveBackendId(),
    );
  },
  scope: 'host',
  parse: parseBoolean,
  *hydrate(completed, source) {
    const backendId = yield* selectActiveBackendId();
    const hydrated = providerSetupHydrated(backendId, completed === true);
    if (source === 'storage') return [setHasCompletedProviderSetup(completed === true), hydrated];
    return completed === undefined
      ? [hydrated]
      : [setHasCompletedProviderSetup(completed), hydrated];
  },
  persistOn: [setHasCompletedProviderSetup, toggleHasCompletedProviderSetup],
  *select() {
    return yield* selectHasCompletedProviderSetup.effect();
  },
};

/** Saved by `watchLanguagePreferenceWrites`, which also applies the locale. */
const languagePreference: SharedPreferenceSagaOptions<string> = {
  key: LANGUAGE_PREFERENCE_STORAGE_KEY,
  scope: 'app',
  parse: (stored) => (typeof stored === 'string' && stored.trim() ? stored : undefined),
  hydrate: (language) => (language === undefined ? null : setLanguagePreference(language)),
  *select() {
    return yield* selectLanguagePreference.effect();
  },
};

// Multiplayer is always on: a saved `labs:multiplayerEnabled` is neither read nor written.
// It is left in place so an older build sharing this storage keeps its own choice.
// GitLab is always on too: a saved `labs:gitlabEnabled` is likewise ignored and left in place.

/** In boot-load order. */
const PREFERENCES: readonly PersistedPreference[] = [
  persisted<{ enabled: boolean }>({
    key: SPELLCHECK_STORAGE_KEY,
    scope: 'app',
    parse: (stored) => {
      const enabled = (stored as { enabled?: unknown } | null)?.enabled;
      return typeof enabled === 'boolean' ? { enabled } : undefined;
    },
    hydrate: (value) => (value === undefined ? null : setSpellcheckEnabled(value.enabled)),
    persistOn: [setSpellcheckEnabled, toggleSpellcheck],
    *select() {
      return { enabled: yield* selectSpellcheckEnabled.effect() };
    },
  }),
  booleanPreference(
    SHOW_ARCHIVED_STORAGE_KEY,
    setShowArchived,
    [setShowArchived, toggleShowArchived],
    function* () {
      return yield* selectShowArchived.effect();
    },
  ),
  booleanPreference(
    GROUP_BY_REPO_STORAGE_KEY,
    setGroupByRepo,
    [setGroupByRepo, toggleGroupByRepo],
    function* () {
      return yield* selectGroupByRepo.effect();
    },
  ),
  persisted(providerSetupPreference),
  booleanPreference(
    SHOW_REASONING_BLOCKS_STORAGE_KEY,
    setShowReasoningBlocks,
    [setShowReasoningBlocks, toggleShowReasoningBlocks],
    function* () {
      return yield* selectShowReasoningBlocks.effect();
    },
  ),
  booleanPreference(
    CHAT_AURORA_STORAGE_KEY,
    setChatAuroraEnabled,
    [setChatAuroraEnabled, toggleChatAurora],
    function* () {
      return yield* selectChatAuroraEnabled.effect();
    },
  ),
  persisted<ChatContentWidth>({
    key: CHAT_CONTENT_WIDTH_STORAGE_KEY,
    scope: 'app',
    parse: (stored) => (isChatContentWidth(stored) ? stored : undefined),
    hydrate: (width) => (width === undefined ? null : setChatContentWidth(width)),
    persistOn: setChatContentWidth,
    *select() {
      return yield* selectChatContentWidth.effect();
    },
  }),
  booleanPreference(
    COLLAPSE_TOOL_RUNS_STORAGE_KEY,
    setCollapseToolRuns,
    [setCollapseToolRuns, toggleCollapseToolRuns],
    function* () {
      return yield* selectCollapseToolRuns.effect();
    },
  ),
  booleanPreference(
    SHELL_TRANSPARENCY_STORAGE_KEY,
    setShellTransparencyEnabled,
    [setShellTransparencyEnabled, toggleShellTransparency],
    function* () {
      return yield* selectShellTransparencyEnabled.effect();
    },
  ),
  booleanPreference(
    MENU_BAR_AUTO_HIDE_STORAGE_KEY,
    setMenuBarAutoHide,
    [setMenuBarAutoHide, toggleMenuBarAutoHide],
    function* () {
      return yield* selectMenuBarAutoHide.effect();
    },
  ),
  booleanPreference(
    REDUCE_MOTION_ON_BATTERY_STORAGE_KEY,
    setReduceMotionOnBattery,
    [setReduceMotionOnBattery, toggleReduceMotionOnBattery],
    function* () {
      return yield* selectReduceMotionOnBattery.effect();
    },
  ),
  booleanPreference(
    PAUSE_ANIMATIONS_WHEN_UNFOCUSED_STORAGE_KEY,
    setPauseAnimationsWhenUnfocused,
    [setPauseAnimationsWhenUnfocused, togglePauseAnimationsWhenUnfocused],
    function* () {
      return yield* selectPauseAnimationsWhenUnfocused.effect();
    },
  ),
  booleanPreference(
    LABS_SETTINGS_VISIBLE_STORAGE_KEY,
    setLabsSettingsVisible,
    [setLabsSettingsVisible, toggleLabsSettingsVisibility],
    function* () {
      return yield* selectLabsSettingsVisible.effect();
    },
  ),
  booleanPreference(
    LABS_REMOTE_AGENTS_STORAGE_KEY,
    setLabsRemoteAgentsEnabled,
    [setLabsRemoteAgentsEnabled, toggleLabsRemoteAgents],
    function* () {
      return yield* selectLabsRemoteAgentsEnabled.effect();
    },
  ),
  booleanPreference(
    LABS_PLAIN_FOLDER_WORKSPACES_STORAGE_KEY,
    setLabsPlainFolderWorkspacesEnabled,
    [setLabsPlainFolderWorkspacesEnabled, toggleLabsPlainFolderWorkspaces],
    function* () {
      return yield* selectLabsPlainFolderWorkspacesEnabled.effect();
    },
  ),
  booleanPreference(
    LABS_TAB_GROUPS_STORAGE_KEY,
    setLabsTabGroupsEnabled,
    [setLabsTabGroupsEnabled, toggleLabsTabGroups],
    function* () {
      return yield* selectLabsTabGroupsEnabled.effect();
    },
  ),
  booleanPreference(
    LABS_SSH_MACHINE_SETUP_STORAGE_KEY,
    setLabsSshMachineSetupEnabled,
    [setLabsSshMachineSetupEnabled, toggleLabsSshMachineSetup],
    function* () {
      return yield* selectLabsSshMachineSetupEnabled.effect();
    },
  ),
  persisted<{ fontStyle: FontStyle }>({
    key: AGENT_STORAGE_KEY,
    scope: 'app',
    parse: (stored) => (validAgentFont(stored) ? { fontStyle: stored.fontStyle } : undefined),
    hydrate: (font) => (font === undefined ? null : setAgentFontStyle(font.fontStyle)),
    persistOn: [setAgentFontStyle],
    *select() {
      return { fontStyle: yield* selectAgentFontStyle.effect() };
    },
  }),
  persisted<{ fontStyle: NoteFontStyle }>({
    key: NOTE_STORAGE_KEY,
    scope: 'app',
    parse: (stored) => (validNoteFont(stored) ? { fontStyle: stored.fontStyle } : undefined),
    hydrate: (font) => (font === undefined ? null : setNoteFontStyle(font.fontStyle)),
    persistOn: [setNoteFontStyle, cycleNoteFontStyle],
    *select() {
      return { fontStyle: yield* selectNoteFontStyle.effect() };
    },
  }),
  persisted<{ fontFamily: string }>({
    key: CODE_STORAGE_KEY,
    scope: 'app',
    parse: (stored) => {
      const fontFamily = (stored as { fontFamily?: unknown } | null)?.fontFamily;
      return typeof fontFamily === 'string' && fontFamily.trim() ? { fontFamily } : undefined;
    },
    hydrate: (font) => (font === undefined ? null : setCodeFontFamily(font.fontFamily)),
    persistOn: setCodeFontFamily,
    *select() {
      return { fontFamily: yield* selectCodeFontFamily.effect() };
    },
  }),
  persisted<ActivityLogPresetPreference[]>({
    key: ACTIVITY_LOG_PRESETS_STORAGE_KEY,
    scope: 'app',
    parse: (stored) =>
      Array.isArray(stored) &&
      stored.every(
        (preset) =>
          preset &&
          typeof preset === 'object' &&
          typeof preset.name === 'string' &&
          typeof preset.filters === 'object',
      )
        ? (stored as ActivityLogPresetPreference[])
        : undefined,
    hydrate: (presets) => (presets === undefined ? null : hydrateActivityLogPresets(presets)),
    persistOn: [saveActivityLogPreset, deleteActivityLogPreset],
    *select() {
      return yield* selectActivityLogPresets.effect();
    },
  }),
  persisted(languagePreference),
  persisted<GithubLinkDefaultAction>({
    key: GITHUB_LINK_DEFAULT_ACTION_STORAGE_KEY,
    scope: 'app',
    parse: (stored) => (isGithubLinkDefaultAction(stored) ? stored : undefined),
    hydrate: (action) => (action === undefined ? null : setGithubLinkDefaultAction(action)),
    persistOn: setGithubLinkDefaultAction,
    *select() {
      return yield* selectGithubLinkDefaultAction.effect();
    },
  }),
  persisted<unknown>({
    key: SHORTCUT_OVERRIDES_STORAGE_KEY,
    scope: 'app',
    parse: (stored) => stored,
    hydrate: (overrides) => (overrides === undefined ? null : hydrateShortcutOverrides(overrides)),
    persistOn: [setShortcutOverride, resetShortcutOverride, resetAllShortcutOverrides],
    *select() {
      return Object.fromEntries(
        Object.entries(yield* selectShortcutOverrides.effect()).filter(
          ([id]) => !isDockShortcutId(id),
        ),
      );
    },
  }),
];

export function* hydrateUserPreferencesWorker() {
  for (const preference of PREFERENCES) yield* preference.hydrate();
  yield* put(userPreferencesHydrated());
}

/**
 * Boot hydration can run before the first `connections:list` result lands, so
 * on a remote backend the flag may have hydrated from the local (bare) key.
 * Re-hydrate from the backend-scoped key whenever the active backend id
 * settles on a different value; an absent stored value resets to the slice
 * default (false) so a fresh remote backend never inherits the local
 * machine's completion state.
 */
function* watchBackendForProviderSetup() {
  let hydratedBackendId = yield* selectActiveBackendId();
  yield* takeEvery(connectionsListReceived, function* () {
    const backendId = yield* selectActiveBackendId();
    if (backendId === hydratedBackendId) return;
    hydratedBackendId = backendId;
    const stored = yield* getLocalStorageJSON<boolean>(
      namespaceBackendKey(COMPLETED_PROVIDER_SETUP_STORAGE_KEY, backendId),
    );
    if (backendId !== (yield* selectActiveBackendId())) return;
    yield* put(setHasCompletedProviderSetup(stored === true));
    yield* put(providerSetupHydrated(backendId, stored === true));
  });
}

async function syncLanguagePreference(preference: string): Promise<void> {
  if (!isElectron() || typeof window === 'undefined' || !window.electronAPI?.invoke) return;
  try {
    await window.electronAPI.invoke('app:set-language-preference', { preference });
  } catch {
    // Non-fatal: main keeps its current locale until the next sync.
  }
}

function* persistLocalLanguagePreference(action: ReturnType<typeof setLanguagePreference>) {
  const [preference] = action.payload;
  yield* call(applyLanguagePreference, preference);
  // A loaded value is already in storage; saving it again can overwrite a newer one.
  if (!isSharedPreferenceHydration(action)) yield* persistSharedPreference(languagePreference);
  return yield* selectLanguagePreference.effect();
}

export function* persistLanguagePreferenceWorker(action: ReturnType<typeof setLanguagePreference>) {
  const storedPreference = yield* call(persistLocalLanguagePreference, action);
  yield* call(syncLanguagePreference, storedPreference);
}

function* watchLanguagePreferenceWrites() {
  const queue = channel<string>(buffers.sliding(1));
  try {
    yield* takeEvery(setLanguagePreference, function* (action) {
      // Apply the renderer locale immediately, even while main's previous IPC is pending.
      const preference = yield* call(persistLocalLanguagePreference, action);
      yield* put(queue, preference);
    });
    while (true) yield* call(syncLanguagePreference, yield* take(queue));
  } finally {
    queue.close();
  }
}

function* watchUserPreferenceWrites() {
  for (const preference of PREFERENCES) yield* preference.watch();
  yield* fork(watchLanguagePreferenceWrites);
}

/** Canonical root-owned preference persistence and rules-editor orchestration. */
export function* userPreferencesPersistenceSaga() {
  yield* fork(dockShortcutSettingsSaga);
  yield* fork(agentRulesSaga);
  yield* fork(watchUserPreferenceWrites);
  yield* fork(hydrateUserPreferencesWorker);
  yield* fork(watchBackendForProviderSetup);
  yield* fork(loadSystemFontsWorker);
}
