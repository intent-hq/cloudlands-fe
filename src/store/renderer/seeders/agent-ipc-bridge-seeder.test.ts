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

const mockedRequest = vi.mocked(backendRequest);

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
      mockedRequest.mockResolvedValueOnce({ agent: { id: "agent-42", name: "Coordinator" } });

      const response = await mockInvoke<{
        success: boolean;
        data?: { agent?: { id?: string; name?: string }; sessionId?: string };
        error?: { code: string; message: string };
      }>(AGENT_CHANNELS.CREATE, {
        workspaceId: "ws-1",
        workspacePath: "/tmp/ws",
        name: "Coordinator",
        agentId: "agent-42",
        model: "claude-opus",
        metadata: { specialist: "coordinator" },
      });

      expect(mockedRequest).toHaveBeenCalledWith("agent.create", {
        workspaceId: "ws-1",
        name: "Coordinator",
        model: "claude-opus",
        specialistId: "coordinator",
        idempotencyKey: "idk-test",
      });
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
        { workspaceId: "ws-1" },
      );
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe("BACKEND_ERROR");
      expect(response.error?.message).toBe("nope");
    });
  });

  describe("agent:backend:stream-message → daemon agent.sendMessage", () => {
    it("forwards agentId / workspaceId / content (+ optional messageId / imageBlocks) and returns the daemon body unchanged", async () => {
      mockedRequest.mockResolvedValueOnce({ success: true, queued: false, messageId: "msg-1" });

      const blocks = [{ type: "image", data: "abc", mimeType: "image/png" }];
      const response = await mockInvoke(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, {
        agentId: "agent-7",
        workspaceId: "ws-7",
        content: "hello",
        messageId: "msg-1",
        imageBlocks: blocks,
      });

      expect(mockedRequest).toHaveBeenCalledWith("agent.sendMessage", {
        agentId: "agent-7",
        workspaceId: "ws-7",
        content: "hello",
        messageId: "msg-1",
        imageBlocks: blocks,
      });
      expect(response).toEqual({ success: true, queued: false, messageId: "msg-1" });
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
      const queued = { id: "q-1", content: "hi", position: 0, queuedAt: "2026-01-01T00:00:00Z" };
      mockedRequest.mockResolvedValueOnce({ success: true, queuedMessage: queued });

      const response = await mockInvoke<{
        success: boolean;
        data?: { success: boolean; queuedMessage?: unknown };
      }>(AGENT_BACKEND_CHANNELS.QUEUE_MESSAGE, { agentId: "agent-7", content: "hi" });

      expect(mockedRequest).toHaveBeenCalledWith("agent.queueMessage", {
        agentId: "agent-7",
        content: "hi",
      });
      expect(response).toEqual({ success: true, data: { success: true, queuedMessage: queued } });
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
