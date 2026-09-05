import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { omitKey } from '../../utils/utils';

type HandleDropZoneType = 'row-above' | 'row-below' | 'column-left' | 'column-right';
type TabFlagMap = Record<string, boolean>;
export type WorkspaceDropPlacement = 'before' | 'after' | 'above' | 'below';

export const TAB_SCROLL_POSITIONS_STORAGE_KEY = 'tab-scroll-positions';
export const WORKSPACE_TABS_STORAGE_KEY = 'workspace-tabs';

type SerializableRect = {
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
  workspaceStacks?: string[][];
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
  workspaceStacks: string[][];
  recentlyClosedTabIds: string[];
  recentlyClosedTabAt: Record<string, number>;
  version: number;
  /**
   * Backend id whose persisted tab strip has been (re)hydrated by the tab
   * saga, or null before the first hydration settles. The boot-route gate
   * compares it to the active backend id so a boot decision never reads a
   * stale/empty `currentTabId` while a backend switch's rehydration is still
   * in flight.
   */
  hydratedBackendId: string | null;
};

const MAX_RECENTLY_CLOSED_TABS = 10;
const NEW_WORKSPACE_ROUTE_ID = 'new';

const isWorkspaceTabId = (workspaceId: string): boolean => workspaceId !== NEW_WORKSPACE_ROUTE_ID;

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

const withNextVersion = (state: TabState, updates: Partial<TabState>): TabState => ({
  ...state,
  ...updates,
  version: state.version + 1,
});

function normalizePersistedWorkspaceStacks(
  tabOrder: string[],
  workspaceStacks?: string[][],
): string[][] {
  const validIds = new Set(tabOrder.filter(isWorkspaceTabId));
  const seen = new Set<string>();
  const normalized = (workspaceStacks ?? []).flatMap((stack) => {
    const workspaceIds = stack.filter((id) => validIds.has(id) && !seen.has(id));
    workspaceIds.forEach((id) => seen.add(id));
    return workspaceIds.length > 0 ? [workspaceIds] : [];
  });
  for (const workspaceId of tabOrder.filter(isWorkspaceTabId)) {
    if (!seen.has(workspaceId)) normalized.push([workspaceId]);
  }
  return normalized;
}

function getWorkspaceTabOrder(workspaceStacks: string[][]): string[] {
  return workspaceStacks.flatMap((stack) => stack);
}

function areWorkspaceStacksEqual(left: string[][], right: string[][]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (stack, stackIndex) =>
        stack.length === right[stackIndex]?.length &&
        stack.every((workspaceId, index) => workspaceId === right[stackIndex]?.[index]),
    )
  );
}

function moveWorkspaceInStacks(
  workspaceStacks: string[][],
  workspaceId: string,
  targetWorkspaceId: string,
  placement: WorkspaceDropPlacement,
): string[][] | null {
  if (workspaceId === targetWorkspaceId) return null;
  const tabOrder = getWorkspaceTabOrder(workspaceStacks);
  if (!tabOrder.includes(workspaceId) || !tabOrder.includes(targetWorkspaceId)) return null;

  const currentStacks = workspaceStacks;
  const withoutSource = currentStacks
    .map((stack) => stack.filter((id) => id !== workspaceId))
    .filter((stack) => stack.length > 0);
  const targetStackIndex = withoutSource.findIndex((stack) => stack.includes(targetWorkspaceId));
  if (targetStackIndex < 0) return null;

  const nextStacks = withoutSource.map((stack) => [...stack]);
  if (placement === 'above' || placement === 'below') {
    const targetStack = nextStacks[targetStackIndex];
    const targetIndex = targetStack.indexOf(targetWorkspaceId);
    targetStack.splice(targetIndex + (placement === 'below' ? 1 : 0), 0, workspaceId);
  } else {
    nextStacks.splice(targetStackIndex + (placement === 'after' ? 1 : 0), 0, [workspaceId]);
  }
  return areWorkspaceStacksEqual(currentStacks, nextStacks) ? null : nextStacks;
}

export const serializeWorkspaceTabsState = (
  state: Pick<
    TabState,
    | 'openTabs'
    | 'currentTabId'
    | 'pinnedTabs'
    | 'unsavedTabs'
    | 'optimisticTabs'
    | 'workspaceStacks'
  >,
): PersistedWorkspaceTabsState => ({
  openTabs: Object.keys(state.openTabs),
  currentTabId: state.currentTabId,
  pinnedTabs: Object.keys(state.pinnedTabs),
  unsavedTabs: Object.keys(state.unsavedTabs),
  optimisticTabs: Object.keys(state.optimisticTabs),
  tabOrder: getWorkspaceTabOrder(state.workspaceStacks),
  workspaceStacks: state.workspaceStacks,
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
  workspaceStacks: [],
  recentlyClosedTabIds: [],
  recentlyClosedTabAt: {},
  version: 0,
  hydratedBackendId: null,
};

const pruneClosedTabAt = (
  closedAt: Record<string, number>,
  recentlyClosedTabIds: string[],
): Record<string, number> => {
  const next: Record<string, number> = {};
  for (const tabId of recentlyClosedTabIds) {
    if (closedAt[tabId] !== undefined) next[tabId] = closedAt[tabId];
  }
  return next;
};

export const startDrag = createAction('tabState/startDrag');
export const endDrag = createAction('tabState/endDrag');
export const setActiveHandleDrop = createAction<[info: HandleDropInfo | null]>(
  'tabState/setActiveHandleDrop',
);
export const saveScrollPosition = createAction<[tabId: string, scrollTop: number]>(
  'tabState/saveScrollPosition',
);
export const loadScrollPositions = createAction<[positions: Record<string, number>]>(
  'tabState/loadScrollPositions',
);
export const openWorkspaceTab = createAction<[workspaceId: string]>('tabState/openWorkspaceTab');
export const closeWorkspaceTab = createAction(
  'tabState/closeWorkspaceTab',
  (workspaceId: string, timestamp?: number): [workspaceId: string, timestamp: number] => [
    workspaceId,
    timestamp ?? Date.now(),
  ],
);
export const reopenLastClosedWorkspaceTab = createAction('tabState/reopenLastClosedWorkspaceTab');
/**
 * Re-add a workspace tab to the strip WITHOUT focusing it — unlike
 * `openWorkspaceTab`, `currentTabId` is never touched. Used by the daemon
 * events bridge when a workspace transitions back to Active (unarchive) so the
 * tab reappears in the background instead of stealing focus.
 */
export const restoreWorkspaceTab = createAction<[workspaceId: string]>(
  'tabState/restoreWorkspaceTab',
);
export const moveWorkspace =
  createAction<[workspaceId: string, targetWorkspaceId: string, placement: WorkspaceDropPlacement]>(
    'tabState/moveWorkspace',
  );
export const switchToNextWorkspaceTab = createAction('tabState/switchToNextWorkspaceTab');
export const switchToPreviousWorkspaceTab = createAction('tabState/switchToPreviousWorkspaceTab');
export const switchToWorkspaceTabByIndex = createAction<[index: number]>(
  'tabState/switchToWorkspaceTabByIndex',
);
export const loadWorkspaceTabsState = createAction<[state: PersistedWorkspaceTabsState]>(
  'tabState/loadWorkspaceTabsState',
);
/**
 * The tab saga finished (re)hydrating the persisted tab strip for `backendId`
 * (dispatched after `loadWorkspaceTabsState`, and also when the backend had
 * nothing persisted). Consumers that read `currentTabId` at boot gate on this
 * matching the active backend id.
 */
export const workspaceTabsHydrated = createAction<[backendId: string]>(
  'tabState/workspaceTabsHydrated',
);

/** Actions whose reducer handlers may change the canonical current workspace tab. */
export const CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS = [
  openWorkspaceTab,
  closeWorkspaceTab,
  reopenLastClosedWorkspaceTab,
  switchToNextWorkspaceTab,
  switchToPreviousWorkspaceTab,
  switchToWorkspaceTabByIndex,
  loadWorkspaceTabsState,
];

export const tabStateReducer = createReducer<TabState>(initialState);
tabStateReducer.with(workspaceTabsHydrated, (state, { payload: [backendId] }) => {
  if (state.hydratedBackendId === backendId) return state;
  return { ...state, hydratedBackendId: backendId };
});
tabStateReducer.with(startDrag, (state) => {
  if (state.isDragging) return state;
  return { ...state, isDragging: true };
});
tabStateReducer.with(endDrag, (state) => {
  if (!state.isDragging && state.activeHandleDrop === null) return state;
  return { ...state, isDragging: false, activeHandleDrop: null };
});
tabStateReducer.with(setActiveHandleDrop, (state, { payload: [info] }) => ({
  ...state,
  activeHandleDrop: info,
}));
tabStateReducer.with(saveScrollPosition, (state, { payload: [tabId, scrollTop] }) => {
  if (scrollTop <= 0) {
    return state;
  }

  return {
    ...state,
    scrollPositions: { ...state.scrollPositions, [tabId]: scrollTop },
  };
});
tabStateReducer.with(loadScrollPositions, (state, { payload: [scrollPositions] }) => ({
  ...state,
  scrollPositions,
}));
tabStateReducer.with(openWorkspaceTab, (state, { payload: [workspaceId] }) => {
  if (!isWorkspaceTabId(workspaceId)) return state;

  const isNewTab = !state.openTabs[workspaceId];
  const isCurrentTab = state.currentTabId === workspaceId;

  if (!isNewTab && isCurrentTab) {
    return state;
  }

  const nextRecentlyClosedTabIds = state.recentlyClosedTabIds.filter(
    (tabId) => tabId !== workspaceId,
  );

  return withNextVersion(state, {
    openTabs: isNewTab ? addTabFlag(state.openTabs, workspaceId) : state.openTabs,
    currentTabId: workspaceId,
    workspaceStacks: isNewTab ? [...state.workspaceStacks, [workspaceId]] : state.workspaceStacks,
    recentlyClosedTabIds: nextRecentlyClosedTabIds,
    recentlyClosedTabAt: pruneClosedTabAt(state.recentlyClosedTabAt, nextRecentlyClosedTabIds),
  });
});
tabStateReducer.with(closeWorkspaceTab, (state, { payload: [workspaceId, timestamp] }) => {
  const tabOrder = getWorkspaceTabOrder(state.workspaceStacks);
  const index = tabOrder.indexOf(workspaceId);
  if (index === -1) return state;
  const nextWorkspaceStacks = state.workspaceStacks
    .map((stack) => stack.filter((tabId) => tabId !== workspaceId))
    .filter((stack) => stack.length > 0);
  const nextTabOrder = getWorkspaceTabOrder(nextWorkspaceStacks);

  let nextCurrentTabId = state.currentTabId;
  if (state.currentTabId === workspaceId) {
    if (nextTabOrder.length > 0) {
      const nextIndex = Math.min(index, nextTabOrder.length - 1);
      nextCurrentTabId = nextTabOrder[nextIndex] ?? null;
    } else {
      nextCurrentTabId = null;
    }
  }

  const nextRecentlyClosedTabIds = [
    ...state.recentlyClosedTabIds.filter((tabId) => tabId !== workspaceId),
    workspaceId,
  ].slice(-MAX_RECENTLY_CLOSED_TABS);

  return withNextVersion(state, {
    openTabs: removeTabFlag(state.openTabs, workspaceId),
    currentTabId: nextCurrentTabId,
    pinnedTabs: removeTabFlag(state.pinnedTabs, workspaceId),
    unsavedTabs: removeTabFlag(state.unsavedTabs, workspaceId),
    workspaceStacks: nextWorkspaceStacks,
    recentlyClosedTabIds: nextRecentlyClosedTabIds,
    recentlyClosedTabAt: pruneClosedTabAt(
      { ...state.recentlyClosedTabAt, [workspaceId]: timestamp },
      nextRecentlyClosedTabIds,
    ),
  });
});
tabStateReducer.with(restoreWorkspaceTab, (state, { payload: [workspaceId] }) => {
  if (!isWorkspaceTabId(workspaceId)) return state;
  if (state.openTabs[workspaceId]) return state;

  const nextRecentlyClosedTabIds = state.recentlyClosedTabIds.filter(
    (tabId) => tabId !== workspaceId,
  );

  return withNextVersion(state, {
    openTabs: addTabFlag(state.openTabs, workspaceId),
    workspaceStacks: [...state.workspaceStacks, [workspaceId]],
    recentlyClosedTabIds: nextRecentlyClosedTabIds,
    recentlyClosedTabAt: pruneClosedTabAt(state.recentlyClosedTabAt, nextRecentlyClosedTabIds),
  });
});
tabStateReducer.with(reopenLastClosedWorkspaceTab, (state) => {
  const nextRecentlyClosedTabIds = [...state.recentlyClosedTabIds];
  let workspaceId = nextRecentlyClosedTabIds.pop();

  while (workspaceId && state.openTabs[workspaceId]) {
    workspaceId = nextRecentlyClosedTabIds.pop();
  }
  if (!workspaceId) return state;

  return withNextVersion(state, {
    openTabs: addTabFlag(state.openTabs, workspaceId),
    currentTabId: workspaceId,
    workspaceStacks: [...state.workspaceStacks, [workspaceId]],
    recentlyClosedTabIds: nextRecentlyClosedTabIds,
    recentlyClosedTabAt: pruneClosedTabAt(state.recentlyClosedTabAt, nextRecentlyClosedTabIds),
  });
});
tabStateReducer.with(moveWorkspace, (state, { payload: [workspaceId, targetId, placement] }) => {
  const nextWorkspaceStacks = moveWorkspaceInStacks(
    state.workspaceStacks,
    workspaceId,
    targetId,
    placement,
  );
  if (!nextWorkspaceStacks) return state;
  return withNextVersion(state, {
    workspaceStacks: nextWorkspaceStacks,
  });
});
tabStateReducer.with(switchToNextWorkspaceTab, (state) => {
  const tabOrder = getWorkspaceTabOrder(state.workspaceStacks);
  if (tabOrder.length === 0) {
    return state;
  }

  const currentIndex = state.currentTabId ? tabOrder.indexOf(state.currentTabId) : -1;
  const nextIndex = (currentIndex + 1) % tabOrder.length;
  const nextTabId = tabOrder[nextIndex];

  if (!nextTabId) {
    return state;
  }

  return withNextVersion(state, {
    currentTabId: nextTabId,
  });
});
tabStateReducer.with(switchToPreviousWorkspaceTab, (state) => {
  const tabOrder = getWorkspaceTabOrder(state.workspaceStacks);
  if (tabOrder.length === 0) {
    return state;
  }

  const currentIndex = state.currentTabId ? tabOrder.indexOf(state.currentTabId) : -1;
  const previousIndex = currentIndex <= 0 ? tabOrder.length - 1 : currentIndex - 1;
  const previousTabId = tabOrder[previousIndex];

  if (!previousTabId) {
    return state;
  }

  return withNextVersion(state, {
    currentTabId: previousTabId,
  });
});
tabStateReducer.with(switchToWorkspaceTabByIndex, (state, { payload: [index] }) => {
  const tabOrder = getWorkspaceTabOrder(state.workspaceStacks);
  if (index < 0 || index >= tabOrder.length) {
    return state;
  }

  const nextTabId = tabOrder[index];
  if (!nextTabId) {
    return state;
  }

  return withNextVersion(state, {
    currentTabId: nextTabId,
  });
});
tabStateReducer.with(loadWorkspaceTabsState, (state, { payload: [workspaceTabsState] }) => {
  const tabOrder = (workspaceTabsState.tabOrder ?? []).filter(isWorkspaceTabId);
  const workspaceStacks = normalizePersistedWorkspaceStacks(
    tabOrder,
    workspaceTabsState.workspaceStacks,
  );
  return {
    ...state,
    openTabs: createTabFlagMap((workspaceTabsState.openTabs ?? []).filter(isWorkspaceTabId)),
    currentTabId:
      workspaceTabsState.currentTabId && isWorkspaceTabId(workspaceTabsState.currentTabId)
        ? workspaceTabsState.currentTabId
        : null,
    pinnedTabs: createTabFlagMap((workspaceTabsState.pinnedTabs ?? []).filter(isWorkspaceTabId)),
    unsavedTabs: createTabFlagMap((workspaceTabsState.unsavedTabs ?? []).filter(isWorkspaceTabId)),
    optimisticTabs: createTabFlagMap(
      (workspaceTabsState.optimisticTabs ?? []).filter(isWorkspaceTabId),
    ),
    workspaceStacks,
    recentlyClosedTabIds: [],
    recentlyClosedTabAt: {},
  };
});
