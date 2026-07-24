/**
 * Agent IPC bridge — routes legacy renderer→main agent channels to the live
 * intentd daemon over the existing `backend.request` transport.
 *
 * Without these bridges the channels fell through the mock router's `undefined`
 * default (this build has no real Electron main-process handlers), so
 * `agent:create` (via `typedInvoke` in `UnifiedAgentFactory`) failed with
 * `Invalid response format from IPC handler` — the validator rejects a
 * non-`IpcResponse` envelope (spec iter#10).
 *
 * The `agent:backend:queue-message` / `…edit-queued` / `…remove-queued` /
 * `…force-message` / `…get-queue` bridges were removed once their last
 * renderer producer (the `unifiedOrchestrator` proxy) was retired in favor
 * of direct `appClient.agents.*` calls (T3/T4) — the queue flows now hit
 * the daemon RPCs without a legacy channel hop. The
 * `agent:backend:stream-message` bridge followed once the send paths were
 * routed directly through the `BackendTransport` seam
 * (`backendRequest("agent.sendMessage")` in `agent-stream-lifecycle.ts` (T1)
 * and `agent-factory.sendInitialMessage` (T2)).
 *
 * Per the integration principle BE = source of truth: each handler forwards
 * to the canonical daemon RPC (`agent.create` / `agent.setModel`,
 * PROTOCOL.md §5.5) and only wraps the raw daemon response in the envelope
 * the call site expects, never synthesizing data.
 *
 * Handlers are registered at import time (mirroring the workspaces-seeder
 * `workspace:open` idiom) so the first click → `+` → Coordinator → create
 * resolves before any component mounts.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { AGENT_CHANNELS } from "$shared/ipc/channels";
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
 * `name`, `model`, `specialistId`, `nameExplicitlySet`, `idempotencyKey`).
 * The `specialist` value lives under `metadata.specialist` (set by the
 * specialist picker in `agent-creation-service.ts`) — surface it as the
 * daemon's `specialistId`. `nameExplicitlySet` is a strict boolean on the
 * wire (PROTOCOL §5.5: omitted/null keeps the daemon default, non-boolean is
 * a -32602), so it is forwarded verbatim only when the request carries `true`
 * or `false` and never defaulted.
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
  if (typeof request.nameExplicitlySet === "boolean") {
    params.nameExplicitlySet = request.nameExplicitlySet;
  }
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
