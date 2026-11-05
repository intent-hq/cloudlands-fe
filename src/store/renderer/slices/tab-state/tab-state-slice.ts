import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { BrowserTabNavigation } from './tab-state-types';
import { omitKey } from '../../utils/utils';
import {
  findWorkspaceTabGroup,
  normalizeWorkspaceTabGroups,
  parsePersistedWorkspaceTabGroups,
  resolveMovedWorkspaceTabGroups,
  type WorkspaceTabGroup,
  type WorkspaceTabGroupColor,
} from './tab-groups';

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
  tabGroups?: WorkspaceTabGroup[];
  openTabGroupId?: string | null;
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
  tabGroups: WorkspaceTabGroup[];
  /**
   * The one expanded group. It stays open until its chip is clicked again;
   * selecting a tab inside another group opens that group instead.
   */
  openTabGroupId: string | null;
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
  /** Renderer-local DOM leases; never persisted with workspace tabs. */
  mountedBrowserTabLeases: Record<string, Record<string, true>>;
  /** One-shot renderer DOM recovery requests, keyed by tab; never persisted. */
  browserTabRecoveryRequests: Record<string, string>;
  /** Distinguish already-started navigations from renderer commands; never persisted. */
  browserTabNavigations: Record<string, BrowserTabNavigation>;
  /**
   * Tabs an agent is acting on right now (main's agent drawing hold), so the
   * offscreen host draws them at full frame rate; never persisted.
   */
  browserTabsAgentDrawing: Record<string, true>;
};

const MAX_RECENTLY_CLOSED_TABS = 10;
const ONBOARDING_WORKSPACE_ID = 'new';

const isWorkspaceTabId = (workspaceId: string): boolean => workspaceId !== ONBOARDING_WORKSPACE_ID;

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

/** Group changes for a reducer update; nothing when no group exists. */
function updateGroups(
  state: TabState,
  update: (groups: WorkspaceTabGroup[]) => WorkspaceTabGroup[],
): Partial<TabState> {
  return state.tabGroups?.length ? { tabGroups: update(state.tabGroups) } : {};
}

/** Opens the group holding `workspaceId`, so selecting a hidden tab reveals it. */
function openGroupOf(state: TabState, workspaceId: string): Partial<TabState> {
  const group = state.tabGroups?.length
    ? findWorkspaceTabGroup(state.tabGroups, workspaceId)
    : undefined;
  return group && group.id !== state.openTabGroupId ? { openTabGroupId: group.id } : {};
}

function rememberGroupSelection(
  groups: WorkspaceTabGroup[],
  workspaceId: string | null,
): WorkspaceTabGroup[] {
  const group = findWorkspaceTabGroup(groups, workspaceId);
  if (!group || !workspaceId || group.lastActiveWorkspaceId === workspaceId) return groups;
  return groups.map((candidate) =>
    candidate === group ? { ...candidate, lastActiveWorkspaceId: workspaceId } : candidate,
  );
}

/** Moves `workspaceId` directly after `targetId`, keeping all other stacks. */
function placeAfterInStacks(
  workspaceStacks: string[][],
  workspaceId: string,
  targetId: string,
): string[][] {
  return moveWorkspaceInStacks(workspaceStacks, workspaceId, targetId, 'after') ?? workspaceStacks;
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
  > &
    Partial<Pick<TabState, 'tabGroups' | 'openTabGroupId'>>,
): PersistedWorkspaceTabsState => ({
  openTabs: Object.keys(state.openTabs),
  currentTabId: state.currentTabId,
  pinnedTabs: Object.keys(state.pinnedTabs),
  unsavedTabs: Object.keys(state.unsavedTabs),
  optimisticTabs: Object.keys(state.optimisticTabs),
  tabOrder: getWorkspaceTabOrder(state.workspaceStacks),
  workspaceStacks: state.workspaceStacks,
  ...(state.tabGroups?.length
    ? { tabGroups: state.tabGroups, openTabGroupId: state.openTabGroupId ?? null }
    : {}),
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
  tabGroups: [],
  openTabGroupId: null,
  recentlyClosedTabIds: [],
  recentlyClosedTabAt: {},
  version: 0,
  hydratedBackendId: null,
  mountedBrowserTabLeases: {},
  browserTabRecoveryRequests: {},
  browserTabNavigations: {},
  browserTabsAgentDrawing: {},
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
/** Route renderers may carry the originating navigation request ID. User
 * selections leave it absent, even when reselecting the same workspace. */
export const openWorkspaceTab = createAction<[workspaceId: string, routeRequestId?: string]>(
  'tabState/openWorkspaceTab',
);
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
 * tab reappears in the background instead of stealing focus, and when a
 * workspace-create proposal creates a workspace so it appears unfocused.
 */
export const restoreWorkspaceTab = createAction<[workspaceId: string]>(
  'tabState/restoreWorkspaceTab',
);
/**
 * The daemon created `workspaceId` from a workspace-create proposal emitted in
 * `sourceWorkspaceId` (`workspace:created` `data.origin`, PROTOCOL §6.5). The
 * proposal-workspace tab saga adds it as a background tab once it is loaded,
 * when this window has the source workspace's tab open.
 */
export const proposalWorkspaceCreated = createAction<
  [workspaceId: string, sourceWorkspaceId: string]
>('tabState/proposalWorkspaceCreated');
export const moveWorkspace =
  createAction<[workspaceId: string, targetWorkspaceId: string, placement: WorkspaceDropPlacement]>(
    'tabState/moveWorkspace',
  );
/** Puts `workspaceId` in a new group of its own. */
export const createWorkspaceTabGroup = createAction<
  [workspaceId: string, groupId: string, color: WorkspaceTabGroupColor]
>('tabState/createWorkspaceTabGroup');
/** Moves `workspaceId` to the end of `groupId`. */
export const addWorkspaceTabToGroup = createAction<[workspaceId: string, groupId: string]>(
  'tabState/addWorkspaceTabToGroup',
);
/** Takes `workspaceId` out of its group and places it just after the group. */
export const removeWorkspaceTabFromGroup = createAction<[workspaceId: string]>(
  'tabState/removeWorkspaceTabFromGroup',
);
export const updateWorkspaceTabGroup = createAction<
  [groupId: string, changes: { name?: string; color?: WorkspaceTabGroupColor }]
>('tabState/updateWorkspaceTabGroup');
/** Removes the group; its tabs stay open in place. */
/** Expands `groupId` (collapsing any other group), or collapses every group with null. */
export const setOpenWorkspaceTabGroup = createAction<[groupId: string | null]>(
  'tabState/setOpenWorkspaceTabGroup',
);
export const ungroupWorkspaceTabGroup = createAction<[groupId: string]>(
  'tabState/ungroupWorkspaceTabGroup',
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

export const acquireBrowserTabMount = createAction<[tabId: string, leaseId: string]>(
  'tabState/acquireBrowserTabMount',
);
export const releaseBrowserTabMount = createAction<[tabId: string, leaseId: string]>(
  'tabState/releaseBrowserTabMount',
);

export const requestBrowserTabRecovery = createAction<[tabId: string, requestId: string]>(
  'tabState/requestBrowserTabRecovery',
);
export const consumeBrowserTabRecovery = createAction<[tabId: string, requestId: string]>(
  'tabState/consumeBrowserTabRecovery',
);
export const observeBrowserTabNavigation = createAction<[tabId: string, url: string]>(
  'tabState/observeBrowserTabNavigation',
);
export const requestBrowserTabNavigation = createAction<[tabId: string, url: string]>(
  'tabState/requestBrowserTabNavigation',
);
export const consumeBrowserTabNavigation = createAction<
  [tabId: string, navigation: BrowserTabNavigation]
>('tabState/consumeBrowserTabNavigation');
export const browserTabAgentDrawingChanged = createAction<[tabId: string, active: boolean]>(
  'tabState/browserTabAgentDrawingChanged',
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
tabStateReducer.with(observeBrowserTabNavigation, (state, { payload: [tabId, url] }) => ({
  ...state,
  browserTabNavigations: { ...state.browserTabNavigations, [tabId]: { url, kind: 'observed' } },
}));
tabStateReducer.with(requestBrowserTabNavigation, (state, { payload: [tabId, url] }) => ({
  ...state,
  browserTabNavigations: { ...state.browserTabNavigations, [tabId]: { url, kind: 'requested' } },
}));
tabStateReducer.with(consumeBrowserTabNavigation, (state, { payload: [tabId, navigation] }) => {
  // An older action must not consume a newer command, even for the same URL.
  if (state.browserTabNavigations[tabId] !== navigation) return state;
  return { ...state, browserTabNavigations: omitKey(state.browserTabNavigations, tabId) };
});
tabStateReducer.with(browserTabAgentDrawingChanged, (state, { payload: [tabId, active] }) => {
  if (Boolean(state.browserTabsAgentDrawing[tabId]) === active) return state;
  return {
    ...state,
    browserTabsAgentDrawing: active
      ? { ...state.browserTabsAgentDrawing, [tabId]: true }
      : omitKey(state.browserTabsAgentDrawing, tabId),
  };
});
tabStateReducer.with(requestBrowserTabRecovery, (state, { payload: [tabId, requestId] }) => {
  if (state.browserTabRecoveryRequests[tabId] === requestId) return state;
  return {
    ...state,
    browserTabRecoveryRequests: { ...state.browserTabRecoveryRequests, [tabId]: requestId },
  };
});
tabStateReducer.with(consumeBrowserTabRecovery, (state, { payload: [tabId, requestId] }) => {
  if (state.browserTabRecoveryRequests[tabId] !== requestId) return state;
  return { ...state, browserTabRecoveryRequests: omitKey(state.browserTabRecoveryRequests, tabId) };
});
tabStateReducer.with(acquireBrowserTabMount, (state, { payload: [tabId, leaseId] }) => {
  const leases = state.mountedBrowserTabLeases[tabId];
  if (leases?.[leaseId]) return state;
  return {
    ...state,
    mountedBrowserTabLeases: {
      ...state.mountedBrowserTabLeases,
      [tabId]: { ...leases, [leaseId]: true },
    },
  };
});
tabStateReducer.with(releaseBrowserTabMount, (state, { payload: [tabId, leaseId] }) => {
  const leases = state.mountedBrowserTabLeases[tabId];
  if (!leases?.[leaseId]) return state;
  const remaining = omitKey(leases, leaseId);
  return {
    ...state,
    mountedBrowserTabLeases:
      Object.keys(remaining).length > 0
        ? { ...state.mountedBrowserTabLeases, [tabId]: remaining }
        : omitKey(state.mountedBrowserTabLeases, tabId),
  };
});
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
    ...updateGroups(state, (groups) => rememberGroupSelection(groups, workspaceId)),
    ...openGroupOf(state, workspaceId),
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
    ...updateGroups(state, (groups) => normalizeWorkspaceTabGroups(nextTabOrder, groups)),
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
    ...updateGroups(state, (groups) =>
      resolveMovedWorkspaceTabGroups(
        getWorkspaceTabOrder(nextWorkspaceStacks),
        groups,
        workspaceId,
      ),
    ),
  });
});
tabStateReducer.with(
  createWorkspaceTabGroup,
  (state, { payload: [workspaceId, groupId, color] }) => {
    const tabOrder = getWorkspaceTabOrder(state.workspaceStacks);
    if (!tabOrder.includes(workspaceId) || state.tabGroups.some((group) => group.id === groupId)) {
      return state;
    }
    const previousGroup = findWorkspaceTabGroup(state.tabGroups, workspaceId);
    let workspaceStacks = state.workspaceStacks;
    if (previousGroup && previousGroup.workspaceIds.length > 1) {
      workspaceStacks = placeAfterInStacks(
        workspaceStacks,
        workspaceId,
        previousGroup.workspaceIds.at(-1) ?? workspaceId,
      );
    }
    const withoutTab = state.tabGroups.map((group) => ({
      ...group,
      workspaceIds: group.workspaceIds.filter((id) => id !== workspaceId),
    }));
    const nextGroup: WorkspaceTabGroup = {
      id: groupId,
      name: '',
      color,
      workspaceIds: [workspaceId],
      lastActiveWorkspaceId: workspaceId,
    };
    return withNextVersion(state, {
      workspaceStacks,
      tabGroups: normalizeWorkspaceTabGroups(getWorkspaceTabOrder(workspaceStacks), [
        ...withoutTab,
        nextGroup,
      ]),
      openTabGroupId: groupId,
    });
  },
);
tabStateReducer.with(addWorkspaceTabToGroup, (state, { payload: [workspaceId, groupId] }) => {
  const target = state.tabGroups.find((group) => group.id === groupId);
  if (!target || target.workspaceIds.includes(workspaceId)) return state;
  if (!getWorkspaceTabOrder(state.workspaceStacks).includes(workspaceId)) return state;
  const lastMember = target.workspaceIds.at(-1) ?? workspaceId;
  const workspaceStacks = placeAfterInStacks(state.workspaceStacks, workspaceId, lastMember);
  const tabGroups = state.tabGroups.map((group) => {
    const workspaceIds = group.workspaceIds.filter((id) => id !== workspaceId);
    return group.id === groupId
      ? { ...group, workspaceIds: [...workspaceIds, workspaceId] }
      : { ...group, workspaceIds };
  });
  return withNextVersion(state, {
    workspaceStacks,
    tabGroups: normalizeWorkspaceTabGroups(getWorkspaceTabOrder(workspaceStacks), tabGroups),
  });
});
tabStateReducer.with(removeWorkspaceTabFromGroup, (state, { payload: [workspaceId] }) => {
  const group = findWorkspaceTabGroup(state.tabGroups, workspaceId);
  if (!group) return state;
  const lastMember = group.workspaceIds.at(-1) ?? workspaceId;
  const workspaceStacks =
    lastMember === workspaceId
      ? state.workspaceStacks
      : placeAfterInStacks(state.workspaceStacks, workspaceId, lastMember);
  const tabGroups = state.tabGroups.map((candidate) =>
    candidate === group
      ? { ...candidate, workspaceIds: candidate.workspaceIds.filter((id) => id !== workspaceId) }
      : candidate,
  );
  return withNextVersion(state, {
    workspaceStacks,
    tabGroups: normalizeWorkspaceTabGroups(getWorkspaceTabOrder(workspaceStacks), tabGroups),
  });
});
tabStateReducer.with(updateWorkspaceTabGroup, (state, { payload: [groupId, changes] }) => {
  const group = state.tabGroups.find((candidate) => candidate.id === groupId);
  if (!group) return state;
  const name = changes.name === undefined ? group.name : changes.name.trim();
  const color = changes.color ?? group.color;
  if (name === group.name && color === group.color) return state;
  return withNextVersion(state, {
    tabGroups: state.tabGroups.map((candidate) =>
      candidate === group ? { ...candidate, name, color } : candidate,
    ),
  });
});
tabStateReducer.with(setOpenWorkspaceTabGroup, (state, { payload: [groupId] }) => {
  const next = groupId && state.tabGroups.some((group) => group.id === groupId) ? groupId : null;
  if (next === state.openTabGroupId) return state;
  return withNextVersion(state, { openTabGroupId: next });
});
tabStateReducer.with(ungroupWorkspaceTabGroup, (state, { payload: [groupId] }) => {
  if (!state.tabGroups.some((group) => group.id === groupId)) return state;
  return withNextVersion(state, {
    tabGroups: state.tabGroups.filter((group) => group.id !== groupId),
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
    tabGroups: normalizeWorkspaceTabGroups(
      getWorkspaceTabOrder(workspaceStacks),
      parsePersistedWorkspaceTabGroups(workspaceTabsState.tabGroups),
    ),
    openTabGroupId:
      typeof workspaceTabsState.openTabGroupId === 'string'
        ? workspaceTabsState.openTabGroupId
        : null,
    recentlyClosedTabIds: [],
    recentlyClosedTabAt: {},
  };
});
