/**
 * Unread-tracking saga.
 *
 * Handles:
 * - Loading persisted unread state from localStorage on startup
 * - Persisting unread state to localStorage on every change
 */

import { call, fork, put, takeEvery, type SagaGenerator } from "typed-redux-saga";
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from "../../../utils/safe-local-storage-saga";
import {
  hydrateUnreadTracking,
  markAgentAsViewed,
  newAssistantMessage,
  clearAgentUnread,
  clearWorkspaceUnread,
  clearAllUnread,
} from "../unread-tracking-slice";
import {
  selectAgentWorkspaceMap,
  selectCurrentlyViewedAgentId,
  selectUnreadAgentIds,
} from "../unread-tracking-selectors";

const STORAGE_KEY = "augment:unread-agents";
const WORKSPACE_MAP_STORAGE_KEY = "augment:unread-agents-workspaces";

// ── Init ──

function* loadFromLocalStorage(): SagaGenerator<void> {
  try {
    const storedIds = yield* call(getLocalStorageItem, STORAGE_KEY);
    const storedMap = yield* call(getLocalStorageItem, WORKSPACE_MAP_STORAGE_KEY);

    let unreadAgentIds: string[] = [];
    let agentWorkspaceMap: Record<string, string> = {};

    if (storedIds) {
      const parsed = JSON.parse(storedIds);
      if (Array.isArray(parsed)) {
        unreadAgentIds = parsed;
      }
    }

    if (storedMap) {
      const parsed = JSON.parse(storedMap);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        agentWorkspaceMap = parsed as Record<string, string>;
      }
    }

    if (unreadAgentIds.length > 0 || Object.keys(agentWorkspaceMap).length > 0) {
      yield* put(hydrateUnreadTracking({ unreadAgentIds, agentWorkspaceMap }));
    }
  } catch {
    // Ignore parse errors — start with empty state
  }
}

// ── Persistence ──

/** Persist both unread IDs and workspace map on any state-changing action. */
function* persistAll(): SagaGenerator<void> {
  try {
    const unreadAgentIds = yield* selectUnreadAgentIds.effect();
    const agentWorkspaceMap = yield* selectAgentWorkspaceMap.effect();

    yield* call(setLocalStorageItem, STORAGE_KEY, JSON.stringify(unreadAgentIds));

    // Only persist workspace entries for agents that are still unread
    const filteredMap: Record<string, string> = {};
    for (const id of unreadAgentIds) {
      if (agentWorkspaceMap[id]) {
        filteredMap[id] = agentWorkspaceMap[id];
      }
    }
    yield* call(
      setLocalStorageItem,
      WORKSPACE_MAP_STORAGE_KEY,
      JSON.stringify(filteredMap)
    );
  } catch {
    // Ignore storage errors — localStorage can throw (quota, private browsing)
  }
}

/**
 * Guard wrapper for markAgentAsViewed: skip persistence when the reducer
 * returned the same state (i.e. the agent was already the currently viewed one
 * and wasn't in the unread list).
 */
function* persistIfViewedAgentChanged(
  action: ReturnType<typeof markAgentAsViewed>,
): SagaGenerator<void> {
  const currentlyViewed = yield* selectCurrentlyViewedAgentId.effect();
  // Post-reduce: if agentId is already currentlyViewedAgentId AND not in
  // unreadAgentIds, the reducer was a no-op — nothing to persist.
  const [agentId] = action.payload;
  const unreadAgentIds = yield* selectUnreadAgentIds.effect();
  if (currentlyViewed === agentId && !unreadAgentIds.includes(agentId)) {
    // Reducer was a no-op — skip persistence
    return;
  }
  yield* call(persistAll);
}

function* watchPersistence(): SagaGenerator<void> {
  // markAgentAsViewed gets a guarded handler to avoid redundant localStorage writes
  yield* takeEvery(markAgentAsViewed, persistIfViewedAgentChanged);
  yield* takeEvery(
    [
      newAssistantMessage,
      clearAgentUnread,
      clearWorkspaceUnread,
      clearAllUnread,
    ],
    persistAll,
  );
}

// ── Root ──

export function* unreadTrackingSaga(): SagaGenerator<void> {
  yield* fork(loadFromLocalStorage);
  yield* fork(watchPersistence);
}

