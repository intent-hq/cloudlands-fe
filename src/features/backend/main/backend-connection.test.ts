/**
 * Unit tests for the connection-target resolver and the loopback WebSocket
 * transport (framing adapter + integration with the shared JSON-RPC client).
 *
 * Precedence tests cover every env-var combination plus the dev/prod default;
 * transport tests drive a real localhost `ws://` server (`ws.WebSocketServer`)
 * so the adapter's newline framing + event-push path exercise the same code
 * a live daemon would.
 */
import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { createRequire } from 'node:module';
import net, { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Duplex, PassThrough } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  resolveDevIntentdDataDir,
  shouldIsolateDevIntentdDataDir,
} from '../../../main/utils/resolve-dev-instance';
import {
  AuthRejectedError,
  candidateWssHosts,
  captureFingerprint,
  createBackendSocket,
  defaultSocketPath,
  describeBackendConfig,
  normalizeFingerprint,
  PinMismatchError,
  raceDuplexSockets,
  resolveBackendConfig,
  TUNNEL_RACE_HOST,
  tunnelRaceAttempt,
  WebSocketDuplex,
} from './backend-connection';
import type { HostCertMismatch } from './backend-connection';
import { resolveSocketPath } from './intentd-sidecar';
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

  it('defaults dev builds without sidecar to the installed daemon UDS', () => {
    const config = resolveBackendConfig({}, { isDev: true });
    expect(config).toEqual({ transport: 'uds', socketPath: defaultSocketPath({}) });
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

  it('dev+INTENTD_SIDECAR=0 still adopts the default UDS without a transport override', () => {
    const config = resolveBackendConfig({ INTENTD_SIDECAR: '0' }, { isDev: true });
    expect(config).toEqual({ transport: 'uds', socketPath: defaultSocketPath({}) });
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

describe('defaultSocketPath platform defaults (no INTENTD_DATA_DIR)', () => {
  // Mirrors the daemon's `Config::resolve` data-dir defaults — see
  // `intentd-data-dir.ts` (the single FE-side resolver).
  it('darwin resolves ~/Library/Application Support/intentd/intentd.sock', () => {
    expect(defaultSocketPath({}, 'darwin')).toBe(
      path.join(os.homedir(), 'Library', 'Application Support', 'intentd', 'intentd.sock'),
    );
  });

  it('linux falls back to ~/.local/share/intentd/intentd.sock', () => {
    expect(defaultSocketPath({}, 'linux')).toBe(
      path.join(os.homedir(), '.local', 'share', 'intentd', 'intentd.sock'),
    );
  });

  it('linux honors XDG_DATA_HOME', () => {
    expect(defaultSocketPath({ XDG_DATA_HOME: '/xdg/data' }, 'linux')).toBe(
      path.join('/xdg/data', 'intentd', 'intentd.sock'),
    );
  });

  it('linux INTENTD_DATA_DIR takes precedence over XDG_DATA_HOME', () => {
    expect(
      defaultSocketPath({ INTENTD_DATA_DIR: '/custom/data', XDG_DATA_HOME: '/xdg/data' }, 'linux'),
    ).toBe('/custom/data/intentd.sock');
  });

  it('stays in lockstep with the sidecar resolver on every platform', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(defaultSocketPath({}, platform)).toBe(resolveSocketPath({}, platform));
    }
  });
});

describe('resolveBackendConfig build/spawn posture', () => {
  // Spawn policy decides whether Electron launches intentd, not how the local
  // client addresses it. Every zero-config posture adopts the canonical UDS.
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
    it(`dev+${name}: uses the canonical UDS`, () => {
      const config = resolveBackendConfig(env, { isDev: true });
      expect(config).toEqual({ transport: 'uds', socketPath: defaultSocketPath(env) });
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
      expect(resolveBackendConfig(env, { isDev: true }).transport).toBe(expectTransport);
    });
  }
});

describe('dev intentd data-dir isolation × resolveBackendConfig', () => {
  // The main process applies `shouldIsolateDevIntentdDataDir` + `resolveDevIntentdDataDir`
  // to `process.env` before any backend startup (see src/main/index.ts). These tests pin
  // the resulting connection targets so the isolation cannot silently move the packaged
  // default or an explicit transport override.
  const APP_DATA = '/Users/me/Library/Application Support';
  const PER_PORT_DIR = path.join(APP_DATA, 'intentd-fe', '5190');

  /** Mirror of the main-process early-startup block, on a copy of `env`. */
  function applyDevIsolation(env: NodeJS.ProcessEnv, isDev: boolean): NodeJS.ProcessEnv {
    const next = { ...env };
    if (shouldIsolateDevIntentdDataDir(next, isDev)) {
      next.INTENTD_DATA_DIR = resolveDevIntentdDataDir(APP_DATA, next);
    }
    return next;
  }

  it('connect-only dev uses the existing global daemon socket', () => {
    const env = applyDevIsolation({ DEV_PORT: '5190' }, true);
    expect(env.INTENTD_DATA_DIR).toBeUndefined();
    expect(resolveBackendConfig(env, { isDev: true })).toEqual({
      transport: 'uds',
      socketPath: defaultSocketPath({}),
    });
  });

  it('dev+sidecar with no INTENTD_* env resolves the per-port UDS socket', () => {
    const env = applyDevIsolation({ INTENTD_SIDECAR: '1', DEV_PORT: '5190' }, true);
    expect(resolveBackendConfig(env, { isDev: true })).toEqual({
      transport: 'uds',
      socketPath: path.join(PER_PORT_DIR, 'intentd.sock'),
    });
  });

  it('honours an inherited INTENTD_DATA_DIR (the monorepo `make dev` seat)', () => {
    // `make dev` pins INTENTD_DATA_DIR=<repo>/.dev/intentd; the per-port default must not
    // move the sidecar off that seat and abandon its catalog.
    const devSeat = '/repo/.dev/intentd';
    const env = applyDevIsolation(
      { INTENTD_SIDECAR: '1', DEV_PORT: '5190', INTENTD_DATA_DIR: devSeat },
      true,
    );
    expect(env.INTENTD_DATA_DIR).toBe(devSeat);
    expect(resolveBackendConfig(env, { isDev: true }).socketPath).toBe(
      path.join(devSeat, 'intentd.sock'),
    );
  });

  it('yields a distinct socket per DEV_PORT', () => {
    const first = applyDevIsolation({ INTENTD_SIDECAR: '1', DEV_PORT: '5190' }, true);
    const second = applyDevIsolation({ INTENTD_SIDECAR: '1', DEV_PORT: '5191' }, true);
    expect(resolveBackendConfig(first, { isDev: true }).socketPath).not.toBe(
      resolveBackendConfig(second, { isDev: true }).socketPath,
    );
  });

  it('leaves explicit transport overrides pointing at their own targets', () => {
    const socketEnv = applyDevIsolation(
      { DEV_PORT: '5190', INTENTD_SOCKET: '/tmp/forced.sock', INTENTD_DATA_DIR: '/legacy' },
      true,
    );
    expect(socketEnv.INTENTD_DATA_DIR).toBe('/legacy');
    expect(resolveBackendConfig(socketEnv, { isDev: true })).toEqual({
      transport: 'uds',
      socketPath: '/tmp/forced.sock',
    });

    const wsEnv = applyDevIsolation({ DEV_PORT: '5190', INTENTD_WS_URL: 'ws://h:9/ws' }, true);
    expect(wsEnv.INTENTD_DATA_DIR).toBeUndefined();
    expect(resolveBackendConfig(wsEnv, { isDev: true })).toEqual({
      transport: 'ws',
      wsUrl: 'ws://h:9/ws',
    });

    const tcpEnv = applyDevIsolation({ DEV_PORT: '5190', INTENTD_TCP: '10.0.0.1:6000' }, true);
    expect(tcpEnv.INTENTD_DATA_DIR).toBeUndefined();
    expect(resolveBackendConfig(tcpEnv, { isDev: true }).transport).toBe('tcp');
  });

  it('leaves the packaged default untouched', () => {
    const env = applyDevIsolation({ DEV_PORT: '5190' }, false);
    expect(env.INTENTD_DATA_DIR).toBeUndefined();
    expect(resolveBackendConfig(env, { isDev: false })).toEqual({
      transport: 'uds',
      socketPath: defaultSocketPath({}),
    });
  });

  it('leaves a packaged build with an inherited INTENTD_DATA_DIR untouched', () => {
    const env = applyDevIsolation({ INTENTD_DATA_DIR: '/custom/data' }, false);
    expect(env.INTENTD_DATA_DIR).toBe('/custom/data');
    expect(resolveBackendConfig(env, { isDev: false }).socketPath).toBe(
      '/custom/data/intentd.sock',
    );
  });

  it('keeps the sidecar socket resolution in lockstep with the resolver', () => {
    const env = applyDevIsolation({ INTENTD_SIDECAR: '1', DEV_PORT: '5190' }, true);
    expect(resolveSocketPath(env)).toBe(resolveBackendConfig(env, { isDev: true }).socketPath);
  });
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

  it('renders wss without leaking the token or fingerprint into logs', () => {
    expect(
      describeBackendConfig({
        transport: 'wss',
        host: '10.0.0.9',
        port: 5181,
        token: 'super-secret',
        fingerprint: 'AB:CD',
      }),
    ).toBe('wss:10.0.0.9:5181');
  });
});

describe('createBackendSocket security boundary', () => {
  it('fails closed for the unfinished legacy TCP/TLS transport', () => {
    expect(() =>
      createBackendSocket({ transport: 'tcp', host: 'remote.example', port: 6000, tls: true }),
    ).toThrow('Legacy INTENTD_TCP transport is disabled');

    expect(() =>
      createBackendSocket({ transport: 'tcp', host: 'remote.example', port: 6000, tls: false }),
    ).toThrow('Legacy INTENTD_TCP transport is disabled');
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

// Self-signed EC (P-256) cert + key, generated once with openssl and pinned
// here so the fake daemon presents a stable identity whose fingerprint the
// pinning tests can derive (via `crypto.X509Certificate`) rather than hardcode.
//   subject/issuer CN=localhost, SAN DNS:localhost + IP:127.0.0.1, 10y validity.
const WSS_CERT_PEM = Buffer.from(
  'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJtVENDQVQrZ0F3SUJBZ0lVWVlzc05zWkxXdTZXZXdkb2p6UlpFY3k0LzRzd0NnWUlLb1pJemowRUF3SXcKRkRFU01CQUdBMVVFQXd3SmJHOWpZV3hvYjNOME1CNFhEVEkyTURnd056QXhOVGt6TkZvWERUTTJNRGd3TkRBeApOVGt6TkZvd0ZERVNNQkFHQTFVRUF3d0piRzlqWVd4b2IzTjBNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBECkFRY0RRZ0FFSlkvM2I0RHdRQXAyVVdIay84SGljZEFxaVdXL0pBVnRtMkRFbmUrZ3RBa0daVmo1VGlYUDZBREkKeXltbEc0bWRWU25QVUtXS2NUYmFxT3NWZVVGd2Y2TnZNRzB3SFFZRFZSME9CQllFRk80WTZBc2c2NEJVV1RhQgo2SzBUeDgvczR2S21NQjhHQTFVZEl3UVlNQmFBRk80WTZBc2c2NEJVV1RhQjZLMFR4OC9zNHZLbU1BOEdBMVVkCkV3RUIvd1FGTUFNQkFmOHdHZ1lEVlIwUkJCTXdFWUlKYkc5allXeG9iM04waHdSL0FBQUJNQW9HQ0NxR1NNNDkKQkFNQ0EwZ0FNRVVDSVFET3hKTXBKcy9DcmQwOG95U2tGdVRueVo0c3VqVklvL3BDK1RVWUpRMEY5UUlnU2pvagppWG56RlZ0Q1U0Wll2VWFtRkc0bFNUYmlQano5QXlubWxpSkI1a289Ci0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K',
  'base64',
).toString('utf8');

const WSS_KEY_PEM = Buffer.from(
  'LS0tLS1CRUdJTiBFQyBQQVJBTUVURVJTLS0tLS0KQmdncWhrak9QUU1CQnc9PQotLS0tLUVORCBFQyBQQVJBTUVURVJTLS0tLS0KLS0tLS1CRUdJTiBFQyBQUklWQVRFIEtFWS0tLS0tCk1IY0NBUUVFSVBLTnFYZll2aEdqbDErMmNpMmEyOFZDNC9BbTVWLzBOV1JvS0cxeWlLbWFvQW9HQ0NxR1NNNDkKQXdFSG9VUURRZ0FFSlkvM2I0RHdRQXAyVVdIay84SGljZEFxaVdXL0pBVnRtMkRFbmUrZ3RBa0daVmo1VGlYUAo2QURJeXltbEc0bWRWU25QVUtXS2NUYmFxT3NWZVVGd2Z3PT0KLS0tLS1FTkQgRUMgUFJJVkFURSBLRVktLS0tLQo=',
  'base64',
).toString('utf8');

/**
 * Fake WSS daemon: an HTTPS server presenting the pinned self-signed cert with
 * a `ws` upgrade handler that mirrors `FakeWsDaemon` (one JSON envelope per text
 * frame). Records the bearer token seen on the upgrade so the auth-header test
 * can assert it.
 */
class FakeWssDaemon {
  private server!: https.Server;
  private wss!: import('ws').WebSocketServer;
  host = '127.0.0.1';
  port = 0;
  fingerprint = '';
  lastAuthHeader: string | undefined;
  lastUpgradeUrl: string | undefined;
  /** TLS sessions established (handshakes completed). */
  secureConnections = 0;
  /** Decrypted application bytes received across all TLS sessions. */
  decryptedBytes = 0;
  handler: (req: {
    id?: number | string;
    method: string;
    params?: unknown;
  }) => { result?: unknown; error?: { code: number; message: string } } | undefined = () => ({
    result: null,
  });
  private clients: import('ws').WebSocket[] = [];

  async start(): Promise<void> {
    this.fingerprint = new crypto.X509Certificate(WSS_CERT_PEM).fingerprint256;
    this.server = https.createServer({ cert: WSS_CERT_PEM, key: WSS_KEY_PEM });
    this.server.on('secureConnection', (socket) => {
      this.secureConnections += 1;
      socket.on('data', (chunk: Buffer) => {
        this.decryptedBytes += chunk.length;
      });
    });
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (socket, req) => {
      this.lastAuthHeader = req.headers.authorization;
      this.lastUpgradeUrl = req.url;
      this.clients.push(socket);
      socket.on('message', (data, isBinary) => {
        if (isBinary) return;
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        const req2 = JSON.parse(text) as { id?: number | string; method: string; params?: unknown };
        const outcome = this.handler(req2);
        if (!outcome) return;
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: req2.id, ...outcome }));
      });
    });
    await new Promise<void>((res) => this.server.listen(0, '127.0.0.1', () => res()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.terminate();
    await new Promise<void>((res) => this.wss.close(() => res()));
    await new Promise<void>((res) => this.server.close(() => res()));
  }
}

describe('WSS pinned transport (fingerprint + bearer token)', () => {
  let daemon: FakeWssDaemon;
  const TOKEN = 'a'.repeat(64);

  beforeAll(async () => {
    daemon = new FakeWssDaemon();
    await daemon.start();
  });

  afterAll(async () => {
    await daemon.stop();
  });

  afterEach(() => {
    daemon.handler = () => ({ result: null });
  });

  it('connects, pins the matching fingerprint, and speaks JSON-RPC framing', async () => {
    daemon.handler = (req) => {
      if (req.method === 'workspace.list') return { result: { workspaces: ['x'] } };
      return { error: { code: -32601, message: 'no such method' } };
    };
    const client = new JsonRpcClient({
      config: {
        transport: 'wss',
        host: daemon.host,
        port: daemon.port,
        token: TOKEN,
        fingerprint: daemon.fingerprint,
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 2000,
    });
    client.on('error', () => {});
    await expect(client.request('workspace.list')).resolves.toEqual({ workspaces: ['x'] });
    // Bearer token presented on the upgrade (PROTOCOL §2.1).
    expect(daemon.lastAuthHeader).toBe(`Bearer ${TOKEN}`);
    client.dispose();
  });

  it('pins a case/separator-variant fingerprint (normalization)', async () => {
    daemon.handler = () => ({ result: 'ok' });
    // Same fingerprint, lowercased with the colons stripped — must still match.
    const messyPin = daemon.fingerprint.replace(/:/g, '').toLowerCase();
    const client = new JsonRpcClient({
      config: {
        transport: 'wss',
        host: daemon.host,
        port: daemon.port,
        token: TOKEN,
        fingerprint: messyPin,
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 2000,
    });
    client.on('error', () => {});
    await expect(client.request('system.status')).resolves.toBe('ok');
    client.dispose();
  });

  it('rejects a fingerprint mismatch with a distinct PinMismatchError', async () => {
    const wrong = Array.from({ length: 32 }, () => 'FF').join(':');
    const client = new JsonRpcClient({
      config: {
        transport: 'wss',
        host: daemon.host,
        port: daemon.port,
        token: TOKEN,
        fingerprint: wrong,
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 2000,
      // Keep the client from re-dialing mid-assertion.
      reconnectDelayMs: 10_000,
    });
    const errors: Error[] = [];
    client.on('error', (e) => errors.push(e));
    await expect(client.request('system.status')).rejects.toBeInstanceOf(PinMismatchError);
    expect(errors.some((e) => e instanceof PinMismatchError)).toBe(true);
    const mismatch = errors.find((e): e is PinMismatchError => e instanceof PinMismatchError);
    expect(mismatch?.actual).toBe(daemon.fingerprint);
    expect(mismatch?.expected).toBe(wrong);
    expect(client.getStatus()).toBe('disconnected');
    client.dispose();
  });

  it('a mismatching pin aborts the transport before any request byte reaches the host', async () => {
    // Steady-state arm of the token-before-trust leak (monorepo#4055): the
    // pin is enforced at the TLS handshake, so the upgrade request — carrying
    // the bearer token in the Authorization header and the `?token=` query
    // fallback — is never written to a host presenting the wrong certificate.
    daemon.lastAuthHeader = 'sentinel-not-overwritten';
    daemon.lastUpgradeUrl = 'sentinel-not-overwritten';
    const before = daemon.decryptedBytes;
    const wrong = Array.from({ length: 32 }, () => 'FF').join(':');
    const client = new JsonRpcClient({
      config: {
        transport: 'wss',
        host: daemon.host,
        port: daemon.port,
        token: TOKEN,
        fingerprint: wrong,
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 2000,
      // Keep the client from re-dialing mid-assertion.
      reconnectDelayMs: 10_000,
    });
    client.on('error', () => {});
    await expect(client.request('system.status')).rejects.toBeInstanceOf(PinMismatchError);
    // Let any in-flight server-side handshake/data events settle, then assert
    // not one decrypted application byte — no upgrade request, no
    // Authorization header, no token query — reached the host. (The server may
    // or may not register the aborted session before the client tears it down,
    // so only the byte count is asserted, not the session count.)
    await new Promise((res) => setTimeout(res, 200));
    expect(daemon.decryptedBytes).toBe(before);
    expect(daemon.lastAuthHeader).toBe('sentinel-not-overwritten');
    expect(daemon.lastUpgradeUrl).toBe('sentinel-not-overwritten');
    client.dispose();
  });

  it('captureFingerprint returns the presented fingerprint for TOFU', async () => {
    const result = await captureFingerprint({
      host: daemon.host,
      port: daemon.port,
      token: TOKEN,
    });
    expect(result).toEqual({
      ok: true,
      fingerprint: daemon.fingerprint,
      connected: true,
      tokenValid: true,
    });
  });

  it('captureFingerprint without a token transmits no Authorization header and no token query', async () => {
    daemon.lastAuthHeader = 'sentinel-not-overwritten';
    daemon.lastUpgradeUrl = undefined;
    const result = await captureFingerprint({ host: daemon.host, port: daemon.port });
    expect(result).toEqual({
      ok: true,
      fingerprint: daemon.fingerprint,
      connected: true,
      tokenValid: true,
    });
    // Request-level assertion (monorepo#3782): the unauthenticated probe
    // carries no bearer header and no `?token=` query fallback.
    expect(daemon.lastAuthHeader).toBeUndefined();
    expect(daemon.lastUpgradeUrl).toBeDefined();
    expect(daemon.lastUpgradeUrl).not.toContain('token');
  });

  it('captureFingerprint surfaces a structured error when the host is unreachable', async () => {
    // 127.0.0.1:1 is guaranteed refused.
    const result = await captureFingerprint(
      { host: '127.0.0.1', port: 1, token: TOKEN },
      { timeoutMs: 1000 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('connect-failed');
  });

  it('captureFingerprint with a matching expectedFingerprint completes the authenticated upgrade', async () => {
    const result = await captureFingerprint({
      host: daemon.host,
      port: daemon.port,
      token: TOKEN,
      expectedFingerprint: daemon.fingerprint,
    });
    expect(result).toEqual({
      ok: true,
      fingerprint: daemon.fingerprint,
      connected: true,
      tokenValid: true,
    });
    expect(daemon.lastAuthHeader).toBe(`Bearer ${TOKEN}`);
  });

  it('captureFingerprint with a mismatching expectedFingerprint aborts before any request byte reaches the host', async () => {
    // TOCTOU regression (monorepo#3782): the handshake-level pin must stop the
    // upgrade request — carrying the bearer token — from ever being written to
    // a host presenting an unconfirmed certificate.
    daemon.lastAuthHeader = 'sentinel-not-overwritten';
    daemon.lastUpgradeUrl = 'sentinel-not-overwritten';
    const before = daemon.decryptedBytes;
    const secureBefore = daemon.secureConnections;
    const result = await captureFingerprint({
      host: daemon.host,
      port: daemon.port,
      token: TOKEN,
      expectedFingerprint: '11:22:33:44',
    });
    expect(result).toEqual({
      ok: false,
      code: 'fingerprint-mismatch',
      error: expect.stringContaining('certificate fingerprint mismatch'),
      actualFingerprint: normalizeFingerprint(daemon.fingerprint),
    });
    // Let any in-flight server-side handshake/data events settle, then assert
    // not one decrypted application byte — no upgrade request, no
    // Authorization header, no token query — reached the host. (The server may
    // or may not register the aborted session before the client tears it down,
    // so only the byte count is asserted exactly.)
    await new Promise((res) => setTimeout(res, 200));
    expect(daemon.secureConnections).toBeGreaterThanOrEqual(secureBefore);
    expect(daemon.decryptedBytes).toBe(before);
    expect(daemon.lastAuthHeader).toBe('sentinel-not-overwritten');
    expect(daemon.lastUpgradeUrl).toBe('sentinel-not-overwritten');
  });
});

/**
 * TLS server that REJECTS every WebSocket upgrade with a fixed HTTP status —
 * the daemon's auth-rejection shape (PROTOCOL §2.1: 401 bad token, 403 WS API
 * disabled). Presents the same pinned cert as {@link FakeWssDaemon} so only
 * the upgrade outcome differs.
 */
class RejectingWssDaemon {
  private server!: https.Server;
  host = '127.0.0.1';
  port = 0;
  fingerprint = '';
  statusCode = 401;
  /** Number of upgrade attempts observed (for reconnect-halt assertions). */
  upgradeAttempts = 0;
  lastAuthHeader: string | undefined;
  lastUpgradeUrl: string | undefined;

  async start(): Promise<void> {
    this.fingerprint = new crypto.X509Certificate(WSS_CERT_PEM).fingerprint256;
    this.server = https.createServer({ cert: WSS_CERT_PEM, key: WSS_KEY_PEM });
    this.server.on('upgrade', (req, socket) => {
      this.upgradeAttempts += 1;
      this.lastAuthHeader = req.headers.authorization;
      this.lastUpgradeUrl = req.url;
      socket.write(
        `HTTP/1.1 ${this.statusCode} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
      socket.destroy();
    });
    await new Promise<void>((res) => this.server.listen(0, '127.0.0.1', () => res()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((res) => this.server.close(() => res()));
  }
}

describe('WSS auth rejection (401/403 upgrade responses)', () => {
  let daemon: RejectingWssDaemon;
  const TOKEN = 'b'.repeat(64);

  beforeAll(async () => {
    daemon = new RejectingWssDaemon();
    await daemon.start();
  });

  afterAll(async () => {
    await daemon.stop();
  });

  function makeClient() {
    return new JsonRpcClient({
      config: {
        transport: 'wss',
        host: daemon.host,
        port: daemon.port,
        token: TOKEN,
        fingerprint: daemon.fingerprint,
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 2000,
      // Keep the client from re-dialing mid-assertion.
      reconnectDelayMs: 10_000,
    });
  }

  it('surfaces a 401 upgrade rejection as a distinct AuthRejectedError', async () => {
    daemon.statusCode = 401;
    const client = makeClient();
    const errors: Error[] = [];
    client.on('error', (e) => errors.push(e));
    await expect(client.request('system.status')).rejects.toBeInstanceOf(AuthRejectedError);
    const rejection = errors.find((e): e is AuthRejectedError => e instanceof AuthRejectedError);
    expect(rejection?.statusCode).toBe(401);
    // Not misreported as a cert-pin failure.
    expect(errors.some((e) => e instanceof PinMismatchError)).toBe(false);
    expect(client.getStatus()).toBe('disconnected');
    client.dispose();
  });

  it('surfaces a 403 upgrade rejection (WS API disabled) with its statusCode', async () => {
    daemon.statusCode = 403;
    const client = makeClient();
    const errors: Error[] = [];
    client.on('error', (e) => errors.push(e));
    await expect(client.request('system.status')).rejects.toBeInstanceOf(AuthRejectedError);
    const rejection = errors.find((e): e is AuthRejectedError => e instanceof AuthRejectedError);
    expect(rejection?.statusCode).toBe(403);
    client.dispose();
  });

  it('keeps a non-auth upgrade rejection (500) a generic transport error', async () => {
    daemon.statusCode = 500;
    const client = makeClient();
    const errors: Error[] = [];
    client.on('error', (e) => errors.push(e));
    await expect(client.request('system.status')).rejects.toThrow();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e instanceof AuthRejectedError)).toBe(false);
    expect(errors.some((e) => /unexpected server response: 500/i.test(e.message))).toBe(true);
    client.dispose();
  });

  it('classifies a 401 from a cert that fails the pin as PinMismatchError, not auth rejection', async () => {
    // A changed/intercepted endpoint can also answer 401/403 — the pin check
    // must win so the user is never steered into re-pairing (typing a fresh
    // secret) against an untrusted certificate.
    daemon.statusCode = 401;
    const wrongPin = Array.from({ length: 32 }, () => 'FF').join(':');
    const client = new JsonRpcClient({
      config: {
        transport: 'wss',
        host: daemon.host,
        port: daemon.port,
        token: TOKEN,
        fingerprint: wrongPin,
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 2000,
      reconnectDelayMs: 10_000,
    });
    const errors: Error[] = [];
    client.on('error', (e) => errors.push(e));
    await expect(client.request('system.status')).rejects.toBeInstanceOf(PinMismatchError);
    expect(errors.some((e) => e instanceof PinMismatchError)).toBe(true);
    expect(errors.some((e) => e instanceof AuthRejectedError)).toBe(false);
    client.dispose();
  });

  it('halts the automatic reconnect loop after an auth rejection', async () => {
    daemon.statusCode = 401;
    const client = new JsonRpcClient({
      config: {
        transport: 'wss',
        host: daemon.host,
        port: daemon.port,
        token: TOKEN,
        fingerprint: daemon.fingerprint,
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 2000,
      // A short delay so a (buggy) scheduled reconnect would fire within the wait.
      reconnectDelayMs: 50,
      maxReconnectDelayMs: 50,
    });
    client.on('error', () => {});
    await expect(client.request('system.status')).rejects.toBeInstanceOf(AuthRejectedError);
    const attemptsAfterRejection = daemon.upgradeAttempts;
    await new Promise((res) => setTimeout(res, 300));
    // No further upgrade attempts: the stale credential is not re-sent.
    expect(daemon.upgradeAttempts).toBe(attemptsAfterRejection);
    expect(client.getStatus()).toBe('disconnected');
    client.dispose();
  });

  it('captureFingerprint reports tokenValid: false with the status on a 401 rejection', async () => {
    daemon.statusCode = 401;
    const result = await captureFingerprint({
      host: daemon.host,
      port: daemon.port,
      token: TOKEN,
    });
    expect(result).toEqual({
      ok: true,
      fingerprint: normalizeFingerprint(daemon.fingerprint),
      connected: false,
      tokenValid: false,
      statusCode: 401,
    });
  });

  it('captureFingerprint reports tokenValid: false with the status on a 403 rejection', async () => {
    daemon.statusCode = 403;
    const result = await captureFingerprint({
      host: daemon.host,
      port: daemon.port,
      token: TOKEN,
    });
    expect(result).toEqual({
      ok: true,
      fingerprint: normalizeFingerprint(daemon.fingerprint),
      connected: false,
      tokenValid: false,
      statusCode: 403,
    });
  });

  it('captureFingerprint keeps tokenValid: true on a non-auth upgrade rejection (500)', async () => {
    daemon.statusCode = 500;
    const result = await captureFingerprint({
      host: daemon.host,
      port: daemon.port,
      token: TOKEN,
    });
    expect(result).toEqual({
      ok: true,
      fingerprint: normalizeFingerprint(daemon.fingerprint),
      connected: false,
      tokenValid: true,
      statusCode: 500,
    });
  });

  it('captureFingerprint without a token captures a rejecting host fingerprint with zero token transmission', async () => {
    // Regression (monorepo#3782): probing a changed/unknown host for its
    // fingerprint must not transmit any bearer credential — the daemon
    // rejects the unauthenticated upgrade (401), the cert is still read from
    // the TLS layer, and nothing token-shaped reaches the wire.
    daemon.statusCode = 401;
    daemon.lastAuthHeader = 'sentinel-not-overwritten';
    daemon.lastUpgradeUrl = undefined;
    const result = await captureFingerprint({ host: daemon.host, port: daemon.port });
    expect(result).toEqual({
      ok: true,
      fingerprint: normalizeFingerprint(daemon.fingerprint),
      connected: false,
      // No token was supplied, so the 401 judges no token.
      tokenValid: true,
      statusCode: 401,
    });
    expect(daemon.lastAuthHeader).toBeUndefined();
    expect(daemon.lastUpgradeUrl).toBeDefined();
    expect(daemon.lastUpgradeUrl).not.toContain('token');
  });
});

describe('normalizeFingerprint', () => {
  it('canonicalizes to colon-separated uppercase hex byte pairs', () => {
    expect(normalizeFingerprint('ab:cd:ef:01')).toBe('AB:CD:EF:01');
    expect(normalizeFingerprint('abcdef01')).toBe('AB:CD:EF:01');
    expect(normalizeFingerprint('AB CD ef 01')).toBe('AB:CD:EF:01');
    expect(normalizeFingerprint('')).toBe('');
  });
});

describe('candidateWssHosts', () => {
  it('keeps the primary host first and deduplicates the extras', () => {
    expect(
      candidateWssHosts({
        transport: 'wss',
        host: '192.168.1.10',
        hosts: [' 10.0.0.5 ', '192.168.1.10', 'fe80::1', '', '10.0.0.5'],
        port: 5181,
      }),
    ).toEqual(['192.168.1.10', '10.0.0.5', 'fe80::1']);
  });

  it('falls back to just the primary host when hosts is absent', () => {
    expect(candidateWssHosts({ transport: 'wss', host: 'h', port: 1 })).toEqual(['h']);
  });
});

describe('describeBackendConfig with candidate hosts', () => {
  it('mentions extra candidates without leaking the token or fingerprint', () => {
    const description = describeBackendConfig({
      transport: 'wss',
      host: '10.0.0.9',
      hosts: ['10.0.0.9', '192.168.1.9'],
      port: 5181,
      token: 'super-secret',
      fingerprint: 'AB:CD',
    });
    expect(description).toBe('wss:10.0.0.9:5181 (+1 candidate)');
    expect(description).not.toContain('super-secret');
    expect(description).not.toContain('AB:CD');
  });
});

/** In-memory fake candidate socket for raceDuplexSockets tests. */
class FakeCandidate extends Duplex {
  written: string[] = [];
  destroyedByRace = false;
  constructor() {
    super({ allowHalfOpen: false });
  }
  override _read(): void {}
  override _write(chunk: unknown, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    this.written.push(String(chunk));
    cb();
  }
  override _destroy(error: Error | null, cb: (err: Error | null) => void): void {
    this.destroyedByRace = true;
    cb(error);
  }
}

describe('raceDuplexSockets (multi-host racing, #1746)', () => {
  it('first candidate to connect wins; losers are destroyed', async () => {
    const a = new FakeCandidate();
    const b = new FakeCandidate();
    const facade = raceDuplexSockets([
      { host: 'a', create: () => a },
      { host: 'b', create: () => b },
    ]);
    const connected = new Promise<void>((res) => facade.once('connect', () => res()));
    b.emit('connect');
    await connected;
    expect(a.destroyedByRace).toBe(true);
    expect(b.destroyedByRace).toBe(false);

    // Writes route to the winner; inbound data flows back through the facade.
    facade.write('ping\n');
    expect(b.written).toEqual(['ping\n']);
    const received = new Promise<string>((res) =>
      facade.once('data', (chunk: Buffer) => res(chunk.toString('utf8'))),
    );
    b.push('pong\n');
    expect(await received).toBe('pong\n');
    facade.destroy();
  });

  it('a candidate failure does not lose the race while another connects', async () => {
    const a = new FakeCandidate();
    const b = new FakeCandidate();
    const facade = raceDuplexSockets([
      { host: 'a', create: () => a },
      { host: 'b', create: () => b },
    ]);
    const errors: Error[] = [];
    facade.on('error', (e) => errors.push(e));
    const connected = new Promise<void>((res) => facade.once('connect', () => res()));
    a.emit('error', new Error('ECONNREFUSED'));
    b.emit('connect');
    await connected;
    expect(errors).toHaveLength(0);
    facade.destroy();
  });

  it('fails with the last candidate error when every candidate fails', async () => {
    const a = new FakeCandidate();
    const b = new FakeCandidate();
    const facade = raceDuplexSockets([
      { host: 'a', create: () => a },
      { host: 'b', create: () => b },
    ]);
    const failed = new Promise<Error>((res) => facade.once('error', (e: Error) => res(e)));
    a.emit('error', new Error('ECONNREFUSED a'));
    b.emit('error', new Error('ECONNREFUSED b'));
    expect((await failed).message).toBe('ECONNREFUSED b');
  });

  it('continues past a pin mismatch — a later good candidate still wins (iOS model)', async () => {
    const bad = new FakeCandidate();
    const good = new FakeCandidate();
    const facade = raceDuplexSockets([
      { host: 'bad', create: () => bad },
      { host: 'good', create: () => good },
    ]);
    const errors: Error[] = [];
    facade.on('error', (e) => errors.push(e));
    const mismatchEvents: HostCertMismatch[] = [];
    facade.on('pin-mismatch', (m: HostCertMismatch) => mismatchEvents.push(m));
    const connected = new Promise<void>((res) => facade.once('connect', () => res()));
    bad.emit('error', new PinMismatchError('AA', 'BB'));
    // The mismatching candidate is counted out and torn down — not the race.
    expect(bad.destroyedByRace).toBe(true);
    expect(facade.destroyed).toBe(false);
    good.emit('connect');
    await connected;
    expect(errors).toHaveLength(0);
    // The pre-win mismatch is surfaced as a non-fatal per-host event.
    expect(mismatchEvents).toEqual([{ host: 'bad', expected: 'AA', actual: 'BB' }]);
    facade.destroy();
  });

  it('fails with an aggregated cert error listing every host when all candidates mismatch', async () => {
    const a = new FakeCandidate();
    const b = new FakeCandidate();
    const facade = raceDuplexSockets([
      { host: 'a', create: () => a },
      { host: 'b', create: () => b },
    ]);
    const failed = new Promise<Error>((res) => facade.once('error', (e: Error) => res(e)));
    a.emit('error', new PinMismatchError('AA', 'BB'));
    b.emit('error', new PinMismatchError('AA', 'CC'));
    const error = await failed;
    expect(error).toBeInstanceOf(PinMismatchError);
    const aggregate = error as PinMismatchError;
    expect(aggregate.mismatches).toEqual([
      { host: 'a', expected: 'AA', actual: 'BB' },
      { host: 'b', expected: 'AA', actual: 'CC' },
    ]);
    // expected/actual mirror the FIRST mismatch (backward compatibility).
    expect(aggregate.expected).toBe('AA');
    expect(aggregate.actual).toBe('BB');
    expect(aggregate.message).toContain('hosts: a, b');
  });

  it('prefers the aggregated cert error over a generic failure when no candidate wins', async () => {
    const mismatching = new FakeCandidate();
    const refused = new FakeCandidate();
    const facade = raceDuplexSockets([
      { host: 'mismatching', create: () => mismatching },
      { host: 'refused', create: () => refused },
    ]);
    const failed = new Promise<Error>((res) => facade.once('error', (e: Error) => res(e)));
    mismatching.emit('error', new PinMismatchError('AA', 'BB'));
    refused.emit('error', new Error('ECONNREFUSED'));
    const error = await failed;
    expect(error).toBeInstanceOf(PinMismatchError);
    expect((error as PinMismatchError).mismatches).toEqual([
      { host: 'mismatching', expected: 'AA', actual: 'BB' },
    ]);
  });

  it('prefers the cert error on race timeout when a mismatch was observed', async () => {
    const mismatching = new FakeCandidate();
    const blackhole = new FakeCandidate();
    const facade = raceDuplexSockets(
      [
        { host: 'mismatching', create: () => mismatching },
        { host: 'blackhole', create: () => blackhole },
      ],
      { timeoutMs: 50 },
    );
    const failed = new Promise<Error>((res) => facade.once('error', (e: Error) => res(e)));
    mismatching.emit('error', new PinMismatchError('AA', 'BB'));
    const error = await failed;
    expect(error).toBeInstanceOf(PinMismatchError);
    expect((error as PinMismatchError).mismatches).toEqual([
      { host: 'mismatching', expected: 'AA', actual: 'BB' },
    ]);
    expect(blackhole.destroyedByRace).toBe(true);
  });

  it('a pin mismatch AFTER a valid winner settles emits the event without tearing down the winner', async () => {
    const good = new FakeCandidate();
    const stale = new FakeCandidate();
    const facade = raceDuplexSockets([
      { host: 'good', create: () => good },
      { host: 'stale', create: () => stale },
    ]);
    const errors: Error[] = [];
    facade.on('error', (e) => errors.push(e));
    const mismatchEvents: HostCertMismatch[] = [];
    facade.on('pin-mismatch', (m: HostCertMismatch) => mismatchEvents.push(m));
    const connected = new Promise<void>((res) => facade.once('connect', () => res()));
    good.emit('connect');
    await connected;
    // A stale IP now owned by a foreign pinned daemon reports a mismatch late:
    // the established pin-verified winner must not be torn down by it, but the
    // mismatch is still surfaced as a non-fatal per-host event (not log-only).
    stale.emit('error', new PinMismatchError('AA', 'BB'));
    expect(errors).toHaveLength(0);
    expect(facade.destroyed).toBe(false);
    expect(mismatchEvents).toEqual([{ host: 'stale', expected: 'AA', actual: 'BB' }]);
    // The facade still proxies the winner.
    facade.write('ping\n');
    expect(good.written).toEqual(['ping\n']);
    facade.destroy();
  });

  it('destroys a failed candidate immediately and absorbs its later async errors', async () => {
    const failing = new FakeCandidate();
    const other = new FakeCandidate();
    const facade = raceDuplexSockets([
      { host: 'failing', create: () => failing },
      { host: 'other', create: () => other },
    ]);
    const errors: Error[] = [];
    facade.on('error', (e) => errors.push(e));
    failing.emit('error', new Error('ECONNREFUSED'));
    // The failed candidate is torn down right away, not left until settle.
    expect(failing.destroyedByRace).toBe(true);
    // A second async 'error' from the dead candidate must not become an
    // uncaught exception (zero-listener EventEmitter) nor fail the race.
    failing.emit('error', new Error('late async failure'));
    const connected = new Promise<void>((res) => facade.once('connect', () => res()));
    other.emit('connect');
    await connected;
    expect(errors).toHaveLength(0);
    facade.destroy();
  });

  it('aggregates a late mismatch from an already-counted candidate and dedupes per host', async () => {
    const flaky = new FakeCandidate();
    const refused = new FakeCandidate();
    const facade = raceDuplexSockets([
      { host: 'flaky', create: () => flaky },
      { host: 'refused', create: () => refused },
    ]);
    const mismatchEvents: HostCertMismatch[] = [];
    facade.on('pin-mismatch', (m: HostCertMismatch) => mismatchEvents.push(m));
    const failed = new Promise<Error>((res) => facade.once('error', (e: Error) => res(e)));
    // The flaky candidate is counted out on a generic error first…
    flaky.emit('error', new Error('read ECONNRESET'));
    expect(flaky.destroyedByRace).toBe(true);
    // …then surfaces the pin mismatch late, while the race is undecided: it
    // must still be folded into the aggregate, and a repeat must not
    // double-report the host.
    flaky.emit('error', new PinMismatchError('AA', 'BB'));
    flaky.emit('error', new PinMismatchError('AA', 'BB'));
    refused.emit('error', new Error('ECONNREFUSED'));
    const error = await failed;
    expect(error).toBeInstanceOf(PinMismatchError);
    expect((error as PinMismatchError).mismatches).toEqual([
      { host: 'flaky', expected: 'AA', actual: 'BB' },
    ]);
    expect(mismatchEvents).toEqual([{ host: 'flaky', expected: 'AA', actual: 'BB' }]);
  });

  it('times out when no candidate ever connects', async () => {
    const a = new FakeCandidate();
    const facade = raceDuplexSockets([{ host: 'a', create: () => a }], { timeoutMs: 50 });
    const failed = new Promise<Error>((res) => facade.once('error', (e: Error) => res(e)));
    expect((await failed).message).toContain('timed out');
    expect(a.destroyedByRace).toBe(true);
  });

  it('fails when every attempt factory throws synchronously', async () => {
    const facade = raceDuplexSockets([
      {
        host: 'a',
        create: () => {
          throw new Error('boom');
        },
      },
    ]);
    const failed = new Promise<Error>((res) => facade.once('error', (e: Error) => res(e)));
    expect((await failed).message).toBe('boom');
  });
});

describe('tunnelRaceAttempt (tailcat tunnel candidate)', () => {
  const wssConfig = {
    transport: 'wss' as const,
    host: '10.0.0.9',
    port: 5181,
    token: 't',
    fingerprint: 'AB:CD',
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null without a tcAddress (direct-only race unchanged)', () => {
    expect(tunnelRaceAttempt(wssConfig)).toBeNull();
  });

  it('returns null when the tailcat binary is unavailable (fail-soft)', () => {
    vi.stubEnv('TAILCAT_BIN', path.join(os.tmpdir(), 'definitely-missing-tailcat'));
    // Force resolution away from any staged dev binary by also making the
    // packaged/dev probes fail: an empty resourcesPath and a cwd walk from
    // tmp never find resources/tailcat.
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    try {
      expect(tunnelRaceAttempt({ ...wssConfig, tcAddress: 'tc.example.ts.net' })).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('builds a tunnel attempt labeled with the pseudo-host when binary + tcAddress exist', () => {
    // Any existing file satisfies the TAILCAT_BIN existence probe; the
    // attempt is not dialed in this test.
    vi.stubEnv('TAILCAT_BIN', __filename);
    const attempt = tunnelRaceAttempt({ ...wssConfig, tcAddress: 'tc.example.ts.net' });
    expect(attempt).not.toBeNull();
    expect(attempt!.host).toBe(TUNNEL_RACE_HOST);
    expect(typeof attempt!.create).toBe('function');
  });
});

describe('captureFingerprint through the tailcat tunnel (tc-address host)', () => {
  let daemon: FakeWssDaemon;
  const TOKEN = 'c'.repeat(64);

  /**
   * Fake tailcat child: instead of dialing the tc mesh, relays its stdio to
   * the FakeWssDaemon's TLS port — the same pipe topology the real client
   * binary provides, so the forwarder-loopback capture path runs end to end.
   */
  class FakeRelayChild extends EventEmitter {
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    killed = false;
    constructor(remotePort: number) {
      super();
      const socket = net.connect(remotePort, '127.0.0.1');
      this.stdin.pipe(socket);
      socket.pipe(this.stdout);
      this.once('exit', () => socket.destroy());
    }
    kill(): boolean {
      this.killed = true;
      this.emit('exit', 0);
      return true;
    }
  }

  beforeAll(async () => {
    daemon = new FakeWssDaemon();
    await daemon.start();
  });

  afterAll(async () => {
    await daemon.stop();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails structured (connect-failed) when the tailcat binary is unavailable', async () => {
    vi.stubEnv('TAILCAT_BIN', path.join(os.tmpdir(), 'definitely-missing-tailcat'));
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    try {
      const result = await captureFingerprint({ host: 'tc-key-abc', port: daemon.port });
      expect(result).toEqual({
        ok: false,
        code: 'connect-failed',
        error: expect.stringContaining('tailcat binary unavailable'),
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('captures via the loopback forwarder, lowercases the dialed tc address, and closes the tunnel', async () => {
    vi.stubEnv('TAILCAT_BIN', __filename);
    const children: FakeRelayChild[] = [];
    const spawnArgs: string[][] = [];
    const result = await captureFingerprint(
      // Hand-typed uppercase form: the dial must normalize it.
      { host: '  TC-KEY-ABC  ', port: daemon.port, token: TOKEN },
      {
        tailcatSpawn: (_command, args) => {
          spawnArgs.push(args);
          const child = new FakeRelayChild(daemon.port);
          children.push(child);
          return child as unknown as ChildProcess;
        },
      },
    );
    expect(result).toEqual({
      ok: true,
      fingerprint: daemon.fingerprint,
      connected: true,
      tokenValid: true,
    });
    // The forwarder spawned exactly one relay with the normalized address and
    // the daemon's port, and the finally-block teardown killed it.
    expect(spawnArgs).toEqual([['tc-key-abc', String(daemon.port)]]);
    expect(children).toHaveLength(1);
    expect(children[0].killed).toBe(true);
  });

  it('keeps the pin enforced across the loopback re-target: a mismatch never leaks the token', async () => {
    vi.stubEnv('TAILCAT_BIN', __filename);
    daemon.lastAuthHeader = 'sentinel-not-overwritten';
    const before = daemon.decryptedBytes;
    const wrong = Array.from({ length: 32 }, () => 'FF').join(':');
    const result = await captureFingerprint(
      { host: 'tc-key-abc', port: daemon.port, token: TOKEN, expectedFingerprint: wrong },
      {
        tailcatSpawn: () => new FakeRelayChild(daemon.port) as unknown as ChildProcess,
      },
    );
    expect(result).toEqual({
      ok: false,
      code: 'fingerprint-mismatch',
      error: expect.any(String),
      actualFingerprint: daemon.fingerprint,
    });
    // No decrypted application byte — no upgrade request, no Authorization
    // header — reached the daemon through the tunnel (monorepo#3782 TOCTOU).
    await new Promise((res) => setTimeout(res, 200));
    expect(daemon.decryptedBytes).toBe(before);
    expect(daemon.lastAuthHeader).toBe('sentinel-not-overwritten');
  });
});

describe('multi-host wss connect through JsonRpcClient (#1746)', () => {
  let daemon: FakeWssDaemon;
  const TOKEN = 'b'.repeat(64);

  beforeAll(async () => {
    daemon = new FakeWssDaemon();
    await daemon.start();
  });

  afterAll(async () => {
    await daemon.stop();
  });

  it('connects via a secondary candidate when the primary host is unreachable', async () => {
    daemon.handler = () => ({ result: 'ok' });
    const client = new JsonRpcClient({
      config: {
        transport: 'wss',
        // Primary host is a blackhole (RFC 5737 TEST-NET-1) — only the
        // secondary candidate (the real daemon) can answer.
        host: '192.0.2.1',
        hosts: ['192.0.2.1', daemon.host],
        port: daemon.port,
        token: TOKEN,
        fingerprint: daemon.fingerprint,
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 5000,
    });
    client.on('error', () => {});
    await expect(client.request('system.status')).resolves.toBe('ok');
    client.dispose();
  });

  it('a fingerprint mismatch on a candidate surfaces as PinMismatchError, not a skip', async () => {
    const wrong = Array.from({ length: 32 }, () => 'FF').join(':');
    const client = new JsonRpcClient({
      config: {
        transport: 'wss',
        host: '192.0.2.1',
        hosts: ['192.0.2.1', daemon.host],
        port: daemon.port,
        token: TOKEN,
        fingerprint: wrong,
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: 5000,
      reconnectDelayMs: 10_000,
    });
    const errors: Error[] = [];
    client.on('error', (e) => errors.push(e));
    await expect(client.request('system.status')).rejects.toBeInstanceOf(PinMismatchError);
    expect(errors.some((e) => e instanceof PinMismatchError)).toBe(true);
    client.dispose();
  });
});
