import { describe, expect, it } from "vitest";
import {
  cleanupInvalidWorkspaceTabs,
  clearForWorkspace,
  clearCurrentWorkspaceTab,
  closeWorkspaceTab,
  endDrag,
  handleOptimisticWorkspaceTabTransition,
  loadScrollPositions,
  loadWorkspaceTabsState,
  markWorkspaceTabOptimistic,
  markWorkspaceTabUnsaved,
  openWorkspaceTab,
  removeScrollPosition,
  reorderWorkspaceTabs,
  saveScrollPosition,
  setActiveHandleDrop,
  startDrag,
  switchToNextWorkspaceTab,
  switchToPreviousWorkspaceTab,
  switchToWorkspaceTabByIndex,
  tabStateReducer,
  toggleWorkspaceTabPin,
  type HandleDropInfo,
  type PersistedWorkspaceTabsState,
  type TabState,
  unmarkWorkspaceTabOptimistic,
} from "./tab-state-slice";

const makeDropInfo = (zoneType: HandleDropInfo["zoneType"]): HandleDropInfo => ({
  handleRect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
  containerRect: { x: 0, y: 0, width: 100, height: 100, top: 0, right: 100, bottom: 100, left: 0 },
  zoneType,
  label: zoneType,
});

describe("tabStateReducer", () => {
  const initialState: TabState = {
    isDragging: false,
    activeHandleDrop: null,
    scrollPositions: {},
    openTabs: {},
    currentTabId: null,
    pinnedTabs: {},
    unsavedTabs: {},
    optimisticTabs: {},
    tabOrder: [],
    version: 0,
  };

  const makeState = (overrides: Partial<TabState> = {}): TabState => ({
    ...initialState,
    ...overrides,
  });

  it("returns the initial state", () => {
    expect(tabStateReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("handles drag lifecycle actions", () => {
    const dropInfo = makeDropInfo("row-above");
    const draggingState = tabStateReducer(initialState, startDrag());
    expect(draggingState.isDragging).toBe(true);

    const stateWithDrop = tabStateReducer(draggingState, setActiveHandleDrop(dropInfo));
    expect(stateWithDrop.activeHandleDrop).toEqual(dropInfo);

    const endedState = tabStateReducer(stateWithDrop, endDrag());
    expect(endedState.isDragging).toBe(false);
    expect(endedState.activeHandleDrop).toBeNull();
  });

  it("can clear the active handle drop without ending drag", () => {
    const stateWithDrop: TabState = {
      ...initialState,
      isDragging: true,
      activeHandleDrop: makeDropInfo("column-right"),
    };

    expect(tabStateReducer(stateWithDrop, setActiveHandleDrop(null)).activeHandleDrop).toBeNull();
  });

  it("saves positive scroll positions and ignores non-positive values", () => {
    expect(tabStateReducer(initialState, saveScrollPosition("tab-1", 0))).toBe(initialState);
    expect(tabStateReducer(initialState, saveScrollPosition("tab-1", -10))).toBe(initialState);

    expect(tabStateReducer(initialState, saveScrollPosition("tab-1", 150)).scrollPositions).toEqual({
      "tab-1": 150,
    });
  });

  it("removes scroll positions and ignores missing keys", () => {
    const stateWithPosition: TabState = {
      ...initialState,
      scrollPositions: { "tab-1": 150 },
    };

    expect(tabStateReducer(stateWithPosition, removeScrollPosition("missing"))).toBe(stateWithPosition);
    expect(tabStateReducer(stateWithPosition, removeScrollPosition("tab-1")).scrollPositions).toEqual({});
  });

  it("clears scroll positions only for the requested workspace prefix", () => {
    const stateWithPositions: TabState = {
      ...initialState,
      scrollPositions: { "ws-123-tab-1": 100, "ws-123-tab-2": 200, "ws-456-tab-3": 300 },
    };

    expect(tabStateReducer(stateWithPositions, clearForWorkspace("ws-123")).scrollPositions).toEqual({
      "ws-456-tab-3": 300,
    });
    expect(tabStateReducer(stateWithPositions, clearForWorkspace("ws-999"))).toBe(stateWithPositions);
  });

  it("loads scroll positions by replacing the existing map", () => {
    const stateWithPositions = makeState({
      scrollPositions: { "tab-1": 100 },
    });

    expect(tabStateReducer(stateWithPositions, loadScrollPositions({ "tab-2": 200 }))).toMatchObject({
      scrollPositions: { "tab-2": 200 },
    });
  });

  it("opens new workspace tabs and avoids duplicating an already active tab", () => {
    const openedState = tabStateReducer(initialState, openWorkspaceTab("ws-1"));

    expect(openedState.openTabs).toEqual({ "ws-1": true });
    expect(openedState.currentTabId).toBe("ws-1");
    expect(openedState.tabOrder).toEqual(["ws-1"]);
    expect(openedState.version).toBe(1);

    expect(tabStateReducer(openedState, openWorkspaceTab("ws-1"))).toBe(openedState);
  });

  it("selects an already open workspace tab without reordering it", () => {
    const existingState = makeState({
      openTabs: { "ws-1": true, "ws-2": true },
      currentTabId: "ws-1",
      tabOrder: ["ws-1", "ws-2"],
      version: 4,
    });

    expect(tabStateReducer(existingState, openWorkspaceTab("ws-2"))).toMatchObject({
      currentTabId: "ws-2",
      tabOrder: ["ws-1", "ws-2"],
      version: 5,
    });
  });

  it("closes a workspace tab and selects the next available tab", () => {
    const stateWithTabs = makeState({
      openTabs: { "ws-1": true, "ws-2": true, "ws-3": true },
      currentTabId: "ws-2",
      pinnedTabs: { "ws-2": true },
      unsavedTabs: { "ws-2": true },
      tabOrder: ["ws-1", "ws-2", "ws-3"],
      version: 2,
    });

    expect(tabStateReducer(stateWithTabs, closeWorkspaceTab("ws-2"))).toEqual({
      ...stateWithTabs,
      openTabs: { "ws-1": true, "ws-3": true },
      currentTabId: "ws-3",
      pinnedTabs: {},
      unsavedTabs: {},
      tabOrder: ["ws-1", "ws-3"],
      version: 3,
    });
  });

  it("clears the current workspace tab only when one is selected", () => {
    const selectedState = makeState({ currentTabId: "ws-1", version: 1 });

    expect(tabStateReducer(selectedState, clearCurrentWorkspaceTab())).toMatchObject({
      currentTabId: null,
      version: 2,
    });
    expect(tabStateReducer(initialState, clearCurrentWorkspaceTab())).toBe(initialState);
  });

  it("removes invalid non-optimistic workspace tabs while keeping optimistic ones", () => {
    const stateWithInvalidTabs = makeState({
      openTabs: { "ws-1": true, "ws-2": true, "optimistic-1": true },
      currentTabId: "ws-2",
      pinnedTabs: { "ws-2": true },
      unsavedTabs: { "ws-2": true },
      optimisticTabs: { "optimistic-1": true },
      tabOrder: ["ws-1", "ws-2", "optimistic-1"],
      version: 7,
    });

    expect(tabStateReducer(stateWithInvalidTabs, cleanupInvalidWorkspaceTabs(["ws-1"]))).toEqual({
      ...stateWithInvalidTabs,
      openTabs: { "ws-1": true, "optimistic-1": true },
      currentTabId: null,
      pinnedTabs: {},
      unsavedTabs: {},
      tabOrder: ["ws-1", "optimistic-1"],
      version: 8,
    });
    expect(tabStateReducer(initialState, cleanupInvalidWorkspaceTabs(["ws-1"]))).toBe(initialState);
  });

  it("toggles pinned workspace tabs", () => {
    const pinnedState = tabStateReducer(initialState, toggleWorkspaceTabPin("ws-1"));
    expect(pinnedState.pinnedTabs).toEqual({ "ws-1": true });
    expect(pinnedState.version).toBe(1);

    expect(tabStateReducer(pinnedState, toggleWorkspaceTabPin("ws-1"))).toMatchObject({
      pinnedTabs: {},
      version: 2,
    });
  });

  it("marks workspace tabs as unsaved and saved", () => {
    const unsavedState = tabStateReducer(initialState, markWorkspaceTabUnsaved("ws-1", true));
    expect(unsavedState.unsavedTabs).toEqual({ "ws-1": true });
    expect(unsavedState.version).toBe(1);

    expect(tabStateReducer(unsavedState, markWorkspaceTabUnsaved("ws-1", false))).toMatchObject({
      unsavedTabs: {},
      version: 2,
    });
  });

  it("reorders workspace tabs when both ids exist", () => {
    const orderedState = makeState({
      openTabs: { "ws-1": true, "ws-2": true, "ws-3": true },
      tabOrder: ["ws-1", "ws-2", "ws-3"],
      version: 5,
    });

    expect(tabStateReducer(orderedState, reorderWorkspaceTabs("ws-1", "ws-3"))).toMatchObject({
      tabOrder: ["ws-2", "ws-3", "ws-1"],
      version: 6,
    });
    expect(tabStateReducer(orderedState, reorderWorkspaceTabs("missing", "ws-3"))).toBe(orderedState);
  });

  it("tracks optimistic workspace tabs", () => {
    const optimisticState = tabStateReducer(initialState, markWorkspaceTabOptimistic("optimistic-1"));
    expect(optimisticState.optimisticTabs).toEqual({ "optimistic-1": true });
    expect(optimisticState.version).toBe(1);

    expect(
      tabStateReducer(optimisticState, unmarkWorkspaceTabOptimistic("optimistic-1"))
    ).toMatchObject({
      optimisticTabs: {},
      version: 2,
    });
  });

  it("replaces optimistic workspace ids across tab state", () => {
    const optimisticState = makeState({
      openTabs: { "optimistic-1": true, "ws-1": true },
      currentTabId: "optimistic-1",
      pinnedTabs: { "optimistic-1": true },
      unsavedTabs: { "optimistic-1": true },
      optimisticTabs: { "optimistic-1": true },
      tabOrder: ["ws-1", "optimistic-1"],
      version: 3,
    });

    expect(
      tabStateReducer(
        optimisticState,
        handleOptimisticWorkspaceTabTransition("optimistic-1", "ws-real")
      )
    ).toEqual({
      ...optimisticState,
      openTabs: { "ws-1": true, "ws-real": true },
      currentTabId: "ws-real",
      pinnedTabs: { "ws-real": true },
      unsavedTabs: { "ws-real": true },
      optimisticTabs: {},
      tabOrder: ["ws-1", "ws-real"],
      version: 4,
    });
  });

  it("switches between workspace tabs using navigation actions", () => {
    const stateWithTabs = makeState({
      openTabs: { "ws-1": true, "ws-2": true, "ws-3": true },
      currentTabId: "ws-3",
      tabOrder: ["ws-1", "ws-2", "ws-3"],
      version: 10,
    });

    expect(tabStateReducer(stateWithTabs, switchToNextWorkspaceTab())).toMatchObject({
      currentTabId: "ws-1",
      version: 11,
    });
    expect(tabStateReducer(stateWithTabs, switchToPreviousWorkspaceTab())).toMatchObject({
      currentTabId: "ws-2",
      version: 11,
    });
    expect(tabStateReducer(stateWithTabs, switchToWorkspaceTabByIndex(1))).toMatchObject({
      currentTabId: "ws-2",
      version: 11,
    });
    expect(tabStateReducer(stateWithTabs, switchToWorkspaceTabByIndex(99))).toBe(stateWithTabs);
  });

  it("hydrates persisted workspace tab state without touching scroll positions", () => {
    const persistedState: PersistedWorkspaceTabsState = {
      openTabs: ["ws-1", "ws-2"],
      currentTabId: "ws-2",
      pinnedTabs: ["ws-1"],
      unsavedTabs: ["ws-2"],
      optimisticTabs: ["optimistic-1"],
      tabOrder: ["ws-2", "ws-1", "optimistic-1"],
    };
    const stateWithScrollPositions = makeState({ scrollPositions: { "tab-1": 100 }, version: 6 });

    expect(tabStateReducer(stateWithScrollPositions, loadWorkspaceTabsState(persistedState))).toEqual({
      ...stateWithScrollPositions,
      openTabs: { "ws-1": true, "ws-2": true },
      currentTabId: "ws-2",
      pinnedTabs: { "ws-1": true },
      unsavedTabs: { "ws-2": true },
      optimisticTabs: { "optimistic-1": true },
      tabOrder: ["ws-2", "ws-1", "optimistic-1"],
    });
  });
});