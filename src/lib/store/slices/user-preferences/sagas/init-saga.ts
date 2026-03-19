import { IPC_CHANNELS } from "$shared/ipc-registry";
import { getLocalStorageItem } from "$lib/store/utils/safe-local-storage-saga";
import { call, put, type SagaGenerator } from "typed-redux-saga";
import {
  loadBetaUpdatesSettings,
  setSpellcheckEnabled,
  setZoomFactor,
} from "../user-preferences-slice";
import { applyChannel } from "./apply-channel";

const BETA_UPDATES_STORAGE_KEY = "betaUpdatesEnabled";
const SPELLCHECK_STORAGE_KEY = "note-spellcheck-settings";

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
  try {
    const stored = yield* call(getLocalStorageItem, SPELLCHECK_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed?.enabled === "boolean") {
        return parsed.enabled;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return false;
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

  if (typeof window === "undefined") return;

  const zoomFactor: number = yield* call(fetchZoomFactor);
  if (zoomFactor !== 1.0) {
    yield* put(setZoomFactor(zoomFactor));
  }
}

export { fetchZoomFactor };