import { IPC_CHANNELS } from '$shared/ipc-registry';
import { invoke } from '$lib/electron-bridge';
import { getLocalStorageJSON } from '$lib/store/utils/safe-local-storage-saga';
import {
  call,
  put,
  type SagaGenerator,
} from 'typed-redux-saga';
import {
  loadBetaUpdatesSettings,
  hydrateActivityLogPresets,
  hydratePromoBannerInteractions,
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
  type ActivityLogFiltersPreference,
  type ActivityLogPresetPreference,
  type FontStyle,
  type NotificationSettingsState,
  type PromoBannerInteraction,
  type PromoBannerInteractionRecord,
} from '../user-preferences-slice';
import { applyChannel } from './apply-channel';

const BETA_UPDATES_STORAGE_KEY = 'betaUpdatesEnabled';
const SPELLCHECK_STORAGE_KEY = 'note-spellcheck-settings';
const SHOW_ARCHIVED_STORAGE_KEY = 'workspace-list:showArchived';
const GROUP_BY_REPO_STORAGE_KEY = 'workspace-list:groupByRepo';
const COMPLETED_PROVIDER_SETUP_STORAGE_KEY = 'workspace-list:completedProviderSetup';
const AGENT_STORAGE_KEY = 'agent-font-settings';
const NOTE_STORAGE_KEY = 'note-font-settings';
const CODE_STORAGE_KEY = 'code-font-settings';
const NOTIFICATION_STORAGE_KEY = 'notificationSettings';
const ACTIVITY_LOG_PRESETS_STORAGE_KEY = 'activityLogPresets';
const PROMO_BANNER_STORAGE_KEY = 'promoBannerInteractions';
const DEFAULT_FONT_STYLE: FontStyle = 'sans';
const DEFAULT_CODE_FONT_FAMILY = 'system-default';

function isActivityLogFilters(value: unknown): value is ActivityLogFiltersPreference {
  const filters = value as ActivityLogFiltersPreference;
  return (
    !!filters &&
    typeof filters === 'object' &&
    typeof filters.showFileChanges === 'boolean' &&
    typeof filters.showAgentActivity === 'boolean' &&
    typeof filters.showSystemEvents === 'boolean' &&
    typeof filters.showErrors === 'boolean' &&
    typeof filters.searchQuery === 'string' &&
    typeof filters.dateRange === 'string' &&
    typeof filters.actorFilter === 'string'
  );
}

function isActivityLogPreset(value: unknown): value is ActivityLogPresetPreference {
  const preset = value as ActivityLogPresetPreference;
  return (
    !!preset &&
    typeof preset === 'object' &&
    typeof preset.name === 'string' &&
    isActivityLogFilters(preset.filters)
  );
}

function isPromoBannerInteraction(value: unknown): value is PromoBannerInteraction {
  const interaction = value as PromoBannerInteraction;
  return (
    !!interaction &&
    typeof interaction === 'object' &&
    (interaction.type === 'button_click' || interaction.type === 'dismiss') &&
    (interaction.result === 'success' ||
      interaction.result === 'error' ||
      interaction.result === 'navigated_to_settings') &&
    typeof interaction.timestamp === 'string'
  );
}

function isPromoBannerRecord(value: unknown): value is PromoBannerInteractionRecord {
  const record = value as PromoBannerInteractionRecord;
  return (
    !!record &&
    typeof record === 'object' &&
    typeof record.dismissed === 'boolean' &&
    Array.isArray(record.interactions) &&
    record.interactions.every(isPromoBannerInteraction)
  );
}

function sanitizePromoBannerInteractions(
  value: unknown,
): Record<string, PromoBannerInteractionRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry) => isPromoBannerRecord(entry[1])));
}

async function loadBetaUpdatesFromIPC(): Promise<boolean | null> {
  try {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const result = await window.electronAPI.invoke('settings:get', {
        key: BETA_UPDATES_STORAGE_KEY,
      });
      if (result?.success && typeof result.data === 'boolean') {
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
  if (typeof stored?.enabled === 'boolean') {
    return stored.enabled;
  }
  return false;
}

function* loadBooleanPreferenceFromLocalStorage(
  key: string,
  defaultValue: boolean,
): SagaGenerator<boolean> {
  const stored = yield* call(getLocalStorageJSON<boolean>, key);
  if (typeof stored === 'boolean') {
    return stored;
  }

  return defaultValue;
}

function* loadFontStyleFromLocalStorage(storageKey: string): SagaGenerator<FontStyle> {
  const stored = yield* call(getLocalStorageJSON<{ fontStyle?: unknown }>, storageKey);
  if (stored?.fontStyle === 'sans' || stored?.fontStyle === 'monospace') {
    return stored.fontStyle;
  }

  return DEFAULT_FONT_STYLE;
}

function* loadCodeFontFamilyFromLocalStorage(): SagaGenerator<string> {
  const stored = yield* call(getLocalStorageJSON<{ fontFamily?: unknown }>, CODE_STORAGE_KEY);
  if (typeof stored?.fontFamily === 'string') {
    return stored.fontFamily;
  }

  return DEFAULT_CODE_FONT_FAMILY;
}

function* loadActivityLogPresetsFromLocalStorage(): SagaGenerator<ActivityLogPresetPreference[]> {
  const stored = yield* call(getLocalStorageJSON<unknown>, ACTIVITY_LOG_PRESETS_STORAGE_KEY);
  return Array.isArray(stored) ? stored.filter(isActivityLogPreset) : [];
}

function* loadPromoBannerInteractionsFromLocalStorage(): SagaGenerator<
  Record<string, PromoBannerInteractionRecord>
> {
  const stored = yield* call(getLocalStorageJSON<unknown>, PROMO_BANNER_STORAGE_KEY);
  return sanitizePromoBannerInteractions(stored);
}

async function loadSystemFonts(): Promise<string[]> {
  try {
    const result = (await invoke('system:list-fonts', {})) as
      | { success: true; data: string[] }
      | { success: false; error: string };

    if (result.success) {
      return result.data;
    }
  } catch (error) {
    console.warn('Failed to load system fonts:', error);
  }

  return [];
}

async function loadNotificationSettingsFromIPC(): Promise<NotificationSettingsState | null> {
  try {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const result = await window.electronAPI.invoke('settings:get', {
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
  if (typeof window === 'undefined' || !window.electronAPI) {
    return Promise.resolve(1.0);
  }

  return window.electronAPI
    .invoke(IPC_CHANNELS.WINDOW.GET_ZOOM_FACTOR, undefined)
    .then((result: any) => {
      if (result?.success && typeof result.data === 'number' && result.data > 0) {
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

  const showArchived = yield* call(
    loadBooleanPreferenceFromLocalStorage,
    SHOW_ARCHIVED_STORAGE_KEY,
    false,
  );
  yield* put(setShowArchived(showArchived));

  const groupByRepo = yield* call(
    loadBooleanPreferenceFromLocalStorage,
    GROUP_BY_REPO_STORAGE_KEY,
    true,
  );
  yield* put(setGroupByRepo(groupByRepo));

  const hasCompletedProviderSetup = yield* call(
    loadBooleanPreferenceFromLocalStorage,
    COMPLETED_PROVIDER_SETUP_STORAGE_KEY,
    false,
  );
  yield* put(setHasCompletedProviderSetup(hasCompletedProviderSetup));

  const agentFontStyle = yield* call(loadFontStyleFromLocalStorage, AGENT_STORAGE_KEY);
  yield* put(setAgentFontStyle(agentFontStyle));

  const noteFontStyle = yield* call(loadFontStyleFromLocalStorage, NOTE_STORAGE_KEY);
  yield* put(setNoteFontStyle(noteFontStyle));

  const codeFontFamily = yield* call(loadCodeFontFamilyFromLocalStorage);
  yield* put(setCodeFontFamily(codeFontFamily));

  const activityLogPresets = yield* call(loadActivityLogPresetsFromLocalStorage);
  yield* put(hydrateActivityLogPresets(activityLogPresets));

  const promoBannerInteractions = yield* call(loadPromoBannerInteractionsFromLocalStorage);
  yield* put(hydratePromoBannerInteractions(promoBannerInteractions));

  const notificationSettings = yield* call(loadNotificationSettingsFromIPC);
  if (notificationSettings) {
    yield* put(setNotificationEnabled(notificationSettings.enabled ?? initialState.enabled));
    yield* put(setSoundEnabled(notificationSettings.soundEnabled ?? initialState.soundEnabled));
    yield* put(
      setSoundOnlyWhenUnfocused(
        notificationSettings.soundOnlyWhenUnfocused ?? initialState.soundOnlyWhenUnfocused,
      ),
    );
    yield* put(setVolume(notificationSettings.volume ?? initialState.volume));
  }

  const fonts = yield* call(loadSystemFonts);
  if (fonts.length > 0) {
    yield* put(setSystemFonts(fonts));
  }

  if (typeof window === 'undefined') return;

  const zoomFactor: number = yield* call(fetchZoomFactor);
  if (zoomFactor !== 1.0) {
    yield* put(setZoomFactor(zoomFactor));
  }
}

export { fetchZoomFactor };
