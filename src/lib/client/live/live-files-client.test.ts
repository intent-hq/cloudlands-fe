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

import { backendRequest, onBackendNotification } from "./backend-transport";
import { LiveFilesClient } from "./live-files-client";

const mockedRequest = vi.mocked(backendRequest);
const mockedOnBackendNotification = vi.mocked(onBackendNotification);

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

describe("LiveFilesClient.explorerTree (fake transport)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forwards file.tree anchored at '.' and returns a synthetic root FileNode", async () => {
    mockedRequest.mockResolvedValueOnce([
      { path: "src", name: "src", isDirectory: true },
      { path: "README.md", name: "README.md", isDirectory: false },
    ]);
    const client = new LiveFilesClient();

    const tree = await client.explorerTree("ws-1");

    expect(mockedRequest).toHaveBeenCalledWith("file.tree", { workspaceId: "ws-1", path: "." });
    expect(tree).toEqual({
      name: "",
      path: "",
      type: "directory",
      children: [
        { name: "src", path: "src", type: "directory" },
        { name: "README.md", path: "README.md", type: "file" },
      ],
    });
  });

  it("resolves null when the daemon errors", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("tree boom"));
    const client = new LiveFilesClient();

    expect(await client.explorerTree("ws-1")).toBeNull();
  });
});

// Regression: `subscribe` re-emits to its handler on file:* notifications via
// `isEventInFamily`. When the matcher misread the wrapped `{event:{type,…}}`
// envelope, every events.event notification (including PTY terminal:data
// keystrokes) re-emitted. This test exercises the REAL matcher end-to-end and
// pins routing: terminal:data does NOT re-emit; file:changed does.
describe("LiveFilesClient.subscribe event-family routing (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  function setupCapture() {
    let captured: ((n: { method: string; params: unknown }) => void) | undefined;
    mockedOnBackendNotification.mockImplementation((cb) => {
      captured = cb;
      return () => {};
    });
    return { getNotify: () => captured };
  }

  it("does NOT re-emit on a wrapped terminal:data notification", () => {
    const { getNotify } = setupCapture();
    const client = new LiveFilesClient();
    const handler = vi.fn();

    const unsubscribe = client.subscribe(handler);
    // Initial snapshot emit is synchronous.
    expect(handler).toHaveBeenCalledTimes(1);

    getNotify()!({
      method: "events.event",
      params: { event: { type: "terminal:data", data: { chunk: "x" } } },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("DOES re-emit on a wrapped file:changed notification", () => {
    const { getNotify } = setupCapture();
    const client = new LiveFilesClient();
    const handler = vi.fn();

    const unsubscribe = client.subscribe(handler);
    expect(handler).toHaveBeenCalledTimes(1);

    getNotify()!({
      method: "events.event",
      params: { event: { type: "file:changed" }, subscriptionId: "s-1" },
    });

    expect(handler).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
