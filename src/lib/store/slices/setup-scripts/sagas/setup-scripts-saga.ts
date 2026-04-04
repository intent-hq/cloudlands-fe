import { call, put, fork, takeEvery, type SagaGenerator } from "typed-redux-saga";
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
import {
  hydrateScripts,
  saveScript,
  recordScriptUsage,
  renameScript,
  updateScriptContent,
  deleteScript,
} from "../setup-scripts-slice";
import { selectScripts } from "../setup-scripts-selectors";
import type { SetupScript } from "../setup-scripts-types";

const STORAGE_KEY = "setup-scripts";

// ============================================================================
// Init saga — load from localStorage
// ============================================================================

function* initSetupScripts(): SagaGenerator<void> {
  try {
    const stored = yield* call(getLocalStorageItem, STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const scripts: SetupScript[] = Array.isArray(parsed) ? parsed : [];
      yield* put(hydrateScripts(scripts));
    }
  } catch {
    // Ignore parse errors — start with empty state
  }
}

// ============================================================================
// Persistence saga — save to localStorage on mutations
// ============================================================================

function* persistScripts(): SagaGenerator<void> {
  try {
    const scripts: SetupScript[] = yield* selectScripts.effect();
    yield* call(
      setLocalStorageItem,
      STORAGE_KEY,
      JSON.stringify(scripts)
    );
  } catch {
    // Ignore storage errors (quota, private browsing)
  }
}

function* watchPersistence(): SagaGenerator<void> {
  yield* takeEvery(
    [
      saveScript,
      recordScriptUsage,
      renameScript,
      updateScriptContent,
      deleteScript,
    ],
    persistScripts
  );
}

// ============================================================================
// Root saga
// ============================================================================

export function* setupScriptsSaga(): SagaGenerator<void> {
  yield* fork(initSetupScripts);
  yield* fork(watchPersistence);
}

