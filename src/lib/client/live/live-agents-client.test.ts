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

  it("send forwards agent.send with content", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "agent-1" });
    const client = new LiveAgentsClient();

    expect(await client.send("agent-1", "hi")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("agent.send", { agentId: "agent-1", content: "hi" });
  });

  it("queue forwards agent.queue with content", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "agent-1" });
    const client = new LiveAgentsClient();

    expect(await client.queue("agent-1", "later")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("agent.queue", {
      agentId: "agent-1",
      content: "later",
    });
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
    mockedRequest.mockRejectedValueOnce(new Error("agent busy"));
    const client = new LiveAgentsClient();

    expect(await client.send("agent-1", "x")).toEqual({ success: false, error: "agent busy" });
  });
});
