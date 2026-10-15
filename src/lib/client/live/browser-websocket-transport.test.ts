import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import { RecoveryResource } from '$shared/event-recovery/resource';
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
import * as backendTransport from './backend-transport';
import { LiveFilesClient } from './live-files-client';
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
async function connect(socket: FakeWebSocket, recovery = false): Promise<void> {
  socket.open();
  await flush();
  const hello = socket.lastFrame();
  expect(hello).toMatchObject({ method: 'client.hello' });
  socket.sent.pop();
  const result = helloResult();
  socket.receive({
    jsonrpc: '2.0',
    id: hello.id,
    result: recovery
      ? {
          ...result,
          server: {
            ...result.server,
            capabilities: { ...result.server.capabilities, eventStreamRecovery: 1 },
          },
        }
      : result,
  });
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

  it('sends workspace origin on browser subscription cleanup', async () => {
    const { transport, socket } = createHarness();
    const pending = transport.unsubscribe('sub-a', 'workspace-a');
    await connect(socket());
    const frame = socket().lastFrame();
    expect(frame).toMatchObject({
      method: 'events.unsubscribe',
      params: { subscriptionId: 'sub-a', workspaceId: 'workspace-a' },
    });
    socket().receive({ jsonrpc: '2.0', id: frame.id, result: { unsubscribed: true } });
    await pending;
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

// protocol-version-ok-file: connection-generation compatibility regression fixtures.
describe('root file reads on the sending connection', () => {
  it.each(
    ['file.read', 'file.readChunk'].flatMap((method) =>
      ['11.1', '12.0', '13.0', '14.0', '15.0'].flatMap((protocolVersion) =>
        ['11.0', '12.0', '13.0', '14.0', '15.0', '16.0', 'invalid', undefined].map(
          (nextVersion) => ({
            method,
            protocolVersion,
            nextVersion,
          }),
        ),
      ),
    ),
  )(
    'rechecks $method after reconnecting from $protocolVersion to $nextVersion',
    async ({ method, protocolVersion, nextVersion }) => {
      vi.useFakeTimers();
      const { transport, sockets } = createHarness({ reconnectDelayMs: 10 });
      const params = {
        workspaceId: 'ws',
        path: 'same.txt',
        gitRootId: 'root-a',
        ...(method === 'file.readChunk' ? { offset: 0, length: 1024 } : {}),
      };
      const response = method === 'file.read' ? 'R' : { content: 'Ug==', size: 1, bytesRead: 1 };
      const first = transport.request(method, params);
      sockets[0].open();
      await flush();
      sockets[0].receive({
        jsonrpc: '2.0',
        id: sockets[0].lastFrame().id,
        result: { clientId: 'client', protocolVersion },
      });
      await flush();
      expect(sockets[0].lastFrame()).toMatchObject({ method, params });
      sockets[0].receive({ jsonrpc: '2.0', id: sockets[0].lastFrame().id, result: response });
      expect(await first).toEqual(response);
      sockets[0].drop();
      await vi.advanceTimersByTimeAsync(10);
      const second = transport.request(method, params).catch((error) => error);
      sockets[1].open();
      await flush();
      expect(sockets[1].sent.map((frame) => JSON.parse(frame).method)).toEqual(['client.hello']);
      sockets[1].receive({
        jsonrpc: '2.0',
        id: sockets[1].lastFrame().id,
        result: { clientId: 'client', protocolVersion: nextVersion },
      });
      await flush();
      if (sockets[1].lastFrame().method === method) {
        sockets[1].receive({
          jsonrpc: '2.0',
          id: sockets[1].lastFrame().id,
          result: response,
        });
      }
      const result = await second;
      transport.dispose();
      if (
        nextVersion === '12.0' ||
        nextVersion === '13.0' ||
        nextVersion === '14.0' ||
        nextVersion === '15.0'
      ) {
        expect(result).toEqual(response);
        expect(sockets[1].lastFrame()).toMatchObject({ method, params });
      } else {
        expect(result).toBeInstanceOf(Error);
        expect(sockets[1].sent.map((frame) => JSON.parse(frame).method)).toEqual(['client.hello']);
      }
    },
  );
});

describe('observational node capabilities', () => {
  it('uses the initial handshake and invalidates on re-hello, reconnect and disposal', async () => {
    vi.useFakeTimers();
    const h = createHarness({ reconnectDelayMs: 1 });
    const observing = h.transport.observeNodeCapabilities();
    const socket = h.socket();
    socket.open();
    await flush();
    socket.receive({
      id: socket.lastFrame().id,
      result: {
        clientId: 'A',
        server: {
          capabilities: {
            agentNodes: 1,
            agentPlatformRouting: 1,
            workspaceMembershipEvents: 1,
            hostMembership: 1,
            personalPairing: 1,
            liveState: true,
            futureCapability: 2,
          },
        },
      },
    });
    await expect(observing).resolves.toEqual({
      clientId: 'A',
      server: {
        capabilities: {
          hostMembership: 1,
          personalPairing: 1,
          liveState: true,
          futureCapability: 2,
          agentNodes: 1,
          localNodeIsolation: 0,
          agentPlatformRouting: 1,
          workspaceMembershipEvents: 1,
          eventStreamRecovery: 0,
        },
      },
    });
    await h.transport.observeNodeCapabilities();
    expect(socket.sent).toHaveLength(1);
    const rehello = h.transport.request('client.hello', {});
    await expect(h.transport.observeNodeCapabilities()).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    socket.receive({ id: socket.lastFrame().id, error: { code: -32601, message: 'rejected' } });
    await expect(rehello).rejects.toThrow('rejected');
    await expect(h.transport.observeNodeCapabilities()).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    socket.drop();
    const reconnecting = h.transport.observeNodeCapabilities();
    await vi.advanceTimersByTimeAsync(1);
    const replacement = h.socket();
    expect(replacement).not.toBe(socket);
    replacement.open();
    await flush();
    replacement.receive({
      id: replacement.lastFrame().id,
      result: {
        clientId: 'B',
        server: { capabilities: { agentNodes: '1', workspaceMembershipEvents: true } },
      },
    });
    await expect(reconnecting).resolves.toEqual({
      clientId: 'B',
      server: {
        capabilities: {
          agentNodes: 0,
          localNodeIsolation: 0,
          agentPlatformRouting: 0,
          workspaceMembershipEvents: 0,
          eventStreamRecovery: 0,
        },
      },
    });
    h.transport.dispose();
    await expect(h.transport.observeNodeCapabilities()).rejects.toThrow();
  });
  it('does not let an older concurrent hello restore obsolete capabilities', async () => {
    const h = createHarness();
    const observing = h.transport.observeNodeCapabilities();
    h.socket().open();
    await flush();
    h.socket().receive({ id: h.socket().lastFrame().id, result: helloResult() });
    await observing;
    const older = h.transport.request('client.hello', {});
    const oldId = h.socket().lastFrame().id;
    const newer = h.transport.request('client.hello', {});
    h.socket().receive({
      id: h.socket().lastFrame().id,
      result: { clientId: 'new', server: { capabilities: {} } },
    });
    await newer;
    h.socket().receive({
      id: oldId,
      result: {
        clientId: 'old',
        server: { capabilities: { agentNodes: 1, workspaceMembershipEvents: 1 } },
      },
    });
    await older;
    await expect(h.transport.observeNodeCapabilities()).resolves.toEqual({
      clientId: 'new',
      server: {
        capabilities: {
          agentNodes: 0,
          localNodeIsolation: 0,
          agentPlatformRouting: 0,
          workspaceMembershipEvents: 0,
          eventStreamRecovery: 0,
        },
      },
    });
    h.transport.dispose();
  });
});

describe('binary file reads through browser transport normalization', () => {
  it.each([
    ['stream did not contain valid UTF-8', 'binary'],
    ['No such file or directory (os error 2)', 'missing'],
    ['Permission denied (os error 13)', 'error'],
    [undefined, 'error'],
    [{ detail: { message: 'stream did not contain valid UTF-8' } }, 'error'],
  ])('classifies the actual daemon error data %j as %s', async (data, expected) => {
    const { transport, socket } = createHarness();
    const request = vi
      .spyOn(backendTransport, 'backendRequest')
      .mockImplementation((method, params) => transport.request(method, params));
    try {
      const pending = new LiveFilesClient()
        .read('ws-1', '.intent/artifacts/report.xlsx')
        .catch((error) => error);
      await connect(socket());
      expect(socket().lastFrame()).toMatchObject({ method: 'file.read' });
      socket().receive({
        jsonrpc: '2.0',
        id: socket().lastFrame().id,
        error: { code: -32603, message: 'Internal error', data },
      });
      const result = await pending;
      if (expected === 'binary')
        expect(result).toMatchObject({ isBinary: true, originalContent: null });
      else if (expected === 'missing') expect(result).toBeNull();
      else expect(result).toBeInstanceOf(BackendError);
    } finally {
      transport.dispose();
      request.mockRestore();
    }
  });
});

describe('captured generic recovery transport', () => {
  it('propagates losses and orders fences through async owner processing', async () => {
    const h = createHarness();
    const boot = h.transport.request('ping');
    await connect(h.socket(), true);
    h.socket().receive({ jsonrpc: '2.0', id: h.socket().lastFrame().id, result: {} });
    await boot;
    const session = await h.transport.captureEventRecovery();
    let release!: () => void;
    const order: string[] = [];
    session.onNotification(
      (n) =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push(n.method);
            resolve();
          };
        }),
    );
    const fence = session.fence(['a'], () => {
      order.push('fence');
    });
    const wire = h.socket().lastFrame();
    expect(wire).toMatchObject({ method: 'events.fence', params: { subscriptionIds: ['a'] } });
    h.socket().receive({
      jsonrpc: '2.0',
      method: 'events.lost',
      params: { subscriptionId: 'a', generation: '1', scope: { workspaceId: null } },
    });
    h.socket().receive({ jsonrpc: '2.0', id: wire.id, result: { subscriptionIds: ['a'] } });
    expect(order).toEqual([]);
    release();
    await fence;
    expect(order).toEqual(['events.lost', 'fence']);
    h.socket().drop();
    expect(session.isCurrent()).toBe(false);
    await expect(session.request('file.read', {})).rejects.toThrow();
    session.dispose();
    h.transport.dispose();
  });
});

it('cleans up a captured recovery lease whose ack arrives after disposal', async () => {
  const h = createHarness();
  const boot = h.transport.request('ping');
  await connect(h.socket(), true);
  h.socket().receive({ id: h.socket().lastFrame().id, result: {} });
  await boot;
  const session = await h.transport.captureEventRecovery();
  const subscribe = session.request('events.subscribe', {
    eventTypes: ['file:*'],
    workspaceId: 'ws-a',
    lossRecovery: 1,
  });
  const failed = expect(subscribe).rejects.toThrow();
  const request = h.socket().lastFrame();
  session.dispose();
  await failed;
  h.socket().receive({ id: request.id, result: { subscriptionId: 'late', lossRecovery: 1 } });
  await flush();
  expect(h.socket().lastFrame()).toMatchObject({
    method: 'events.unsubscribe',
    params: { subscriptionId: 'late' },
  });
  h.transport.dispose();
});

it.each([
  [-32602, 'not-found'],
  [-32003, 'forbidden'],
  [-32001, 'unauthorized'],
] as const)(
  'retires a recovery resource on canonical browser error %s/%s',
  async (rpcCode, code) => {
    const h = createHarness();
    const boot = h.transport.request('ping');
    await connect(h.socket(), true);
    h.socket().receive({ id: h.socket().lastFrame().id, result: {} });
    await boot;
    const session = await h.transport.captureEventRecovery();
    const retired = vi.fn(),
      apply = vi.fn();
    const resource = new RecoveryResource({
      read: () => session.request('file.read', { workspaceId: 'ws-a' }),
      fence: (ids, observe) => session.fence(ids, observe),
      apply,
      invalidate: vi.fn(),
      retire: retired,
    });
    resource.setLeases([{ id: 'a', lifetime: {} }]);
    resource.invalidate();
    expect(h.socket().lastFrame().method).toBe('events.fence');
    h.socket().receive({ id: h.socket().lastFrame().id, result: { subscriptionIds: ['a'] } });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(h.socket().lastFrame().method).toBe('file.read');
    h.socket().receive({
      id: h.socket().lastFrame().id,
      error: { code: rpcCode, message: 'Unavailable', data: { code } },
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(retired).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ rpcCode, code, data: { code } }),
    );
    expect(resource.status).toMatchObject({ stale: false, suspended: true });
    expect(apply).not.toHaveBeenCalled();
    resource.dispose();
    session.dispose();
    h.transport.dispose();
  },
);

describe('physical recovery timeout ownership', () => {
  for (const phase of ['begin', 'read', 'end'] as const)
    it(`keeps the real browser ${phase} request outstanding until reply and blocks replacement capture`, async () => {
      vi.useFakeTimers();
      const h = createHarness();
      const boot = h.transport.request('ping');
      await connect(h.socket(), true);
      h.socket().receive({ id: h.socket().lastFrame().id, result: {} });
      await boot;
      const socket = h.socket();
      const capture = () => h.transport.captureEventRecovery();
      const shutdown = () => h.transport.dispose();
      const frames: Array<{ id: number; method: string; params: unknown }> = [];
      const original = socket.send.bind(socket);
      const install = (respond: (frame: (typeof frames)[number]) => void) => {
        socket.send = (line) => {
          original(line);
          const frame = JSON.parse(line);
          frames.push(frame);
          respond(frame);
        };
      };
      const reply = (id: number, result: unknown) => socket.receive({ id, result });

      let fences = 0;
      let reads = 0;
      let held: (typeof frames)[number] | undefined;
      install((frame) => {
        if (frame.method === 'events.subscribe')
          queueMicrotask(() => reply(frame.id, { subscriptionId: 'a', lossRecovery: 1 }));
        else if (frame.method === 'events.fence') {
          if ((phase === 'begin' && ++fences === 1) || (phase === 'end' && ++fences === 2))
            held = frame;
          else queueMicrotask(() => reply(frame.id, { subscriptionIds: ['a'] }));
        } else if (frame.method === 'data.read') {
          if (phase === 'read' && ++reads === 1) held = frame;
          else queueMicrotask(() => reply(frame.id, 'fresh'));
        } else queueMicrotask(() => reply(frame.id, {}));
      });
      const session = await capture();
      await session.request('events.subscribe', { eventTypes: ['file:*'], lossRecovery: 1 });
      const apply = vi.fn();
      const resource = new RecoveryResource({
        read: () => session.request('data.read'),
        fence: (ids, observe) => session.fence(ids, observe),
        apply,
        invalidate: () => {},
        retire: () => {},
      });
      resource.setLeases([{ id: 'a', lifetime: {} }]);
      resource.invalidate();
      for (let i = 0; i < 30; i++) await Promise.resolve();
      const requests = frames.length;
      expect(held).toBeDefined();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(frames).toHaveLength(requests);
      expect(resource.status).toMatchObject({ running: true, suspended: true, stale: true });
      await expect(capture()).rejects.toThrow();
      expect(vi.getTimerCount()).toBe(0);
      reply(held!.id, phase === 'read' ? 'expired' : { subscriptionIds: ['a'] });
      await vi.advanceTimersByTimeAsync(1000);
      expect(frames).toHaveLength(requests + 3);
      expect(apply).toHaveBeenCalledExactlyOnceWith('fresh');
      resource.dispose();
      session.dispose();
      for (let i = 0; i < 30; i++) await Promise.resolve();
      const next = await capture();
      next.dispose();
      shutdown();
    });

  it('keeps a released capture quarantined until its physical read completes', async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const boot = h.transport.request('ping');
    await connect(h.socket(), true);
    h.socket().receive({ id: h.socket().lastFrame().id, result: {} });
    await boot;
    const socket = h.socket();
    const capture = () => h.transport.captureEventRecovery();
    const shutdown = () => h.transport.dispose();
    const frames: Array<{ id: number; method: string; params: unknown }> = [];
    const original = socket.send.bind(socket);
    const install = (respond: (frame: (typeof frames)[number]) => void) => {
      socket.send = (line) => {
        original(line);
        const frame = JSON.parse(line);
        frames.push(frame);
        respond(frame);
      };
    };
    const reply = (id: number, result: unknown) => socket.receive({ id, result });

    let held: (typeof frames)[number] | undefined;
    install((frame) => {
      if (!held) held = frame;
      else queueMicrotask(() => reply(frame.id, 'fresh'));
    });
    const session = await capture();
    const pending = session.request('data.read').catch(() => {});
    session.dispose();
    await pending;
    await expect(capture()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(frames).toHaveLength(1);
    await expect(capture()).rejects.toThrow();
    reply(held!.id, 'expired');
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const next = await capture();
    expect(await next.request('data.read')).toBe('fresh');
    expect(frames).toHaveLength(2);
    expect(frames[1].id).not.toBe(held!.id);
    next.dispose();
    shutdown();
  });
});

it('bounds outstanding recovery wire requests across captures without deadline churn', async () => {
  vi.useFakeTimers();
  const h = createHarness();
  const boot = h.transport.request('ping');
  await connect(h.socket(), true);
  h.socket().receive({ id: h.socket().lastFrame().id, result: {} });
  await boot;
  const capture = () => h.transport.captureEventRecovery();
  const frames: Array<{ id: number; method: string }> = [];
  const socket = h.socket();
  const send = socket.send.bind(socket);
  socket.send = (line) => {
    send(line);
    frames.push(JSON.parse(line));
  };
  const reply = (id: number) => socket.receive({ id, result: 'expired' });
  const shutdown = () => h.transport.dispose();
  const a = await capture();
  const b = await capture();
  const before = frames.length;
  const pending = Array.from({ length: 64 }, () => a.request('data.read').catch((error) => error));
  await expect(b.request('data.read')).rejects.toThrow();
  expect(frames.length - before).toBe(64);
  await vi.advanceTimersByTimeAsync(60_000);
  await Promise.all(pending);
  expect(vi.getTimerCount()).toBe(0);
  await expect(b.request('data.read')).rejects.toThrow();
  expect(frames.length - before).toBe(64);
  for (const frame of frames.slice(before)) reply(frame.id);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  const next = b.request('data.read');
  expect(frames.length - before).toBe(65);
  reply(frames.at(-1)!.id);
  expect(await next).toBe('expired');
  a.dispose();
  b.dispose();
  shutdown();
});

it('preserves a canonical physical denial after the recovery read deadline', async () => {
  vi.useFakeTimers();
  const h = createHarness();
  const boot = h.transport.request('ping');
  await connect(h.socket(), true);
  h.socket().receive({ id: h.socket().lastFrame().id, result: {} });
  await boot;
  const session = await h.transport.captureEventRecovery();
  const lastFrame = () => h.socket().lastFrame();
  const reply = (frame: unknown) => h.socket().receive(frame);
  const shutdown = () => h.transport.dispose();
  const pending = session.request('data.read').catch((error) => error);
  const frame = lastFrame();
  await vi.advanceTimersByTimeAsync(60_000);
  const timeout = (await pending) as RecoveryRequestTimeoutError;
  expect(timeout).toBeInstanceOf(RecoveryRequestTimeoutError);
  reply({
    id: frame.id,
    error: { code: -32003, message: 'Unavailable', data: { code: 'forbidden' } },
  });
  expect(await timeout.completion).toEqual({
    retired: false,
    errors: [
      expect.objectContaining({ rpcCode: -32003, code: 'forbidden', data: { code: 'forbidden' } }),
    ],
  });
  await timeout.drained;
  session.dispose();
  shutdown();
});

it('blocks a same-socket new browser identity until the previous recovery request drains', async () => {
  vi.useFakeTimers();
  const h = createHarness();
  const boot = h.transport.request('ping');
  await connect(h.socket(), true);
  h.socket().receive({ id: h.socket().lastFrame().id, result: {} });
  await boot;
  const session = await h.transport.captureEventRecovery();
  const pending = session.request('data.read').catch((error) => error);
  const oldRequest = h.socket().lastFrame();
  await vi.advanceTimersByTimeAsync(60_000);
  const hello = h.transport.request('client.hello', {});
  h.socket().receive({
    id: h.socket().lastFrame().id,
    result: { clientId: 'new', server: { capabilities: { eventStreamRecovery: 1 } } },
  });
  await hello;
  await expect(h.transport.captureEventRecovery()).rejects.toThrow();
  h.socket().receive({ id: oldRequest.id, result: 'expired' });
  await pending;
  for (let i = 0; i < 30; i++) await Promise.resolve();
  const next = await h.transport.captureEventRecovery();
  const fresh = next.request('data.read');
  h.socket().receive({ id: h.socket().lastFrame().id, result: 'fresh' });
  expect(await fresh).toBe('fresh');
  session.dispose();
  next.dispose();
  h.transport.dispose();
});

it('releases physical browser recovery ownership on close and captures the new socket', async () => {
  vi.useFakeTimers();
  const h = createHarness();
  const boot = h.transport.request('ping');
  await connect(h.socket(), true);
  h.socket().receive({ id: h.socket().lastFrame().id, result: {} });
  await boot;
  const session = await h.transport.captureEventRecovery();
  const pending = session.request('data.read').catch((error) => error);
  await vi.advanceTimersByTimeAsync(60_000);
  const timeout = (await pending) as RecoveryRequestTimeoutError;
  const old = h.socket();
  old.drop();
  await timeout.drained;
  expect(session.isCurrent()).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  const nextSocket = h.socket();
  expect(nextSocket).not.toBe(old);
  await connect(nextSocket, true);
  const next = await h.transport.captureEventRecovery();
  const fresh = next.request('data.read');
  nextSocket.receive({ id: nextSocket.lastFrame().id, result: 'fresh' });
  expect(await fresh).toBe('fresh');
  session.dispose();
  next.dispose();
  h.transport.dispose();
});

describe('bounded lease cleanup browser', () => {
  it('queues cleanup within the physical cap and drains every admitted lease once', async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const initial = h.transport.captureEventRecovery();
    await connect(h.socket(), true);
    const first = await initial;
    first.dispose();
    const getSession = () => h.transport.captureEventRecovery();
    const frames = (): Array<{ id: number; method: string; params: unknown }> =>
      h.socket().sent.map((line) => JSON.parse(line));
    const reply = (id: number, result: unknown) => h.socket().receive({ id, result });
    const stop = () => h.transport.dispose();
    const session = await getSession();
    for (let i = 0; i < 70; i++) {
      const pending = session.request('events.subscribe', {
        eventTypes: ['file:*'],
        lossRecovery: 1,
      });
      reply(frames().at(-1)!.id, { subscriptionId: `lease-${i}`, lossRecovery: 1 });
      await pending;
    }
    session.dispose();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const sent = () => frames().filter((frame) => frame.method === 'events.unsubscribe');
    expect(sent()).toHaveLength(64);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toHaveLength(64);
    expect(vi.getTimerCount()).toBe(0);
    await expect(getSession()).rejects.toThrow();
    const firstBatch = [...sent()];
    for (const frame of firstBatch) reply(frame.id, {});
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(sent()).toHaveLength(70);
    expect(
      new Set(sent().map((frame) => (frame.params as { subscriptionId: string }).subscriptionId))
        .size,
    ).toBe(70);
    for (const frame of sent().slice(64)) reply(frame.id, {});
    for (let i = 0; i < 40; i++) await Promise.resolve();
    const next = await getSession();
    next.dispose();
    stop();
  });
  for (const method of ['events.subscribe', 'note.subscribe'])
    it(`cleans abandoned ${method} once across late ack and disposal`, async () => {
      vi.useFakeTimers();
      const h = createHarness();
      const initial = h.transport.captureEventRecovery();
      await connect(h.socket(), true);
      const first = await initial;
      first.dispose();
      const getSession = () => h.transport.captureEventRecovery();
      const frames = (): Array<{ id: number; method: string; params: unknown }> =>
        h.socket().sent.map((line) => JSON.parse(line));
      const reply = (id: number, result: unknown) => h.socket().receive({ id, result });
      const stop = () => h.transport.dispose();
      const session = await getSession();
      const pending = session
        .request(method, { workspaceId: 'w', eventTypes: ['file:*'], lossRecovery: 1 })
        .catch((error) => error);
      const frame = frames().at(-1)!;
      await vi.advanceTimersByTimeAsync(35_000);
      const timeout = await pending;
      expect(timeout).toBeInstanceOf(RecoveryRequestTimeoutError);
      reply(frame.id, { subscriptionId: 'orphan', lossRecovery: 1 });
      await timeout.completion;
      for (let i = 0; i < 30; i++) await Promise.resolve();
      const unsubscribe = method === 'events.subscribe' ? 'events.unsubscribe' : 'note.unsubscribe';
      const sent = () => frames().filter((frame) => frame.method === unsubscribe);
      expect(sent()).toHaveLength(1);
      expect(sent()[0].params).toMatchObject({ subscriptionId: 'orphan' });
      session.dispose();
      for (let i = 0; i < 30; i++) await Promise.resolve();
      expect(sent()).toHaveLength(1);
      await expect(getSession()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sent()).toHaveLength(1);
      reply(sent()[0].id, {});
      for (let i = 0; i < 30; i++) await Promise.resolve();
      const next = await getSession();
      next.dispose();
      stop();
    });
});

it('announces recovery readiness only after confirmed hello and old wire drain', async () => {
  vi.useFakeTimers();
  const h = createHarness();
  const first = h.transport.captureEventRecovery();
  await connect(h.socket(), true);
  const old = await first;
  const ready = vi.fn();
  const off = h.transport.onEventRecoveryReady(ready);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  ready.mockClear();
  const pending = old.request('data.read').catch((error) => error);
  const frame = h.socket().lastFrame();
  await vi.advanceTimersByTimeAsync(60_000);
  const hello = h.transport.request('client.hello');
  expect(ready).not.toHaveBeenCalled();
  await expect(h.transport.captureEventRecovery()).rejects.toThrow();
  h.socket().receive({
    id: h.socket().lastFrame().id,
    result: { clientId: 'renewed', server: { capabilities: { eventStreamRecovery: 1 } } },
  });
  await hello;
  expect(ready).not.toHaveBeenCalled();
  h.socket().receive({ id: frame.id, result: 'stale' });
  await pending;
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(ready).toHaveBeenCalledTimes(1);
  const next = await h.transport.captureEventRecovery();
  const read = next.request('data.read');
  h.socket().receive({ id: h.socket().lastFrame().id, result: 'fresh' });
  expect(await read).toBe('fresh');
  expect(ready).toHaveBeenCalledTimes(1);
  off();
  next.dispose();
  old.dispose();
  h.transport.dispose();
  expect(ready).toHaveBeenCalledTimes(1);
});

it('cleans an acknowledged browser lease when its owner barrier times out', async () => {
  vi.useFakeTimers();
  const h = createHarness();
  const first = h.transport.captureEventRecovery();
  await connect(h.socket(), true);
  const session = await first;
  const held = Promise.withResolvers<void>();
  session.onNotification(() => held.promise);
  h.socket().receive({ method: 'events.event', params: { subscriptionId: 'existing' } });
  const pending = session
    .request('events.subscribe', { eventTypes: ['file:*'], lossRecovery: 1 })
    .catch((error) => error);
  h.socket().receive({
    id: h.socket().lastFrame().id,
    result: { subscriptionId: 'blocked-ack', lossRecovery: 1 },
  });
  await vi.advanceTimersByTimeAsync(35_000);
  expect(await pending).toBeInstanceOf(RecoveryRequestTimeoutError);
  const cleanups = () =>
    h
      .socket()
      .sent.map((line) => JSON.parse(line))
      .filter((frame) => frame.method === 'events.unsubscribe');
  expect(cleanups()).toHaveLength(1);
  h.socket().receive({ id: cleanups()[0].id, result: {} });
  held.resolve();
  await (
    await pending
  ).completion;
  session.dispose();
  expect(cleanups()).toHaveLength(1);
  h.transport.dispose();
});

it('ordinary browser timeout retains physical occupancy before recovery and recapture', async () => {
  vi.useFakeTimers();
  const h = createHarness();
  const capture = h.transport.captureEventRecovery();
  await connect(h.socket(), true);
  const session = await capture;
  const original = h.transport
    .request('note.get', { workspaceId: 'w', noteId: 'n' }, { timeoutMs: 50 })
    .catch((e) => e);
  const frame = h.socket().lastFrame();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await original).toMatchObject({ code: 'TIMEOUT' });
  const fresh = session.request('note.get', { workspaceId: 'w', noteId: 'n' });
  void fresh.catch(() => {});
  await expect(h.transport.captureEventRecovery()).rejects.toThrow();
  const count = () =>
    h
      .socket()
      .sent.map((s) => JSON.parse(s))
      .filter((f) => f.method === 'note.get').length;
  expect(count()).toBe(1);
  h.socket().receive({ id: frame.id, result: 'stale' });
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(count()).toBe(2);
  h.socket().receive({ id: h.socket().lastFrame().id, result: 'fresh' });
  expect(await fresh).toBe('fresh');
  session.dispose();
  h.transport.dispose();
});

it('ordinary browser completion preserves late denial and fences queued work across same-socket hello', async () => {
  vi.useFakeTimers();
  const h = createHarness();
  const initial = h.transport.captureEventRecovery();
  await connect(h.socket(), true);
  const old = await initial;
  const pending = h.transport.request('note.get', {}, { timeoutMs: 50 }).catch((e) => e);
  const first = h.socket().lastFrame();
  await vi.advanceTimersByTimeAsync(51);
  const timeout = await pending;
  let drained = false;
  void timeout.completion.then(() => {
    drained = true;
  });
  expect(drained).toBe(false);
  const queued = h.transport.request('note.list', {}, { timeoutMs: 100_000 }).catch((e) => e);
  const hello = h.transport.request('client.hello');
  h.socket().receive({
    id: h.socket().lastFrame().id,
    result: { clientId: 'replacement', server: { capabilities: { eventStreamRecovery: 1 } } },
  });
  await hello;
  await expect(h.transport.captureEventRecovery()).rejects.toThrow();
  const ready = vi.fn();
  const off = h.transport.onEventRecoveryReady(ready);
  h.socket().receive({
    id: first.id,
    error: { code: -32003, message: 'Forbidden', data: { code: 'forbidden' } },
  });
  const completion = await timeout.completion;
  expect(completion.retired).toBe(true);
  expect(completion.errors[0]).toMatchObject({ rpcCode: -32003 });
  expect(await queued).toBeInstanceOf(Error);
  expect(
    h
      .socket()
      .sent.map((s) => JSON.parse(s))
      .filter((f) => f.method === 'note.list'),
  ).toHaveLength(0);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(ready).toHaveBeenCalledTimes(1);
  const next = await h.transport.captureEventRecovery();
  next.dispose();
  old.dispose();
  off();
  h.transport.dispose();
});

it('ordinary browser callers keep deadlines while timed-out correlation stays bounded', async () => {
  vi.useFakeTimers();
  const h = createHarness();
  const initial = h.transport.captureEventRecovery();
  await connect(h.socket(), true);
  const session = await initial;
  const pending = Array.from({ length: 256 }, () =>
    h.transport.request('note.get', {}, { timeoutMs: 50 }).catch((e) => e),
  );
  const frames = h
    .socket()
    .sent.map((s) => JSON.parse(s))
    .filter((f) => f.method === 'note.get');
  expect(frames).toHaveLength(256);
  await expect(h.transport.request('note.get', {}, { timeoutMs: 50 })).rejects.toThrow('limit');
  await vi.advanceTimersByTimeAsync(51);
  expect((await Promise.all(pending)).every((e) => e.code === 'TIMEOUT')).toBe(true);
  for (let i = 0; i < 70; i++) {
    const retry = h.transport.request('note.get', {}, { timeoutMs: 50 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(51);
    expect(await retry).toMatchObject({ code: 'TIMEOUT' });
  }
  expect(
    h
      .socket()
      .sent.map((s) => JSON.parse(s))
      .filter((f) => f.method === 'note.get'),
  ).toHaveLength(256);
  for (const frame of frames) h.socket().receive({ id: frame.id, result: 'expired' });
  const next = h.transport.request('note.get');
  h.socket().receive({ id: h.socket().lastFrame().id, result: 'fresh' });
  expect(await next).toBe('fresh');
  expect(vi.getTimerCount()).toBe(0);
  session.dispose();
  h.transport.dispose();
});

it('socket retirement settles ordinary browser timeout receipts and cancels unsent retries', async () => {
  vi.useFakeTimers();
  const h = createHarness();
  const boot = h.transport.captureEventRecovery();
  await connect(h.socket(), true);
  const session = await boot;
  const ordinary = h.transport.request('note.get', {}, { timeoutMs: 50 }).catch((e) => e);
  await vi.advanceTimersByTimeAsync(51);
  const timeout = await ordinary;
  const queued = h.transport.request('note.list', {}, { timeoutMs: 100_000 }).catch((e) => e);
  h.transport.dispose();
  expect((await timeout.completion).retired).toBe(true);
  expect(await queued).toBeInstanceOf(Error);
  expect(
    h
      .socket()
      .sent.map((s) => JSON.parse(s))
      .filter((f) => f.method === 'note.list'),
  ).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
  session.dispose();
});

it('never reports an unconfirmed browser capability bag as explicit legacy support', async () => {
  const h = createHarness();
  const observing = h.transport.observeNodeCapabilities();
  h.socket().open();
  await flush();
  h.socket().receive({ id: h.socket().lastFrame().id, result: helloResult() });
  await observing;
  const hello = h.transport.request('client.hello', {}).catch((error) => error);
  try {
    await expect(h.transport.observeNodeCapabilities()).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  } finally {
    h.transport.dispose();
    await hello;
  }
});
