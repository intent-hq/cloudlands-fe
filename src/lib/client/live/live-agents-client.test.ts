import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentCreateRequest } from "../app-client";

// FAKE transport only: the backend bridge is mocked so no request ever reaches
// the user's real daemon. Each test asserts the JSON-RPC method + params the
// client emits and how it folds success / error into a MutationResult.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from "./backend-transport";
import { LiveAgentsClient } from "./live-agents-client";

const mockedRequest = vi.mocked(backendRequest);

describe("LiveAgentsClient mutations (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("create forwards agent.create, mapping prompt→behaviorPrompt + idempotencyKey", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "agent-1" });
    const client = new LiveAgentsClient();

    const request: AgentCreateRequest = {
      workspaceId: "ws-1",
      prompt: "do the thing",
      model: "opus",
      specialist: "implementor",
    };
    const result = await client.create(request);

    expect(result).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      "agent.create",
      expect.objectContaining({
        workspaceId: "ws-1",
        model: "opus",
        specialist: "implementor",
        behaviorPrompt: "do the thing",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("send forwards agent.sendMessage with workspaceId + minted messageId", async () => {
    // First mockedRequest call resolves the agent (priming workspaceId cache);
    // second is the actual agent.sendMessage mutation.
    mockedRequest.mockResolvedValueOnce({ agent: { id: "agent-1", workspaceId: "ws-1" } });
    mockedRequest.mockResolvedValueOnce({ success: true });
    const client = new LiveAgentsClient();

    expect(await client.send("agent-1", "hi")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenNthCalledWith(1, "agent.get", { agentId: "agent-1" });
    expect(mockedRequest).toHaveBeenNthCalledWith(
      2,
      "agent.sendMessage",
      expect.objectContaining({
        agentId: "agent-1",
        content: "hi",
        workspaceId: "ws-1",
        messageId: expect.any(String),
      }),
    );
  });

  it("send reuses the cached workspaceId from a prior list/get without re-fetching", async () => {
    // Prime the cache via list().
    mockedRequest.mockResolvedValueOnce({
      agents: [{ id: "agent-1", workspaceId: "ws-1", name: "A1", status: "idle" }],
    });
    const client = new LiveAgentsClient();
    await client.list("ws-1");

    mockedRequest.mockResolvedValueOnce({ success: true });
    expect(await client.send("agent-1", "hi")).toEqual({ success: true });

    // Exactly two backend calls total: the priming list and the sendMessage.
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(mockedRequest).toHaveBeenLastCalledWith(
      "agent.sendMessage",
      expect.objectContaining({ agentId: "agent-1", content: "hi", workspaceId: "ws-1" }),
    );
  });

  it("send fails cleanly when the agent's workspace cannot be resolved", async () => {
    // agent.get returns nothing -> resolver returns null -> send refuses to fire
    // a malformed agent.sendMessage.
    mockedRequest.mockResolvedValueOnce(null);
    const client = new LiveAgentsClient();

    const result = await client.send("agent-ghost", "hi");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/agent-ghost/);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith("agent.get", { agentId: "agent-ghost" });
  });

  it("queue forwards agent.queueMessage and surfaces the returned queuedMessage", async () => {
    const queuedMessage = {
      id: "qm-1",
      content: "later",
      queuedAt: "2026-06-29T00:00:00.000Z",
      position: 0,
    };
    mockedRequest.mockResolvedValueOnce({ success: true, queuedMessage });
    const client = new LiveAgentsClient();

    const result = await client.queue("agent-1", "later");
    expect(result).toEqual({ success: true, queuedMessage });
    expect(mockedRequest).toHaveBeenCalledWith("agent.queueMessage", {
      agentId: "agent-1",
      content: "later",
    });
  });

  it("queue still succeeds when the daemon omits queuedMessage", async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });
    const client = new LiveAgentsClient();

    expect(await client.queue("agent-1", "later")).toEqual({ success: true });
  });

  it("removeQueued forwards agent.removeQueuedMessage with PROTOCOL §5.5 params and folds the idempotent BE body into success", async () => {
    // PROTOCOL §5.5: the daemon's agent.removeQueuedMessage ALWAYS returns
    // `{ success: true }`, including when the messageId is unknown or the
    // queue is empty. The seam folds that into the uniform MutationResult.
    mockedRequest.mockResolvedValueOnce({ success: true });
    const client = new LiveAgentsClient();

    const result = await client.removeQueued("agent-1", "qm-1");
    expect(result).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("agent.removeQueuedMessage", {
      agentId: "agent-1",
      messageId: "qm-1",
    });
  });

  it("removeQueued surfaces a transport failure as a non-success MutationResult (no throw)", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("ipc boom"));
    const client = new LiveAgentsClient();

    const result = await client.removeQueued("agent-1", "qm-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("ipc boom");
  });

  it("setAvailability forwards agent.setAvailability with the boolean", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "agent-1" });
    const client = new LiveAgentsClient();

    expect(await client.setAvailability("agent-1", true)).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("agent.setAvailability", {
      agentId: "agent-1",
      available: true,
    });
  });

  it("follow forwards agent.follow with the boolean", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "agent-1" });
    const client = new LiveAgentsClient();

    expect(await client.follow("agent-1", false)).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("agent.follow", {
      agentId: "agent-1",
      follow: false,
    });
  });

  it("lock forwards agent.lock with the boolean", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "agent-1" });
    const client = new LiveAgentsClient();

    expect(await client.lock("agent-1", true)).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("agent.lock", { agentId: "agent-1", locked: true });
  });

  it("maps a daemon error to a failed MutationResult without throwing", async () => {
    // Use a fresh agentId so the module-level workspace cache is guaranteed to
    // miss; the resolver call resolves successfully, then agent.sendMessage
    // rejects and the failure is folded into a MutationResult (not thrown).
    mockedRequest.mockResolvedValueOnce({ agent: { id: "agent-err", workspaceId: "ws-1" } });
    mockedRequest.mockRejectedValueOnce(new Error("agent busy"));
    const client = new LiveAgentsClient();

    expect(await client.send("agent-err", "x")).toEqual({ success: false, error: "agent busy" });
  });
});
