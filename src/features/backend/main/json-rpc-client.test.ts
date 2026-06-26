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
