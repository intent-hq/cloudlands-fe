import { call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from '../../../utils/safe-local-storage-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import { selectWorkspaceHasLoaded } from '../../workspace/workspace-selectors';
import {
  selectAllScrollPositions,
  selectPersistedWorkspaceTabsState,
} from '../tab-state-selectors';
import {
  cleanupInvalidWorkspaceTabs,
  clearCurrentWorkspaceTab,
  clearForWorkspace,
  closeWorkspaceTab,
  handleOptimisticWorkspaceTabTransition,
  loadScrollPositions,
  loadWorkspaceTabsState,
  markWorkspaceTabOptimistic,
  markWorkspaceTabUnsaved,
  openWorkspaceTab,
  type PersistedWorkspaceTabsState,
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
} from '../tab-state-slice';

const TAB_PERSIST_ACTIONS = [
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
];

const SCROLL_PERSIST_ACTIONS = [saveScrollPosition, removeScrollPosition, clearForWorkspace];
const ALL_PERSIST_ACTIONS = [...TAB_PERSIST_ACTIONS, ...SCROLL_PERSIST_ACTIONS];
const TAB_PERSIST_ACTION_TYPES = new Set(TAB_PERSIST_ACTIONS.map((action) => action.type));

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
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
    isStringArray(stored.tabOrder)
  );
}

function isScrollPositionsMap(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (position) => typeof position === 'number' && Number.isFinite(position),
  );
}

export function* hydrateTabState(): SagaGenerator<void> {
  try {
    const backendId = yield* selectActiveBackendId();
    const scrollPositions = yield* call(getLocalStorageJSON<unknown>, scrollKey(backendId));
    if (isScrollPositionsMap(scrollPositions)) {
      yield* put(loadScrollPositions(scrollPositions));
    }

    const workspaceTabs = yield* call(getLocalStorageJSON<unknown>, tabsKey(backendId));
    if (isPersistedWorkspaceTabsState(workspaceTabs)) {
      yield* put(loadWorkspaceTabsState(workspaceTabs));
    }
  } catch {
    // Hydration is best-effort; persistence remains available after a read failure.
  }
}

export function* persistTabState(action: { type: string }): SagaGenerator<void> {
  try {
    const backendId = yield* selectActiveBackendId();
    if (TAB_PERSIST_ACTION_TYPES.has(action.type)) {
      if (action.type === cleanupInvalidWorkspaceTabs.type) {
        const hasLoaded = yield* selectWorkspaceHasLoaded.effect();
        if (!hasLoaded) return;
      }
      const workspaceTabs = yield* selectPersistedWorkspaceTabsState.effect();
      yield* call(setLocalStorageJSON, tabsKey(backendId), workspaceTabs);
      return;
    }

    const scrollPositions = yield* selectAllScrollPositions.effect();
    yield* call(setLocalStorageJSON, scrollKey(backendId), scrollPositions);
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

/**
 * Backend switched (activeId flips via the boot connections:list refresh after
 * the window reloads): re-hydrate the incoming backend's tab strip + scroll
 * positions, resetting to empty when it has none so the previous backend's
 * tabs don't linger.
 */
export function* watchBackendSwitch(): SagaGenerator<void> {
  let lastBackendId = yield* selectActiveBackendId();
  while (true) {
    yield* take(connectionsListReceived);
    const backendId = yield* selectActiveBackendId();
    if (backendId === lastBackendId) continue;
    lastBackendId = backendId;
    const scrollPositions = yield* call(getLocalStorageJSON<unknown>, scrollKey(backendId));
    yield* put(
      loadScrollPositions(isScrollPositionsMap(scrollPositions) ? scrollPositions : {}),
    );
    const workspaceTabs = yield* call(getLocalStorageJSON<unknown>, tabsKey(backendId));
    yield* put(
      loadWorkspaceTabsState(
        isPersistedWorkspaceTabsState(workspaceTabs) ? workspaceTabs : EMPTY_WORKSPACE_TABS,
      ),
    );
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* tabStateSaga(): SagaGenerator<void> {
  yield* call(hydrateTabState);
  yield* fork(watchBackendSwitch);
  yield* takeEvery(ALL_PERSIST_ACTIONS, persistTabState);
}