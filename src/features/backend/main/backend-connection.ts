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
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket as WsWebSocket } from 'ws';

import { shouldSpawnSidecar } from './intentd-spawn-policy';
import { defaultWindowsSocketPath, toLocalEndpoint, windowsPipeName } from './intentd-pipe-name';

// The `ws` package is CJS and the vitest suite aliases the ESM import to a
// browser-safe stub (see `vitest.config.ts`); `createRequire` sidesteps both.
const nodeRequire = createRequire(import.meta.url);
const { WebSocket: NodeWebSocket } = nodeRequire('ws') as {
  WebSocket: typeof import('ws').WebSocket;
};

/** Resolved connection target for the backend transport. */
export interface BackendConnectionConfig {
  transport: 'uds' | 'tcp' | 'ws' | 'wss';
  /** UDS socket path (when `transport === 'uds'`). */
  socketPath?: string;
  /** Host (when `transport === 'tcp'` or `'wss'`). */
  host?: string;
  /** Port (when `transport === 'tcp'` or `'wss'`). */
  port?: number;
  /** Use TLS for the TCP transport (remote). Defaults to true for TCP. */
  tls?: boolean;
  /** Full `ws://…` URL (when `transport === 'ws'`); `/ws` is added if missing. */
  wsUrl?: string;
  /**
   * Bearer token for the `wss` transport (PROTOCOL §2.1), presented on the
   * WebSocket upgrade via the `Authorization` header (with a `?token=` query
   * fallback).
   */
  token?: string;
  /**
   * Pinned self-signed certificate SHA-256 fingerprint for the `wss` transport
   * (PROTOCOL §1.2), colon-separated uppercase hex. Every connect verifies the
   * presented cert against this pin; a mismatch fails with {@link PinMismatchError}.
   */
  fingerprint?: string;
}

/** Options for [[resolveBackendConfig]]. */
export interface ResolveBackendConfigOptions {
  /**
   * `true` when running an unpackaged/dev Electron build. When no env override
   * is present and this flag is set, the resolver picks the loopback dev
   * WebSocket default (`ws://127.0.0.1:5181/ws`).
   */
  isDev?: boolean;
  /** Platform override for tests; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
}

/**
 * Default local connect target for the running intentd daemon.
 *
 * Honors `INTENTD_DATA_DIR` (socket = `$INTENTD_DATA_DIR/intentd.sock`) so the
 * FE connects to the same socket the sidecar spawned intentd with. On win32
 * the daemon serves a named pipe derived from the socket path, so this
 * returns the pipe name (see `intentd-pipe-name.ts` for the contract); the
 * no-data-dir default mirrors the daemon's `%APPDATA%\intentd\data`.
 */
export function defaultSocketPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const dataDir = env.INTENTD_DATA_DIR?.trim();
  if (platform === 'win32') {
    const socketPath = dataDir
      ? path.win32.join(dataDir, 'intentd.sock')
      : defaultWindowsSocketPath(env);
    return windowsPipeName(socketPath);
  }
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
  const platform = opts.platform ?? process.platform;
  const socketOverride = env.INTENTD_SOCKET?.trim();
  if (socketOverride) {
    // On win32 a `.sock` override maps to its derived named pipe; explicit
    // pipe paths (`\\.\pipe\…`) pass through unchanged.
    return { transport: 'uds', socketPath: toLocalEndpoint(socketOverride, platform) };
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
      return { transport: 'uds', socketPath: defaultSocketPath(env, platform) };
    }
    return { transport: 'ws', wsUrl: DEFAULT_DEV_WS_URL };
  }
  return { transport: 'uds', socketPath: defaultSocketPath(env, platform) };
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
 * UDS, the loopback `ws://` transport, and the pinned `wss://` remote transport
 * (self-signed-cert fingerprint pinning + bearer token, see
 * {@link createWssSocket}) are fully supported. The legacy TCP/TLS branch
 * remains a remote-transport stub: it opens a (optionally TLS) socket but does
 * NOT implement the `/ws` handshake, so remote framing beyond a raw
 * newline-delimited stream is out of scope.
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
  if (config.transport === 'wss') {
    return createWssSocket(config);
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
  // Deliberately omit the token and fingerprint — this string reaches logs.
  if (config.transport === 'wss') return `wss:${config.host}:${config.port}`;
  return `tcp:${config.host}:${config.port}${config.tls ? ' (tls)' : ''}`;
}

/**
 * Raised when a `wss` peer presents a certificate whose SHA-256 fingerprint
 * does not match the pinned value (PROTOCOL §1.2). Distinct from a generic
 * connect failure so the switch/UI layer can surface the "certificate changed"
 * failure modal instead of a transient reconnect.
 */
export class PinMismatchError extends Error {
  /** Pinned fingerprint (colon-hex uppercase). */
  readonly expected: string;
  /** Fingerprint the peer actually presented (colon-hex uppercase). */
  readonly actual: string;
  constructor(expected: string, actual: string) {
    super(
      `certificate fingerprint mismatch: expected ${expected || '(none)'}, got ${actual || '(none)'}`,
    );
    this.name = 'PinMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Normalize a certificate SHA-256 fingerprint to the daemon's canonical form
 * (PROTOCOL §1.2): colon-separated **uppercase** hex byte pairs. Accepts any
 * mix of case and separators (Node's `fingerprint256` is already colon-hex
 * uppercase, but a user-pasted or persisted pin may not be), so both sides of
 * a pin comparison can be run through it before an exact string match.
 */
export function normalizeFingerprint(fingerprint: string): string {
  const hex = fingerprint.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hex.match(/.{2}/g)?.join(':') ?? '';
}

/**
 * Build the daemon's `wss://<host>:<port>/ws` upgrade URL, bracketing a bare
 * IPv6 host and optionally appending the `?token=` query fallback (PROTOCOL
 * §2.1 checks the header first, then the query).
 */
function formatWssUrl(host: string, port: number, token?: string): string {
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const base = `wss://${authority}:${port}/ws`;
  if (!token) return base;
  const url = new URL(base);
  url.searchParams.set('token', token);
  return url.toString();
}

/** Read the peer cert fingerprint (normalized) from an upgrade/response socket. */
function peerFingerprint(response: IncomingMessage): string {
  const socket = response.socket as tls.TLSSocket;
  const cert = socket.getPeerCertificate?.();
  return normalizeFingerprint(cert?.fingerprint256 ?? '');
}

/**
 * Connect the pinned `wss` transport: open the TLS WebSocket with
 * `rejectUnauthorized: false` (the daemon's cert is self-signed, PROTOCOL
 * §1.2) and **manually verify** the presented cert's fingerprint against the
 * config pin on the upgrade handshake — before any application data flows. A
 * mismatch destroys the stream with a {@link PinMismatchError}; a match hands
 * the connection to the shared {@link WebSocketDuplex} newline framing adapter.
 * The bearer token is sent via the `Authorization` header (PROTOCOL §2.1) with
 * a `?token=` query fallback.
 */
function createWssSocket(config: BackendConnectionConfig): Duplex {
  const { host, port, token, fingerprint } = config;
  if (!host || !port) throw new Error('WSS transport requires host and port');
  if (!token) throw new Error('WSS transport requires a token');
  if (!fingerprint) throw new Error('WSS transport requires a pinned fingerprint');
  const expected = normalizeFingerprint(fingerprint);

  const ws = new NodeWebSocket(formatWssUrl(host, port, token), {
    rejectUnauthorized: false,
    headers: { Authorization: `Bearer ${token}` },
  });
  const duplex = new WebSocketDuplex(ws);
  ws.on('upgrade', (response: IncomingMessage) => {
    const actual = peerFingerprint(response);
    if (actual !== expected) {
      // Destroy through the duplex so the JSON-RPC client observes a single
      // `error` (then `close`) — the same failure path every transport uses.
      duplex.destroy(new PinMismatchError(expected, actual));
    }
  });
  return duplex;
}

/** Successful trust-on-first-use capture: the presented cert's fingerprint. */
export interface CaptureFingerprintOk {
  ok: true;
  /** Presented cert SHA-256 fingerprint, colon-hex uppercase (PROTOCOL §1.2). */
  fingerprint: string;
}

/** Failed trust-on-first-use capture, with a machine-readable reason. */
export interface CaptureFingerprintError {
  ok: false;
  code: 'no-certificate' | 'connect-failed' | 'timeout';
  error: string;
}

export type CaptureFingerprintResult = CaptureFingerprintOk | CaptureFingerprintError;

/**
 * Trust-on-first-use helper: open a `wss` connection to `{host, port}` with
 * `rejectUnauthorized: false`, read the presented self-signed cert's SHA-256
 * fingerprint (PROTOCOL §1.2), then close. Returns the normalized fingerprint
 * for the user to confirm, or a structured error. The bearer token is sent so
 * the capture exercises the real upgrade path; the fingerprint is still read
 * from the TLS layer even when the token is rejected (401 → unexpected
 * response), so a bad token surfaces at pinned-connect time rather than hiding
 * the cert here.
 */
export function captureFingerprint(
  target: { host: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CaptureFingerprintResult> {
  const { host, port, token } = target;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return new Promise<CaptureFingerprintResult>((resolve) => {
    let settled = false;
    const ws = new NodeWebSocket(formatWssUrl(host, port, token), {
      rejectUnauthorized: false,
      headers: { Authorization: `Bearer ${token}` },
    });
    const finish = (result: CaptureFingerprintResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        // ignore teardown errors
      }
      resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          code: 'timeout',
          error: `fingerprint capture timed out after ${timeoutMs}ms`,
        }),
      timeoutMs,
    );
    timer.unref?.();
    const readCert = (response: IncomingMessage): void => {
      const fingerprint = peerFingerprint(response);
      if (!fingerprint) {
        finish({ ok: false, code: 'no-certificate', error: 'server presented no certificate' });
        return;
      }
      finish({ ok: true, fingerprint });
    };
    ws.on('upgrade', readCert);
    ws.on('unexpected-response', (_req, response: IncomingMessage) => readCert(response));
    ws.on('error', (err: Error) =>
      finish({ ok: false, code: 'connect-failed', error: err.message }),
    );
  });
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
