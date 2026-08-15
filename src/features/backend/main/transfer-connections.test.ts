/**
 * Per-transfer JSON-RPC connections for bulk payloads (monorepo#2458):
 * a slow-draining transfer never head-of-line-blocks the main channel,
 * at most 4 transfer connections are open at once (FIFO waiting above
 * that), every settle path disposes its socket, and the chunked upload
 * session rides one socket keyed by uploadId.
 */
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendConnectionConfig } from './backend-connection';
import { JsonRpcClient } from './json-rpc-client';
import {
  __getActiveTransferCountForTesting,
  __resetTransferConnectionsForTesting,
  __setTransferClientFactoryForTesting,
  acquireTransferConnection,
  disposeAllTransferConnections,
  isTransferMethod,
  MAX_TRANSFER_CONNECTIONS,
  requestOverTransferConnection,
  shouldUseTransferConnection,
  TRANSFER_REQUEST_TIMEOUT_MS,
  withTransferConnection,
} from './transfer-connections';

/** In-memory fake socket (same shape as json-rpc-client.test.ts). */
class FakeSocket extends EventEmitter {
  writes: string[] = [];
  destroyed = false;

  write(data: string): boolean {
    this.writes.push(data);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  receive(chunk: string): void {
    this.emit('data', Buffer.from(chunk));
  }

  open(): void {
    this.emit('connect');
  }
}

const wssConfig: BackendConnectionConfig = {
  transport: 'wss',
  host: 'remote.example',
  port: 5181,
  token: 'test-token',
};

/**
 * Install a transfer-client factory backed by FakeSockets that auto-open on
 * the next macrotask, and track every created socket + client.
 */
function installFakeFactory(options: { requestTimeoutMs?: number; autoOpen?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  const clients: JsonRpcClient[] = [];
  __setTransferClientFactoryForTesting((config) => {
    const client = new JsonRpcClient({
      config,
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        if (options.autoOpen !== false) {
          queueMicrotask(() => socket.open());
        }
        return socket as unknown as Duplex;
      },
      heartbeatIntervalMs: 0,
      requestTimeoutMs: options.requestTimeoutMs ?? 1000,
    });
    clients.push(client);
    return client;
  });
  return { sockets, clients };
}

/** Await the microtask queue so socket-open + request writes settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Respond to the last write on `socket` with `result`. */
function respondLast(socket: FakeSocket, result: unknown): void {
  const frame = JSON.parse(socket.writes[socket.writes.length - 1]);
  socket.receive(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result })}\n`);
}

afterEach(() => {
  __resetTransferConnectionsForTesting();
  __setTransferClientFactoryForTesting(null);
  vi.useRealTimers();
});

describe('isTransferMethod', () => {
  it('matches exactly the attachment placement + chunked upload calls', () => {
    for (const method of [
      'file.placeAttachment',
      'file.attachmentUpload.begin',
      'file.attachmentUpload.chunk',
      'file.attachmentUpload.commit',
      'file.attachmentUpload.abort',
    ]) {
      expect(isTransferMethod(method)).toBe(true);
    }
    for (const method of ['host.status', 'file.read', 'events.subscribe', 'file.getAttachmentInfo']) {
      expect(isTransferMethod(method)).toBe(false);
    }
  });
});

describe('shouldUseTransferConnection', () => {
  it('routes transfer methods on remote transports only — local UDS is unaffected', () => {
    const udsConfig: BackendConnectionConfig = { transport: 'uds', socketPath: '/tmp/i.sock' };
    expect(shouldUseTransferConnection('file.placeAttachment', wssConfig)).toBe(true);
    expect(shouldUseTransferConnection('file.attachmentUpload.chunk', wssConfig)).toBe(true);
    expect(shouldUseTransferConnection('file.placeAttachment', udsConfig)).toBe(false);
    expect(shouldUseTransferConnection('file.attachmentUpload.chunk', udsConfig)).toBe(false);
    expect(shouldUseTransferConnection('host.status', wssConfig)).toBe(false);
  });
});

describe('withTransferConnection', () => {
  it('runs the transfer on its own connection and disposes it on success', async () => {
    const { sockets, clients } = installFakeFactory();

    const result = await withTransferConnection(wssConfig, async (connection) => {
      const promise = connection.request('file.placeAttachment', { workspaceId: 'ws-1' });
      await flush();
      expect(sockets).toHaveLength(1);
      respondLast(sockets[0], { ok: true, attachmentId: 'att-1' });
      return promise;
    });

    expect(result).toEqual({ ok: true, attachmentId: 'att-1' });
    expect(clients[0].getStatus()).toBe('disconnected');
    expect(__getActiveTransferCountForTesting()).toBe(0);
  });

  it('disposes the connection and releases the slot on failure', async () => {
    const { sockets, clients } = installFakeFactory();

    await expect(
      withTransferConnection(wssConfig, async (connection) => {
        const promise = connection.request('file.placeAttachment', { workspaceId: 'ws-1' });
        await flush();
        sockets[0].emit('error', new Error('connection reset'));
        return promise;
      }),
    ).rejects.toThrow();

    expect(clients[0].getStatus()).toBe('disconnected');
    expect(__getActiveTransferCountForTesting()).toBe(0);
  });
});

describe('concurrency cap', () => {
  it(`caps open transfer connections at ${MAX_TRANSFER_CONNECTIONS}; a 5th waits FIFO and starts when one settles`, async () => {
    installFakeFactory();

    const leases = await Promise.all(
      Array.from({ length: MAX_TRANSFER_CONNECTIONS }, () =>
        acquireTransferConnection(wssConfig),
      ),
    );
    expect(__getActiveTransferCountForTesting()).toBe(MAX_TRANSFER_CONNECTIONS);

    // 5th and 6th queue behind the cap, in order.
    const fifthStarted = vi.fn();
    const sixthStarted = vi.fn();
    const fifth = acquireTransferConnection(wssConfig).then((lease) => {
      fifthStarted();
      return lease;
    });
    const sixth = acquireTransferConnection(wssConfig).then((lease) => {
      sixthStarted();
      return lease;
    });
    await flush();
    expect(fifthStarted).not.toHaveBeenCalled();
    expect(sixthStarted).not.toHaveBeenCalled();

    // One transfer settles → exactly the FIRST waiter starts.
    leases[0].release();
    await flush();
    expect(fifthStarted).toHaveBeenCalled();
    expect(sixthStarted).not.toHaveBeenCalled();
    expect(__getActiveTransferCountForTesting()).toBe(MAX_TRANSFER_CONNECTIONS);

    leases[1].release();
    await flush();
    expect(sixthStarted).toHaveBeenCalled();

    (await fifth).release();
    (await sixth).release();
    leases[2].release();
    leases[3].release();
    expect(__getActiveTransferCountForTesting()).toBe(0);
  });

  it('a failing transfer releases its slot for the next waiter', async () => {
    const { sockets } = installFakeFactory();

    const running = Array.from({ length: MAX_TRANSFER_CONNECTIONS }, () =>
      withTransferConnection(wssConfig, async (connection) => {
        return connection.request('file.placeAttachment', { workspaceId: 'ws-1' });
      }),
    );
    await flush();
    expect(sockets).toHaveLength(MAX_TRANSFER_CONNECTIONS);

    const waiterStarted = vi.fn();
    const waiter = withTransferConnection(wssConfig, async (connection) => {
      waiterStarted();
      const promise = connection.request('file.placeAttachment', { workspaceId: 'ws-1' });
      await flush();
      respondLast(sockets[sockets.length - 1], { ok: true });
      return promise;
    });
    await flush();
    expect(waiterStarted).not.toHaveBeenCalled();

    // Fail one in-flight transfer: its slot frees and the waiter starts.
    sockets[0].emit('error', new Error('connection reset'));
    await expect(running[0]).rejects.toThrow();
    await expect(waiter).resolves.toEqual({ ok: true });

    for (let i = 1; i < MAX_TRANSFER_CONNECTIONS; i++) {
      respondLast(sockets[i], { ok: true });
      await expect(running[i]).resolves.toEqual({ ok: true });
    }
    expect(__getActiveTransferCountForTesting()).toBe(0);
  });
});

describe('chunked upload session routing', () => {
  it('runs begin/chunk/commit on ONE connection keyed by uploadId, then disposes it', async () => {
    const { sockets, clients } = installFakeFactory();

    const begin = requestOverTransferConnection(wssConfig, 'file.attachmentUpload.begin', {
      workspaceId: 'ws-1',
      fileName: 'big.zip',
    });
    await flush();
    expect(sockets).toHaveLength(1);
    respondLast(sockets[0], { uploadId: 'up-1', maxChunkBytes: 16 * 1024 * 1024 });
    await expect(begin).resolves.toEqual({ uploadId: 'up-1', maxChunkBytes: 16 * 1024 * 1024 });
    expect(__getActiveTransferCountForTesting()).toBe(1);

    const chunk = requestOverTransferConnection(wssConfig, 'file.attachmentUpload.chunk', {
      uploadId: 'up-1',
      seq: 0,
      data: 'AAAA',
    });
    await flush();
    // Same socket — no new connection for the chunk.
    expect(sockets).toHaveLength(1);
    respondLast(sockets[0], { uploadId: 'up-1', seq: 0, receivedBytes: 3 });
    await expect(chunk).resolves.toEqual({ uploadId: 'up-1', seq: 0, receivedBytes: 3 });

    const commit = requestOverTransferConnection(wssConfig, 'file.attachmentUpload.commit', {
      uploadId: 'up-1',
    });
    await flush();
    expect(sockets).toHaveLength(1);
    respondLast(sockets[0], { ok: true, attachmentId: 'att-1' });
    await expect(commit).resolves.toEqual({ ok: true, attachmentId: 'att-1' });

    // Commit settles the transfer: socket disposed, slot released.
    expect(clients[0].getStatus()).toBe('disconnected');
    expect(__getActiveTransferCountForTesting()).toBe(0);
  });

  it('abort rides the session connection and disposes it (error path)', async () => {
    const { sockets, clients } = installFakeFactory();

    const begin = requestOverTransferConnection(wssConfig, 'file.attachmentUpload.begin', {
      workspaceId: 'ws-1',
      fileName: 'big.zip',
    });
    await flush();
    respondLast(sockets[0], { uploadId: 'up-2', maxChunkBytes: 1024 });
    await begin;

    const abort = requestOverTransferConnection(wssConfig, 'file.attachmentUpload.abort', {
      uploadId: 'up-2',
    });
    await flush();
    expect(sockets).toHaveLength(1);
    respondLast(sockets[0], { uploadId: 'up-2', aborted: true });
    await expect(abort).resolves.toEqual({ uploadId: 'up-2', aborted: true });

    expect(clients[0].getStatus()).toBe('disconnected');
    expect(__getActiveTransferCountForTesting()).toBe(0);
  });

  it('releases the connection when begin itself fails', async () => {
    const { sockets, clients } = installFakeFactory();

    const begin = requestOverTransferConnection(wssConfig, 'file.attachmentUpload.begin', {
      workspaceId: 'ws-1',
      fileName: 'big.zip',
    });
    await flush();
    sockets[0].emit('error', new Error('connection reset'));
    await expect(begin).rejects.toThrow();

    expect(clients[0].getStatus()).toBe('disconnected');
    expect(__getActiveTransferCountForTesting()).toBe(0);
  });

  it('a failed commit still disposes the session connection (abort then falls back to a one-shot connection)', async () => {
    const { sockets, clients } = installFakeFactory();

    const begin = requestOverTransferConnection(wssConfig, 'file.attachmentUpload.begin', {
      workspaceId: 'ws-1',
      fileName: 'big.zip',
    });
    await flush();
    respondLast(sockets[0], { uploadId: 'up-3', maxChunkBytes: 1024 });
    await begin;

    const commit = requestOverTransferConnection(wssConfig, 'file.attachmentUpload.commit', {
      uploadId: 'up-3',
    });
    await flush();
    const frame = JSON.parse(sockets[0].writes[sockets[0].writes.length - 1]);
    sockets[0].receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: frame.id,
        error: { code: -32602, message: 'sha256 mismatch' },
      })}\n`,
    );
    await expect(commit).rejects.toThrow(/sha256 mismatch/);
    expect(clients[0].getStatus()).toBe('disconnected');
    expect(__getActiveTransferCountForTesting()).toBe(0);

    // The renderer's follow-up abort has no session connection left — it
    // settles the daemon-side session over a fresh one-shot connection.
    const abort = requestOverTransferConnection(wssConfig, 'file.attachmentUpload.abort', {
      uploadId: 'up-3',
    });
    await flush();
    expect(sockets).toHaveLength(2);
    respondLast(sockets[1], { uploadId: 'up-3', aborted: true });
    await expect(abort).resolves.toEqual({ uploadId: 'up-3', aborted: true });
    expect(clients[1].getStatus()).toBe('disconnected');
    expect(__getActiveTransferCountForTesting()).toBe(0);
  });

  it('fails a chunk for an unknown uploadId without opening a connection', async () => {
    const { sockets } = installFakeFactory();
    await expect(
      requestOverTransferConnection(wssConfig, 'file.attachmentUpload.chunk', {
        uploadId: 'up-gone',
        seq: 0,
        data: 'AAAA',
      }),
    ).rejects.toThrow(/no live transfer connection/);
    expect(sockets).toHaveLength(0);
  });
});

describe('disposeAllTransferConnections', () => {
  it('disposes open connections, clears sessions, and fails queued waiters (backend switch)', async () => {
    const { clients } = installFakeFactory();

    const leases = await Promise.all(
      Array.from({ length: MAX_TRANSFER_CONNECTIONS }, () =>
        acquireTransferConnection(wssConfig),
      ),
    );
    const waiter = acquireTransferConnection(wssConfig);
    const waiterExpectation = expect(waiter).rejects.toThrow(/disposed/);

    disposeAllTransferConnections();
    await waiterExpectation;
    for (const client of clients) {
      expect(client.getStatus()).toBe('disconnected');
    }
    expect(__getActiveTransferCountForTesting()).toBe(0);
    // Releasing an already-released lease is a no-op (idempotent).
    for (const lease of leases) lease.release();
    expect(__getActiveTransferCountForTesting()).toBe(0);
  });
});

describe('main-channel isolation (regression, monorepo#2458)', () => {
  it('a slow-draining transfer connection does not delay main-channel requests or the heartbeat', async () => {
    vi.useFakeTimers();

    // Main channel: own socket, 1s heartbeat probing host.status with a
    // strict threshold — exactly the production posture that used to trip.
    const mainSocket = new FakeSocket();
    const heartbeatProbes: number[] = [];
    const mainClient = new JsonRpcClient({
      socketFactory: () => mainSocket as unknown as Duplex,
      heartbeatIntervalMs: 1000,
      requestTimeoutMs: 500,
      healthCheck: async () => {
        const probe = mainClient.request('host.status');
        await flushProbe();
        heartbeatProbes.push(mainSocket.writes.length - 1);
        respondLast(mainSocket, { ok: true });
        await probe;
      },
      healthCheckFailureThreshold: 2,
    });
    const connectionFailed = vi.fn();
    mainClient.on('status', (status: string) => {
      if (status === 'disconnected') connectionFailed();
    });
    const flushProbe = () => vi.advanceTimersByTimeAsync(0);
    mainClient.start();
    mainSocket.open();

    // Transfer connection: its socket accepts the huge frame but NEVER
    // answers within the main channel's timeout window (slow uplink).
    const { sockets: transferSockets } = installFakeFactory({
      requestTimeoutMs: TRANSFER_REQUEST_TIMEOUT_MS,
    });
    const transfer = requestOverTransferConnection(wssConfig, 'file.placeAttachment', {
      workspaceId: 'ws-1',
      data: 'A'.repeat(1024),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(transferSockets).toHaveLength(1);

    // While the transfer is stalled, main-channel requests answer promptly…
    const mainRequest = mainClient.request('workspace.list');
    await vi.advanceTimersByTimeAsync(0);
    respondLast(mainSocket, { workspaces: [] });
    await expect(mainRequest).resolves.toEqual({ workspaces: [] });

    // …and several heartbeat ticks pass without a single failure.
    await vi.advanceTimersByTimeAsync(3000);
    expect(heartbeatProbes.length).toBeGreaterThanOrEqual(3);
    expect(connectionFailed).not.toHaveBeenCalled();
    expect(mainClient.getStatus()).toBe('connected');

    // The transfer eventually completes on its own connection.
    respondLast(transferSockets[0], { ok: true, attachmentId: 'att-slow' });
    await expect(transfer).resolves.toEqual({ ok: true, attachmentId: 'att-slow' });
    expect(__getActiveTransferCountForTesting()).toBe(0);

    mainClient.dispose();
  });
});
