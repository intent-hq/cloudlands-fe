import {
  call,
  put,
  fork,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageItem,
  setLocalStorageJSON,
} from "$store/renderer/utils/safe-local-storage-saga";
import {
  hydrateScripts,
  hydrateSetupScriptBannerDismissals,
  saveScript,
  recordScriptUsage,
  renameScript,
  updateScriptContent,
  deleteScript,
  dismissSetupScriptBannerForWorkspace,
  dismissSetupScriptBannerGlobally,
  SETUP_SCRIPT_BANNER_DISMISSED_KEY,
} from "../setup-scripts-slice";
import {
  selectScripts,
  selectSetupScriptBannerDismissalRecord,
} from "../setup-scripts-selectors";
import type { SetupScript } from "../setup-scripts-types";

const STORAGE_KEY = "setup-scripts";

function normalizeDismissalRecord(value: unknown): { global: boolean; workspaceIds: string[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    global: record._global === true,
    workspaceIds: Object.keys(record).filter((key) => key !== "_global" && record[key] === true),
  };
}

// ============================================================================
// Init saga — load from localStorage
// ============================================================================

export function* initSetupScripts(): SagaGenerator<void> {
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

  let dismissed: { global: boolean; workspaceIds: string[] } | null = null;
  try {
    dismissed = normalizeDismissalRecord(
      yield* call(getLocalStorageJSON<unknown>, SETUP_SCRIPT_BANNER_DISMISSED_KEY)
    );
  } catch {
    // Safe storage helpers catch internally; keep init resilient if one throws unexpectedly.
  }
  if (dismissed) {
    yield* put(hydrateSetupScriptBannerDismissals(dismissed.global, dismissed.workspaceIds));
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

export function* persistSetupScriptBannerDismissals(): SagaGenerator<void> {
  const dismissed = yield* selectSetupScriptBannerDismissalRecord.effect();
  try {
    yield* call(setLocalStorageJSON, SETUP_SCRIPT_BANNER_DISMISSED_KEY, dismissed);
  } catch {
    // Ignore storage errors; the dismissal still applies in Redux for the current session.
  }
}

function* watchSetupScriptBannerDismissals(): SagaGenerator<void> {
  yield* takeEvery(
    [dismissSetupScriptBannerForWorkspace, dismissSetupScriptBannerGlobally],
    persistSetupScriptBannerDismissals
  );
}

// ============================================================================
// Root saga
// ============================================================================

export function* setupScriptsSaga(): SagaGenerator<void> {
  yield* fork(initSetupScripts);
  yield* fork(watchPersistence);
  yield* fork(watchSetupScriptBannerDismissals);
}

