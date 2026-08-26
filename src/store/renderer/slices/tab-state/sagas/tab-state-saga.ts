import { call, delay, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import { getLocalStorageJSON, setLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import { selectPanelLayoutWorkspaces } from '../../panel-layout/panel-layout-selectors';
import {
  closeAllTabs,
  closeOtherTabs,
  closePanel,
  closeTab as closePanelTab,
  closeTabsByAgentId,
  closeTabsByType,
  closeTabsToRight,
} from '../../panel-layout/panel-layout-slice';
import {
  selectAllPaneScrollStates,
  selectAllScrollPositions,
  selectPersistedWorkspaceTabsState,
} from '../tab-state-selectors';
import {
  clearPaneScrollState,
  closeWorkspaceTab,
  loadPaneScrollStates,
  loadScrollPositions,
  loadWorkspaceTabsState,
  moveWorkspace,
  openWorkspaceTab,
  type PersistedWorkspaceTabsState,
  reopenLastClosedWorkspaceTab,
  prunePaneScrollStates,
  restoreWorkspaceTab,
  savePaneScrollState,
  saveScrollPosition,
  switchToNextWorkspaceTab,
  switchToPreviousWorkspaceTab,
  switchToWorkspaceTabByIndex,
  PANE_SCROLL_STATES_STORAGE_KEY,
  TAB_SCROLL_POSITIONS_STORAGE_KEY,
  WORKSPACE_TABS_STORAGE_KEY,
  workspaceTabsHydrated,
  type PaneScrollState,
} from '../tab-state-slice';

const TAB_PERSIST_ACTIONS = [
  openWorkspaceTab,
  closeWorkspaceTab,
  reopenLastClosedWorkspaceTab,
  restoreWorkspaceTab,
  moveWorkspace,
  switchToNextWorkspaceTab,
  switchToPreviousWorkspaceTab,
  switchToWorkspaceTabByIndex,
];

const SCROLL_PERSIST_ACTIONS = [saveScrollPosition];
const PANE_SCROLL_PERSIST_ACTIONS = [
  savePaneScrollState,
  clearPaneScrollState,
  prunePaneScrollStates,
];
const PANE_SCROLL_PRUNE_ACTIONS = [
  closeAllTabs,
  closeOtherTabs,
  closePanel,
  closePanelTab,
  closeTabsByAgentId,
  closeTabsByType,
  closeTabsToRight,
];

/** Empty persisted tab strip — used to reset when a backend has none stored. */
const EMPTY_WORKSPACE_TABS: PersistedWorkspaceTabsState = {
  openTabs: [],
  currentTabId: null,
  pinnedTabs: [],
  unsavedTabs: [],
  optimisticTabs: [],
  tabOrder: [],
};

// Both keys hold backend-specific workspace IDs, so two backends surfacing the
// same workspace id would clobber each other without a per-backend namespace
// (local keeps the legacy un-prefixed key).
function tabsKey(backendId: string): string {
  return namespaceBackendKey(WORKSPACE_TABS_STORAGE_KEY, backendId);
}

function scrollKey(backendId: string): string {
  return namespaceBackendKey(TAB_SCROLL_POSITIONS_STORAGE_KEY, backendId);
}

function paneScrollKey(backendId: string): string {
  return namespaceBackendKey(PANE_SCROLL_STATES_STORAGE_KEY, backendId);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalStringArrayArray(value: unknown): value is string[][] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(isStringArray));
}

function isPersistedWorkspaceTabsState(value: unknown): value is PersistedWorkspaceTabsState {
  if (!value || typeof value !== 'object') return false;
  const stored = value as Record<string, unknown>;
  return (
    isStringArray(stored.openTabs) &&
    (stored.currentTabId === null || typeof stored.currentTabId === 'string') &&
    isStringArray(stored.pinnedTabs) &&
    isStringArray(stored.unsavedTabs) &&
    isStringArray(stored.optimisticTabs) &&
    isStringArray(stored.tabOrder) &&
    isOptionalStringArrayArray(stored.workspaceStacks)
  );
}

function isScrollPositionsMap(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (position) => typeof position === 'number' && Number.isFinite(position),
  );
}

function isPaneScrollStatesMap(value: unknown): value is Record<string, PaneScrollState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const scrollState = entry as Record<string, unknown>;
    return (
      typeof scrollState.scrollTop === 'number' &&
      Number.isFinite(scrollState.scrollTop) &&
      scrollState.scrollTop >= 0 &&
      (scrollState.shouldFollowBottom === undefined ||
        typeof scrollState.shouldFollowBottom === 'boolean')
    );
  });
}

function migrateScrollPositions(
  scrollPositions: Record<string, number>,
): Record<string, PaneScrollState> {
  return Object.fromEntries(
    Object.entries(scrollPositions).map(([paneId, scrollTop]) => [paneId, { scrollTop }]),
  );
}

function* hydrateTabState(): SagaGenerator<void> {
  const backendId = yield* selectActiveBackendId();
  try {
    const scrollPositions = yield* call(getLocalStorageJSON<unknown>, scrollKey(backendId));
    if (isScrollPositionsMap(scrollPositions)) {
      yield* put(loadScrollPositions(scrollPositions));
    }
    const paneScrollStates = yield* call(getLocalStorageJSON<unknown>, paneScrollKey(backendId));
    if (isPaneScrollStatesMap(paneScrollStates)) {
      yield* put(loadPaneScrollStates(paneScrollStates));
    } else if (isScrollPositionsMap(scrollPositions)) {
      yield* put(loadPaneScrollStates(migrateScrollPositions(scrollPositions)));
    }

    const workspaceTabs = yield* call(getLocalStorageJSON<unknown>, tabsKey(backendId));
    if (isPersistedWorkspaceTabsState(workspaceTabs)) {
      yield* put(loadWorkspaceTabsState(workspaceTabs));
    }
  } catch {
    // Hydration is best-effort; persistence remains available after a read failure.
  }
  // Always mark hydration settled (even when nothing/garbage was stored) so
  // boot-time consumers of currentTabId don't wait forever.
  yield* put(workspaceTabsHydrated(backendId));
}

function* persistWorkspaceTabs(): SagaGenerator<void> {
  try {
    const backendId = yield* selectActiveBackendId();
    yield* call(
      setLocalStorageJSON,
      tabsKey(backendId),
      yield* selectPersistedWorkspaceTabsState.effect(),
    );
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistScrollPositions(): SagaGenerator<void> {
  try {
    const backendId = yield* selectActiveBackendId();
    yield* call(
      setLocalStorageJSON,
      scrollKey(backendId),
      yield* selectAllScrollPositions.effect(),
    );
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistPaneScrollStates(): SagaGenerator<void> {
  try {
    const backendId = yield* selectActiveBackendId();
    yield* call(
      setLocalStorageJSON,
      paneScrollKey(backendId),
      yield* selectAllPaneScrollStates.effect(),
    );
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* pruneClosedPaneScrollStates(): SagaGenerator<void> {
  // Svelte destroys the closed pane after the reducer update. Let that teardown
  // save its final position first, then remove state for panes that are no longer open.
  yield* delay(0);
  const workspaces = yield* selectPanelLayoutWorkspaces.effect();
  const validPaneIds = Object.values(workspaces).flatMap((workspace) =>
    Object.values(workspace.panels).flatMap((panel) => panel.tabs.map((tab) => tab.id)),
  );
  yield* put(prunePaneScrollStates(validPaneIds));
}

/**
 * Backend switched (activeId flips via the boot connections:list refresh after
 * the window reloads): re-hydrate the incoming backend's tab strip + scroll
 * positions, resetting to empty when it has none so the previous backend's
 * tabs don't linger. Also clears backend-local recently-closed workspace-tab
 * state to prevent cross-namespace reopens.
 */
function* watchBackendSwitch(): SagaGenerator<void> {
  let lastBackendId = yield* selectActiveBackendId();
  while (true) {
    yield* take(connectionsListReceived);
    const backendId = yield* selectActiveBackendId();
    if (backendId === lastBackendId) continue;
    lastBackendId = backendId;
    try {
      const scrollPositions = yield* call(getLocalStorageJSON<unknown>, scrollKey(backendId));
      yield* put(loadScrollPositions(isScrollPositionsMap(scrollPositions) ? scrollPositions : {}));
      const paneScrollStates = yield* call(getLocalStorageJSON<unknown>, paneScrollKey(backendId));
      yield* put(
        loadPaneScrollStates(
          isPaneScrollStatesMap(paneScrollStates)
            ? paneScrollStates
            : isScrollPositionsMap(scrollPositions)
              ? migrateScrollPositions(scrollPositions)
              : {},
        ),
      );
      const workspaceTabs = yield* call(getLocalStorageJSON<unknown>, tabsKey(backendId));
      yield* put(
        loadWorkspaceTabsState(
          isPersistedWorkspaceTabsState(workspaceTabs) ? workspaceTabs : EMPTY_WORKSPACE_TABS,
        ),
      );
    } catch {
      // Backend-specific hydration is best-effort; keep watching future switches.
    }
    yield* put(workspaceTabsHydrated(backendId));
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* tabStateSaga(): SagaGenerator<void> {
  yield* call(hydrateTabState);
  yield* fork(watchBackendSwitch);
  yield* takeEvery(TAB_PERSIST_ACTIONS, persistWorkspaceTabs);
  yield* takeEvery(SCROLL_PERSIST_ACTIONS, persistScrollPositions);
  yield* takeEvery(PANE_SCROLL_PERSIST_ACTIONS, persistPaneScrollStates);
  yield* takeEvery(PANE_SCROLL_PRUNE_ACTIONS, pruneClosedPaneScrollStates);
}
