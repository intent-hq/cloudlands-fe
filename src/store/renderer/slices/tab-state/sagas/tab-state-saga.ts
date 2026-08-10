import { call, put, takeEvery, takeLeading, type SagaGenerator } from 'typed-redux-saga';

import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import { getLocalStorageJSON, setLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
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

function* persistCleanedWorkspaceTabs(): SagaGenerator<void> {
  if (!(yield* selectWorkspaceHasLoaded.effect())) return;
  yield* call(persistWorkspaceTabs);
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

/**
 * Backend switched (activeId flips via the boot connections:list refresh after
 * the window reloads): re-hydrate the incoming backend's tab strip + scroll
 * positions, resetting to empty when it has none so the previous backend's
 * tabs don't linger.
 */
function* handleBackendSwitch(lastBackend: { id: string }): SagaGenerator<void> {
  const backendId = yield* selectActiveBackendId();
  if (backendId === lastBackend.id) return;
  lastBackend.id = backendId;
  try {
    const scrollPositions = yield* call(getLocalStorageJSON<unknown>, scrollKey(backendId));
    yield* put(loadScrollPositions(isScrollPositionsMap(scrollPositions) ? scrollPositions : {}));
    const workspaceTabs = yield* call(getLocalStorageJSON<unknown>, tabsKey(backendId));
    yield* put(
      loadWorkspaceTabsState(
        isPersistedWorkspaceTabsState(workspaceTabs) ? workspaceTabs : EMPTY_WORKSPACE_TABS,
      ),
    );
  } catch {
    // Backend-specific hydration is best-effort.
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* tabStateSaga(): SagaGenerator<void> {
  yield* call(hydrateTabState);
  yield* takeLeading(connectionsListReceived, handleBackendSwitch, {
    id: yield* selectActiveBackendId(),
  });
  yield* takeEvery(TAB_PERSIST_ACTIONS, persistWorkspaceTabs);
  yield* takeEvery(cleanupInvalidWorkspaceTabs, persistCleanedWorkspaceTabs);
  yield* takeEvery(SCROLL_PERSIST_ACTIONS, persistScrollPositions);
}
