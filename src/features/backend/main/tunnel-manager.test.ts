/**
 * Unit tests for the `/tunnel` port-forwarding client (TunnelManager).
 *
 * The WebSocket is mocked with a scripted in-memory fake whose "daemon side"
 * implements the same mux semantics as `intent-transport/src/tunnel.rs`
 * (OPEN → real TCP connect on loopback, DATA/EOF/CLOSE relay), so the manager
 * is exercised against real ephemeral TCP sockets on both ends without a
 * network WebSocket in between.
 */
import { EventEmitter } from 'node:events';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import type { BackendConnectionConfig } from './backend-connection';
import {
  decodeFrame,
  encodeFrame,
  FrameDecodeError,
  HEADER_LEN,
  isConnectionRefusedOpenErr,
  MAX_DATA_PAYLOAD_BYTES,
  OP_DATA,
  TunnelManager,
  type TunnelFrame,
  type TunnelSocketLike,
} from './tunnel-manager';

/** Scripted stand-in for the `/tunnel` `ws.WebSocket`. */
class FakeTunnelSocket extends EventEmitter implements TunnelSocketLike {
  readyState = 0; // CONNECTING
  bufferedAmount = 0;
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
  ws.onFrame = (frame) => {
    if (frame.type === 'open') {
      const socket = net.connect({ host: '127.0.0.1', port: frame.port });
      const streamId = frame.streamId;
      socket.on('connect', () => {
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

const WSS_CONFIG: BackendConnectionConfig = {
  transport: 'wss',
  host: '127.0.0.1',
  port: 9999,
  token: 'test-token',
  fingerprint: 'AA:BB',
};

/** Manager + fake-socket harness with per-test option overrides. */
function makeManager(options: {
  idleTimeoutMs?: number;
  idleCheckIntervalMs?: number;
  backpressureHighWaterMark?: number;
  openTimeoutMs?: number;
  connectTimeoutMs?: number;
  daemon?: boolean;
  config?: BackendConnectionConfig | null;
} = {}): { manager: TunnelManager; created: FakeTunnelSocket[] } {
  const created: FakeTunnelSocket[] = [];
  const manager = new TunnelManager({
    getConfig: () => (options.config === undefined ? WSS_CONFIG : options.config),
    socketFactory: () => {
      const ws = new FakeTunnelSocket();
      if (options.daemon !== false) attachFakeDaemon(ws);
      created.push(ws);
      queueMicrotask(() => ws.open());
      return ws;
    },
    ...options,
  });
  return { manager, created };
}

/** Loopback echo server on an ephemeral port. */
async function startEchoServer(): Promise<{ port: number; server: net.Server }> {
  const server = net.createServer((socket) => socket.pipe(socket));
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
    ];
    for (const frame of frames) {
      expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
    }
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
    expect(
      isConnectionRefusedOpenErr('connect 127.0.0.1:8080: timed out after 10s'),
    ).toBe(false);
    expect(isConnectionRefusedOpenErr('too many streams')).toBe(false);
    expect(
      isConnectionRefusedOpenErr('connect 127.0.0.1:8080: Network unreachable (os error 101)'),
    ).toBe(false);
    expect(isConnectionRefusedOpenErr('')).toBe(false);
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
    const clients = await Promise.all(
      Array.from({ length: 5 }, () => connectClient(localPort)),
    );
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
    // A port with nothing listening: grab an ephemeral port then release it.
    const probe = await startEchoServer();
    const deadPort = probe.port;
    await new Promise<void>((resolve) => probe.server.close(() => resolve()));

    const { manager } = makeManager();
    onCleanup(() => manager.dispose());
    const localPort = await manager.forwardPort(deadPort);
    const client = await connectClient(localPort);
    await waitForClose(client);
    expect(client.destroyed).toBe(true);
  });

  it('drops the whole forward on a refused OPEN, leaving other forwards intact (#2537)', async () => {
    const healthy = await startEchoServer();
    onCleanup(() => healthy.server.close());
    // A port with nothing listening: grab an ephemeral port then release it.
    const probe = await startEchoServer();
    const deadPort = probe.port;
    await new Promise<void>((resolve) => probe.server.close(() => resolve()));

    const { manager } = makeManager();
    onCleanup(() => manager.dispose());
    const healthyLocal = await manager.forwardPort(healthy.port);
    const healthyClient = await connectClient(healthyLocal);
    onCleanup(() => healthyClient.destroy());

    const deadLocal = await manager.forwardPort(deadPort);
    expect(manager.activeForwards().length).toBe(2);
    const refused = await connectClient(deadLocal);
    await waitForClose(refused);

    // The refused forward is gone without waiting for the idle sweep …
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
    const probe = await startEchoServer();
    const deadPort = probe.port;
    await new Promise<void>((resolve) => probe.server.close(() => resolve()));

    const { manager } = makeManager();
    onCleanup(() => manager.dispose());
    const staleLocal = await manager.forwardPort(deadPort);
    const refused = await connectClient(staleLocal);
    await waitForClose(refused);
    await waitFor(() => manager.activeForwards().length === 0);

    // The server comes back on the same remote port; the next forwardPort
    // builds a fresh forward instead of returning the dropped one.
    const revived = net.createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve, reject) => {
      revived.once('error', reject);
      revived.listen(deadPort, '127.0.0.1', () => resolve());
    });
    onCleanup(() => revived.close());

    const freshLocal = await manager.forwardPort(deadPort);
    expect(manager.activeForwards()).toEqual([
      { remotePort: deadPort, localPort: freshLocal },
    ]);
    const client = await connectClient(freshLocal);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('recreated');
    const received = collectUntil(client, payload.length);
    client.write(payload);
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

  it('tears down local servers and sockets when the tunnel drops', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager, created } = makeManager();
    onCleanup(() => manager.dispose());

    const localPort = await manager.forwardPort(port);
    const client = await connectClient(localPort);
    const closed = waitForClose(client);
    created[0].drop();
    await closed;
    expect(manager.activeForwards()).toEqual([]);
    // The local listener is gone: a fresh connect must fail.
    await expect(connectClient(localPort)).rejects.toThrow();
  });

  it('reconnects lazily after a drop and the new forward works', async () => {
    const { server, port } = await startEchoServer();
    onCleanup(() => server.close());
    const { manager, created } = makeManager();
    onCleanup(() => manager.dispose());

    await manager.forwardPort(port);
    created[0].drop();
    await waitFor(() => manager.activeForwards().length === 0);

    const localPort = await manager.forwardPort(port);
    expect(created.length).toBe(2);
    const client = await connectClient(localPort);
    onCleanup(() => client.destroy());
    const payload = Buffer.from('after reconnect');
    const received = collectUntil(client, payload.length);
    client.write(payload);
    expect((await received).equals(payload)).toBe(true);
  });

  it('closes idle forwards after the idle timeout, keeping active ones', async () => {
    const idle = await startEchoServer();
    const busy = await startEchoServer();
    onCleanup(() => {
      idle.server.close();
      busy.server.close();
    });
    const { manager } = makeManager({ idleTimeoutMs: 150, idleCheckIntervalMs: 25 });
    onCleanup(() => manager.dispose());

    const idleLocal = await manager.forwardPort(idle.port);
    const busyLocal = await manager.forwardPort(busy.port);
    const client = await connectClient(busyLocal);
    onCleanup(() => client.destroy());

    await waitFor(() => manager.activeForwards().length === 1);
    expect(manager.activeForwards()).toEqual([{ remotePort: busy.port, localPort: busyLocal }]);
    await expect(connectClient(idleLocal)).rejects.toThrow();
    // The busy forward still relays.
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
    ws.bufferedAmount = 10_000;
    client.write(Buffer.alloc(2048, 1));
    await waitFor(() => ws.sent.filter((f) => f.type === 'data').length >= 2);
    const sentWhilePaused = ws.sent.length;
    client.write(Buffer.from('held back'));
    await delay(100);
    expect(ws.sent.length).toBe(sentWhilePaused);

    // Drain: the poll resumes the socket and the held bytes flow.
    ws.bufferedAmount = 0;
    await waitFor(() => ws.sent.length > sentWhilePaused);
    const last = ws.sent[ws.sent.length - 1];
    expect(last.type).toBe('data');
    expect(
      (last as Extract<TunnelFrame, { type: 'data' }>).payload.toString('utf8'),
    ).toContain('held back');
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
