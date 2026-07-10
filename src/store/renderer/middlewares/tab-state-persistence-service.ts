/**
 * Tab-state persistence service — restores the workspace-tabs +
 * scroll-positions localStorage read/write that the removed
 * `tab-state/sagas/persistence-saga` and `tab-state/sagas/init-saga`
 * performed. With no saga listening, the strip never restored open tabs / pin
 * / order / active tab across relaunches and scroll positions never survived.
 *
 * Like `unread-tracking-persistence-service`, this reconnects the path WITHOUT
 * re-adding a saga and WITHOUT changing any call site:
 *   - On creation it hydrates workspace tabs + scroll positions from
 *     localStorage once (silently on missing/corrupt JSON).
 *   - After any tab-mutating action it writes the serialized shape back.
 *   - After any scroll-mutating action it writes the scroll positions map.
 *
 * Storage keys and payload shape match the reference saga (see
 * `serializeWorkspaceTabsState` in `tab-state-slice.ts`) so persisted state
 * remains cross-compatible with the pre-port app.
 *
 * DoD #4 (workspaces that no longer exist): the existing
 * `cleanupInvalidWorkspaceTabs` dispatch in `routes/+layout.svelte` runs
 * reactively after workspace hydration and prunes stale ids — not
 * reimplemented here.
 *
 * DoD #5 (optimistic ghosts): the reference persisted and reloaded
 * `optimisticTabs` verbatim; this middleware matches by forwarding the
 * persisted state to `loadWorkspaceTabsState` unchanged.
 *
 * Dependency-light per src/store AGENTS.md: imports only the safe-storage
 * helper and slice actions/serializer — no selectors and no store module.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import type { StoreState } from "../types";
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
  serializeWorkspaceTabsState,
  switchToNextWorkspaceTab,
  switchToPreviousWorkspaceTab,
  switchToWorkspaceTabByIndex,
  TAB_SCROLL_POSITIONS_STORAGE_KEY,
  toggleWorkspaceTabPin,
  unmarkWorkspaceTabOptimistic,
  WORKSPACE_TABS_STORAGE_KEY,
} from "../slices/tab-state/tab-state-slice";

/** Actions whose reducer changes workspace-tab state and needs a write-back. */
const TAB_PERSIST_ACTION_TYPES = new Set<string>([
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
]);

/** Actions whose reducer changes scroll positions and needs a write-back. */
const SCROLL_PERSIST_ACTION_TYPES = new Set<string>([
  saveScrollPosition.type,
  removeScrollPosition.type,
  clearForWorkspace.type,
]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPersistedWorkspaceTabsState(
  value: unknown,
): value is PersistedWorkspaceTabsState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    isStringArray(v.openTabs) &&
    (v.currentTabId === null || typeof v.currentTabId === "string") &&
    isStringArray(v.pinnedTabs) &&
    isStringArray(v.unsavedTabs) &&
    isStringArray(v.optimisticTabs) &&
    isStringArray(v.tabOrder)
  );
}

function isScrollPositionsMap(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (n) => typeof n === "number" && Number.isFinite(n),
  );
}

function loadStoredWorkspaceTabs(): PersistedWorkspaceTabsState | undefined {
  const stored = safeLocalStorage.getJSON<unknown>(WORKSPACE_TABS_STORAGE_KEY);
  return isPersistedWorkspaceTabsState(stored) ? stored : undefined;
}

function loadStoredScrollPositions(): Record<string, number> | undefined {
  const stored = safeLocalStorage.getJSON<unknown>(TAB_SCROLL_POSITIONS_STORAGE_KEY);
  return isScrollPositionsMap(stored) ? stored : undefined;
}

function persistWorkspaceTabsState(state: StoreState): void {
  safeLocalStorage.setJSON(
    WORKSPACE_TABS_STORAGE_KEY,
    serializeWorkspaceTabsState(state.tabState),
  );
}

function persistScrollPositions(state: StoreState): void {
  safeLocalStorage.setJSON(
    TAB_SCROLL_POSITIONS_STORAGE_KEY,
    state.tabState.scrollPositions,
  );
}

/**
 * Middleware giving the tab-state persistence triggers real handlers again.
 * Hydration runs once at factory time (state is already initialized through
 * the INIT reducer pass before the middleware chain is composed); persistence
 * runs after each mutating action passes the reducer.
 */
export function createTabStatePersistenceMiddleware(): StoreMiddleware {
  return (api) => {
    const scrollPositions = loadStoredScrollPositions();
    if (scrollPositions) {
      api.dispatch(loadScrollPositions(scrollPositions));
    }

    const workspaceTabs = loadStoredWorkspaceTabs();
    if (workspaceTabs) {
      api.dispatch(loadWorkspaceTabsState(workspaceTabs));
    }

    return (next) => (action) => {
      const result = next(action);
      if (action) {
        if (TAB_PERSIST_ACTION_TYPES.has(action.type)) {
          persistWorkspaceTabsState(api.getState() as StoreState);
        } else if (SCROLL_PERSIST_ACTION_TYPES.has(action.type)) {
          persistScrollPositions(api.getState() as StoreState);
        }
      }
      return result;
    };
  };
}
