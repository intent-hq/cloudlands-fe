/**
 * Broadcast saga for workspace events.
 *
 * On `workspaceEventAccepted`, broadcasts to:
 * 1. Renderer windows via IPC (`events:new` channel) — workspace-targeted when possible
 * 2. Browser-mode IPC WebSocket clients via `sendToWorkspaceWindows`'s named adapter
 * 3. STDIO connection for MCP clients
 *
 * This saga owns unfiltered accepted-event broadcast transports. Filtered
 * renderer/WebSocket subscriptions are owned by `renderer-subscription-saga`.
 *
 * Uses dynamic imports to keep Electron deps out of test bundles.
 */

import {
  call,
  takeEvery,
} from "typed-redux-saga";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import { workspaceEventAccepted } from "../workspace-events-slice";

// ---------------------------------------------------------------------------
// Global broadcast event types
// ---------------------------------------------------------------------------

/**
 * Event types that are safe to broadcast globally only when the accepted event
 * has no workspaceId. When a workspaceId is present, these are workspace-targeted
 * like any other workspace event so unrelated renderer windows do not churn.
 */
const PAYLOAD_LIGHT_GLOBAL_FALLBACK_EVENT_TYPES = new Set([
  "agent:subscribed",
  "agent:unsubscribed",
  "agent:subscriptions-changed",
  "agent:status-changed",
]);

// ---------------------------------------------------------------------------
// IPC broadcast — workspace-scoped window targeting
// ---------------------------------------------------------------------------

/**
 * Broadcast an event to renderer windows viewing the event's workspace
 * and to the STDIO connection (for MCP clients).
 *
 * All events flow through Redux sagas; renderer broadcast uses IPC.
 */
export async function broadcastEvent(event: WorkspaceEvent): Promise<void> {
  // Dynamic import to avoid Electron deps in test bundles
  const { sendToWorkspaceWindows } = await import(
    "../../../../../features/system/main/system.ipc"
  );

  // Subscription/status events are payload-light enough to remain global only
  // when the event itself has no workspace scope. If workspaceId is present,
  // route to interested workspace windows instead of relying on renderer-side
  // filtering in every window.
  const isGlobalFallback =
    !event.workspaceId && PAYLOAD_LIGHT_GLOBAL_FALLBACK_EVENT_TYPES.has(event.type);
  const targetWorkspaceId = isGlobalFallback ? undefined : event.workspaceId;

  // Send on 'events:new' channel (used by ActivityTimeline and other UI components)
  sendToWorkspaceWindows(targetWorkspaceId, "events:new", {
    workspaceId: event.workspaceId,
    event,
  });

  // Skip specific-channel IPC broadcast for note events — the domain event
  // saga (note-events-saga.ts) already broadcasts these via IPC.
  // We still broadcast on 'events:new' (above) for ActivityTimeline,
  // and the WebSocket/STDIO delivery happens through renderer-subscription-saga.
  const DOMAIN_EVENT_IPC_CHANNELS = new Set(['note:created', 'note:updated', 'note:deleted']);
  if (!DOMAIN_EVENT_IPC_CHANNELS.has(event.type)) {
    // Send on the specific event type channel for backwards compatibility.
    // Browser-mode clients receive this through `sendToWorkspaceWindows`'s
    // browser IPC adapter; do not call that adapter directly here or the same
    // accepted event would be delivered twice on the same channel.
    sendToWorkspaceWindows(targetWorkspaceId, event.type, event);
  }

  // Broadcast to STDIO for MCP clients
  await broadcastToStdio(event);
}

/**
 * Broadcast event to STDIO connection (if active) for MCP clients.
 *
 * Uses the dedicated STDIO stream set via setWorkspaceStdioConnection().
 * Follows the same pattern as broadcastDomainEventToStdio in domain-event-broadcast.ts.
 */
export async function broadcastToStdio(event: WorkspaceEvent): Promise<void> {
  try {
    const { getStdioConnection } = await import(
      "../../../../../features/events/main/stdio-connection"
    );
    const stdio = getStdioConnection();
    if (stdio && !stdio.destroyed) {
      const message = `${JSON.stringify({
        type: "event",
        event: event.type,
        data: event,
      })}\n`;
      stdio.write(message);
    }
  } catch {
    // STDIO may not be available — ignore silently
  }
}

// ---------------------------------------------------------------------------
// Saga handlers
// ---------------------------------------------------------------------------

export function* handleBroadcastEvent(action: ReturnType<typeof workspaceEventAccepted>) {
  const [event] = action.payload;
  yield* call(broadcastEvent, event);
}

// ---------------------------------------------------------------------------
// Root broadcast saga
// ---------------------------------------------------------------------------

export function* workspaceEventsBroadcastSaga() {
  yield* takeEvery(workspaceEventAccepted, handleBroadcastEvent);
}

