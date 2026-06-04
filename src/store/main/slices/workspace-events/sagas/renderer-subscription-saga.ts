/**
 * Renderer subscription delivery saga.
 *
 * Watches `workspaceEventAccepted` and delivers matching events to filtered
 * subscription transports:
 * 1. renderer subscription IPC (`workspace:event`)
 * 2. external WebSocket API JSON-RPC subscriptions (`events.event`)
 *
 * This saga is the sole downstream owner for filtered subscription delivery;
 * both adapters keep only transport-local runtime subscription maps.
 *
 * Replaces the previous `store.subscribe()` pattern in events.ipc.ts which
 * fired on every Redux action (O(N×M×K) for N subscriptions × M workspaces
 * × K actions/sec). This saga only fires when an event is actually accepted
 * (post-dedup), making performance proportional to unique event rate.
 */

import {
  call,
  takeEvery,
} from "typed-redux-saga";
import { workspaceEventAccepted } from "../workspace-events-slice";

// ---------------------------------------------------------------------------
// Saga handlers
// ---------------------------------------------------------------------------

export function* handleDeliverToRendererSubscriptions(
  action: ReturnType<typeof workspaceEventAccepted>,
) {
  const [event] = action.payload;
  yield* call(async () => {
    const { deliverEventToSubscriptions } = await import(
      "../../../../../features/events/main/renderer-subscription-registry"
    );
    deliverEventToSubscriptions(event);
  });
  // Also deliver to external WebSocket API clients (replaces old UnifiedEventBus callback).
  yield* call(async () => {
    const { deliverEventToWebSocketSubscriptions } = await import(
      "../../../../../main/websocket-event-bridge"
    );
    deliverEventToWebSocketSubscriptions(event);
  });
}

// ---------------------------------------------------------------------------
// Root renderer subscription saga
// ---------------------------------------------------------------------------

export function* rendererSubscriptionSaga() {
  yield* takeEvery(workspaceEventAccepted, handleDeliverToRendererSubscriptions);
}

