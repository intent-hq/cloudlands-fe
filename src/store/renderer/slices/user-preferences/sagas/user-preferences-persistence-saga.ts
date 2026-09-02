import { call, fork, put, takeEvery } from 'typed-redux-saga';

import { isElectron } from '$lib/electron-bridge';
import { applyLanguagePreference } from '$lib/i18n/locale';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';
import { isGithubLinkDefaultAction } from '$shared/utils/link-helpers';
import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '$store/renderer/utils/backend-storage-namespace';
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from '$store/renderer/utils/safe-local-storage-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import {
  selectActivityLogPresets,
  selectAgentFontStyle,
  selectCodeFontFamily,
  selectGroupByRepo,
  selectGithubLinkDefaultAction,
  selectHasCompletedProviderSetup,
  selectLanguagePreference,
  selectNoteFontStyle,
  selectShowArchived,
  selectShowReasoningBlocks,
  selectShortcutOverrides,
  selectSpellcheckEnabled,
} from '../user-preferences-selectors';
import {
  cycleNoteFontStyle,
  deleteActivityLogPreset,
  FONT_STYLES,
  hydrateActivityLogPresets,
  hydrateShortcutOverrides,
  resetAllShortcutOverrides,
  resetShortcutOverride,
  saveActivityLogPreset,
  setAgentFontStyle,
  setCodeFontFamily,
  setGroupByRepo,
  setGithubLinkDefaultAction,
  setHasCompletedProviderSetup,
  setLanguagePreference,
  setNoteFontStyle,
  setShowArchived,
  setShowReasoningBlocks,
  setShortcutOverride,
  setSpellcheckEnabled,
  setSystemFonts,
  toggleGroupByRepo,
  toggleHasCompletedProviderSetup,
  toggleShowArchived,
  toggleShowReasoningBlocks,
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

/**
 * `workspace-list:completedProviderSetup` is backend-scoped: the flag answers
 * "has provider setup been completed on THIS backend", so the local machine's
 * value must not leak into remote-backend sessions. The local sidecar keeps
 * the bare legacy key; remote backends get the `backend:<id>:` prefix.
 */
function* providerSetupStorageKey() {
  const backendId = yield* selectActiveBackendId();
  return namespaceBackendKey(COMPLETED_PROVIDER_SETUP_STORAGE_KEY, backendId);
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

export function* hydrateUserPreferencesWorker() {
  const spellcheck = yield* getLocalStorageJSON<{ enabled: boolean }>(SPELLCHECK_STORAGE_KEY);
  if (typeof spellcheck?.enabled === 'boolean')
    yield* put(setSpellcheckEnabled(spellcheck.enabled));

  const showArchived = yield* getLocalStorageJSON<boolean>(SHOW_ARCHIVED_STORAGE_KEY);
  if (typeof showArchived === 'boolean') yield* put(setShowArchived(showArchived));

  const groupByRepo = yield* getLocalStorageJSON<boolean>(GROUP_BY_REPO_STORAGE_KEY);
  if (typeof groupByRepo === 'boolean') yield* put(setGroupByRepo(groupByRepo));

  const providerSetup = yield* getLocalStorageJSON<boolean>(yield* providerSetupStorageKey());
  if (typeof providerSetup === 'boolean') {
    yield* put(setHasCompletedProviderSetup(providerSetup));
  }

  const showReasoningBlocks = yield* getLocalStorageJSON<boolean>(
    SHOW_REASONING_BLOCKS_STORAGE_KEY,
  );
  if (typeof showReasoningBlocks === 'boolean') {
    yield* put(setShowReasoningBlocks(showReasoningBlocks));
  }

  const agentFont = yield* getLocalStorageJSON<unknown>(AGENT_STORAGE_KEY);
  if (validAgentFont(agentFont)) yield* put(setAgentFontStyle(agentFont.fontStyle));

  const noteFont = yield* getLocalStorageJSON<unknown>(NOTE_STORAGE_KEY);
  if (validNoteFont(noteFont)) yield* put(setNoteFontStyle(noteFont.fontStyle));

  const codeFont = yield* getLocalStorageJSON<{ fontFamily?: unknown }>(CODE_STORAGE_KEY);
  if (typeof codeFont?.fontFamily === 'string' && codeFont.fontFamily.trim()) {
    yield* put(setCodeFontFamily(codeFont.fontFamily));
  }

  const presets = yield* getLocalStorageJSON<ActivityLogPresetPreference[]>(
    ACTIVITY_LOG_PRESETS_STORAGE_KEY,
  );
  if (
    Array.isArray(presets) &&
    presets.every(
      (preset) =>
        preset &&
        typeof preset === 'object' &&
        typeof preset.name === 'string' &&
        typeof preset.filters === 'object',
    )
  ) {
    yield* put(hydrateActivityLogPresets(presets));
  }

  const language = yield* getLocalStorageJSON<string>(LANGUAGE_PREFERENCE_STORAGE_KEY);
  if (typeof language === 'string' && language.trim()) yield* put(setLanguagePreference(language));

  const githubLinkDefaultAction = yield* getLocalStorageJSON<unknown>(
    GITHUB_LINK_DEFAULT_ACTION_STORAGE_KEY,
  );
  if (isGithubLinkDefaultAction(githubLinkDefaultAction)) {
    yield* put(setGithubLinkDefaultAction(githubLinkDefaultAction));
  }

  const shortcutOverrides = yield* getLocalStorageJSON<unknown>(SHORTCUT_OVERRIDES_STORAGE_KEY);
  if (shortcutOverrides !== undefined) yield* put(hydrateShortcutOverrides(shortcutOverrides));
}

function* persistSpellcheckWorker() {
  const enabled = yield* selectSpellcheckEnabled.effect();
  yield* setLocalStorageJSON(SPELLCHECK_STORAGE_KEY, { enabled });
}

function* persistShowArchivedWorker() {
  yield* setLocalStorageJSON(SHOW_ARCHIVED_STORAGE_KEY, yield* selectShowArchived.effect());
}

function* persistGroupByRepoWorker() {
  yield* setLocalStorageJSON(GROUP_BY_REPO_STORAGE_KEY, yield* selectGroupByRepo.effect());
}

function* persistProviderSetupWorker() {
  yield* setLocalStorageJSON(
    yield* providerSetupStorageKey(),
    yield* selectHasCompletedProviderSetup.effect(),
  );
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
    yield* put(setHasCompletedProviderSetup(stored === true));
  });
}

function* persistShowReasoningBlocksWorker() {
  yield* setLocalStorageJSON(
    SHOW_REASONING_BLOCKS_STORAGE_KEY,
    yield* selectShowReasoningBlocks.effect(),
  );
}

function* persistAgentFontWorker() {
  yield* setLocalStorageJSON(AGENT_STORAGE_KEY, {
    fontStyle: yield* selectAgentFontStyle.effect(),
  });
}

function* persistNoteFontWorker() {
  yield* setLocalStorageJSON(NOTE_STORAGE_KEY, {
    fontStyle: yield* selectNoteFontStyle.effect(),
  });
}

function* persistCodeFontWorker() {
  yield* setLocalStorageJSON(CODE_STORAGE_KEY, {
    fontFamily: yield* selectCodeFontFamily.effect(),
  });
}

function* persistActivityLogPresetsWorker() {
  yield* setLocalStorageJSON(
    ACTIVITY_LOG_PRESETS_STORAGE_KEY,
    yield* selectActivityLogPresets.effect(),
  );
}

async function syncLanguagePreference(preference: string): Promise<void> {
  if (!isElectron() || typeof window === 'undefined' || !window.electronAPI?.invoke) return;
  try {
    await window.electronAPI.invoke('app:set-language-preference', { preference });
  } catch {
    // Non-fatal: main keeps its current locale until the next sync.
  }
}

export function* persistLanguagePreferenceWorker(action: ReturnType<typeof setLanguagePreference>) {
  const [preference] = action.payload;
  yield* call(applyLanguagePreference, preference);
  const storedPreference = yield* selectLanguagePreference.effect();
  yield* setLocalStorageJSON(LANGUAGE_PREFERENCE_STORAGE_KEY, storedPreference);
  yield* call(syncLanguagePreference, storedPreference);
}

function* persistGithubLinkDefaultActionWorker() {
  yield* setLocalStorageJSON(
    GITHUB_LINK_DEFAULT_ACTION_STORAGE_KEY,
    yield* selectGithubLinkDefaultAction.effect(),
  );
}

function* persistShortcutOverridesWorker() {
  yield* setLocalStorageJSON(
    SHORTCUT_OVERRIDES_STORAGE_KEY,
    yield* selectShortcutOverrides.effect(),
  );
}

function* watchUserPreferenceWrites() {
  yield* takeEvery([setSpellcheckEnabled, toggleSpellcheck], persistSpellcheckWorker);
  yield* takeEvery([setShowArchived, toggleShowArchived], persistShowArchivedWorker);
  yield* takeEvery([setGroupByRepo, toggleGroupByRepo], persistGroupByRepoWorker);
  yield* takeEvery(
    [setHasCompletedProviderSetup, toggleHasCompletedProviderSetup],
    persistProviderSetupWorker,
  );
  yield* takeEvery(
    [setShowReasoningBlocks, toggleShowReasoningBlocks],
    persistShowReasoningBlocksWorker,
  );
  yield* takeEvery([setAgentFontStyle], persistAgentFontWorker);
  yield* takeEvery([setNoteFontStyle, cycleNoteFontStyle], persistNoteFontWorker);
  yield* takeEvery(setCodeFontFamily, persistCodeFontWorker);
  yield* takeEvery(
    [saveActivityLogPreset, deleteActivityLogPreset],
    persistActivityLogPresetsWorker,
  );
  yield* takeEvery(setLanguagePreference, persistLanguagePreferenceWorker);
  yield* takeEvery(setGithubLinkDefaultAction, persistGithubLinkDefaultActionWorker);
  yield* takeEvery(
    [setShortcutOverride, resetShortcutOverride, resetAllShortcutOverrides],
    persistShortcutOverridesWorker,
  );
}

/** Unregistered until the S20 middleware cutover. */
export function* userPreferencesPersistenceSaga() {
  yield* fork(watchUserPreferenceWrites);
  yield* fork(hydrateUserPreferencesWorker);
  yield* fork(watchBackendForProviderSetup);
  yield* fork(loadSystemFontsWorker);
}
