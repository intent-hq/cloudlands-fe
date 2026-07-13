import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: no terminal RPC ever reaches the user's real daemon.
// `runMutation` and the base64 encode/decode helpers stay real so the asserted
// wire method + params and the response-folding paths are exercised end-to-end.
vi.mock("./backend-transport", () => {
  const onBackendNotification = vi.fn();
  return {
    backendRequest: vi.fn(),
    backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-term-1" })),
    backendUnsubscribe: vi.fn(() => Promise.resolve()),
    onBackendNotification,
    // RESUB-1: subscribeEvents() installs a reconnect listener; these tests
    // do not exercise reconnect so the mock is a no-op disposer.
    onBackendReconnected: vi.fn(() => () => {}),
  };
});

import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
} from "./backend-transport";
import { LiveTerminalsClient } from "./live-terminals-client";

const mockedRequest = vi.mocked(backendRequest);
const mockedSubscribe = vi.mocked(backendSubscribe);
const mockedUnsubscribe = vi.mocked(backendUnsubscribe);
const mockedOnNotification = vi.mocked(onBackendNotification);

afterEach(() => {
  vi.clearAllMocks();
});

describe("LiveTerminalsClient wire requests (fake transport)", () => {
  it("create forwards terminal.create with workspaceId/cols/rows and surfaces the daemon-assigned terminalId", async () => {
    mockedRequest.mockResolvedValueOnce({ terminalId: "term-1" });
    const client = new LiveTerminalsClient();

    const result = await client.create({ workspaceId: "ws-1", cols: 80, rows: 24 });

    expect(mockedRequest).toHaveBeenCalledWith("terminal.create", {
      workspaceId: "ws-1",
      cols: 80,
      rows: 24,
    });
    expect(result).toEqual({ success: true, id: "term-1" });
  });

  it("create includes optional cwd / command when provided", async () => {
    mockedRequest.mockResolvedValueOnce({ terminalId: "term-2" });
    const client = new LiveTerminalsClient();

    await client.create({
      workspaceId: "ws-1",
      cols: 80,
      rows: 24,
      cwd: "/tmp/proj",
      command: "/bin/zsh",
    });

    expect(mockedRequest).toHaveBeenCalledWith("terminal.create", {
      workspaceId: "ws-1",
      cols: 80,
      rows: 24,
      cwd: "/tmp/proj",
      command: "/bin/zsh",
    });
  });

  it("create maps a transport error to a failed MutationResult", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("boom"));
    const client = new LiveTerminalsClient();

    expect(await client.create({ workspaceId: "ws-1", cols: 80, rows: 24 })).toEqual({
      success: false,
      error: "boom",
    });
  });

  it("write forwards terminal.write with the input bytes base64-encoded", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTerminalsClient();

    const result = await client.write("term-1", "ls\n");

    expect(result).toEqual({ success: true });
    // base64("ls\n") === "bHMK"
    expect(mockedRequest).toHaveBeenCalledWith("terminal.write", {
      terminalId: "term-1",
      data: "bHMK",
    });
  });

  it("resize forwards terminal.resize with cols/rows ints", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTerminalsClient();

    expect(await client.resize("term-1", 100, 30)).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("terminal.resize", {
      terminalId: "term-1",
      cols: 100,
      rows: 30,
    });
  });

  it("kill forwards terminal.kill with terminalId", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTerminalsClient();

    expect(await client.kill("term-1")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("terminal.kill", { terminalId: "term-1" });
  });

  it("getBuffer forwards terminal.getBuffer and decodes the base64 scrollback", async () => {
    // base64("ls\nfile.txt\n") === "bHMKZmlsZS50eHQK"
    mockedRequest.mockResolvedValueOnce({ data: "bHMKZmlsZS50eHQK" });
    const client = new LiveTerminalsClient();

    expect(await client.getBuffer("term-1")).toEqual("ls\nfile.txt\n");
    expect(mockedRequest).toHaveBeenCalledWith("terminal.getBuffer", { terminalId: "term-1" });
  });

  it("getBuffer threads maxBytes through when provided", async () => {
    mockedRequest.mockResolvedValueOnce({ data: "" });
    const client = new LiveTerminalsClient();

    await client.getBuffer("term-1", 4096);
    expect(mockedRequest).toHaveBeenCalledWith("terminal.getBuffer", {
      terminalId: "term-1",
      maxBytes: 4096,
    });
  });

  it("getBuffer folds transport failures to an empty string", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("boom"));
    const client = new LiveTerminalsClient();

    expect(await client.getBuffer("term-1")).toEqual("");
  });

  it("output forwards terminal.readOutput with { workspaceId, terminalId } and accepts a bare string or { output }", async () => {
    // PROTOCOL §5.13 / router.rs `terminal.readOutput` requires `workspaceId`
    // alongside `terminalId` (mirrors the `script.*` fix in #25). Sending only
    // `{ terminalId }` is rejected by the daemon router.
    mockedRequest.mockResolvedValueOnce("plaintext-1");
    mockedRequest.mockResolvedValueOnce({ output: "plaintext-2" });
    const client = new LiveTerminalsClient();

    expect(await client.output("ws-1", "term-1")).toEqual("plaintext-1");
    expect(await client.output("ws-1", "term-1")).toEqual("plaintext-2");
    expect(mockedRequest).toHaveBeenNthCalledWith(1, "terminal.readOutput", {
      workspaceId: "ws-1",
      terminalId: "term-1",
    });
    expect(mockedRequest).toHaveBeenNthCalledWith(2, "terminal.readOutput", {
      workspaceId: "ws-1",
      terminalId: "term-1",
    });
  });

  it("list forwards terminal.list and shapes entries into TerminalTab", async () => {
    mockedRequest.mockResolvedValueOnce({
      terminals: [
        { terminalId: "term-1", workspaceId: "ws-1", title: "shell", createdAt: "2026-06-30T00:00:00Z" },
        { id: "term-2", workspaceId: "ws-1" },
      ],
    });
    const client = new LiveTerminalsClient();

    const tabs = await client.list("ws-1");
    expect(mockedRequest).toHaveBeenCalledWith("terminal.list", { workspaceId: "ws-1" });
    expect(tabs).toEqual([
      {
        id: "term-1",
        name: "shell",
        workspaceId: "ws-1",
        createdAt: "2026-06-30T00:00:00Z",
        isConnected: true,
      },
      {
        id: "term-2",
        name: "Terminal term-2",
        workspaceId: "ws-1",
        createdAt: undefined,
        isConnected: true,
      },
    ]);
  });
});

describe("LiveTerminalsClient.subscribeEvents (PROTOCOL-shaped events)", () => {
  // Lets backendSubscribe's promise resolve so `subscribeEvents` can capture
  // the daemon-assigned subscriptionId before the test delivers notifications.
  async function flushSubscribe(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("routes terminal:data with a base64 chunk to onData decoded as UTF-8", async () => {
    let handler: ((n: { method: string; params?: unknown }) => void) | undefined;
    mockedOnNotification.mockImplementationOnce((cb) => {
      handler = cb as typeof handler;
      return () => {};
    });

    const onData = vi.fn();
    const client = new LiveTerminalsClient();
    client.subscribeEvents("term-1", { onData });
    await flushSubscribe();

    expect(mockedSubscribe).toHaveBeenCalledWith({
      eventTypes: ["terminal:data", "terminal:exit", "terminal:cwd", "terminal:title"],
    });

    // PROTOCOL §5.13 emits `events.event` with the event nested under params.event
    // and the resolving subscriptionId tagged on params.
    handler!({
      method: "events.event",
      params: {
        subscriptionId: "sub-term-1",
        event: {
          type: "terminal:data",
          workspaceId: "ws-1",
          id: "evt-1",
          timestamp: "2026-06-17T05:00:00.000Z",
          actor: { type: "system" },
          data: { terminalId: "term-1", chunk: "bHMKZmlsZS50eHQK" },
        },
      },
    });

    expect(onData).toHaveBeenCalledWith({ terminalId: "term-1", chunk: "ls\nfile.txt\n" });
  });

  it("ignores events for other terminals and unknown event types", async () => {
    let handler: ((n: { method: string; params?: unknown }) => void) | undefined;
    mockedOnNotification.mockImplementationOnce((cb) => {
      handler = cb as typeof handler;
      return () => {};
    });
    const onData = vi.fn();
    const onExit = vi.fn();
    const client = new LiveTerminalsClient();
    client.subscribeEvents("term-1", { onData, onExit });
    await flushSubscribe();

    // Other terminal — must be ignored even when tagged with our subscriptionId.
    handler!({
      method: "events.event",
      params: {
        subscriptionId: "sub-term-1",
        event: { type: "terminal:data", data: { terminalId: "term-other", chunk: "AA==" } },
      },
    });
    // Non-terminal family — must be ignored.
    handler!({
      method: "events.event",
      params: {
        subscriptionId: "sub-term-1",
        event: { type: "file:changed", data: { terminalId: "term-1" } },
      },
    });
    expect(onData).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it("routes terminal:exit with exitCode and terminal:cwd with cwd", async () => {
    let handler: ((n: { method: string; params?: unknown }) => void) | undefined;
    mockedOnNotification.mockImplementationOnce((cb) => {
      handler = cb as typeof handler;
      return () => {};
    });
    const onExit = vi.fn();
    const onCwd = vi.fn();
    const client = new LiveTerminalsClient();
    client.subscribeEvents("term-1", { onExit, onCwd });
    await flushSubscribe();

    handler!({
      method: "events.event",
      params: {
        subscriptionId: "sub-term-1",
        event: { type: "terminal:exit", data: { terminalId: "term-1", exitCode: 137 } },
      },
    });
    handler!({
      method: "events.event",
      params: {
        subscriptionId: "sub-term-1",
        event: { type: "terminal:cwd", data: { terminalId: "term-1", cwd: "/tmp" } },
      },
    });

    expect(onExit).toHaveBeenCalledWith({ terminalId: "term-1", exitCode: 137 });
    expect(onCwd).toHaveBeenCalledWith({ terminalId: "term-1", cwd: "/tmp" });
  });

  it("dedupes daemon fan-out: same terminal:data delivered under two subscriptionIds only fires onData for the matching one", async () => {
    let handler: ((n: { method: string; params?: unknown }) => void) | undefined;
    mockedOnNotification.mockImplementationOnce((cb) => {
      handler = cb as typeof handler;
      return () => {};
    });

    const onData = vi.fn();
    const client = new LiveTerminalsClient();
    client.subscribeEvents("term-1", { onData });
    await flushSubscribe();

    // The daemon fans out one events.event per matching subscription on the
    // socket, each tagged with its own params.subscriptionId. With a second
    // terminal subscription sharing the connection, the renderer sees the
    // same terminal:data twice — but only the delivery tagged with our
    // subscriptionId must reach this subscriber.
    const sameEvent = {
      type: "terminal:data",
      workspaceId: "ws-1",
      id: "evt-dup",
      data: { terminalId: "term-1", chunk: "YQ==" }, // base64("a")
    };
    handler!({
      method: "events.event",
      params: { subscriptionId: "sub-term-1", event: sameEvent },
    });
    handler!({
      method: "events.event",
      params: { subscriptionId: "sub-term-2", event: sameEvent },
    });

    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith({ terminalId: "term-1", chunk: "a" });
  });

  it("ignores a terminal:data tagged with a foreign subscriptionId even when data.terminalId matches", async () => {
    let handler: ((n: { method: string; params?: unknown }) => void) | undefined;
    mockedOnNotification.mockImplementationOnce((cb) => {
      handler = cb as typeof handler;
      return () => {};
    });

    const onData = vi.fn();
    const client = new LiveTerminalsClient();
    client.subscribeEvents("term-1", { onData });
    await flushSubscribe();

    handler!({
      method: "events.event",
      params: {
        subscriptionId: "sub-someone-else",
        event: {
          type: "terminal:data",
          data: { terminalId: "term-1", chunk: "YQ==" },
        },
      },
    });

    expect(onData).not.toHaveBeenCalled();
  });

  it("drops notifications that arrive before backendSubscribe resolves (no subscriptionId yet)", async () => {
    let handler: ((n: { method: string; params?: unknown }) => void) | undefined;
    mockedOnNotification.mockImplementationOnce((cb) => {
      handler = cb as typeof handler;
      return () => {};
    });

    // Defer subscribe resolution until after we deliver a notification.
    let resolveSubscribe: ((value: { subscriptionId: string }) => void) | undefined;
    mockedSubscribe.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubscribe = resolve;
      }),
    );

    const onData = vi.fn();
    const client = new LiveTerminalsClient();
    client.subscribeEvents("term-1", { onData });

    // No subscriptionId captured yet — deliveries must be dropped.
    handler!({
      method: "events.event",
      params: {
        subscriptionId: "sub-term-late",
        event: { type: "terminal:data", data: { terminalId: "term-1", chunk: "YQ==" } },
      },
    });
    expect(onData).not.toHaveBeenCalled();

    // After resolution, matching deliveries flow through.
    resolveSubscribe!({ subscriptionId: "sub-term-late" });
    await flushSubscribe();
    handler!({
      method: "events.event",
      params: {
        subscriptionId: "sub-term-late",
        event: { type: "terminal:data", data: { terminalId: "term-1", chunk: "Yg==" } },
      },
    });
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith({ terminalId: "term-1", chunk: "b" });
  });

  it("unsubscribes the daemon subscription on disposer", async () => {
    const offFn = vi.fn();
    mockedOnNotification.mockImplementationOnce(() => offFn);
    const client = new LiveTerminalsClient();

    const dispose = client.subscribeEvents("term-1", { onData: vi.fn() });
    // Let the subscribe promise resolve to capture the subscriptionId.
    await Promise.resolve();
    await Promise.resolve();

    dispose();
    expect(offFn).toHaveBeenCalledTimes(1);
    expect(mockedUnsubscribe).toHaveBeenCalledWith("sub-term-1");
  });
});
