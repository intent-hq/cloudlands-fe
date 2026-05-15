/**
 * Broadcast saga for workspace events.
 *
 * On `workspaceEventAccepted`, broadcasts to:
 * 1. Renderer windows via IPC (`events:new` channel) — workspace-scoped or global
 * 2. STDIO connection for MCP clients
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
 * Event types that must be broadcast to ALL windows regardless of workspace
 * routing. The renderer already filters by workspaceId in its event handlers,
 * so global broadcast is safe and avoids multi-window routing issues.
 */
const GLOBAL_BROADCAST_EVENT_TYPES = new Set([
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

  // Subscription-related events broadcast globally (to all windows) so that
  // multi-window setups always receive them. The renderer filters by
  // workspaceId in its own event handlers, preventing cross-workspace leaks.
  const isGlobal = GLOBAL_BROADCAST_EVENT_TYPES.has(event.type);
  const targetWorkspaceId = isGlobal ? undefined : event.workspaceId;

  // Send on 'events:new' channel (used by ActivityTimeline and other UI components)
  sendToWorkspaceWindows(targetWorkspaceId, "events:new", {
    workspaceId: event.workspaceId,
    event,
  });

  // Also send on the specific event type channel for backwards compatibility
  sendToWorkspaceWindows(targetWorkspaceId, event.type, event);

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

