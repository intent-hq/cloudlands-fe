/**
 * Unit tests for the browser WebSocket `BackendTransport`.
 *
 * A fake `BrowserWebSocketLike` drives the transport deterministically: tests
 * assert the exact JSON-RPC frames written to the wire (PROTOCOL.md §1–§4)
 * and feed back protocol-shaped responses/notifications. Covers request
 * correlation, error mapping to `BackendError`, timeouts, reconnect with
 * backoff + the `reconnected` signal (RESUB-1), notification fanout
 * (including `subscription.push`), subscribe/unsubscribe semantics, reverse
 * requests, and URL resolution from runtime/development configuration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from './backend-transport-types';
import {
  BrowserWebSocketTransport,
  type BrowserWebSocketLike,
  createBrowserWebSocketTransport,
  resolveBrowserWsUrl,
  sanitizeWsUrlForDisplay,
} from './browser-websocket-transport';

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
  connectTimeoutMs?: number;
}) {
  const sockets: FakeWebSocket[] = [];
  const transport = new BrowserWebSocketTransport({
    url: 'ws://127.0.0.1:9100/rpc?token=test',
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

function helloResult(clientId = 'browser-1') {
  return {
    clientId,
    protocolVersion: '2.2',
    server: {
      locality: 'local',
      hasDisplay: false,
      osArch: 'linux/x86_64',
      version: '0.1.0',
      protocolVersion: '2.2',
      capabilities: { liveState: true },
    },
  };
}

/** Complete the real connect handshake for tests exercising unrelated RPC behavior. */
async function connect(socket: FakeWebSocket): Promise<void> {
  socket.open();
  await flush();
  const hello = socket.lastFrame();
  expect(hello).toMatchObject({ method: 'client.hello' });
  socket.sent.pop();
  socket.receive({ jsonrpc: '2.0', id: hello.id, result: helloResult() });
  await flush();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('resolveBrowserWsUrl', () => {
  it('reads deployment-time runtime configuration without a build-time URL', () => {
    vi.stubGlobal('__INTENT_RUNTIME_CONFIG__', {
      intentdWsUrl: 'wss://daemon.example/rpc?token=runtime',
    });
    expect(resolveBrowserWsUrl()).toBe('wss://daemon.example/rpc?token=runtime');
  });

  it('returns a trimmed ws:// URL', () => {
    expect(resolveBrowserWsUrl(' ws://localhost:9100/rpc ')).toBe('ws://localhost:9100/rpc');
  });

  it('resolves a same-origin path using the page host', () => {
    vi.stubGlobal('location', { protocol: 'http:', host: '127.0.0.1:64197' });
    expect(resolveBrowserWsUrl('/intentd/ws')).toBe('ws://127.0.0.1:64197/intentd/ws');
  });

  it('uses a secure WebSocket for an HTTPS page', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'localhost:8443' });
    expect(resolveBrowserWsUrl('/intentd/ws')).toBe('wss://localhost:8443/intentd/ws');
  });

  it('accepts wss:// URLs with a token query param', () => {
    expect(resolveBrowserWsUrl('wss://daemon.example/rpc?token=abc')).toBe(
      'wss://daemon.example/rpc?token=abc',
    );
  });

  it('rejects insecure remote ws:// URLs that the renderer CSP blocks', () => {
    expect(resolveBrowserWsUrl('ws://daemon.example/rpc')).toBeUndefined();
  });

  it('returns undefined for unset, blank, or non-string values', () => {
    expect(resolveBrowserWsUrl(undefined)).toBeUndefined();
    expect(resolveBrowserWsUrl('')).toBeUndefined();
    expect(resolveBrowserWsUrl('   ')).toBeUndefined();
    expect(resolveBrowserWsUrl(42)).toBeUndefined();
  });

  it('rejects non-websocket URLs and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveBrowserWsUrl('http://localhost:9100/rpc')).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('sanitizeWsUrlForDisplay', () => {
  it('strips userinfo, query, and hash from parseable URLs', () => {
    expect(sanitizeWsUrlForDisplay('ws://user:pass@host:9100/rpc?token=secret#frag')).toBe(
      'ws://host:9100/rpc',
    );
  });

  it('strips userinfo, query, and hash in the parse-failure fallback', () => {
    // Missing scheme separator slashes with an explicit ws:// prefix on the
    // authority — a shape `new URL()` rejects in some engines; force the
    // fallback with an unparseable port instead.
    expect(sanitizeWsUrlForDisplay('ws://user:pass@host:not-a-port/rpc?token=secret#frag')).toBe(
      'ws://host:not-a-port/rpc',
    );
  });
});

describe('BrowserWebSocketTransport', () => {
  it('holds cold-start presence until client.hello succeeds on that socket', async () => {
    const { transport, socket } = createHarness();
    const presence = transport.request('presence.update', { focus: [], typing: null });
    // Keep the assertion failure from leaving an unhandled teardown rejection.
    void presence.catch(() => undefined);
    try {
      socket().open();
      await flush();
      expect(socket().sent.map((raw) => JSON.parse(raw).method)).toEqual(['client.hello']);
      const hello = socket().lastFrame();
      socket().receive({
        jsonrpc: '2.0',
        id: hello.id,
        result: helloResult(),
      });
      await flush();
      const report = socket().lastFrame();
      expect(report).toMatchObject({
        method: 'presence.update',
        params: { focus: [], typing: null },
      });
      socket().receive({ jsonrpc: '2.0', id: report.id, result: { typingSource: 'ts-1' } });
      await expect(presence).resolves.toEqual({ typingSource: 'ts-1' });
    } finally {
      transport.dispose();
    }
  });

  it('replays hello with the same identity before reconnect subscriptions and presence', async () => {
    vi.useFakeTimers();
    const { transport, socket } = createHarness();
    const initial = transport.request('presence.update', { focus: [], typing: null });
    await connect(socket());
    socket().receive({
      jsonrpc: '2.0',
      id: socket().lastFrame().id,
      result: { typingSource: 'ts-1' },
    });
    await initial;
    const replay = vi.fn(() => transport.subscribe({ events: ['presence:changed'] }));
    transport.onReconnected(replay);
    socket().drop();
    const next = transport.request('presence.update', {
      focus: [{ workspaceId: 'ws-b' }],
      typing: null,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    socket().open();
    await flush();
    expect(replay).not.toHaveBeenCalled();
    expect(transport.getConnectionStatus()).toBe('connecting');
    expect(socket().sent).toHaveLength(1);
    expect(socket().lastFrame()).toMatchObject({
      method: 'client.hello',
      params: { clientId: 'browser-1' },
    });
    socket().receive({ jsonrpc: '2.0', id: socket().lastFrame().id, result: helloResult() });
    await flush();
    expect(replay).toHaveBeenCalledOnce();
    const frames = socket().sent.map((raw) => JSON.parse(raw));
    for (const frame of frames.slice(1)) {
      socket().receive({
        jsonrpc: '2.0',
        id: frame.id,
        result:
          frame.method === 'presence.update'
            ? { typingSource: 'ts-2' }
            : { subscriptionId: 'sub-2' },
      });
    }
    expect(frames.map((f) => f.method).sort()).toEqual([
      'client.hello',
      'events.subscribe',
      'presence.update',
    ]);
    await expect(next).resolves.toEqual({ typingSource: 'ts-2' });
    await expect(replay.mock.results[0].value).resolves.toEqual({ subscriptionId: 'sub-2' });
    transport.dispose();
  });

  it.each(['pending', 'answered'] as const)(
    'ignores an obsolete %s hello when the socket is replaced',
    async (phase) => {
      vi.useFakeTimers();
      const { transport, socket } = createHarness();
      const first = transport
        .request('presence.update', { focus: [], typing: null })
        .catch((e: BackendError) => e.code);
      socket().open();
      const oldSocket = socket();
      const oldMessage = oldSocket.onmessage!;
      const oldReply = {
        data: JSON.stringify({
          jsonrpc: '2.0',
          id: oldSocket.lastFrame().id,
          result: helloResult('old-client'),
        }),
      };
      if (phase === 'answered') oldMessage(oldReply);
      oldSocket.drop();
      await expect(first).resolves.toBe('TRANSPORT_ERROR');
      const second = transport.request('presence.update', { focus: [], typing: null });
      await vi.advanceTimersByTimeAsync(1_000);
      socket().open();
      oldMessage(oldReply);
      await flush();
      expect(transport.getConnectionStatus()).toBe('connecting');
      expect(socket().sent.map((raw) => JSON.parse(raw).method)).toEqual(['client.hello']);
      socket().receive({ jsonrpc: '2.0', id: socket().lastFrame().id, result: helloResult() });
      await flush();
      expect(socket().lastFrame()).toMatchObject({ method: 'presence.update' });
      socket().receive({
        jsonrpc: '2.0',
        id: socket().lastFrame().id,
        result: { typingSource: 'ts-new' },
      });
      await expect(second).resolves.toEqual({ typingSource: 'ts-new' });
      transport.dispose();
    },
  );

  it('rejects queued presence on disposal and ignores the delayed hello reply', async () => {
    vi.useFakeTimers();
    const { transport, socket, sockets } = createHarness();
    const presence = transport.request('presence.update', { focus: [], typing: null });
    socket().open();
    const onMessage = socket().onmessage!;
    const hello = socket().lastFrame();
    transport.dispose();
    await expect(presence).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    onMessage({ data: JSON.stringify({ jsonrpc: '2.0', id: hello.id, result: helloResult() }) });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.getConnectionStatus()).toBe('disconnected');
    expect(socket().sent.map((raw) => JSON.parse(raw).method)).toEqual(['client.hello']);
    expect(sockets).toHaveLength(1);
  });

  it.each([-32601, -32602, -32603])(
    'rejects presence locally after hello error %s while unrelated RPCs still work',
    async (code) => {
      const { transport, socket } = createHarness();
      const presence = transport.request('presence.update', { focus: [], typing: null });
      const rejected = expect(presence).rejects.toMatchObject({ rpcCode: code });
      const unrelated = transport.request('workspace.list', {});
      socket().open();
      socket().receive({
        jsonrpc: '2.0',
        id: socket().lastFrame().id,
        error: { code, message: 'hello failed' },
      });
      await rejected;
      await flush();
      expect(socket().sent.map((raw) => JSON.parse(raw).method)).toEqual([
        'client.hello',
        'workspace.list',
      ]);
      socket().receive({ jsonrpc: '2.0', id: socket().lastFrame().id, result: { workspaces: [] } });
      await expect(unrelated).resolves.toEqual({ workspaces: [] });
      await expect(
        transport.request('presence.update', { focus: [], typing: null }),
      ).rejects.toMatchObject({ rpcCode: code });
      transport.dispose();
    },
  );

  it('bounds unanswered hello at five seconds without sending presence, even after a late reply', async () => {
    vi.useFakeTimers();
    const { transport, socket } = createHarness();
    const presence = transport.request('presence.update', { focus: [], typing: null });
    const rejected = expect(presence).rejects.toMatchObject({ code: 'TIMEOUT' });
    const unrelated = transport.request('workspace.list', {});
    socket().open();
    const hello = socket().lastFrame();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(socket().sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(transport.getConnectionStatus()).toBe('connected');
    expect(socket().lastFrame()).toMatchObject({ method: 'workspace.list' });
    socket().receive({ jsonrpc: '2.0', id: socket().lastFrame().id, result: { workspaces: [] } });
    await unrelated;
    socket().receive({ jsonrpc: '2.0', id: hello.id, result: helloResult() });
    await expect(
      transport.request('presence.update', { focus: [], typing: null }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(socket().sent.map((raw) => JSON.parse(raw).method)).toEqual([
      'client.hello',
      'workspace.list',
    ]);
    transport.dispose();
  });

  it('does not release a report that timed out waiting for hello', async () => {
    vi.useFakeTimers();
    const { transport, socket } = createHarness();
    const presence = transport.request(
      'presence.update',
      { focus: [], typing: null },
      { timeoutMs: 100 },
    );
    const rejected = expect(presence).rejects.toMatchObject({ code: 'TIMEOUT' });
    socket().open();
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    socket().receive({ jsonrpc: '2.0', id: socket().lastFrame().id, result: helloResult() });
    await flush();
    expect(socket().sent.map((raw) => JSON.parse(raw).method)).toEqual(['client.hello']);
    transport.dispose();
  });

  it('preserves handshake identity when the renderer probes capabilities', async () => {
    const { transport, socket } = createHarness();
    const probe = transport.request('client.hello', { name: 'Browser' });
    socket().open();
    socket().receive({
      jsonrpc: '2.0',
      id: socket().lastFrame().id,
      result: helloResult('stable-client'),
    });
    await flush();
    expect(socket().lastFrame()).toMatchObject({
      method: 'client.hello',
      params: { name: 'Browser', clientId: 'stable-client' },
    });
    socket().receive({
      jsonrpc: '2.0',
      id: socket().lastFrame().id,
      result: helloResult('stable-client'),
    });
    await expect(probe).resolves.toEqual(helloResult('stable-client'));
    transport.dispose();
  });

  it('rejects local-machine requests instead of sending them to the browser daemon', async () => {
    const { transport, sockets } = createHarness();
    await expect(
      transport.request(
        'settings.update',
        {
          changes: [{ path: 'server.wsApi.enabled', value: false }],
        },
        { localMachine: true },
      ),
    ).rejects.toThrow('Local machine requests require the desktop bridge');
    expect(sockets).toHaveLength(0);
    transport.dispose();
  });
  it('connects lazily and sends a JSON-RPC 2.0 request frame', async () => {
    const { transport, sockets, socket } = createHarness();
    expect(sockets).toHaveLength(0);

    const promise = transport.request('workspace.list', { limit: 5 });
    expect(sockets).toHaveLength(1);
    expect(socket().url).toBe('ws://127.0.0.1:9100/rpc?token=test');

    await connect(socket());
    expect(socket().lastFrame()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'workspace.list',
      params: { limit: 5 },
    });

    socket().receive({ jsonrpc: '2.0', id: 1, result: { workspaces: [] } });
    await expect(promise).resolves.toEqual({ workspaces: [] });
    transport.dispose();
  });

  it('correlates concurrent requests by id, including out-of-order responses', async () => {
    const { transport, socket } = createHarness();
    const first = transport.request('note.get', { noteId: 'a' });
    await connect(socket());
    const second = transport.request('note.get', { noteId: 'b' });
    await flush();

    const frames = socket().sent.map((raw) => JSON.parse(raw) as { id: number });
    expect(frames.map((f) => f.id)).toEqual([1, 3]);

    socket().receive({ jsonrpc: '2.0', id: 3, result: 'second' });
    socket().receive({ jsonrpc: '2.0', id: 1, result: 'first' });
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    transport.dispose();
  });

  it('rejects with a BackendError mapping the numeric JSON-RPC code', async () => {
    const { transport, socket } = createHarness();
    const promise = transport.request('nope.method');
    await connect(socket());

    socket().receive({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    });
    const error = (await promise.catch((e: unknown) => e)) as BackendError;
    expect(error).toBeInstanceOf(BackendError);
    expect(error.code).toBe('METHOD_NOT_FOUND');
    expect(error.message).toBe('Method not found');
    expect(error.rpcCode).toBe(-32601);
    expect(error.data).toEqual({ code: 'METHOD_NOT_FOUND' });
    transport.dispose();
  });

  it("prefers the daemon's data.code and preserves extra data fields", async () => {
    const { transport, socket } = createHarness();
    const promise = transport.request('note.update');
    await connect(socket());

    socket().receive({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32005,
        message: 'Revision conflict',
        data: { code: 'CONFLICT', currentRevision: 7 },
      },
    });
    const error = (await promise.catch((e: unknown) => e)) as BackendError;
    expect(error.code).toBe('CONFLICT');
    expect(error.rpcCode).toBe(-32005);
    expect(error.data).toEqual({ code: 'CONFLICT', currentRevision: 7 });
    transport.dispose();
  });

  it('maps reserved server-range codes to SERVER_ERROR', async () => {
    const { transport, socket } = createHarness();
    const promise = transport.request('thing.do');
    await connect(socket());

    socket().receive({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'boom' } });
    const error = (await promise.catch((e: unknown) => e)) as BackendError;
    expect(error.code).toBe('SERVER_ERROR');
    transport.dispose();
  });

  it('times out requests with the default timeout', async () => {
    vi.useFakeTimers();
    const { transport, socket } = createHarness();
    const promise = transport.request('slow.method');
    await connect(socket());
    expect(socket().sent).toHaveLength(1);

    const rejection = expect(promise).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'JSON-RPC request timed out: slow.method',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    transport.dispose();
  });

  it('honours a per-call timeoutMs override', async () => {
    vi.useFakeTimers();
    const { transport, socket } = createHarness();
    const promise = transport.request('git.pull', undefined, { timeoutMs: 60_000 });
    await connect(socket());

    await vi.advanceTimersByTimeAsync(45_000);
    socket().receive({ jsonrpc: '2.0', id: 1, result: 'ok' });
    await expect(promise).resolves.toBe('ok');
    transport.dispose();
  });

  it('fans notifications out to registered handlers until disposed', async () => {
    const { transport, socket } = createHarness();
    const seen: unknown[] = [];
    const off = transport.onNotification((n) => seen.push(n));
    const promise = transport.request('events.subscribe', {});
    await connect(socket());
    socket().receive({ jsonrpc: '2.0', id: 1, result: { subscriptionId: 'sub-1' } });
    await promise;

    socket().receive({
      jsonrpc: '2.0',
      method: 'subscription.push',
      params: { subscriptionId: 'sub-1', kind: 'snapshot', seq: 0, snapshot: [] },
    });
    expect(seen).toEqual([
      {
        method: 'subscription.push',
        params: { subscriptionId: 'sub-1', kind: 'snapshot', seq: 0, snapshot: [] },
      },
    ]);

    off();
    socket().receive({ jsonrpc: '2.0', method: 'subscription.push', params: {} });
    expect(seen).toHaveLength(1);
    transport.dispose();
  });

  it('sends events.subscribe / events.unsubscribe via subscribe()/unsubscribe()', async () => {
    const { transport, socket } = createHarness();
    const promise = transport.subscribe({ events: ['workspace:*'] });
    await connect(socket());
    expect(socket().lastFrame()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'events.subscribe',
      params: { events: ['workspace:*'] },
    });
    socket().receive({ jsonrpc: '2.0', id: 1, result: { subscriptionId: 'sub-9' } });
    await expect(promise).resolves.toEqual({ subscriptionId: 'sub-9' });

    const unsub = transport.unsubscribe('sub-9');
    await flush();
    expect(socket().lastFrame()).toEqual({
      jsonrpc: '2.0',
      id: 3,
      method: 'events.unsubscribe',
      params: { subscriptionId: 'sub-9' },
    });
    socket().receive({ jsonrpc: '2.0', id: 3, error: { code: -32602, message: 'unknown sub' } });
    await expect(unsub).resolves.toBeUndefined();
    transport.dispose();
  });

  it('rejects in-flight requests when the connection drops, then reconnects with backoff', async () => {
    vi.useFakeTimers();
    const { transport, sockets, socket } = createHarness({
      reconnectDelayMs: 1_000,
      maxReconnectDelayMs: 4_000,
    });
    const reconnected = vi.fn();
    transport.onReconnected(reconnected);

    const promise = transport.request('workspace.list');
    await connect(socket());

    socket().drop();
    await expect(promise).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
    expect(socket().closed).toBe(true);
    expect(reconnected).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    socket().drop();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);

    await connect(socket());
    expect(reconnected).toHaveBeenCalledOnce();

    const after = transport.request('workspace.list');
    await flush();
    expect(socket().lastFrame()).toMatchObject({ method: 'workspace.list' });
    socket().receive({ jsonrpc: '2.0', id: socket().lastFrame().id, result: [] });
    await expect(after).resolves.toEqual([]);
    transport.dispose();
  });

  it.each(['close', 'timeout'])(
    'replays startup work after an initial connect %s',
    async (failure) => {
      vi.useFakeTimers();
      const { transport, socket } = createHarness({ connectTimeoutMs: 100, reconnectDelayMs: 100 });
      const recovered = vi.fn(() => transport.request('workspace.list', {}));
      transport.onReconnected(recovered);
      const failed = transport
        .request('workspace.list', {})
        .catch((error: BackendError) => error.code);
      if (failure === 'close') socket().drop();
      else await vi.advanceTimersByTimeAsync(100);
      expect(await failed).toBe('TRANSPORT_ERROR');
      expect(recovered).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      await connect(socket());
      expect(recovered).toHaveBeenCalledOnce();
      expect(socket().lastFrame()).toEqual({
        jsonrpc: '2.0',
        id: expect.any(Number),
        method: 'workspace.list',
        params: {},
      });
      socket().receive({ jsonrpc: '2.0', id: socket().lastFrame().id, result: { workspaces: [] } });
      await expect(recovered.mock.results[0].value).resolves.toEqual({ workspaces: [] });
      transport.dispose();
    },
  );

  it('queues requests behind an armed backoff timer instead of connecting immediately', async () => {
    vi.useFakeTimers();
    const { transport, sockets, socket } = createHarness({
      reconnectDelayMs: 1_000,
      maxReconnectDelayMs: 30_000,
    });
    transport.request('a').catch(() => {});
    await connect(socket());
    socket().drop();
    expect(sockets).toHaveLength(1);

    // New requests while the reconnect timer is armed must not bypass the
    // backoff by opening a socket immediately.
    const queued = transport.request('b');
    await flush();
    expect(sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    await connect(socket());
    expect(socket().lastFrame()).toMatchObject({ method: 'b' });
    socket().receive({ jsonrpc: '2.0', id: socket().lastFrame().id, result: 'ok' });
    await expect(queued).resolves.toBe('ok');
    transport.dispose();
  });

  it('times out a request stuck waiting for the initial connect', async () => {
    vi.useFakeTimers();
    // Watchdog pinned above the request timeout so the request TIMEOUT path
    // is what fires here (the watchdog has its own test below).
    const { transport, socket } = createHarness({ connectTimeoutMs: 60_000 });
    const promise = transport.request('slow.connect');
    // The socket never opens (stalled handshake, no close event fired).
    expect(socket().sent).toHaveLength(0);

    const rejection = expect(promise).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'JSON-RPC request timed out: slow.connect',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;

    // A late connect must not send the already-timed-out request.
    await connect(socket());
    expect(socket().sent).toHaveLength(0);
    transport.dispose();
  });

  it('tears down a stalled connect attempt via the watchdog and reconnects', async () => {
    vi.useFakeTimers();
    const { transport, sockets, socket } = createHarness({
      connectTimeoutMs: 10_000,
      reconnectDelayMs: 1_000,
    });
    const promise = transport.request('stalled.connect');
    expect(sockets).toHaveLength(1);

    // Neither open nor close fires; the watchdog must fail the attempt so the
    // transport does not stay stuck in `connecting` forever.
    const rejection = expect(promise).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(sockets[0].closed).toBe(true);

    // The reconnect path is armed: a fresh socket is opened after the backoff
    // delay and subsequent requests go through.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    const after = transport.request('workspace.list');
    await connect(socket());
    expect(socket().lastFrame()).toMatchObject({ method: 'workspace.list' });
    socket().receive({ jsonrpc: '2.0', id: socket().lastFrame().id, result: [] });
    await expect(after).resolves.toEqual([]);
    transport.dispose();
  });

  it('does not fire reconnected on the first successful connect', async () => {
    const { transport, socket } = createHarness();
    const reconnected = vi.fn();
    transport.onReconnected(reconnected);
    const promise = transport.request('system.health');
    await connect(socket());
    expect(reconnected).not.toHaveBeenCalled();
    socket().receive({ jsonrpc: '2.0', id: 1, result: 'ok' });
    await promise;
    transport.dispose();
  });

  it('resets the backoff delay after a successful reconnect', async () => {
    vi.useFakeTimers();
    const { transport, sockets, socket } = createHarness({
      reconnectDelayMs: 1_000,
      maxReconnectDelayMs: 30_000,
    });
    transport.request('x').catch(() => {});
    await connect(socket());
    socket().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    socket().drop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(3);
    await connect(socket());

    socket().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(4);
    transport.dispose();
  });

  it('replies -32601 to daemon-initiated reverse requests', async () => {
    const { transport, socket } = createHarness();
    const promise = transport.request('system.health');
    await connect(socket());

    socket().receive({ jsonrpc: '2.0', id: 'rev-1', method: 'permission.request', params: {} });
    expect(socket().lastFrame()).toEqual({
      jsonrpc: '2.0',
      id: 'rev-1',
      error: { code: -32601, message: 'Method not found: permission.request' },
    });

    socket().receive({ jsonrpc: '2.0', id: 1, result: 'ok' });
    await expect(promise).resolves.toBe('ok');
    transport.dispose();
  });

  it('ignores unparseable frames, non-string data, and unknown response ids', async () => {
    const { transport, socket } = createHarness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const promise = transport.request('system.health');
    await connect(socket());

    socket().receiveRaw('not json{');
    socket().receiveRaw(new ArrayBuffer(4));
    socket().receive({ jsonrpc: '2.0', id: 99, result: 'stale' });

    socket().receive({ jsonrpc: '2.0', id: 1, result: 'ok' });
    await expect(promise).resolves.toBe('ok');
    warn.mockRestore();
    transport.dispose();
  });

  it('rejects everything and stops reconnecting once disposed', async () => {
    vi.useFakeTimers();
    const { transport, sockets, socket } = createHarness({ reconnectDelayMs: 1_000 });
    const promise = transport.request('workspace.list');
    await connect(socket());

    transport.dispose();
    await expect(promise).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(transport.isAvailable()).toBe(false);
    expect(socket().closed).toBe(true);

    await expect(transport.request('x')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('createBrowserWebSocketTransport returns a working transport', () => {
    const transport = createBrowserWebSocketTransport({
      url: 'ws://localhost:9100/rpc',
      webSocketFactory: (url) => new FakeWebSocket(url),
    });
    expect(transport.isAvailable()).toBe(true);
    transport.dispose();
    expect(transport.isAvailable()).toBe(false);
  });
});
