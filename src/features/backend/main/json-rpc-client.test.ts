import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { Duplex as LifecycleDuplex } from 'node:stream';
import type { JsonRpcRetirement } from './json-rpc-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionLimitError, TUNNEL_RACE_HOST } from './backend-connection';
import { JsonRpcError, mapErrorCode } from './json-rpc-errors';
import { JsonRpcClient, ReverseRpcHandlerError } from './json-rpc-client';

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
    this.emit('data', Buffer.from(chunk));
  }

  /** Simulate a raw inbound byte chunk (used for chunk-boundary tests). */
  receiveBytes(buf: Buffer): void {
    this.emit('data', buf);
  }

  /** Simulate a successful connection. */
  open(): void {
    this.emit('connect');
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

describe('JsonRpcClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('frames requests as newline-delimited JSON with incrementing ids', async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request('workspace.list', { filter: 'active' });
    expect(socket.writes).toHaveLength(1);
    const line = socket.writes[0];
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'workspace.list',
      params: { filter: 'active' },
    });

    socket.receive(`{"jsonrpc":"2.0","id":1,"result":{"workspaces":[]}}\n`);
    await expect(promise).resolves.toEqual({ workspaces: [] });
    client.dispose();
  });

  it('correlates concurrent responses by id regardless of arrival order', async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const first = client.request('a');
    const second = client.request('b');
    expect(JSON.parse(socket.writes[0]).id).toBe(1);
    expect(JSON.parse(socket.writes[1]).id).toBe(2);

    socket.receive(`{"jsonrpc":"2.0","id":2,"result":"second"}\n`);
    socket.receive(`{"jsonrpc":"2.0","id":1,"result":"first"}\n`);

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    client.dispose();
  });

  it('reassembles messages split across data chunks', async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request('ping');
    socket.receive(`{"jsonrpc":"2.0","id":1,`);
    socket.receive(`"result":42}\n`);
    await expect(promise).resolves.toBe(42);
    client.dispose();
  });

  it('reassembles a multi-byte UTF-8 char split across two data chunks', async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request('note.get');
    // "café-🚀": é is 2 UTF-8 bytes, 🚀 (U+1F680) is 4 bytes (F0 9F 9A 80).
    const value = 'caf\u00e9-\u{1F680}';
    const full = Buffer.from(`{"jsonrpc":"2.0","id":1,"result":"${value}"}\n`, 'utf8');
    // Split inside the rocket emoji's 4-byte sequence (mid multi-byte boundary).
    const splitAt = full.indexOf(0xf0) + 2;
    socket.receiveBytes(full.subarray(0, splitAt));
    socket.receiveBytes(full.subarray(splitAt));

    await expect(promise).resolves.toBe(value);
    client.dispose();
  });

  it('dispatches notifications (no id) to listeners', async () => {
    const { client, socket } = makeClient();
    const received: Array<{ method: string; params?: unknown }> = [];
    client.on('notification', (n) => received.push(n));
    client.start();
    socket.open();

    socket.receive(
      `{"jsonrpc":"2.0","method":"events.event","params":{"type":"workspace:updated"}}\n`,
    );
    expect(received).toEqual([{ method: 'events.event', params: { type: 'workspace:updated' } }]);
    client.dispose();
  });

  it('maps numeric error codes to string codes on error.data.code', async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request('missing.method');
    socket.receive(`{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"no such method"}}\n`);

    await expect(promise).rejects.toMatchObject({
      name: 'JsonRpcError',
      code: 'METHOD_NOT_FOUND',
      rpcCode: -32601,
      data: { code: 'METHOD_NOT_FOUND' },
    });
    client.dispose();
  });

  it('prefers an explicit daemon data.code over the numeric mapping', async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request('workspace.get');
    socket.receive(
      `{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"nope","data":{"code":"WORKSPACE_NOT_FOUND"}}}\n`,
    );

    await expect(promise).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND', rpcCode: -32000 });
    client.dispose();
  });

  it('times out a request that never receives a response', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 50,
    });
    client.start();
    socket.open();

    const promise = client.request('slow');
    const expectation = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(60);
    await expectation;
    client.dispose();
  });

  // Per-call `timeoutMs` override lets long-running daemon operations
  // (e.g. `git.pull`, whose own bound exceeds the flat client default) run
  // longer than the flat `requestTimeoutMs` without disturbing other requests.
  it('honours a per-call timeoutMs override longer than the client default', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 50,
    });
    client.start();
    socket.open();

    const promise = client.request(
      'git.pull',
      { repoPath: '/r', branchName: 'main' },
      {
        timeoutMs: 500,
      },
    );
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

  it('falls back to the client default when the per-call override is absent or invalid', async () => {
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
      const promise =
        bad === undefined ? client.request('slow') : client.request('slow', undefined, bad);
      const expectation = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(60);
      await expectation;
    }

    client.dispose();
  });

  it('rejects in-flight requests when the connection drops', async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    const promise = client.request('inflight');
    const expectation = expect(promise).rejects.toThrow();
    socket.emit('close');
    await expectation;
    client.dispose();
  });
});

describe('JsonRpcClient reverse requests (§5.14)', () => {
  /** Await the microtask queue so async handler chains settle before we assert writes. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('dispatches an inbound request (rev-* id + method) to the registered handler and writes the result', async () => {
    const { client, socket } = makeClient();
    const handler = vi.fn().mockResolvedValue({ ok: true });
    client.registerMethod('browser.exec', handler);
    client.start();
    socket.open();

    socket.receive(
      `{"jsonrpc":"2.0","id":"rev-1","method":"browser.exec","params":{"actions":[{"action":"listTabs"}]}}\n`,
    );
    await flush();

    expect(handler).toHaveBeenCalledWith({ actions: [{ action: 'listTabs' }] });
    expect(socket.writes).toHaveLength(1);
    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 'rev-1',
      result: { ok: true },
    });
    client.dispose();
  });

  it('returns METHOD_NOT_FOUND (-32601) for an inbound request with no registered handler', async () => {
    const { client, socket } = makeClient();
    client.start();
    socket.open();

    socket.receive(`{"jsonrpc":"2.0","id":"rev-1","method":"nope","params":{}}\n`);
    await flush();

    expect(socket.writes).toHaveLength(1);
    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 'rev-1',
      error: { code: -32601, message: 'Method not found: nope' },
    });
    client.dispose();
  });

  it('returns INTERNAL_ERROR (-32603) when a handler throws a plain Error', async () => {
    const { client, socket } = makeClient();
    client.registerMethod('browser.exec', () => {
      throw new Error('kaboom');
    });
    client.start();
    socket.open();

    socket.receive(`{"jsonrpc":"2.0","id":"rev-1","method":"browser.exec","params":{}}\n`);
    await flush();

    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 'rev-1',
      error: { code: -32603, message: 'kaboom' },
    });
    client.dispose();
  });

  it('honours ReverseRpcHandlerError code and data', async () => {
    const { client, socket } = makeClient();
    client.registerMethod('browser.exec', () => {
      throw new ReverseRpcHandlerError(-32602, 'bad params', { field: 'actions' });
    });
    client.start();
    socket.open();

    socket.receive(`{"jsonrpc":"2.0","id":"rev-1","method":"browser.exec","params":{}}\n`);
    await flush();

    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 'rev-1',
      error: { code: -32602, message: 'bad params', data: { field: 'actions' } },
    });
    client.dispose();
  });

  it('re-registration replaces the previous handler; disposer only tears down its own', async () => {
    const { client, socket } = makeClient();
    const first = vi.fn().mockResolvedValue('first');
    const second = vi.fn().mockResolvedValue('second');
    const disposeFirst = client.registerMethod('m', first);
    client.registerMethod('m', second);
    // Stale disposer must NOT unregister the newer handler.
    disposeFirst();
    client.start();
    socket.open();

    socket.receive(`{"jsonrpc":"2.0","id":"rev-1","method":"m","params":null}\n`);
    await flush();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.writes[0]).result).toBe('second');
    client.dispose();
  });

  it('does not interfere with normal outbound request/response correlation', async () => {
    const { client, socket } = makeClient();
    client.registerMethod('browser.exec', async () => ({ ok: true }));
    client.start();
    socket.open();

    const promise = client.request('workspace.list');
    socket.receive(`{"jsonrpc":"2.0","id":1,"result":{"workspaces":[]}}\n`);
    await expect(promise).resolves.toEqual({ workspaces: [] });
    client.dispose();
  });
});

describe('JsonRpcClient reconnect + heartbeat', () => {
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
    client.on('error', () => {});
    return { client, sockets };
  }

  it('reconnects after the socket closes, applying exponential backoff', async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    client.start();
    expect(sockets).toHaveLength(1);

    // First drop: backoff = 100ms.
    sockets[0].emit('close');
    await vi.advanceTimersByTimeAsync(99);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);

    // Second drop without a successful connect: backoff doubles to 200ms.
    sockets[1].emit('close');
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(3);

    client.dispose();
  });

  it('records the race winner per connection and re-derives it on reconnect', async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    const seen: Array<ReturnType<JsonRpcClient['getConnectedVia']>> = [];
    client.on('status', (status: string) => {
      if (status === 'connected') seen.push(client.getConnectedVia());
    });
    client.start();

    // Single-host dial: bare `connect` → the winner is unknown.
    expect(client.getConnectedVia()).toBeNull();
    sockets[0].emit('connect');
    expect(client.getConnectedVia()).toBeNull();

    // Reconnect through the tunnel: the race facade names its winner.
    sockets[0].emit('close');
    expect(client.getConnectedVia()).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    sockets[1].emit('connect', { host: TUNNEL_RACE_HOST, via: 'tunnel' });
    expect(client.getConnectedVia()).toBe('tunnel');

    // Reconnect again through a direct host: the marker flips back.
    sockets[1].emit('close');
    await vi.advanceTimersByTimeAsync(100);
    sockets[2].emit('secureConnect', { host: '10.0.0.5', via: 'direct' });
    expect(client.getConnectedVia()).toBe('direct');

    // The `status → connected` broadcast already observes the fresh value.
    expect(seen).toEqual([null, 'tunnel', 'direct']);
    client.dispose();
  });

  it('keeps request bursts on the scheduled backoff after a failed startup dial', async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    client.start();
    sockets[0].emit('error', new Error('connect ENOENT intentd.sock'));

    const requests = Array.from({ length: 20 }, () => client.request('workspace.list', {}));
    const outcomes = Promise.allSettled(requests);
    client.start();
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
    expect(client.getReconnectAttempts()).toBe(1);
    client.dispose();
    expect((await outcomes).every((result) => result.status === 'rejected')).toBe(true);
  });

  it('replays failed startup work on the first successful connection', async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    const recovered = vi.fn(() => client.request('workspace.list', {}));
    client.on('reconnected', recovered);
    const failed = client.request('workspace.list', {}).catch((error: Error) => error.message);
    sockets[0].emit('error', new Error('connect ENOENT intentd.sock'));
    expect(await failed).toContain('ENOENT');
    await vi.advanceTimersByTimeAsync(100);
    sockets[1].open();

    expect(recovered).toHaveBeenCalledOnce();
    expect(JSON.parse(sockets[1].writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'workspace.list',
      params: {},
    });
    sockets[1].receive('{"jsonrpc":"2.0","id":1,"result":{"workspaces":[]}}\n');
    await expect(recovered.mock.results[0].value).resolves.toEqual({ workspaces: [] });
    client.dispose();
  });

  // #439: a stopped daemon must be re-probed at least every 5s while
  // disconnected, indefinitely — the daemon-loss modal relies on the main
  // process noticing a returning daemon promptly and never giving up.
  it('caps the default reconnect backoff at 5s and retries indefinitely', async () => {
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
    client.on('error', () => {});
    client.start();
    expect(sockets).toHaveLength(1);

    // Backoff doubles 1s → 2s → 4s, then clamps to 5s.
    for (const delay of [1000, 2000, 4000, 5000]) {
      sockets[sockets.length - 1].emit('close');
      const before = sockets.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sockets).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(before + 1);
    }

    // Many further drops: every retry stays at the 5s cap — no give-up.
    for (let i = 0; i < 10; i++) {
      sockets[sockets.length - 1].emit('close');
      const before = sockets.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(sockets).toHaveLength(before + 1);
    }

    client.dispose();
  });

  // #1750: the daemon-loss overlay shows "Retrying connection… (attempt N)",
  // fed by this counter through the backend:status broadcast.
  it('counts reconnect attempts and resets the counter on a successful connect', async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    client.start();
    expect(client.getReconnectAttempts()).toBe(0);

    // Each backoff retry increments the counter before connecting.
    sockets[0].emit('close');
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    expect(client.getReconnectAttempts()).toBe(1);

    sockets[1].emit('close');
    await vi.advanceTimersByTimeAsync(200);
    expect(sockets).toHaveLength(3);
    expect(client.getReconnectAttempts()).toBe(2);

    // A successful connect resets the counter.
    sockets[2].open();
    expect(client.getReconnectAttempts()).toBe(0);

    // A later drop starts counting from scratch.
    sockets[2].emit('close');
    await vi.advanceTimersByTimeAsync(100);
    expect(client.getReconnectAttempts()).toBe(1);

    client.dispose();
  });

  // Multiplayer guest caps (intent-hq/intentd#1917): a 503 upgrade refusal
  // means the host's guest connection cap is spent. The client keeps
  // retrying (a seat frees when another guest disconnects) but on a slow
  // bounded cadence, and flags the posture for the daemon-loss overlay.
  it('retries a connection-limit refusal slowly, flags it, and clears the flag on connect', async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    const statuses: Array<{ status: string; limited: boolean }> = [];
    client.on('status', (status: string) =>
      statuses.push({ status, limited: client.isConnectionLimited() }),
    );
    client.start();
    expect(client.isConnectionLimited()).toBe(false);

    sockets[0].emit('error', new ConnectionLimitError());
    expect(client.isConnectionLimited()).toBe(true);
    // The `disconnected` broadcast already carries the posture.
    expect(statuses.at(-1)).toEqual({ status: 'disconnected', limited: true });

    // Not re-presented on the ordinary 100ms/5s cadence…
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(1);
    // …but retried within the slow bound; the flag persists across the wait.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets).toHaveLength(2);
    expect(client.isConnectionLimited()).toBe(true);
    expect(client.getReconnectAttempts()).toBe(1);

    // A seat freed: the connect clears the posture.
    sockets[1].open();
    expect(client.isConnectionLimited()).toBe(false);
    expect(statuses.at(-1)).toEqual({ status: 'connected', limited: false });

    // A later failure of another kind does not inherit the flag and is
    // retried on the ordinary cadence again.
    sockets[1].emit('close');
    expect(client.isConnectionLimited()).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(3);

    client.dispose();
  });

  it('retries on the Retry-After the refusal carries instead of the default cadence', async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    client.start();
    expect(client.getConnectionLimitRetryAfterMs()).toBeNull();

    // The daemon asked for 45 s: the default 30 s must NOT re-dial.
    sockets[0].emit('error', new ConnectionLimitError(45_000));
    expect(client.getConnectionLimitRetryAfterMs()).toBe(45_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sockets).toHaveLength(2);
    // The on-demand fast-fail carries the same wait.
    sockets[1].emit('error', new ConnectionLimitError(120_000));
    await expect(client.request('system.status')).rejects.toMatchObject({
      name: 'ConnectionLimitError',
      retryAfterMs: 120_000,
    });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(3);

    // Connecting clears the wait along with the posture.
    sockets[2].open();
    expect(client.getConnectionLimitRetryAfterMs()).toBeNull();
    // A failure of another kind never reports one.
    sockets[2].emit('close');
    expect(client.getConnectionLimitRetryAfterMs()).toBeNull();

    client.dispose();
  });

  it('holds the connection-limit cadence against on-demand start() and request()', async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    client.start();
    sockets[0].emit('error', new ConnectionLimitError());
    expect(client.isConnectionLimited()).toBe(true);
    expect(sockets).toHaveLength(1);

    // Neither an explicit start nor a request re-presents the refused
    // upgrade ahead of the slow retry; the request fails fast with the cap
    // refusal instead of dialing or parking behind the timer.
    client.start();
    expect(sockets).toHaveLength(1);
    await expect(client.request('system.status')).rejects.toBeInstanceOf(ConnectionLimitError);
    expect(sockets).toHaveLength(1);
    expect(client.getStatus()).toBe('disconnected');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(sockets).toHaveLength(2);
    // Once the retry itself is in flight, a request waits on it as usual.
    const pending = client.request('system.status');
    sockets[1].open();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[1].writes).toHaveLength(1);
    const { id } = JSON.parse(sockets[1].writes[0]) as { id: number };
    sockets[1].receive(`${JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true } })}\n`);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(client.isConnectionLimited()).toBe(false);

    client.dispose();
  });

  it('resets the backoff after a successful reconnect', async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    client.start();

    sockets[0].emit('close');
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);

    // A successful connect resets the backoff to the base delay.
    sockets[1].open();
    sockets[1].emit('close');
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(3);

    client.dispose();
  });

  it('invokes the health check on each heartbeat tick while connected', async () => {
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

  it('tears down and reconnects when the health check fails', async () => {
    vi.useFakeTimers();
    const healthCheck = vi.fn().mockRejectedValue(new Error('half-open socket'));
    const { client, sockets } = makeReconnectingClient({
      heartbeatIntervalMs: 1000,
      healthCheck,
    });
    client.start();
    sockets[0].open();
    expect(client.getStatus()).toBe('connected');

    // Heartbeat tick → health check rejects → connection torn down.
    await vi.advanceTimersByTimeAsync(1000);
    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(client.getStatus()).toBe('disconnected');

    // Backoff reconnect schedules a fresh socket.
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    client.dispose();
  });

  it('keeps a live socket connected after one transient health-check failure', async () => {
    vi.useFakeTimers();
    const healthCheck = vi
      .fn()
      .mockRejectedValueOnce(new Error('daemon busy'))
      .mockResolvedValueOnce(undefined);
    const { client, sockets } = makeReconnectingClient({
      heartbeatIntervalMs: 1000,
      healthCheck,
      healthCheckFailureThreshold: 2,
    });
    client.start();
    sockets[0].open();

    await vi.advanceTimersByTimeAsync(1000);
    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(client.getStatus()).toBe('connected');
    expect(sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(healthCheck).toHaveBeenCalledTimes(2);
    expect(client.getStatus()).toBe('connected');
    expect(sockets).toHaveLength(1);

    client.dispose();
  });

  it('reconnects after the configured number of consecutive health-check failures', async () => {
    vi.useFakeTimers();
    const healthCheck = vi.fn().mockRejectedValue(new Error('half-open socket'));
    const { client, sockets } = makeReconnectingClient({
      heartbeatIntervalMs: 1000,
      healthCheck,
      healthCheckFailureThreshold: 2,
    });
    client.start();
    sockets[0].open();

    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getStatus()).toBe('connected');
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getStatus()).toBe('disconnected');

    await vi.advanceTimersByTimeAsync(100);
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    client.dispose();
  });

  it('emits `reconnected` on the 2nd (and later) successful connect but not on the first (RESUB-1)', async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeReconnectingClient();
    const reconnected = vi.fn();
    client.on('reconnected', reconnected);
    client.start();

    // First successful connect is the ordinary boot path — NOT a reconnect.
    sockets[0].open();
    expect(reconnected).not.toHaveBeenCalled();

    // Drop and let the backoff reconnect fire.
    sockets[0].emit('close');
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(reconnected).toHaveBeenCalledTimes(1);

    // Second drop + reconnect fires the event again.
    sockets[1].emit('close');
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(3);
    sockets[2].open();
    expect(reconnected).toHaveBeenCalledTimes(2);

    client.dispose();
  });

  it("re-emits the socket facade's non-fatal pin-mismatch as a cert-warning event (#1746)", () => {
    const { client, socket } = makeClient();
    const certWarning = vi.fn();
    const errors = vi.fn();
    const statuses: string[] = [];
    client.on('cert-warning', certWarning);
    client.on('error', errors);
    client.on('status', (s: string) => statuses.push(s));
    client.start();

    // The race can report a losing host's mismatch BEFORE the winning
    // candidate connects — the client must stay on its normal lifecycle.
    const info = { host: '192.168.1.9', expected: 'AA:BB', actual: 'CC:DD' };
    socket.emit('pin-mismatch', info);
    socket.open();

    expect(certWarning).toHaveBeenCalledTimes(1);
    expect(certWarning).toHaveBeenCalledWith(info);
    // Non-fatal: no error, no disconnect — the connection proceeds untouched.
    expect(errors).not.toHaveBeenCalled();
    expect(client.getStatus()).toBe('connected');
    expect(statuses).toEqual(['connecting', 'connected']);

    // Also forwarded while already connected (a late candidate failing).
    socket.emit('pin-mismatch', { host: '10.0.0.7', expected: 'AA:BB', actual: 'EE:FF' });
    expect(certWarning).toHaveBeenCalledTimes(2);

    client.dispose();
  });
});

describe('JsonRpcClient client.hello identity handshake (§5.17)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Await the microtask queue so async handshake chains settle before asserting. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  /** PROTOCOL §5.17-shaped hello result (server block confirmed on the wire). */
  const helloResult = (clientId: string) => ({
    clientId,
    protocolVersion: '2.2',
    server: {
      locality: 'local',
      hasDisplay: true,
      osArch: 'darwin/arm64',
      version: '0.1.0',
      protocolVersion: '2.2',
      capabilities: { liveState: true },
    },
  });

  function makeHelloClient(clientId = 'cli-7f3a'): {
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
    client.on('error', () => {});
    return { client, sockets, onHelloResult };
  }

  // protocol-version-ok: retained registered-root contract across known generations.
  describe.each(['file.read', 'file.readChunk'])('scoped %s support', (method) => {
    it.each([
      ['11.1', true],
      ['11.2', true],
      ['12.0', true],
      ['12.0.1', true],
      ['11.0', false],
      ['10.9', false],
      ['13.0', true],
      ['13.0.1', true],
      ['14.0', false],
      ['12', false],
      ['12.0-preview', false],
      [undefined, false],
    ])('checks the socket hello version %s before writing', async (protocolVersion, supported) => {
      const { client, sockets } = makeHelloClient();
      const params = {
        workspaceId: 'ws',
        path: 'same.txt',
        gitRootId: 'root-a',
        ...(method === 'file.readChunk' ? { offset: 0, length: 1024 } : {}),
      };
      const response = method === 'file.read' ? 'R' : { content: 'Ug==', size: 1, bytesRead: 1 };
      const result = client.request(method, params).catch((error) => error);
      sockets[0].open();
      await flush();
      expect(sockets[0].writes.map((frame) => JSON.parse(frame).method)).toEqual(['client.hello']);
      const hello = JSON.parse(sockets[0].writes[0]);
      sockets[0].receive(
        `${JSON.stringify({ jsonrpc: '2.0', id: hello.id, result: { protocolVersion } })}\n`,
      );
      await flush();
      if (supported) {
        const read = JSON.parse(sockets[0].writes.at(-1)!);
        expect(read).toMatchObject({ method, params });
        sockets[0].receive(
          `${JSON.stringify({ jsonrpc: '2.0', id: read.id, result: response })}\n`,
        );
        expect(await result).toEqual(response);
      } else {
        expect(await result).toBeInstanceOf(Error);
        expect(sockets[0].writes).toHaveLength(1);
      }
      client.dispose();
    });
  });

  // protocol-version-ok: connection-generation compatibility fixtures.
  it.each(
    ['file.read', 'file.readChunk'].flatMap((method) =>
      ['11.1', '12.0', '13.0'].flatMap((protocolVersion) =>
        ['11.0', '12.0', '13.0', '14.0', 'invalid', undefined].map((nextVersion) => ({
          method,
          protocolVersion,
          nextVersion,
        })),
      ),
    ),
  )(
    'rechecks scoped $method after reconnecting from $protocolVersion to $nextVersion',
    async ({ method, protocolVersion, nextVersion }) => {
      vi.useFakeTimers();
      const { client, sockets } = makeHelloClient();
      client.start();
      sockets[0].open();
      await vi.advanceTimersByTimeAsync(1);
      let hello = JSON.parse(sockets[0].writes[0]);
      sockets[0].receive(
        `${JSON.stringify({ jsonrpc: '2.0', id: hello.id, result: { protocolVersion } })}\n`,
      );
      await vi.advanceTimersByTimeAsync(1);
      const params = {
        workspaceId: 'ws',
        path: 'same.txt',
        gitRootId: 'root-a',
        ...(method === 'file.readChunk' ? { offset: 0, length: 1024 } : {}),
      };
      const response = method === 'file.read' ? 'R' : { content: 'Ug==', size: 1, bytesRead: 1 };
      const first = client.request(method, params);
      const read = JSON.parse(sockets[0].writes.at(-1)!);
      sockets[0].receive(`${JSON.stringify({ jsonrpc: '2.0', id: read.id, result: response })}\n`);
      expect(await first).toEqual(response);
      sockets[0].emit('close');
      await vi.advanceTimersByTimeAsync(100);
      const second = client.request(method, params).catch((error) => error);
      sockets[1].open();
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets[1].writes.map((frame) => JSON.parse(frame).method)).toEqual(['client.hello']);
      hello = JSON.parse(sockets[1].writes[0]);
      sockets[1].receive(
        `${JSON.stringify({ jsonrpc: '2.0', id: hello.id, result: { protocolVersion: nextVersion } })}\n`,
      );
      await vi.advanceTimersByTimeAsync(1);
      const next = JSON.parse(sockets[1].writes.at(-1)!);
      if (next.method === method) {
        expect(next.params).toEqual(params);
        sockets[1].receive(
          `${JSON.stringify({ jsonrpc: '2.0', id: next.id, result: response })}\n`,
        );
      }
      const result = await second;
      client.dispose();
      if (nextVersion === '12.0' || nextVersion === '13.0') {
        expect(result).toEqual(response);
        expect(sockets[1].writes.map((frame) => JSON.parse(frame).method)).toEqual([
          'client.hello',
          method,
        ]);
      } else {
        expect(result).toBeInstanceOf(Error);
        expect(sockets[1].writes.map((frame) => JSON.parse(frame).method)).toEqual([
          'client.hello',
        ]);
      }
    },
  );

  it('sends client.hello with the persisted clientId as the FIRST frame on connect, before scoped work', async () => {
    const { client, sockets, onHelloResult } = makeHelloClient();
    client.start();
    const socket = sockets[0];

    // Scoped work issued before the handshake completes must queue behind it.
    const draftsPromise = client.request('drafts.get', {
      workspaceId: 'ws-1',
      agentId: 'agent-1',
    });
    socket.open();
    await flush();

    // Exactly one frame on the wire: the identity hello. drafts.get is queued.
    expect(socket.writes).toHaveLength(1);
    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'client.hello',
      params: { clientId: 'cli-7f3a' },
    });
    expect(client.getStatus()).toBe('connecting');

    socket.receive(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: helloResult('cli-7f3a') })}\n`,
    );
    await flush();

    expect(client.getStatus()).toBe('connected');
    expect(onHelloResult).toHaveBeenCalledWith(helloResult('cli-7f3a'));
    expect(socket.writes).toHaveLength(2);
    expect(JSON.parse(socket.writes[1])).toMatchObject({ method: 'drafts.get' });

    socket.receive(`${JSON.stringify({ jsonrpc: '2.0', id: 2, result: null })}\n`);
    await expect(draftsPromise).resolves.toBeNull();
    client.dispose();
  });

  it('re-presents the SAME clientId on every reconnect, before emitting `reconnected`', async () => {
    vi.useFakeTimers();
    const { client, sockets } = makeHelloClient();
    const reconnected = vi.fn();
    client.on('reconnected', reconnected);
    client.start();
    sockets[0].open();
    await vi.advanceTimersByTimeAsync(1);

    const firstHello = JSON.parse(sockets[0].writes[0]);
    expect(firstHello.method).toBe('client.hello');
    sockets[0].receive(
      `${JSON.stringify({ jsonrpc: '2.0', id: firstHello.id, result: helloResult('cli-7f3a') })}\n`,
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getStatus()).toBe('connected');

    // Drop the connection; the backoff reconnect opens a fresh socket, which
    // starts anonymous on the daemon side — the hello MUST be replayed with
    // the same persisted identity before consumers resubscribe.
    sockets[0].emit('close');
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    await vi.advanceTimersByTimeAsync(1);

    const secondHello = JSON.parse(sockets[1].writes[0]);
    expect(secondHello.method).toBe('client.hello');
    expect(secondHello.params).toEqual({ clientId: 'cli-7f3a' });
    expect(secondHello.params).toEqual(firstHello.params);
    expect(reconnected).not.toHaveBeenCalled();

    sockets[1].receive(
      `${JSON.stringify({ jsonrpc: '2.0', id: secondHello.id, result: helloResult('cli-7f3a') })}\n`,
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getStatus()).toBe('connected');
    expect(reconnected).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it('merges the persisted clientId into a caller-supplied client.hello (renderer capability probe)', async () => {
    const { client, sockets, onHelloResult } = makeHelloClient();
    client.start();
    sockets[0].open();
    await flush();
    sockets[0].receive(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: helloResult('cli-7f3a') })}\n`,
    );
    await flush();

    // The renderer probe forwards `client.hello {}` over backend:request; the
    // shared client must present the SAME persisted identity — an anonymous
    // re-hello would mint a fresh clientId and orphan its drafts (§5.16).
    const probe = client.request('client.hello', {});
    await flush();
    expect(JSON.parse(sockets[0].writes[1])).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'client.hello',
      params: { clientId: 'cli-7f3a' },
    });
    sockets[0].receive(
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, result: helloResult('cli-7f3a') })}\n`,
    );
    await expect(probe).resolves.toEqual(helloResult('cli-7f3a'));
    expect(onHelloResult).toHaveBeenLastCalledWith(helloResult('cli-7f3a'));

    // Caller-supplied fields survive; the persisted identity wins on clientId.
    const named = client.request('client.hello', { name: 'Intent Desktop', clientId: 'cli-rogue' });
    await flush();
    expect(JSON.parse(sockets[0].writes[2]).params).toEqual({
      name: 'Intent Desktop',
      clientId: 'cli-7f3a',
    });
    sockets[0].receive(
      `${JSON.stringify({ jsonrpc: '2.0', id: 3, result: helloResult('cli-7f3a') })}\n`,
    );
    await named;
    client.dispose();
  });

  it('still flips to connected when the hello handshake errors (identity degrades, transport survives)', async () => {
    const { client, sockets, onHelloResult } = makeHelloClient();
    client.start();
    sockets[0].open();
    await flush();

    sockets[0].receive(
      `{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"no such method"}}\n`,
    );
    await flush();

    expect(client.getStatus()).toBe('connected');
    expect(client.getRepositoryConnection()).toBeNull();
    expect(onHelloResult).not.toHaveBeenCalled();
    client.dispose();
  });

  it('bounds the connect-time handshake at 5s: an unanswered hello degrades to anonymous instead of stalling queued work for the full request timeout', async () => {
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
      helloParams: () => ({ clientId: 'cli-7f3a' }),
      onHelloResult,
    });
    client.on('error', () => {});
    client.start();
    sockets[0].open();
    await vi.advanceTimersByTimeAsync(1);

    expect(JSON.parse(sockets[0].writes[0]).method).toBe('client.hello');
    expect(client.getStatus()).toBe('connecting');

    // The daemon never answers the hello. Well before the 30s request
    // timeout the handshake bound (5s) trips and the connection is reported
    // connected anyway — identity degrades, transport survives.
    await vi.advanceTimersByTimeAsync(4_998);
    expect(client.getStatus()).toBe('connecting');
    await vi.advanceTimersByTimeAsync(2);
    expect(client.getStatus()).toBe('connected');
    expect(onHelloResult).not.toHaveBeenCalled();
    client.dispose();
  });

  it('hands a daemon-minted clientId to onHelloResult when the provider has none (first-run)', async () => {
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
    client.on('error', () => {});
    client.start();
    sockets[0].open();
    await flush();

    expect(JSON.parse(sockets[0].writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'client.hello',
      params: {},
    });
    sockets[0].receive(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: helloResult('cli-9b21') })}\n`,
    );
    await flush();
    expect(onHelloResult).toHaveBeenCalledWith(helloResult('cli-9b21'));
    client.dispose();
  });
});

describe('mapErrorCode', () => {
  it('maps reserved codes and falls back to ranges', () => {
    expect(mapErrorCode(-32700)).toBe('PARSE_ERROR');
    expect(mapErrorCode(-32600)).toBe('INVALID_REQUEST');
    expect(mapErrorCode(-32601)).toBe('METHOD_NOT_FOUND');
    expect(mapErrorCode(-32602)).toBe('INVALID_PARAMS');
    expect(mapErrorCode(-32603)).toBe('INTERNAL_ERROR');
    expect(mapErrorCode(-32050)).toBe('SERVER_ERROR');
    expect(mapErrorCode(1234)).toBe('UNKNOWN_ERROR');
  });

  it('JsonRpcError mirrors the resolved code onto data.code', () => {
    const error = new JsonRpcError({ code: -32602, message: 'bad' });
    expect(error.code).toBe('INVALID_PARAMS');
    expect(error.data).toEqual({ code: 'INVALID_PARAMS' });
  });

  it('JsonRpcError preserves a string daemon data as data.detail', () => {
    // The daemon router sends the -32603 Internal error cause as a plain
    // string in error.data; it must survive normalization for the renderer.
    const error = new JsonRpcError({
      code: -32603,
      message: 'Internal error',
      data: 'Could not find the search context in the document.',
    });
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.data).toEqual({
      code: 'INTERNAL_ERROR',
      detail: 'Could not find the search context in the document.',
    });
    expect(error.toErrorPayload()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal error',
      data: {
        code: 'INTERNAL_ERROR',
        detail: 'Could not find the search context in the document.',
      },
      rpcCode: -32603,
    });
  });
});

describe('captured repository socket dispatch', () => {
  const clients: JsonRpcClient[] = [];
  afterEach(() => {
    clients.splice(0).forEach((client) => client.dispose());
    vi.useRealTimers();
  });
  async function connected(hello: unknown = { clientId: 'confirmed-client' }) {
    const sockets: FakeSocket[] = [];
    const factory = vi.fn(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as Duplex;
    });
    const client = new JsonRpcClient({
      socketFactory: factory,
      helloParams: () => ({ clientId: 'persisted' }),
      reconnectDelayMs: 10,
    });
    clients.push(client);
    client.start();
    sockets[0].open();
    await vi.waitFor(() => expect(sockets[0].writes).toHaveLength(1));
    sockets[0].receive(JSON.stringify({ id: 1, result: hello }) + '\n');
    await vi.waitFor(() => expect(client.getStatus()).toBe('connected'));
    return { client, sockets, factory };
  }
  it('observes acknowledged node capabilities without retiring the connection or sending hello', async () => {
    const { client, sockets } = await connected({
      clientId: 'confirmed-client',
      server: { capabilities: { agentNodes: 1, localNodeIsolation: 1, agentPlatformRouting: 1 } },
    });
    const connection = client.getRepositoryConnection();
    expect(client.getNodeCapabilities()).toEqual({
      agentNodes: 1,
      localNodeIsolation: 1,
      agentPlatformRouting: 1,
    });
    expect(client.getRepositoryConnection()).toBe(connection);
    expect(sockets[0].writes).toHaveLength(1);
    const hello = client.request('client.hello');
    expect(client.getNodeCapabilities()).toBeNull();
    await vi.waitFor(() => expect(sockets[0].writes).toHaveLength(2));
    sockets[0].receive(
      '{"id":2,"result":{"clientId":"confirmed-client","server":{"capabilities":{"agentNodes":"1","localNodeIsolation":true}}}}\n',
    );
    await hello;
    expect(client.getNodeCapabilities()).toEqual({
      agentNodes: 0,
      localNodeIsolation: 0,
      agentPlatformRouting: 0,
    });
    client.dispose();
    expect(client.getNodeCapabilities()).toBeNull();
  });
  it('requires a positive current hello and sends synchronously on the first connection', async () => {
    const { client, sockets } = await connected();
    const connection = client.getRepositoryConnection();
    expect(connection).not.toBeNull();
    const request = client.requestOnCapturedConnection(connection!, 'git.status', {
      workspaceId: 'same',
    });
    expect(JSON.parse(sockets[0].writes[1])).toMatchObject({
      method: 'git.status',
      params: { workspaceId: 'same' },
    });
    sockets[0].receive('{"id":2,"result":{"branch":"main"}}\n');
    await expect(request).resolves.toEqual({ branch: 'main' });
  });
  it.each([{}, null, { clientId: '' }])(
    'does not infer identity from connected with malformed hello %j',
    async (hello) => {
      const { client, sockets } = await connected(hello);
      expect(client.getRepositoryConnection()).toBeNull();
      expect(client.getNodeCapabilities()).toBeNull();
      await expect(client.requestOnCapturedConnection({}, 'git.status')).rejects.toThrow();
      expect(sockets[0].writes).toHaveLength(1);
    },
  );
  it('rejects captured work across reconnect on the same client object without another dial', async () => {
    const { client, sockets, factory } = await connected();
    const original = client.getRepositoryConnection()!;
    sockets[0].emit('close');
    expect(client.getRepositoryConnection()).toBeNull();
    expect(client.getNodeCapabilities()).toBeNull();
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1].open();
    await vi.waitFor(() => expect(sockets[1].writes).toHaveLength(1));
    const hello = JSON.parse(sockets[1].writes[0]);
    sockets[1].receive(
      JSON.stringify({ id: hello.id, result: { clientId: 'confirmed-client' } }) + '\n',
    );
    await vi.waitFor(() => expect(client.getStatus()).toBe('connected'));
    expect(client.getRepositoryConnection()?.incarnation).not.toBe(original.incarnation);
    await expect(client.requestOnCapturedConnection(original, 'git.status')).rejects.toThrow();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(sockets[1].writes).toHaveLength(1);
  });
  it('retires the confirmed lifetime before a caller hello awaits identity and on hello rejection', async () => {
    const { client, sockets } = await connected();
    const original = client.getRepositoryConnection()!;
    const hello = client.request('client.hello');
    expect(client.getRepositoryConnection()).toBeNull();
    await expect(client.requestOnCapturedConnection(original, 'git.status')).rejects.toThrow();
    await vi.waitFor(() => expect(sockets[0].writes).toHaveLength(2));
    sockets[0].receive('{"id":2,"error":{"code":-32601,"message":"unavailable"}}\n');
    await expect(hello).rejects.toThrow();
    expect(client.getStatus()).toBe('connected');
    expect(client.getRepositoryConnection()).toBeNull();
    const ordinary = client.request('git.status');
    sockets[0].receive('{"id":3,"result":{}}\n');
    await expect(ordinary).resolves.toEqual({});
  });
  it('retires before teardown callbacks and does not reconnect after disposal', async () => {
    const { client, sockets, factory } = await connected();
    const connection = client.getRepositoryConnection()!;
    const observed: unknown[] = [];
    sockets[0].destroy = () => {
      observed.push(client.getRepositoryConnection());
    };
    client.dispose();
    expect(observed).toEqual([null]);
    await expect(client.requestOnCapturedConnection(connection, 'git.status')).rejects.toThrow();
    expect(factory).toHaveBeenCalledOnce();
  });
});

describe('queued hello repository eligibility', () => {
  it('finishes startup when a caller hello arrives while the startup reply is pending', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const onHelloResult = vi.fn();
    const client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      helloParams: () => ({ clientId: 'desktop' }),
      onHelloResult,
      heartbeatIntervalMs: 0,
    });
    try {
      client.start();
      socket.open();
      await vi.advanceTimersByTimeAsync(0);
      expect(JSON.parse(socket.writes[0])).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'client.hello',
        params: { clientId: 'desktop' },
      });

      // A renderer capability probe joins AFTER the physical handshake began.
      // The existing test below covers the opposite ordering (caller first).
      const probe = client.request('client.hello', {});
      void probe.catch(() => {});
      const queued = client.request('workspace.list');
      void queued.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(socket.writes).toHaveLength(1);
      socket.receive('{"jsonrpc":"2.0","id":1,"result":{"clientId":"desktop"}}\n');
      await vi.advanceTimersByTimeAsync(0);

      expect(client.getStatus()).toBe('connected');
      const frames = socket.writes.slice(1).map((line) => JSON.parse(line));
      const hello = frames.find((frame) => frame.method === 'client.hello');
      const work = frames.find((frame) => frame.method === 'workspace.list');
      expect(hello).toEqual({
        jsonrpc: '2.0',
        id: expect.any(Number),
        method: 'client.hello',
        params: { clientId: 'desktop' },
      });
      expect(work).toEqual({ jsonrpc: '2.0', id: expect.any(Number), method: 'workspace.list' });
      expect(client.getRepositoryConnection()).toBeNull();
      socket.receive(
        `${JSON.stringify({ jsonrpc: '2.0', id: hello.id, result: { clientId: 'desktop' } })}\n`,
      );
      socket.receive(
        `${JSON.stringify({ jsonrpc: '2.0', id: work.id, result: { workspaces: [] } })}\n`,
      );
      await expect(probe).resolves.toEqual({ clientId: 'desktop' });
      await expect(queued).resolves.toEqual({ workspaces: [] });
      expect(onHelloResult).toHaveBeenCalled();
      expect(client.getRepositoryConnection()).not.toBeNull();
    } finally {
      client.dispose();
      vi.useRealTimers();
    }
  });

  it('does not borrow the initial handshake identity while a queued caller hello runs', async () => {
    const socket = new FakeSocket();
    const client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      helloParams: () => ({ clientId: 'desktop' }),
    });
    try {
      const callerHello = client.request('client.hello');
      await vi.waitFor(() => expect(client.getStatus()).toBe('connecting'));
      socket.open();
      await vi.waitFor(() => expect(socket.writes).toHaveLength(1));
      socket.receive('{"id":1,"result":{"clientId":"first"}}\n');
      await vi.waitFor(() => expect(socket.writes).toHaveLength(2));
      expect(client.getRepositoryConnection()).toBeNull();
      socket.receive('{"id":2,"result":{"clientId":"current"}}\n');
      await callerHello;
      expect(client.getRepositoryConnection()).not.toBeNull();
    } finally {
      client.dispose();
    }
  });
});

describe('hello recovery ordering', () => {
  const clients: JsonRpcClient[] = [];
  function make(helloParams = () => Promise.resolve({ clientId: 'persisted' })) {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const onHelloResult = vi.fn();
    const client = new JsonRpcClient({
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as Duplex;
      },
      helloParams,
      onHelloResult,
      reconnectDelayMs: 100,
      heartbeatIntervalMs: 0,
    });
    client.on('error', () => {});
    clients.push(client);
    client.start();
    return { client, sockets, onHelloResult };
  }
  const tick = () => vi.advanceTimersByTimeAsync(0);
  function reply(socket: FakeSocket, index: number, clientId = 'persisted') {
    const frame = JSON.parse(socket.writes[index]);
    socket.receive(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { clientId } }) + '\n');
  }
  afterEach(() => {
    for (const client of clients.splice(0)) client.dispose();
    vi.useRealTimers();
  });

  it.each(['initial connection', 'established connection'])(
    'recovers the same client after a failed %s with an overlapping hello',
    async (phase) => {
      const { client, sockets } = make();
      const reconnected = vi.fn();
      client.on('reconnected', reconnected);
      if (phase === 'established connection') {
        sockets[0].open();
        await tick();
        reply(sockets[0], 0);
        await tick();
      }
      const captured = client.getRepositoryConnection();
      const staleClose = sockets[0].listeners('close')[0];
      sockets[0].emit('error', new Error('transiently unavailable'));
      expect(sockets[0].destroyed).toBe(true);
      expect(client.getStatus()).toBe('disconnected');
      await vi.advanceTimersByTimeAsync(99);
      expect(sockets).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(2);
      sockets[1].open();
      await tick();
      const probe = client.request('client.hello', { name: 'probe', clientId: 'untrusted' });
      void probe.catch(() => {});
      await tick();
      reply(sockets[1], 0);
      await tick();
      expect(client.getStatus()).toBe('connected');
      expect(reconnected).toHaveBeenCalledOnce();
      expect(JSON.parse(sockets[1].writes[1])).toMatchObject({
        method: 'client.hello',
        params: { name: 'probe', clientId: 'persisted' },
      });
      expect(client.getRepositoryConnection()).toBeNull();
      reply(sockets[1], 1);
      await expect(probe).resolves.toEqual({ clientId: 'persisted' });
      const current = client.getRepositoryConnection();
      expect(current).not.toBeNull();
      if (captured) {
        await expect(client.requestOnCapturedConnection(captured, 'git.status')).rejects.toThrow();
        expect(current?.incarnation).not.toBe(captured.incarnation);
      }
      staleClose();
      expect(client.getRepositoryConnection()).toBe(current);
      const work = client.request('workspace.list');
      const frame = JSON.parse(sockets[1].writes[2]);
      expect(frame.method).toBe('workspace.list');
      sockets[1].receive(JSON.stringify({ id: frame.id, result: { workspaces: [] } }) + '\n');
      await expect(work).resolves.toEqual({ workspaces: [] });
      client.dispose();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sockets).toHaveLength(2);
      expect(sockets.every((socket) => socket.destroyed)).toBe(true);
    },
  );

  it('keeps startup ownership with delayed parameters and concurrent queued hellos', async () => {
    const params = lifecycleDeferred<{ clientId: string }>();
    const provider = vi
      .fn()
      .mockImplementationOnce(() => params.promise)
      .mockResolvedValue({ clientId: 'persisted' });
    const { client, sockets, onHelloResult } = make(provider);
    sockets[0].open();
    const first = client.request('client.hello', { name: 'first' });
    const second = client.request('client.hello', { name: 'second' });
    void first.catch(() => {});
    void second.catch(() => {});
    await tick();
    expect(sockets[0].writes).toHaveLength(0);
    params.resolve({ clientId: 'persisted' });
    await tick();
    reply(sockets[0], 0, 'startup');
    await tick();
    expect(client.getStatus()).toBe('connected');
    expect(sockets[0].writes.slice(1).map((line) => JSON.parse(line).params)).toEqual([
      { name: 'first', clientId: 'persisted' },
      { name: 'second', clientId: 'persisted' },
    ]);
    expect(client.getRepositoryConnection()).toBeNull();
    reply(sockets[0], 2, 'newest');
    await expect(second).resolves.toEqual({ clientId: 'newest' });
    const current = client.getRepositoryConnection();
    expect(current).not.toBeNull();
    reply(sockets[0], 1, 'older');
    await expect(first).resolves.toEqual({ clientId: 'older' });
    expect(client.getRepositoryConnection()).toBe(current);
    expect(onHelloResult.mock.calls.map(([result]) => result.clientId)).toEqual([
      'startup',
      'newest',
    ]);
  });

  it('retires connected identity immediately and rejects a delayed caller after disposal', async () => {
    const params = lifecycleDeferred<{ clientId: string }>();
    const provider = vi
      .fn()
      .mockResolvedValueOnce({ clientId: 'persisted' })
      .mockImplementationOnce(() => params.promise);
    const { client, sockets, onHelloResult } = make(provider);
    sockets[0].open();
    await tick();
    reply(sockets[0], 0);
    await tick();
    const captured = client.getRepositoryConnection()!;
    const caller = client.request('client.hello');
    const outcome = vi.fn();
    void caller.then(
      () => outcome('resolved'),
      (error: Error) => outcome(error.message),
    );
    expect(client.getRepositoryConnection()).toBeNull();
    await expect(client.requestOnCapturedConnection(captured, 'git.status')).rejects.toThrow();
    expect(sockets[0].writes).toHaveLength(1);
    client.dispose();
    params.resolve({ clientId: 'persisted' });
    await tick();
    expect(outcome).toHaveBeenCalledWith('JSON-RPC client disposed');
    expect(sockets).toHaveLength(1);
    expect(sockets[0].writes).toHaveLength(1);
    expect(sockets[0].destroyed).toBe(true);
    expect(onHelloResult).toHaveBeenCalledOnce();
  });

  it.each(['replacement', 'disposal'])(
    'ignores delayed startup parameters after socket %s',
    async (ending) => {
      const params = lifecycleDeferred<{ clientId: string }>();
      const provider = vi
        .fn()
        .mockImplementationOnce(() => params.promise)
        .mockResolvedValue({ clientId: 'persisted' });
      const { client, sockets, onHelloResult } = make(provider);
      sockets[0].open();
      await tick();
      if (ending === 'replacement') {
        sockets[0].emit('close');
        await vi.advanceTimersByTimeAsync(100);
        sockets[1].open();
        await tick();
        reply(sockets[1], 0);
        await tick();
        expect(client.getStatus()).toBe('connected');
      } else {
        client.dispose();
      }
      const current = client.getRepositoryConnection();
      params.resolve({ clientId: 'obsolete' });
      await tick();
      expect(sockets[0].writes).toHaveLength(0);
      expect(client.getRepositoryConnection()).toBe(current);
      expect(onHelloResult).toHaveBeenCalledTimes(ending === 'replacement' ? 1 : 0);
      if (ending === 'replacement') expect(sockets[1].writes).toHaveLength(1);
    },
  );
});

describe('private repository connection evidence', () => {
  const clients: JsonRpcClient[] = [];
  afterEach(() => clients.splice(0).forEach((client) => client.dispose()));

  async function start(capability: unknown = 1) {
    const sockets: FakeSocket[] = [];
    const onHelloResult = vi.fn();
    const client = new JsonRpcClient({
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as Duplex;
      },
      helloParams: () => ({ clientId: 'desktop' }),
      onHelloResult,
      reconnectDelayMs: 1,
    });
    clients.push(client);
    const events: unknown[] = [];
    client.onRepositoryConnectionEvent((event) => events.push(event));
    client.start();
    sockets[0].open();
    await vi.waitFor(() => expect(sockets[0].writes).toHaveLength(1));
    sockets[0].receive(
      JSON.stringify({
        id: 1,
        result: {
          clientId: 'desktop',
          server: { capabilities: { repositoryContext: capability } },
        },
      }) + '\n',
    );
    await vi.waitFor(() => expect(client.getStatus()).toBe('connected'));
    return { client, sockets, events, onHelloResult };
  }

  it.each([undefined, false, '1', 2])(
    'does not borrow unsupported capability %j',
    async (value) => {
      const { client } = await start(value === undefined ? null : value);
      expect(client.getRepositoryConnection()?.repositoryContext).toBe(false);
    },
  );

  it('stamps notifications with the physical source and retires identity before re-hello', async () => {
    const { client, sockets, events } = await start();
    const original = client.getRepositoryConnection()!;
    expect(original.repositoryContext).toBe(true);
    const notification = {
      method: 'workspace.repositoryContext.retired',
      params: {
        lifetimeIds: ['old'],
        sequence: '1',
        allRetired: false,
        terminal: false,
      },
    };
    sockets[0].receive(JSON.stringify(notification) + '\n');
    expect(events).toContainEqual({
      type: 'notification',
      incarnation: original.incarnation,
      notification,
    });
    const hello = client.request('client.hello');
    expect(events).toContainEqual({ type: 'identity-retired', connection: original });
    expect(client.getRepositoryConnection()).toBeNull();
    await vi.waitFor(() => expect(sockets[0].writes).toHaveLength(2));
    sockets[0].receive(
      '{"id":2,"result":{"clientId":"desktop","server":{"capabilities":{"repositoryContext":1}}}}\n',
    );
    await hello;
    expect(client.getRepositoryConnection()?.incarnation).toBe(original.incarnation);
    expect(client.getRepositoryConnection()).not.toBe(original);
    expect(events.filter((event) => (event as { type: string }).type === 'opened')).toHaveLength(1);
  });

  it('drops a retained old data callback after reconnect instead of retagging it', async () => {
    const { client, sockets, events } = await start();
    const original = client.getRepositoryConnection()!;
    const oldData = sockets[0].listeners('data')[0];
    const ordinary = vi.fn();
    client.on('notification', ordinary);
    sockets[0].emit('close');
    expect(events).toContainEqual({ type: 'closed', incarnation: original.incarnation });
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1].open();
    await vi.waitFor(() => expect(sockets[1].writes).toHaveLength(1));
    const hello = JSON.parse(sockets[1].writes[0]);
    sockets[1].receive(JSON.stringify({ id: hello.id, result: { clientId: 'desktop' } }) + '\n');
    await vi.waitFor(() => expect(client.getStatus()).toBe('connected'));
    oldData(
      Buffer.from('{"method":"workspace.repositoryContext.retired","params":{"sequence":"999"}}\n'),
    );
    expect(ordinary).not.toHaveBeenCalled();
    expect(events.filter((event) => (event as { type: string }).type === 'notification')).toEqual(
      [],
    );
  });

  it('stops parsing the old buffered batch after a notification retires the socket', async () => {
    const { client, sockets } = await start();
    const ordinary = vi.fn(() => client.dispose());
    client.on('notification', ordinary);
    sockets[0].receive('{"method":"first"}\n{"method":"second"}\n');
    expect(ordinary).toHaveBeenCalledOnce();
  });
  it('does not confirm or publish an older hello that completes after a newer attempt', async () => {
    const { client, sockets, onHelloResult } = await start();
    const first = client.request('client.hello');
    const second = client.request('client.hello');
    await vi.waitFor(() => expect(sockets[0].writes).toHaveLength(3));
    sockets[0].receive(
      JSON.stringify({
        id: 3,
        result: { clientId: 'current', server: { capabilities: { repositoryContext: 1 } } },
      }) + '\n',
    );
    await second;
    const current = client.getRepositoryConnection();
    sockets[0].receive(
      JSON.stringify({ id: 2, result: { clientId: 'old', server: { capabilities: {} } } }) + '\n',
    );
    await first;
    expect(client.getRepositoryConnection()).toBe(current);
    expect(onHelloResult).toHaveBeenCalledTimes(2);
    expect(onHelloResult).toHaveBeenLastCalledWith({
      clientId: 'current',
      server: { capabilities: { repositoryContext: 1 } },
    });
  });
  it('confirms native review only on the current physical hello, preserving ordinary requests', async () => {
    const { client, sockets } = await start();
    expect(client.getRepositoryConnection()?.nativeReview).toBe(false);
    const hello = client.request('client.hello');
    await vi.waitFor(() => expect(sockets[0].writes).toHaveLength(2));
    sockets[0].receive(
      JSON.stringify({
        id: 2,
        result: { clientId: 'native', server: { capabilities: { nativeReview: 1 } } },
      }) + '\n',
    );
    await hello;
    const confirmed = client.getRepositoryConnection()!;
    expect(confirmed.nativeReview).toBe(true);
    const next = client.request('client.hello');
    await vi.waitFor(() => expect(sockets[0].writes).toHaveLength(3));
    sockets[0].receive(
      JSON.stringify({
        id: 3,
        result: { clientId: 'older', server: { capabilities: { nativeReview: '1' } } },
      }) + '\n',
    );
    await next;
    expect(client.getRepositoryConnection()?.nativeReview).toBe(false);
    await expect(
      client.requestOnCapturedConnection(confirmed, 'accept-changes.prepare', {}),
    ).rejects.toThrow();
  });
  it('binds companion capability to the original successful hello and retires it on replacement', async () => {
    const { client, sockets } = await start();
    const original = client.getRepositoryConnection()!;
    expect(original.nativeReviewCompanion).toBe(false);
    const hello = client.request('client.hello');
    await vi.waitFor(() => expect(sockets[0].writes).toHaveLength(2));
    sockets[0].receive(
      JSON.stringify({
        id: 2,
        result: {
          clientId: 'companion',
          server: { capabilities: { nativeReview: 1, nativeReviewCompanion: 1 } },
        },
      }) + '\n',
    );
    await hello;
    const confirmed = client.getRepositoryConnection()!;
    expect(confirmed.nativeReviewCompanion).toBe(true);
    expect(confirmed.incarnation).toBe(original.incarnation);
    const replacement = client.request('client.hello');
    expect(client.getRepositoryConnection()).toBeNull();
    await vi.waitFor(() => expect(sockets[0].writes).toHaveLength(3));
    sockets[0].receive(
      JSON.stringify({
        id: 3,
        result: {
          clientId: 'older',
          server: { capabilities: { nativeReview: 1, nativeReviewCompanion: '1' } },
        },
      }) + '\n',
    );
    await replacement;
    expect(client.getRepositoryConnection()?.nativeReviewCompanion).toBe(false);
    const count = sockets[0].writes.length;
    await expect(
      client.requestOnCapturedConnection(confirmed, 'accept-changes.prepare', {}),
    ).rejects.toThrow();
    expect(sockets[0].writes).toHaveLength(count);
  });
});

/** Independent real stream for opt-in lifecycle schedules; old FakeSocket stays exact. */
class LifecycleSocket extends LifecycleDuplex {
  readonly frames: Array<{
    id: number | string;
    method?: string;
    params?: unknown;
    result?: unknown;
  }> = [];
  readonly written = new EventEmitter();
  closeOriginal: (() => void) | undefined;
  holdClose = false;
  constructor(emitClose = true) {
    super({ emitClose });
  }
  override _read(): void {}
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const frame = JSON.parse(chunk.toString());
    this.frames.push(frame);
    this.written.emit('frame', frame);
    callback();
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this.holdClose) this.closeOriginal = () => callback(error);
    else callback(error);
  }
  reply(id: number | string, result: unknown): void {
    this.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'));
  }
  next(method: string): Promise<{ id: number | string; method: string }> {
    return new Promise((resolve) => {
      const receive = (frame: { id: number | string; method: string }) => {
        if (frame.method !== method) return;
        this.written.off('frame', receive);
        resolve(frame);
      };
      this.written.on('frame', receive);
    });
  }
}
function lifecycleDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function lifecycleDrained(ticket: JsonRpcRetirement): Promise<void> {
  if (ticket.isDrained()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = ticket.subscribeChanged(() => {
      if (ticket.isDrained()) {
        off();
        resolve();
      }
    });
  });
}

describe('JsonRpcClient opt-in original lifecycle', () => {
  const clients: JsonRpcClient[] = [];
  function make(
    options: ConstructorParameters<typeof JsonRpcClient>[0] = {},
    socket = new LifecycleSocket(),
  ) {
    const client = new JsonRpcClient({
      socketFactory: () => socket,
      lifecycle: { scope: Symbol('controlled-client'), generation: 1 },
      ...options,
    });
    clients.push(client);
    return { client, socket };
  }
  afterEach(() => {
    for (const client of clients.splice(0)) client.dispose();
    vi.useRealTimers();
  });

  it('C3/C5 owns the actual asynchronous hello-result callback through its original rejection', async () => {
    const returned = lifecycleDeferred();
    const entered = lifecycleDeferred();
    const error = new Error('original hello callback rejection');
    const { client, socket } = make({
      helloParams: () => ({ clientId: 'controlled' }),
      onHelloResult() {
        entered.resolve();
        return returned.promise;
      },
    });
    client.start();
    socket.emit('connect');
    const hello = await socket.next('client.hello');
    socket.reply(hello.id, { clientId: 'confirmed', server: { capabilities: {} } });
    await entered.promise;
    const ticket = client.beginRetirement();
    expect(ticket.isDrained()).toBe(false);
    returned.reject(error);
    await lifecycleDrained(ticket);
    const result = await ticket.seal().finish();
    expect(result.outcome).toBe('original-failure');
    expect(result.failures.some((f) => f.error === error)).toBe(true);
  });

  it('C3 distinguishes an unsolicited actual close from a requested retirement close', async () => {
    const { client, socket } = make();
    client.start();
    socket.emit('connect');
    const closed = new Promise<void>((resolve) => socket.once('close', resolve));
    const ticket = client.beginRetirement();
    socket.destroy();
    await closed;
    await lifecycleDrained(ticket);
    const result = await ticket.seal().finish();
    expect(result.outcome).toBe('original-failure');
    expect(result.failures.some((f) => f.kind === 'transport')).toBe(true);
  });

  it('C1/C2 stops future ticks but joins the original outer health chain after inner settlement', async () => {
    vi.useFakeTimers();
    const outer = lifecycleDeferred();
    const innerDone = lifecycleDeferred<unknown>();
    let original!: Promise<unknown>;
    const receivers: unknown[] = [];
    const setup = make({
      heartbeatIntervalMs: 10,
      healthCheck: async function () {
        receivers.push(this);
        original = client.request('host.status');
        innerDone.resolve(await original);
        await outer.promise;
      },
    });
    const client = setup.client;
    client.start();
    setup.socket.emit('connect');
    vi.advanceTimersByTime(10);
    const ticket = client.beginRetirement();
    expect(ticket).toBe(client.beginRetirement());
    expect(receivers).toEqual([client]);
    expect(() => ticket.seal()).toThrow('not joined');
    const value = { hostname: 'original' };
    setup.socket.reply(setup.socket.frames[0]!.id, value);
    expect(await original).toEqual(value);
    await innerDone.promise;
    expect(ticket.isDrained()).toBe(false);
    expect(() => ticket.seal()).toThrow('not joined');
    vi.advanceTimersByTime(100);
    expect(setup.socket.frames.map((f) => f.method)).toEqual(['host.status']);
    outer.resolve();
    await lifecycleDrained(ticket);
    const sealed = ticket.seal();
    const result = sealed.finish();
    expect(sealed).toBe(ticket.seal());
    expect(result).toBe(sealed.finish());
    expect((await result).outcome).toBe('clean');
  });

  it('C3 retains a naturally rejected original request and synchronous callback error identities', async () => {
    vi.useFakeTimers();
    const thrown = new Error('controlled health callback');
    const { client, socket } = make({
      heartbeatIntervalMs: 10,
      healthCheck() {
        throw thrown;
      },
    });
    client.start();
    socket.emit('connect');
    expect(() => vi.advanceTimersByTime(10)).toThrow(thrown);
    const original = client.request('host.status');
    const wire = socket.frames.at(-1)!;
    socket.emit(
      'data',
      Buffer.from(
        JSON.stringify({ id: wire.id, error: { code: -32001, message: 'refused' } }) + '\n',
      ),
    );
    const rejected = await original.catch((error: unknown) => error);
    const ticket = client.beginRetirement();
    await lifecycleDrained(ticket);
    const result = await ticket.seal().finish();
    expect(result.outcome).toBe('original-failure');
    expect(result.failures.some((f) => f.error === thrown)).toBe(true);
    expect(result.failures.some((f) => f.error === rejected)).toBe(true);
  });

  it('C3 retains actual timeout and natural transport failure without replacement work', async () => {
    vi.useFakeTimers();
    let allocations = 0;
    const socket = new LifecycleSocket();
    const { client } = make(
      {
        socketFactory: () => {
          allocations++;
          return socket;
        },
        requestTimeoutMs: 20,
      },
      socket,
    );
    client.start();
    socket.emit('connect');
    const original = client.request('host.status');
    const errorPromise = original.catch((error: unknown) => error);
    const ticket = client.beginRetirement();
    vi.advanceTimersByTime(20);
    const timeout = await errorPromise;
    const closed = new Error('original transport failed');
    socket.emit('error', closed);
    await lifecycleDrained(ticket);
    const result = await ticket.seal().finish();
    expect(result.outcome).toBe('original-failure');
    expect(result.failures.some((f) => f.error === timeout)).toBe(true);
    expect(result.failures.some((f) => f.error === closed)).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(allocations).toBe(1);
  });

  it('C4 cancels an armed original reconnect and does not admit a queued new dial', async () => {
    vi.useFakeTimers();
    let allocations = 0;
    const socket = new LifecycleSocket();
    const { client } = make(
      {
        socketFactory: () => {
          allocations++;
          return socket;
        },
      },
      socket,
    );
    client.start();
    socket.emit('connect');
    socket.emit('error', new Error('controlled link failure'));
    const ticket = client.beginRetirement();
    vi.advanceTimersByTime(10000);
    client.start();
    expect(allocations).toBe(1);
    await lifecycleDrained(ticket);
    expect((await ticket.seal().finish()).outcome).toBe('original-failure');
  });

  it('C5 retains the admitted connect/hello parameters and original result through stop', async () => {
    const params = lifecycleDeferred<Record<string, unknown>>();
    const seen: unknown[] = [];
    const { client, socket } = make({
      helloParams: () => params.promise,
      onHelloResult: (value) => {
        seen.push(value);
      },
    });
    client.start();
    const ticket = client.beginRetirement();
    socket.emit('connect');
    expect(ticket.isDrained()).toBe(false);
    const hello = socket.next('client.hello');
    params.resolve({ clientId: 'controlled' });
    const frame = await hello;
    const value = { clientId: 'original', server: { capabilities: { nativeReview: 1 } } };
    socket.reply(frame.id, value);
    await lifecycleDrained(ticket);
    expect(seen).toEqual([value]);
    expect(socket.frames).toHaveLength(1);
    expect((await ticket.seal().finish()).outcome).toBe('clean');
  });

  it('C6 retains a terminal request then genuinely late release and unsubscribe acknowledgments', async () => {
    const { client, socket } = make();
    client.start();
    socket.emit('connect');
    const execute = client.request('accept-changes.execute', {
      operationId: 'controlled-operation',
    });
    const ticket = client.beginRetirement();
    const result = { state: 'settled', operationId: 'controlled-operation' };
    socket.reply(socket.frames.at(-1)!.id, result);
    expect(await execute).toEqual(result);
    const release = client.request('accept-changes.release', {
      operationId: 'controlled-operation',
    });
    const releaseId = socket.frames.at(-1)!.id;
    const unsubscribe = client.request('events.unsubscribe', {
      subscriptionId: 'original-subscription',
    });
    const unsubscribeId = socket.frames.at(-1)!.id;
    expect(() => ticket.seal()).toThrow('not joined');
    socket.reply(releaseId, { released: true });
    await release;
    expect(() => ticket.seal()).toThrow('not joined');
    socket.reply(unsubscribeId, { success: true });
    await unsubscribe;
    await lifecycleDrained(ticket);
    expect(socket.frames.map((f) => f.method)).toEqual([
      'accept-changes.execute',
      'accept-changes.release',
      'events.unsubscribe',
    ]);
    expect((await ticket.seal().finish()).outcome).toBe('clean');
  });

  it('C7 retains immediate legacy disposal as forced and shares the one finish result', async () => {
    const { client, socket } = make();
    client.start();
    socket.emit('connect');
    const request = client.request('host.status');
    const rejected = request.catch((error: unknown) => error);
    const ticket = client.beginRetirement();
    client.dispose();
    const error = await rejected;
    await lifecycleDrained(ticket);
    const sealed = ticket.seal();
    const result = sealed.finish();
    expect(sealed.finish()).toBe(result);
    const receipt = await result;
    expect(receipt.outcome).toBe('forced');
    expect(receipt.failures.some((f) => f.error === error)).toBe(true);
    expect(receipt.closes).toHaveLength(1);
    expect(receipt.closes[0]!.closeObserved).toBe(true);
  });

  it('C8 waits for the real Duplex close after removeAllListeners and never equates destroyed with close', async () => {
    const { client, socket } = make();
    socket.holdClose = true;
    client.start();
    socket.emit('connect');
    const ticket = client.beginRetirement();
    const result = ticket.seal().finish();
    let done = false;
    void result.then(() => {
      done = true;
    });
    expect(socket.destroyed).toBe(true);
    await Promise.resolve();
    expect(done).toBe(false);
    socket.closeOriginal!();
    const receipt = await result;
    expect(receipt.closes[0]).toMatchObject({ destroyRequested: true, closeObserved: true });
  });

  it('C8 leaves a stream without an emitted close explicitly incomplete', async () => {
    const socket = new LifecycleSocket(false);
    const { client } = make({}, socket);
    client.start();
    socket.emit('connect');
    const result = client.beginRetirement().seal().finish();
    let completed = false;
    void result.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(socket.destroyed).toBe(true);
    expect(completed).toBe(false);
    expect(socket.listenerCount('close')).toBe(1);
  });

  it('C5/C7 joins the original reverse callback and preserves a late request as a fault', async () => {
    const hold = lifecycleDeferred<object>();
    const entered = lifecycleDeferred();
    const { client, socket } = make();
    client.registerMethod('controlled.reverse', () => {
      entered.resolve();
      return hold.promise;
    });
    client.start();
    socket.emit('connect');
    socket.emit(
      'data',
      Buffer.from(JSON.stringify({ id: 'rev-1', method: 'controlled.reverse', params: {} }) + '\n'),
    );
    await entered.promise;
    const ticket = client.beginRetirement();
    expect(ticket.isDrained()).toBe(false);
    hold.resolve({ original: true });
    await lifecycleDrained(ticket);
    expect(socket.frames).toEqual([{ jsonrpc: '2.0', id: 'rev-1', result: { original: true } }]);
    const sealed = ticket.seal();
    await expect(client.request('host.status')).rejects.toThrow('admission sealed');
    const receipt = await sealed.finish();
    expect(receipt.outcome).toBe('ownership-fault');
    expect(socket.frames).toHaveLength(1);
  });
  it('C3 retains a synchronous reverse reply transport error in the original retirement facts', async () => {
    const original = new Error('original reverse write failure');
    const entered = lifecycleDeferred();
    const { client, socket } = make();
    const errors: unknown[] = [];
    client.on('error', (error) => errors.push(error));
    client.registerMethod('controlled.reverse', () => {
      entered.resolve();
      return { original: true };
    });
    vi.spyOn(socket, '_write').mockImplementation(() => {
      throw original;
    });
    client.start();
    socket.emit('connect');
    socket.emit(
      'data',
      Buffer.from(JSON.stringify({ id: 'rev-2', method: 'controlled.reverse', params: {} }) + '\n'),
    );
    await entered.promise;
    const ticket = client.beginRetirement();
    await lifecycleDrained(ticket);
    expect(errors).toEqual([original]);
    const result = await ticket.seal().finish();
    expect(result.outcome).toBe('original-failure');
    expect(result.failures.some((f) => f.error === original)).toBe(true);
  });
});

describe('M original producer admission and member drain', () => {
  const clients: JsonRpcClient[] = [];
  function make(options: ConstructorParameters<typeof JsonRpcClient>[0] = {}) {
    const socket = new LifecycleSocket();
    const client = new JsonRpcClient({
      socketFactory: () => socket,
      lifecycle: { scope: Symbol('member-control'), generation: 1 },
      ...options,
    });
    clients.push(client);
    client.start();
    socket.emit('connect');
    return { client, socket };
  }
  afterEach(() => {
    for (const client of clients.splice(0)) client.dispose();
    vi.useRealTimers();
  });
  it('M1 holds a real parent until delayed original request, result and close join', async () => {
    const { client, socket } = make();
    socket.holdClose = true;
    const parent = client.beginOriginalProducer()!;
    const ticket = client.beginMemberRetirement();
    expect(ticket.isDrained()).toBe(false);
    const original = client.request('controlled.release', { same: 'arguments' }, undefined, parent);
    const frame = socket.frames.at(-1)!;
    const value = { released: true };
    socket.reply(frame.id, value);
    expect(await original).toEqual(value);
    const received = await original;
    expect(await original).toBe(received);
    expect(ticket.isDrained()).toBe(false);
    client.finishOriginalProducer(parent);
    await lifecycleDrained(ticket);
    const finish = ticket.seal().finish();
    expect(ticket.seal().finish()).toBe(finish);
    let ended = false;
    void finish.then(() => {
      ended = true;
    });
    await Promise.resolve();
    expect(ended).toBe(false);
    socket.closeOriginal!();
    expect((await finish).outcome).toBe('clean');
  });
  it.each(['independent', 'forged', 'foreign', 'finished'] as const)(
    'M2 rejects %s despite identical arguments',
    async (kind) => {
      const { client, socket } = make();
      const parent = client.beginOriginalProducer()!;
      const foreign = make().client.beginOriginalProducer()!;
      if (kind === 'finished') client.finishOriginalProducer(parent);
      const ticket = client.beginMemberRetirement();
      const before = socket.frames.length;
      const wrong =
        kind === 'independent'
          ? undefined
          : kind === 'forged'
            ? {}
            : kind === 'foreign'
              ? foreign
              : parent;
      await expect(
        client.request('controlled.release', { same: 'arguments' }, undefined, wrong),
      ).rejects.toThrow();
      expect(socket.frames).toHaveLength(before);
      expect(() => client.beginOriginalProducer()).toThrow();
      if (kind !== 'finished') client.finishOriginalProducer(parent);
      await lifecycleDrained(ticket);
      expect((await ticket.seal().finish()).outcome).toBe('ownership-fault');
    },
  );
  it('M3 closes parent admission at its actual terminal boundary', async () => {
    const { client, socket } = make();
    const parent = client.beginOriginalProducer()!;
    const child = client.beginOriginalProducer(parent)!;
    client.finishOriginalProducer(parent);
    const ticket = client.beginMemberRetirement();
    expect(() => client.beginOriginalProducer(parent)).toThrow();
    const original = client.request('controlled.child', undefined, undefined, child);
    socket.reply(socket.frames.at(-1)!.id, undefined);
    await original;
    client.finishOriginalProducer(child);
    await lifecycleDrained(ticket);
    expect((await ticket.seal().finish()).outcome).toBe('ownership-fault');
  });
  it('M4 distinguishes real health request settlement from its held callback/full chain', async () => {
    vi.useFakeTimers();
    const outer = lifecycleDeferred();
    const inner = lifecycleDeferred();
    let client!: JsonRpcClient;
    const made = make({
      heartbeatIntervalMs: 10,
      healthCheck: async (parent) => {
        await client.request('host.status', undefined, undefined, parent);
        inner.resolve();
        await outer.promise;
      },
    });
    client = made.client;
    vi.advanceTimersByTime(10);
    const ticket = client.beginMemberRetirement();
    made.socket.reply(made.socket.frames.at(-1)!.id, { hostname: 'controlled' });
    await inner.promise;
    expect(ticket.isDrained()).toBe(false);
    outer.resolve();
    await lifecycleDrained(ticket);
    vi.useRealTimers();
    expect((await ticket.seal().finish()).outcome).toBe('clean');
  });
  it('M5 preserves ordinary-off request arguments and actual rejection identity', async () => {
    const { client, socket } = make({ lifecycle: undefined });
    expect(client.beginOriginalProducer()).toBeUndefined();
    const original = client.request('ordinary', { value: 1 });
    const frame = socket.frames.at(-1)!;
    socket.emit(
      'data',
      Buffer.from(
        JSON.stringify({ id: frame.id, error: { code: -32000, message: 'controlled' } }) + '\n',
      ),
    );
    const caught = await original.catch((error) => error);
    expect(caught).toBeInstanceOf(JsonRpcError);
    expect(frame.params).toEqual({ value: 1 });
    expect(() => client.beginMemberRetirement()).toThrow('not enrolled');
  });
});
