/**
 * Agent IPC bridge — routes legacy renderer→main agent channels to the live
 * intentd daemon over the existing `backend.request` transport.
 *
 * Without these bridges the channels fell through the mock router's `undefined`
 * default (this build has no real Electron main-process handlers), so:
 *  - `agent:create` (via `typedInvoke` in `UnifiedAgentFactory`) failed with
 *    `Invalid response format from IPC handler` — the validator rejects a
 *    non-`IpcResponse` envelope (spec iter#10).
 *  - `agent:backend:stream-message` (via the chat-send lifecycle) silently
 *    returned undefined → every Send became a no-op.
 *  - `agent:backend:queue-message` / `…edit-queued` / `…remove-queued` /
 *    `…force-message` / `…get-queue` (via `unifiedOrchestrator.*`) silently
 *    returned `{success:false}` from `unwrapIpcResponse` (spec iter#2 + #2b).
 *
 * Per the integration principle BE = source of truth: each handler forwards
 * to the canonical daemon RPC (`agent.create` / `agent.sendMessage` /
 * `agent.queueMessage` / `agent.editQueuedMessage` /
 * `agent.removeQueuedMessage` / `agent.forceMessage` / `agent.getQueue`,
 * PROTOCOL.md §5.5) and only wraps the raw daemon response in the envelope
 * the call site expects, never synthesizing data.
 *
 * Handlers are registered at import time (mirroring the workspaces-seeder
 * `workspace:open` idiom) so the first click → `+` → Coordinator → create
 * resolves before any component mounts.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { AGENT_CHANNELS, AGENT_BACKEND_CHANNELS } from "$shared/ipc/channels";
import { backendRequest } from "$lib/client/live/backend-transport";
import { newIdempotencyKey } from "$lib/client/live/live-support";

/** Coerce a possibly-unknown argument into a plain object record. */
function asRecord(arg: unknown): Record<string, unknown> {
  return arg && typeof arg === "object" ? (arg as Record<string, unknown>) : {};
}

/** Best-effort string read for an optional field. */
function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Forward a request to the daemon and wrap the response in the
 * `{success:true, data: <daemonBody>}` envelope `unifiedOrchestrator`'s
 * `unwrapIpcResponse` expects (returns `result.data` only when both
 * `result.success` AND `result.data` are truthy — so we must always populate
 * `data` even when the daemon body itself is just `{success:true}`).
 *
 * Errors surface as `{success:false, error:{message}}` so the orchestrator's
 * unwrap falls through to its error branch and returns
 * `{success:false, error:<message>}` to the caller.
 */
async function forwardToOrchestrator(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  try {
    const result = await backendRequest<Record<string, unknown>>(method, params);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}

/**
 * `agent:create` → daemon `agent.create` (PROTOCOL §5.5).
 *
 * The FE's `CreateRequest` carries more fields than `agent.create` accepts;
 * we forward only the parameters the daemon router consumes (`workspaceId`,
 * `name`, `model`, `specialistId`, `agentId`, `idempotencyKey`). The
 * `specialist` value lives under `metadata.specialist` (set by the specialist
 * picker in `agent-creation-service.ts`) — surface it as the daemon's
 * `specialistId`. The FE-minted `agentId` is forwarded verbatim so the daemon
 * adopts the same id: the follow-up `agent.sendMessage` (queued right after
 * the create) then targets a persisted session instead of racing to `-32602
 * not found: agent session`.
 *
 * Response envelope: `UnifiedAgentFactory.createInBackend` reads
 * `result.success` (typedInvoke wraps everything in `IpcResponse<T>`), so we
 * return `{ success: true, data: { agent, sessionId } }` with the daemon's
 * raw `agent` object passed through. The renderer constructs its own
 * `AgentSession` from the request — only success matters here.
 */
registerMockIpcHandler(AGENT_CHANNELS.CREATE, async (arg) => {
  const request = asRecord(arg);
  const workspaceId = readString(request, "workspaceId");
  if (!workspaceId) {
    return {
      success: false,
      error: { code: "INVALID_REQUEST", message: "workspaceId is required" },
    };
  }
  const metadata = asRecord(request.metadata);
  const params: Record<string, unknown> = {
    workspaceId,
    name: readString(request, "name"),
    model: readString(request, "model"),
    specialistId: readString(metadata, "specialist"),
    idempotencyKey: newIdempotencyKey(),
  };
  const clientAgentId = readString(request, "agentId");
  if (clientAgentId) {
    params.agentId = clientAgentId;
  }
  try {
    const result = await backendRequest<{ agent?: unknown }>("agent.create", params);
    return {
      success: true,
      data: {
        agent: (result as { agent?: unknown })?.agent,
        sessionId: readString(request, "agentId"),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "BACKEND_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
});

/**
 * `agent:backend:stream-message` → daemon `agent.sendMessage` (PROTOCOL §5.5).
 *
 * The renderer's send-message call sites check `'success' in response &&
 * !response.success`, so the daemon's `{ success, queued, messageId }` is
 * forwarded directly without an outer envelope. Auto-queue (when the daemon
 * reports the turn in-flight) surfaces via `queued: true` and is honored by
 * the FE without any further intervention here.
 */
registerMockIpcHandler(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, async (arg) => {
  const request = asRecord(arg);
  const agentId = readString(request, "agentId");
  const workspaceId = readString(request, "workspaceId");
  const content = typeof request.content === "string" ? (request.content as string) : "";
  if (!agentId || !workspaceId) {
    return { success: false, error: "agentId and workspaceId are required" };
  }
  const params: Record<string, unknown> = { agentId, workspaceId, content };
  const messageId = readString(request, "messageId");
  if (messageId) params.messageId = messageId;
  if (Array.isArray(request.imageBlocks)) params.imageBlocks = request.imageBlocks;
  try {
    return await backendRequest("agent.sendMessage", params);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

/**
 * `agent:backend:queue-message` → daemon `agent.queueMessage` (PROTOCOL §5.5).
 *
 * Daemon returns `{ success: true, queuedMessage }` where QueuedMessage =
 * `{ id, content, queuedAt, position, imageBlocks? }`. Wrapped in
 * `{success:true, data:<daemonBody>}` so the orchestrator's
 * `unwrapIpcResponse` folds back to the original `QueueOperationResult`.
 */
registerMockIpcHandler(AGENT_BACKEND_CHANNELS.QUEUE_MESSAGE, async (arg) => {
  const request = asRecord(arg);
  const agentId = readString(request, "agentId");
  const content = typeof request.content === "string" ? (request.content as string) : "";
  if (!agentId) {
    return { success: false, error: { message: "agentId is required" } };
  }
  const params: Record<string, unknown> = { agentId, content };
  if (Array.isArray(request.imageBlocks)) params.imageBlocks = request.imageBlocks;
  return forwardToOrchestrator("agent.queueMessage", params);
});

/**
 * `agent:backend:edit-queued` → daemon `agent.editQueuedMessage`
 * (PROTOCOL §5.5: `{ agentId, messageId, content }` →
 * `{ success, queuedMessage }`). Wrapped for orchestrator unwrap; the
 * QueuedMessage round-trip is what the ChatPanel queued-message UI binds to.
 */
registerMockIpcHandler(AGENT_BACKEND_CHANNELS.EDIT_QUEUED, async (arg) => {
  const request = asRecord(arg);
  const agentId = readString(request, "agentId");
  const messageId = readString(request, "messageId");
  const content = typeof request.content === "string" ? (request.content as string) : "";
  if (!agentId || !messageId) {
    return {
      success: false,
      error: { message: "agentId and messageId are required" },
    };
  }
  return forwardToOrchestrator("agent.editQueuedMessage", { agentId, messageId, content });
});

/**
 * `agent:backend:remove-queued` → daemon `agent.removeQueuedMessage`
 * (PROTOCOL §5.5: `{ agentId, messageId }` → service result `{ success }`).
 * Wrapped for orchestrator unwrap so a bare `{success:true}` daemon body
 * still passes `result.success && result.data` and yields `{success:true}`
 * back to the saga.
 */
registerMockIpcHandler(AGENT_BACKEND_CHANNELS.REMOVE_QUEUED, async (arg) => {
  const request = asRecord(arg);
  const agentId = readString(request, "agentId");
  const messageId = readString(request, "messageId");
  if (!agentId || !messageId) {
    return {
      success: false,
      error: { message: "agentId and messageId are required" },
    };
  }
  return forwardToOrchestrator("agent.removeQueuedMessage", { agentId, messageId });
});

/**
 * `agent:backend:force-message` → daemon `agent.forceMessage` (PROTOCOL §5.5:
 * `{ agentId, messageId, content, workspaceId, imageBlocks?, noteIds? }` →
 * service result; stops the current stream first). Forwards optional
 * `imageBlocks` / `noteIds` only when arrays are supplied.
 */
registerMockIpcHandler(AGENT_BACKEND_CHANNELS.FORCE_MESSAGE, async (arg) => {
  const request = asRecord(arg);
  const agentId = readString(request, "agentId");
  const messageId = readString(request, "messageId");
  const workspaceId = readString(request, "workspaceId");
  const content = typeof request.content === "string" ? (request.content as string) : "";
  if (!agentId || !messageId || !workspaceId) {
    return {
      success: false,
      error: { message: "agentId, messageId and workspaceId are required" },
    };
  }
  const params: Record<string, unknown> = { agentId, messageId, content, workspaceId };
  if (Array.isArray(request.imageBlocks)) params.imageBlocks = request.imageBlocks;
  if (Array.isArray(request.noteIds)) params.noteIds = request.noteIds;
  return forwardToOrchestrator("agent.forceMessage", params);
});

/**
 * `agent:backend:get-queue` → daemon `agent.getQueue` (PROTOCOL §5.5:
 * `{ agentId }` → `{ success, queue: QueuedMessage[] }`). The orchestrator
 * proxy's `getQueue` accepts both wrapped (`{success,data}`) and unwrapped
 * (`{success,queue}`) shapes; we use the wrapped form for consistency with
 * the other queue bridges.
 */
registerMockIpcHandler(AGENT_BACKEND_CHANNELS.GET_QUEUE, async (arg) => {
  const request = asRecord(arg);
  const agentId = readString(request, "agentId");
  if (!agentId) {
    return { success: false, error: { message: "agentId is required" } };
  }
  return forwardToOrchestrator("agent.getQueue", { agentId });
});

/**
 * `agent:set-model` → daemon `agent.setModel` (PROTOCOL §5.5:
 * `{ agentId, modelId, workspaceId }` → `{ success, modelId }`, emits
 * `agent:updated`). The caller is `agentClient.setModel` (ModelPicker), which
 * expects a `CommandResponse` envelope — `{ success: true, data: <daemonBody> }`
 * on success, `{ success: false, error: <string> }` on failure. Without this
 * bridge the channel fell through the mock router's `undefined` default and
 * `commandResponseToResult` threw
 * "Cannot read properties of undefined (reading 'success')" on every model
 * change for daemon-created agents.
 */
registerMockIpcHandler(AGENT_CHANNELS.SET_MODEL, async (arg) => {
  const request = asRecord(arg);
  const agentId = readString(request, "agentId");
  const modelId = readString(request, "modelId");
  const workspaceId = readString(request, "workspaceId");
  if (!agentId || !modelId || !workspaceId) {
    return { success: false, error: "agentId, modelId and workspaceId are required" };
  }
  try {
    const result = await backendRequest("agent.setModel", { agentId, modelId, workspaceId });
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});
