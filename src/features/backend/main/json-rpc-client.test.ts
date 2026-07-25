import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonRpcError, mapErrorCode } from "./json-rpc-errors";
import { JsonRpcClient, ReverseRpcHandlerError } from "./json-rpc-client";

/**
 * In-memory fake socket: captures outbound writes and lets tests inject inbound
 * data / lifecycle events. Never touches a real socket.
 */
class FakeSocket extends EventEmitter {
  writes: string[] = [];
  destroyed = false;

  write(data: string): boolean {
    this.writes.push(data);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** Simulate inbound bytes from the daemon. */
  receive(chunk: string): void {
    this.emit("data", Buffer.from(chunk));
  }

  /** Simulate a raw inbound byte chunk (used for chunk-boundary tests). */
  receiveBytes(buf: Buffer): void {
    this.emit("data", buf);
  }

  /** Simulate a successful connection. */
  open(): void {
    this.emit("connect");
  }
}

function makeClient(): { client: JsonRpcClient; socket: FakeSocket } {
  const socket = new FakeSocket();
  const client = new JsonRpcClient({
    socketFactory: () => socket as unknown as Duplex,
    heartbeatIntervalMs: 0,
    requestTimeoutMs: 1000,
  });
  return { client, socket };
}

describe("JsonRpcClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("frames requests as newline-delimited JSON with incrementing ids", async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request("workspace.list", { filter: "active" });
    expect(socket.writes).toHaveLength(1);
    const line = socket.writes[0];
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "workspace.list",
      params: { filter: "active" },
    });

    socket.receive(`{"jsonrpc":"2.0","id":1,"result":{"workspaces":[]}}\n`);
    await expect(promise).resolves.toEqual({ workspaces: [] });
    client.dispose();
  });

  it("correlates concurrent responses by id regardless of arrival order", async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const first = client.request("a");
    const second = client.request("b");
    expect(JSON.parse(socket.writes[0]).id).toBe(1);
    expect(JSON.parse(socket.writes[1]).id).toBe(2);

    socket.receive(`{"jsonrpc":"2.0","id":2,"result":"second"}\n`);
    socket.receive(`{"jsonrpc":"2.0","id":1,"result":"first"}\n`);

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    client.dispose();
  });

  it("reassembles messages split across data chunks", async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request("ping");
    socket.receive(`{"jsonrpc":"2.0","id":1,`);
    socket.receive(`"result":42}\n`);
    await expect(promise).resolves.toBe(42);
    client.dispose();
  });

  it("reassembles a multi-byte UTF-8 char split across two data chunks", async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request("note.get");
    // "café-🚀": é is 2 UTF-8 bytes, 🚀 (U+1F680) is 4 bytes (F0 9F 9A 80).
    const value = "caf\u00e9-\u{1F680}";
    const full = Buffer.from(`{"jsonrpc":"2.0","id":1,"result":"${value}"}\n`, "utf8");
    // Split inside the rocket emoji's 4-byte sequence (mid multi-byte boundary).
    const splitAt = full.indexOf(0xf0) + 2;
    socket.receiveBytes(full.subarray(0, splitAt));
    socket.receiveBytes(full.subarray(splitAt));

    await expect(promise).resolves.toBe(value);
    client.dispose();
  });

  it("dispatches notifications (no id) to listeners", async () => {
    const { client, socket } = makeClient();
    const received: Array<{ method: string; params?: unknown }> = [];
    client.on("notification", (n) => received.push(n));
    client.start();
    socket.open();

    socket.receive(
      `{"jsonrpc":"2.0","method":"events.event","params":{"type":"workspace:updated"}}\n`,
    );
    expect(received).toEqual([
      { method: "events.event", params: { type: "workspace:updated" } },
    ]);
    client.dispose();
  });

  it("maps numeric error codes to string codes on error.data.code", async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request("missing.method");
    socket.receive(
      `{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"no such method"}}\n`,
    );

    await expect(promise).rejects.toMatchObject({
      name: "JsonRpcError",
      code: "METHOD_NOT_FOUND",
      rpcCode: -32601,
      data: { code: "METHOD_NOT_FOUND" },
    });
    client.dispose();
  });

  it("prefers an explicit daemon data.code over the numeric mapping", async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request("workspace.get");
    socket.receive(
      `{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"nope","data":{"code":"WORKSPACE_NOT_FOUND"}}}\n`,
    );

    await expect(promise).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND", rpcCode: -32000 });
    client.dispose();
  });

  it("times out a request that never receives a response", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 50,
    });
    client.start();
    socket.open();

    const promise = client.request("slow");
    const expectation = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(60);
    await expectation;
    client.dispose();
  });

  // Per-call `timeoutMs` override lets long-running daemon operations
  // (e.g. `git.pull`, whose own bound exceeds the flat client default) run
  // longer than the flat `requestTimeoutMs` without disturbing other requests.
  it("honours a per-call timeoutMs override longer than the client default", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 50,
    });
    client.start();
    socket.open();

    const promise = client.request("git.pull", { repoPath: "/r", branchName: "main" }, {
      timeoutMs: 500,
    });
    const settled = vi.fn();
    void promise.then(settled, settled);

    // Well past the default (50ms) but well before the override (500ms): the
    // request is still in flight because the override wins.
    await vi.advanceTimersByTimeAsync(120);
    expect(settled).not.toHaveBeenCalled();

    // Just past the override: the request times out on the override boundary.
    const expectation = expect(promise).rejects.toThrow(/timed out: git\.pull/);
    await vi.advanceTimersByTimeAsync(400);
    await expectation;
    client.dispose();
  });

  it("falls back to the client default when the per-call override is absent or invalid", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 50,
    });
    client.start();
    socket.open();

    // No options → default. Negative/zero/NaN also fall back so a bad caller
    // cannot install a zero-timer that trips synchronously.
    for (const bad of [undefined, { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: Number.NaN }]) {
      const promise = bad === undefined ? client.request("slow") : client.request("slow", undefined, bad);
      const expectation = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(60);
      await expectation;
    }

    client.dispose();
  });

  it("rejects in-flight requests when the connection drops", async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request("inflight");
    const expectation = expect(promise).rejects.toThrow();
    socket.emit("close");
    await expectation;
    client.dispose();
  });
});

describe("JsonRpcClient reverse requests (§5.14)", () => {
  /** Await the microtask queue so async handler chains settle before we assert writes. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it("dispatches an inbound request (rev-* id + method) to the registered handler and writes the result", async () => {
    const { client, socket } = makeClient();
    const handler = vi.fn().mockResolvedValue({ ok: true });
    client.registerMethod("browser.exec", handler);
    client.start();
    socket.open();

    socket.receive(
      `{"jsonrpc":"2.0","id":"rev-1","method":"browser.exec","params":{"actions":[{"action":"listTabs"}]}}\n`,
    );
    await flush();

    expect(handler).toHaveBeenCalledWith({ actions: [{ action: "listTabs" }] });
    expect(socket.writes).toHaveLength(1);
    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: "2.0",
      id: "rev-1",
      result: { ok: true },
    });
    client.dispose();
  });

  it("returns METHOD_NOT_FOUND (-32601) for an inbound request with no registered handler", async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    socket.receive(`{"jsonrpc":"2.0","id":"rev-1","method":"nope","params":{}}\n`);
    await flush();

    expect(socket.writes).toHaveLength(1);
    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: "2.0",
      id: "rev-1",
      error: { code: -32601, message: "Method not found: nope" },
    });
    client.dispose();
  });

  it("returns INTERNAL_ERROR (-32603) when a handler throws a plain Error", async () => {
    const { client, socket } = makeClient();
    client.registerMethod("browser.exec", () => {
      throw new Error("kaboom");
    });
    client.start();
    socket.open();

    socket.receive(`{"jsonrpc":"2.0","id":"rev-1","method":"browser.exec","params":{}}\n`);
    await flush();

    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: "2.0",
      id: "rev-1",
      error: { code: -32603, message: "kaboom" },
    });
    client.dispose();
  });

  it("honours ReverseRpcHandlerError code and data", async () => {
    const { client, socket } = makeClient();
    client.registerMethod("browser.exec", () => {
      throw new ReverseRpcHandlerError(-32602, "bad params", { field: "actions" });
    });
    client.start();
    socket.open();

    socket.receive(`{"jsonrpc":"2.0","id":"rev-1","method":"browser.exec","params":{}}\n`);
    await flush();

    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: "2.0",
      id: "rev-1",
      error: { code: -32602, message: "bad params", data: { field: "actions" } },
    });
    client.dispose();
  });

  it("re-registration replaces the previous handler; disposer only tears down its own", async () => {
    const { client, socket } = makeClient();
    const first = vi.fn().mockResolvedValue("first");
    const second = vi.fn().mockResolvedValue("second");
    const disposeFirst = client.registerMethod("m", first);
    client.registerMethod("m", second);
    // Stale disposer must NOT unregister the newer handler.
    disposeFirst();
    client.start();
    socket.open();

    socket.receive(`{"jsonrpc":"2.0","id":"rev-1","method":"m","params":null}\n`);
    await flush();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.writes[0]).result).toBe("second");
    client.dispose();
  });

  it("does not interfere with normal outbound request/response correlation", async () => {
    const { client, socket } = makeClient();
    client.registerMethod("browser.exec", async () => ({ ok: true }));
    client.start();
    socket.open();

    const promise = client.request("workspace.list");
    socket.receive(`{"jsonrpc":"2.0","id":1,"result":{"workspaces":[]}}\n`);
    await expect(promise).resolves.toEqual({ workspaces: [] });
    client.dispose();
  });
});

describe("JsonRpcClient reconnect + heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeReconnectingClient(overrides: Record<string, unknown> = {}): {
    client: JsonRpcClient;
    sockets: FakeSocket[];
  } {
    const sockets: FakeSocket[] = [];
    const client = new JsonRpcClient({
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as Duplex;
      },
      heartbeatIntervalMs: 0,
      reconnectDelayMs: 100,
      maxReconnectDelayMs: 1000,
      ...overrides,
    });
    client.on("error", () => {});
    return { client, sockets };
  }

  it("reconnects after the socket closes, applying exponential backoff", async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    client.start();
    expect(sockets).toHaveLength(1);

    // First drop: backoff = 100ms.
    sockets[0].emit("close");
    await vi.advanceTimersByTimeAsync(99);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);

    // Second drop without a successful connect: backoff doubles to 200ms.
    sockets[1].emit("close");
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(3);

    client.dispose();
  });

  // #439: a stopped daemon must be re-probed at least every 5s while
  // disconnected, indefinitely — the daemon-loss modal relies on the main
  // process noticing a returning daemon promptly and never giving up.
  it("caps the default reconnect backoff at 5s and retries indefinitely", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const client = new JsonRpcClient({
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as Duplex;
      },
      heartbeatIntervalMs: 0,
      // reconnectDelayMs / maxReconnectDelayMs intentionally omitted: this
      // asserts the DEFAULTS (1s base, 5s cap).
    });
    client.on("error", () => {});
    client.start();
    expect(sockets).toHaveLength(1);

    // Backoff doubles 1s → 2s → 4s, then clamps to 5s.
    for (const delay of [1000, 2000, 4000, 5000]) {
      sockets[sockets.length - 1].emit("close");
      const before = sockets.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sockets).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(before + 1);
    }

    // Many further drops: every retry stays at the 5s cap — no give-up.
    for (let i = 0; i < 10; i++) {
      sockets[sockets.length - 1].emit("close");
      const before = sockets.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(sockets).toHaveLength(before + 1);
    }

    client.dispose();
  });

  it("resets the backoff after a successful reconnect", async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    client.start();

    sockets[0].emit("close");
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);

    // A successful connect resets the backoff to the base delay.
    sockets[1].open();
    sockets[1].emit("close");
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(3);

    client.dispose();
  });

  it("invokes the health check on each heartbeat tick while connected", async () => {
    vi.useFakeTimers();
    const healthCheck = vi.fn().mockResolvedValue(undefined);
    const { client, sockets } = makeReconnectingClient({
      heartbeatIntervalMs: 1000,
      healthCheck,
    });
    client.start();
    sockets[0].open();
    expect(healthCheck).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(healthCheck).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(healthCheck).toHaveBeenCalledTimes(2);

    client.dispose();
  });

  it("tears down and reconnects when the health check fails", async () => {
    vi.useFakeTimers();
    const healthCheck = vi.fn().mockRejectedValue(new Error("half-open socket"));
    const { client, sockets } = makeReconnectingClient({
      heartbeatIntervalMs: 1000,
      healthCheck,
    });
    client.start();
    sockets[0].open();
    expect(client.getStatus()).toBe("connected");

    // Heartbeat tick → health check rejects → connection torn down.
    await vi.advanceTimersByTimeAsync(1000);
    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(client.getStatus()).toBe("disconnected");

    // Backoff reconnect schedules a fresh socket.
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    client.dispose();
  });

  it("emits `reconnected` on the 2nd (and later) successful connect but not on the first (RESUB-1)", async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    const reconnected = vi.fn();
    client.on("reconnected", reconnected);
    client.start();

    // First successful connect is the ordinary boot path — NOT a reconnect.
    sockets[0].open();
    expect(reconnected).not.toHaveBeenCalled();

    // Drop and let the backoff reconnect fire.
    sockets[0].emit("close");
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(reconnected).toHaveBeenCalledTimes(1);

    // Second drop + reconnect fires the event again.
    sockets[1].emit("close");
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(3);
    sockets[2].open();
    expect(reconnected).toHaveBeenCalledTimes(2);

    client.dispose();
  });
});

describe("JsonRpcClient client.hello identity handshake (§5.17)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Await the microtask queue so async handshake chains settle before asserting. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  /** PROTOCOL §5.17-shaped hello result (server block confirmed on the wire). */
  const helloResult = (clientId: string) => ({
    clientId,
    protocolVersion: "2.2",
    server: {
      locality: "local",
      hasDisplay: true,
      osArch: "darwin/arm64",
      version: "0.1.0",
      protocolVersion: "2.2",
      capabilities: { liveState: true },
    },
  });

  function makeHelloClient(clientId = "cli-7f3a"): {
    client: JsonRpcClient;
    sockets: FakeSocket[];
    onHelloResult: ReturnType<typeof vi.fn>;
  } {
    const sockets: FakeSocket[] = [];
    const onHelloResult = vi.fn();
    const client = new JsonRpcClient({
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as Duplex;
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 1000,
      reconnectDelayMs: 100,
      maxReconnectDelayMs: 1000,
      helloParams: () => ({ clientId }),
      onHelloResult,
    });
    client.on("error", () => {});
    return { client, sockets, onHelloResult };
  }

  it("sends client.hello with the persisted clientId as the FIRST frame on connect, before scoped work", async () => {
    const { client, sockets, onHelloResult } = makeHelloClient();
    client.start();
    const socket = sockets[0];

    // Scoped work issued before the handshake completes must queue behind it.
    const draftsPromise = client.request("drafts.get", {
      workspaceId: "ws-1",
      agentId: "agent-1",
    });
    socket.open();
    await flush();

    // Exactly one frame on the wire: the identity hello. drafts.get is queued.
    expect(socket.writes).toHaveLength(1);
    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "client.hello",
      params: { clientId: "cli-7f3a" },
    });
    expect(client.getStatus()).toBe("connecting");

    socket.receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: helloResult("cli-7f3a") })}\n`,
    );
    await flush();

    expect(client.getStatus()).toBe("connected");
    expect(onHelloResult).toHaveBeenCalledWith(helloResult("cli-7f3a"));
    expect(socket.writes).toHaveLength(2);
    expect(JSON.parse(socket.writes[1])).toMatchObject({ method: "drafts.get" });

    socket.receive(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: null })}\n`);
    await expect(draftsPromise).resolves.toBeNull();
    client.dispose();
  });

  it("re-presents the SAME clientId on every reconnect, before emitting `reconnected`", async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeHelloClient();
    const reconnected = vi.fn();
    client.on("reconnected", reconnected);
    client.start();
    sockets[0].open();
    await vi.advanceTimersByTimeAsync(1);

    const firstHello = JSON.parse(sockets[0].writes[0]);
    expect(firstHello.method).toBe("client.hello");
    sockets[0].receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: firstHello.id, result: helloResult("cli-7f3a") })}\n`,
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getStatus()).toBe("connected");

    // Drop the connection; the backoff reconnect opens a fresh socket, which
    // starts anonymous on the daemon side — the hello MUST be replayed with
    // the same persisted identity before consumers resubscribe.
    sockets[0].emit("close");
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    await vi.advanceTimersByTimeAsync(1);

    const secondHello = JSON.parse(sockets[1].writes[0]);
    expect(secondHello.method).toBe("client.hello");
    expect(secondHello.params).toEqual({ clientId: "cli-7f3a" });
    expect(secondHello.params).toEqual(firstHello.params);
    expect(reconnected).not.toHaveBeenCalled();

    sockets[1].receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: secondHello.id, result: helloResult("cli-7f3a") })}\n`,
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getStatus()).toBe("connected");
    expect(reconnected).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it("merges the persisted clientId into a caller-supplied client.hello (renderer capability probe)", async () => {
    const { client, sockets, onHelloResult } = makeHelloClient();
    client.start();
    sockets[0].open();
    await flush();
    sockets[0].receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: helloResult("cli-7f3a") })}\n`,
    );
    await flush();

    // The renderer probe forwards `client.hello {}` over backend:request; the
    // shared client must present the SAME persisted identity — an anonymous
    // re-hello would mint a fresh clientId and orphan its drafts (§5.16).
    const probe = client.request("client.hello", {});
    await flush();
    expect(JSON.parse(sockets[0].writes[1])).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "client.hello",
      params: { clientId: "cli-7f3a" },
    });
    sockets[0].receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, result: helloResult("cli-7f3a") })}\n`,
    );
    await expect(probe).resolves.toEqual(helloResult("cli-7f3a"));
    expect(onHelloResult).toHaveBeenLastCalledWith(helloResult("cli-7f3a"));

    // Caller-supplied fields survive; the persisted identity wins on clientId.
    const named = client.request("client.hello", { name: "Intent Desktop", clientId: "cli-rogue" });
    await flush();
    expect(JSON.parse(sockets[0].writes[2]).params).toEqual({
      name: "Intent Desktop",
      clientId: "cli-7f3a",
    });
    sockets[0].receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: 3, result: helloResult("cli-7f3a") })}\n`,
    );
    await named;
    client.dispose();
  });

  it("still flips to connected when the hello handshake errors (identity degrades, transport survives)", async () => {
    const { client, sockets, onHelloResult } = makeHelloClient();
    client.start();
    sockets[0].open();
    await flush();

    sockets[0].receive(
      `{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"no such method"}}\n`,
    );
    await flush();

    expect(client.getStatus()).toBe("connected");
    expect(onHelloResult).not.toHaveBeenCalled();
    client.dispose();
  });

  it("bounds the connect-time handshake at 5s: an unanswered hello degrades to anonymous instead of stalling queued work for the full request timeout", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const onHelloResult = vi.fn();
    const client = new JsonRpcClient({
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as Duplex;
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 30_000,
      helloParams: () => ({ clientId: "cli-7f3a" }),
      onHelloResult,
    });
    client.on("error", () => {});
    client.start();
    sockets[0].open();
    await vi.advanceTimersByTimeAsync(1);

    expect(JSON.parse(sockets[0].writes[0]).method).toBe("client.hello");
    expect(client.getStatus()).toBe("connecting");

    // The daemon never answers the hello. Well before the 30s request
    // timeout the handshake bound (5s) trips and the connection is reported
    // connected anyway — identity degrades, transport survives.
    await vi.advanceTimersByTimeAsync(4_998);
    expect(client.getStatus()).toBe("connecting");
    await vi.advanceTimersByTimeAsync(2);
    expect(client.getStatus()).toBe("connected");
    expect(onHelloResult).not.toHaveBeenCalled();
    client.dispose();
  });

  it("hands a daemon-minted clientId to onHelloResult when the provider has none (first-run)", async () => {
    const sockets: FakeSocket[] = [];
    const onHelloResult = vi.fn();
    const client = new JsonRpcClient({
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as Duplex;
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 1000,
      helloParams: () => ({}),
      onHelloResult,
    });
    client.on("error", () => {});
    client.start();
    sockets[0].open();
    await flush();

    expect(JSON.parse(sockets[0].writes[0])).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "client.hello",
      params: {},
    });
    sockets[0].receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: helloResult("cli-9b21") })}\n`,
    );
    await flush();
    expect(onHelloResult).toHaveBeenCalledWith(helloResult("cli-9b21"));
    client.dispose();
  });
});

describe("mapErrorCode", () => {
  it("maps reserved codes and falls back to ranges", () => {
    expect(mapErrorCode(-32700)).toBe("PARSE_ERROR");
    expect(mapErrorCode(-32600)).toBe("INVALID_REQUEST");
    expect(mapErrorCode(-32601)).toBe("METHOD_NOT_FOUND");
    expect(mapErrorCode(-32602)).toBe("INVALID_PARAMS");
    expect(mapErrorCode(-32603)).toBe("INTERNAL_ERROR");
    expect(mapErrorCode(-32050)).toBe("SERVER_ERROR");
    expect(mapErrorCode(1234)).toBe("UNKNOWN_ERROR");
  });

  it("JsonRpcError mirrors the resolved code onto data.code", () => {
    const error = new JsonRpcError({ code: -32602, message: "bad" });
    expect(error.code).toBe("INVALID_PARAMS");
    expect(error.data).toEqual({ code: "INVALID_PARAMS" });
  });

  it("JsonRpcError preserves a string daemon data as data.detail", () => {
    // The daemon router sends the -32603 Internal error cause as a plain
    // string in error.data; it must survive normalization for the renderer.
    const error = new JsonRpcError({
      code: -32603,
      message: "Internal error",
      data: "Could not find the search context in the document.",
    });
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.data).toEqual({
      code: "INTERNAL_ERROR",
      detail: "Could not find the search context in the document.",
    });
    expect(error.toErrorPayload()).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal error",
      data: {
        code: "INTERNAL_ERROR",
        detail: "Could not find the search context in the document.",
      },
      rpcCode: -32603,
    });
  });
});
