import { IPC_CHANNELS } from "$shared/ipc-registry";
import { invoke } from "$lib/electron-bridge";
import { getLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import { call, put, type SagaGenerator } from "typed-redux-saga";
import {
  loadBetaUpdatesSettings,
  initialState,
  setAgentFontStyle,
  setCodeFontFamily,
  setGroupByRepo,
  setHasCompletedProviderSetup,
  setNotificationEnabled,
  setNoteFontStyle,
  setShowArchived,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setSpellcheckEnabled,
  setSystemFonts,
  setVolume,
  setZoomFactor,
  type FontStyle,
  type NotificationSettingsState,
} from "../user-preferences-slice";
import { applyChannel } from "./apply-channel";

const BETA_UPDATES_STORAGE_KEY = "betaUpdatesEnabled";
const SPELLCHECK_STORAGE_KEY = "note-spellcheck-settings";
const SHOW_ARCHIVED_STORAGE_KEY = "workspace-list:showArchived";
const GROUP_BY_REPO_STORAGE_KEY = "workspace-list:groupByRepo";
const COMPLETED_PROVIDER_SETUP_STORAGE_KEY = "workspace-list:completedProviderSetup";
const AGENT_STORAGE_KEY = "agent-font-settings";
const NOTE_STORAGE_KEY = "note-font-settings";
const CODE_STORAGE_KEY = "code-font-settings";
const NOTIFICATION_STORAGE_KEY = "notificationSettings";
const DEFAULT_FONT_STYLE: FontStyle = "sans";
const DEFAULT_CODE_FONT_FAMILY = "system-default";

async function loadBetaUpdatesFromIPC(): Promise<boolean | null> {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result = await window.electronAPI.invoke("settings:get", {
        key: BETA_UPDATES_STORAGE_KEY,
      });
      if (result?.success && typeof result.data === "boolean") {
        return result.data;
      }
    }
  } catch {
    // Ignore load errors
  }
  return null;
}

function* loadSpellcheckFromLocalStorage(): SagaGenerator<boolean> {
  const stored = yield* call(getLocalStorageJSON<{ enabled?: unknown }>, SPELLCHECK_STORAGE_KEY);
  if (typeof stored?.enabled === "boolean") {
    return stored.enabled;
  }
  return false;
}

function* loadBooleanPreferenceFromLocalStorage(
  key: string,
  defaultValue: boolean
): SagaGenerator<boolean> {
  const stored = yield* call(getLocalStorageJSON<boolean>, key);
  if (typeof stored === "boolean") {
    return stored;
  }

  return defaultValue;
}

function* loadFontStyleFromLocalStorage(storageKey: string): SagaGenerator<FontStyle> {
  const stored = yield* call(getLocalStorageJSON<{ fontStyle?: unknown }>, storageKey);
  if (stored?.fontStyle === "sans" || stored?.fontStyle === "monospace") {
    return stored.fontStyle;
  }

  return DEFAULT_FONT_STYLE;
}

function* loadCodeFontFamilyFromLocalStorage(): SagaGenerator<string> {
  const stored = yield* call(getLocalStorageJSON<{ fontFamily?: unknown }>, CODE_STORAGE_KEY);
  if (typeof stored?.fontFamily === "string") {
    return stored.fontFamily;
  }

  return DEFAULT_CODE_FONT_FAMILY;
}

async function loadSystemFonts(): Promise<string[]> {
  try {
    const result = (await invoke("system:list-fonts", {})) as
      | { success: true; data: string[] }
      | { success: false; error: string };

    if (result.success) {
      return result.data;
    }
  } catch (error) {
    console.warn("Failed to load system fonts:", error);
  }

  return [];
}

async function loadNotificationSettingsFromIPC(): Promise<NotificationSettingsState | null> {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result = await window.electronAPI.invoke("settings:get", {
        key: NOTIFICATION_STORAGE_KEY,
      });
      if (result?.success && result.data) {
        return result.data as NotificationSettingsState;
      }
    }
  } catch {
    // Ignore load errors
  }
  return null;
}

function fetchZoomFactor(): Promise<number> {
  if (typeof window === "undefined" || !window.electronAPI) {
    return Promise.resolve(1.0);
  }

  return window.electronAPI
    .invoke(IPC_CHANNELS.WINDOW.GET_ZOOM_FACTOR, undefined)
    .then((result: any) => {
      if (result?.success && typeof result.data === "number" && result.data > 0) {
        return result.data;
      }
      return 1.0;
    })
    .catch(() => 1.0);
}

export function* initUserPreferencesSaga() {
  const betaUpdatesEnabled: boolean | null = yield* call(loadBetaUpdatesFromIPC);
  if (betaUpdatesEnabled !== null) {
    yield* put(loadBetaUpdatesSettings(betaUpdatesEnabled));
  }
  yield* call(applyChannel, betaUpdatesEnabled ?? false);

  const spellcheckEnabled = yield* call(loadSpellcheckFromLocalStorage);
  yield* put(setSpellcheckEnabled(spellcheckEnabled));

  const showArchived = yield* call(loadBooleanPreferenceFromLocalStorage, SHOW_ARCHIVED_STORAGE_KEY, false);
  yield* put(setShowArchived(showArchived));

  const groupByRepo = yield* call(loadBooleanPreferenceFromLocalStorage, GROUP_BY_REPO_STORAGE_KEY, true);
  yield* put(setGroupByRepo(groupByRepo));

  const hasCompletedProviderSetup = yield* call(
    loadBooleanPreferenceFromLocalStorage,
    COMPLETED_PROVIDER_SETUP_STORAGE_KEY,
    false
  );
  yield* put(setHasCompletedProviderSetup(hasCompletedProviderSetup));

  const agentFontStyle = yield* call(loadFontStyleFromLocalStorage, AGENT_STORAGE_KEY);
  yield* put(setAgentFontStyle(agentFontStyle));

  const noteFontStyle = yield* call(loadFontStyleFromLocalStorage, NOTE_STORAGE_KEY);
  yield* put(setNoteFontStyle(noteFontStyle));

  const codeFontFamily = yield* call(loadCodeFontFamilyFromLocalStorage);
  yield* put(setCodeFontFamily(codeFontFamily));

  const notificationSettings = yield* call(loadNotificationSettingsFromIPC);
  if (notificationSettings) {
    yield* put(setNotificationEnabled(notificationSettings.enabled ?? initialState.enabled));
    yield* put(setSoundEnabled(notificationSettings.soundEnabled ?? initialState.soundEnabled));
    yield* put(
      setSoundOnlyWhenUnfocused(
        notificationSettings.soundOnlyWhenUnfocused ?? initialState.soundOnlyWhenUnfocused
      )
    );
    yield* put(setVolume(notificationSettings.volume ?? initialState.volume));
  }

  const fonts = yield* call(loadSystemFonts);
  if (fonts.length > 0) {
    yield* put(setSystemFonts(fonts));
  }

  if (typeof window === "undefined") return;

  const zoomFactor: number = yield* call(fetchZoomFactor);
  if (zoomFactor !== 1.0) {
    yield* put(setZoomFactor(zoomFactor));
  }
}

export { fetchZoomFactor };