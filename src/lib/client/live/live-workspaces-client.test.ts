import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateWorkspaceRequest, UpdateWorkspaceRequest } from "$shared/types";

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

  it("create surfaces the daemon's { workspace } normalized on the result", async () => {
    // PROTOCOL §5.1: workspace.create → { workspace: Workspace }. The legacy
    // `workspace:create` bridge hands this to the creation flow as
    // `result.data` (navigation needs the new id).
    mockedRequest.mockResolvedValueOnce({
      workspace: {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Fresh",
        branch: "intent/fresh",
        status: "Active",
      },
    });
    const client = new LiveWorkspacesClient();

    const result = await client.create({ title: "Fresh" } as CreateWorkspaceRequest);

    expect(result.success).toBe(true);
    expect(result.workspace).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      title: "Fresh",
      branch: "intent/fresh",
    });
  });

  it("create folds a daemon error into { success: false, error }", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("worktree add failed"));
    const client = new LiveWorkspacesClient();

    const result = await client.create({ title: "Broken" } as CreateWorkspaceRequest);

    expect(result).toEqual({ success: false, error: "worktree add failed" });
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

describe("LiveWorkspacesClient update/archive/unarchive (PROTOCOL §5.1, fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("update maps the FE id to workspaceId and surfaces the daemon's updated workspace", async () => {
    const wsId = "0f7a13d7-5a96-455a-9aaf-e62303a8f2d1";
    // PROTOCOL §5.1: workspace.update returns { workspace: Workspace }.
    mockedRequest.mockResolvedValueOnce({
      workspace: { id: wsId, title: "Renamed", branch: "main", status: "active" },
    });
    const client = new LiveWorkspacesClient();

    const result = await client.update({ id: wsId, title: "Renamed" } as UpdateWorkspaceRequest);

    expect(mockedRequest).toHaveBeenCalledWith("workspace.update", {
      workspaceId: wsId,
      title: "Renamed",
    });
    expect(result.success).toBe(true);
    expect(result.workspace).toMatchObject({ id: wsId, title: "Renamed", branch: "main" });
  });

  it("update folds a daemon error into a failed result without throwing", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("update failed"));
    const client = new LiveWorkspacesClient();

    expect(await client.update({ id: "ws-1", title: "X" } as UpdateWorkspaceRequest)).toEqual({
      success: false,
      error: "update failed",
    });
  });

  it("archive forwards workspace.archive with the workspaceId", async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });
    const client = new LiveWorkspacesClient();

    expect(await client.archive("ws-1")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("workspace.archive", { workspaceId: "ws-1" });
  });

  it("unarchive forwards workspace.unarchive with the workspaceId (archive undo)", async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });
    const client = new LiveWorkspacesClient();

    expect(await client.unarchive("ws-1")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("workspace.unarchive", { workspaceId: "ws-1" });
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

describe("LiveWorkspacesClient context (PROTOCOL §5.1, fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("getContext sends workspaceId and unwraps items", async () => {
    const items = [
      {
        id: "n1",
        type: "note",
        title: "note",
        provider: "internal",
        noteId: "n1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockedRequest.mockResolvedValueOnce({ items });
    const client = new LiveWorkspacesClient();

    expect(await client.getContext("ws-abc")).toEqual(items);
    expect(mockedRequest).toHaveBeenCalledWith("workspace.getContext", {
      workspaceId: "ws-abc",
    });
  });

  it("getContext returns an empty array when items is missing / non-array", async () => {
    mockedRequest.mockResolvedValueOnce({});
    const client = new LiveWorkspacesClient();
    expect(await client.getContext("ws-abc")).toEqual([]);
  });

  it("updateContext forwards items as full-list replacement and returns persisted list", async () => {
    const items = [
      {
        id: "u-1",
        type: "url",
        title: "docs",
        provider: "browser",
        url: "https://example.com",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockedRequest.mockResolvedValueOnce({ items });
    const client = new LiveWorkspacesClient();

    expect(await client.updateContext("ws-abc", items as never)).toEqual(items);
    expect(mockedRequest).toHaveBeenCalledWith("workspace.updateContext", {
      workspaceId: "ws-abc",
      items,
    });
  });

  // The context slice keys items by `id` and discriminates variants by `type`,
  // so rows missing either would corrupt the Collection. The client filters
  // those out at the seam before they reach the reducer.
  it("getContext filters out rows missing id or type before returning", async () => {
    const good = {
      id: "n1",
      type: "note",
      title: "note",
      provider: "internal",
      noteId: "n1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    mockedRequest.mockResolvedValueOnce({
      items: [good, { title: "missing id" }, { id: "n2" }, null, "n3"],
    });
    const client = new LiveWorkspacesClient();

    expect(await client.getContext("ws-abc")).toEqual([good]);
  });

  it("updateContext filters out rows missing id or type before returning", async () => {
    const good = {
      id: "u-1",
      type: "browser-url",
      title: "docs",
      provider: "browser",
      url: "https://example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    mockedRequest.mockResolvedValueOnce({
      items: [good, { id: "u-2", title: "missing type" }, { type: "note" }],
    });
    const client = new LiveWorkspacesClient();

    expect(await client.updateContext("ws-abc", [good] as never)).toEqual([good]);
  });
});
