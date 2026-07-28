/**
 * Connection-target resolution and the default socket factory for the live
 * backend transport.
 *
 * Local dev normally talks to intentd over a plain WebSocket on loopback; the
 * packaged app stays on the Unix Domain Socket. The target is configurable via
 * environment variables so the same client works in every posture:
 *   - `INTENTD_SOCKET=/path/to.sock` → force UDS (highest precedence).
 *   - `INTENTD_WS_URL=ws://host:port[/ws]` → plain WebSocket to that URL.
 *   - `INTENTD_TCP=host:port` → legacy TCP (optionally TLS) stub, unchanged.
 *   - dev build (see [[ResolveBackendConfigOptions.isDev]]) with the sidecar
 *     spawn policy in effect (INTENTD_SIDECAR=1, no transport override) →
 *     UDS at `defaultSocketPath(env)` (honors `INTENTD_DATA_DIR`), matching
 *     the socket the sidecar spawns intentd on.
 *   - dev build with no sidecar and no env override → `ws://127.0.0.1:5181/ws`
 *     (loopback, no TLS, no token) — the two-terminal `dev-daemon + run-fe`
 *     flow.
 *   - packaged build with no env override → the default dev UDS path.
 *
 * The dev+sidecar branch reuses [[shouldSpawnSidecar]] rather than duplicating
 * env-string logic so the resolver and the spawn policy can never diverge on
 * whether to connect over UDS or the loopback WebSocket.
 *
 * The daemon's WebSocket endpoint at `/ws` frames JSON-RPC as one message per
 * text frame (`intent-transport/src/ws.rs::connection_loop`). The
 * main-process JSON-RPC client speaks newline-delimited JSON over a duplex
 * stream, so [[createBackendSocket]] wraps the `ws.WebSocket` in a small
 * adapter that translates between the two framings.
 */
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { Duplex } from 'node:stream';
import { createRequire } from 'node:module';
import type { RawData, WebSocket as WsWebSocket } from 'ws';

import { shouldSpawnSidecar } from './intentd-spawn-policy';

// The `ws` package is CJS and the vitest suite aliases the ESM import to a
// browser-safe stub (see `vitest.config.ts`); `createRequire` sidesteps both.
const nodeRequire = createRequire(import.meta.url);
const { WebSocket: NodeWebSocket } = nodeRequire('ws') as {
  WebSocket: typeof import('ws').WebSocket;
};

/** Resolved connection target for the backend transport. */
export interface BackendConnectionConfig {
  transport: 'uds' | 'tcp' | 'ws';
  /** UDS socket path (when `transport === 'uds'`). */
  socketPath?: string;
  /** Host (when `transport === 'tcp'`). */
  host?: string;
  /** Port (when `transport === 'tcp'`). */
  port?: number;
  /** Use TLS for the TCP transport (remote). Defaults to true for TCP. */
  tls?: boolean;
  /** Full `ws://…` URL (when `transport === 'ws'`); `/ws` is added if missing. */
  wsUrl?: string;
}

/** Options for [[resolveBackendConfig]]. */
export interface ResolveBackendConfigOptions {
  /**
   * `true` when running an unpackaged/dev Electron build. When no env override
   * is present and this flag is set, the resolver picks the loopback dev
   * WebSocket default (`ws://127.0.0.1:5181/ws`).
   */
  isDev?: boolean;
}

/**
 * Default dev UDS path for the running intentd daemon.
 *
 * Honors `INTENTD_DATA_DIR` (socket = `$INTENTD_DATA_DIR/intentd.sock`) so the
 * FE connects to the same socket the sidecar spawned intentd with.
 */
export function defaultSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  const dataDir = env.INTENTD_DATA_DIR?.trim();
  if (dataDir) {
    return path.join(dataDir, 'intentd.sock');
  }
  // i18n-ignore (filesystem path)
  return path.join(os.homedir(), 'Library', 'Application Support', 'intentd', 'intentd.sock');
}

/** Default dev WebSocket URL (loopback, no TLS, no token). */
export const DEFAULT_DEV_WS_URL = 'ws://127.0.0.1:5181/ws';

/** Resolve the connection target from environment variables (with dev default). */
export function resolveBackendConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts: ResolveBackendConfigOptions = {},
): BackendConnectionConfig {
  const socketOverride = env.INTENTD_SOCKET?.trim();
  if (socketOverride) {
    return { transport: 'uds', socketPath: socketOverride };
  }
  const wsUrl = env.INTENTD_WS_URL?.trim();
  if (wsUrl) {
    return { transport: 'ws', wsUrl: normalizeWsUrl(wsUrl) };
  }
  const tcp = env.INTENTD_TCP?.trim();
  if (tcp) {
    const lastColon = tcp.lastIndexOf(':');
    const host = lastColon > 0 ? tcp.slice(0, lastColon) : '127.0.0.1';
    const port = Number(lastColon > 0 ? tcp.slice(lastColon + 1) : tcp);
    return { transport: 'tcp', host, port, tls: env.INTENTD_TCP_INSECURE !== '1' };
  }
  if (opts.isDev) {
    // Dev builds default to the loopback WebSocket for the two-terminal flow
    // (`make dev-daemon` + `make run-fe`). When the sidecar spawn policy is
    // in effect (`INTENTD_SIDECAR=1`, no transport override — the one-command
    // `make dev` flow) intentd runs as our sidecar on its UDS socket, so we
    // must connect there instead of ECONNREFUSEing 127.0.0.1:5181. Deriving
    // the decision from `shouldSpawnSidecar` keeps the resolver and the
    // spawn-policy in lockstep (see the pinning test in
    // `backend-connection.test.ts`).
    if (shouldSpawnSidecar(env, /* isPackaged */ false).shouldSpawn) {
      return { transport: 'uds', socketPath: defaultSocketPath(env) };
    }
    return { transport: 'ws', wsUrl: DEFAULT_DEV_WS_URL };
  }
  return { transport: 'uds', socketPath: defaultSocketPath(env) };
}

/**
 * Add the daemon's `/ws` upgrade path when the caller only supplied a host+port
 * URL. `resolveBackendConfig` normalises the value on the way in so
 * [[describeBackendConfig]] and [[createBackendSocket]] both see the final URL.
 */
function normalizeWsUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.pathname === '' || url.pathname === '/') {
      url.pathname = '/ws';
    }
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * Create a connected stream for the given config.
 *
 * UDS and the loopback `ws://` transport are fully supported. The TCP/TLS
 * branch remains a remote-transport stub: it opens a (optionally TLS) socket
 * but does NOT implement the WSS `/ws` handshake, so remote framing beyond a
 * raw newline-delimited stream is out of scope.
 */
export function createBackendSocket(config: BackendConnectionConfig): Duplex {
  if (config.transport === 'uds') {
    if (!config.socketPath) throw new Error('UDS transport requires a socketPath');
    return net.connect({ path: config.socketPath });
  }
  if (config.transport === 'ws') {
    if (!config.wsUrl) throw new Error('WS transport requires a wsUrl');
    return new WebSocketDuplex(new NodeWebSocket(config.wsUrl));
  }
  if (!config.host || !config.port) {
    throw new Error('TCP transport requires host and port');
  }
  // Remote transport stub: TLS-with-pinning and the WSS handshake are deferred.
  // Certificate validation stays at the Node default (rejectUnauthorized: true).
  if (config.tls) {
    return tls.connect({
      host: config.host,
      port: config.port,
    });
  }
  return net.connect({ host: config.host, port: config.port });
}

/** Human-readable description of a connection target (for logs). */
export function describeBackendConfig(config: BackendConnectionConfig): string {
  if (config.transport === 'uds') return `uds:${config.socketPath}`;
  if (config.transport === 'ws') return `ws:${config.wsUrl}`;
  return `tcp:${config.host}:${config.port}${config.tls ? ' (tls)' : ''}`;
}

/**
 * Adapt an `ws.WebSocket` to a newline-delimited `Duplex` stream so the shared
 * JSON-RPC client can drive UDS and loopback WebSocket transports through the
 * same read/write path.
 *
 * - **Outbound (write)** — the caller writes newline-delimited JSON; each
 *   complete line becomes one WebSocket text frame (daemon `process_frame`
 *   expects one JSON envelope per frame).
 * - **Inbound (read)** — each incoming text frame is pushed as `<frame>\n` so
 *   the caller's newline splitter yields exactly one JSON envelope per push.
 * - Bubbles `open`/`error`/`close` from the underlying socket via `connect`,
 *   `error`, and stream end respectively.
 */
export class WebSocketDuplex extends Duplex {
  private readonly ws: WsWebSocket;
  private writeBuffer = '';
  // Named to avoid clashing with `Duplex.closed` (public in Node's types).
  private wsClosed = false;

  constructor(ws: WsWebSocket) {
    super({ allowHalfOpen: false });
    this.ws = ws;
    ws.on('open', () => this.emit('connect'));
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return;
      const text = Array.isArray(data)
        ? Buffer.concat(data as Buffer[]).toString('utf8')
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString('utf8')
            : String(data);
      this.push(`${text}\n`);
    });
    ws.on('error', (err: Error) => {
      if (this.wsClosed) return;
      this.emit('error', err);
    });
    ws.on('close', () => {
      if (this.wsClosed) return;
      this.wsClosed = true;
      this.push(null);
    });
  }

  override _read(_size: number): void {
    // Backpressure is handled by the ws socket itself; nothing to pull.
  }

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text =
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk);
    this.writeBuffer += text;
    const lines = this.writeBuffer.split('\n');
    this.writeBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length === 0) continue;
      if (this.ws.readyState !== NodeWebSocket.OPEN) {
        callback(new Error('WebSocket is not open'));
        return;
      }
      try {
        this.ws.send(line);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
    callback();
  }

  override _destroy(error: Error | null, callback: (err: Error | null) => void): void {
    this.wsClosed = true;
    try {
      this.ws.terminate();
    } catch {
      // ignore teardown errors
    }
    callback(error);
  }
}
