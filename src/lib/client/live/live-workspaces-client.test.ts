import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateWorkspaceRequest } from "$shared/types";

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
import { LiveWorkspacesClient } from "./live-workspaces-client";

const mockedRequest = vi.mocked(backendRequest);

describe("LiveWorkspacesClient mutations (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("create forwards workspace.create with the request + an idempotencyKey", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "ws-1" });
    const client = new LiveWorkspacesClient();

    const result = await client.create({ title: "New WS", scope: "apps/web" } as CreateWorkspaceRequest);

    expect(result).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      "workspace.create",
      expect.objectContaining({
        title: "New WS",
        scope: "apps/web",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("create generates a distinct idempotencyKey per call", async () => {
    mockedRequest.mockResolvedValue({ id: "ws-x" });
    const client = new LiveWorkspacesClient();

    await client.create({ title: "A" } as CreateWorkspaceRequest);
    await client.create({ title: "B" } as CreateWorkspaceRequest);

    const firstKey = (mockedRequest.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey;
    const secondKey = (mockedRequest.mock.calls[1][1] as { idempotencyKey: string }).idempotencyKey;
    expect(firstKey).not.toEqual(secondKey);
  });

  it("delete forwards workspace.delete with the workspaceId", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "ws-1" });
    const client = new LiveWorkspacesClient();

    expect(await client.delete("ws-1")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("workspace.delete", { workspaceId: "ws-1" });
  });

  it("setActive forwards workspace.setActive with the workspaceId", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveWorkspacesClient();

    expect(await client.setActive("ws-1")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("workspace.setActive", { workspaceId: "ws-1" });
  });

  it("maps a daemon error to a failed MutationResult without throwing", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("workspace exists"));
    const client = new LiveWorkspacesClient();

    expect(await client.delete("ws-1")).toEqual({ success: false, error: "workspace exists" });
  });
});

describe("LiveWorkspacesClient.getTokenUsage (PROTOCOL §5.23, fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("sends workspace.getTokenUsage with the workspaceId and unwraps the tokenUsage envelope", async () => {
    // PROTOCOL §5.23 response shape, verbatim.
    const tokenUsage = {
      byAgentId: {
        "agent-123": {
          inputTokens: 12000,
          outputTokens: 3400,
          cacheReadTokens: 8000,
          cacheCreationTokens: 1200,
        },
      },
      byModel: {
        "opus-4.8": {
          inputTokens: 12000,
          outputTokens: 3400,
          cacheReadTokens: 8000,
          cacheCreationTokens: 1200,
        },
      },
      totals: {
        inputTokens: 12000,
        outputTokens: 3400,
        cacheReadTokens: 8000,
        cacheCreationTokens: 1200,
      },
      lastScanAt: "2026-06-17T12:00:00Z",
    };
    mockedRequest.mockResolvedValueOnce({ tokenUsage });
    const client = new LiveWorkspacesClient();

    expect(await client.getTokenUsage("ws-abc")).toEqual(tokenUsage);
    expect(mockedRequest).toHaveBeenCalledWith("workspace.getTokenUsage", {
      workspaceId: "ws-abc",
    });
  });

  it("returns null when the result carries no tokenUsage object", async () => {
    mockedRequest.mockResolvedValueOnce({});
    const client = new LiveWorkspacesClient();

    expect(await client.getTokenUsage("ws-abc")).toBeNull();
  });
});
