/**
 * Wire-contract tests for the agent IPC bridge seeder.
 *
 * Asserts each legacy renderer→main agent channel registers a mock IPC
 * handler that (a) forwards to the canonical daemon JSON-RPC method with the
 * right params (PROTOCOL §5.5), and (b) wraps the daemon response in the
 * envelope the call site expects (IpcResponse for typedInvoke; raw success
 * for stream-message; CommandResponse for set-model). The queue-quintet
 * bridges were removed with their last renderer producer (T3/T4) — queue
 * flows are covered by the `appClient.agents.*` wire-contract tests in
 * `live-agents-client.test.ts`.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE transport only: the daemon bridge is mocked so no UDS request ever
// fires. Each test asserts the JSON-RPC method + params the handler emits
// and how it maps the daemon result back to the renderer envelope.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
}));

// The global `test-setup.ts` stubs `$lib/electron-bridge.invoke` to a switch
// that returns `{success:true,data:null}` for unknown channels — which would
// short-circuit consumer calls (e.g. `agentClient.setModel`) before they reach
// the mock IPC router. Route `invoke` through `mockInvoke` here so consumers
// exercise the seeder-registered bridges end-to-end.
vi.mock("$lib/electron-bridge", async () => {
  const { mockInvoke } = await import("$shared/ipc-mock-router");
  return {
    isElectron: () => false,
    invoke: <T>(channel: string, data?: unknown) => mockInvoke<T>(channel, data),
    listen: async () => () => {},
    listenSync: () => () => {},
    emit: async () => {},
  };
});

// Stable idempotency key so we can assert it without leaking randomness.
vi.mock("$lib/client/live/live-support", async (importActual) => {
  const actual = await importActual<typeof import("$lib/client/live/live-support")>();
  return { ...actual, newIdempotencyKey: () => "idk-test" };
});

import { backendRequest } from "$lib/client/live/backend-transport";
import { hasMockIpcHandler, mockInvoke, resetMockIpcRouter } from "$shared/ipc-mock-router";
import { AGENT_CHANNELS, AGENT_BACKEND_CHANNELS } from "$shared/ipc/channels";
import { validateIpcRequest } from "$shared/ipc/request-validation";
import { isSuccessResponse } from "$shared/ipc/typed-invoke";
// End-to-end consumer for the set-model bridge: ModelPicker calls
// `agentClient.setModel`, which folds the bridge's CommandResponse envelope
// into a `Result` — exercising it here catches envelope regressions (the
// original bug: no bridge → `undefined` → TypeError inside the fold).
import { agentClient } from "$features/agent/agent.client";

const mockedRequest = vi.mocked(backendRequest);

/**
 * A workspace ID slug that satisfies `WorkspaceIdSchema` so the
 * `validateIpcRequest('agent:create', ...)` assertions exercise the real FE
 * request-validation path (PROTOCOL-shaped slug, no synthetic format).
 */
const WORKSPACE_ID = "amber-forest";

describe("agent-ipc-bridge-seeder", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import("./agent-ipc-bridge-seeder");
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("agent:create → daemon agent.create", () => {
    it("forwards workspaceId / name / model / specialistId and wraps the result in IpcResponse<{agent,sessionId}>", async () => {
      // PROTOCOL-shaped daemon response for `agent.create` (§5.5):
      // `{ agent: { id, name } }` — the bridge must accept this verbatim.
      mockedRequest.mockResolvedValueOnce({ agent: { id: "agent-42", name: "Coordinator" } });

      // The FE request must first pass the FE's own `agent:create` schema
      // (request-validation.ts) — that contract is independent of the bridge
      // and would catch a regression where the renderer started sending an
      // off-spec payload.
      const request = {
        workspaceId: WORKSPACE_ID,
        workspacePath: "/tmp/ws",
        name: "Coordinator",
        model: "claude-opus",
        metadata: { specialist: "coordinator" },
      };
      expect(() => validateIpcRequest("agent:create", request)).not.toThrow();

      const response = await mockInvoke(AGENT_CHANNELS.CREATE, request);

      // No `agentId` on the wire: the daemon assigns the session id and
      // returns it on the response's `agent.id`; the bridge echoes that id as
      // `sessionId` so callers adopt the daemon-assigned id.
      expect(mockedRequest).toHaveBeenCalledWith("agent.create", {
        workspaceId: WORKSPACE_ID,
        name: "Coordinator",
        model: "claude-opus",
        specialistId: "coordinator",
        idempotencyKey: "idk-test",
      });
      // `typedInvoke` consumers (UnifiedAgentFactory.createInBackend) gate on
      // `isSuccessResponse`, so the bridge envelope MUST satisfy that guard.
      expect(isSuccessResponse(response as never)).toBe(true);
      expect(response).toEqual({
        success: true,
        data: { agent: { id: "agent-42", name: "Coordinator" }, sessionId: "agent-42" },
      });
    });

    it("never forwards a client-supplied agentId to the daemon (daemon mints its own)", async () => {
      mockedRequest.mockResolvedValueOnce({ agent: { id: "agent-be-99", name: "anon" } });
      const response = await mockInvoke(AGENT_CHANNELS.CREATE, {
        workspaceId: WORKSPACE_ID,
        workspacePath: "/tmp/ws",
        // A legacy caller may still pass an id — it must be dropped.
        agentId: "agent-legacy-client",
      });
      const params = mockedRequest.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(params).toBeDefined();
      expect("agentId" in params).toBe(false);
      // The daemon-assigned id is surfaced back as the sessionId.
      expect(response).toEqual({
        success: true,
        data: { agent: { id: "agent-be-99", name: "anon" }, sessionId: "agent-be-99" },
      });
    });

    it("returns an IpcResponse error when the daemon response lacks agent.id", async () => {
      // Without the daemon-assigned id the FE cannot address follow-up sends;
      // the bridge must fail loudly instead of returning sessionId: undefined.
      mockedRequest.mockResolvedValueOnce({ agent: { name: "no-id" } });
      const response = await mockInvoke<{ success: boolean; error?: { code: string; message: string } }>(
        AGENT_CHANNELS.CREATE,
        { workspaceId: WORKSPACE_ID },
      );
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe("BACKEND_ERROR");
      expect(response.error?.message).toContain("agent.id");
    });

    it("returns an IpcResponse error when workspaceId is missing (no daemon call)", async () => {
      const response = await mockInvoke<{ success: boolean; error?: { code: string } }>(
        AGENT_CHANNELS.CREATE,
        { name: "anon" },
      );
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe("INVALID_REQUEST");
    });

    it("surfaces a daemon failure as an IpcResponse error envelope", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("nope"));
      const response = await mockInvoke<{ success: boolean; error?: { code: string; message: string } }>(
        AGENT_CHANNELS.CREATE,
        { workspaceId: WORKSPACE_ID },
      );
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe("BACKEND_ERROR");
      expect(response.error?.message).toBe("nope");
    });
  });

  describe("agent:backend:stream-message → daemon agent.sendMessage", () => {
    it("forwards agentId / workspaceId / content (+ optional messageId / imageBlocks) and returns the daemon body unchanged", async () => {
      // PROTOCOL §5.5: `{ success, queued, messageId? }`. The bridge must
      // pass this through unchanged so the call site's auto-queue branch
      // (`queued: true`) and `success` guard fire correctly.
      mockedRequest.mockResolvedValueOnce({ success: true, queued: false, messageId: "msg-1" });

      const blocks = [{ type: "image", data: "abc", mimeType: "image/png" }];
      const request = {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "hello",
        messageId: "msg-1",
        imageBlocks: blocks,
      };
      // FE→bridge request must satisfy the registered
      // `agent:backend:stream-message` schema (AgentStreamMessageRequest).
      expect(() => validateIpcRequest("agent:backend:stream-message", request)).not.toThrow();

      const response = await mockInvoke(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, request);

      expect(mockedRequest).toHaveBeenCalledWith("agent.sendMessage", {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "hello",
        messageId: "msg-1",
        imageBlocks: blocks,
      });
      expect(response).toEqual({ success: true, queued: false, messageId: "msg-1" });
    });

    it("propagates the daemon auto-queue flag (queued:true) so the FE switches to queued-message UI", async () => {
      // Direct PROTOCOL example: daemon detects a live turn and reports
      // `{ success: true, queued: true }`. The FE call site keys off this
      // boolean to render the message as queued instead of streaming.
      mockedRequest.mockResolvedValueOnce({ success: true, queued: true, messageId: "msg-2" });
      const response = await mockInvoke<{ success: boolean; queued?: boolean; messageId?: string }>(
        AGENT_BACKEND_CHANNELS.STREAM_MESSAGE,
        { agentId: "agent-7", workspaceId: WORKSPACE_ID, content: "follow-up" },
      );
      expect(response.success).toBe(true);
      expect(response.queued).toBe(true);
      expect(response.messageId).toBe("msg-2");
    });

    it("forwards priority='interrupt' to agent.sendMessage for interrupt delivery (PROTOCOL §5.5)", async () => {
      // STAB-38: force-send while a turn is in-flight must carry
      // `priority: "interrupt"` on the wire so the daemon preempts the
      // current turn keep-alive (instead of queueing the message). This
      // test asserts the bridge passes through the "interrupt" value
      // when supplied by the caller (FE force-send path).
      mockedRequest.mockResolvedValueOnce({ success: true, queued: false, messageId: "msg-int" });
      const request = {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "stop and answer this",
        messageId: "msg-int",
        priority: "interrupt" as const,
      };
      await mockInvoke(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, request);

      expect(mockedRequest).toHaveBeenCalledWith("agent.sendMessage", {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "stop and answer this",
        messageId: "msg-int",
        priority: "interrupt",
      });
    });

    it("omits priority when not supplied by the caller (normal send-message)", async () => {
      // Regression guard: when the caller does NOT set priority (normal send
      // without force), the bridge must NOT include it in the JSON-RPC params
      // so the daemon treats it as normal queue-vs-stream delivery.
      mockedRequest.mockResolvedValueOnce({ success: true, queued: false, messageId: "msg-no-pri" });
      await mockInvoke(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "normal message",
      });
      const call = mockedRequest.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(call).toEqual({
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "normal message",
      });
      expect(call.priority).toBeUndefined();
    });

    it("strips non-interrupt priority values (schema validation for daemon)", async () => {
      // Only "interrupt" is a valid priority value per PROTOCOL §5.5. If a
      // caller somehow passes a different string, the bridge must NOT forward
      // it (the daemon would reject or ignore it). Assert it is stripped.
      mockedRequest.mockResolvedValueOnce({ success: true, queued: false, messageId: "msg-bad" });
      await mockInvoke(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "hello",
        priority: "high" as any, // Invalid value
      });
      const call = mockedRequest.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(call.priority).toBeUndefined();
    });

    it("returns {success:false} when agentId or workspaceId is missing (no daemon call)", async () => {
      const response = await mockInvoke<{ success: boolean }>(
        AGENT_BACKEND_CHANNELS.STREAM_MESSAGE,
        { content: "hello" },
      );
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response.success).toBe(false);
    });

    it("forwards the FE-side context payload (contextReferences / noteIds / stdinContext) to agent.sendMessage", async () => {
      // The FE `agent-stream-lifecycle` sendMessage assembles these three
      // context fields from user input (attached notes, workspace-context
      // blob, workspace/file references) and hands them to STREAM_MESSAGE.
      // Prior to this fix the bridge stripped them before calling
      // `agent.sendMessage`, so even a BE that grew support could not see
      // them. Assert every forwarded field lands verbatim in the JSON-RPC
      // params.
      mockedRequest.mockResolvedValueOnce({ success: true, queued: false, messageId: "msg-ctx" });

      const contextReferences = [
        { kind: "file", path: "src/index.ts" },
        { kind: "workspace", workspaceId: WORKSPACE_ID },
      ];
      const noteIds = ["note-1", "note-2"];
      const stdinContext = "Selected lines:\nfoo\nbar";
      const request = {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "hello",
        messageId: "msg-ctx",
        contextReferences,
        noteIds,
        stdinContext,
      };

      await mockInvoke(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, request);

      expect(mockedRequest).toHaveBeenCalledWith("agent.sendMessage", {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "hello",
        messageId: "msg-ctx",
        contextReferences,
        noteIds,
        stdinContext,
      });
    });

    it("omits context fields when the caller does not supply them (schema-clean payload)", async () => {
      // Regression guard: unset context fields must NOT surface as `undefined`
      // in the JSON-RPC params, so the daemon router's `opt_value` lookups
      // continue to treat them as absent rather than seeing a `null` and
      // rejecting the call.
      mockedRequest.mockResolvedValueOnce({ success: true, queued: false, messageId: "msg-plain" });
      await mockInvoke(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "hello",
      });
      const call = mockedRequest.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(call).toEqual({
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "hello",
      });
      expect(Object.keys(call)).not.toContain("contextReferences");
      expect(Object.keys(call)).not.toContain("noteIds");
      expect(Object.keys(call)).not.toContain("stdinContext");
    });

    it("forwards the remaining stream payload (fileBlocks / model / messageMetadata + app-ID trio) to agent.sendMessage", async () => {
      // The FE `agent-stream-lifecycle` threads these fields into
      // STREAM_MESSAGE alongside the previously-covered context payload:
      // `fileBlocks` (attached files, L1468), `model` (per-turn model
      // override, L1465), and the pre-assigned app-ID trio (userAppMessageId
      // L1484, assistantMessageId L1483, assistantAppMessageId L1485). The
      // daemon router does not consume them today — Fidelity A widened it to
      // accept `fileBlocks`, the rest remain a documented daemon-gap — but
      // forwarding here keeps the BE as the single fix site when the router
      // is widened. `messageMetadata` is future-proofed for the widened
      // wire (only main-process backend-initiated flows emit it today, per
      // `src/features/agent/main/auto-commit.service.ts:193`).
      mockedRequest.mockResolvedValueOnce({ success: true, queued: false, messageId: "msg-x" });

      const fileBlocks = [
        { type: "file", data: "abc", mimeType: "text/plain", fileName: "notes.txt" },
      ];
      const messageMetadata = { type: "auto_commit_hook_failure", retryCount: 1 };
      await mockInvoke(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "hello",
        fileBlocks,
        model: "claude-opus",
        messageMetadata,
        assistantMessageId: "msg_00000000-0000-0000-0000-000000000001",
        assistantAppMessageId: "app-asst-1",
        userAppMessageId: "app-user-1",
      });

      expect(mockedRequest).toHaveBeenCalledWith("agent.sendMessage", {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "hello",
        fileBlocks,
        model: "claude-opus",
        messageMetadata,
        assistantMessageId: "msg_00000000-0000-0000-0000-000000000001",
        assistantAppMessageId: "app-asst-1",
        userAppMessageId: "app-user-1",
      });
    });

    it("audit: personality / queuedMessageId / queuedMessageAppMessageId are documented dead surface and NOT forwarded to agent.sendMessage", async () => {
      // These three fields have no live renderer producer at HEAD (see the
      // bridge doc-comment for file:line evidence). Assert the bridge strips
      // them from the JSON-RPC params so a future accidental producer
      // surfaces the audit gap explicitly rather than silently piggy-backing
      // on the bridge's forwarding.
      mockedRequest.mockResolvedValueOnce({ success: true, queued: false, messageId: "msg-audit" });
      await mockInvoke(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "hello",
        personality: "auggie-personality-agent-default",
        queuedMessageId: "q-1",
        queuedMessageAppMessageId: "app-q-1",
      });
      const call = mockedRequest.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(Object.keys(call)).not.toContain("personality");
      expect(Object.keys(call)).not.toContain("queuedMessageId");
      expect(Object.keys(call)).not.toContain("queuedMessageAppMessageId");
    });

    it("omits fileBlocks / model / messageMetadata / app-ID trio when the caller does not supply them", async () => {
      // Regression guard mirroring the context-fields omission test above:
      // when the caller supplies only the required trio, none of the newly
      // forwarded fields must surface in the JSON-RPC params.
      mockedRequest.mockResolvedValueOnce({ success: true, queued: false, messageId: "msg-p" });
      await mockInvoke(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, {
        agentId: "agent-7",
        workspaceId: WORKSPACE_ID,
        content: "hello",
      });
      const call = mockedRequest.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(Object.keys(call)).not.toContain("fileBlocks");
      expect(Object.keys(call)).not.toContain("model");
      expect(Object.keys(call)).not.toContain("messageMetadata");
      expect(Object.keys(call)).not.toContain("assistantMessageId");
      expect(Object.keys(call)).not.toContain("assistantAppMessageId");
      expect(Object.keys(call)).not.toContain("userAppMessageId");
    });
  });

  describe("retired queue-quintet bridges stay removed", () => {
    it("registers no handler for the queue channels (last renderer producer retired with T3)", () => {
      // The unifiedOrchestrator proxy was the only renderer producer of these
      // channels; queue flows now call appClient.agents.* over the live
      // transport. A re-registered bridge would shadow that seam — any new
      // invoke call site instead fails the ipc-channel-reconciliation audit.
      expect(hasMockIpcHandler(AGENT_BACKEND_CHANNELS.QUEUE_MESSAGE)).toBe(false);
      expect(hasMockIpcHandler(AGENT_BACKEND_CHANNELS.EDIT_QUEUED)).toBe(false);
      expect(hasMockIpcHandler(AGENT_BACKEND_CHANNELS.REMOVE_QUEUED)).toBe(false);
      expect(hasMockIpcHandler(AGENT_BACKEND_CHANNELS.FORCE_MESSAGE)).toBe(false);
      expect(hasMockIpcHandler(AGENT_BACKEND_CHANNELS.GET_QUEUE)).toBe(false);
    });
  });

  describe("agent:set-model → daemon agent.setModel", () => {
    it("end-to-end: agentClient.setModel sends {agentId,modelId,workspaceId} and folds the PROTOCOL body into an ok Result", async () => {
      // PROTOCOL §5.5: `agent.setModel` → `{ success, modelId }` (emits
      // `agent:updated`). The bridge wraps it as CommandResponse
      // `{success:true, data:<daemonBody>}` so `commandResponseToResult`
      // yields `ok:true` and ModelPicker reads `result.data.success`.
      mockedRequest.mockResolvedValueOnce({ success: true, modelId: "fable-5" });

      const result = await agentClient.setModel("agent-7", "fable-5", WORKSPACE_ID);

      expect(mockedRequest).toHaveBeenCalledWith("agent.setModel", {
        agentId: "agent-7",
        modelId: "fable-5",
        workspaceId: WORKSPACE_ID,
      });
      expect(result).toEqual({ ok: true, data: { success: true, modelId: "fable-5" } });
    });

    it("daemon failure surfaces as {ok:false,error:<message>} so ModelPicker toasts the daemon error", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("not found: agent session"));
      const result = await agentClient.setModel("agent-7", "fable-5", WORKSPACE_ID);
      expect(result).toEqual({ ok: false, error: "not found: agent session" });
    });

    it("validates required params at the bridge boundary (no daemon call)", async () => {
      const response = await mockInvoke<{ success: boolean; error?: string }>(
        AGENT_CHANNELS.SET_MODEL,
        { agentId: "agent-7" },
      );
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response.success).toBe(false);
      expect(response.error).toContain("modelId");
    });
  });

  // Suppress the unused-import warning while keeping the import in place so
  // tests that run in isolation still tear the router down cleanly.
  void resetMockIpcRouter;
});
