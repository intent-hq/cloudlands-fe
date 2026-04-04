import { call, fork, put, takeEvery, type SagaGenerator } from "typed-redux-saga";
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from "../../../utils/safe-local-storage-saga";
import { selectBrowserRecentUrls } from "../browser-selectors";
import {
  addRecentUrl,
  clearRecentUrls,
  hydrateBrowserState,
  initBrowserWorkspace,
  removeRecentUrl,
  updateUrlMetadata,
} from "../browser-slice";
import type { RecentUrl } from "../browser-types";
import { BROWSER_STORAGE_KEY_PREFIX } from "../browser-types";

function getStorageKey(wsId: string): string {
  return `${BROWSER_STORAGE_KEY_PREFIX}${wsId}`;
}

// ── Init saga: load from localStorage ────────────────────────────────────

function* loadBrowserStateFromStorage(wsId: string): SagaGenerator<RecentUrl[]> {
  try {
    const stored = yield* call(getLocalStorageItem, getStorageKey(wsId));
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed as RecentUrl[];
      }
    }
  } catch {
    // Ignore parse errors — fall through to empty
  }
  return [];
}

function* handleInitBrowserWorkspace(
  action: ReturnType<typeof initBrowserWorkspace>
): SagaGenerator<void> {
  const [wsId] = action.payload;
  const recentUrls = yield* call(loadBrowserStateFromStorage, wsId);
  yield* put(hydrateBrowserState(wsId, recentUrls));
}

function* watchInitBrowserWorkspace(): SagaGenerator<void> {
  yield* takeEvery(initBrowserWorkspace, handleInitBrowserWorkspace);
}

// ── Persistence saga: watch mutations and save ───────────────────────────

function* persistRecentUrls(
  action:
    | ReturnType<typeof addRecentUrl>
    | ReturnType<typeof removeRecentUrl>
    | ReturnType<typeof clearRecentUrls>
    | ReturnType<typeof updateUrlMetadata>
): SagaGenerator<void> {
  const wsId = action.payload[0];
  try {
    const recentUrls = yield* selectBrowserRecentUrls.effect(wsId);
    yield* call(setLocalStorageItem, getStorageKey(wsId), JSON.stringify(recentUrls));
  } catch {
    // Ignore storage errors
  }
}

function* watchBrowserPersistence(): SagaGenerator<void> {
  yield* takeEvery(
    [addRecentUrl, removeRecentUrl, clearRecentUrls, updateUrlMetadata],
    persistRecentUrls
  );
}

// ── Root saga ────────────────────────────────────────────────────────────

export function* browserSaga(): SagaGenerator<void> {
  yield* fork(watchInitBrowserWorkspace);
  yield* fork(watchBrowserPersistence);
}

