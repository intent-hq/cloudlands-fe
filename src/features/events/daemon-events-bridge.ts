/**
 * Daemon events → renderer Redux bridge.
 *
 * Consumes the daemon's `events.event` JSON-RPC notifications (PROTOCOL §7)
 * and dispatches `workspaceEvents/eventReceived` for the agent-lifecycle
 * subset, so the `agentSession` reducer can faithfully apply BE-canonical
 * status transitions (notably `agent:idle` clearing the optimistic
 * `isStreaming`/`isProcessing`/`isResponding` flags set by `chatSendStarted`).
 *
 * Without this wire the `chat-send-service` optimistic flags stay true forever
 * (the FE refetch path goes through `bulkUpsertSessions` which preserves
 * explicit runtime flags), leaving the "Thinking" spinner stuck even after the
 * BE emits `agent:idle`. This bridge does not transform or heal the payload —
 * it forwards the wire event verbatim to the canonical reducer.
 *
 * Dependency-light: registers a one-shot subscription on first dispatch and a
 * single notification listener; both are cleaned up if the host store
 * disposes. The `appClient.events.subscribe(["agent:*"])` call piggybacks on
 * the existing live transport.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { store as appStore } from "$store/renderer/store";
import { eventReceived } from "$store/renderer/slices/workspace-events/workspace-events-slice";
import {
  backendRequest,
  onBackendNotification,
} from "$lib/client/live/backend-transport";
import type { WorkspaceEvent } from "$features/events/types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("DaemonEventsBridge");

/** Event types the agent-session reducer reacts to via `eventReceived`. */
const AGENT_LIFECYCLE_TYPES = new Set([
  "agent:idle",
  "agent:failed",
  "agent:session-completed",
  "agent:status-changed",
  "agent:session-updated",
  "agent:user-message:sent",
  "agent:message",
]);

let installed = false;
let cleanup: (() => void) | null = null;

function workspaceIdOf(event: WorkspaceEvent | undefined): string | null {
  if (!event || typeof event !== "object") return null;
  const wsId = (event as { workspaceId?: unknown }).workspaceId;
  if (typeof wsId === "string" && wsId.length > 0) return wsId;
  // PROTOCOL §7 events are workspace-scoped; if a relay strips workspaceId we
  // bail rather than guessing — the reducer will simply not run.
  return null;
}

function extractEvent(params: unknown): WorkspaceEvent | null {
  if (!params || typeof params !== "object") return null;
  // The daemon wraps each domain event in `{ event, subscriptionId? }` per the
  // notification envelope; older paths may send the event flat as `params`.
  const wrapped = (params as { event?: unknown }).event;
  if (wrapped && typeof wrapped === "object") return wrapped as WorkspaceEvent;
  return params as WorkspaceEvent;
}

function handleNotification(method: string, params: unknown): void {
  if (method !== "events.event") return;
  const event = extractEvent(params);
  if (!event || typeof event !== "object") return;
  const type = (event as { type?: unknown }).type;
  if (typeof type !== "string" || !AGENT_LIFECYCLE_TYPES.has(type)) return;
  const workspaceId = workspaceIdOf(event);
  if (!workspaceId) return;
  appStore.dispatch(eventReceived(workspaceId, event));
}

async function installSubscriptionOnce(): Promise<void> {
  if (installed) return;
  installed = true;

  const off = onBackendNotification((n) => {
    try {
      handleNotification(n.method, n.params);
    } catch (error) {
      logger.error("daemon-events-bridge notification handler threw", error);
    }
  });

  // Ask the daemon to firehose `agent:*` events to this socket. The
  // subscription id is owned by the bridge (no consumer needs it); refetch
  // delta-subscriptions in `live-agents-client` register their own.
  try {
    const result = (await backendRequest("events.subscribe", {
      eventTypes: ["agent:*"],
    })) as { subscriptionId?: string } | undefined;
    if (!result?.subscriptionId) {
      logger.warn("events.subscribe returned no subscriptionId", result);
    }
  } catch (error) {
    logger.error("events.subscribe(agent:*) failed", error);
  }

  cleanup = () => {
    try {
      off();
    } catch (error) {
      logger.error("backend notification off() threw", error);
    }
  };
}

/**
 * Lazily install the bridge on the first dispatched action so the renderer
 * store is fully constructed before we touch `appClient`/`appStore`. Calling
 * the middleware factory does not perform any I/O.
 */
export function createDaemonEventsBridgeMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    if (!installed) void installSubscriptionOnce();
    return next(action);
  };
}

/** Test-only — tear down the singleton subscription. */
export function __resetDaemonEventsBridgeForTests(): void {
  if (cleanup) cleanup();
  cleanup = null;
  installed = false;
}
