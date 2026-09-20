/**
 * Unit tests for the `/tunnel` port-forwarding client (TunnelManager).
 *
 * The WebSocket is mocked with a scripted in-memory fake whose "daemon side"
 * implements the same mux semantics as `intent-transport/src/tunnel.rs`
 * (OPEN → real TCP connect on loopback, DATA/EOF/CLOSE relay), so the manager
 * is exercised against real ephemeral TCP sockets on both ends without a
 * network WebSocket in between.
 */
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BackendConnectionConfig } from './backend-connection';
import { AuthRejectedError, PinMismatchError } from './backend-connection';
import {
  decodeFrame,
  encodeFrame,
  FrameDecodeError,
  HEADER_LEN,
  isConnectionRefusedOpenErr,
  MAX_DATA_PAYLOAD_BYTES,
  OP_CREDIT,
  OP_DATA,
  TunnelManager,
  type TunnelFrame,
  type TunnelSocketLike,
} from './tunnel-manager';

/** Scripted stand-in for the `/tunnel` `ws.WebSocket`. */
class FakeTunnelSocket extends EventEmitter implements TunnelSocketLike {
  readyState = 0; // CONNECTING
  bufferedAmount = 0;
  autoPong = true;
  pingCount = 0;
  /** Frames the manager sent, in order. */
  readonly sent: TunnelFrame[] = [];
  /** Called for each frame the manager sends (the scripted daemon hook). */
  onFrame: ((frame: TunnelFrame) => void) | null = null;

  open(): void {
    this.readyState = 1; // OPEN
    this.emit('open');
  }

  send(data: Buffer): void {
    const frame = decodeFrame(data);
    this.sent.push(frame);
    this.onFrame?.(frame);
  }

  ping(): void {
    this.pingCount += 1;
    if (this.autoPong) queueMicrotask(() => this.emit('pong'));
  }

  /** Deliver a daemon → client frame. */
  deliver(frame: TunnelFrame): void {
    this.emit('message', encodeFrame(frame), true);
  }

  /** Simulate a tunnel drop (daemon restart, network cut). */
  drop(): void {
    if (this.readyState === 3) return;
    this.readyState = 3; // CLOSED
    this.emit('close');
  }

  terminate(): void {
    this.drop();
  }
}

/**
 * Daemon-side mux semantics over a FakeTunnelSocket: per OPEN, a real TCP
 * connect to `127.0.0.1:<port>`; OPEN_OK/OPEN_ERR; DATA/EOF/CLOSE relayed to
 * and from the socket — mirroring `run_stream` in the landed intentd code.
 */
function attachFakeDaemon(ws: FakeTunnelSocket): void {
  const sockets = new Map<number, net.Socket>();
  const connectingSockets = new Set<net.Socket>();
  ws.on('close', () => {
    for (const socket of connectingSockets) socket.destroy();
    for (const socket of sockets.values()) socket.destroy();
    connectingSockets.clear();
    sockets.clear();
  });
  ws.onFrame = (frame) => {
    if (frame.type === 'open') {
      const socket = net.connect({ host: '127.0.0.1', port: frame.port });
      const streamId = frame.streamId;
      connectingSockets.add(socket);
      socket.on('connect', () => {
        connectingSockets.delete(socket);
        if (ws.readyState !== 1) {
          socket.destroy();
          return;
        }
        sockets.set(streamId, socket);
        ws.deliver({ type: 'openOk', streamId });
      });
      socket.on('data', (chunk) => ws.deliver({ type: 'data', streamId, payload: chunk }));
      socket.on('end', () => ws.deliver({ type: 'eof', streamId }));
      socket.on('error', (error: NodeJS.ErrnoException) => {
        if (!sockets.has(streamId)) {
          ws.deliver({ type: 'openErr', streamId, message: error.message });
        }
      });
      socket.on('close', () => {
        connectingSockets.delete(socket);
        if (sockets.delete(streamId)) ws.deliver({ type: 'close', streamId });
      });
      return;
    }
    const socket = sockets.get(frame.streamId);
    if (!socket) return;
    if (frame.type === 'data') socket.write(frame.payload);
    else if (frame.type === 'eof') socket.end();
    else if (frame.type === 'close') {
      sockets.delete(frame.streamId);
      socket.destroy();
    }
  };
}

/**
 * Wrap `ws.onFrame` so OPENs for ports in `refused` are answered with the
 * daemon's connection-refused OPEN_ERR without any real TCP connect; all
 * other frames pass through to the scripted daemon. Tests use this instead
 * of grabbing-then-releasing an ephemeral port and dialing it for real:
 * the released port can be re-bound by a parallel CI worker (or the
 * loopback connect can succeed as a TCP self-connect) before the fake
 * daemon dials it, turning the expected OPEN_ERR into OPEN_OK and hanging
 * the test on a close that never comes (intent-hq/monorepo#3596).
 */
function refuseOpens(ws: FakeTunnelSocket, refused: ReadonlySet<number>): void {
  const passthrough = ws.onFrame;
  ws.onFrame = (frame) => {
    if (frame.type === 'open' && refused.has(frame.port)) {
      // Deliver asynchronously, like every other scripted daemon response,
      // so the manager never processes the OPEN_ERR re-entrantly from
      // inside its own OPEN send.
      queueMicrotask(() =>
        ws.deliver({
          type: 'openErr',
          streamId: frame.streamId,
          message: `connect 127.0.0.1:${frame.port}: Connection refused (os error 111)`,
        }),
      );
      return;
    }
    passthrough?.(frame);
  };
}

/** Arbitrary remote port for [[refuseOpens]] — never actually dialed. */
const REFUSED_PORT = 4545;

const WSS_CONFIG: BackendConnectionConfig = {
  transport: 'wss',
  host: '127.0.0.1',
  port: 9999,
  token: 'test-token',
  fingerprint: 'AA:BB',
};

/** Manager + fake-socket harness with per-test option overrides. */
function makeManager(
  options: {
    maxStreams?: number;
    maxStreamsPerPort?: number;
    maxPendingStreams?: number;
    maxPendingStreamsPerPort?: number;
    admissionTimeoutMs?: number;
    admissionRetryMs?: number;
    backpressureHighWaterMark?: number;
    openTimeoutMs?: number;
    connectTimeoutMs?: number;
    heartbeatIntervalMs?: number;
    heartbeatTimeoutMs?: number;
    daemon?: boolean;
    config?: BackendConnectionConfig | null;
    /** Remote ports whose OPENs get a scripted refused OPEN_ERR (see [[refuseOpens]]). */
    refusedPorts?: Set<number>;
  } = {},
): { manager: TunnelManager; created: FakeTunnelSocket[] } {
  const created: FakeTunnelSocket[] = [];
  const manager = new TunnelManager({
    getConfig: () => (options.config === undefined ? WSS_CONFIG : options.config),
    socketFactory: () => {
      const ws = new FakeTunnelSocket();
      if (options.daemon !== false) attachFakeDaemon(ws);
      if (options.refusedPorts) refuseOpens(ws, options.refusedPorts);
      created.push(ws);
      queueMicrotask(() => ws.open());
      return ws;
    },
    // Existing tests exercise mux behavior without background health ticks;
    // heartbeat-specific regressions opt in below.
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 0,
    ...options,
  });
  return { manager, created };
}

/** Loopback echo server on an ephemeral port. */
async function startEchoServer(): Promise<{ port: number; server: net.Server }> {
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, server };
}

function connectClient(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function collectUntil(socket: net.Socket, expectedBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= expectedBytes) resolve(Buffer.concat(chunks));
    });
    socket.once('error', reject);
    socket.once('close', () => reject(new Error('socket closed before enough data')));
  });
}

function waitForClose(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => socket.once('close', resolve));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await delay(10);
  }
}

describe('tunnel frame codec', () => {
  it('round-trips every frame type', () => {
    const frames: TunnelFrame[] = [
      { type: 'open', streamId: 7, port: 8080 },
      { type: 'openOk', streamId: 0xffffffff },
      { type: 'openErr', streamId: 3, message: 'connect 127.0.0.1:1: refused' },
      { type: 'data', streamId: 42, payload: Buffer.from([0, 1, 2, 255]) },
      { type: 'data', streamId: 42, payload: Buffer.alloc(0) },
      { type: 'eof', streamId: 9 },
      { type: 'close', streamId: 10 },
      { type: 'credit', streamId: 11, credit: 64 * 1024 },
      { type: 'credit', streamId: 12, credit: 0xffffffff },
    ];
    for (const frame of frames) {
      expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
    }
  });

  it('encodes CREDIT as opcode 0x07 + BE streamId + BE u32 credit', () => {
    const raw = encodeFrame({ type: 'credit', streamId: 0x01020304, credit: 65536 });
    expect([...raw]).toEqual([OP_CREDIT, 1, 2, 3, 4, 0, 1, 0, 0]);
  });

  it('rejects malformed frames', () => {
    expect(() => decodeFrame(Buffer.alloc(HEADER_LEN - 1))).toThrow(FrameDecodeError);
    expect(() => decodeFrame(Buffer.from([0x99, 0, 0, 0, 1]))).toThrow(/unknown opcode/);
    // OPEN payload must be exactly 2 bytes.
    expect(() => decodeFrame(Buffer.from([0x01, 0, 0, 0, 1, 5]))).toThrow(/exactly 2 bytes/);
    // Payload-less opcodes must not carry payloads.
    for (const opcode of [0x02, 0x05, 0x06]) {
      expect(() => decodeFrame(Buffer.from([opcode, 0, 0, 0, 1, 1]))).toThrow(FrameDecodeError);
    }
    // CREDIT payload must be exactly 4 bytes and grant at least one byte.
    expect(() => decodeFrame(Buffer.from([OP_CREDIT, 0, 0, 0, 1]))).toThrow(/exactly 4 bytes/);
    expect(() => decodeFrame(Buffer.from([OP_CREDIT, 0, 0, 0, 1, 0, 0, 1]))).toThrow(
      /exactly 4 bytes/,
    );
    expect(() => decodeFrame(Buffer.from([OP_CREDIT, 0, 0, 0, 1, 0, 0, 0, 1, 0]))).toThrow(
      /exactly 4 bytes/,
    );
    expect(() => decodeFrame(Buffer.from([OP_CREDIT, 0, 0, 0, 1, 0, 0, 0, 0]))).toThrow(
      /at least one byte/,
    );
  });
});

describe('isConnectionRefusedOpenErr', () => {
  it('matches definitive connection-refused messages (daemon and node shapes)', () => {
    // The daemon's `connect 127.0.0.1:<port>: <io error>` per platform.
    expect(
      isConnectionRefusedOpenErr('connect 127.0.0.1:8080: Connection refused (os error 111)'),
    ).toBe(true);
    expect(
      isConnectionRefusedOpenErr('connect 127.0.0.1:8080: Connection refused (os error 61)'),
    ).toBe(true);
    // Windows: the text may be OS-localized but the code is stable.
    expect(
      isConnectionRefusedOpenErr('connect 127.0.0.1:8080: Verbindung verweigert (os error 10061)'),
    ).toBe(true);
    expect(isConnectionRefusedOpenErr('connect ECONNREFUSED 127.0.0.1:8080')).toBe(true);
  });

  it('does not match timeouts or other transient errors', () => {
    expect(isConnectionRefusedOpenErr('connect 127.0.0.1:8080: timed out after 10s')).toBe(false);
    expect(isConnectionRefusedOpenErr('too many streams')).toBe(false);
    expect(
      isConnectionRefusedOpenErr('connect 127.0.0.1:8080: Network unreachable (os error 101)'),
    ).toBe(false);
    expect(isConnectionRefusedOpenErr('')).toBe(false);
  });

  it('only matches ambiguous numeric codes inside the connect format (61 is ENODATA on Linux)', () => {
    expect(isConnectionRefusedOpenErr('(os error 61)')).toBe(false);
    expect(isConnectionRefusedOpenErr('stream reset (os error 61)')).toBe(false);
    expect(isConnectionRefusedOpenErr('read 127.0.0.1:8080: No data available (os error 61)')).toBe(
      false,
    );
  });
});

describe('TunnelManager', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });
  const onCleanup = (fn: () => void | Promise<void>): void => {
    cleanups.push(fn);
  };

  it('releases a reset queued client without later sending its OPEN', async () => {
    const { manager, created } = makeManager({
      daemon: false,
      maxStreams: 1,
      maxPendingStreams: 1,
    });
    onCleanup(() => manager.dispose());
    const port = await manager.forwardPort(10001);
    const active = await connectClient(port);
    onCleanup(() => active.destroy());
    const queued = await connectClient(port);
    onCleanup(() => queued.destroy());
    await waitFor(() => manager.getDiagnostics().admission.pending === 1);
    const cancelledId = manager
      .getDiagnostics()
      .streams.find((s) => s.state === 'queued')!.streamId;
    queued.resetAndDestroy();
    await waitFor(() => manager.getDiagnostics().admission.pending === 0);
    const replacement = await connectClient(port);
    onCleanup(() => replacement.destroy());
    await waitFor(() => manager.getDiagnostics().admission.pending === 1);
    const ws = created[0];
    const first = ws.sent.find((f) => f.type === 'open')!;
    ws.deliver({ type: 'close', streamId: first.streamId });
    await waitFor(() => ws.sent.filter((f) => f.type === 'open').length === 2);
    expect(ws.sent.some((f) => f.type === 'open' && f.streamId === cancelledId)).toBe(false);
  });

  it('withholds queued bytes and FIN until OPEN_OK, preserving a half-closed request', async () => {
    const { manager, created } = makeManager({ daemon: false, maxStreams: 1 });
    onCleanup(() => manager.dispose());
    const port = await manager.forwardPort(10001);
    const active = await connectClient(port);
    onCleanup(() => active.destroy());
    const queued = await connectClient(port);
    onCleanup(() => queued.destroy());
    await waitFor(() => manager.getDiagnostics().admission.pending === 1);
    queued.end('request');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const ws = created[0];
    expect(ws.sent.map((f) => f.type)).toEqual(['open']);
    ws.deliver({ type: 'close', streamId: ws.sent[0].streamId });
    await waitFor(() => ws.sent.filter((f) => f.type === 'open').length === 2);
    const id = ws.sent[1].streamId;
    expect(ws.sent.map((f) => f.type)).toEqual(['open', 'open']);
    ws.deliver({ type: 'openOk', streamId: id });
    await waitFor(() => ws.sent.some((f) => f.type === 'eof'));
    expect(ws.sent.slice(2)).toEqual([
      { type: 'data', streamId: id, payload: Buffer.from('request') },
      { type: 'eof', streamId: id },
    ]);
  });

  it.each([false, true])(
    'preserves a large upload across delayed OPEN_OK (queued=%s)',
    async (queued) => {
      const { manager, created } = makeManager({ daemon: false, maxStreams: 1 });
      onCleanup(() => manager.dispose());
      const port = await manager.forwardPort(10001);
      if (queued) {
        const active = await connectClient(port);
        onCleanup(() => active.destroy());
      }
      const client = await connectClient(port);
      onCleanup(() => client.destroy());
      const payload = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
      client.end(payload);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const ws = created[0];
      expect(client.destroyed).toBe(false);
      expect(ws.sent.map((f) => f.type)).toEqual(['open']);
      expect(manager.getDiagnostics().streams).toHaveLength(queued ? 2 : 1);
      if (queued) {
        ws.deliver({ type: 'close', streamId: ws.sent[0].streamId });
        await waitFor(() => ws.sent.filter((f) => f.type === 'open').length === 2);
      }
      const id = ws.sent.filter((f) => f.type === 'open').at(-1)!.streamId;
      ws.deliver({ type: 'openOk', streamId: id });
      await waitFor(() => ws.sent.some((f) => f.type === 'eof' && f.streamId === id));
      const frames = ws.sent.filter((f) => f.streamId === id);
      expect(Buffer.concat(frames.flatMap((f) => (f.type === 'data' ? [f.payload] : [])))).toEqual(
        payload,
      );
      expect(frames.at(-1)?.type).toBe('eof');
      expect(manager.getDiagnostics().admission.lastFailure).toBeNull();
    },
  );

  it('serves queued ports round-robin instead of draining a busy port first', async () => {
    const { manager, created } = makeManager({
      daemon: false,
      maxStreams: 1,
      maxStreamsPerPort: 1,
    });
    onCleanup(() => manager.dispose());
    const ports = await Promise.all([10001, 10002, 10003].map((port) => manager.forwardPort(port)));
    const ws = created[0];
    ws.onFrame = (frame) => {
      if (frame.type === 'open')
        queueMicrotask(() => ws.deliver({ type: 'openOk', streamId: frame.streamId }));
    };
    for (const index of [2, 0, 0, 1]) {
      const client = await connectClient(ports[index]);
      onCleanup(() => client.destroy());
    }
    await waitFor(() => manager.getDiagnostics().admission.pending === 3);
    for (let index = 0; index < 4; index++) {
      await waitFor(() => ws.sent.filter((frame) => frame.type === 'open').length === index + 1);
      const opens = ws.sent.filter((frame) => frame.type === 'open');
      expect(opens[index]).toMatchObject({ port: [10003, 10001, 10002, 10001][index] });
      ws.deliver({ type: 'close', streamId: opens[index].streamId });
    }
    await waitFor(() => manager.getDiagnostics().streams.length === 0);
  });

  it('retries capacity before OPEN_OK without sending or replaying application bytes', async () => {
    const echo = await startEchoServer();
    onCleanup(() => echo.server.close());
    const { manager, created } = makeManager({ admissionRetryMs: 10 });
    onCleanup(() => manager.dispose());
    const localPort = await manager.forwardPort(echo.port);
    const ws = created[0];
    const passthrough = ws.onFrame;
    let blocked = true;
    ws.onFrame = (frame) => {
      if (blocked && frame.type === 'open')
        queueMicrotask(() =>
          ws.deliver({
            type: 'openErr',
            streamId: frame.streamId,
            message: 'too many concurrent streams (max 32)',
          }),
        );
      else passthrough?.(frame);
    };
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const received = collectUntil(client, 5);
    client.write('entry');
    await waitFor(() => ws.sent.filter((frame) => frame.type === 'open').length >= 2);
    expect(ws.sent.filter((frame) => frame.type === 'data')).toHaveLength(0);
    expect(manager.activeForwards()).toHaveLength(1);
    blocked = false;
    expect((await received).toString()).toBe('entry');
    const bytes = ws.sent.flatMap((frame) => (frame.type === 'data' ? [frame.payload] : []));
    expect(Buffer.concat(bytes).toString()).toBe('entry');
    expect(manager.getDiagnostics().admission.lastFailure).toMatchObject({
      remotePort: echo.port,
      reason: 'too many concurrent streams (max 32)',
    });
  });

  it('reconsiders capacity before the deadline with a large configured retry interval', async () => {
    const echo = await startEchoServer();
    onCleanup(() => echo.server.close());
    const { manager, created } = makeManager({
      admissionRetryMs: 10_000,
      admissionTimeoutMs: 2500,
    });
    onCleanup(() => manager.dispose());
    const port = await manager.forwardPort(echo.port);
    const ws = created[0];
    const passthrough = ws.onFrame;
    let rejected = false;
    ws.onFrame = (frame) => {
      if (frame.type === 'open' && !rejected) {
        rejected = true;
        queueMicrotask(() =>
          ws.deliver({
            type: 'openErr',
            streamId: frame.streamId,
            message: 'too many concurrent streams (max 32)',
          }),
        );
      } else passthrough?.(frame);
    };
    const client = await connectClient(port);
    onCleanup(() => client.destroy());
    const reply = collectUntil(client, 5);
    client.write('entry');
    expect((await reply).toString()).toBe('entry');
    expect(ws.sent.filter((frame) => frame.type === 'open')).toHaveLength(2);
  });

  it('bounds queue overflow and wait, and drops queued work when its forward closes', async () => {
    const { manager, created } = makeManager({
      daemon: false,
      maxStreams: 1,
      maxPendingStreams: 1,
      admissionTimeoutMs: 100,
    });
    onCleanup(() => manager.dispose());
    const port = await manager.forwardPort(10001);
    const held = await connectClient(port);
    onCleanup(() => held.destroy());
    await waitFor(() => created[0].sent.some((frame) => frame.type === 'open'));
    const first = created[0].sent.find((frame) => frame.type === 'open')!;
    created[0].deliver({ type: 'openOk', streamId: first.streamId });
    const pending = await connectClient(port);
    onCleanup(() => pending.destroy());
    const pendingClosed = waitForClose(pending);
    await waitFor(() => manager.getDiagnostics().admission.pending === 1);
    const overflow = await connectClient(port);
    onCleanup(() => overflow.destroy());
    await waitFor(() => overflow.destroyed);
    await pendingClosed;
    expect(created[0].sent.filter((frame) => frame.type === 'open')).toHaveLength(1);
    expect(manager.getDiagnostics().admission.lastFailure?.reason).toBe(
      'admission deadline exceeded',
    );
    const cancelled = await connectClient(port);
    onCleanup(() => cancelled.destroy());
    await waitFor(() => manager.getDiagnostics().admission.pending === 1);
    manager.closeForward(10001);
    expect(manager.getDiagnostics().streams).toHaveLength(0);
    expect(manager.getDiagnostics().admission.pending).toBe(0);
    expect(created[0].sent.filter((frame) => frame.type === 'open')).toHaveLength(1);
  });

  it('boots seven ports while thirty-five long-lived connections remain active', async () => {
    const { manager } = makeManager({ maxStreamsPerPort: 6, maxStreams: 42 });
    onCleanup(() => manager.dispose());
    const ports: number[] = [];
    for (let index = 0; index < 7; index++) {
      const echo = await startEchoServer();
      onCleanup(() => echo.server.close());
      const port = await manager.forwardPort(echo.port);
      ports.push(port);
      for (let held = 0; held < 5; held++) {
        const client = await connectClient(port);
        onCleanup(() => client.destroy());
        const reply = collectUntil(client, 3);
        client.write('hmr');
        expect((await reply).toString()).toBe('hmr');
      }
    }
    await Promise.all(
      ports.flatMap((port) =>
        [0, 1].map(async () => {
          const client = await connectClient(port);
          onCleanup(() => client.destroy());
          const reply = collectUntil(client, 5);
          client.end('ready');
          expect((await reply).toString()).toBe('ready');
        }),
      ),
    );
    await waitFor(() => manager.getDiagnostics().streams.length === 35);
    expect(manager.getDiagnostics().admission.pending).toBe(0);
  });

  it.skipIf(process.env.TUNNEL_BROWSER_TEST !== '1')(
    'loads seven module pages with live event streams and occupied keep-alive slots',
    async () => {
      const { chromium } = await import('@playwright/test');
      const browserTemp = mkdtempSync(join(tmpdir(), 'tunnel-browser-'));
      onCleanup(() => rmSync(browserTemp, { recursive: true, force: true }));
      const browser = await chromium.launch({
        args: ['--no-sandbox'],
        env: { ...process.env, TMPDIR: browserTemp },
      });
      onCleanup(() => browser.close());
      const { manager } = makeManager({ maxStreams: 49, maxStreamsPerPort: 7 });
      onCleanup(() => manager.dispose());
      const ports: number[] = [];
      for (let index = 0; index < 7; index++) {
        const server = http.createServer((request, response) => {
          if (request.url === '/events') {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.write('data: connected\n\n');
            const timer = setInterval(() => response.write('data: tick\n\n'), 25);
            response.on('close', () => clearInterval(timer));
          } else if (request.url?.startsWith('/module')) {
            response.writeHead(200, { 'Content-Type': 'text/javascript' });
            response.end('export default 1;');
          } else {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end(`<script type="module">
              window.events = new EventSource('/events');
              await new Promise(resolve => events.onmessage = resolve);
              const modules = await Promise.all(Array.from({length: 20}, (_, i) => import('/module' + i)));
              document.body.textContent = modules.reduce((sum, m) => sum + m.default, 0);
              document.body.dataset.ready = 'true';
            </script>`);
          }
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        onCleanup(() => {
          server.closeAllConnections();
          server.close();
        });
        const port = await manager.forwardPort((server.address() as AddressInfo).port);
        ports.push(port);
        for (let held = 0; held < 5; held++) {
          const socket = await connectClient(port);
          onCleanup(() => socket.destroy());
        }
      }
      await waitFor(() => manager.getDiagnostics().admission.active === 35);
      const failures: string[] = [];
      await Promise.all(
        ports.map(async (port) => {
          const page = await browser.newPage();
          page.on('requestfailed', (request) => failures.push(request.url()));
          await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
          await page.locator('body[data-ready=true]').waitFor();
          expect(await page.locator('body').innerText()).toBe('20');
        }),
      );
      expect(failures).toEqual([]);
      expect(manager.getDiagnostics().admission.pending).toBe(0);
      await browser.close();
      manager.dispose();
      expect(manager.getDiagnostics().streams).toHaveLength(0);
    },
    60_000,
  );

  it('forwardPort relays data both ways through the mux', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager } = makeManager();
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    expect(localPort).toBeGreaterThan(0);
    expect(localPort).not.toBe(port);

    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('hello over the tunnel');
    client.write(payload);
    const echoed = await collectUntil(client, payload.length);
    expect(echoed.equals(payload)).toBe(true);

    // And a second round-trip on the same stream.
    const again = Buffer.from('second message');
    client.write(again);
    const echoed2 = await collectUntil(client, again.length);
    expect(echoed2.equals(again)).toBe(true);
  });

  it('half-close propagates: client end() still receives the echo then FIN', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager } = makeManager();
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('one-shot');
    const received = collectUntil(client, payload.length);
    client.end(payload);
    expect((await received).equals(payload)).toBe(true);
    await waitForClose(client);
  });

  it('multiplexes concurrent streams without crosstalk', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager } = makeManager();
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    const clients = await Promise.all(Array.from({ length: 5 }, () => connectClient(localPort)));
    onCleanup(() => clients.forEach((c) => c.destroy()));

    await Promise.all(
      clients.map(async (client, i) => {
        const payload = Buffer.alloc(64 * 1024 + i, i + 1);
        const received = collectUntil(client, payload.length);
        client.write(payload);
        const echoed = await received;
        expect(echoed.length).toBe(payload.length);
        expect(echoed.equals(payload)).toBe(true);
      }),
    );
  });

  it('multiplexes forwards to two different remote ports concurrently', async () => {
    const a = await startEchoServer();
    const b = await startEchoServer();
    onCleanup(() => {
      a.server.close();
      b.server.close();
    });
    const { manager, created } = makeManager();
    onCleanup(() => manager.dispose());

    const [localA, localB] = await Promise.all([
      manager.forwardPort(a.port),
      manager.forwardPort(b.port),
    ]);
    // Both forwards share the single tunnel socket.
    expect(created.length).toBe(1);
    expect(manager.activeForwards()).toEqual(
      expect.arrayContaining([
        { remotePort: a.port, localPort: localA },
        { remotePort: b.port, localPort: localB },
      ]),
    );
    // Re-forwarding an already-forwarded port reuses the listener.
    await expect(manager.forwardPort(a.port)).resolves.toBe(localA);

    const [clientA, clientB] = await Promise.all([connectClient(localA), connectClient(localB)]);
    onCleanup(() => {
      clientA.destroy();
      clientB.destroy();
    });
    const payloadA = Buffer.from('to A');
    const payloadB = Buffer.from('to B');
    const gotA = collectUntil(clientA, payloadA.length);
    const gotB = collectUntil(clientB, payloadB.length);
    clientA.write(payloadA);
    clientB.write(payloadB);
    expect((await gotA).equals(payloadA)).toBe(true);
    expect((await gotB).equals(payloadB)).toBe(true);
  });

  it('splits local reads larger than the DATA payload cap across frames', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager, created } = makeManager();
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const big = Buffer.alloc(MAX_DATA_PAYLOAD_BYTES + 64 * 1024, 7);
    const received = collectUntil(client, big.length);
    client.write(big);
    expect((await received).equals(big)).toBe(true);
    const oversize = created[0].sent.filter(
      (f) => f.type === 'data' && f.payload.length > MAX_DATA_PAYLOAD_BYTES,
    );
    expect(oversize).toEqual([]);
  });

  it('rejects the local socket when the remote OPEN fails', async () => {
    // A remote port whose OPEN the scripted daemon refuses (#3596).
    const deadPort = REFUSED_PORT;
    const { manager } = makeManager({ refusedPorts: new Set([deadPort]) });
    onCleanup(() => manager.dispose());
    const localPort = await manager.forwardPort(deadPort);
    const client = await connectClient(localPort);
    await waitForClose(client);
    expect(client.destroyed).toBe(true);
  });

  it('drops the whole forward on a refused OPEN, leaving other forwards intact (#2537)', async () => {
    const healthy = await startEchoServer();
    onCleanup(() => healthy.server.close());
    // A remote port whose OPEN the scripted daemon refuses (#3596).
    const deadPort = REFUSED_PORT;
    const { manager } = makeManager({ refusedPorts: new Set([deadPort]) });
    onCleanup(() => manager.dispose());
    const healthyLocal = await manager.forwardPort(healthy.port);
    const healthyClient = await connectClient(healthyLocal);
    onCleanup(() => healthyClient.destroy());

    const deadLocal = await manager.forwardPort(deadPort);
    expect(manager.activeForwards().length).toBe(2);
    const refused = await connectClient(deadLocal);
    await waitForClose(refused);

    // The refused forward is dropped immediately …
    await waitFor(() => manager.activeForwards().length === 1);
    expect(manager.activeForwards()).toEqual([
      { remotePort: healthy.port, localPort: healthyLocal },
    ]);
    // … its local listener is closed …
    await expect(connectClient(deadLocal)).rejects.toThrow();
    // … and the healthy forward's in-flight stream still relays.
    const payload = Buffer.from('unaffected');
    const received = collectUntil(healthyClient, payload.length);
    healthyClient.write(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('a later forwardPort recreates a forward dropped by a refused OPEN', async () => {
    // The echo server listens throughout; the scripted daemon refuses OPENs
    // for its port until the refusal is lifted below — deterministic
    // stand-ins for a dead-then-revived remote port (#3596).
    const { server, port: deadPort } = await startEchoServer();
    onCleanup(() => server.close());
    const refusedPorts = new Set([deadPort]);
    const { manager } = makeManager({ refusedPorts });
    onCleanup(() => manager.dispose());
    const staleLocal = await manager.forwardPort(deadPort);
    const refused = await connectClient(staleLocal);
    await waitForClose(refused);
    await waitFor(() => manager.activeForwards().length === 0);

    // The server "comes back" on the same remote port; the next forwardPort
    // builds a fresh forward instead of returning the dropped one.
    refusedPorts.delete(deadPort);

    const freshLocal = await manager.forwardPort(deadPort);
    expect(manager.activeForwards()).toEqual([{ remotePort: deadPort, localPort: freshLocal }]);
    const client = await connectClient(freshLocal);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('recreated');
    const received = collectUntil(client, payload.length);
    client.write(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('closeForward closes the forward and its listener; false for unknown ports (#2537)', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager } = makeManager();
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());

    expect(manager.closeForward(port)).toBe(true);
    expect(manager.activeForwards()).toEqual([]);
    // The local listener is gone and the in-flight stream is destroyed.
    await waitForClose(client);
    await expect(connectClient(localPort)).rejects.toThrow();
    // Closing again (or a never-forwarded port) reports false.
    expect(manager.closeForward(port)).toBe(false);
    expect(manager.closeForward(1)).toBe(false);

    // A later forwardPort recreates the forward fresh.
    const freshLocal = await manager.forwardPort(port);
    const fresh = await connectClient(freshLocal);
    onCleanup(() => fresh.destroy());
    const payload = Buffer.from('reopened');
    const received = collectUntil(fresh, payload.length);
    fresh.write(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('a transient OPEN_ERR (timeout) ends only that stream, keeping the forward', async () => {
    const { manager, created } = makeManager({ daemon: false });
    onCleanup(() => manager.dispose());
    const localPort = await manager.forwardPort(4242);
    const ws = created[0];
    // Scripted daemon: every OPEN fails with the daemon's connect-timeout
    // message — transient, so the forward must survive.
    ws.onFrame = (frame) => {
      if (frame.type === 'open') {
        ws.deliver({
          type: 'openErr',
          streamId: frame.streamId,
          message: 'connect 127.0.0.1:4242: timed out after 10s',
        });
      }
    };
    const client = await connectClient(localPort);
    await waitForClose(client);
    expect(manager.activeForwards()).toEqual([{ remotePort: 4242, localPort }]);
    // The local listener still accepts new connections.
    const again = await connectClient(localPort);
    onCleanup(() => again.destroy());
  });

  it('destroys in-flight streams but keeps forwards and listeners when the tunnel drops', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager, created } = makeManager();
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    const client = await connectClient(localPort);
    const closed = waitForClose(client);
    await waitFor(() => created[0].sent.some((frame) => frame.type === 'open'));
    created[0].drop();
    // The in-flight stream is destroyed …
    await closed;
    // … but the forward stays registered on the SAME local port …
    expect(manager.activeForwards()).toEqual([{ remotePort: port, localPort }]);
    // … and its listener still accepts: the next connection reconnects the
    // tunnel lazily and relays through the fresh socket.
    const revived = await connectClient(localPort);
    onCleanup(() => revived.destroy());
    const payload = Buffer.from('same port after drop');
    const received = collectUntil(revived, payload.length);
    revived.write(payload);
    expect((await received).equals(payload)).toBe(true);
    expect(created.length).toBe(2);
  });

  it('reconnects lazily after a drop and the surviving forward keeps working', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager, created } = makeManager();
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    created[0].drop();

    // The drop alone triggers no reconnect, and forwardPort keeps returning
    // the surviving forward's local port without touching the tunnel.
    await expect(manager.forwardPort(port)).resolves.toBe(localPort);
    expect(created.length).toBe(1);

    // The first accepted connection reconnects and relays.
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('after reconnect');
    const received = collectUntil(client, payload.length);
    client.write(payload);
    expect((await received).equals(payload)).toBe(true);
    expect(created.length).toBe(2);
  });

  it('keeps a responsive shared tunnel healthy when heartbeat pongs arrive', async () => {
    const { manager, created } = makeManager({
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 30,
    });
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(4242);
    await waitFor(
      () => created[0].pingCount >= 2 && manager.getDiagnostics().heartbeat.lastPongAtMs !== null,
    );

    expect(created).toHaveLength(1);
    expect(manager.getDiagnostics()).toMatchObject({
      state: 'connected',
      generation: 1,
      forwards: [{ remotePort: 4242, localPort, streams: 0 }],
      streams: [],
      heartbeat: { enabled: true, awaitingPong: false },
    });
  });

  it('resets a nominally open stalled tunnel and eagerly reconnects after a missed heartbeat', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager, created } = makeManager({
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 20,
    });
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    const active = await connectClient(localPort);
    const payload = Buffer.from('before black hole');
    const received = collectUntil(active, payload.length);
    active.write(payload);
    expect((await received).equals(payload)).toBe(true);

    // The transport remains OPEN and emits no close/error, but its control
    // path stops answering pings — the half-open shape reported in #4615.
    created[0].autoPong = false;
    const activeClosed = waitForClose(active);
    await waitFor(
      () =>
        created[0].readyState === 3 &&
        created.length === 2 &&
        manager.getDiagnostics().state === 'connected',
    );
    await activeClosed;

    expect(manager.getDiagnostics()).toMatchObject({
      state: 'connected',
      generation: 2,
      forwards: [{ remotePort: port, localPort, streams: 0 }],
      streams: [],
      heartbeat: { enabled: true, awaitingPong: false },
    });

    const revived = await connectClient(localPort);
    onCleanup(() => revived.destroy());
    const after = Buffer.from('after heartbeat reconnect');
    const receivedAfter = collectUntil(revived, after.length);
    revived.write(after);
    expect((await receivedAfter).equals(after)).toBe(true);
    expect(created).toHaveLength(2);
  });

  it('times out one stalled OPEN without disturbing healthy streams on the shared tunnel', async () => {
    const healthy = await startEchoServer();
    onCleanup(() => healthy.server.close());
    const stalledPort = 4242;
    const { manager, created } = makeManager({ daemon: false, openTimeoutMs: 50 });
    onCleanup(() => manager.dispose());
    const healthyLocal = await manager.forwardPort(healthy.port);
    const stalledLocal = await manager.forwardPort(stalledPort);
    const ws = created[0];
    attachFakeDaemon(ws);
    const daemonHandler = ws.onFrame;
    ws.onFrame = (frame) => {
      if (frame.type === 'open' && frame.port === stalledPort) return;
      daemonHandler?.(frame);
    };

    const healthyClient = await connectClient(healthyLocal);
    onCleanup(() => healthyClient.destroy());
    const warmup = Buffer.from('healthy warmup');
    const warmupReceived = collectUntil(healthyClient, warmup.length);
    healthyClient.write(warmup);
    expect((await warmupReceived).equals(warmup)).toBe(true);

    const stalledClient = await connectClient(stalledLocal);
    const stalledClosed = waitForClose(stalledClient);
    await waitFor(() =>
      manager
        .getDiagnostics()
        .streams.some((stream) => stream.remotePort === stalledPort && stream.state === 'opening'),
    );
    await stalledClosed;

    expect(manager.getDiagnostics()).toMatchObject({
      state: 'connected',
      generation: 1,
      forwards: expect.arrayContaining([
        { remotePort: healthy.port, localPort: healthyLocal, streams: 1 },
        { remotePort: stalledPort, localPort: stalledLocal, streams: 0 },
      ]),
      streams: [expect.objectContaining({ remotePort: healthy.port, state: 'open' })],
    });
    const after = Buffer.from('healthy after stalled open');
    const afterReceived = collectUntil(healthyClient, after.length);
    healthyClient.write(after);
    expect((await afterReceived).equals(after)).toBe(true);
  });

  it('survives a client reset during the lazy-reconnect window (no uncaught error)', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const created: FakeTunnelSocket[] = [];
    const held: FakeTunnelSocket[] = [];
    let holdOpen = false;
    const manager = new TunnelManager({
      getConfig: () => WSS_CONFIG,
      socketFactory: () => {
        const ws = new FakeTunnelSocket();
        attachFakeDaemon(ws);
        created.push(ws);
        if (holdOpen) held.push(ws);
        else queueMicrotask(() => ws.open());
        return ws;
      },
    });
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    created[0].drop();
    holdOpen = true;

    // Accepted while the tunnel is down: the socket is held (paused) while
    // ensureTunnel() reconnects — the fresh socket stays unopened for now.
    const client = await connectClient(localPort);
    await waitFor(() => held.length === 1);
    // The client resets mid-window: the held server-side socket emits
    // 'error' (ECONNRESET). Without a listener attached before the pause,
    // this is an uncaught exception in the main process.
    client.resetAndDestroy();
    await delay(50);

    // The reconnect settles against the destroyed socket without crashing …
    held[0].open();
    await delay(20);
    // … the forward survives, and a fresh connection relays normally.
    expect(manager.activeForwards()).toEqual([{ remotePort: port, localPort }]);
    const fresh = await connectClient(localPort);
    onCleanup(() => fresh.destroy());
    const payload = Buffer.from('after reset');
    const received = collectUntil(fresh, payload.length);
    fresh.write(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('cleans up old streams when reconnecting past a CLOSING socket that never emitted close', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager, created } = makeManager();
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    const stale = await connectClient(localPort);
    const staleClosed = waitForClose(stale);
    await waitFor(() => created[0].sent.some((frame) => frame.type === 'open'));

    // The socket enters CLOSING but its 'close' event has not fired yet
    // (e.g. the close frame is in flight). The next accepted connection must
    // reconnect AND clean up the old socket's streams — otherwise their
    // frames would later land on the replacement with unknown stream IDs.
    created[0].readyState = 2; // CLOSING

    const fresh = await connectClient(localPort);
    onCleanup(() => fresh.destroy());
    const payload = Buffer.from('past closing');
    const received = collectUntil(fresh, payload.length);
    fresh.write(payload);
    expect((await received).equals(payload)).toBe(true);
    expect(created.length).toBe(2);
    // The stale in-flight socket was destroyed by the reconnect cleanup …
    await staleClosed;
    // … and the old socket's late 'close' must not disturb the new tunnel.
    created[0].drop();
    const again = Buffer.from('still relaying');
    const receivedAgain = collectUntil(fresh, again.length);
    fresh.write(again);
    expect((await receivedAgain).equals(again)).toBe(true);
  });

  it('notifies onForwardDropped for refused-OPEN drops and explicit closeForward', async () => {
    const healthy = await startEchoServer();
    onCleanup(() => healthy.server.close());
    // A remote port whose OPEN the scripted daemon refuses (#3596).
    const deadPort = REFUSED_PORT;
    const { manager } = makeManager({ refusedPorts: new Set([deadPort]) });
    onCleanup(() => manager.dispose());
    const dropped: number[] = [];
    manager.onForwardDropped = (remotePort) => dropped.push(remotePort);

    const deadLocal = await manager.forwardPort(deadPort);
    const refused = await connectClient(deadLocal);
    await waitForClose(refused);
    await waitFor(() => dropped.length === 1);
    expect(dropped).toEqual([deadPort]);

    await manager.forwardPort(healthy.port);
    expect(manager.closeForward(healthy.port)).toBe(true);
    expect(dropped).toEqual([deadPort, healthy.port]);
  });

  it('keeps an idle forward alive well past the old 10-minute idle timeout', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    // Fake the JS timers (real net I/O keeps flowing) so any lingering idle
    // sweep armed at construction/forward time would fire during the jump.
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    let localPort: number;
    try {
      const { manager } = makeManager();
      onCleanup(() => manager.dispose());
      localPort = await manager.forwardPort(port);
      vi.advanceTimersByTime(11 * 60_000);
      expect(manager.activeForwards()).toEqual([{ remotePort: port, localPort }]);
    } finally {
      vi.useRealTimers();
    }
    // The forward still accepts connections and relays after the idle jump.
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('still alive');
    const received = collectUntil(client, payload.length);
    client.write(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('pauses local sockets against ws.bufferedAmount and resumes on drain', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager, created } = makeManager({
      backpressureHighWaterMark: 1024,
      backpressurePollMs: 10,
    });
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const ws = created[0];

    // First payload flows and confirms the stream is open.
    const first = Buffer.from('warm-up');
    const gotFirst = collectUntil(client, first.length);
    client.write(first);
    await gotFirst;

    // Simulate a congested WebSocket: bufferedAmount above the mark. The
    // chunk that observes the congestion is still framed, then the local
    // socket is paused, so bytes written afterwards must NOT be framed.
    // Echoed bytes flushing locally still produce CREDIT frames; only
    // client → daemon DATA frames are the backpressure signal under test.
    const dataFrames = (): Array<Extract<TunnelFrame, { type: 'data' }>> =>
      ws.sent.filter((f): f is Extract<TunnelFrame, { type: 'data' }> => f.type === 'data');
    ws.bufferedAmount = 10_000;
    client.write(Buffer.alloc(2048, 1));
    await waitFor(() => dataFrames().length >= 2);
    const sentWhilePaused = dataFrames().length;
    client.write(Buffer.from('held back'));
    await delay(100);
    expect(dataFrames().length).toBe(sentWhilePaused);

    // Drain: the poll resumes the socket and the held bytes flow.
    ws.bufferedAmount = 0;
    await waitFor(() => dataFrames().length > sentWhilePaused);
    const last = dataFrames().at(-1)!;
    expect(last.payload.toString('utf8')).toContain('held back');
  });

  describe('daemon → client credit replenishment (intent-hq/intent#5482)', () => {
    const credits = (ws: FakeTunnelSocket, streamId: number): number[] =>
      ws.sent.flatMap((f) => (f.type === 'credit' && f.streamId === streamId ? [f.credit] : []));

    /** Open one stream on a scripted (daemon-less) tunnel; returns its id and client. */
    async function openStream(
      manager: TunnelManager,
      ws: FakeTunnelSocket,
      localPort: number,
    ): Promise<{ streamId: number; client: net.Socket }> {
      const before = ws.sent.filter((f) => f.type === 'open').length;
      const client = await connectClient(localPort);
      await waitFor(() => ws.sent.filter((f) => f.type === 'open').length === before + 1);
      const streamId = ws.sent.filter((f) => f.type === 'open').at(-1)!.streamId;
      ws.deliver({ type: 'openOk', streamId });
      await waitFor(() =>
        manager.getDiagnostics().streams.some((s) => s.streamId === streamId && s.state === 'open'),
      );
      return { streamId, client };
    }

    it('grants exactly the flushed bytes, coalesced at the 64 KiB threshold', async () => {
      const { manager, created } = makeManager({ daemon: false });
      onCleanup(() => manager.dispose());
      const localPort = await manager.forwardPort(10001);
      const ws = created[0];
      const { streamId, client } = await openStream(manager, ws, localPort);
      onCleanup(() => client.destroy());

      // Nothing is granted before any daemon → client byte has been flushed.
      expect(credits(ws, streamId)).toEqual([]);

      // 4 × 32 KiB delivered back to back: the first two flushes coalesce into
      // one 64 KiB grant; the last two are below the threshold until the
      // backlog is fully flushed, which grants the remainder immediately.
      const chunk = 32 * 1024;
      const received = collectUntil(client, 4 * chunk);
      for (let i = 0; i < 4; i++) {
        ws.deliver({ type: 'data', streamId, payload: Buffer.alloc(chunk, i + 1) });
      }
      const bytes = await received;
      expect(bytes.length).toBe(4 * chunk);
      await waitFor(() => credits(ws, streamId).reduce((a, b) => a + b, 0) === 4 * chunk);
      expect(credits(ws, streamId)).toEqual([64 * 1024, 2 * chunk]);

      // A small backlog below the threshold is granted as soon as it flushes.
      const small = Buffer.from('tail');
      const gotSmall = collectUntil(client, small.length);
      ws.deliver({ type: 'data', streamId, payload: small });
      await gotSmall;
      await waitFor(() => credits(ws, streamId).length === 3);
      expect(credits(ws, streamId)).toEqual([64 * 1024, 2 * chunk, small.length]);

      // Every CREDIT is a valid client → daemon frame on the wire.
      for (const frame of ws.sent.filter((f) => f.type === 'credit')) {
        const raw = encodeFrame(frame);
        expect(raw.readUInt8(0)).toBe(OP_CREDIT);
        expect(raw.readUInt32BE(1)).toBe(streamId);
        expect(raw.length).toBe(HEADER_LEN + 4);
        expect(raw.readUInt32BE(HEADER_LEN)).toBeGreaterThan(0);
      }
    });

    it('a local socket that never drains grants nothing while a sibling keeps granting', async () => {
      // Deterministic "never flushes" consumer: cork the accepted local socket
      // of the first stream so its writes stay in Node's buffer (kernel-buffer
      // stalls are timing-dependent). The manager code path is unchanged.
      const accepted: net.Socket[] = [];
      const realCreateServer = net.createServer;
      const spy = vi.spyOn(net, 'createServer').mockImplementation(((...args: unknown[]) => {
        const server = (realCreateServer as (...a: unknown[]) => net.Server)(...args);
        server.on('connection', (socket: net.Socket) => {
          if (accepted.length === 0) socket.cork();
          accepted.push(socket);
        });
        return server;
      }) as typeof net.createServer);
      onCleanup(() => spy.mockRestore());

      const { manager, created } = makeManager({ daemon: false });
      onCleanup(() => manager.dispose());
      const localPort = await manager.forwardPort(10001);
      const ws = created[0];
      const stalled = await openStream(manager, ws, localPort);
      onCleanup(() => stalled.client.destroy());
      const healthy = await openStream(manager, ws, localPort);
      onCleanup(() => healthy.client.destroy());
      expect(accepted).toHaveLength(2);
      expect(accepted[0].writableCorked).toBeGreaterThan(0);

      const chunk = 64 * 1024;
      const healthyReceived = collectUntil(healthy.client, 2 * chunk);
      for (let i = 0; i < 4; i++) {
        ws.deliver({ type: 'data', streamId: stalled.streamId, payload: Buffer.alloc(chunk, 7) });
      }
      ws.deliver({ type: 'data', streamId: healthy.streamId, payload: Buffer.alloc(chunk, 8) });
      ws.deliver({ type: 'data', streamId: healthy.streamId, payload: Buffer.alloc(chunk, 9) });
      await healthyReceived;
      await waitFor(() => credits(ws, healthy.streamId).reduce((a, b) => a + b, 0) === 2 * chunk);

      // The stalled stream still holds its bytes locally and has granted nothing.
      await delay(50);
      expect(credits(ws, stalled.streamId)).toEqual([]);
      expect(accepted[0].writableLength).toBe(4 * chunk);
      expect(
        manager
          .getDiagnostics()
          .streams.map((s) => s.streamId)
          .sort(),
      ).toEqual([stalled.streamId, healthy.streamId].sort());

      // Once the stalled socket flushes, only the flushed bytes are granted.
      const stalledReceived = collectUntil(stalled.client, 4 * chunk);
      accepted[0].uncork();
      await stalledReceived;
      await waitFor(() => credits(ws, stalled.streamId).reduce((a, b) => a + b, 0) === 4 * chunk);
      expect(credits(ws, stalled.streamId).every((c) => c > 0 && c <= 4 * chunk)).toBe(true);
    });

    it('does not grant credit for bytes still queued when the stream ends', async () => {
      const accepted: net.Socket[] = [];
      const realCreateServer = net.createServer;
      const spy = vi.spyOn(net, 'createServer').mockImplementation(((...args: unknown[]) => {
        const server = (realCreateServer as (...a: unknown[]) => net.Server)(...args);
        server.on('connection', (socket: net.Socket) => {
          socket.cork();
          accepted.push(socket);
        });
        return server;
      }) as typeof net.createServer);
      onCleanup(() => spy.mockRestore());

      const { manager, created } = makeManager({ daemon: false });
      onCleanup(() => manager.dispose());
      const localPort = await manager.forwardPort(10001);
      const ws = created[0];
      const { streamId, client } = await openStream(manager, ws, localPort);
      onCleanup(() => client.destroy());

      ws.deliver({ type: 'data', streamId, payload: Buffer.alloc(1024, 1) });
      await delay(20);
      expect(accepted[0].writableLength).toBe(1024);
      // The daemon tears the stream down while the bytes are still queued:
      // the destroyed socket's write callbacks fail and must not grant.
      ws.deliver({ type: 'close', streamId });
      await waitFor(() => !manager.getDiagnostics().streams.some((s) => s.streamId === streamId));
      await delay(50);
      expect(credits(ws, streamId)).toEqual([]);
    });

    it('ignores a daemon-sent CREDIT without disturbing the stream', async () => {
      const { manager, created } = makeManager({ daemon: false });
      onCleanup(() => manager.dispose());
      const localPort = await manager.forwardPort(10001);
      const ws = created[0];
      const { streamId, client } = await openStream(manager, ws, localPort);
      onCleanup(() => client.destroy());

      ws.deliver({ type: 'credit', streamId, credit: 1 });
      const payload = Buffer.from('still open');
      const got = collectUntil(client, payload.length);
      ws.deliver({ type: 'data', streamId, payload });
      expect((await got).toString('utf8')).toBe('still open');
      expect(manager.getDiagnostics().streams.some((s) => s.streamId === streamId)).toBe(true);
    });
  });

  it('shares one in-flight connect across concurrent forwardPort calls', async () => {
    const { server, port } = await startEchoServer();
    const second = await startEchoServer();
    onCleanup(() => {
      server.close();
      second.server.close();
    });
    const { manager, created } = makeManager();
    onCleanup(() => manager.dispose());
    await Promise.all([manager.forwardPort(port), manager.forwardPort(second.port)]);
    expect(created.length).toBe(1);
  });

  it('rejects ensureTunnel when there is no active config', async () => {
    const { manager } = makeManager({ config: null });
    onCleanup(() => manager.dispose());
    await expect(manager.forwardPort(80)).rejects.toThrow(/no active backend config/);
  });

  it('rejects invalid remote ports without touching the tunnel', async () => {
    const { manager, created } = makeManager();
    onCleanup(() => manager.dispose());
    await expect(manager.forwardPort(0)).rejects.toThrow(/invalid remote port/);
    await expect(manager.forwardPort(65536)).rejects.toThrow(/invalid remote port/);
    await expect(manager.forwardPort(1.5)).rejects.toThrow(/invalid remote port/);
    expect(created.length).toBe(0);
  });

  it('dispose tears everything down and further use is rejected', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager } = makeManager();
    const localPort = await manager.forwardPort(port);
    manager.dispose();
    await expect(connectClient(localPort)).rejects.toThrow();
    await expect(manager.forwardPort(port)).rejects.toThrow(/disposed/);
  });

  it('dispose during an in-flight connect terminates the pending socket', async () => {
    const created: FakeTunnelSocket[] = [];
    const manager = new TunnelManager({
      getConfig: () => WSS_CONFIG,
      socketFactory: () => {
        const ws = new FakeTunnelSocket();
        created.push(ws);
        return ws; // never opens — the connect stays in flight
      },
    });
    const pending = manager.forwardPort(80);
    pending.catch(() => {});
    await waitFor(() => created.length === 1);
    manager.dispose();
    // The pending socket was terminated, not left to open against the old backend.
    expect(created[0].readyState).toBe(3);
    await expect(pending).rejects.toThrow();
  });

  it('races wss candidate hosts and adopts the first socket to open (#1746)', async () => {
    const created: Array<{ host: string | undefined; ws: FakeTunnelSocket }> = [];
    const manager = new TunnelManager({
      getConfig: () => ({ ...WSS_CONFIG, host: '10.0.0.1', hosts: ['10.0.0.1', '127.0.0.1'] }),
      socketFactory: (config) => {
        const ws = new FakeTunnelSocket();
        created.push({ host: config.host, ws });
        if (config.host === '127.0.0.1') {
          attachFakeDaemon(ws);
          queueMicrotask(() => ws.open());
        }
        // The 10.0.0.1 candidate never opens (unreachable primary).
        return ws;
      },
    });
    onCleanup(() => manager.dispose());

    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const localPort = await manager.forwardPort(port);
    // One socket per candidate, the reachable secondary won, the loser was terminated.
    expect(created.map((c) => c.host)).toEqual(['10.0.0.1', '127.0.0.1']);
    expect(created[0].ws.readyState).toBe(3);

    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('via secondary candidate');
    const received = collectUntil(client, payload.length);
    client.write(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('rejects the connect only after every candidate host has failed', async () => {
    const created: FakeTunnelSocket[] = [];
    const manager = new TunnelManager({
      getConfig: () => ({ ...WSS_CONFIG, host: 'a', hosts: ['a', 'b'] }),
      socketFactory: () => {
        const ws = new FakeTunnelSocket();
        created.push(ws);
        return ws;
      },
    });
    onCleanup(() => manager.dispose());
    const pending = manager.forwardPort(80);
    pending.catch(() => {});
    await waitFor(() => created.length === 2);
    created[0].emit('error', new Error('candidate a refused'));
    // One failure alone must not settle the attempt.
    await delay(20);
    created[1].emit('error', new Error('candidate b refused'));
    await expect(pending).rejects.toThrow(/candidate b refused/);
  });

  it('sends the mux frames the daemon contract expects (OPEN with port, DATA, CLOSE)', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager, created } = makeManager();
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    const client = await connectClient(localPort);
    const payload = Buffer.from('wire check');
    const received = collectUntil(client, payload.length);
    client.write(payload);
    await received;
    client.destroy();
    const ws = created[0];
    await waitFor(() => ws.sent.some((f) => f.type === 'close'));

    const open = ws.sent.find((f) => f.type === 'open');
    expect(open).toEqual({ type: 'open', streamId: expect.any(Number), port });
    const data = ws.sent.find((f) => f.type === 'data');
    expect(data).toMatchObject({ streamId: open!.streamId });
    expect((data as Extract<TunnelFrame, { type: 'data' }>).payload.equals(payload)).toBe(true);
    // Raw wire bytes: opcode + BE streamId + payload.
    const raw = encodeFrame(data!);
    expect(raw.readUInt8(0)).toBe(OP_DATA);
    expect(raw.readUInt32BE(1)).toBe(open!.streamId);
    expect(raw.subarray(HEADER_LEN).equals(payload)).toBe(true);
  });
});

// The `ws` package is CJS and the vitest suite aliases the ESM import to a
// browser-safe stub (see `vitest.config.ts`); `createRequire` sidesteps both.
const nodeRequire = createRequire(import.meta.url);
const { WebSocketServer } = nodeRequire('ws') as typeof import('ws');

// Self-signed EC (P-256) cert + key — the same stable identity
// `backend-connection.test.ts` pins (subject/issuer CN=localhost, SAN
// DNS:localhost + IP:127.0.0.1, 10y validity), duplicated here so this suite
// stays self-contained. The fingerprint is derived via `crypto.X509Certificate`
// rather than hardcoded.
const WSS_CERT_PEM = Buffer.from(
  'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJtVENDQVQrZ0F3SUJBZ0lVWVlzc05zWkxXdTZXZXdkb2p6UlpFY3k0LzRzd0NnWUlLb1pJemowRUF3SXcKRkRFU01CQUdBMVVFQXd3SmJHOWpZV3hvYjNOME1CNFhEVEkyTURnd056QXhOVGt6TkZvWERUTTJNRGd3TkRBeApOVGt6TkZvd0ZERVNNQkFHQTFVRUF3d0piRzlqWVd4b2IzTjBNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBECkFRY0RRZ0FFSlkvM2I0RHdRQXAyVVdIay84SGljZEFxaVdXL0pBVnRtMkRFbmUrZ3RBa0daVmo1VGlYUDZBREkKeXltbEc0bWRWU25QVUtXS2NUYmFxT3NWZVVGd2Y2TnZNRzB3SFFZRFZSME9CQllFRk80WTZBc2c2NEJVV1RhQgo2SzBUeDgvczR2S21NQjhHQTFVZEl3UVlNQmFBRk80WTZBc2c2NEJVV1RhQjZLMFR4OC9zNHZLbU1BOEdBMVVkCkV3RUIvd1FGTUFNQkFmOHdHZ1lEVlIwUkJCTXdFWUlKYkc5allXeG9iM04waHdSL0FBQUJNQW9HQ0NxR1NNNDkKQkFNQ0EwZ0FNRVVDSVFET3hKTXBKcy9DcmQwOG95U2tGdVRueVo0c3VqVklvL3BDK1RVWUpRMEY5UUlnU2pvagppWG56RlZ0Q1U0Wll2VWFtRkc0bFNUYmlQano5QXlubWxpSkI1a289Ci0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K',
  'base64',
).toString('utf8');

const WSS_KEY_PEM = Buffer.from(
  'LS0tLS1CRUdJTiBFQyBQQVJBTUVURVJTLS0tLS0KQmdncWhrak9QUU1CQnc9PQotLS0tLUVORCBFQyBQQVJBTUVURVJTLS0tLS0KLS0tLS1CRUdJTiBFQyBQUklWQVRFIEtFWS0tLS0tCk1IY0NBUUVFSVBLTnFYZll2aEdqbDErMmNpMmEyOFZDNC9BbTVWLzBOV1JvS0cxeWlLbWFvQW9HQ0NxR1NNNDkKQXdFSG9VUURRZ0FFSlkvM2I0RHdRQXAyVVdIay84SGljZEFxaVdXL0pBVnRtMkRFbmUrZ3RBa0daVmo1VGlYUAo2QURJeXltbEc0bWRWU25QVUtXS2NUYmFxT3NWZVVGd2Z3PT0KLS0tLS1FTkQgRUMgUFJJVkFURSBLRVktLS0tLQo=',
  'base64',
).toString('utf8');

/** Coerce a `ws` RawData message into one Buffer. */
function rawDataToBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(String(data), 'utf8');
}

/**
 * Fake `/tunnel` WSS daemon: an HTTPS server presenting the pinned self-signed
 * cert with a `ws` upgrade handler speaking a minimal mux — OPEN → OPEN_OK,
 * DATA echoed back on the same stream — so a real TunnelManager can run a
 * forward end to end. Mirrors `FakeWssDaemon` in `backend-connection.test.ts`:
 * decrypted-byte accounting on every TLS session plus `lastAuthHeader` /
 * `lastUpgradeUrl` sentinels for the token-leak assertions (monorepo#4072).
 */
class FakeTunnelWssDaemon {
  private server!: https.Server;
  private wss!: import('ws').WebSocketServer;
  host = '127.0.0.1';
  port = 0;
  fingerprint = '';
  lastAuthHeader: string | undefined;
  lastUpgradeUrl: string | undefined;
  /** Decrypted application bytes received across all TLS sessions. */
  decryptedBytes = 0;
  private clients: import('ws').WebSocket[] = [];

  async start(): Promise<void> {
    this.fingerprint = new crypto.X509Certificate(WSS_CERT_PEM).fingerprint256;
    this.server = https.createServer({ cert: WSS_CERT_PEM, key: WSS_KEY_PEM });
    this.server.on('secureConnection', (socket) => {
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
        if (!isBinary) return;
        const frame = decodeFrame(rawDataToBuffer(data));
        if (frame.type === 'open') {
          socket.send(encodeFrame({ type: 'openOk', streamId: frame.streamId }));
        } else if (frame.type === 'data') {
          socket.send(
            encodeFrame({ type: 'data', streamId: frame.streamId, payload: frame.payload }),
          );
        }
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

/**
 * TLS server that REJECTS every `/tunnel` upgrade with a fixed HTTP status —
 * the daemon's auth-rejection shape (PROTOCOL §2.1). Presents the same pinned
 * cert as {@link FakeTunnelWssDaemon} so only the upgrade outcome differs.
 */
class RejectingTunnelDaemon {
  private server!: https.Server;
  host = '127.0.0.1';
  port = 0;
  fingerprint = '';
  statusCode = 401;

  async start(): Promise<void> {
    this.fingerprint = new crypto.X509Certificate(WSS_CERT_PEM).fingerprint256;
    this.server = https.createServer({ cert: WSS_CERT_PEM, key: WSS_KEY_PEM });
    this.server.on('upgrade', (_req, socket) => {
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

describe('tunnel wss wire-level pinning (handshake-enforced, monorepo#4072)', () => {
  let daemon: FakeTunnelWssDaemon;
  const TOKEN = 'c'.repeat(64);
  const cleanups: Array<() => void | Promise<void>> = [];
  const onCleanup = (fn: () => void | Promise<void>): void => {
    cleanups.push(fn);
  };

  beforeAll(async () => {
    daemon = new FakeTunnelWssDaemon();
    await daemon.start();
  });

  afterAll(async () => {
    await daemon.stop();
  });

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  function makeWireManager(fingerprint: string): TunnelManager {
    // No socketFactory override: the REAL createTunnelSocket dials the fake
    // daemon over TLS, so the handshake-level pin is what's under test.
    const manager = new TunnelManager({
      getConfig: () => ({
        transport: 'wss',
        host: daemon.host,
        port: daemon.port,
        token: TOKEN,
        fingerprint,
      }),
      connectTimeoutMs: 2000,
    });
    onCleanup(() => manager.dispose());
    return manager;
  }

  it('a matching pin opens the tunnel end to end and presents the bearer token', async () => {
    const manager = makeWireManager(daemon.fingerprint);
    const localPort = await manager.forwardPort(4242);
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('through the pinned tunnel');
    const received = collectUntil(client, payload.length);
    client.write(payload);
    expect((await received).equals(payload)).toBe(true);
    // Bearer token presented on the upgrade (PROTOCOL §2.1), plus the
    // `?token=` query fallback on the `/tunnel` path.
    expect(daemon.lastAuthHeader).toBe(`Bearer ${TOKEN}`);
    expect(daemon.lastUpgradeUrl).toContain('/tunnel');
  });

  it('a mismatching pin aborts the tunnel before any request byte reaches the host', async () => {
    // Tunnel arm of the token-before-trust leak (monorepo#4072): the pin is
    // enforced at the TLS handshake, so the upgrade request — carrying the
    // bearer token in the Authorization header and the `?token=` query — is
    // never written to a host presenting the wrong certificate.
    daemon.lastAuthHeader = 'sentinel-not-overwritten';
    daemon.lastUpgradeUrl = 'sentinel-not-overwritten';
    const before = daemon.decryptedBytes;
    const wrong = Array.from({ length: 32 }, () => 'FF').join(':');
    const manager = makeWireManager(wrong);
    const error = await manager.ensureTunnel().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PinMismatchError);
    expect((error as PinMismatchError).actual).toBe(daemon.fingerprint);
    // Let any in-flight server-side handshake/data events settle, then assert
    // not one decrypted application byte — no upgrade request, no
    // Authorization header, no token query — reached the host.
    await delay(200);
    expect(daemon.decryptedBytes).toBe(before);
    expect(daemon.lastAuthHeader).toBe('sentinel-not-overwritten');
    expect(daemon.lastUpgradeUrl).toBe('sentinel-not-overwritten');
  });

  it('classifies a 401 upgrade rejection from a pin-matching host as AuthRejectedError', async () => {
    // Classification order unchanged: the pin (verified at the handshake)
    // decides trust first; only then is the daemon's 401/403 read as an auth
    // rejection.
    const rejecting = new RejectingTunnelDaemon();
    await rejecting.start();
    onCleanup(() => rejecting.stop());
    const manager = new TunnelManager({
      getConfig: () => ({
        transport: 'wss',
        host: rejecting.host,
        port: rejecting.port,
        token: TOKEN,
        fingerprint: rejecting.fingerprint,
      }),
      connectTimeoutMs: 2000,
    });
    onCleanup(() => manager.dispose());
    const error = await manager.ensureTunnel().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthRejectedError);
    expect((error as AuthRejectedError).statusCode).toBe(401);
  });
});
