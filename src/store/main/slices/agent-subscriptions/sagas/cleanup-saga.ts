/**
 * Cleanup saga — evicts stale deleted agents from state.
 *
 * Replaces the imperative `evictStaleDeletedAgents()` and
 * `validateRestoredSubscriptions()` from AgentEventSubscriptionService.
 */

import { call, put, select, takeEvery, delay } from "typed-redux-saga";
import {
  markAgentDeleted,
  evictDeletedAgent,
  removeAllSubscriptions,
  clearAgentQueue,
  bumpVersion,
} from "../agent-subscriptions-slice";
import {
  selectWorkspaceSubscriptionState,
} from "../agent-subscriptions-selectors";
import {
  requestEvictStaleAgents,
  requestValidateSubscriptions,
  requestPersist,
} from "./saga-actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long to keep deleted agent records before eviction (ms). */
const STALE_AGENT_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Evict stale deleted agents
// ---------------------------------------------------------------------------

export function* handleEvictStaleAgents(
  action: ReturnType<typeof requestEvictStaleAgents>,
) {
  const [wsId] = action.payload;

  const ws = yield* select(
    selectWorkspaceSubscriptionState.select,
    wsId,
  );
  const deletedAgents = ws.deletedAgents;

  const now = Date.now();
  let evicted = 0;

  for (const [agentId, deletedAt] of Object.entries(deletedAgents)) {
    if (now - Number(deletedAt) > STALE_AGENT_TTL_MS) {
      yield* put(evictDeletedAgent(wsId, agentId));
      yield* put(clearAgentQueue(wsId, agentId));
      evicted++;
    }
  }

  if (evicted > 0) {
    yield* put(bumpVersion(wsId));
    yield* put(requestPersist(wsId));
  }
}

// ---------------------------------------------------------------------------
// Validate restored subscriptions against agent persistence
// ---------------------------------------------------------------------------

/**
 * Check if an agent session still exists.
 * Wraps the dynamic import so sagas can `call()` it.
 */
export async function isAgentSessionActive(
  agentId: string,
  wsId: string,
): Promise<boolean> {
  try {
    const { agentPersistence } = await import(
      "../../../../../features/agent/main/agent-persistence"
    );
    // loadAgent needs branded types but accepts plain strings at runtime
    const result = await agentPersistence.loadAgent(agentId as any, wsId as any);
    return result.success && result.data != null;
  } catch {
    // If we can't check, assume it's active to be safe
    return true;
  }
}

export function* handleValidateSubscriptions(
  action: ReturnType<typeof requestValidateSubscriptions>,
) {
  const [wsId] = action.payload;

  const ws = yield* select(
    selectWorkspaceSubscriptionState.select,
    wsId,
  );

  const subscriptions = Object.values(ws.subscriptions);
  const agentIds = [...new Set(subscriptions.map((s) => s.agentId))];

  let removed = 0;
  for (const agentId of agentIds) {
    const isActive: boolean = yield* call(isAgentSessionActive, agentId, wsId);
    if (!isActive) {
      yield* put(removeAllSubscriptions(wsId, agentId));
      yield* put(clearAgentQueue(wsId, agentId));
      yield* put(markAgentDeleted(wsId, agentId, Date.now()));
      removed++;
    }
  }

  if (removed > 0) {
    yield* put(bumpVersion(wsId));
    yield* put(requestPersist(wsId));
  }
}

// ---------------------------------------------------------------------------
// Watch for agent deletion → schedule eviction
// ---------------------------------------------------------------------------

export function* watchAgentDeletion() {
  yield* takeEvery(markAgentDeleted, function* (action) {
    const [wsId] = action.payload;
    // Delay eviction to avoid doing it immediately
    yield* delay(STALE_AGENT_TTL_MS);
    yield* put(requestEvictStaleAgents(wsId));
  });
}

// ---------------------------------------------------------------------------
// Root cleanup saga
// ---------------------------------------------------------------------------

export function* cleanupSaga() {
  yield* takeEvery(requestEvictStaleAgents, handleEvictStaleAgents);
  yield* takeEvery(requestValidateSubscriptions, handleValidateSubscriptions);
  yield* watchAgentDeletion();
}

