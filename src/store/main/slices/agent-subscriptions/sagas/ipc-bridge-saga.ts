/**
 * IPC Bridge Saga — emits workspace events via Redux dispatch.
 *
 * Watches Redux actions (addSubscription, subscribeToDelegationGroup) and
 * emits the matching IPC events:
 *
 * - `agent:subscribed` on addSubscription / subscribeToDelegationGroup
 *
 * Events are dispatched through Redux (emitWorkspaceEvent action) which handles
 * persistence and broadcast to renderer windows via sagas.
 */

import { call, takeEvery } from "typed-redux-saga";
import {
  addSubscription,
  subscribeToDelegationGroup,
} from "../agent-subscriptions-slice";
import {
  selectWorkspaceSubscriptionState,
} from "../agent-subscriptions-selectors";

// ---------------------------------------------------------------------------
// External service wrappers (called via `call()` for testability)
// ---------------------------------------------------------------------------

/**
 * Dispatch a workspace event via Redux.
 * Uses dynamic import to avoid pulling Electron deps into test bundles.
 */
export async function dispatchWorkspaceEvent(
  type: string,
  workspaceId: string,
  actor: { type: string; id?: string; name?: string },
  data?: Record<string, unknown>,
): Promise<void> {
  const { createWorkspaceEvent } = await import(
    "../../../../../features/events/types"
  );
  const { mainDispatch } = await import(
    "../../../redux-store-bridge"
  );
  const { emitWorkspaceEvent: reduxEmitWorkspaceEvent } = await import(
    "../../workspace-events/workspace-events-slice"
  );
  mainDispatch(reduxEmitWorkspaceEvent(createWorkspaceEvent(type as any, workspaceId, actor as any, data)));
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * On addSubscription → emit `agent:subscribed`.
 * Mirrors emitSubscriptionEvent() from the old service.
 */
function* handleAddSubscription(action: ReturnType<typeof addSubscription>) {
  const [wsId, record] = action.payload;
  const filter = record.filter;

  // Build the same filterDescription the old service produced
  const parts: string[] = [];
  if (filter.eventTypes?.length) parts.push(`types: ${filter.eventTypes.join(", ")}`);
  if (filter.actorIds?.length) parts.push(`watching: ${filter.actorIds.join(", ")}`);
  if (filter.actorTypes?.length) parts.push(`actors: ${filter.actorTypes.join(", ")}`);
  if (filter.excludeActorIds?.length) parts.push(`excluding: ${filter.excludeActorIds.length} actors`);
  const desc = parts.length > 0 ? parts.join("; ") : "all events";

  yield* call(dispatchWorkspaceEvent, "agent:subscribed", wsId, {
    type: "agent",
    id: record.agentId,
    name: record.agentName,
  }, {
    agentId: record.agentId,
    agentName: record.agentName,
    subscriptionId: record.id,
    eventTypes: filter.eventTypes || [],
    filterDescription: desc,
  });
}

/**
 * On subscribeToDelegationGroup → emit `agent:subscribed` only when the
 * reducer actually CREATED a new subscription using the caller's seed
 * record. If the reducer instead extended an existing subscription for the
 * same `(parentAgentId, groupId)`, the canonical subscription id differs
 * from `seed.id` and no new subscription exists at `seed.id`.
 */
export function* handleSubscribeToDelegationGroup(
  action: ReturnType<typeof subscribeToDelegationGroup>,
) {
  const [wsId, seed] = action.payload;
  const ws = yield* selectWorkspaceSubscriptionState.effect(wsId);
  const created = ws.subscriptions[seed.id];
  if (!created) return;

  const filter = created.filter;
  const parts: string[] = [];
  if (filter.eventTypes?.length) parts.push(`types: ${filter.eventTypes.join(", ")}`);
  if (filter.actorIds?.length) parts.push(`watching: ${filter.actorIds.join(", ")}`);
  if (filter.actorTypes?.length) parts.push(`actors: ${filter.actorTypes.join(", ")}`);
  if (filter.excludeActorIds?.length) parts.push(`excluding: ${filter.excludeActorIds.length} actors`);
  const desc = parts.length > 0 ? parts.join("; ") : "all events";

  yield* call(dispatchWorkspaceEvent, "agent:subscribed", wsId, {
    type: "agent",
    id: created.agentId,
    name: created.agentName,
  }, {
    agentId: created.agentId,
    agentName: created.agentName,
    subscriptionId: created.id,
    eventTypes: filter.eventTypes || [],
    filterDescription: desc,
  });
}

/**
 * On removeSubscription → emit `agent:unsubscribed`.
 * Mirrors emitUnsubscriptionEvent() from the old service.
 *
 * We need the subscription record to know the agentId/agentName, but by the
 * time the saga runs the reducer has already removed it. So we use
 * `actionCreatorMiddleware` pattern: the action payload only has the
 * subscriptionId. We solve this by selecting state BEFORE the reducer runs
 * via a custom approach — actually, takeEvery runs after the reducer, so we
 * cannot read the removed record from state.
 *
 * Solution: we store the record in the action payload via a new wrapper, OR
 * we rely on the service to pass the record. Looking at the service code,
 * the service calls `removeSubscription` then `emitUnsubscriptionEvent` with
 * the data it already has. Since we're replacing the service's emit, we need
 * the data available.
 *
 * For now we accept that the record is gone from state and emit a minimal
 * event. The renderer only uses agentId from the event to decide whether to
 * reload subscriptions — and the agentId is not in the removeSubscription
 * action payload. This means we CANNOT fully replicate the old event without
 * changing the action shape.
 *
 * PRAGMATIC FIX: The service still calls emitUnsubscriptionEvent() directly
 * (it has the record in scope). This saga is an ADDITIONAL safety net for
 * any removeSubscription dispatches that bypass the service. We emit what we
 * can.
 */
// handleRemoveSubscription is intentionally omitted — the service already
// emits agent:unsubscribed directly with the full record data (agentId,
// agentName, reason, groupId) that is not available from the action payload
// alone. Adding a duplicate emission here would cause double-delivery.

// ---------------------------------------------------------------------------
// Root IPC bridge saga
// ---------------------------------------------------------------------------

export function* ipcBridgeSaga() {
  yield* takeEvery(addSubscription, handleAddSubscription);
  yield* takeEvery(subscribeToDelegationGroup, handleSubscribeToDelegationGroup);
}

