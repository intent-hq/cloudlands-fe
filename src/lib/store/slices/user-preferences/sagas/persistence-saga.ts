import { setLocalStorageItem } from "$lib/store/utils/safe-local-storage-saga";
import { call, fork, takeEvery, takeLatest, type SagaGenerator } from "typed-redux-saga";
import {
  setBetaUpdatesEnabled,
  setSpellcheckEnabled,
  toggleBetaUpdates,
  toggleSpellcheck,
} from "../user-preferences-slice";
import {
  selectBetaUpdatesEnabled,
  selectSpellcheckEnabled,
} from "../user-preferences-selectors";
import { applyChannel } from "./apply-channel";

const BETA_UPDATES_STORAGE_KEY = "betaUpdatesEnabled";
const SPELLCHECK_STORAGE_KEY = "note-spellcheck-settings";

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
  try {
    yield* call(setLocalStorageItem, SPELLCHECK_STORAGE_KEY, JSON.stringify({ enabled }));
  } catch {
    // Ignore storage errors
  }
}

function* watchBetaUpdatesPersistence() {
  yield* takeLatest(
    [setBetaUpdatesEnabled.type, toggleBetaUpdates.type],
    function* () {
      const enabled = yield* selectBetaUpdatesEnabled.effect();
      yield* call(persistBetaUpdatesToIPC, enabled);
      yield* call(applyChannel, enabled);
    }
  );
}

function* watchSpellcheckPersistence() {
  yield* takeEvery(
    [setSpellcheckEnabled.type, toggleSpellcheck.type],
    function* () {
      const enabled = yield* selectSpellcheckEnabled.effect();
      yield* call(persistSpellcheckSettings, enabled);
    }
  );
}

export function* persistenceUserPreferencesSaga() {
  yield* fork(watchBetaUpdatesPersistence);
  yield* fork(watchSpellcheckPersistence);
}