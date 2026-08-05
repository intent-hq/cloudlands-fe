/**
 * Unit tests for the connection-target resolver and the loopback WebSocket
 * transport (framing adapter + integration with the shared JSON-RPC client).
 *
 * Precedence tests cover every env-var combination plus the dev/prod default;
 * transport tests drive a real localhost `ws://` server (`ws.WebSocketServer`)
 * so the adapter's newline framing + event-push path exercise the same code
 * a live daemon would.
 */
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_DEV_WS_URL,
  defaultSocketPath,
  describeBackendConfig,
  resolveBackendConfig,
  WebSocketDuplex,
} from './backend-connection';
import { shouldSpawnSidecar } from './intentd-spawn-policy';
import { isWindowsPipePath, toLocalEndpoint, windowsPipeName } from './intentd-pipe-name';
import { JsonRpcClient } from './json-rpc-client';

// `ws` is aliased to a browser stub in `vitest.config.ts`; use createRequire to
// load the real Node implementation (same pattern as `ssh-manager.ts`).
const nodeRequire = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = nodeRequire('ws') as typeof import('ws');

describe('resolveBackendConfig precedence', () => {
  it('honours INTENTD_SOCKET over every other override (any build)', () => {
    const config = resolveBackendConfig(
      {
        INTENTD_SOCKET: '/tmp/forced.sock',
        INTENTD_WS_URL: 'ws://127.0.0.1:9999',
        INTENTD_TCP: '10.0.0.1:6000',
      },
      { isDev: true },
    );
    expect(config).toEqual({ transport: 'uds', socketPath: '/tmp/forced.sock' });
  });

  it('picks INTENTD_WS_URL and appends /ws when only host+port is given', () => {
    const config = resolveBackendConfig(
      { INTENTD_WS_URL: 'ws://127.0.0.1:5181' },
      { isDev: false },
    );
    expect(config.transport).toBe('ws');
    expect(config.wsUrl).toBe('ws://127.0.0.1:5181/ws');
  });

  it('keeps the user-supplied INTENTD_WS_URL path when present', () => {
    const config = resolveBackendConfig({ INTENTD_WS_URL: 'ws://host:1234/custom' });
    expect(config.wsUrl).toBe('ws://host:1234/custom');
  });

  it('falls back to the legacy INTENTD_TCP stub when only that is set', () => {
    const config = resolveBackendConfig({ INTENTD_TCP: '10.0.0.5:6000' });
    expect(config).toEqual({ transport: 'tcp', host: '10.0.0.5', port: 6000, tls: true });
  });

  it('honours INTENTD_TCP_INSECURE=1 for the legacy TCP stub', () => {
    const config = resolveBackendConfig({
      INTENTD_TCP: '10.0.0.5:6000',
      INTENTD_TCP_INSECURE: '1',
    });
    expect(config.tls).toBe(false);
  });

  it('defaults dev builds without sidecar to the loopback WebSocket URL', () => {
    const config = resolveBackendConfig({}, { isDev: true });
    expect(config).toEqual({ transport: 'ws', wsUrl: DEFAULT_DEV_WS_URL });
  });

  it('defaults dev+sidecar (INTENTD_SIDECAR=1) to the UDS transport', () => {
    const config = resolveBackendConfig({ INTENTD_SIDECAR: '1' }, { isDev: true });
    expect(config).toEqual({ transport: 'uds', socketPath: defaultSocketPath({}) });
  });

  it('honors INTENTD_DATA_DIR for the dev+sidecar UDS socket path', () => {
    const config = resolveBackendConfig(
      { INTENTD_SIDECAR: '1', INTENTD_DATA_DIR: '/tmp/dev-seat' },
      { isDev: true },
    );
    expect(config).toEqual({ transport: 'uds', socketPath: '/tmp/dev-seat/intentd.sock' });
  });

  it('dev+INTENTD_SIDECAR=0 stays on the loopback WebSocket default', () => {
    const config = resolveBackendConfig({ INTENTD_SIDECAR: '0' }, { isDev: true });
    expect(config).toEqual({ transport: 'ws', wsUrl: DEFAULT_DEV_WS_URL });
  });

  it('defaults packaged builds to the dev UDS path (backward compatible)', () => {
    const config = resolveBackendConfig({}, { isDev: false });
    expect(config).toEqual({ transport: 'uds', socketPath: defaultSocketPath({}) });
  });

  it('treats a missing opts.isDev as the packaged default', () => {
    const config = resolveBackendConfig({});
    expect(config.transport).toBe('uds');
  });

  it('honors INTENTD_DATA_DIR for the default UDS socket path', () => {
    const config = resolveBackendConfig({ INTENTD_DATA_DIR: '/custom/data' }, { isDev: false });
    expect(config).toEqual({ transport: 'uds', socketPath: '/custom/data/intentd.sock' });
  });

  it('INTENTD_SOCKET takes precedence over INTENTD_DATA_DIR', () => {
    const config = resolveBackendConfig(
      { INTENTD_SOCKET: '/override.sock', INTENTD_DATA_DIR: '/custom/data' },
      { isDev: false },
    );
    expect(config).toEqual({ transport: 'uds', socketPath: '/override.sock' });
  });
});

describe('win32 named-pipe derivation (pipe-name contract)', () => {
  // Cross-check vector shared with the Rust implementation in
  // intent-transport — both sides MUST derive the same pipe name:
  //   socket path: C:\Users\alice\AppData\Roaming\intentd\data\intentd.sock
  //   normalized:  c:\users\alice\appdata\roaming\intentd\data\intentd.sock
  //   sha256:      4f8c75c28cfa6e92da1ca663e86a6f8c68d96047d924499ac04c09f905660611
  //   hash16:      4f8c75c28cfa6e92
  //   pipe name:   \\.\pipe\intentd-4f8c75c28cfa6e92
  const VECTOR_SOCKET = 'C:\\Users\\alice\\AppData\\Roaming\\intentd\\data\\intentd.sock';
  const VECTOR_PIPE = '\\\\.\\pipe\\intentd-4f8c75c28cfa6e92';

  it('derives the pinned cross-check vector', () => {
    expect(windowsPipeName(VECTOR_SOCKET)).toBe(VECTOR_PIPE);
  });

  it('normalization: case and separator variants hash identically', () => {
    expect(windowsPipeName('c:/users/ALICE/AppData/Roaming/intentd/data/INTENTD.SOCK')).toBe(
      VECTOR_PIPE,
    );
  });

  it('isWindowsPipePath recognises the pipe namespace only', () => {
    expect(isWindowsPipePath(VECTOR_PIPE)).toBe(true);
    expect(isWindowsPipePath('\\\\?\\pipe\\intentd-x')).toBe(true);
    expect(isWindowsPipePath(VECTOR_SOCKET)).toBe(false);
    expect(isWindowsPipePath('/tmp/intentd.sock')).toBe(false);
  });

  it('toLocalEndpoint maps sockets to pipes only on win32; pipes pass through', () => {
    expect(toLocalEndpoint(VECTOR_SOCKET, 'win32')).toBe(VECTOR_PIPE);
    expect(toLocalEndpoint(VECTOR_PIPE, 'win32')).toBe(VECTOR_PIPE);
    expect(toLocalEndpoint('/tmp/i.sock', 'darwin')).toBe('/tmp/i.sock');
    expect(toLocalEndpoint('/tmp/i.sock', 'linux')).toBe('/tmp/i.sock');
  });

  it('defaultSocketPath on win32 derives the pipe from INTENTD_DATA_DIR\\intentd.sock', () => {
    const target = defaultSocketPath({ INTENTD_DATA_DIR: 'C:\\dev-seat' }, 'win32');
    expect(target).toBe(windowsPipeName('C:\\dev-seat\\intentd.sock'));
    expect(target).toMatch(/^\\\\\.\\pipe\\intentd-[0-9a-f]{16}$/);
  });

  it('defaultSocketPath on win32 without INTENTD_DATA_DIR mirrors the daemon default (%APPDATA%\\intentd\\data)', () => {
    const target = defaultSocketPath({ APPDATA: 'C:\\Users\\alice\\AppData\\Roaming' }, 'win32');
    expect(target).toBe(VECTOR_PIPE);
  });

  it('resolveBackendConfig maps the INTENTD_SOCKET override through the derivation on win32', () => {
    const config = resolveBackendConfig(
      { INTENTD_SOCKET: 'C:\\tmp\\forced.sock' },
      { platform: 'win32' },
    );
    expect(config).toEqual({
      transport: 'uds',
      socketPath: windowsPipeName('C:\\tmp\\forced.sock'),
    });
  });

  it('resolveBackendConfig passes an already-pipe INTENTD_SOCKET through unchanged on win32', () => {
    const config = resolveBackendConfig(
      { INTENTD_SOCKET: '\\\\.\\pipe\\intentd-custom' },
      { platform: 'win32' },
    );
    expect(config).toEqual({ transport: 'uds', socketPath: '\\\\.\\pipe\\intentd-custom' });
  });

  it('non-win32 platforms keep the plain socket path', () => {
    expect(defaultSocketPath({ INTENTD_DATA_DIR: '/custom/data' }, 'linux')).toBe(
      '/custom/data/intentd.sock',
    );
  });
});

describe('resolveBackendConfig × shouldSpawnSidecar pinning', () => {
  // These two functions must not be able to disagree on whether the dev
  // build is talking to a sidecar-spawned intentd over UDS or to an external
  // dev-daemon over the loopback WebSocket. If a future change to
  // `shouldSpawnSidecar` widens/narrows the spawn set, this test fails until
  // `resolveBackendConfig` is updated to match.
  const matrix: Array<{ name: string; env: NodeJS.ProcessEnv }> = [
    { name: 'no env', env: {} },
    { name: 'INTENTD_SIDECAR=1', env: { INTENTD_SIDECAR: '1' } },
    { name: 'INTENTD_SIDECAR=0', env: { INTENTD_SIDECAR: '0' } },
    {
      name: 'INTENTD_SIDECAR=1 + INTENTD_DATA_DIR',
      env: { INTENTD_SIDECAR: '1', INTENTD_DATA_DIR: '/tmp/x' },
    },
  ];

  for (const { name, env } of matrix) {
    it(`dev+${name}: transport matches spawn policy`, () => {
      const config = resolveBackendConfig(env, { isDev: true });
      const decision = shouldSpawnSidecar(env, /* isPackaged */ false);
      if (decision.shouldSpawn) {
        expect(config.transport).toBe('uds');
        expect(config.socketPath).toBe(defaultSocketPath(env));
      } else {
        expect(config.transport).toBe('ws');
        expect(config.wsUrl).toBe(DEFAULT_DEV_WS_URL);
      }
    });
  }

  // Env transport overrides suppress spawning AND win the transport
  // resolution, but the resolver returns their configured transport (uds/ws/
  // tcp) rather than the sidecar UDS default — assert that explicitly so we
  // don't accidentally re-route packaged/dev overrides through the sidecar
  // socket.
  const overrides: Array<{
    name: string;
    env: NodeJS.ProcessEnv;
    expectTransport: 'uds' | 'ws' | 'tcp';
  }> = [
    {
      name: 'INTENTD_SOCKET',
      env: { INTENTD_SIDECAR: '1', INTENTD_SOCKET: '/tmp/o.sock' },
      expectTransport: 'uds',
    },
    {
      name: 'INTENTD_WS_URL',
      env: { INTENTD_SIDECAR: '1', INTENTD_WS_URL: 'ws://h:9/ws' },
      expectTransport: 'ws',
    },
    {
      name: 'INTENTD_TCP',
      env: { INTENTD_SIDECAR: '1', INTENTD_TCP: '10.0.0.1:6000' },
      expectTransport: 'tcp',
    },
  ];
  for (const { name, env, expectTransport } of overrides) {
    it(`dev+${name} override: sidecar suppressed AND transport is the override`, () => {
      expect(shouldSpawnSidecar(env, false).shouldSpawn).toBe(false);
      expect(resolveBackendConfig(env, { isDev: true }).transport).toBe(expectTransport);
    });
  }
});

describe('describeBackendConfig', () => {
  it('renders each transport variant with its distinguishing field', () => {
    expect(describeBackendConfig({ transport: 'uds', socketPath: '/x.sock' })).toBe('uds:/x.sock');
    expect(describeBackendConfig({ transport: 'ws', wsUrl: 'ws://h:1/ws' })).toBe('ws:ws://h:1/ws');
    expect(describeBackendConfig({ transport: 'tcp', host: 'h', port: 2, tls: true })).toBe(
      'tcp:h:2 (tls)',
    );
    expect(describeBackendConfig({ transport: 'tcp', host: 'h', port: 2, tls: false })).toBe(
      'tcp:h:2',
    );
  });
});

/**
 * Spin up a fake JSON-RPC-over-WebSocket daemon: one message per text frame,
 * newline-free, matching `intent-transport/src/ws.rs::connection_loop`. Tests
 * can register a per-request response and push notifications on demand.
 */
class FakeWsDaemon {
  private wss!: import('ws').WebSocketServer;
  url = '';
  handler: (req: {
    id?: number | string;
    method: string;
    params?: unknown;
  }) =>
    { result?: unknown; error?: { code: number; message: string; data?: unknown } } | undefined =
    () => ({ result: null });
  private clients: import('ws').WebSocket[] = [];

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((res) => this.wss.once('listening', () => res()));
    const addr = this.wss.address() as AddressInfo;
    this.url = `ws://127.0.0.1:${addr.port}/ws`;
    this.wss.on('connection', (socket) => {
      this.clients.push(socket);
      socket.on('message', (data, isBinary) => {
        if (isBinary) return;
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        // Reject any accidental newlines in the incoming frame: the FE adapter
        // MUST send one JSON envelope per WS text frame with no trailing '\n'.
        if (text.includes('\n')) {
          socket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -1, message: 'framing: newline in frame' },
            }),
          );
          return;
        }
        const req = JSON.parse(text) as { id?: number | string; method: string; params?: unknown };
        const outcome = this.handler(req);
        if (!outcome) return;
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, ...outcome }));
      });
    });
  }

  broadcast(payload: unknown): void {
    const frame = JSON.stringify(payload);
    for (const c of this.clients) if (c.readyState === WebSocket.OPEN) c.send(frame);
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.terminate();
    await new Promise<void>((res) => this.wss.close(() => res()));
  }
}

describe('WebSocketDuplex framing adapter (loopback ws://)', () => {
  let daemon: FakeWsDaemon;

  beforeAll(async () => {
    daemon = new FakeWsDaemon();
    await daemon.start();
  });

  afterAll(async () => {
    await daemon.stop();
  });

  afterEach(() => {
    daemon.handler = () => ({ result: null });
  });

  it('round-trips a JSON-RPC request/response over a real ws:// connection', async () => {
    daemon.handler = (req) => {
      if (req.method === 'workspace.list') return { result: { workspaces: ['a', 'b'] } };
      return { error: { code: -32601, message: 'no such method' } };
    };
    const client = new JsonRpcClient({
      config: { transport: 'ws', wsUrl: daemon.url },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 2000,
    });
    client.on('error', () => {});
    await expect(client.request('workspace.list', { filter: 'active' })).resolves.toEqual({
      workspaces: ['a', 'b'],
    });
    client.dispose();
  });

  it('dispatches a daemon-pushed notification (event) to notification listeners', async () => {
    const client = new JsonRpcClient({
      config: { transport: 'ws', wsUrl: daemon.url },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 2000,
    });
    client.on('error', () => {});
    const received: Array<{ method: string; params?: unknown }> = [];
    client.on('notification', (n) => received.push(n));

    daemon.handler = () => ({ result: 'ok' });
    await client.request('system.status');
    daemon.broadcast({
      jsonrpc: '2.0',
      method: 'events.event',
      params: { type: 'workspace:updated', id: 'w1' },
    });

    await vi.waitFor(() => {
      expect(received).toContainEqual({
        method: 'events.event',
        params: { type: 'workspace:updated', id: 'w1' },
      });
    });
    client.dispose();
  });

  it('surfaces a connect failure the same way UDS does (error + reconnect)', async () => {
    const client = new JsonRpcClient({
      // 127.0.0.1:1 is guaranteed refused; the client MUST fail visibly and
      // NOT silently fall back to UDS.
      config: { transport: 'ws', wsUrl: 'ws://127.0.0.1:1/ws' },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 500,
      reconnectDelayMs: 10_000,
    });
    const errors: Error[] = [];
    client.on('error', (e) => errors.push(e));
    await expect(client.request('any.method')).rejects.toThrow();
    expect(errors.length).toBeGreaterThan(0);
    expect(client.getStatus()).toBe('disconnected');
    client.dispose();
  });

  it('encodes text frames without a trailing newline (one JSON per frame)', async () => {
    let received = '';
    daemon.handler = (req) => {
      received = JSON.stringify(req);
      return { result: null };
    };
    const client = new JsonRpcClient({
      config: { transport: 'ws', wsUrl: daemon.url },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 2000,
    });
    client.on('error', () => {});
    await client.request('system.status');
    expect(received.includes('\n')).toBe(false);
    expect(JSON.parse(received)).toMatchObject({ jsonrpc: '2.0', method: 'system.status' });
    client.dispose();
  });

  it('buffers a partial JSON line across writes and emits one WS frame per newline', async () => {
    const ws = new WebSocket(daemon.url);
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', (e) => rej(e));
    });
    const duplex: Duplex = new WebSocketDuplex(ws);
    const echoes: string[] = [];
    daemon.handler = (req) => {
      echoes.push(JSON.stringify(req));
      return { result: 'ok' };
    };
    duplex.write('{"jsonrpc":"2.0","id":1,"method":');
    duplex.write('"system.status"}\n');
    await vi.waitFor(() => expect(echoes).toHaveLength(1));
    expect(JSON.parse(echoes[0])).toMatchObject({ id: 1, method: 'system.status' });
    duplex.destroy();
  });
});
