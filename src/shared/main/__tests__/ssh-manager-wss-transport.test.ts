/**
 * Feasibility proof for the WSS-over-SSH remote transport model from the
 * retired `WSS_OVER_SSH.md` design doc (last at intent-hq/monorepo commit
 * c411e18a — see monorepo git history; remote-backend work is tracked in
 * intent-hq/monorepo#444).
 *
 * `SSHManager.connect` accepts `transport: 'websocket'` + `wsUrl`, opens a
 * WebSocket to that URL, wraps it in `createWebSocketStream`, and hands the
 * resulting `Duplex` to the ssh2 `Client` as its `sock`. These tests exercise
 * that branch against a real localhost `ws://` server and a mocked ssh2
 * `Client` — no real SSH daemon is required.
 */

import { EventEmitter } from 'events';
import { createRequire } from 'module';
import type { AddressInfo } from 'net';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// `ws` is CJS; mirror ssh-manager.ts's createRequire dance so the constructor
// resolves the same way it does in production.
const wsRequire = createRequire(import.meta.url);
const { WebSocketServer } = wsRequire('ws') as typeof import('ws');

type FakeClient = EventEmitter & {
  connect: ReturnType<typeof vi.fn>;
  sftp: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

const { fakeClients } = vi.hoisted(() => ({
  fakeClients: [] as FakeClient[],
}));

vi.mock('ssh2', () => {
  // Require lazily so the mock factory (hoisted above the static ESM imports)
  // does not touch the top-of-file `EventEmitter` binding before it exists.
  const { EventEmitter: EE } = require('events') as typeof import('events');
  class Client extends EE {
    connect = vi.fn();
    sftp = vi.fn(
      (cb: (err: Error | undefined, sftp: unknown) => void) =>
        cb(new Error('sftp mocked off'), undefined),
    );
    end = vi.fn();
    constructor() {
      super();
      fakeClients.push(this as unknown as FakeClient);
    }
  }
  return { Client };
});

vi.mock('../../../features/feature-codes/main/feature-codes.service', () => ({
  featureCodesService: { isFeatureEnabled: () => false },
}));

import { SSHManager } from '../ssh-manager';

describe('SSHManager websocket transport (WSS-over-SSH feasibility)', () => {
  let wss: WebSocketServer;
  let wsUrl: string;
  let manager: SSHManager;

  beforeAll(async () => {
    wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((res) => wss.once('listening', () => res()));
    const addr = wss.address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((res) => wss.close(() => res()));
  });

  beforeEach(() => {
    fakeClients.length = 0;
    manager = new SSHManager();
  });

  afterEach(async () => {
    for (const conn of manager.getConnections()) {
      await manager.disconnect(conn.id);
    }
  });

  it('threads the WebSocket duplex into ssh2 Client.connect and resolves on ready', async () => {
    const connectPromise = manager.connect('wss-1', {
      host: 'ignored',
      port: 22,
      username: 'u',
      useAgent: true,
      transport: 'websocket',
      wsUrl,
    });

    await vi.waitFor(() => {
      expect(fakeClients).toHaveLength(1);
      expect(fakeClients[0].connect).toHaveBeenCalledTimes(1);
    });

    const passed = fakeClients[0].connect.mock.calls[0][0];
    expect(passed.sock).toBeDefined();
    expect(typeof passed.sock.pipe).toBe('function');
    // ssh2 ignores host/port when `sock` is provided; the manager must not set them.
    expect(passed.host).toBeUndefined();
    expect(passed.port).toBeUndefined();
    expect(passed.username).toBe('u');

    fakeClients[0].emit('ready');
    const conn = await connectPromise;
    expect(conn.connected).toBe(true);
    expect(conn.config.transport).toBe('websocket');
    expect(conn.config.wsUrl).toBe(wsUrl);
  });

  it('rejects with a WebSocket-branded error when wsUrl is unreachable', async () => {
    await expect(
      manager.connect('wss-bad', {
        host: 'ignored',
        port: 22,
        username: 'u',
        useAgent: true,
        transport: 'websocket',
        wsUrl: 'ws://127.0.0.1:1',
      }),
    ).rejects.toThrow(/WebSocket connection failed/);

    // ssh2 Client.connect must not run when the ws layer fails first.
    if (fakeClients.length > 0) {
      expect(fakeClients[0].connect).not.toHaveBeenCalled();
    }
  });
});
