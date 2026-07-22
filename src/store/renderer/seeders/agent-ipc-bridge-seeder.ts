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
 *    `…force-message` / `…get-queue` (via the since-retired renderer
 *    `unifiedOrchestrator` proxy) silently returned `{success:false}` from
 *    `unwrapIpcResponse` (spec iter#2 + #2b). ChatPanel now calls
 *    `appClient.agents.*` directly (T3); these bridges remain for any legacy
 *    channel consumers.
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
 * Best-effort plain-object read for an optional record field. Rejects
 * `null`, arrays, and non-object values so we never smuggle a primitive
 * into a JSON-RPC param slot that the daemon expects to be an object.
 */
function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Forward a request to the daemon and wrap the response in the
 * `{success:true, data: <daemonBody>}` envelope legacy `{success,data}`
 * unwrappers expect (they return `result.data` only when both
 * `result.success` AND `result.data` are truthy — so we must always populate
 * `data` even when the daemon body itself is just `{success:true}`).
 *
 * Errors surface as `{success:false, error:{message}}` so the caller's
 * unwrap falls through to its error branch and returns
 * `{success:false, error:<message>}`.
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
 * `name`, `model`, `specialistId`, `idempotencyKey`). The `specialist` value
 * lives under `metadata.specialist` (set by the specialist picker in
 * `agent-creation-service.ts`) — surface it as the daemon's `specialistId`.
 *
 * No `agentId` is forwarded: the daemon assigns the session id and returns it
 * on the response's `agent.id`. Callers must adopt that id for any follow-up
 * `agent.sendMessage` (a follow-up intentd change rejects client-supplied
 * agent ids outright).
 *
 * Response envelope: callers read `result.success` (typedInvoke wraps
 * everything in `IpcResponse<T>`), so we return
 * `{ success: true, data: { agent, sessionId } }` with the daemon's raw
 * `agent` object passed through and `sessionId` echoing the daemon-assigned
 * `agent.id`.
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
  try {
    const result = await backendRequest<{ agent?: unknown }>("agent.create", params);
    const agent = (result as { agent?: unknown })?.agent;
    const sessionId = readString(asRecord(agent), "id");
    if (!sessionId) {
      // The daemon-assigned id is the whole contract now: without it the FE
      // cannot address any follow-up send. Surface a clear backend error
      // instead of a malformed success envelope with sessionId: undefined.
      return {
        success: false,
        error: {
          code: "BACKEND_ERROR",
          message: "agent.create response missing daemon-assigned agent.id",
        },
      };
    }
    return {
      success: true,
      data: { agent, sessionId },
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
 *
 * Forwarded fields (on top of the required agentId/workspaceId/content):
 *   messageId, imageBlocks, fileBlocks, model, messageMetadata,
 *   contextReferences, noteIds, stdinContext,
 *   assistantMessageId, assistantAppMessageId, userAppMessageId, priority.
 *
 * The current daemon `agent.sendMessage` router (packages/intentd/crates/
 * intent-transport/src/router.rs) extracts only the required trio plus
 * `messageId` / `imageBlocks` / `fileBlocks`, so the remaining forwarded
 * fields land in the JSON-RPC params but are silently dropped by the BE
 * today -- a documented daemon-side gap. Forwarding them here removes the
 * FE-side loss and keeps the BE as the single fix site when the router is
 * widened. Producers for the app-ID trio live in
 * `src/features/agent/agent-stream-lifecycle.ts` (userAppMessageId L834,
 * assistantMessageId L863, assistantAppMessageId L864; threaded into the
 * invoke at L1483–1485).
 *
 * Audit-only fields intentionally NOT forwarded (dead surface at the
 * FE→bridge boundary at HEAD; documented so a future producer surfaces
 * the gap explicitly instead of being silently accepted):
 *  - `personality`: declared on `sendMessage`'s option type
 *    (`src/features/agent/agent-stream-lifecycle.ts` L681) and threaded to
 *    the invoke at L1470, but no producer populates it — chat-send-service
 *    (`src/features/agent/chat-send-service.ts` L169–172) only forwards
 *    `imageBlocks` / `noteIds`, and `CodeReviewPanel.svelte:242` only
 *    sets `stdinContext`. `SendMessagePayload`
 *    (`src/store/renderer/slices/chat-state/chat-state-types.ts` L80–100)
 *    has no `personality` field. `@personality` mentions inline their
 *    promptToken into message text via the mentions provider
 *    (`src/lib/services/mentions/providers/index.ts` L351).
 *  - `queuedMessageId`: captured on the Redux `sendMessage` action at
 *    `src/lib/components/chat/ChatPanel.svelte:2248`, but chat-send-service
 *    (`src/features/agent/chat-send-service.ts` L169–172) drops it before
 *    calling the lifecycle send, so it never reaches STREAM_MESSAGE from
 *    the renderer.
 *  - `queuedMessageAppMessageId`: no renderer producer (only main-process
 *    `agent-backend-handler.service.ts` L9503 mints it on the wake path).
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
  if (Array.isArray(request.fileBlocks)) params.fileBlocks = request.fileBlocks;
  const model = readString(request, "model");
  if (model) params.model = model;
  const messageMetadata = readRecord(request, "messageMetadata");
  if (messageMetadata) params.messageMetadata = messageMetadata;
  if (Array.isArray(request.contextReferences)) {
    params.contextReferences = request.contextReferences;
  }
  if (Array.isArray(request.noteIds)) params.noteIds = request.noteIds;
  const stdinContext = readString(request, "stdinContext");
  if (stdinContext) params.stdinContext = stdinContext;
  const assistantMessageId = readString(request, "assistantMessageId");
  if (assistantMessageId) params.assistantMessageId = assistantMessageId;
  const assistantAppMessageId = readString(request, "assistantAppMessageId");
  if (assistantAppMessageId) params.assistantAppMessageId = assistantAppMessageId;
  const userAppMessageId = readString(request, "userAppMessageId");
  if (userAppMessageId) params.userAppMessageId = userAppMessageId;
  const priority = readString(request, "priority");
  if (priority === "interrupt") params.priority = priority;
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
 * `{success:true, data:<daemonBody>}` so legacy `{success,data}` unwrappers
 * fold back to the original queue-operation shape.
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
 * (PROTOCOL §5.5: `{ agentId, messageId, content, editing? }` →
 * `{ success, queuedMessage }`). Wrapped in `{success,data}` for legacy
 * channel consumers (ChatPanel now uses `appClient.agents.editQueued`).
 * STAB-27: editing flag holds the message during edit (daemon skips it in drain).
 */
registerMockIpcHandler(AGENT_BACKEND_CHANNELS.EDIT_QUEUED, async (arg) => {
  const request = asRecord(arg);
  const agentId = readString(request, "agentId");
  const messageId = readString(request, "messageId");
  const content = typeof request.content === "string" ? (request.content as string) : "";
  const editing = typeof request.editing === "boolean" ? request.editing : undefined;
  if (!agentId || !messageId) {
    return {
      success: false,
      error: { message: "agentId and messageId are required" },
    };
  }
  const payload: Record<string, unknown> = { agentId, messageId, content };
  if (editing !== undefined) {
    payload.editing = editing;
  }
  return forwardToOrchestrator("agent.editQueuedMessage", payload);
});

/**
 * `agent:backend:remove-queued` → daemon `agent.removeQueuedMessage`
 * (PROTOCOL §5.5: `{ agentId, messageId }` → service result `{ success }`).
 * Wrapped in `{success,data}` so a bare `{success:true}` daemon body
 * still passes legacy `result.success && result.data` unwraps and yields
 * `{success:true}` to the caller.
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
 * `{ agentId }` → `{ success, queue: QueuedMessage[] }`). Uses the wrapped
 * `{success,data}` form for consistency with the other queue bridges
 * (renderer reads now go through `appClient.agents.getQueue`).
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
