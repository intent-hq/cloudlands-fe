/**
 * TunnelManager — loopback port forwarding over the daemon's `/tunnel`
 * WebSocket (intent-hq/monorepo#2323, tunneling fallback).
 *
 * When hostname rewriting cannot reach a daemon-host port (server bound to
 * `127.0.0.1`, firewall), the embedded browser instead loads
 * `http://127.0.0.1:<localPort>` where `<localPort>` is a client-loopback
 * listener whose accepted sockets are multiplexed as streams over ONE
 * authenticated WebSocket to the daemon's `/tunnel` route. The daemon
 * connects each stream to `127.0.0.1:<remotePort>` on its own loopback
 * (`intent-transport/src/tunnel.rs`).
 *
 * Frame contract (frozen by the landed intentd implementation): each binary
 * WebSocket message is one mux frame `[opcode u8][streamId u32 BE][payload]`
 * — the WebSocket provides message boundaries, so no length prefix.
 *
 * | opcode | name       | payload       | direction       |
 * |--------|------------|---------------|-----------------|
 * | 0x01   | `OPEN`     | port `u16` BE | client → daemon |
 * | 0x02   | `OPEN_OK`  | (empty)       | daemon → client |
 * | 0x03   | `OPEN_ERR` | UTF-8 message | daemon → client |
 * | 0x04   | `DATA`     | raw bytes     | both            |
 * | 0x05   | `EOF`      | (empty)       | both            |
 * | 0x06   | `CLOSE`    | (empty)       | both            |
 *
 * Lifecycle: `ensureTunnel()` lazily opens the single `/tunnel` socket,
 * reusing the active transport's URL/token (and cert pin for `wss`). A `wss`
 * config with multiple candidate hosts (#1746) races one socket per candidate
 * — first pin-verified `open` wins, losers are terminated — mirroring the
 * JSON-RPC transport's multi-host connect.
 * `forwardPort(remotePort)` resolves with the ephemeral local port of a
 * `net.createServer` on `127.0.0.1`. Each accepted connection allocates a
 * streamId, sends `OPEN`, and relays bytes both ways once `OPEN_OK` arrives
 * (`OPEN_ERR` destroys the local socket; a definitively connection-refused
 * `OPEN_ERR` additionally drops the whole forward — the daemon-side server is
 * gone — so the next `forwardPort()` recreates it fresh). Backpressure pauses
 * local sockets against `ws.bufferedAmount`; forwards live until explicitly
 * closed (`closeForward`), the backend switches (`dispose()`), or the app
 * quits — there is no idle sweep. A tunnel drop destroys in-flight streams
 * but keeps every forward's local listener (and its local port) open; the
 * next accepted connection reconnects the tunnel lazily and relays through
 * the fresh socket.
 */
import net from 'node:net';
import { createRequire } from 'node:module';
import type { IncomingMessage } from 'node:http';
import tls from 'node:tls';

import { Logger } from '$shared/logger';
import {
  AuthRejectedError,
  candidateWssHosts,
  normalizeFingerprint,
  PinMismatchError,
  type BackendConnectionConfig,
} from './backend-connection';

const logger = new Logger('TunnelManager');

// The `ws` package is CJS and the vitest suite aliases the ESM import to a
// browser-safe stub (see `vitest.config.ts`); `createRequire` sidesteps both.
const nodeRequire = createRequire(import.meta.url);
const { WebSocket: NodeWebSocket } = nodeRequire('ws') as {
  WebSocket: typeof import('ws').WebSocket;
};

/** `OPEN` — ask the daemon to connect `127.0.0.1:<port>` (payload: port u16 BE). */
export const OP_OPEN = 0x01;
/** `OPEN_OK` — the daemon-side TCP connect succeeded (no payload). */
export const OP_OPEN_OK = 0x02;
/** `OPEN_ERR` — the connect failed / was refused (payload: UTF-8 message). */
export const OP_OPEN_ERR = 0x03;
/** `DATA` — raw stream bytes (payload may be empty). */
export const OP_DATA = 0x04;
/** `EOF` — half-close: no more data in the sender's direction (no payload). */
export const OP_EOF = 0x05;
/** `CLOSE` — full stream teardown (no payload). */
export const OP_CLOSE = 0x06;

/** Frame header length: opcode (1 byte) + streamId (4 bytes, big-endian). */
export const HEADER_LEN = 5;

/**
 * Largest `DATA` payload the daemon accepts per frame
 * (`intent-transport::tunnel::MAX_DATA_PAYLOAD_BYTES`); larger local reads
 * are split across multiple frames.
 */
export const MAX_DATA_PAYLOAD_BYTES = 1024 * 1024;

/** One decoded mux frame (`[opcode u8][streamId u32 BE][payload]`). */
export type TunnelFrame =
  | { type: 'open'; streamId: number; port: number }
  | { type: 'openOk'; streamId: number }
  | { type: 'openErr'; streamId: number; message: string }
  | { type: 'data'; streamId: number; payload: Buffer }
  | { type: 'eof'; streamId: number }
  | { type: 'close'; streamId: number };

/** Encode a frame into its `[opcode u8][streamId u32 BE][payload]` wire form. */
export function encodeFrame(frame: TunnelFrame): Buffer {
  const build = (opcode: number, streamId: number, payload: Buffer): Buffer => {
    const header = Buffer.allocUnsafe(HEADER_LEN);
    header.writeUInt8(opcode, 0);
    header.writeUInt32BE(streamId >>> 0, 1);
    return payload.length > 0 ? Buffer.concat([header, payload]) : header;
  };
  switch (frame.type) {
    case 'open': {
      const port = Buffer.allocUnsafe(2);
      port.writeUInt16BE(frame.port, 0);
      return build(OP_OPEN, frame.streamId, port);
    }
    case 'openOk':
      return build(OP_OPEN_OK, frame.streamId, Buffer.alloc(0));
    case 'openErr':
      return build(OP_OPEN_ERR, frame.streamId, Buffer.from(frame.message, 'utf8'));
    case 'data':
      return build(OP_DATA, frame.streamId, frame.payload);
    case 'eof':
      return build(OP_EOF, frame.streamId, Buffer.alloc(0));
    case 'close':
      return build(OP_CLOSE, frame.streamId, Buffer.alloc(0));
  }
}

/** Raised by [[decodeFrame]] on a malformed wire frame. */
export class FrameDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameDecodeError';
  }
}

/**
 * Decode one wire frame. Rejects short buffers, unknown opcodes, wrong `OPEN`
 * payload sizes, and payloads on payload-less opcodes — mirroring the daemon
 * codec's `FrameError` cases.
 */
export function decodeFrame(bytes: Buffer): TunnelFrame {
  if (bytes.length < HEADER_LEN) {
    throw new FrameDecodeError(`frame shorter than the ${HEADER_LEN}-byte header`);
  }
  const opcode = bytes.readUInt8(0);
  const streamId = bytes.readUInt32BE(1);
  const payload = bytes.subarray(HEADER_LEN);
  switch (opcode) {
    case OP_OPEN:
      if (payload.length !== 2) {
        throw new FrameDecodeError('OPEN payload must be exactly 2 bytes (port)');
      }
      return { type: 'open', streamId, port: payload.readUInt16BE(0) };
    case OP_OPEN_OK:
      if (payload.length > 0) throw new FrameDecodeError('OPEN_OK must not carry a payload');
      return { type: 'openOk', streamId };
    case OP_OPEN_ERR:
      return { type: 'openErr', streamId, message: payload.toString('utf8') };
    case OP_DATA:
      return { type: 'data', streamId, payload: Buffer.from(payload) };
    case OP_EOF:
      if (payload.length > 0) throw new FrameDecodeError('EOF must not carry a payload');
      return { type: 'eof', streamId };
    case OP_CLOSE:
      if (payload.length > 0) throw new FrameDecodeError('CLOSE must not carry a payload');
      return { type: 'close', streamId };
    default:
      throw new FrameDecodeError(`unknown opcode 0x${opcode.toString(16).padStart(2, '0')}`);
  }
}

/**
 * True when an `OPEN_ERR` message definitively reports a refused connect —
 * i.e. nothing is listening on the daemon-side port anymore. The daemon
 * formats the payload as `connect 127.0.0.1:<port>: <io error>`
 * (`intent-transport/src/tunnel.rs`), where the io error renders as
 * `Connection refused (os error 111)` on Linux / `(os error 61)` on macOS /
 * `(os error 10061)` on Windows — the text may be OS-localized, the code is
 * not. The numeric fallback (for localized text) only matches inside that
 * `connect …` format: errno values are per-OS (61 is ECONNREFUSED on
 * macOS/BSD but ENODATA on Linux) and we don't know the daemon's OS, but in
 * a `connect(2)` failure context the ambiguous codes can only mean refused —
 * connect never fails with ENODATA. Deliberately conservative: timeouts
 * (`timed out after …`) and every other transient error do NOT match and
 * stay per-stream.
 */
export function isConnectionRefusedOpenErr(message: string): boolean {
  return (
    /connection refused|econnrefused/i.test(message) ||
    /^connect .*\(os error (?:111|61|10061)\)/.test(message)
  );
}

/** `ws.WebSocket.OPEN` without importing the class into the type surface. */
const WS_OPEN = 1;

/**
 * Minimal surface of the `/tunnel` WebSocket the manager drives. The real
 * `ws.WebSocket` satisfies it; unit tests inject a scripted fake.
 */
export interface TunnelSocketLike {
  readonly readyState: number;
  /** Bytes queued but not yet handed to the OS — the backpressure signal. */
  readonly bufferedAmount: number;
  send(data: Buffer): void;
  terminate(): void;
  on(event: 'open' | 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
}

/** Options for [[TunnelManager]]. */
export interface TunnelManagerOptions {
  /**
   * Active transport target the tunnel reuses (URL/token/cert pin). Read on
   * every (re)connect so a backend switch is picked up lazily.
   */
  getConfig: () => BackendConnectionConfig | null;
  /** Socket factory seam for tests; defaults to [[createTunnelSocket]]. */
  socketFactory?: (config: BackendConnectionConfig) => TunnelSocketLike;
  /** Deadline for the `/tunnel` WebSocket to reach `open`. Default 10s. */
  connectTimeoutMs?: number;
  /** Deadline for `OPEN` → `OPEN_OK`/`OPEN_ERR` per stream. Default 15s. */
  openTimeoutMs?: number;
  /** Pause local sockets when `ws.bufferedAmount` exceeds this. Default 1 MiB. */
  backpressureHighWaterMark?: number;
  /** Cadence of the `bufferedAmount` drain poll while paused. Default 20ms. */
  backpressurePollMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_OPEN_TIMEOUT_MS = 15_000;
const DEFAULT_BACKPRESSURE_HIGH_WATER = 1024 * 1024;
const DEFAULT_BACKPRESSURE_POLL_MS = 20;

/** One local forwarded port: an ephemeral loopback listener bound to a remote port. */
interface ForwardState {
  remotePort: number;
  localPort: number;
  server: net.Server;
  streams: Set<StreamState>;
}

/** One accepted local connection mapped to a mux stream. */
interface StreamState {
  streamId: number;
  socket: net.Socket;
  forward: ForwardState;
  /** `OPEN_OK` received; data may flow. */
  opened: boolean;
  /** The daemon already ended this stream (`OPEN_ERR`/`CLOSE`) — send no `CLOSE` back. */
  remoteClosed: boolean;
  openTimer: NodeJS.Timeout | null;
}

/**
 * Build the `/tunnel` WebSocket for the active transport config, mirroring
 * the JSON-RPC socket's auth posture: plain `ws` reuses the configured URL
 * with the `/tunnel` path; pinned `wss` sends the bearer token on the upgrade
 * (header + `?token=` fallback) and verifies the presented cert's fingerprint
 * against the pin before any data flows (mismatch → {@link PinMismatchError},
 * HTTP 401/403 → {@link AuthRejectedError}). UDS/TCP transports are local —
 * a tunnel is meaningless there — and are rejected.
 */
export function createTunnelSocket(config: BackendConnectionConfig): TunnelSocketLike {
  if (config.transport === 'ws') {
    if (!config.wsUrl) throw new Error('WS transport requires a wsUrl');
    const url = new URL(config.wsUrl);
    url.pathname = '/tunnel';
    return new NodeWebSocket(url.toString());
  }
  if (config.transport !== 'wss') {
    throw new Error(`tunnel requires a WebSocket transport (got ${config.transport})`);
  }
  const { host, port, token, fingerprint } = config;
  if (!host || !port) throw new Error('WSS transport requires host and port');
  if (!token) throw new Error('WSS transport requires a token');
  if (!fingerprint) throw new Error('WSS transport requires a pinned fingerprint');
  const expected = normalizeFingerprint(fingerprint);
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const url = new URL(`wss://${authority}:${port}/tunnel`);
  url.searchParams.set('token', token);
  const ws = new NodeWebSocket(url.toString(), {
    rejectUnauthorized: false,
    headers: { Authorization: `Bearer ${token}` },
  });
  const peerFingerprint = (response: IncomingMessage): string => {
    const socket = response.socket as tls.TLSSocket;
    const cert = socket.getPeerCertificate?.();
    return normalizeFingerprint(cert?.fingerprint256 ?? '');
  };
  const fail = (error: Error): void => {
    ws.emit('error', error);
    ws.terminate();
  };
  ws.on('upgrade', (response: IncomingMessage) => {
    const actual = peerFingerprint(response);
    if (actual !== expected) fail(new PinMismatchError(expected, actual));
  });
  ws.on('unexpected-response', (_req, response: IncomingMessage) => {
    // Pin first: a changed endpoint can also answer 401/403, and classifying
    // that as auth rejection would be trusting an unverified certificate.
    const actual = peerFingerprint(response);
    if (actual !== expected) {
      fail(new PinMismatchError(expected, actual));
      return;
    }
    const statusCode = response.statusCode ?? 0;
    if (statusCode === 401 || statusCode === 403) {
      fail(new AuthRejectedError(statusCode));
      return;
    }
    fail(new Error(`Unexpected server response: ${statusCode}`));
  });
  return ws;
}

/**
 * Client side of the `/tunnel` mux: one lazily-opened WebSocket, one local
 * `net.Server` per forwarded remote port, one mux stream per accepted socket.
 */
export class TunnelManager {
  /** Backend discriminator echoed in tunnel action results. */
  readonly backend = 'tunnel' as const;

  private readonly getConfig: () => BackendConnectionConfig | null;
  private readonly socketFactory: (config: BackendConnectionConfig) => TunnelSocketLike;
  private readonly connectTimeoutMs: number;
  private readonly openTimeoutMs: number;
  private readonly backpressureHighWaterMark: number;
  private readonly backpressurePollMs: number;

  private ws: TunnelSocketLike | null = null;
  private connectPromise: Promise<void> | null = null;
  /** Sockets still connecting, so a `dispose()` mid-connect can terminate them. */
  private readonly connectingSockets = new Set<TunnelSocketLike>();
  private readonly forwards = new Map<number, ForwardState>();
  private readonly pendingForwards = new Map<number, Promise<number>>();
  private readonly streams = new Map<number, StreamState>();
  private readonly pausedForBackpressure = new Set<net.Socket>();
  private backpressureTimer: NodeJS.Timeout | null = null;
  private nextStreamId = 1;
  private disposed = false;

  constructor(options: TunnelManagerOptions) {
    this.getConfig = options.getConfig;
    this.socketFactory = options.socketFactory ?? createTunnelSocket;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    this.backpressureHighWaterMark =
      options.backpressureHighWaterMark ?? DEFAULT_BACKPRESSURE_HIGH_WATER;
    this.backpressurePollMs = options.backpressurePollMs ?? DEFAULT_BACKPRESSURE_POLL_MS;
  }

  /**
   * Lazily open (or reuse) the single `/tunnel` WebSocket. Concurrent callers
   * share one connect attempt; after a tunnel drop the next call reconnects.
   * A `wss` config with multiple candidate hosts (#1746) races one socket per
   * candidate — first `open` wins, losers are terminated — mirroring
   * `raceDuplexSockets` on the JSON-RPC transport.
   */
  ensureTunnel(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('TunnelManager disposed'));
    if (this.ws && this.ws.readyState === WS_OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    const config = this.getConfig();
    if (!config) {
      return Promise.reject(new Error('no active backend config for the tunnel'));
    }
    const hosts = config.transport === 'wss' ? candidateWssHosts(config) : [];
    const candidates: BackendConnectionConfig[] =
      hosts.length > 1 ? hosts.map((host) => ({ ...config, host })) : [config];
    const attempt = new Promise<void>((resolve, reject) => {
      let settled = false;
      let pendingCount = candidates.length;
      let lastError: Error | null = null;
      const sockets: TunnelSocketLike[] = [];
      const terminateQuietly = (socket: TunnelSocketLike): void => {
        this.connectingSockets.delete(socket);
        try {
          socket.terminate();
        } catch {
          // ignore teardown errors
        }
      };
      // One candidate failing (error/close/factory throw) only rejects the
      // attempt once EVERY candidate has failed; the last failure wins.
      const failCandidate = (error: Error): void => {
        lastError = error;
        pendingCount -= 1;
        if (!settled && pendingCount === 0) {
          settled = true;
          clearTimeout(timer);
          reject(lastError);
        }
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        for (const socket of sockets) terminateQuietly(socket);
        reject(new Error(`tunnel connect timed out after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);
      timer.unref?.();
      for (const candidate of candidates) {
        let ws: TunnelSocketLike;
        try {
          ws = this.socketFactory(candidate);
        } catch (error) {
          failCandidate(error instanceof Error ? error : new Error(String(error)));
          continue;
        }
        sockets.push(ws);
        this.connectingSockets.add(ws);
        // Guards against double-counting a candidate whose 'error' is
        // followed by 'close'.
        let done = false;
        ws.on('open', () => {
          this.connectingSockets.delete(ws);
          if (done) return;
          done = true;
          if (settled || this.disposed) {
            // A raced sibling already won, the timeout fired, or dispose()
            // ran mid-connect — never adopt this socket.
            terminateQuietly(ws);
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              reject(new Error('TunnelManager disposed'));
            }
            return;
          }
          settled = true;
          clearTimeout(timer);
          for (const other of sockets) {
            if (other !== ws) terminateQuietly(other);
          }
          this.ws = ws;
          resolve();
        });
        ws.on('error', (error: Error) => {
          if (done || settled) return;
          done = true;
          this.connectingSockets.delete(ws);
          failCandidate(error);
        });
        ws.on('close', () => {
          this.connectingSockets.delete(ws);
          if (!done && !settled) {
            done = true;
            failCandidate(new Error('tunnel closed before opening'));
          }
          if (this.ws === ws) this.handleTunnelDrop();
        });
        ws.on('message', (data: unknown, isBinary: boolean) => {
          if (this.ws === ws) this.handleMessage(data, isBinary);
        });
      }
    });
    this.connectPromise = attempt;
    const clear = (): void => {
      if (this.connectPromise === attempt) this.connectPromise = null;
    };
    attempt.then(clear, clear);
    return attempt;
  }

  /**
   * Forward daemon-loopback `remotePort` to a client-loopback ephemeral port;
   * resolves with the local port. Repeated calls for the same remote port
   * reuse the existing forward.
   */
  forwardPort(remotePort: number): Promise<number> {
    if (this.disposed) return Promise.reject(new Error('TunnelManager disposed'));
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
      return Promise.reject(new Error(`invalid remote port: ${remotePort}`));
    }
    const existing = this.forwards.get(remotePort);
    if (existing) return Promise.resolve(existing.localPort);
    const pending = this.pendingForwards.get(remotePort);
    if (pending) return pending;
    const promise = this.createForward(remotePort);
    this.pendingForwards.set(remotePort, promise);
    const clear = (): void => {
      this.pendingForwards.delete(remotePort);
    };
    promise.then(clear, clear);
    return promise;
  }

  /** Active forwards, for diagnostics and result echoes. */
  activeForwards(): Array<{ remotePort: number; localPort: number }> {
    return [...this.forwards.values()].map(({ remotePort, localPort }) => ({
      remotePort,
      localPort,
    }));
  }

  /**
   * Close the forward for `remotePort` on request (its local listener and any
   * remaining streams). Returns true when a forward existed, false otherwise.
   */
  closeForward(remotePort: number): boolean {
    const forward = this.forwards.get(remotePort);
    if (!forward) return false;
    this.dropForward(forward, 'closed on request');
    return true;
  }

  /** Tear down every forward and the tunnel socket. The manager is unusable after. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const ws = this.ws;
    this.teardownForwards();
    this.ws = null;
    // Sockets still connecting are not yet `this.ws` — terminate them too so
    // an in-flight `ensureTunnel()` cannot open against the old backend.
    for (const pending of this.connectingSockets) {
      try {
        pending.terminate();
      } catch {
        // ignore teardown errors
      }
    }
    this.connectingSockets.clear();
    if (ws) {
      try {
        ws.terminate();
      } catch {
        // ignore teardown errors
      }
    }
  }

  private async createForward(remotePort: number): Promise<number> {
    await this.ensureTunnel();
    // allowHalfOpen: a client FIN (mapped to mux EOF) must not kill the write
    // side — the remote's response still flows back until its own EOF/CLOSE.
    const server = net.createServer({ allowHalfOpen: true });
    const localPort = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('local forward listener has no address'));
        }
      });
    });
    const forward: ForwardState = {
      remotePort,
      localPort,
      server,
      streams: new Set(),
    };
    server.on('connection', (socket) => this.handleLocalConnection(forward, socket));
    // A disposal/tunnel-drop that raced the listen setup wins.
    if (this.disposed || !this.ws || this.ws.readyState !== WS_OPEN) {
      server.close();
      throw new Error('tunnel dropped while creating the forward');
    }
    this.forwards.set(remotePort, forward);
    logger.info('forward opened', { remotePort, localPort });
    return localPort;
  }

  private handleLocalConnection(forward: ForwardState, socket: net.Socket): void {
    if (!this.forwards.has(forward.remotePort)) {
      socket.destroy();
      return;
    }
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      // The tunnel dropped since this forward opened: reconnect lazily,
      // holding the accepted socket until the fresh tunnel socket is up.
      socket.pause();
      this.ensureTunnel().then(
        () => {
          if (socket.destroyed) return;
          if (
            !this.forwards.has(forward.remotePort) ||
            !this.ws ||
            this.ws.readyState !== WS_OPEN
          ) {
            socket.destroy();
            return;
          }
          this.attachStream(forward, socket);
        },
        (error: unknown) => {
          logger.warn('lazy tunnel reconnect failed', {
            remotePort: forward.remotePort,
            error: error instanceof Error ? error.message : String(error),
          });
          socket.destroy();
        },
      );
      return;
    }
    this.attachStream(forward, socket);
  }

  /** Map an accepted local socket to a mux stream and send its `OPEN`. */
  private attachStream(forward: ForwardState, socket: net.Socket): void {
    const streamId = this.allocStreamId();
    const stream: StreamState = {
      streamId,
      socket,
      forward,
      opened: false,
      remoteClosed: false,
      openTimer: null,
    };
    this.streams.set(streamId, stream);
    forward.streams.add(stream);
    socket.setNoDelay(true);
    // Hold local bytes until the daemon confirms the remote connect.
    socket.pause();
    stream.openTimer = setTimeout(() => {
      if (!stream.opened) {
        logger.warn('stream open timed out', { streamId, remotePort: forward.remotePort });
        this.endStream(stream, { sendClose: true });
      }
    }, this.openTimeoutMs);
    stream.openTimer.unref?.();

    socket.on('data', (chunk: Buffer) => {
      // Respect the daemon's per-frame DATA cap by splitting large reads.
      for (let offset = 0; offset < chunk.length; offset += MAX_DATA_PAYLOAD_BYTES) {
        const payload = chunk.subarray(offset, offset + MAX_DATA_PAYLOAD_BYTES);
        this.sendFrame({ type: 'data', streamId, payload: Buffer.from(payload) });
      }
      this.applyBackpressure(socket);
    });
    socket.on('end', () => {
      // Local half-close: no more client → daemon bytes on this stream.
      if (!stream.remoteClosed) this.sendFrame({ type: 'eof', streamId });
    });
    socket.on('error', () => {
      // 'close' follows and owns the teardown.
    });
    socket.on('close', () => {
      if (!this.streams.has(streamId)) return;
      this.endStream(stream, { sendClose: !stream.remoteClosed });
    });

    this.sendFrame({ type: 'open', streamId, port: forward.remotePort });
  }

  private handleMessage(data: unknown, isBinary: boolean): void {
    if (!isBinary) return;
    const bytes = Array.isArray(data)
      ? Buffer.concat(data as Buffer[])
      : Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : null;
    if (!bytes) return;
    let frame: TunnelFrame;
    try {
      frame = decodeFrame(bytes);
    } catch (error) {
      logger.warn('dropping malformed tunnel frame', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    // Frames for unknown stream ids are ordinary races with a local teardown
    // already in flight — ignore them (mirrors the daemon's tolerance).
    const stream = this.streams.get(frame.streamId);
    if (!stream) return;
    switch (frame.type) {
      case 'openOk':
        stream.opened = true;
        if (stream.openTimer) clearTimeout(stream.openTimer);
        stream.openTimer = null;
        if (!stream.socket.destroyed && !this.pausedForBackpressure.has(stream.socket)) {
          stream.socket.resume();
        }
        break;
      case 'openErr': {
        // Terminal for a stream that never opened — no CLOSE follows.
        logger.warn('remote open failed', {
          streamId: frame.streamId,
          remotePort: stream.forward.remotePort,
          message: frame.message,
        });
        const forward = stream.forward;
        stream.remoteClosed = true;
        this.endStream(stream, { sendClose: false });
        // A definitively refused connect means the daemon-side server is
        // gone: drop the whole forward so it leaves activeForwards() now and
        // the next forwardPort() recreates it fresh. Timeouts and other
        // transient errors stay per-stream.
        if (isConnectionRefusedOpenErr(frame.message)) {
          this.dropForward(forward, 'daemon-side port refused the connect');
        }
        break;
      }
      case 'data':
        // `write()`'s return value is deliberately ignored: the frozen frame
        // contract has no per-stream flow-control window and pausing the
        // shared WebSocket would stall every stream, so a slow local reader
        // buffers in its socket — bounded in practice by the daemon-side caps.
        if (!stream.socket.destroyed) stream.socket.write(frame.payload);
        break;
      case 'eof':
        // Remote half-close: finish the local write side, keep reading.
        if (!stream.socket.destroyed) stream.socket.end();
        break;
      case 'close':
        stream.remoteClosed = true;
        this.endStream(stream, { sendClose: false });
        break;
      case 'open':
        logger.warn('unexpected client-only OPEN frame from daemon', {
          streamId: frame.streamId,
        });
        break;
    }
  }

  /**
   * Close a forward's local listener and remaining streams and deregister it,
   * so the next `forwardPort(remotePort)` recreates it fresh. Used when a
   * refused `OPEN` shows the daemon-side port is closed and by the explicit
   * [[closeForward]].
   */
  private dropForward(forward: ForwardState, reason: string): void {
    if (this.forwards.get(forward.remotePort) !== forward) return;
    this.forwards.delete(forward.remotePort);
    forward.server.close();
    for (const stream of [...forward.streams]) {
      this.endStream(stream, { sendClose: !stream.remoteClosed });
    }
    logger.info('forward dropped', {
      reason,
      remotePort: forward.remotePort,
      localPort: forward.localPort,
    });
  }

  /** Deregister a stream and destroy its socket (optionally telling the daemon). */
  private endStream(stream: StreamState, options: { sendClose: boolean }): void {
    if (!this.streams.delete(stream.streamId)) return;
    stream.forward.streams.delete(stream);
    if (stream.openTimer) clearTimeout(stream.openTimer);
    stream.openTimer = null;
    this.pausedForBackpressure.delete(stream.socket);
    if (options.sendClose) this.sendFrame({ type: 'close', streamId: stream.streamId });
    if (!stream.socket.destroyed) stream.socket.destroy();
  }

  private sendFrame(frame: TunnelFrame): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return;
    try {
      ws.send(encodeFrame(frame));
    } catch (error) {
      logger.warn('tunnel send failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Pause the local socket while the WebSocket's send buffer is over the mark. */
  private applyBackpressure(socket: net.Socket): void {
    const ws = this.ws;
    if (!ws || ws.bufferedAmount <= this.backpressureHighWaterMark) return;
    if (socket.destroyed || this.pausedForBackpressure.has(socket)) return;
    socket.pause();
    this.pausedForBackpressure.add(socket);
    if (this.backpressureTimer) return;
    this.backpressureTimer = setInterval(() => {
      const current = this.ws;
      const drained = !current || current.bufferedAmount <= this.backpressureHighWaterMark;
      if (!drained) return;
      for (const paused of this.pausedForBackpressure) {
        if (!paused.destroyed) paused.resume();
      }
      this.pausedForBackpressure.clear();
      if (this.backpressureTimer) clearInterval(this.backpressureTimer);
      this.backpressureTimer = null;
    }, this.backpressurePollMs);
    this.backpressureTimer.unref?.();
  }

  /**
   * The tunnel socket closed: destroy in-flight streams but keep every
   * forward (and its local listener/port) registered — the next accepted
   * local connection reconnects the tunnel lazily.
   */
  private handleTunnelDrop(): void {
    logger.warn('tunnel dropped; destroying in-flight streams, keeping forwards', {
      forwards: this.forwards.size,
      streams: this.streams.size,
    });
    this.ws = null;
    for (const stream of [...this.streams.values()]) {
      this.endStream(stream, { sendClose: false });
    }
    this.pausedForBackpressure.clear();
    if (this.backpressureTimer) clearInterval(this.backpressureTimer);
    this.backpressureTimer = null;
  }

  private teardownForwards(): void {
    for (const stream of this.streams.values()) {
      if (stream.openTimer) clearTimeout(stream.openTimer);
      stream.openTimer = null;
      if (!stream.socket.destroyed) stream.socket.destroy();
    }
    this.streams.clear();
    for (const forward of this.forwards.values()) {
      forward.streams.clear();
      forward.server.close();
    }
    this.forwards.clear();
    this.pausedForBackpressure.clear();
    if (this.backpressureTimer) clearInterval(this.backpressureTimer);
    this.backpressureTimer = null;
  }

  private allocStreamId(): number {
    // u32 wrap; skip ids still in use (paranoia at 4B streams).
    do {
      this.nextStreamId = (this.nextStreamId + 1) >>> 0 || 1;
    } while (this.streams.has(this.nextStreamId));
    return this.nextStreamId;
  }
}
