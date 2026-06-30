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
 *  - `agent:backend:queue-message` (via `unifiedOrchestrator.queueMessage`)
 *    silently returned `{success:false}` (spec iter#2).
 *
 * Per the integration principle BE = source of truth: each handler forwards
 * to the canonical daemon RPC (`agent.create` / `agent.sendMessage` /
 * `agent.queueMessage`, PROTOCOL.md §5.5) and only wraps the raw daemon
 * response in the envelope the call site expects, never synthesizing data.
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
 * `agent:create` → daemon `agent.create` (PROTOCOL §5.5).
 *
 * The FE's `CreateRequest` carries more fields than `agent.create` accepts;
 * we forward only the parameters the daemon router consumes (`workspaceId`,
 * `name`, `model`, `specialistId`, `idempotencyKey`). The `specialist` value
 * lives under `metadata.specialist` (set by the specialist picker in
 * `agent-creation-service.ts`) — surface it as the daemon's `specialistId`.
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
  const params = {
    workspaceId,
    name: readString(request, "name"),
    model: readString(request, "model"),
    specialistId: readString(metadata, "specialist"),
    idempotencyKey: newIdempotencyKey(),
  };
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
 * The `unifiedOrchestrator` proxy unwraps `{ success: true, data: T }` and
 * returns the inner `T` as the `QueueOperationResult`. We wrap the daemon's
 * `{ success, queuedMessage }` in that envelope so the proxy folds back to
 * the same shape the legacy main-process handler produced.
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
  try {
    const result = await backendRequest<{ queuedMessage?: unknown }>(
      "agent.queueMessage",
      params,
    );
    return { success: true, data: { success: true, queuedMessage: result?.queuedMessage } };
  } catch (error) {
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
});
