import { put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { getLocalStorageJSON, setLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
import {
  addRecentUrl,
  clearRecentUrls,
  hydrateBrowserState,
  initBrowserWorkspace,
  removeRecentUrl,
  updateUrlMetadata,
} from '../browser-slice';
import { selectExistingBrowserWorkspaceState } from '../browser-selectors';
import { isRecentUrl, storageKey } from '../browser-storage-utils';
import { MAX_RECENT_URLS } from '../browser-types';

export function* hydrateBrowserWorkspaceWorker(
  action: ReturnType<typeof initBrowserWorkspace>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  const stored = yield* getLocalStorageJSON<unknown>(storageKey(workspaceId));
  const recentUrls = Array.isArray(stored)
    ? stored.filter(isRecentUrl).slice(0, MAX_RECENT_URLS)
    : [];
  yield* put(hydrateBrowserState(workspaceId, recentUrls));
}

function* persistBrowserRecentUrlsWorker(
  action:
    | ReturnType<typeof addRecentUrl>
    | ReturnType<typeof updateUrlMetadata>
    | ReturnType<typeof removeRecentUrl>
    | ReturnType<typeof clearRecentUrls>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  const workspaceState = yield* selectExistingBrowserWorkspaceState.effect(workspaceId);
  if (!workspaceState) return;
  yield* setLocalStorageJSON(storageKey(workspaceId), workspaceState.recentUrls);
}

/** Unregistered until the S20 middleware cutover. */
export function* browserPersistenceSaga(): SagaGenerator<void> {
  yield* takeEvery(initBrowserWorkspace, hydrateBrowserWorkspaceWorker);
  yield* takeEvery(
    [addRecentUrl, updateUrlMetadata, removeRecentUrl, clearRecentUrls],
    persistBrowserRecentUrlsWorker,
  );
}
