/**
 * Wire-contract tests for the agent IPC bridge seeder.
 *
 * Asserts each legacy renderer→main agent channel registers a mock IPC
 * handler that (a) forwards to the canonical daemon JSON-RPC method with the
 * right params (PROTOCOL §5.5), and (b) wraps the daemon response in the
 * envelope the call site expects (IpcResponse for typedInvoke; raw success
 * for stream-message; `{success,data}` for the queue proxy).
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
// short-circuit `unifiedOrchestrator.*` calls before they reach the mock IPC
// router. Route `invoke` through `mockInvoke` here so the orchestrator
// exercises the seeder-registered bridges end-to-end.
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
import { mockInvoke, resetMockIpcRouter } from "$shared/ipc-mock-router";
import { AGENT_CHANNELS, AGENT_BACKEND_CHANNELS } from "$shared/ipc/channels";
import { validateIpcRequest } from "$shared/ipc/request-validation";
import { isSuccessResponse } from "$shared/ipc/typed-invoke";
// End-to-end: drive the real consumer proxy so the bridge is exercised
// through `invoke → mockInvoke → handler` and the proxy's `unwrapIpcResponse`
// fold is part of the assertion (catches envelope-shape regressions that a
// pure `mockInvoke` test would miss).
import { unifiedOrchestrator } from "$features/agent/services/consolidated-backend.service";
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

  describe("agent:backend:queue-message → daemon agent.queueMessage", () => {
    it("forwards agentId / content and wraps the result in {success,data:{success,queuedMessage}} for the orchestrator proxy", async () => {
      // PROTOCOL §5.5: `{ success, queuedMessage }` where QueuedMessage =
      // `{ id, content, queuedAt, position, imageBlocks? }`. The bridge
      // must preserve the QueuedMessage shape through the wrap so the
      // orchestrator's `unwrapIpcResponse` recovers the same data.
      const queued = { id: "q-1", content: "hi", position: 0, queuedAt: "2026-01-01T00:00:00Z" };
      mockedRequest.mockResolvedValueOnce({ success: true, queuedMessage: queued });

      const response = await mockInvoke<{
        success: boolean;
        data?: { success: boolean; queuedMessage?: typeof queued };
      }>(AGENT_BACKEND_CHANNELS.QUEUE_MESSAGE, { agentId: "agent-7", content: "hi" });

      expect(mockedRequest).toHaveBeenCalledWith("agent.queueMessage", {
        agentId: "agent-7",
        content: "hi",
      });
      expect(response).toEqual({ success: true, data: { success: true, queuedMessage: queued } });
      // The QueuedMessage round-trip is what the FE queued-message UI binds
      // to; assert each field to catch any envelope-wrapping regression.
      expect(response.data?.queuedMessage).toEqual(queued);
    });

    it("returns an error envelope on daemon failure (preserved through the proxy unwrap)", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("queue blew up"));
      const response = await mockInvoke<{ success: boolean; error?: { message: string } }>(
        AGENT_BACKEND_CHANNELS.QUEUE_MESSAGE,
        { agentId: "agent-7", content: "hi" },
      );
      expect(response.success).toBe(false);
      expect(response.error?.message).toBe("queue blew up");
    });
  });

  describe("agent:backend:edit-queued → daemon agent.editQueuedMessage", () => {
    it("end-to-end: unifiedOrchestrator.editQueuedMessage sends {agentId,messageId,content} and returns the daemon QueuedMessage", async () => {
      // PROTOCOL §5.5: `{ success, queuedMessage }`. The proxy unwraps the
      // bridge's `{success,data}` envelope and returns the inner body, so the
      // saga sees `{success:true, queuedMessage}`.
      const queued = { id: "q-1", content: "edited", position: 0, queuedAt: "2026-01-01T00:00:00Z" };
      mockedRequest.mockResolvedValueOnce({ success: true, queuedMessage: queued });

      const result = await unifiedOrchestrator.editQueuedMessage("agent-7", "q-1", "edited");

      expect(mockedRequest).toHaveBeenCalledWith("agent.editQueuedMessage", {
        agentId: "agent-7",
        messageId: "q-1",
        content: "edited",
      });
      expect(result).toEqual({ success: true, queuedMessage: queued });
    });

    it("validates required messageId at the bridge boundary (no daemon call)", async () => {
      const response = await mockInvoke<{ success: boolean; error?: { message: string } }>(
        AGENT_BACKEND_CHANNELS.EDIT_QUEUED,
        { agentId: "agent-7", content: "edited" },
      );
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response.success).toBe(false);
      expect(response.error?.message).toContain("messageId");
    });

    it("STAB-27: sends editing:true to hold a queued message during edit", async () => {
      // PROTOCOL §5.5 + agent_ops.rs: `editing` flag holds the message in the queue
      // (daemon skips it during drain). The daemon returns the updated QueuedMessage
      // with editing:true in the response.
      const queued = {
        id: "q-1",
        content: "original",
        position: 0,
        queuedAt: "2026-01-01T00:00:00Z",
        editing: true
      };
      mockedRequest.mockResolvedValueOnce({ success: true, queuedMessage: queued });

      const result = await unifiedOrchestrator.editQueuedMessage("agent-7", "q-1", "original", true);

      expect(mockedRequest).toHaveBeenCalledWith("agent.editQueuedMessage", {
        agentId: "agent-7",
        messageId: "q-1",
        content: "original",
        editing: true,
      });
      expect(result).toEqual({ success: true, queuedMessage: queued });
    });

    it("STAB-27: sends editing:false to release hold and allow self-drain", async () => {
      // When saving edits, editing:false triggers daemon self-drain logic
      const queued = {
        id: "q-1",
        content: "edited content",
        position: 0,
        queuedAt: "2026-01-01T00:00:00Z"
        // editing field omitted (daemon only includes it when true)
      };
      mockedRequest.mockResolvedValueOnce({ success: true, queuedMessage: queued });

      const result = await unifiedOrchestrator.editQueuedMessage("agent-7", "q-1", "edited content", false);

      expect(mockedRequest).toHaveBeenCalledWith("agent.editQueuedMessage", {
        agentId: "agent-7",
        messageId: "q-1",
        content: "edited content",
        editing: false,
      });
      expect(result).toEqual({ success: true, queuedMessage: queued });
    });

    it("STAB-27: omits editing flag when not provided (backward compat)", async () => {
      const queued = { id: "q-1", content: "edited", position: 0, queuedAt: "2026-01-01T00:00:00Z" };
      mockedRequest.mockResolvedValueOnce({ success: true, queuedMessage: queued });

      const result = await unifiedOrchestrator.editQueuedMessage("agent-7", "q-1", "edited");

      expect(mockedRequest).toHaveBeenCalledWith("agent.editQueuedMessage", {
        agentId: "agent-7",
        messageId: "q-1",
        content: "edited",
      });
      expect(result).toEqual({ success: true, queuedMessage: queued });
    });
  });

  describe("agent:backend:remove-queued → daemon agent.removeQueuedMessage", () => {
    it("end-to-end: unifiedOrchestrator.removeQueuedMessage sends {agentId,messageId} and a bare {success:true} daemon body still resolves to {success:true}", async () => {
      // PROTOCOL §5.5: daemon returns just `{ success: true }` for remove.
      // The proxy's `unwrapIpcResponse` only returns `result.data` when both
      // `result.success` AND `result.data` are truthy — so the bridge MUST
      // wrap a bare success body as `{success:true, data:{success:true}}`
      // or removal silently degrades to `{success:false}` (the bug iter#2b).
      mockedRequest.mockResolvedValueOnce({ success: true });

      const result = await unifiedOrchestrator.removeQueuedMessage("agent-7", "q-1");

      expect(mockedRequest).toHaveBeenCalledWith("agent.removeQueuedMessage", {
        agentId: "agent-7",
        messageId: "q-1",
      });
      expect(result).toEqual({ success: true });
    });

    it("daemon error becomes {success:false,error:<message>} through the proxy unwrap", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("not found"));
      const result = await unifiedOrchestrator.removeQueuedMessage("agent-7", "q-1");
      expect(result).toEqual({ success: false, error: "not found" });
    });
  });

  describe("agent:backend:force-message → daemon agent.forceMessage", () => {
    it("end-to-end: unifiedOrchestrator.forceMessage forwards workspaceId + optional imageBlocks/noteIds and resolves the daemon body", async () => {
      // PROTOCOL §5.5: service result; daemon today returns
      // `{ success, queued:false, messageId }`. The proxy unwraps to that.
      mockedRequest.mockResolvedValueOnce({ success: true, queued: false, messageId: "msg-9" });
      const blocks = [{ type: "image", data: "abc", mimeType: "image/png" }];
      const noteIds = ["note-1", "note-2"];

      const result = await unifiedOrchestrator.forceMessage(
        "agent-7",
        "msg-9",
        "stop and run this",
        WORKSPACE_ID,
        blocks,
        noteIds,
      );

      expect(mockedRequest).toHaveBeenCalledWith("agent.forceMessage", {
        agentId: "agent-7",
        messageId: "msg-9",
        content: "stop and run this",
        workspaceId: WORKSPACE_ID,
        imageBlocks: blocks,
        noteIds,
      });
      expect(result).toEqual({ success: true, queued: false, messageId: "msg-9" });
    });

    it("validates required workspaceId at the bridge boundary (no daemon call)", async () => {
      const response = await mockInvoke<{ success: boolean; error?: { message: string } }>(
        AGENT_BACKEND_CHANNELS.FORCE_MESSAGE,
        { agentId: "agent-7", messageId: "msg-9", content: "x" },
      );
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response.success).toBe(false);
      expect(response.error?.message).toContain("workspaceId");
    });
  });

  describe("agent:backend:get-queue → daemon agent.getQueue", () => {
    it("end-to-end: unifiedOrchestrator.getQueue sends {agentId} and returns the daemon {success,queue:[QueuedMessage]} body", async () => {
      // PROTOCOL §5.5: `{ success, queue: QueuedMessage[] }`. Entries may
      // additionally carry optional opaque `messageMetadata` (e.g. event
      // wakes tagged `{ type: "event_notification", ... }`) — passed through
      // untouched. Note: `messageMetadata` on queue entries is pending
      // contract documentation (the intentd half will add it to PROTOCOL
      // §5.5); until then this asserts the FE bridge is forward-compatible.
      const queue = [
        { id: "q-1", content: "a", position: 0, queuedAt: "2026-01-01T00:00:00Z" },
        { id: "q-2", content: "b", position: 1, queuedAt: "2026-01-01T00:00:01Z" },
        {
          id: "q-3",
          content: "[WORKSPACE EVENTS] You have been woken up by 1 subscribed event(s)",
          position: 2,
          queuedAt: "2026-01-01T00:00:02Z",
          messageMetadata: {
            type: "event_notification",
            eventCount: 1,
            eventTypes: ["agent:idle"],
          },
        },
      ];
      mockedRequest.mockResolvedValueOnce({ success: true, queue });

      const result = await unifiedOrchestrator.getQueue("agent-7");

      expect(mockedRequest).toHaveBeenCalledWith("agent.getQueue", { agentId: "agent-7" });
      expect(result).toEqual({ success: true, queue });
      // QueuedMessage round-trip — the queued-message UI binds per-field.
      expect(result.queue).toHaveLength(3);
      expect(result.queue?.[0]?.id).toBe("q-1");
      expect(result.queue?.[1]?.position).toBe(1);
      // messageMetadata survives the bridge unmodified (and stays absent
      // on entries the daemon sent without it).
      expect(result.queue?.[2]?.messageMetadata).toEqual({
        type: "event_notification",
        eventCount: 1,
        eventTypes: ["agent:idle"],
      });
      expect(result.queue?.[0]?.messageMetadata).toBeUndefined();
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
