/**
 * Unread-tracking saga.
 *
 * Handles:
 * - Loading persisted unread state from localStorage on startup
 * - Persisting unread state to localStorage on every change
 */

import {
  call,
  fork,
  put,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from "../../../utils/safe-local-storage-saga";
import { selectWorkspaceAgentIds } from "../../workspace-agents/workspace-agents-selectors";
import {
  selectCurrentlyViewedAgentId,
  selectUnreadAgentIds,
} from "../unread-tracking-selectors";
import {
  hydrateUnreadTracking,
  markAgentAsViewed,
  newAssistantMessage,
  clearAgentUnread,
  clearWorkspaceUnread,
  clearAllUnread,
  clearAgentsUnread,
} from "../unread-tracking-slice";

const STORAGE_KEY = "augment:unread-agents";

// ── Init ──

function* loadFromLocalStorage(): SagaGenerator<void> {
  try {
    const storedIds = yield* call(getLocalStorageItem, STORAGE_KEY);

    let unreadAgentIds: string[] = [];

    if (storedIds) {
      const parsed = JSON.parse(storedIds);
      if (Array.isArray(parsed)) {
        unreadAgentIds = parsed;
      }
    }

    if (unreadAgentIds.length > 0) {
      yield* put(hydrateUnreadTracking({ unreadAgentIds }));
    }
  } catch {
    // Ignore parse errors — start with empty state
  }
}

// ── Persistence ──

/** Persist unread IDs on any state-changing action. */
function* persistAll(): SagaGenerator<void> {
  try {
    const unreadAgentIds = yield* selectUnreadAgentIds.effect();

    yield* call(setLocalStorageItem, STORAGE_KEY, JSON.stringify(unreadAgentIds));
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

/** @internal Exported for testing only. */
export function* clearWorkspaceUnreadSaga(
  action: ReturnType<typeof clearWorkspaceUnread>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;

  const workspaceAgentIds = yield* selectWorkspaceAgentIds.effect(workspaceId);
  if (workspaceAgentIds.length === 0) return;

  const unreadAgentIds = yield* selectUnreadAgentIds.effect();
  const unreadSet = new Set(unreadAgentIds);
  const unreadWorkspaceAgentIds = workspaceAgentIds.filter((id) => unreadSet.has(id));
  if (unreadWorkspaceAgentIds.length === 0) return;

  yield* put(clearAgentsUnread(unreadWorkspaceAgentIds));
}

function* watchPersistence(): SagaGenerator<void> {
  yield* takeEvery(clearWorkspaceUnread, clearWorkspaceUnreadSaga);
  // markAgentAsViewed gets a guarded handler to avoid redundant localStorage writes
  yield* takeEvery(markAgentAsViewed, persistIfViewedAgentChanged);
  yield* takeEvery(
    [
      newAssistantMessage,
      clearAgentUnread,
      clearAgentsUnread,
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

