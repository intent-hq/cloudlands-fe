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
import { LiveNotesClient } from './live-notes-client';
import {
  BrowserWebSocketTransport,
  type BrowserWebSocketLike,
  createBrowserWebSocketTransport,
  resolveBrowserWsUrl,
  sanitizeWsUrlForDisplay,
} from './browser-websocket-transport';
import { CURRENT_PROTOCOL_VERSION } from '../../../test/current-protocol-version';

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
  reviewMonitoring?: number;
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
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    server: {
      locality: 'local',
      hasDisplay: false,
      osArch: 'linux/x86_64',
      version: '0.1.0',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
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
        nextVersion === '15.0' ||
        // No upper bound: clients never cap the protocol version (intent-hq/intent#7206).
        nextVersion === '16.0'
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
            noteTruncatedRead: 1,
          },
        },
      },
    });
    await expect(observing).resolves.toEqual({
      server: {
        capabilities: {
          agentNodes: 1,
          localNodeIsolation: 0,
          agentPlatformRouting: 1,
          workspaceMembershipEvents: 1,
          noteTruncatedRead: 1,
        },
      },
    });
    await h.transport.observeNodeCapabilities();
    expect(socket.sent).toHaveLength(1);
    const rehello = h.transport.request('client.hello', {});
    await expect(h.transport.observeNodeCapabilities()).resolves.toEqual({
      server: { capabilities: null },
    });
    socket.receive({ id: socket.lastFrame().id, error: { code: -32601, message: 'rejected' } });
    await expect(rehello).rejects.toThrow('rejected');
    await expect(h.transport.observeNodeCapabilities()).resolves.toEqual({
      server: { capabilities: null },
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
        server: {
          capabilities: {
            agentNodes: '1',
            workspaceMembershipEvents: true,
            noteTruncatedRead: '1',
          },
        },
      },
    });
    await expect(reconnecting).resolves.toEqual({
      server: {
        capabilities: {
          agentNodes: 0,
          localNodeIsolation: 0,
          agentPlatformRouting: 0,
          workspaceMembershipEvents: 0,
          noteTruncatedRead: 0,
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
      server: {
        capabilities: {
          agentNodes: 0,
          localNodeIsolation: 0,
          agentPlatformRouting: 0,
          workspaceMembershipEvents: 0,
          noteTruncatedRead: 0,
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

describe('monitor session socket ownership', () => {
  it('keeps legacy hello and exact monitor params, then rejects controls after reconnect', async () => {
    vi.useFakeTimers();
    const h = createHarness({ reconnectDelayMs: 10 });
    const capture = h.transport.capturePrMonitorSession('ws');
    await connect(h.socket());
    const session = await capture;
    expect(session.support).toBe('unsupported');
    const read = session.request('prMonitor.list', { workspaceId: 'ws' });
    expect(h.socket().lastFrame()).toMatchObject({
      method: 'prMonitor.list',
      params: { workspaceId: 'ws' },
    });
    h.socket().receive({ id: h.socket().lastFrame().id, result: { monitors: [] } });
    await expect(read).resolves.toEqual({ monitors: [] });
    const retired = vi.fn();
    session.onRetired(retired);
    h.socket().drop();
    expect(retired).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10);
    await connect(h.socket());
    const count = h.socket().sent.length;
    await expect(
      session.request('prMonitor.cancel', { workspaceId: 'ws', monitorId: 'm' }),
    ).rejects.toThrow();
    expect(h.socket().sent).toHaveLength(count);
    await session.release();
    h.transport.dispose();
  });
  it('retires on re-hello and observes support only after the new acknowledgment', async () => {
    const h = createHarness();
    const capture = h.transport.capturePrMonitorSession('ws');
    await connect(h.socket());
    const session = await capture;
    const retired = vi.fn();
    session.onRetired(retired);
    const ready = vi.fn();
    const off = h.transport.onMonitorReconnected(ready);
    const hello = h.transport.request('client.hello', {});
    expect(retired).toHaveBeenCalledOnce();
    expect(h.socket().lastFrame().params).toEqual({ clientId: 'browser-1' });
    h.socket().receive({
      id: h.socket().lastFrame().id,
      result: { ...helloResult(), server: { capabilities: { reviewMonitoring: 1 } } },
    });
    await hello;
    expect(ready).toHaveBeenCalledOnce();
    const replacement = await h.transport.capturePrMonitorSession('ws');
    expect(replacement.support).toBe('consumer-pending');
    expect(replacement.origin.sessionId).not.toBe(session.origin.sessionId);
    await expect(
      session.request('prMonitor.flush', { workspaceId: 'ws', monitorId: 'm' }),
    ).rejects.toThrow();
    await replacement.release();
    await session.release();
    off();
    h.transport.dispose();
  });
});

describe('monitor replacement hello admission', () => {
  it.each(['pending', 'failed', 'timed-out', 'missing-id', 'empty-id', 'non-string-id', 'null'])(
    'refuses new monitor controls after a %s replacement hello',
    async (phase) => {
      vi.useFakeTimers();
      const h = createHarness();
      const firstCapture = h.transport.capturePrMonitorSession('ws');
      await connect(h.socket());
      const first = await firstCapture;
      const ready = vi.fn();
      h.transport.onMonitorReconnected(ready);
      const hello = h.transport.request('client.hello', {}, { timeoutMs: 10 }).catch((e) => e);
      const id = h.socket().lastFrame().id;
      try {
        if (phase === 'failed')
          h.socket().receive({ id, error: { code: -32603, message: 'failed' } });
        else if (phase === 'timed-out') await vi.advanceTimersByTimeAsync(10);
        else if (phase !== 'pending')
          h.socket().receive({
            id,
            result:
              phase === 'null'
                ? null
                : {
                    clientId: phase === 'empty-id' ? '' : phase === 'non-string-id' ? 1 : undefined,
                  },
          });
        if (phase !== 'pending') await hello;
        // Exercise the exact wire escape reproduced by the independent reviewer.
        const replacement = await h.transport.capturePrMonitorSession('ws').catch(() => null);
        if (replacement) {
          const cancel = replacement.request('prMonitor.cancel', {
            workspaceId: 'ws',
            monitorId: 'm',
          });
          h.socket().receive({ id: h.socket().lastFrame().id, result: { ok: true } });
          await cancel;
          await replacement.release();
        }
        expect(h.socket().sent.map((frame) => JSON.parse(frame).method)).not.toContain(
          'prMonitor.cancel',
        );
        expect(replacement).toBeNull();
        expect(ready).not.toHaveBeenCalled();
        await expect(
          first.request('prMonitor.flush', { workspaceId: 'ws', monitorId: 'm' }),
        ).rejects.toThrow();
      } finally {
        h.transport.dispose();
        await hello;
      }
    },
  );

  it.each(['pending', 'failed', 'timed-out', 'malformed', 'confirmed'])(
    'ignores an older success after the newer hello is %s',
    async (phase) => {
      vi.useFakeTimers();
      const h = createHarness();
      const initial = h.transport.capturePrMonitorSession('ws');
      await connect(h.socket());
      await initial;
      const ready = vi.fn();
      h.transport.onMonitorReconnected(ready);
      const older = h.transport.request('client.hello', {});
      const olderId = h.socket().lastFrame().id;
      const newer = h.transport.request('client.hello', {}, { timeoutMs: 10 }).catch((e) => e);
      const newerId = h.socket().lastFrame().id;
      try {
        if (phase === 'failed')
          h.socket().receive({ id: newerId, error: { code: -32603, message: 'failed' } });
        if (phase === 'timed-out') await vi.advanceTimersByTimeAsync(10);
        if (phase === 'malformed') h.socket().receive({ id: newerId, result: {} });
        if (phase === 'confirmed')
          h.socket().receive({
            id: newerId,
            result: {
              ...helloResult('latest'),
              server: { capabilities: {} },
            },
          });
        if (phase !== 'pending') await newer;
        const current =
          phase === 'confirmed' ? await h.transport.capturePrMonitorSession('ws') : null;
        const retired = vi.fn();
        current?.onRetired(retired);
        h.socket().receive({
          id: olderId,
          result: {
            ...helloResult('obsolete'),
            protocolVersion: 'obsolete',
            server: {
              capabilities: { reviewMonitoring: 1, agentNodes: 1, workspaceMembershipEvents: 1 },
            },
          },
        });
        await older;
        expect(ready).toHaveBeenCalledTimes(phase === 'confirmed' ? 1 : 0);
        expect(retired).not.toHaveBeenCalled();
        if (current) {
          expect(current.support).toBe('unsupported');
          const cancel = current.request('prMonitor.cancel', { workspaceId: 'ws', monitorId: 'm' });
          expect(h.socket().lastFrame()).toMatchObject({
            method: 'prMonitor.cancel',
            params: { workspaceId: 'ws', monitorId: 'm' },
          });
          h.socket().receive({ id: h.socket().lastFrame().id, result: { ok: true } });
          await cancel;
          const read = h.transport
            .request('file.read', { workspaceId: 'ws', gitRootId: 'root', path: 'a' })
            .catch((e) => e);
          if (h.socket().lastFrame().method === 'file.read')
            h.socket().receive({ id: h.socket().lastFrame().id, result: 'latest protocol' });
          await expect(read).resolves.toBe('latest protocol');
          await expect(h.transport.observeNodeCapabilities()).resolves.toEqual({
            server: {
              capabilities: {
                agentNodes: 0,
                localNodeIsolation: 0,
                agentPlatformRouting: 0,
                workspaceMembershipEvents: 0,
                noteTruncatedRead: 0,
              },
            },
          });
        } else {
          await expect(h.transport.capturePrMonitorSession('ws')).rejects.toThrow();
        }
        // The next hello must carry the latest acknowledged ID, not the older response's ID.
        const finalHello = h.transport.request('client.hello', {}).catch((e) => e);
        expect(h.socket().lastFrame().params).toEqual({
          clientId: phase === 'confirmed' ? 'latest' : 'browser-1',
        });
        h.socket().receive({ id: h.socket().lastFrame().id, result: helloResult('final') });
        await finalHello;
        const finalSession = await h.transport.capturePrMonitorSession('ws');
        expect(finalSession.support).toBe('unsupported');
        const flush = finalSession.request('prMonitor.flush', {
          workspaceId: 'ws',
          monitorId: 'm',
          check: true,
        });
        h.socket().receive({ id: h.socket().lastFrame().id, result: { ok: true } });
        await flush;
        await finalSession.release();
      } finally {
        h.transport.dispose();
        await newer;
      }
    },
  );
});

async function acknowledgeAttachment(
  h: ReturnType<typeof createHarness>,
  overrides: Record<string, unknown> = {},
) {
  await flush();
  await flush();
  const socket = h.socket();
  expect(h.sockets.length).toBeGreaterThan(1);
  socket.open();
  const hello = socket.lastFrame();
  expect(hello).toMatchObject({
    method: 'client.hello',
    params: { connectionRole: 'review-monitor' },
  });
  socket.receive({
    id: hello.id,
    result: {
      ...helloResult((hello.params as { clientId: string }).clientId),
      connectionRole: 'review-monitor',
      server: { capabilities: { reviewMonitoring: 1 } },
      ...overrides,
    },
  });
  await flush();
  return socket;
}

describe('document review monitor receipt', () => {
  it('advertises only the enabled document and requires the acknowledged server capability', async () => {
    const capable = createHarness({ reviewMonitoring: 1 });
    const legacy = createHarness();
    try {
      const captures = [capable, legacy].map((h) => h.transport.capturePrMonitorSession('ws'));
      for (const h of [capable, legacy]) {
        h.socket().open();
        await flush();
        const hello = h.socket().lastFrame();
        h.socket().receive({
          id: hello.id,
          result: { ...helloResult(), server: { capabilities: { reviewMonitoring: 1 } } },
        });
      }
      const recipient = await acknowledgeAttachment(capable);
      const [qualified, old] = await Promise.all(captures);
      expect(capable.socket().lastFrame().params).toMatchObject({
        capabilities: { reviewMonitoring: 1 },
      });
      expect(qualified.support).toBe('supported');
      expect(old.support).toBe('consumer-pending');
      expect(legacy.socket().lastFrame().params).not.toHaveProperty(
        'capabilities.reviewMonitoring',
      );
      const withdrawing = capable.transport.request('client.hello', {
        capabilities: { reviewMonitoring: 0 },
      });
      const frame = capable.sockets[0].lastFrame();
      expect(recipient.closed).toBe(true);
      await expect(
        qualified.request('prMonitor.cancel', { workspaceId: 'ws', monitorId: 'm' }),
      ).rejects.toThrow();
      capable.sockets[0].receive({
        id: frame.id,
        result: { ...helloResult(), server: { capabilities: { reviewMonitoring: 1 } } },
      });
      await withdrawing;
      expect((await capable.transport.capturePrMonitorSession('ws')).support).toBe(
        'consumer-pending',
      );
    } finally {
      capable.transport.dispose();
      legacy.transport.dispose();
    }
  });

  it('does not let an ordinary hello opt an unqualified document into private output', async () => {
    const h = createHarness();
    try {
      const capture = h.transport.capturePrMonitorSession('ws');
      await connect(h.socket());
      await capture;
      const probe = h.transport.request('client.hello', {
        capabilities: { reviewMonitoring: 1, other: true },
      });
      const hello = h.socket().lastFrame();
      h.socket().receive({
        id: hello.id,
        result: { ...helloResult(), server: { capabilities: { reviewMonitoring: 1 } } },
      });
      await probe;
      expect(hello.params).toMatchObject({ capabilities: { other: true } });
      expect(hello.params).not.toHaveProperty('capabilities.reviewMonitoring');
      expect((await h.transport.capturePrMonitorSession('ws')).support).toBe('consumer-pending');
    } finally {
      h.transport.dispose();
    }
  });
});

describe('qualified browser reconnect', () => {
  it.each([undefined, 0, false, '1', 1.5])(
    'keeps server support %s unsupported even for a capable document',
    async (version) => {
      const h = createHarness({ reviewMonitoring: 1 });
      try {
        const capture = h.transport.capturePrMonitorSession('ws');
        h.socket().open();
        await flush();
        h.socket().receive({
          id: h.socket().lastFrame().id,
          result: { ...helloResult(), server: { capabilities: { reviewMonitoring: version } } },
        });
        expect((await capture).support).toBe('unsupported');
      } finally {
        h.transport.dispose();
      }
    },
  );
  it('renegotiates support on the replacement socket without reviving an original control', async () => {
    vi.useFakeTimers();
    const h = createHarness({ reviewMonitoring: 1, reconnectDelayMs: 1 });
    try {
      const capture = h.transport.capturePrMonitorSession('ws');
      const original = h.socket();
      original.open();
      await flush();
      original.receive({
        id: original.lastFrame().id,
        result: { ...helloResult(), server: { capabilities: { reviewMonitoring: 1 } } },
      });
      const recipient = await acknowledgeAttachment(h);
      const first = await capture;
      expect(first.support).toBe('supported');
      expect(original.lastFrame().params).not.toHaveProperty('capabilities.reviewMonitoring');
      original.drop();
      expect(recipient.closed).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      const replacement = h.socket();
      replacement.open();
      await flush();
      const next = h.transport.capturePrMonitorSession('ws');
      const hello = replacement.lastFrame();
      expect(hello.params).not.toHaveProperty('capabilities.reviewMonitoring');
      replacement.receive({ id: hello.id, result: helloResult('new') });
      expect((await next).support).toBe('unsupported');
      await expect(
        first.request('prMonitor.flush', { workspaceId: 'ws', monitorId: 'm' }),
      ).rejects.toThrow();
      expect(replacement.sent.map((x) => JSON.parse(x).method)).not.toContain('prMonitor.flush');
    } finally {
      h.transport.dispose();
    }
  });
});

describe('browser dedicated monitor attachment contract', () => {
  async function start(h: ReturnType<typeof createHarness>) {
    const capture = h.transport.capturePrMonitorSession('ws');
    const ordinary = h.socket();
    ordinary.open();
    ordinary.receive({
      id: ordinary.lastFrame().id,
      result: {
        ...helloResult('canonical/source'),
        server: { capabilities: { reviewMonitoring: 1 } },
      },
    });
    await flush();
    await flush();
    return { capture, ordinary };
  }

  it.each([
    { connectionRole: undefined },
    { connectionRole: 'ordinary' },
    { connectionRole: null },
    { connectionRole: 1 },
    { clientId: 'wrong' },
    { clientId: '' },
    { clientId: null },
    { server: { capabilities: {} } },
    { server: { capabilities: { reviewMonitoring: '1' } } },
  ])('refuses an unqualified attachment acknowledgement %j', async (reply) => {
    const h = createHarness({ reviewMonitoring: 1 });
    try {
      const { capture, ordinary } = await start(h);
      const rejection = expect(capture).rejects.toThrow();
      const attachment = await acknowledgeAttachment(h, reply);
      await rejection;
      expect(attachment.closed).toBe(true);
      expect(ordinary.closed).toBe(false);
      expect(ordinary.sent.map((x) => JSON.parse(x).method)).toEqual(['client.hello']);
    } finally {
      h.transport.dispose();
    }
  });

  it('routes controls and events only through the acknowledged canonical attachment and closes it on release', async () => {
    const h = createHarness({ reviewMonitoring: 1 });
    try {
      const { capture, ordinary } = await start(h);
      let resolved = false;
      void capture.then(() => {
        resolved = true;
      });
      expect(resolved).toBe(false);
      const attachment = await acknowledgeAttachment(h);
      expect(JSON.parse(attachment.sent[0]).params).toEqual({
        clientId: 'canonical/source',
        connectionRole: 'review-monitor',
        capabilities: { reviewMonitoring: 1 },
      });
      expect(JSON.parse(ordinary.sent[0]).params).toEqual({});
      const session = await capture;
      expect(session.support).toBe('supported');
      const notify = vi.fn();
      const retire = vi.fn();
      session.onNotification(notify);
      session.onRetired(retire);
      const event = {
        method: 'events.event',
        params: {
          event: { type: 'prMonitor:changed', data: { workspaceId: 'ws', monitorId: 'm' } },
        },
      };
      ordinary.receive(event);
      expect(notify).not.toHaveBeenCalled();
      attachment.receive(event);
      expect(notify).toHaveBeenCalledWith(event);
      await expect(
        session.request('prMonitor.cancel', { workspaceId: 'other', monitorId: 'm' }),
      ).rejects.toThrow();
      for (const method of [
        'prMonitor.list',
        'prMonitor.cancel',
        'prMonitor.flush',
        'events.subscribe',
        'events.unsubscribe',
      ] as const) {
        const params = { workspaceId: 'ws', monitorId: 'm', eventTypes: ['prMonitor:*'] };
        const response = session.request(method, params);
        expect(attachment.lastFrame()).toMatchObject({ method, params });
        const result = method === 'events.subscribe' ? { subscriptionId: 'sub' } : { ok: true };
        attachment.receive({ id: attachment.lastFrame().id, result });
        await expect(response).resolves.toEqual(result);
      }
      const staleCallback = attachment.onmessage;
      await session.release();
      expect(attachment.closed).toBe(true);
      expect(ordinary.closed).toBe(false);
      expect(retire).toHaveBeenCalledTimes(1);
      staleCallback?.({ data: JSON.stringify(event) });
      expect(notify).toHaveBeenCalledTimes(1);
      await expect(session.request('prMonitor.flush', { workspaceId: 'ws' })).rejects.toThrow();
      expect(ordinary.sent.map((x) => JSON.parse(x).method)).toEqual(['client.hello']);
    } finally {
      h.transport.dispose();
    }
  });

  it('retires pending work on attachment loss and reacquires without reusing the recipient', async () => {
    vi.useFakeTimers();
    const h = createHarness({ reviewMonitoring: 1, reconnectDelayMs: 10 });
    try {
      const { capture, ordinary } = await start(h);
      const firstSocket = await acknowledgeAttachment(h);
      const first = await capture;
      const ready = vi.fn();
      h.transport.onMonitorReconnected(ready);
      const response = first.request('prMonitor.list', { workspaceId: 'ws' });
      const failed = expect(response).rejects.toThrow();
      firstSocket.drop();
      await failed;
      expect(ordinary.closed).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      expect(ready).toHaveBeenCalledTimes(1);
      const next = h.transport.capturePrMonitorSession('ws');
      await flush();
      await flush();
      const secondSocket = await acknowledgeAttachment(h);
      const second = await next;
      expect(secondSocket).not.toBe(firstSocket);
      expect(second.origin).not.toEqual(first.origin);
      expect(second.support).toBe('supported');
      await expect(first.request('prMonitor.cancel', { workspaceId: 'ws' })).rejects.toThrow();
      await second.release();
    } finally {
      h.transport.dispose();
    }
  });

  it('retires an in-flight attachment when the ordinary source rehellos with the same ID', async () => {
    const h = createHarness({ reviewMonitoring: 1 });
    try {
      const { capture, ordinary } = await start(h);
      const attachment = h.socket();
      const failed = expect(capture).rejects.toThrow();
      const hello = h.transport.request('client.hello', {});
      expect(attachment.closed).toBe(true);
      ordinary.receive({
        id: ordinary.lastFrame().id,
        result: {
          ...helloResult('canonical/source'),
          server: { capabilities: { reviewMonitoring: 1 } },
        },
      });
      await hello;
      await failed;
      const next = h.transport.capturePrMonitorSession('ws');
      await flush();
      await flush();
      const replacement = await acknowledgeAttachment(h);
      expect(replacement).not.toBe(attachment);
      await (await next).release();
    } finally {
      h.transport.dispose();
    }
  });

  it.each(['ordinary', 'review-monitor', null])(
    'does not attach to a source hello with role %s',
    async (connectionRole) => {
      const h = createHarness({ reviewMonitoring: 1 });
      try {
        const capture = h.transport.capturePrMonitorSession('ws');
        const source = h.socket();
        source.open();
        source.receive({
          id: source.lastFrame().id,
          result: {
            ...helloResult(),
            connectionRole,
            server: { capabilities: { reviewMonitoring: 1 } },
          },
        });
        const session = await capture;
        expect(session.support).toBe('consumer-pending');
        expect(h.sockets).toHaveLength(1);
        await expect(session.request('prMonitor.list', { workspaceId: 'ws' })).rejects.toThrow();
        await session.release();
      } finally {
        h.transport.dispose();
      }
    },
  );

  it('keeps workspace attachments independent and closes all of them on transport disposal', async () => {
    const h = createHarness({ reviewMonitoring: 1 });
    try {
      const { capture, ordinary } = await start(h);
      const aSocket = await acknowledgeAttachment(h);
      const a = await capture;
      const bCapture = h.transport.capturePrMonitorSession('other');
      await flush();
      await flush();
      const bSocket = await acknowledgeAttachment(h);
      const b = await bCapture;
      await a.release();
      expect(aSocket.closed).toBe(true);
      expect(bSocket.closed).toBe(false);
      const result = b.request('prMonitor.list', { workspaceId: 'other' });
      expect(bSocket.lastFrame().params).toEqual({ workspaceId: 'other' });
      const failed = expect(result).rejects.toThrow();
      h.transport.dispose();
      await failed;
      expect(bSocket.closed).toBe(true);
      expect(ordinary.closed).toBe(true);
      await expect(b.request('prMonitor.cancel', { workspaceId: 'other' })).rejects.toThrow();
    } finally {
      h.transport.dispose();
    }
  });

  it('does not accept a notification or reverse request as the attachment hello reply', async () => {
    const h = createHarness({ reviewMonitoring: 1 });
    try {
      const { capture } = await start(h);
      const socket = h.socket();
      socket.open();
      const id = socket.lastFrame().id;
      let ready = false;
      void capture.then(() => {
        ready = true;
      });
      const result = {
        ...helloResult('canonical/source'),
        connectionRole: 'review-monitor',
        server: { capabilities: { reviewMonitoring: 1 } },
      };
      socket.receive({ method: 'events.event', result });
      socket.receive({ id, method: 'client.hello', result });
      await flush();
      expect(ready).toBe(false);
      expect(socket.lastFrame()).toMatchObject({ id, error: { code: -32601 } });
      socket.receive({ id, result });
      await (await capture).release();
    } finally {
      h.transport.dispose();
    }
  });

  it('times out a missing attachment hello and closes only the dedicated socket', async () => {
    vi.useFakeTimers();
    const h = createHarness({ reviewMonitoring: 1, connectTimeoutMs: 50, requestTimeoutMs: 20 });
    try {
      const { capture, ordinary } = await start(h);
      const failed = expect(capture).rejects.toThrow();
      const socket = h.socket();
      socket.open();
      await vi.advanceTimersByTimeAsync(20);
      await failed;
      expect(socket.closed).toBe(true);
      expect(ordinary.closed).toBe(false);
    } finally {
      h.transport.dispose();
    }
  });
});

describe('passive principal discovery', () => {
  it('uses one initial handshake and refreshes principal without another hello', async () => {
    const h = createHarness();
    const discovery = h.transport.readPrincipal();
    const socket = h.socket();
    socket.open();
    const hello = {
      ...helloResult(),
      server: {
        capabilities: {
          hostMembership: 1,
          personalPairing: 1,
          collaborationIdentity: 1,
          submissionCorrelation: 1,
          gitlabCheckout: 1,
        },
      },
    };
    socket.receive({ id: socket.lastFrame().id, result: hello });
    await flush();
    expect(socket.lastFrame()).toMatchObject({ method: 'principal.me' });
    socket.receive({ id: socket.lastFrame().id, result: { id: 'first' } });
    await expect(discovery).resolves.toEqual({ hello, principal: { id: 'first' } });
    const refresh = h.transport.readPrincipal();
    await flush();
    socket.receive({ id: socket.lastFrame().id, result: { id: 'updated' } });
    await expect(refresh).resolves.toEqual({ hello, principal: { id: 'updated' } });
    expect(socket.sent.map((frame) => JSON.parse(frame).method)).toEqual([
      'client.hello',
      'principal.me',
      'principal.me',
    ]);
    h.transport.dispose();
  });

  it('refuses an old principal result after same-socket renegotiation', async () => {
    const h = createHarness();
    await (async () => {
      const initial = h.transport.observeNodeCapabilities();
      await connect(h.socket());
      await initial;
    })();
    const discovery = h.transport.readPrincipal();
    const rejected = expect(discovery).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await flush();
    const principalId = h.socket().lastFrame().id;
    const renegotiation = h.transport.request('client.hello', {});
    h.socket().receive({ id: h.socket().lastFrame().id, result: helloResult('new-identity') });
    await renegotiation;
    h.socket().receive({ id: principalId, result: { id: 'old-principal' } });
    await rejected;
    h.transport.dispose();
  });

  it('does not read principal after an unacknowledged handshake and preserves its refusal', async () => {
    const h = createHarness();
    const discovery = h.transport.readPrincipal();
    const rejected = expect(discovery).rejects.toMatchObject({ rpcCode: -32003 });
    h.socket().open();
    h.socket().receive({
      id: h.socket().lastFrame().id,
      error: { code: -32003, message: 'Forbidden' },
    });
    await rejected;
    expect(h.socket().sent.map((frame) => JSON.parse(frame).method)).toEqual(['client.hello']);
    h.transport.dispose();
  });

  it('preserves principal refusals and rejects discovery interrupted by disconnect', async () => {
    const h = createHarness();
    const initial = h.transport.observeNodeCapabilities();
    await connect(h.socket());
    await initial;
    const forbidden = h.transport.readPrincipal();
    const refused = expect(forbidden).rejects.toMatchObject({ rpcCode: -32003 });
    await flush();
    h.socket().receive({
      id: h.socket().lastFrame().id,
      error: { code: -32003, message: 'Forbidden' },
    });
    await refused;
    const discovery = h.transport.readPrincipal();
    const disconnected = expect(discovery).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
    await flush();
    h.socket().drop();
    await disconnected;
    h.transport.dispose();
  });
});

describe('truncated note reads capability through the browser transport (§5.2)', () => {
  it.each([
    [{ ...helloResult().server.capabilities, noteTruncatedRead: 1, agentNodes: 1 }, true],
    [{ ...helloResult().server.capabilities, agentNodes: 1 }, false],
    [{ noteTruncatedRead: true }, false],
  ])(
    'reads server.capabilities %j from the real hello as supported: %s',
    async (capabilities, expected) => {
      const { transport, socket } = createHarness();
      vi.spyOn(backendTransport, 'observeBackendNodeCapabilities').mockImplementation(() =>
        transport.observeNodeCapabilities(),
      );
      const supported = new LiveNotesClient().supportsTruncatedRead();
      socket().open();
      await flush();
      socket().receive({
        id: socket().lastFrame().id,
        result: { ...helloResult(), server: { ...helloResult().server, capabilities } },
      });
      await expect(supported).resolves.toBe(expected);
      transport.dispose();
    },
  );
});

describe('daemon startup readiness (docs/protocol/startup-readiness.md)', () => {
  const preparing = {
    startupStatus: 1,
    attemptId: 'boot-a',
    phase: 'preparing',
    elapsedMs: 3000,
    phaseElapsedMs: 1000,
    progressAgeMs: 0,
    retryAfterMs: 1000,
  };
  const notReady = {
    code: -32012,
    message: 'Daemon not ready',
    data: { code: 'daemon-not-ready', retryable: true, retryAfterMs: 1000, startup: preparing },
  };
  const methods = (socket: FakeWebSocket) =>
    socket.sent.map((frame) => (JSON.parse(frame) as { method?: string }).method);

  /** Start the transport and answer its connect-time hello with `error`. */
  async function helloAnswered(
    harness: ReturnType<typeof createHarness>,
    error: unknown,
  ): Promise<{ pending: Promise<unknown> }> {
    const pending = harness.transport.request('workspace.list').catch((e: unknown) => e);
    const first = harness.socket();
    first.open();
    await flush();
    first.receive({ jsonrpc: '2.0', id: first.lastFrame().id, error });
    await flush();
    // Wrapped so callers that do not expect a reply never await it.
    return { pending };
  }

  it('holds a starting state, polls, then re-hellos on a fresh socket before connecting', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ reconnectDelayMs: 100 });
    const { transport } = harness;
    const statuses: string[] = [];
    transport.onConnectionStatusChange((status) => statuses.push(status));
    const reconnected = vi.fn();
    transport.onReconnected(reconnected);

    const { pending } = await helloAnswered(harness, notReady);
    expect(await pending).toMatchObject({ rpcCode: -32012 });
    expect(transport.getConnectionStatus()).toBe('connecting');
    expect(transport.getStartupState()).toMatchObject({ state: 'starting', available: true });
    await expect(
      transport.request('note.create', { content: 'do not send' }),
    ).rejects.toMatchObject({ rpcCode: -32012, data: { code: 'daemon-not-ready' } });

    const first = harness.socket();
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.lastFrame()).toMatchObject({ method: 'system.startupStatus' });
    first.receive({
      jsonrpc: '2.0',
      id: first.lastFrame().id,
      result: { ...preparing, phase: 'ready', retryAfterMs: undefined },
    });
    await flush();
    expect(first.closed).toBe(true);
    expect(transport.getConnectionStatus()).toBe('connecting');

    await vi.advanceTimersByTimeAsync(100);
    expect(harness.sockets).toHaveLength(2);
    await connect(harness.socket());
    expect(transport.getConnectionStatus()).toBe('connected');
    expect(transport.getStartupState()).toBeNull();
    expect(reconnected).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(methods(first)).toEqual(['client.hello', 'system.startupStatus']);
    transport.dispose();
  });

  it('reconnects and re-hellos when the starting daemon closes its socket', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ reconnectDelayMs: 100 });
    await helloAnswered(harness, notReady);
    harness.socket().drop();
    expect(harness.transport.getConnectionStatus()).toBe('connecting');
    await vi.advanceTimersByTimeAsync(100);
    await connect(harness.socket());
    expect(harness.transport.getConnectionStatus()).toBe('connected');
    expect(harness.transport.getStartupState()).toBeNull();
    harness.transport.dispose();
  });

  it('reports a daemon that fails to start as a failure, not as connected', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ reconnectDelayMs: 100 });
    const failed = {
      code: -32012,
      message: 'Daemon startup failed',
      data: {
        code: 'daemon-startup-failed',
        retryable: false,
        startup: {
          ...preparing,
          phase: 'failed',
          phaseElapsedMs: 0,
          retryAfterMs: undefined,
          failure: { code: 'startup-failed', message: 'Daemon startup failed. Check daemon logs.' },
        },
      },
    };
    const changes: unknown[] = [];
    harness.transport.onStartupChange((state) => changes.push(state));
    await helloAnswered(harness, failed);
    expect(harness.transport.getConnectionStatus()).toBe('disconnected');
    expect(harness.transport.getStartupState()).toMatchObject({
      state: 'failed',
      message: 'Daemon startup failed. Check daemon logs.',
    });
    expect(changes).toHaveLength(1);
    // Reconnects continue and a healthy daemon clears the failure.
    await vi.advanceTimersByTimeAsync(100);
    await connect(harness.socket());
    expect(harness.transport.getConnectionStatus()).toBe('connected');
    expect(harness.transport.getStartupState()).toBeNull();
    harness.transport.dispose();
  });

  it('falls back to a fresh hello when a status poll goes unanswered', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ reconnectDelayMs: 100 });
    await helloAnswered(harness, notReady);
    const first = harness.socket();
    await vi.advanceTimersByTimeAsync(1000 + 5000);
    expect(first.closed).toBe(true);
    expect(harness.transport.getStartupState()).toMatchObject({ available: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(harness.sockets).toHaveLength(2);
    harness.transport.dispose();
  });

  it('keeps an ordinary hello error on the legacy connected path', async () => {
    const harness = createHarness();
    await helloAnswered(harness, { code: -32601, message: 'Method not found' });
    expect(harness.transport.getConnectionStatus()).toBe('connected');
    expect(harness.transport.getStartupState()).toBeNull();
    harness.transport.dispose();
  });
});
