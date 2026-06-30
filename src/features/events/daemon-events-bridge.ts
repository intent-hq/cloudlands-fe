/**
 * Daemon events → renderer Redux bridge.
 *
 * Consumes the daemon's `events.event` JSON-RPC notifications (PROTOCOL §7)
 * and dispatches two families of actions:
 *
 *   1. `workspaceEvents/eventReceived` for the agent-lifecycle subset, so the
 *      `agentSession` reducer can faithfully apply BE-canonical status
 *      transitions (notably `agent:idle` clearing the optimistic
 *      `isStreaming`/`isProcessing`/`isResponding` flags set by
 *      `chatSendStarted`).
 *   2. `workspaceAgents/agentStreamUpdateReceived` for the live stream subset
 *      (`agent:stream:chunk`, `agent:tool:call`, `agent:stream:end`,
 *      `agent:failed`), so the `agent-stream-service` middleware grows the
 *      in-flight assistant message live and finalizes it in place. Without
 *      this wire the assistant reply only appears after a manual refresh
 *      (the chat-read-service hydration via `agents.getConversation`).
 *
 * The stream family is accumulated per agent (one in-flight assistant per
 * agent) using the BE's monotonic `blockIndex` so the candidate transcript
 * always grows and the renderer's regression guard
 * (`resolveStreamContentBlocks`) accepts each update. Cleanup runs on
 * `agent:stream:end` / `agent:failed` so a subsequent prompt turn starts from
 * a clean slate. Dedup on hydration is preserved by carrying the BE-canonical
 * `messageId` as `assistantMessageId` so the in-flight message id matches the
 * one `agents.getConversation` returns later.
 *
 * Dependency-light: registers a one-shot subscription on first dispatch and a
 * single notification listener; both are cleaned up if the host store
 * disposes. The `appClient.events.subscribe(["agent:*"])` call piggybacks on
 * the existing live transport.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import type { ContentBlock } from "$shared/types";
import { store as appStore } from "$store/renderer/store";
import { eventReceived } from "$store/renderer/slices/workspace-events/workspace-events-slice";
import { agentStreamUpdateReceived } from "$store/renderer/slices/workspace-agents/workspace-agents-stream-slice";
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

/**
 * Per-agent in-flight stream accumulator. The BE assigns each block a
 * monotonic `blockIndex` (see `crates/intent-services/src/agent_session.rs`
 * `Transcript`); we mirror that order on the FE so the candidate transcript
 * monotonically grows and never regresses. `toolResultsByUseIndex` holds the
 * synthesized `tool_result` block (the BE pushes one of its own, but only
 * exposes the *use* index on `agent:tool:call`), so it is rendered immediately
 * after its tool_use in `buildContentBlocks`.
 */
interface StreamState {
  messageId: string;
  workspaceId: string;
  blocksByIndex: Map<number, ContentBlock>;
  toolResultsByUseIndex: Map<number, ContentBlock>;
}

const streamsByAgent = new Map<string, StreamState>();
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

function ensureStream(
  agentId: string,
  messageId: string,
  workspaceId: string,
): StreamState {
  const existing = streamsByAgent.get(agentId);
  if (existing && existing.messageId === messageId) return existing;
  const fresh: StreamState = {
    messageId,
    workspaceId,
    blocksByIndex: new Map(),
    toolResultsByUseIndex: new Map(),
  };
  streamsByAgent.set(agentId, fresh);
  return fresh;
}

function buildContentBlocks(state: StreamState): ContentBlock[] {
  const sortedKeys = [...state.blocksByIndex.keys()].sort((a, b) => a - b);
  const result: ContentBlock[] = [];
  for (const key of sortedKeys) {
    result.push(state.blocksByIndex.get(key)!);
    const toolResult = state.toolResultsByUseIndex.get(key);
    if (toolResult) result.push(toolResult);
  }
  return result;
}

function dispatchStreamUpdate(
  agentId: string,
  state: StreamState,
  eventType: "chunk" | "content-blocks" | "complete" | "error",
): void {
  appStore.dispatch(
    agentStreamUpdateReceived({
      workspaceId: state.workspaceId,
      agentId,
      handlerSessionId: agentId,
      source: "sendMessage",
      eventType,
      assistantMessageId: state.messageId,
      contentBlocks: buildContentBlocks(state),
    }),
  );
}

function handleStreamChunkEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const messageId = data.messageId;
  const blockIndex = data.blockIndex;
  const blockId = data.blockId;
  const blockType = data.blockType;
  const content = data.content;
  if (
    typeof agentId !== "string" ||
    typeof messageId !== "string" ||
    typeof blockIndex !== "number"
  ) {
    return;
  }
  const state = ensureStream(agentId, messageId, workspaceId);

  if (blockType === "text" && typeof content === "string") {
    const prior = state.blocksByIndex.get(blockIndex);
    const priorText =
      prior && prior.type === "text" ? (prior.text ?? prior.content ?? "") : "";
    const next: ContentBlock = {
      type: "text",
      ...(typeof blockId === "string" ? { id: blockId } : {}),
      text: priorText + content,
    };
    state.blocksByIndex.set(blockIndex, next);
  } else if (content && typeof content === "object") {
    state.blocksByIndex.set(blockIndex, content as ContentBlock);
  } else {
    return;
  }

  dispatchStreamUpdate(agentId, state, "chunk");
}

function handleToolCallEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const messageId = data.messageId;
  const blockIndex = data.blockIndex;
  const blockId = data.blockId;
  const toolCallId = data.toolCallId;
  const toolName = data.toolName;
  const toolKind = data.toolKind;
  const status = data.status;
  const input = data.input;
  const output = data.output;
  if (
    typeof agentId !== "string" ||
    typeof messageId !== "string" ||
    typeof blockIndex !== "number" ||
    typeof toolCallId !== "string"
  ) {
    return;
  }
  const state = ensureStream(agentId, messageId, workspaceId);

  const toolUseBlock: ContentBlock = {
    type: "tool_use",
    ...(typeof blockId === "string" ? { id: blockId } : {}),
    name: typeof toolName === "string" ? toolName : "",
    input: (input as Record<string, unknown> | undefined) ?? undefined,
    toolCallId,
    metadata: {
      ...(typeof toolKind === "string" ? { toolKind } : {}),
      ...(typeof status === "string" ? { status } : {}),
    },
  } as ContentBlock;
  state.blocksByIndex.set(blockIndex, toolUseBlock);

  if ((status === "completed" || status === "error") && output !== undefined) {
    state.toolResultsByUseIndex.set(blockIndex, {
      type: "tool_result",
      tool_use_id: toolCallId,
      output: output as ContentBlock["output"],
      is_error: status === "error",
    } as ContentBlock);
  }

  dispatchStreamUpdate(agentId, state, "content-blocks");
}

function handleStreamEndEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const agentId = data?.agentId;
  if (typeof agentId !== "string") return;
  const state = streamsByAgent.get(agentId);
  if (!state) return;
  dispatchStreamUpdate(agentId, state, "complete");
  streamsByAgent.delete(agentId);
}

function handleAgentFailedStream(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const agentId = data?.agentId;
  if (typeof agentId !== "string") return;
  const state = streamsByAgent.get(agentId);
  if (!state) return;
  dispatchStreamUpdate(agentId, state, "error");
  streamsByAgent.delete(agentId);
}

function handleNotification(method: string, params: unknown): void {
  if (method !== "events.event") return;
  const event = extractEvent(params);
  if (!event || typeof event !== "object") return;
  const type = (event as { type?: unknown }).type;
  if (typeof type !== "string") return;
  const workspaceId = workspaceIdOf(event);
  if (!workspaceId) return;

  // Live stream family — accumulate per-agent and grow the in-flight assistant
  // message. `agent:failed` flows through both paths: it finalizes any
  // in-flight stream AND forwards the lifecycle to `eventReceived` so the
  // session status transitions to "failed".
  if (type === "agent:stream:chunk") {
    handleStreamChunkEvent(event, workspaceId);
    return;
  }
  if (type === "agent:tool:call") {
    handleToolCallEvent(event, workspaceId);
    return;
  }
  if (type === "agent:stream:end") {
    handleStreamEndEvent(event);
    return;
  }
  if (type === "agent:failed") {
    handleAgentFailedStream(event);
    // fall through to the lifecycle dispatch below
  }

  if (!AGENT_LIFECYCLE_TYPES.has(type)) return;
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

/** Test-only — tear down the singleton subscription and stream accumulators. */
export function __resetDaemonEventsBridgeForTests(): void {
  if (cleanup) cleanup();
  cleanup = null;
  installed = false;
  streamsByAgent.clear();
}
