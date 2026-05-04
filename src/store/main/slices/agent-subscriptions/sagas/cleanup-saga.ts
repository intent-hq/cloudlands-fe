/**
 * Cleanup saga — evicts stale deleted agents from state.
 *
 * Replaces the imperative `evictStaleDeletedAgents()` and
 * `validateRestoredSubscriptions()` from AgentEventSubscriptionService.
 */

import { call, put, takeEvery, delay } from "typed-redux-saga";
import {
  markAgentDeleted,
  evictDeletedAgent,
  removeAllSubscriptions,
  clearAgentQueue,
} from "../agent-subscriptions-slice";
import {
  selectWorkspaceSubscriptionState,
} from "../agent-subscriptions-selectors";
import {
  requestEvictStaleAgents,
  requestValidateSubscriptions,
} from "./saga-actions";
import { dispatchWorkspaceEvent } from "./ipc-bridge-saga";

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

  const ws = yield* selectWorkspaceSubscriptionState.effect(wsId);
  const deletedAgents = ws.deletedAgents;

  const now = Date.now();

  for (const [agentId, deletedAt] of Object.entries(deletedAgents)) {
    if (now - Number(deletedAt) > STALE_AGENT_TTL_MS) {
      yield* put(evictDeletedAgent(wsId, agentId));
      yield* put(clearAgentQueue(wsId, agentId));
    }
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

  const ws = yield* selectWorkspaceSubscriptionState.effect(wsId);

  const subscriptions = Object.values(ws.subscriptions);
  const agentIds = [...new Set(subscriptions.map((s) => s.agentId))];
  const activeAgentIds: string[] = [];
  let restoredCount = 0;

  for (const agentId of agentIds) {
    const isActive: boolean = yield* call(isAgentSessionActive, agentId, wsId);
    if (!isActive) {
      yield* put(removeAllSubscriptions(wsId, agentId));
      yield* put(clearAgentQueue(wsId, agentId));
      yield* put(markAgentDeleted(wsId, agentId, Date.now()));
      continue;
    }

    activeAgentIds.push(agentId);
    restoredCount += subscriptions.filter((s) => s.agentId === agentId).length;
  }

  if (restoredCount > 0) {
    yield* call(dispatchWorkspaceEvent, "agent:subscriptions-restored", wsId, {
      type: "system",
      id: "subscription-service",
      name: "Subscription Service",
    }, {
      count: restoredCount,
      agentIds: activeAgentIds,
    });
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

