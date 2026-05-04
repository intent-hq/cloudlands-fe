/**
 * Subscriptions-changed emitter saga.
 *
 * Watches a composite per-workspace signature of the agent-subscriptions slice
 * and emits `agent:subscriptions-changed` whenever that signature changes.
 *
 * Excluded from the signature (no emission on these changes):
 *  - `agentQueues` (`enqueueEvent`, `clearAgentQueue`)
 *  - `delegationGroups[*].events` (`appendDelegationGroupEvent`)
 *  - Workspace removal (`clearWorkspace`) — lifecycle, not a subscription change.
 */

import { call, cancel, delay, fork, take } from "typed-redux-saga";
import type { Task } from "redux-saga";
import { deepEqual, shallowEqual } from "fast-equals";

import {
  selectAllWorkspaceIds,
  selectSubscriptionsSignature,
  type SubscriptionsSignature,
} from "../agent-subscriptions-selectors";
import { createChannelFromSelector } from "../../../utils/selector-channel-effects";
import { dispatchWorkspaceEvent } from "./ipc-bridge-saga";

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

/** Per-workspace monotonically increasing version counter. */
const subscriptionVersionCounters = new Map<string, number>();

/** Test-only reset hook. */
export function __resetSubscriptionVersionCountersForTests(): void {
  subscriptionVersionCounters.clear();
}

const SYSTEM_ACTOR = {
  type: "system" as const,
  id: "subscription-service",
  name: "Subscription Service",
};

// ---------------------------------------------------------------------------
// Per-workspace worker
// ---------------------------------------------------------------------------

function* emitSubscriptionsChanged(wsId: string) {
  const next = (subscriptionVersionCounters.get(wsId) ?? 0) + 1;
  subscriptionVersionCounters.set(wsId, next);
  yield* call(
    dispatchWorkspaceEvent,
    "agent:subscriptions-changed",
    wsId,
    SYSTEM_ACTOR,
    { subscriptionVersion: next, reason: "subscriptions-updated" },
  );
}

export function* workspaceSignatureWorker(wsId: string) {
  const channel = createChannelFromSelector(
    selectSubscriptionsSignature,
    { isEqual: deepEqual },
    wsId,
  );
  try {
    // The channel's factory runs `compute()` synchronously at creation time
    // and its initial emission is dropped (zero-buffer event channel with no
    // taker yet). Emit the initial signature explicitly so workers forked by
    // the lifecycle watcher produce one event for the workspace that just
    // appeared, matching the semantics of subsequent changes.
    const initial: SubscriptionsSignature | null = yield* selectSubscriptionsSignature.effect(wsId);
    if (initial !== null) {
      yield* emitSubscriptionsChanged(wsId);
    }
    while (true) {
      yield* take(channel);
      // Coalesce bursts of synchronous dispatches into a single emission:
      // `delay(0)` yields control so any more dispatches in the current tick
      // are collapsed into the channel (later ones overwrite earlier payloads
      // via the `isEqual` check in `createChannelFromSelector`). We then read
      // the latest signature directly from the store rather than draining
      // the channel, because the zero-buffer event channel used by
      // `createChannelFromSelector` does not support `flush`.
      yield* delay(0);
      const latest: SubscriptionsSignature | null = yield* selectSubscriptionsSignature.effect(wsId);
      if (latest === null) continue;
      yield* emitSubscriptionsChanged(wsId);
    }
  } finally {
    channel.close();
  }
}

// ---------------------------------------------------------------------------
// Root saga — watches workspace lifecycle and fans out per-workspace workers
// ---------------------------------------------------------------------------

export function* subscriptionsChangedEmitterSaga() {
  const channel = createChannelFromSelector(
    selectAllWorkspaceIds,
    { isEqual: shallowEqual },
  );
  const workers = new Map<string, Task>();
  try {
    // `createChannelFromSelector` runs `compute()` synchronously at creation
    // time and its initial emission is dropped (zero-buffer event channel with
    // no taker yet). Explicitly fork workers for any workspace ids already
    // present in the slice before entering the subsequent-changes loop so the
    // saga does not miss workspaces that existed when it started.
    const initialIds = yield* selectAllWorkspaceIds.effect();
    for (const wsId of initialIds) {
      const task = yield* fork(workspaceSignatureWorker, wsId);
      workers.set(wsId, task);
    }
    while (true) {
      const { payload: ids } = yield* take(channel);
      const currentSet = new Set(ids);
      for (const [wsId, task] of Array.from(workers.entries())) {
        if (!currentSet.has(wsId)) {
          yield* cancel(task);
          workers.delete(wsId);
          subscriptionVersionCounters.delete(wsId);
        }
      }
      for (const wsId of ids) {
        if (!workers.has(wsId)) {
          const task = yield* fork(workspaceSignatureWorker, wsId);
          workers.set(wsId, task);
        }
      }
    }
  } finally {
    channel.close();
    for (const task of workers.values()) {
      yield* cancel(task);
    }
  }
}

