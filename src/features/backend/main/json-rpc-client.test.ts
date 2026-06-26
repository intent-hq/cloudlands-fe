import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonRpcError, mapErrorCode } from "./json-rpc-errors";
import { JsonRpcClient } from "./json-rpc-client";

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
});
