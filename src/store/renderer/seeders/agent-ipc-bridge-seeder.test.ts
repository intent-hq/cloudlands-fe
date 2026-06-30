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
        agentId: "agent-42",
        model: "claude-opus",
        metadata: { specialist: "coordinator" },
      };
      expect(() => validateIpcRequest("agent:create", request)).not.toThrow();

      const response = await mockInvoke(AGENT_CHANNELS.CREATE, request);

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

    it("returns {success:false} when agentId or workspaceId is missing (no daemon call)", async () => {
      const response = await mockInvoke<{ success: boolean }>(
        AGENT_BACKEND_CHANNELS.STREAM_MESSAGE,
        { content: "hello" },
      );
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response.success).toBe(false);
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

  // Suppress the unused-import warning while keeping the import in place so
  // tests that run in isolation still tear the router down cleanly.
  void resetMockIpcRouter;
});
