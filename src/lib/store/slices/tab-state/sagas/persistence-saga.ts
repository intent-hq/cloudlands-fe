import { setLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import { call, takeEvery, type SagaGenerator } from "typed-redux-saga";
import {
  clearCurrentWorkspaceTab,
  cleanupInvalidWorkspaceTabs,
  clearForWorkspace,
  closeWorkspaceTab,
  handleOptimisticWorkspaceTabTransition,
  markWorkspaceTabOptimistic,
  markWorkspaceTabUnsaved,
  openWorkspaceTab,
  removeScrollPosition,
  reorderWorkspaceTabs,
  saveScrollPosition,
  switchToNextWorkspaceTab,
  switchToPreviousWorkspaceTab,
  switchToWorkspaceTabByIndex,
  TAB_SCROLL_POSITIONS_STORAGE_KEY,
  toggleWorkspaceTabPin,
  unmarkWorkspaceTabOptimistic,
  WORKSPACE_TABS_STORAGE_KEY,
} from "../tab-state-slice";
import { selectAllScrollPositions, selectPersistedWorkspaceTabsState } from "../tab-state-selectors";

export function* persistScrollPositionsState(): SagaGenerator<void> {
  const positions = yield* selectAllScrollPositions.effect();
  yield* call(setLocalStorageJSON, TAB_SCROLL_POSITIONS_STORAGE_KEY, positions);
}

export function* persistWorkspaceTabsState(): SagaGenerator<void> {
  const workspaceTabsState = yield* selectPersistedWorkspaceTabsState.effect();
  yield* call(setLocalStorageJSON, WORKSPACE_TABS_STORAGE_KEY, workspaceTabsState);
}

export function* persistenceSaga() {
  yield* takeEvery(
    [saveScrollPosition.type, removeScrollPosition.type, clearForWorkspace.type],
    persistScrollPositionsState
  );

  yield* takeEvery(
    [
      openWorkspaceTab.type,
      closeWorkspaceTab.type,
      clearCurrentWorkspaceTab.type,
      cleanupInvalidWorkspaceTabs.type,
      toggleWorkspaceTabPin.type,
      markWorkspaceTabUnsaved.type,
      reorderWorkspaceTabs.type,
      markWorkspaceTabOptimistic.type,
      unmarkWorkspaceTabOptimistic.type,
      handleOptimisticWorkspaceTabTransition.type,
      switchToNextWorkspaceTab.type,
      switchToPreviousWorkspaceTab.type,
      switchToWorkspaceTabByIndex.type,
    ],
    persistWorkspaceTabsState
  );
}