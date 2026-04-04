/**
 * Persistence saga — debounced persist and restore of subscription state.
 *
 * Replaces the imperative `schedulePersist()` / `restoreSubscriptionsSync()` /
 * `persistSubscriptions()` logic from AgentEventSubscriptionService.
 *
 * Uses `call()` for all filesystem operations so they remain mockable.
 */

import * as path from "path";
import { promises as fsPromises } from "fs";
import { call, put, select, takeLatest, takeEvery, delay } from "typed-redux-saga";
import {
  setSubscriptionsSnapshot,
  addSubscription,
  removeSubscription,
  removeAllSubscriptions,
  setDelegationGroup,
  removeDelegationGroup,
  markDelegationAgentCompleted,
  markDelegationAgentDeleted,
  markDelegationDelivered,
  markOneShotFired,
  markAgentDeleted,
  bumpVersion,
} from "../agent-subscriptions-slice";
import { selectWorkspaceSubscriptionState } from "../agent-subscriptions-selectors";
import type { WorkspaceSubscriptionState } from "../types";
import { requestPersist, requestRestore } from "./saga-actions";
import { WorkspaceConfig } from "$shared/main/config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERSIST_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Filesystem helpers (called via `call()` for testability)
// ---------------------------------------------------------------------------

export function getSubscriptionsFilePath(workspaceId: string): string {
  return path.join(WorkspaceConfig.paths.workspace(workspaceId), "agent-subscriptions.json");
}

export async function writeSubscriptions(
  filePath: string,
  data: unknown,
): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function readSubscriptions(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null; // No file yet — not an error
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Serialize workspace state for persistence
// ---------------------------------------------------------------------------

function serializeForDisk(ws: WorkspaceSubscriptionState): unknown {
  return {
    subscriptions: Object.values(ws.subscriptions),
    delegationGroups: Object.values(ws.delegationGroups),
    firedOneShotSubscriptions: ws.firedOneShotSubscriptions,
    deletedAgents: Object.entries(ws.deletedAgents).map(
      ([id, deletedAt]) => ({ id, deletedAt }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Persist handler
// ---------------------------------------------------------------------------

export function* handlePersist(action: ReturnType<typeof requestPersist>) {
  // Debounce by taking latest
  yield* delay(PERSIST_DEBOUNCE_MS);

  const [wsId] = action.payload;
  const ws = yield* select(
    selectWorkspaceSubscriptionState.select,
    wsId,
  );

  const data = serializeForDisk(ws);
  const filePath: string = yield* call(getSubscriptionsFilePath, wsId);
  yield* call(writeSubscriptions, filePath, data);
}

// ---------------------------------------------------------------------------
// Restore handler
// ---------------------------------------------------------------------------

export function* handleRestore(action: ReturnType<typeof requestRestore>) {
  const [wsId] = action.payload;

  const filePath: string = yield* call(getSubscriptionsFilePath, wsId);
  const data: unknown | null = yield* call(readSubscriptions, filePath);
  if (!data || typeof data !== "object") return;

  const parsed = data as Record<string, unknown>;

  // Build a WorkspaceSubscriptionState from disk data
  // The snapshot action replaces the entire workspace state
  const subscriptions: Record<string, any> = {};
  if (Array.isArray(parsed.subscriptions)) {
    for (const sub of parsed.subscriptions) {
      if (sub && typeof sub === "object" && sub.id) {
        subscriptions[sub.id] = sub;
      }
    }
  }

  const delegationGroups: Record<string, any> = {};
  if (Array.isArray(parsed.delegationGroups)) {
    for (const g of parsed.delegationGroups) {
      if (g && typeof g === "object" && g.groupId) {
        delegationGroups[g.groupId] = {
          ...g,
          expectedAgentIds: Array.isArray(g.expectedAgentIds) ? g.expectedAgentIds : [],
          completedAgentIds: Array.isArray(g.completedAgentIds) ? g.completedAgentIds : [],
          deletedAgentIds: Array.isArray(g.deletedAgentIds) ? g.deletedAgentIds : [],
          events: Array.isArray(g.events) ? g.events : [],
          delivered: !!g.delivered,
        };
      }
    }
  }

  const firedOneShotSubscriptions = Array.isArray(parsed.firedOneShotSubscriptions)
    ? parsed.firedOneShotSubscriptions
    : [];

  const deletedAgents: Record<string, number> = {};
  if (Array.isArray(parsed.deletedAgents)) {
    for (const entry of parsed.deletedAgents) {
      if (entry && typeof entry === "object" && entry.id) {
        deletedAgents[entry.id] = entry.deletedAt ?? Date.now();
      }
    }
  }

  const snapshot = {
    subscriptions,
    agentQueues: {},
    agentStatuses: {},
    delegationGroups,
    firedOneShotSubscriptions,
    deliveryStats: {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      timeoutDeliveries: 0,
      droppedEvents: 0,
      lastDeliveryTime: null,
      lastFailureTime: null,
    },
    deletedAgents,
    version: 0,
  } satisfies WorkspaceSubscriptionState;

  yield* put(setSubscriptionsSnapshot(wsId, snapshot as any));
  yield* put(bumpVersion(wsId));
}

// ---------------------------------------------------------------------------
// Watch state-changing actions → trigger debounced persist
// ---------------------------------------------------------------------------

const PERSIST_TRIGGER_ACTIONS = [
  addSubscription.type,
  removeSubscription.type,
  removeAllSubscriptions.type,
  setDelegationGroup.type,
  removeDelegationGroup.type,
  markDelegationAgentCompleted.type,
  markDelegationAgentDeleted.type,
  markDelegationDelivered.type,
  markOneShotFired.type,
  markAgentDeleted.type,
];

export function* watchStateChangesForPersist() {
  yield* takeEvery(PERSIST_TRIGGER_ACTIONS, function* (action: any) {
    // All these actions have wsId as the first element of payload
    const wsId = action.payload?.[0];
    if (typeof wsId === "string") {
      yield* put(requestPersist(wsId));
    }
  });
}

// ---------------------------------------------------------------------------
// Root persistence saga
// ---------------------------------------------------------------------------

export function* persistenceSaga() {
  // takeLatest on requestPersist → handlePersist has built-in debounce via delay()
  // takeLatest cancels previous handlePersist if a new one arrives within the delay
  yield* takeLatest(requestPersist, handlePersist);
  yield* takeEvery(requestRestore, handleRestore);
  yield* watchStateChangesForPersist();
}