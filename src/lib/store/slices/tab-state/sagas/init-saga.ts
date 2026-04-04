import { getLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import { call, put } from "typed-redux-saga";
import {
  loadScrollPositions,
  loadWorkspaceTabsState,
  TAB_SCROLL_POSITIONS_STORAGE_KEY,
  type PersistedWorkspaceTabsState,
  WORKSPACE_TABS_STORAGE_KEY,
} from "../tab-state-slice";

export function* initSaga() {
  const positions =
    (yield* call(getLocalStorageJSON<Record<string, number>>, TAB_SCROLL_POSITIONS_STORAGE_KEY)) ??
    {};
  yield* put(loadScrollPositions(positions));

  const workspaceTabs = yield* call(
    getLocalStorageJSON<PersistedWorkspaceTabsState>,
    WORKSPACE_TABS_STORAGE_KEY
  );

  if (!workspaceTabs) {
    return;
  }

  yield* put(loadWorkspaceTabsState(workspaceTabs));
}