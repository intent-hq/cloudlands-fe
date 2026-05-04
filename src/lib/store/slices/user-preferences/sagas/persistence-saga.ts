import { setLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import { call, delay, fork, takeEvery, takeLatest, type SagaGenerator } from "typed-redux-saga";
import {
  cycleFontStyle,
  cycleNoteFontStyle,
  deleteActivityLogPreset,
  dismissPromoBanner,
  recordPromoBannerInteraction,
  resetNotificationSettings,
  saveActivityLogPreset,
  setAgentFontStyle,
  setGroupByRepo,
  setHasCompletedProviderSetup,
  setCodeFontFamily,
  setNotificationEnabled,
  setNoteFontStyle,
  setShowArchived,
  setBetaUpdatesEnabled,
  setSpellcheckEnabled,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setVolume,
  toggleGroupByRepo,
  toggleHasCompletedProviderSetup,
  toggleShowArchived,
  toggleBetaUpdates,
  toggleSpellcheck,
  type FontStyle,
  type NotificationSettingsState,
} from "../user-preferences-slice";
import {
  selectAgentFontStyle,
  selectActivityLogPresets,
  selectCodeFontFamily,
  selectGroupByRepo,
  selectHasCompletedProviderSetup,
  selectNotificationEnabled,
  selectNotificationVolume,
  selectNoteFontStyle,
  selectShowArchived,
  selectBetaUpdatesEnabled,
  selectSpellcheckEnabled,
  selectSoundEnabled,
  selectSoundOnlyWhenUnfocused,
  selectPromoBannerInteractions,
} from "../user-preferences-selectors";
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
export const ACTIVITY_LOG_PRESETS_STORAGE_KEY = "activityLogPresets";
export const PROMO_BANNER_STORAGE_KEY = "promoBannerInteractions";

async function persistBetaUpdatesToIPC(enabled: boolean): Promise<void> {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      await window.electronAPI.invoke("settings:set", {
        key: BETA_UPDATES_STORAGE_KEY,
        value: enabled,
      });
    }
  } catch {
    // Ignore save errors
  }
}

function* persistSpellcheckSettings(enabled: boolean): SagaGenerator<void> {
  yield* call(setLocalStorageJSON, SPELLCHECK_STORAGE_KEY, { enabled });
}

function* persistBooleanPreference(key: string, value: boolean): SagaGenerator<void> {
  yield* call(setLocalStorageJSON, key, value);
}

function* persistFontStyle(storageKey: string, fontStyle: FontStyle): SagaGenerator<void> {
  yield* call(setLocalStorageJSON, storageKey, { fontStyle });
}

function* persistCodeFontFamily(fontFamily: string): SagaGenerator<void> {
  yield* call(setLocalStorageJSON, CODE_STORAGE_KEY, { fontFamily });
}

export function* persistActivityLogPresets(): SagaGenerator<void> {
  const presets = yield* selectActivityLogPresets.effect();
  yield* call(setLocalStorageJSON, ACTIVITY_LOG_PRESETS_STORAGE_KEY, presets);
}

export function* persistPromoBannerInteractions(): SagaGenerator<void> {
  const interactions = yield* selectPromoBannerInteractions.effect();
  yield* call(setLocalStorageJSON, PROMO_BANNER_STORAGE_KEY, interactions);
}

async function persistNotificationSettingsToIPC(
  settings: NotificationSettingsState
): Promise<void> {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      await window.electronAPI.invoke("settings:set", {
        key: NOTIFICATION_STORAGE_KEY,
        value: settings,
      });
    }
  } catch {
    // Ignore save errors
  }
}

function* watchBetaUpdatesPersistence() {
  yield* takeLatest(
    [setBetaUpdatesEnabled, toggleBetaUpdates],
    function* () {
      const enabled = yield* selectBetaUpdatesEnabled.effect();
      yield* call(persistBetaUpdatesToIPC, enabled);
      yield* call(applyChannel, enabled);
    }
  );
}

function* watchSpellcheckPersistence() {
  yield* takeEvery(
    [setSpellcheckEnabled, toggleSpellcheck],
    function* () {
      const enabled = yield* selectSpellcheckEnabled.effect();
      yield* call(persistSpellcheckSettings, enabled);
    }
  );
}

function* watchShowArchivedPersistence() {
  yield* takeEvery([setShowArchived, toggleShowArchived], function* () {
    const showArchived = yield* selectShowArchived.effect();
    yield* call(persistBooleanPreference, SHOW_ARCHIVED_STORAGE_KEY, showArchived);
  });
}

function* watchGroupByRepoPersistence() {
  yield* takeEvery([setGroupByRepo, toggleGroupByRepo], function* () {
    const groupByRepo = yield* selectGroupByRepo.effect();
    yield* call(persistBooleanPreference, GROUP_BY_REPO_STORAGE_KEY, groupByRepo);
  });
}

function* watchHasCompletedProviderSetupPersistence() {
  yield* takeEvery(
    [setHasCompletedProviderSetup, toggleHasCompletedProviderSetup],
    function* () {
      const hasCompletedProviderSetup = yield* selectHasCompletedProviderSetup.effect();
      yield* call(
        persistBooleanPreference,
        COMPLETED_PROVIDER_SETUP_STORAGE_KEY,
        hasCompletedProviderSetup
      );
    }
  );
}

function* watchAgentFontStylePersistence() {
  yield* takeEvery([setAgentFontStyle, cycleFontStyle], function* () {
    const fontStyle = yield* selectAgentFontStyle.effect();
    yield* call(persistFontStyle, AGENT_STORAGE_KEY, fontStyle);
  });
}

function* watchNoteFontStylePersistence() {
  yield* takeEvery([setNoteFontStyle, cycleNoteFontStyle], function* () {
    const fontStyle = yield* selectNoteFontStyle.effect();
    yield* call(persistFontStyle, NOTE_STORAGE_KEY, fontStyle);
  });
}

function* watchCodeFontFamilyPersistence() {
  yield* takeEvery(setCodeFontFamily, function* () {
    const fontFamily = yield* selectCodeFontFamily.effect();
    yield* call(persistCodeFontFamily, fontFamily);
  });
}

function* watchNotificationSettingsPersistence() {
  yield* takeLatest(
    [
      setNotificationEnabled,
      setSoundEnabled,
      setSoundOnlyWhenUnfocused,
      setVolume,
      resetNotificationSettings,
    ],
    function* () {
      yield* delay(100);
      const enabled = yield* selectNotificationEnabled.effect();
      const soundEnabled = yield* selectSoundEnabled.effect();
      const soundOnlyWhenUnfocused = yield* selectSoundOnlyWhenUnfocused.effect();
      const volume = yield* selectNotificationVolume.effect();
      yield* call(persistNotificationSettingsToIPC, {
        enabled,
        soundEnabled,
        soundOnlyWhenUnfocused,
        volume,
      });
    }
  );
}

function* watchActivityLogPresetPersistence() {
  yield* takeEvery([saveActivityLogPreset, deleteActivityLogPreset], persistActivityLogPresets);
}

function* watchPromoBannerPersistence() {
  yield* takeEvery(
    [recordPromoBannerInteraction, dismissPromoBanner],
    persistPromoBannerInteractions
  );
}

export function* persistenceUserPreferencesSaga() {
  yield* fork(watchBetaUpdatesPersistence);
  yield* fork(watchSpellcheckPersistence);
  yield* fork(watchShowArchivedPersistence);
  yield* fork(watchGroupByRepoPersistence);
  yield* fork(watchHasCompletedProviderSetupPersistence);
  yield* fork(watchAgentFontStylePersistence);
  yield* fork(watchNoteFontStylePersistence);
  yield* fork(watchCodeFontFamilyPersistence);
  yield* fork(watchNotificationSettingsPersistence);
  yield* fork(watchActivityLogPresetPersistence);
  yield* fork(watchPromoBannerPersistence);
}
