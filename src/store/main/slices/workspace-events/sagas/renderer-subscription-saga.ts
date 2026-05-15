/**
 * Renderer subscription delivery saga.
 *
 * Watches `workspaceEventAccepted` and delivers matching events to renderer
 * subscriptions via `deliverEventToSubscriptions`.
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
}

// ---------------------------------------------------------------------------
// Root renderer subscription saga
// ---------------------------------------------------------------------------

export function* rendererSubscriptionSaga() {
  yield* takeEvery(workspaceEventAccepted, handleDeliverToRendererSubscriptions);
}

