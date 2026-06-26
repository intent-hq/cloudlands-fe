import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no file mutation ever
// reaches the user's real daemon/disk. `runMutation` / `newIdempotencyKey` stay
// real so the asserted method + params and the success/error folding are the
// genuine code paths.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from "./backend-transport";
import { LiveFilesClient } from "./live-files-client";

const mockedRequest = vi.mocked(backendRequest);

describe("LiveFilesClient mutations (fake transport)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("write forwards file.write with workspace-relative path + an idempotencyKey", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveFilesClient();

    const result = await client.write("ws-1", "src/a.ts", "hello");

    expect(result).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      "file.write",
      expect.objectContaining({
        workspaceId: "ws-1",
        path: "src/a.ts",
        content: "hello",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("write generates a distinct idempotencyKey per call", async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const client = new LiveFilesClient();

    await client.write("ws-1", "a.ts", "x");
    await client.write("ws-1", "a.ts", "y");

    const first = (mockedRequest.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey;
    const second = (mockedRequest.mock.calls[1][1] as { idempotencyKey: string }).idempotencyKey;
    expect(first).not.toEqual(second);
  });

  it("delete forwards file.delete WITHOUT an idempotencyKey", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveFilesClient();

    expect(await client.delete("ws-1", "src/a.ts")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("file.delete", {
      workspaceId: "ws-1",
      path: "src/a.ts",
    });
  });

  it("mkdir forwards file.mkdir with an idempotencyKey", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveFilesClient();

    expect(await client.mkdir("ws-1", "src/new")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      "file.mkdir",
      expect.objectContaining({
        workspaceId: "ws-1",
        path: "src/new",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("rename forwards file.rename with old/new paths + an idempotencyKey", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveFilesClient();

    expect(await client.rename("ws-1", "old.ts", "new.ts")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      "file.rename",
      expect.objectContaining({
        workspaceId: "ws-1",
        oldPath: "old.ts",
        newPath: "new.ts",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("maps a daemon error to a failed MutationResult without throwing", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("boom"));
    const client = new LiveFilesClient();

    expect(await client.write("ws-1", "a.ts", "x")).toEqual({ success: false, error: "boom" });
  });
});
