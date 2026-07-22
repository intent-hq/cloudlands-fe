/**
 * Unit tests for the browser WebSocket `BackendTransport`.
 *
 * A fake `BrowserWebSocketLike` drives the transport deterministically: tests
 * assert the exact JSON-RPC frames written to the wire (PROTOCOL.md §1–§4)
 * and feed back protocol-shaped responses/notifications. Covers request
 * correlation, error mapping to `BackendError`, timeouts, reconnect with
 * backoff + the `reconnected` signal (RESUB-1), notification fanout
 * (including `subscription.push`), subscribe/unsubscribe semantics, reverse
 * requests, and URL resolution from `VITE_INTENTD_WS_URL`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "./backend-transport-types";
import {
  BrowserWebSocketTransport,
  type BrowserWebSocketLike,
  createBrowserWebSocketTransport,
  resolveBrowserWsUrl,
} from "./browser-websocket-transport";

class FakeWebSocket implements BrowserWebSocketLike {
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onclose: ((event?: unknown) => void) | null = null;
  readonly sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.();
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  receiveRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  drop(): void {
    this.onclose?.();
  }

  lastFrame(): Record<string, unknown> {
    expect(this.sent.length).toBeGreaterThan(0);
    return JSON.parse(this.sent[this.sent.length - 1]) as Record<string, unknown>;
  }
}

/** Transport wired to fake sockets; tracks every socket the factory creates. */
function createHarness(options?: {
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}) {
  const sockets: FakeWebSocket[] = [];
  const transport = new BrowserWebSocketTransport({
    url: "ws://127.0.0.1:9100/rpc?token=test",
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    ...options,
  });
  return { transport, sockets, socket: () => sockets[sockets.length - 1] };
}

/** Flush pending microtasks so `ensureConnected().then(send)` runs. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveBrowserWsUrl", () => {
  it("returns a trimmed ws:// URL", () => {
    expect(resolveBrowserWsUrl(" ws://localhost:9100/rpc ")).toBe("ws://localhost:9100/rpc");
  });

  it("accepts wss:// URLs with a token query param", () => {
    expect(resolveBrowserWsUrl("wss://daemon.example/rpc?token=abc")).toBe(
      "wss://daemon.example/rpc?token=abc",
    );
  });

  it("returns undefined for unset, blank, or non-string values", () => {
    expect(resolveBrowserWsUrl(undefined)).toBeUndefined();
    expect(resolveBrowserWsUrl("")).toBeUndefined();
    expect(resolveBrowserWsUrl("   ")).toBeUndefined();
    expect(resolveBrowserWsUrl(42)).toBeUndefined();
  });

  it("rejects non-websocket URLs and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveBrowserWsUrl("http://localhost:9100/rpc")).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("BrowserWebSocketTransport", () => {
  it("connects lazily and sends a JSON-RPC 2.0 request frame", async () => {
    const { transport, sockets, socket } = createHarness();
    expect(sockets).toHaveLength(0);

    const promise = transport.request("workspace.list", { limit: 5 });
    expect(sockets).toHaveLength(1);
    expect(socket().url).toBe("ws://127.0.0.1:9100/rpc?token=test");

    socket().open();
    await flush();
    expect(socket().lastFrame()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "workspace.list",
      params: { limit: 5 },
    });

    socket().receive({ jsonrpc: "2.0", id: 1, result: { workspaces: [] } });
    await expect(promise).resolves.toEqual({ workspaces: [] });
    transport.dispose();
  });

  it("correlates concurrent requests by id, including out-of-order responses", async () => {
    const { transport, socket } = createHarness();
    const first = transport.request("note.get", { noteId: "a" });
    socket().open();
    await flush();
    const second = transport.request("note.get", { noteId: "b" });
    await flush();

    const frames = socket().sent.map((raw) => JSON.parse(raw) as { id: number });
    expect(frames.map((f) => f.id)).toEqual([1, 2]);

    socket().receive({ jsonrpc: "2.0", id: 2, result: "second" });
    socket().receive({ jsonrpc: "2.0", id: 1, result: "first" });
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    transport.dispose();
  });

  it("rejects with a BackendError mapping the numeric JSON-RPC code", async () => {
    const { transport, socket } = createHarness();
    const promise = transport.request("nope.method");
    socket().open();
    await flush();

    socket().receive({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
    const error = (await promise.catch((e: unknown) => e)) as BackendError;
    expect(error).toBeInstanceOf(BackendError);
    expect(error.code).toBe("METHOD_NOT_FOUND");
    expect(error.message).toBe("Method not found");
    expect(error.rpcCode).toBe(-32601);
    expect(error.data).toEqual({ code: "METHOD_NOT_FOUND" });
    transport.dispose();
  });

  it("prefers the daemon's data.code and preserves extra data fields", async () => {
    const { transport, socket } = createHarness();
    const promise = transport.request("note.update");
    socket().open();
    await flush();

    socket().receive({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32005,
        message: "Revision conflict",
        data: { code: "CONFLICT", currentRevision: 7 },
      },
    });
    const error = (await promise.catch((e: unknown) => e)) as BackendError;
    expect(error.code).toBe("CONFLICT");
    expect(error.rpcCode).toBe(-32005);
    expect(error.data).toEqual({ code: "CONFLICT", currentRevision: 7 });
    transport.dispose();
  });

  it("maps reserved server-range codes to SERVER_ERROR", async () => {
    const { transport, socket } = createHarness();
    const promise = transport.request("thing.do");
    socket().open();
    await flush();

    socket().receive({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "boom" } });
    const error = (await promise.catch((e: unknown) => e)) as BackendError;
    expect(error.code).toBe("SERVER_ERROR");
    transport.dispose();
  });

  it("times out requests with the default timeout", async () => {
    vi.useFakeTimers();
    const { transport, socket } = createHarness();
    const promise = transport.request("slow.method");
    socket().open();
    await flush();
    expect(socket().sent).toHaveLength(1);

    const rejection = expect(promise).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "JSON-RPC request timed out: slow.method",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    transport.dispose();
  });

  it("honours a per-call timeoutMs override", async () => {
    vi.useFakeTimers();
    const { transport, socket } = createHarness();
    const promise = transport.request("git.pull", undefined, { timeoutMs: 60_000 });
    socket().open();
    await flush();

    await vi.advanceTimersByTimeAsync(45_000);
    socket().receive({ jsonrpc: "2.0", id: 1, result: "ok" });
    await expect(promise).resolves.toBe("ok");
    transport.dispose();
  });

  it("fans notifications out to registered handlers until disposed", async () => {
    const { transport, socket } = createHarness();
    const seen: unknown[] = [];
    const off = transport.onNotification((n) => seen.push(n));
    const promise = transport.request("events.subscribe", {});
    socket().open();
    await flush();
    socket().receive({ jsonrpc: "2.0", id: 1, result: { subscriptionId: "sub-1" } });
    await promise;

    socket().receive({
      jsonrpc: "2.0",
      method: "subscription.push",
      params: { subscriptionId: "sub-1", kind: "snapshot", seq: 0, snapshot: [] },
    });
    expect(seen).toEqual([
      {
        method: "subscription.push",
        params: { subscriptionId: "sub-1", kind: "snapshot", seq: 0, snapshot: [] },
      },
    ]);

    off();
    socket().receive({ jsonrpc: "2.0", method: "subscription.push", params: {} });
    expect(seen).toHaveLength(1);
    transport.dispose();
  });

  it("sends events.subscribe / events.unsubscribe via subscribe()/unsubscribe()", async () => {
    const { transport, socket } = createHarness();
    const promise = transport.subscribe({ events: ["workspace:*"] });
    socket().open();
    await flush();
    expect(socket().lastFrame()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "events.subscribe",
      params: { events: ["workspace:*"] },
    });
    socket().receive({ jsonrpc: "2.0", id: 1, result: { subscriptionId: "sub-9" } });
    await expect(promise).resolves.toEqual({ subscriptionId: "sub-9" });

    const unsub = transport.unsubscribe("sub-9");
    await flush();
    expect(socket().lastFrame()).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "events.unsubscribe",
      params: { subscriptionId: "sub-9" },
    });
    socket().receive({ jsonrpc: "2.0", id: 2, error: { code: -32602, message: "unknown sub" } });
    await expect(unsub).resolves.toBeUndefined();
    transport.dispose();
  });

  it("rejects in-flight requests when the connection drops, then reconnects with backoff", async () => {
    vi.useFakeTimers();
    const { transport, sockets, socket } = createHarness({
      reconnectDelayMs: 1_000,
      maxReconnectDelayMs: 4_000,
    });
    const reconnected = vi.fn();
    transport.onReconnected(reconnected);

    const promise = transport.request("workspace.list");
    socket().open();
    await flush();

    socket().drop();
    await expect(promise).rejects.toMatchObject({ code: "TRANSPORT_ERROR" });
    expect(socket().closed).toBe(true);
    expect(reconnected).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    socket().drop();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);

    socket().open();
    await flush();
    expect(reconnected).toHaveBeenCalledOnce();

    const after = transport.request("workspace.list");
    await flush();
    expect(socket().lastFrame()).toMatchObject({ method: "workspace.list" });
    socket().receive({ jsonrpc: "2.0", id: 2, result: [] });
    await expect(after).resolves.toEqual([]);
    transport.dispose();
  });

  it("queues requests behind an armed backoff timer instead of connecting immediately", async () => {
    vi.useFakeTimers();
    const { transport, sockets, socket } = createHarness({
      reconnectDelayMs: 1_000,
      maxReconnectDelayMs: 30_000,
    });
    transport.request("a").catch(() => {});
    socket().open();
    await flush();
    socket().drop();
    expect(sockets).toHaveLength(1);

    // New requests while the reconnect timer is armed must not bypass the
    // backoff by opening a socket immediately.
    const queued = transport.request("b");
    await flush();
    expect(sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    socket().open();
    await flush();
    expect(socket().lastFrame()).toMatchObject({ method: "b" });
    socket().receive({ jsonrpc: "2.0", id: 2, result: "ok" });
    await expect(queued).resolves.toBe("ok");
    transport.dispose();
  });

  it("times out a request stuck waiting for the initial connect", async () => {
    vi.useFakeTimers();
    const { transport, socket } = createHarness();
    const promise = transport.request("slow.connect");
    // The socket never opens (stalled handshake, no close event fired).
    expect(socket().sent).toHaveLength(0);

    const rejection = expect(promise).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "JSON-RPC request timed out: slow.connect",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;

    // A late connect must not send the already-timed-out request.
    socket().open();
    await flush();
    expect(socket().sent).toHaveLength(0);
    transport.dispose();
  });

  it("does not fire reconnected on the first successful connect", async () => {
    const { transport, socket } = createHarness();
    const reconnected = vi.fn();
    transport.onReconnected(reconnected);
    const promise = transport.request("system.health");
    socket().open();
    await flush();
    expect(reconnected).not.toHaveBeenCalled();
    socket().receive({ jsonrpc: "2.0", id: 1, result: "ok" });
    await promise;
    transport.dispose();
  });

  it("resets the backoff delay after a successful reconnect", async () => {
    vi.useFakeTimers();
    const { transport, sockets, socket } = createHarness({
      reconnectDelayMs: 1_000,
      maxReconnectDelayMs: 30_000,
    });
    transport.request("x").catch(() => {});
    socket().open();
    await flush();
    socket().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    socket().drop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(3);
    socket().open();
    await flush();

    socket().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(4);
    transport.dispose();
  });

  it("replies -32601 to daemon-initiated reverse requests", async () => {
    const { transport, socket } = createHarness();
    const promise = transport.request("system.health");
    socket().open();
    await flush();

    socket().receive({ jsonrpc: "2.0", id: "rev-1", method: "permission.request", params: {} });
    expect(socket().lastFrame()).toEqual({
      jsonrpc: "2.0",
      id: "rev-1",
      error: { code: -32601, message: "Method not found: permission.request" },
    });

    socket().receive({ jsonrpc: "2.0", id: 1, result: "ok" });
    await expect(promise).resolves.toBe("ok");
    transport.dispose();
  });

  it("ignores unparseable frames, non-string data, and unknown response ids", async () => {
    const { transport, socket } = createHarness();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const promise = transport.request("system.health");
    socket().open();
    await flush();

    socket().receiveRaw("not json{");
    socket().receiveRaw(new ArrayBuffer(4));
    socket().receive({ jsonrpc: "2.0", id: 99, result: "stale" });

    socket().receive({ jsonrpc: "2.0", id: 1, result: "ok" });
    await expect(promise).resolves.toBe("ok");
    warn.mockRestore();
    transport.dispose();
  });

  it("rejects everything and stops reconnecting once disposed", async () => {
    vi.useFakeTimers();
    const { transport, sockets, socket } = createHarness({ reconnectDelayMs: 1_000 });
    const promise = transport.request("workspace.list");
    socket().open();
    await flush();

    transport.dispose();
    await expect(promise).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(transport.isAvailable()).toBe(false);
    expect(socket().closed).toBe(true);

    await expect(transport.request("x")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("createBrowserWebSocketTransport returns a working transport", () => {
    const transport = createBrowserWebSocketTransport({
      url: "ws://localhost:9100/rpc",
      webSocketFactory: (url) => new FakeWebSocket(url),
    });
    expect(transport.isAvailable()).toBe(true);
    transport.dispose();
    expect(transport.isAvailable()).toBe(false);
  });
});
