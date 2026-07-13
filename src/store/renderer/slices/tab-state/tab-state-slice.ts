import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";
import { omitKey } from "../../utils/utils";

export type HandleDropZoneType = "row-above" | "row-below" | "column-left" | "column-right";
export type TabFlagMap = Record<string, boolean>;

export const TAB_SCROLL_POSITIONS_STORAGE_KEY = "tab-scroll-positions";
export const WORKSPACE_TABS_STORAGE_KEY = "workspace-tabs";

export type SerializableRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export interface HandleDropInfo {
  handleRect: SerializableRect;
  containerRect: SerializableRect;
  zoneType: HandleDropZoneType;
  label: string;
}

export type PersistedWorkspaceTabsState = {
  openTabs: string[];
  currentTabId: string | null;
  pinnedTabs: string[];
  unsavedTabs: string[];
  optimisticTabs: string[];
  tabOrder: string[];
};

export type TabState = {
  isDragging: boolean;
  activeHandleDrop: HandleDropInfo | null;
  scrollPositions: Record<string, number>;
  openTabs: TabFlagMap;
  currentTabId: string | null;
  pinnedTabs: TabFlagMap;
  unsavedTabs: TabFlagMap;
  optimisticTabs: TabFlagMap;
  tabOrder: string[];
  version: number;
};

const createTabFlagMap = (tabIds: string[]): TabFlagMap => {
  const next: TabFlagMap = {};
  for (const tabId of tabIds) {
    next[tabId] = true;
  }
  return next;
};

const addTabFlag = (tabFlags: TabFlagMap, tabId: string): TabFlagMap => {
  if (tabFlags[tabId]) {
    return tabFlags;
  }

  return {
    ...tabFlags,
    [tabId]: true,
  };
};

const removeTabFlag = (tabFlags: TabFlagMap, tabId: string): TabFlagMap => {
  return omitKey(tabFlags, tabId);
};

const replaceTabFlag = (tabFlags: TabFlagMap, fromId: string, toId: string): TabFlagMap => {
  if (!tabFlags[fromId] || fromId === toId) {
    return tabFlags;
  }

  const next = omitKey(tabFlags, fromId);
  if (next[toId]) {
    return next;
  }

  return {
    ...next,
    [toId]: true,
  };
};

const withNextVersion = (state: TabState, updates: Partial<TabState>): TabState => ({
  ...state,
  ...updates,
  version: state.version + 1,
});

export const serializeWorkspaceTabsState = (
  state: Pick<
    TabState,
    "openTabs" | "currentTabId" | "pinnedTabs" | "unsavedTabs" | "optimisticTabs" | "tabOrder"
  >
): PersistedWorkspaceTabsState => ({
  openTabs: Object.keys(state.openTabs),
  currentTabId: state.currentTabId,
  pinnedTabs: Object.keys(state.pinnedTabs),
  unsavedTabs: Object.keys(state.unsavedTabs),
  optimisticTabs: Object.keys(state.optimisticTabs),
  tabOrder: state.tabOrder,
});

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

export const startDrag = createAction("tabState/startDrag");
export const endDrag = createAction("tabState/endDrag");
export const setActiveHandleDrop = createAction<[info: HandleDropInfo | null]>(
  "tabState/setActiveHandleDrop"
);
export const saveScrollPosition = createAction<[tabId: string, scrollTop: number]>(
  "tabState/saveScrollPosition"
);
export const removeScrollPosition = createAction<[tabId: string]>(
  "tabState/removeScrollPosition"
);
export const clearForWorkspace = createAction<[workspaceId: string]>(
  "tabState/clearForWorkspace"
);
export const loadScrollPositions = createAction<[positions: Record<string, number>]>(
  "tabState/loadScrollPositions"
);
export const openWorkspaceTab = createAction<[workspaceId: string]>("tabState/openWorkspaceTab");
export const closeWorkspaceTab = createAction<[workspaceId: string]>("tabState/closeWorkspaceTab");
export const clearCurrentWorkspaceTab = createAction("tabState/clearCurrentWorkspaceTab");
export const cleanupInvalidWorkspaceTabs = createAction<[validIds: string[]]>(
  "tabState/cleanupInvalidWorkspaceTabs"
);
export const toggleWorkspaceTabPin = createAction<[workspaceId: string]>(
  "tabState/toggleWorkspaceTabPin"
);
export const markWorkspaceTabUnsaved = createAction<[workspaceId: string, unsaved: boolean]>(
  "tabState/markWorkspaceTabUnsaved"
);
export const reorderWorkspaceTabs = createAction<[fromId: string, toId: string]>(
  "tabState/reorderWorkspaceTabs"
);
export const markWorkspaceTabOptimistic = createAction<[workspaceId: string]>(
  "tabState/markWorkspaceTabOptimistic"
);
export const unmarkWorkspaceTabOptimistic = createAction<[workspaceId: string]>(
  "tabState/unmarkWorkspaceTabOptimistic"
);
export const handleOptimisticWorkspaceTabTransition = createAction<[
  optimisticId: string,
  realId: string,
]>("tabState/handleOptimisticWorkspaceTabTransition");
export const switchToNextWorkspaceTab = createAction("tabState/switchToNextWorkspaceTab");
export const switchToPreviousWorkspaceTab = createAction("tabState/switchToPreviousWorkspaceTab");
export const switchToWorkspaceTabByIndex = createAction<[index: number]>(
  "tabState/switchToWorkspaceTabByIndex"
);
export const loadWorkspaceTabsState = createAction<[state: PersistedWorkspaceTabsState]>(
  "tabState/loadWorkspaceTabsState"
);

export const tabStateReducer = createReducer<TabState>(initialState)
  .with(startDrag, (state) => {
    if (state.isDragging) return state;
    return { ...state, isDragging: true };
  })
  .with(endDrag, (state) => {
    if (!state.isDragging && state.activeHandleDrop === null) return state;
    return { ...state, isDragging: false, activeHandleDrop: null };
  })
  .with(setActiveHandleDrop, (state, { payload: [info] }) => ({
    ...state,
    activeHandleDrop: info,
  }))
  .with(saveScrollPosition, (state, { payload: [tabId, scrollTop] }) => {
    if (scrollTop <= 0) {
      return state;
    }

    return {
      ...state,
      scrollPositions: { ...state.scrollPositions, [tabId]: scrollTop },
    };
  })
  .with(removeScrollPosition, (state, { payload: [tabId] }) => {
    if (!(tabId in state.scrollPositions)) {
      return state;
    }

    return {
      ...state,
      scrollPositions: omitKey(state.scrollPositions, tabId),
    };
  })
  .with(clearForWorkspace, (state, { payload: [workspaceId] }) => {
    const workspaceKeyPrefix = `${workspaceId}-`;
    const keysToRemove = Object.keys(state.scrollPositions).filter((key) =>
      key.startsWith(workspaceKeyPrefix)
    );

    if (keysToRemove.length === 0) {
      return state;
    }

    const nextScrollPositions = { ...state.scrollPositions };
    for (const key of keysToRemove) {
      delete nextScrollPositions[key];
    }

    return {
      ...state,
      scrollPositions: nextScrollPositions,
    };
  })
  .with(loadScrollPositions, (state, { payload: [scrollPositions] }) => ({
    ...state,
    scrollPositions,
  }))
  .with(openWorkspaceTab, (state, { payload: [workspaceId] }) => {
    const isNewTab = !state.openTabs[workspaceId];
    const isCurrentTab = state.currentTabId === workspaceId;

    if (!isNewTab && isCurrentTab) {
      return state;
    }

    return withNextVersion(state, {
      openTabs: isNewTab ? addTabFlag(state.openTabs, workspaceId) : state.openTabs,
      currentTabId: workspaceId,
      tabOrder: isNewTab ? [...state.tabOrder, workspaceId] : state.tabOrder,
    });
  })
  .with(closeWorkspaceTab, (state, { payload: [workspaceId] }) => {
    const index = state.tabOrder.indexOf(workspaceId);
    const nextTabOrder = index > -1 ? state.tabOrder.filter((tabId) => tabId !== workspaceId) : state.tabOrder;

    let nextCurrentTabId = state.currentTabId;
    if (state.currentTabId === workspaceId) {
      if (nextTabOrder.length > 0) {
        const nextIndex = Math.min(index, nextTabOrder.length - 1);
        nextCurrentTabId = nextTabOrder[nextIndex] ?? null;
      } else {
        nextCurrentTabId = null;
      }
    }

    return withNextVersion(state, {
      openTabs: removeTabFlag(state.openTabs, workspaceId),
      currentTabId: nextCurrentTabId,
      pinnedTabs: removeTabFlag(state.pinnedTabs, workspaceId),
      unsavedTabs: removeTabFlag(state.unsavedTabs, workspaceId),
      tabOrder: nextTabOrder,
    });
  })
  .with(clearCurrentWorkspaceTab, (state) => {
    if (state.currentTabId === null) {
      return state;
    }

    return withNextVersion(state, {
      currentTabId: null,
    });
  })
  .with(cleanupInvalidWorkspaceTabs, (state, { payload: [validIds] }) => {
    const validIdLookup = createTabFlagMap(validIds);
    let nextOpenTabs = state.openTabs;
    let nextPinnedTabs = state.pinnedTabs;
    let nextUnsavedTabs = state.unsavedTabs;
    let nextTabOrder = state.tabOrder;
    let nextCurrentTabId = state.currentTabId;
    let changed = false;

    for (const tabId of Object.keys(state.openTabs)) {
      if (validIdLookup[tabId] || state.optimisticTabs[tabId]) {
        continue;
      }

      nextOpenTabs = removeTabFlag(nextOpenTabs, tabId);
      nextPinnedTabs = removeTabFlag(nextPinnedTabs, tabId);
      nextUnsavedTabs = removeTabFlag(nextUnsavedTabs, tabId);
      nextTabOrder = nextTabOrder.filter((existingTabId) => existingTabId !== tabId);
      changed = true;
    }

    if (
      nextCurrentTabId &&
      !validIdLookup[nextCurrentTabId] &&
      !state.optimisticTabs[nextCurrentTabId]
    ) {
      nextCurrentTabId = null;
      changed = true;
    }

    if (!changed) {
      return state;
    }

    return withNextVersion(state, {
      openTabs: nextOpenTabs,
      currentTabId: nextCurrentTabId,
      pinnedTabs: nextPinnedTabs,
      unsavedTabs: nextUnsavedTabs,
      tabOrder: nextTabOrder,
    });
  })
  .with(toggleWorkspaceTabPin, (state, { payload: [workspaceId] }) => ({
    ...state,
    pinnedTabs: state.pinnedTabs[workspaceId]
      ? removeTabFlag(state.pinnedTabs, workspaceId)
      : addTabFlag(state.pinnedTabs, workspaceId),
    version: state.version + 1,
  }))
  .with(markWorkspaceTabUnsaved, (state, { payload: [workspaceId, unsaved] }) => ({
    ...state,
    unsavedTabs: unsaved
      ? addTabFlag(state.unsavedTabs, workspaceId)
      : removeTabFlag(state.unsavedTabs, workspaceId),
    version: state.version + 1,
  }))
  .with(reorderWorkspaceTabs, (state, { payload: [fromId, toId] }) => {
    const fromIndex = state.tabOrder.indexOf(fromId);
    const toIndex = state.tabOrder.indexOf(toId);

    if (fromIndex === -1 || toIndex === -1) {
      return state;
    }

    const nextTabOrder = [...state.tabOrder];
    nextTabOrder.splice(fromIndex, 1);
    nextTabOrder.splice(toIndex, 0, fromId);

    return withNextVersion(state, {
      tabOrder: nextTabOrder,
    });
  })
  .with(markWorkspaceTabOptimistic, (state, { payload: [workspaceId] }) => ({
    ...state,
    optimisticTabs: addTabFlag(state.optimisticTabs, workspaceId),
    version: state.version + 1,
  }))
  .with(unmarkWorkspaceTabOptimistic, (state, { payload: [workspaceId] }) => ({
    ...state,
    optimisticTabs: removeTabFlag(state.optimisticTabs, workspaceId),
    version: state.version + 1,
  }))
  .with(handleOptimisticWorkspaceTabTransition, (state, { payload: [optimisticId, realId] }) => {
    let changed = false;
    let nextOpenTabs = state.openTabs;
    let nextTabOrder = state.tabOrder;
    let nextCurrentTabId = state.currentTabId;
    let nextPinnedTabs = state.pinnedTabs;
    let nextUnsavedTabs = state.unsavedTabs;
    let nextOptimisticTabs = state.optimisticTabs;

    if (state.openTabs[optimisticId]) {
      nextOpenTabs = addTabFlag(removeTabFlag(state.openTabs, optimisticId), realId);
      changed = true;
    }

    if (state.tabOrder.includes(optimisticId)) {
      nextTabOrder = state.tabOrder.map((tabId) => (tabId === optimisticId ? realId : tabId));
      changed = true;
    }

    if (state.currentTabId === optimisticId) {
      nextCurrentTabId = realId;
      changed = true;
    }

    if (state.pinnedTabs[optimisticId]) {
      nextPinnedTabs = replaceTabFlag(state.pinnedTabs, optimisticId, realId);
      changed = true;
    }

    if (state.unsavedTabs[optimisticId]) {
      nextUnsavedTabs = replaceTabFlag(state.unsavedTabs, optimisticId, realId);
      changed = true;
    }

    if (state.optimisticTabs[optimisticId]) {
      nextOptimisticTabs = removeTabFlag(state.optimisticTabs, optimisticId);
      changed = true;
    }

    if (!changed) {
      return state;
    }

    return withNextVersion(state, {
      openTabs: nextOpenTabs,
      currentTabId: nextCurrentTabId,
      pinnedTabs: nextPinnedTabs,
      unsavedTabs: nextUnsavedTabs,
      optimisticTabs: nextOptimisticTabs,
      tabOrder: nextTabOrder,
    });
  })
  .with(switchToNextWorkspaceTab, (state) => {
    if (state.tabOrder.length === 0) {
      return state;
    }

    const currentIndex = state.currentTabId ? state.tabOrder.indexOf(state.currentTabId) : -1;
    const nextIndex = (currentIndex + 1) % state.tabOrder.length;
    const nextTabId = state.tabOrder[nextIndex];

    if (!nextTabId) {
      return state;
    }

    return withNextVersion(state, {
      currentTabId: nextTabId,
    });
  })
  .with(switchToPreviousWorkspaceTab, (state) => {
    if (state.tabOrder.length === 0) {
      return state;
    }

    const currentIndex = state.currentTabId ? state.tabOrder.indexOf(state.currentTabId) : -1;
    const previousIndex = currentIndex <= 0 ? state.tabOrder.length - 1 : currentIndex - 1;
    const previousTabId = state.tabOrder[previousIndex];

    if (!previousTabId) {
      return state;
    }

    return withNextVersion(state, {
      currentTabId: previousTabId,
    });
  })
  .with(switchToWorkspaceTabByIndex, (state, { payload: [index] }) => {
    if (index < 0 || index >= state.tabOrder.length) {
      return state;
    }

    const nextTabId = state.tabOrder[index];
    if (!nextTabId) {
      return state;
    }

    return withNextVersion(state, {
      currentTabId: nextTabId,
    });
  })
  .with(loadWorkspaceTabsState, (state, { payload: [workspaceTabsState] }) => ({
    ...state,
    openTabs: createTabFlagMap(workspaceTabsState.openTabs ?? []),
    currentTabId: workspaceTabsState.currentTabId ?? null,
    pinnedTabs: createTabFlagMap(workspaceTabsState.pinnedTabs ?? []),
    unsavedTabs: createTabFlagMap(workspaceTabsState.unsavedTabs ?? []),
    optimisticTabs: createTabFlagMap(workspaceTabsState.optimisticTabs ?? []),
    tabOrder: workspaceTabsState.tabOrder ?? [],
  }));