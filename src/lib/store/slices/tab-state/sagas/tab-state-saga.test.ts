import { describe, expect, it } from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";
import { getLocalStorageJSON, setLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import {
  loadScrollPositions,
  loadWorkspaceTabsState,
  type PersistedWorkspaceTabsState,
  TAB_SCROLL_POSITIONS_STORAGE_KEY,
  WORKSPACE_TABS_STORAGE_KEY,
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
  toggleWorkspaceTabPin,
  unmarkWorkspaceTabOptimistic,
} from "../tab-state-slice";
import { selectAllScrollPositions, selectPersistedWorkspaceTabsState } from "../tab-state-selectors";
import { initSaga } from "./init-saga";
import {
  persistenceSaga,
  persistScrollPositionsState,
  persistWorkspaceTabsState,
} from "./persistence-saga";
import { tabStateSaga } from "./tab-state-saga";

describe("tabState sagas", () => {
  it("hydrates scroll positions and persisted workspace tabs on init", () => {
    const persistedWorkspaceTabs: PersistedWorkspaceTabsState = {
      openTabs: ["ws-1"],
      currentTabId: "ws-1",
      pinnedTabs: [],
      unsavedTabs: [],
      optimisticTabs: [],
      tabOrder: ["ws-1"],
    };

    testSaga(initSaga)
      .next()
      .call(getLocalStorageJSON, TAB_SCROLL_POSITIONS_STORAGE_KEY)
      .next({ "tab-1": 150 })
      .put(loadScrollPositions({ "tab-1": 150 }))
      .next()
      .call(getLocalStorageJSON, WORKSPACE_TABS_STORAGE_KEY)
      .next(persistedWorkspaceTabs)
      .put(loadWorkspaceTabsState(persistedWorkspaceTabs))
      .next()
      .isDone();
  });

  it("skips workspace tab hydration when no persisted workspace tab state exists", () => {
    testSaga(initSaga)
      .next()
      .call(getLocalStorageJSON, TAB_SCROLL_POSITIONS_STORAGE_KEY)
      .next(undefined)
      .put(loadScrollPositions({}))
      .next()
      .call(getLocalStorageJSON, WORKSPACE_TABS_STORAGE_KEY)
      .next(undefined)
      .isDone();
  });

  it("persists scroll positions using the scroll position selector", () => {
    testSaga(persistScrollPositionsState)
      .next()
      .select(selectAllScrollPositions.select)
      .next({ "tab-1": 200 })
      .call(setLocalStorageJSON, TAB_SCROLL_POSITIONS_STORAGE_KEY, { "tab-1": 200 })
      .next()
      .isDone();
  });

  it("persists workspace tabs using the serialized workspace tab selector", () => {
    const persistedWorkspaceTabs: PersistedWorkspaceTabsState = {
      openTabs: ["ws-1", "ws-2"],
      currentTabId: "ws-2",
      pinnedTabs: ["ws-1"],
      unsavedTabs: ["ws-2"],
      optimisticTabs: [],
      tabOrder: ["ws-1", "ws-2"],
    };

    testSaga(persistWorkspaceTabsState)
      .next()
      .select(selectPersistedWorkspaceTabsState.select)
      .next(persistedWorkspaceTabs)
      .call(setLocalStorageJSON, WORKSPACE_TABS_STORAGE_KEY, persistedWorkspaceTabs)
      .next()
      .isDone();
  });

  it("registers persistence watchers for scroll and workspace tab actions", () => {
    const iterator = persistenceSaga();

    const firstEffect = iterator.next().value as any;
    expect(firstEffect.type).toBe("FORK");
    expect(firstEffect.payload.args).toEqual([
      [saveScrollPosition, removeScrollPosition, clearForWorkspace],
      persistScrollPositionsState,
    ]);

    const secondEffect = iterator.next().value as any;
    expect(secondEffect.type).toBe("FORK");
    expect(secondEffect.payload.args).toEqual([
      [
        openWorkspaceTab,
        closeWorkspaceTab,
        clearCurrentWorkspaceTab,
        cleanupInvalidWorkspaceTabs,
        toggleWorkspaceTabPin,
        markWorkspaceTabUnsaved,
        reorderWorkspaceTabs,
        markWorkspaceTabOptimistic,
        unmarkWorkspaceTabOptimistic,
        handleOptimisticWorkspaceTabTransition,
        switchToNextWorkspaceTab,
        switchToPreviousWorkspaceTab,
        switchToWorkspaceTabByIndex,
      ],
      persistWorkspaceTabsState,
    ]);

    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("runs init before starting persistence watchers", () => {
    const iterator = tabStateSaga();

    expect(iterator.next()).toEqual({ value: sagaEffects.call(initSaga), done: false });
    expect(iterator.next()).toEqual({ value: sagaEffects.fork(persistenceSaga), done: false });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});