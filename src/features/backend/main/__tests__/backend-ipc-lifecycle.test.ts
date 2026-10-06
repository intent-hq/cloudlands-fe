/** Real pool/client ownership; only transport, storage and desktop edges are controlled. */
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { app, BrowserWindow, ipcMain } from 'electron';
import type { BrowserWindow as ElectronWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { JsonRpcClient } from '../json-rpc-client';
import nativeFixture from '$shared/types/__fixtures__/native-review-v1.json';

interface Frame {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}
const edge = vi.hoisted(() => ({
  sockets: [] as ControlledSocket[],
  respond: undefined as undefined | ((socket: ControlledSocket, frame: Frame) => unknown),
  list: undefined as undefined | (() => Promise<unknown[]>),
  findGuest: undefined as undefined | ((id: string) => Promise<unknown>),
  persist: undefined as undefined | (() => Promise<void>),
  device: undefined as undefined | (() => Promise<boolean>),
  identityChanged: false,
  guest: false,
  credentialChanged: undefined as undefined | ((id: string) => void),
  writes: [] as string[],
  opens: [] as string[],
  frames: undefined as unknown as EventEmitter,
}));
vi.mock('../../../../main/window', async () => import('../../../../main/window-backend'));
vi.mock('../client-identity', () => ({
  buildMainClientHelloParams: async () => ({ clientId: 'lifecycle-control' }),
  getOrCreateClientId: async () => 'lifecycle-control',
  persistClientId: () => edge.persist?.() ?? Promise.resolve(),
  setLocalHostIdentity: () => {
    const changed = edge.identityChanged;
    edge.identityChanged = false;
    return changed;
  },
}));
vi.mock('../connections-store', () => ({
  list: () =>
    edge.list?.() ??
    Promise.resolve(
      ['remote-A', 'remote-B'].map((id) => ({
        id,
        host: id + '.test',
        hosts: [id + '.test'],
        port: 443,
        fingerprint: 'ab'.repeat(32),
      })),
    ),
  getActiveId: async () => 'local',
  getDecryptedToken: async () => 'controlled-owner-token',
  setDetectedDeviceKind: () => edge.device?.() ?? Promise.resolve(false),
  setHostname: async () => false,
  setDaemonVersion: async () => false,
  setUpdateSupported: async () => false,
  setTcAddress: async () => false,
  setHosts: async () => false,
  getDetectHosts: async () => false,
  onConnectionsMutated: () => () => {},
}));
vi.mock('../guest-sessions-store', () => ({
  list: async () => [],
  findById: (id: string) =>
    edge.findGuest?.(id) ??
    Promise.resolve(
      edge.guest && id === 'guest-1'
        ? {
            id,
            host: 'guest.test',
            hosts: ['guest.test'],
            port: 443,
            fingerprint: 'cd'.repeat(32),
            tcAddress: null,
            principalId: 'prn_control',
            updatedAt: 1,
            workspaces: [],
          }
        : null,
    ),
  getDecryptedToken: async () => 'controlled-guest-token',
  setPrincipal: async () => true,
  setWorkspaces: async () => false,
  setHostname: async () => false,
  setTcAddress: async () => false,
  setHosts: async () => false,
  onGuestSessionsMutated: () => () => {},
  onGuestCredentialReplaced: (fn: (id: string) => void) => {
    edge.credentialChanged = fn;
    return () => {};
  },
  onGuestSessionRemovedBySync: () => () => {},
  createInvitedSyncAdapter: () => ({}),
}));
vi.mock('../intentd-sidecar', () => ({
  onSidecarGaveUp: () => () => {},
  onSidecarStartupFailed: () => () => {},
  getLocalDaemonProtocolVersion: () => null,
  getSidecarStartupFailure: () => null,
  getSidecarRunLog: vi.fn(),
  spawnSidecarOnDemand: vi.fn(),
}));
vi.mock('../../../browser/main/browser-exec-reverse', () => ({
  registerBrowserExecReverseHandler: vi.fn(),
}));
vi.mock('../backend-connection', async (original) => ({
  ...(await original<typeof import('../backend-connection')>()),
  createBackendSocket(config: { transport: string; host?: string }) {
    const socket = new ControlledSocket(config.transport === 'uds' ? 'local' : config.host!);
    edge.sockets.push(socket);
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  },
}));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function defaultReply(frame: Frame): unknown {
  switch (frame.method) {
    case 'client.hello':
      return {
        clientId: 'acknowledged-original',
        server: {
          capabilities: {
            repositoryContext: 1,
            repositorySelection: 1,
            nativeReview: 1,
            nativeReviewCompanion: 1,
            hostMembership: 1,
          },
        },
      };
    case 'host.status':
      return { hostname: 'control', deviceKind: 'desktop' };
    case 'system.status':
      return { updateSupported: false };
    case 'server.pairingInfo':
      return { token: 'control-only', certFingerprint: 'ef'.repeat(32), port: 443, localIps: [] };
    case 'principal.me':
      return {
        id: 'prn_control',
        login: null,
        displayName: null,
        avatarUrl: null,
        isAdministrator: false,
        hostRole: 'member',
        hostMembershipRevision: 1,
      };
    case 'events.subscribe':
      return { subscriptionId: 'original-subscription' };
    case 'workspace.list':
      return { workspaces: [] };
    default:
      return { released: true };
  }
}
class ControlledSocket extends Duplex {
  readonly frames: Frame[] = [];
  holdClose = false;
  originalClose?: () => void;
  onDestroy?: () => void;
  constructor(readonly owner: string) {
    super();
  }
  _read() {}
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    const frame = JSON.parse(chunk.toString()) as Frame;
    this.frames.push(frame);
    edge.writes.push(this.owner + ':' + frame.method);
    edge.frames.emit('frame', this, frame);
    const value = edge.respond ? edge.respond(this, frame) : defaultReply(frame);
    void Promise.resolve(value).then(
      (result) => this.emit('data', Buffer.from(JSON.stringify({ id: frame.id, result }) + '\n')),
      (error: unknown) =>
        this.emit(
          'data',
          Buffer.from(
            JSON.stringify({ id: frame.id, error: { code: -32000, message: String(error) } }) +
              '\n',
          ),
        ),
    );
    done();
  }
  _destroy(error: Error | null, done: (error?: Error | null) => void) {
    this.onDestroy?.();
    if (this.holdClose) this.originalClose = () => done(error);
    else done(error);
  }
  notification(type: string) {
    this.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          method: 'events.event',
          params: {
            subscriptionId: 'original-subscription',
            event: { type, data: {} },
          },
        }) + '\n',
      ),
    );
  }
}
function nextFrame(method: string, owner?: string) {
  return new Promise<{ socket: ControlledSocket; frame: Frame }>((resolve) => {
    const listener = (socket: ControlledSocket, frame: Frame) => {
      if (frame.method !== method || (owner && socket.owner !== owner)) return;
      edge.frames.off('frame', listener);
      resolve({ socket, frame });
    };
    edge.frames.on('frame', listener);
  });
}
function fence(initial = true) {
  let ready = initial;
  const listeners = new Set<() => void>();
  return {
    ready: () => ready,
    subscribeChanged: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    set(value: boolean) {
      ready = value;
      for (const fn of [...listeners]) fn();
    },
  };
}
type Pool = typeof import('../backend.ipc');
let pool: Pool | undefined;
const hostPlatform = process.platform;
beforeEach(() => {
  // This fixture joins main-pool owners only. The macOS keychain engine is
  // auxiliary and cannot produce a clean retirement receipt (intent#6837).
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.resetModules();
  vi.stubEnv('INTENTD_SOCKET', '/controlled-lifecycle.sock');
  edge.sockets = [];
  edge.respond = undefined;
  edge.list = undefined;
  edge.findGuest = undefined;
  edge.persist = undefined;
  edge.device = undefined;
  edge.identityChanged = false;
  edge.guest = false;
  edge.writes = [];
  edge.opens = [];
  edge.frames = new EventEmitter();
  const applicationEvents = new EventEmitter();
  Object.assign(app, {
    on: applicationEvents.on.bind(applicationEvents),
    once: applicationEvents.once.bind(applicationEvents),
    emit: applicationEvents.emit.bind(applicationEvents),
    removeListener: applicationEvents.removeListener.bind(applicationEvents),
  });
  vi.mocked(ipcMain.handle).mockClear();
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
});
afterEach(() => {
  pool?.disposeAllBackendClients();
  pool = undefined;
  for (const socket of edge.sockets) socket.originalClose?.();
  edge.frames.removeAllListeners();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', { value: hostPlatform });
});
async function load(enrolled = true) {
  pool = await import('../backend.ipc');
  const lifecycle = enrolled ? pool.enrollBackendClientLifecycle() : undefined;
  pool.__setBackendWindowHooksForTesting({
    openOrFocus: async (id) => {
      edge.opens.push(id);
    },
  });
  pool.registerBackendHandlers();
  return { pool, lifecycle: lifecycle! };
}
async function connection(client: JsonRpcClient) {
  await client.request('controlled.ready');
  expect(client.getRepositoryConnection()).not.toBeNull();
}
async function settledTurn() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function invoke(channel: string, event: IpcMainInvokeEvent, value: unknown): Promise<unknown> {
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)?.[1];
  if (!handler) throw new Error('Missing real IPC handler ' + channel);
  return handler(event, value);
}
async function localWindow() {
  const sender = Object.assign(new EventEmitter(), {
    id: 41,
    mainFrame: {},
    isDestroyed: () => false,
    send: vi.fn(),
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => false,
  });
  const { stampWindowWithBackend } = await import('../../../../main/window-backend');
  stampWindowWithBackend(window as unknown as ElectronWindow, 'local');
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as unknown as ElectronWindow);
  return {
    sender,
    event: { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent,
  };
}

describe('pooled startup hello recovery', () => {
  it.each(['existing client', 'replacement after close'] as const)(
    'serves requests after overlapping startup and renderer hello: %s',
    async (recovery) => {
      const f = await load(false);
      vi.useFakeTimers();
      const startupReply = deferred<unknown>();
      let firstHello = true;
      edge.respond = (_socket, frame) => {
        if (frame.method === 'client.hello' && firstHello) {
          firstHello = false;
          return startupReply.promise;
        }
        return defaultReply(frame);
      };
      const client = await f.pool.connectBackendClient('remote-A');
      await vi.advanceTimersByTimeAsync(0);
      const original = edge.sockets[0];
      expect(original.frames.map((frame) => frame.method)).toEqual(['client.hello']);
      const probe = client.request('client.hello', {});
      void probe.catch(() => {});
      const work = client.request('workspace.list');
      void work.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
      startupReply.resolve(defaultReply(original.frames[0]));
      // Far beyond the hello deadline and ordinary request timeout. A consumed
      // successful reply must not leave the pool indefinitely "connecting".
      await vi.advanceTimersByTimeAsync(102_000);
      expect(await f.pool.connectBackendClient('remote-A')).toBe(client);
      expect(edge.sockets.filter((socket) => socket.owner === original.owner)).toHaveLength(1);

      let current = client;
      if (recovery === 'replacement after close') {
        // main/index.ts wires last-window-close to this eviction. Reopening
        // allocates a fresh client; this is a pool control, not a native UI test.
        f.pool.disconnectBackendClient('remote-A');
        expect(original.destroyed).toBe(true);
        current = await f.pool.connectBackendClient('remote-A');
        await vi.advanceTimersByTimeAsync(0);
        expect(current).not.toBe(client);
        expect(current.getConfig()).toEqual(client.getConfig());
        expect(edge.sockets.filter((socket) => socket.owner === original.owner)).toHaveLength(2);
      }
      expect(current.getStatus()).toBe('connected');
      const result = current.request('workspace.list');
      await vi.advanceTimersByTimeAsync(0);
      await expect(result).resolves.toEqual({ workspaces: [] });
      if (recovery === 'existing client') {
        await expect(probe).resolves.toMatchObject({ clientId: 'acknowledged-original' });
        await expect(work).resolves.toEqual({ workspaces: [] });
      }
    },
  );
});

describe('enrolled real pool and original callback ownership', () => {
  it('P3/F1 joins a real native route execute and its late original release acknowledgment', async () => {
    const root = { workspaceId: 'controlled-workspace', kind: 'primary' as const };
    const operationId = 'aaaaaaaa-0000-4000-8000-000000000001';
    const preparation = {
      ...nativeFixture.prepare.reviewPreparation,
      root,
      operationId,
      scope: {
        daemonId: 'controlled-daemon',
        authorityScopeId: operationId,
        authorityGeneration: '1',
      },
      contextRevision: { epoch: operationId, sequence: '1' },
    };
    const terminal = deferred<unknown>(),
      releaseAck = deferred<unknown>();
    edge.respond = (_socket, frame) => {
      if (frame.method === 'accept-changes.prepare')
        return {
          ...nativeFixture.prepare,
          reviewPreparation: preparation,
          reviewOperation: { operationId, root, retirementSequence: '0', expiresAfterMs: 300000 },
        };
      if (frame.method === 'accept-changes.execute') return terminal.promise;
      if (frame.method === 'accept-changes.release') return releaseAck.promise;
      return defaultReply(frame);
    };
    const { pool, lifecycle } = await load();
    const client = pool.getLocalBackendClient();
    await connection(client);
    const { event } = await localWindow();
    const channels = IPC_CHANNELS.BACKEND.NATIVE_REVIEW;
    const prepared = (await invoke(channels.PREPARE, event, {
      input: {
        workspaceId: root.workspaceId,
        action: 'create-pr',
        review: { root, choice: { kind: 'saved' } },
      },
    })) as { ok: boolean; result: { id: string } };
    expect(prepared.ok).toBe(true);
    const reached = nextFrame('accept-changes.execute');
    const executing = invoke(channels.EXECUTE, event, {
      root,
      id: prepared.result.id,
      command: { prTitle: 'control' },
    });
    await reached;
    const released = nextFrame('accept-changes.release');
    await invoke(channels.RELEASE, event, { root, id: prepared.result.id });
    const boundary = fence(false);
    const joined = lifecycle.retire(boundary);
    let finished = false;
    void joined.then(() => {
      finished = true;
    });
    terminal.resolve({
      operationId,
      root,
      state: 'settled',
      success: true,
      steps: [],
      reviewExecution: {
        ...nativeFixture.execute.reviewExecution,
        preparation,
        requestId: operationId,
      },
    });
    await executing;
    await released;
    boundary.set(true);
    await settledTurn();
    expect(finished).toBe(false);
    expect(edge.sockets[0]!.destroyed).toBe(false);
    releaseAck.resolve({ released: true });
    const result = await joined;
    expect(result.outcome).toBe('clean');
    expect(
      edge.sockets[0]!.frames.filter((f) => f.method === 'accept-changes.execute'),
    ).toHaveLength(1);
    expect(
      edge.sockets[0]!.frames.filter((f) => f.method === 'accept-changes.release'),
    ).toHaveLength(1);
  });

  it('P2 retains the original hello store callback and its local re-hello through retirement', async () => {
    const hold = deferred<boolean>(),
      entered = deferred();
    edge.identityChanged = true;
    edge.device = () => {
      entered.resolve();
      return hold.promise;
    };
    const { pool, lifecycle } = await load();
    const client = pool.getLocalBackendClient();
    await entered.promise;
    const join = lifecycle.retire(fence());
    let done = false;
    void join.then(() => {
      done = true;
    });
    await settledTurn();
    expect(done).toBe(false);
    expect(edge.sockets[0]!.destroyed).toBe(false);
    const rehello = nextFrame('client.hello', 'local');
    hold.resolve(false);
    await rehello;
    expect((await join).outcome).toBe('clean');
    expect(edge.sockets[0]!.frames.filter((f) => f.method === 'client.hello')).toHaveLength(2);
    expect(client.getStatus()).toBe('disconnected');
  });

  it('P2 retains persistClientId original rejection instead of converting fail-soft callback work to clean', async () => {
    const original = new Error('original store failure'),
      entered = deferred(),
      hold = deferred();
    edge.persist = () => {
      entered.resolve();
      return hold.promise;
    };
    const { pool, lifecycle } = await load();
    pool.getLocalBackendClient();
    await entered.promise;
    const join = lifecycle.retire(fence());
    hold.reject(original);
    const result = await join;
    expect(result.outcome).toBe('original-failure');
    expect(result.failures.some((f) => f.error === original)).toBe(true);
  });

  it('P1 holds a remote hostname store read on the original generation and never rebinds it', async () => {
    const hold = deferred<unknown>(),
      entered = deferred();
    edge.findGuest = async (id) => {
      if (id === 'remote-A') {
        entered.resolve();
        return hold.promise;
      }
      return null;
    };
    const { pool, lifecycle } = await load();
    const old = await pool.connectBackendClient('remote-A');
    await entered.promise;
    pool.disconnectBackendClient('remote-A');
    edge.findGuest = async () => null;
    const fresh = await pool.connectBackendClient('remote-A');
    await connection(fresh);
    const join = lifecycle.retire(fence());
    hold.resolve(null);
    const result = await join;
    expect(old).not.toBe(fresh);
    expect(result.clients.filter((c) => c.identity.generation > 0)).toHaveLength(3);
    expect(new Set(result.clients.map((c) => c.identity.instance)).size).toBe(3);
    expect(result.outcome).not.toBe('clean');
    expect(edge.sockets[0]!.frames.filter((f) => f.method === 'host.status')).toHaveLength(0);
  });

  it('P3 keeps an admitted guest refresh, its trailing coalesced read and subscription acknowledgment', async () => {
    edge.guest = true;
    const held = deferred<unknown>(),
      reached = deferred();
    let reads = 0;
    edge.respond = (_socket, frame) => {
      if (frame.method === 'workspace.list' && ++reads === 2) {
        reached.resolve();
        return held.promise;
      }
      return defaultReply(frame);
    };
    const { pool, lifecycle } = await load();
    const subscribed = nextFrame('events.subscribe', 'guest.test');
    const client = await pool.connectBackendClient('guest-1');
    await subscribed;
    await connection(client);
    await settledTurn();
    const socket = edge.sockets.find((s) => s.owner === 'guest.test')!;
    socket.notification('workspace:deleted');
    await reached.promise;
    socket.notification('workspace:deleted');
    socket.notification('workspace:deleted');
    const join = lifecycle.retire(fence());
    held.resolve({ workspaces: [] });
    expect((await join).outcome).toBe('clean');
    expect(reads).toBe(3);
    expect(socket.frames.filter((f) => f.method === 'events.subscribe')).toHaveLength(1);
  });

  it('P4 owns a queued open before its first store await and rejects a later root without another dial', async () => {
    const hold = deferred<unknown[]>(),
      entered = deferred();
    edge.list = () => {
      entered.resolve();
      return hold.promise;
    };
    const { pool, lifecycle } = await load();
    const opened = pool.openBackendWindow('remote-A');
    await entered.promise;
    const boundary = fence();
    const join = lifecycle.retire(boundary);
    await expect(pool.openBackendWindow('remote-B')).rejects.toThrow('Unowned pool work');
    const rows = [
      {
        id: 'remote-A',
        host: 'remote-A.test',
        hosts: ['remote-A.test'],
        port: 443,
        fingerprint: 'ab'.repeat(32),
      },
    ];
    edge.list = async () => rows;
    hold.resolve(rows);
    await expect(opened).resolves.toEqual({ id: 'remote-A' });
    const result = await join;
    expect(result.outcome).toBe('ownership-fault');
    expect(edge.opens).toEqual(['remote-A']);
    expect(edge.sockets.some((s) => s.owner === 'remote-B.test')).toBe(false);
  });

  it('P5 records natural transport failure and original rejected request during retirement', async () => {
    const hold = deferred<unknown>();
    edge.respond = (_s, f) => (f.method === 'controlled.pending' ? hold.promise : defaultReply(f));
    const { pool, lifecycle } = await load();
    const client = pool.getLocalBackendClient();
    await connection(client);
    const original = client.request('controlled.pending');
    const rejected = original.catch((e: unknown) => e);
    const join = lifecycle.retire(fence());
    const error = new Error('original socket error');
    edge.sockets[0]!.emit('error', error);
    const requestError = await rejected;
    hold.resolve({ late: true });
    const result = await join;
    expect(result.outcome).not.toBe('clean');
    expect(result.clients[0]!.failures.some((f) => f.error === error)).toBe(true);
    expect(result.clients[0]!.failures.some((f) => f.error === requestError)).toBe(true);
  });

  it('P6 seals every enrolled sibling before the first destroy callback can request on another', async () => {
    const { pool, lifecycle } = await load();
    const local = pool.getLocalBackendClient();
    const remote = await pool.connectBackendClient('remote-A');
    await connection(local);
    await connection(remote);
    await settledTurn();
    let late!: Promise<unknown>;
    edge.sockets[0]!.onDestroy = () => {
      late = remote.request('controlled.illegal');
      void late.catch(() => {});
    };
    const result = await lifecycle.retire(fence());
    await expect(late).rejects.toThrow('admission sealed');
    expect(result.outcome).toBe('ownership-fault');
    expect(edge.writes.some((m) => m.endsWith(':controlled.illegal'))).toBe(false);
    expect(
      result.clients.every((c) => c.admissionSealed && c.closes.every((s) => s.closeObserved)),
    ).toBe(true);
  });

  it('P6/F4 reuses the same fence and Promise, waits for actual close and preserves a legacy forced race', async () => {
    const { pool, lifecycle } = await load();
    const client = pool.getLocalBackendClient();
    await connection(client);
    await settledTurn();
    edge.sockets[0]!.holdClose = true;
    const boundary = fence(false);
    const join = lifecycle.retire(boundary);
    expect(lifecycle.retire(boundary)).toBe(join);
    expect(() => lifecycle.retire(fence())).toThrow('fence changed');
    pool.disposeAllBackendClients();
    boundary.set(true);
    let done = false;
    void join.then(() => {
      done = true;
    });
    await settledTurn();
    expect(done).toBe(false);
    edge.sockets[0]!.originalClose!();
    expect((await join).outcome).toBe('forced');
  });

  it('P7 refuses positive retirement after actual external-forwarder admission', async () => {
    const { pool, lifecycle } = await load();
    const off = pool.onBackendReconnected(() => {});
    off();
    await expect(lifecycle.retire(fence())).rejects.toThrow('external-forwarder');
  });

  it('P7 refuses positive retirement after a real host-exec admission despite inner settlement', async () => {
    const { pool, lifecycle } = await load();
    const client = pool.getLocalBackendClient();
    await connection(client);
    await client.request('host.execStream', { command: 'controlled-no-process' });
    await expect(lifecycle.retire(fence())).rejects.toThrow('host-exec');
  });

  it('P7 records an actual presence report and refuses to claim the private flush owner joined', async () => {
    const { pool, lifecycle } = await load();
    const client = pool.getLocalBackendClient();
    await connection(client);
    const { event } = await localWindow();
    await invoke(IPC_CHANNELS.PRESENCE.REPORT, event, { focus: [] });
    await expect(lifecycle.retire(fence())).rejects.toThrow('presence');
  });

  it.each(['linux', 'darwin'] as const)(
    'P8 preserves the unenrolled immediate void disposer and refuses retroactive or duplicate enrollment on %s',
    async (platform) => {
      const { pool } = await load(false);
      Object.defineProperty(process, 'platform', { value: platform });
      const client = pool.getLocalBackendClient();
      await connection(client);
      expect(() => pool.enrollBackendClientLifecycle()).toThrow('unowned empty pool');
      expect(() => client.beginRetirement()).toThrow('not enrolled');
      expect(pool.disposeAllBackendClients()).toBeUndefined();
      expect(edge.sockets[0]!.destroyed).toBe(true);
    },
  );

  it('P8 refuses a second enrollment before any allocation', async () => {
    const { pool, lifecycle } = await load();
    expect(() => pool.enrollBackendClientLifecycle()).toThrow('unowned empty pool');
    expect((await lifecycle.retire(fence())).clients).toEqual([]);
  });
});

/** Extract the released helpers, never import the main module or allocate Electron. */
type OriginalLedger = {
  pending: Set<Promise<unknown>>;
  faults: string[];
  rows: unknown[];
  changed(): void;
  subscribeChanged(fn: () => void): () => void;
  invoke<T>(
    fn: (...args: never[]) => T,
    receiver: unknown,
    args: never[],
    meta: Record<string, unknown>,
  ): T;
  join(closed: () => boolean, released: () => boolean, seal?: boolean): Promise<unknown>;
};
type MainHelpers = {
  completionLedger: () => OriginalLedger;
  finalClientPoolJoin: (
    lifecycle: ReturnType<Pool['enrollBackendClientLifecycle']>,
    ledger: OriginalLedger,
    released: () => boolean,
  ) => ReturnType<ReturnType<Pool['enrollBackendClientLifecycle']>['retire']>;
};

function mainHelpers(): MainHelpers {
  const filename = path.resolve('test/fixtures/native-review-native/main.ts');
  const text = readFileSync(filename, 'utf8');
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const names = ['completionLedger', 'finalClientPoolJoin'];
  const helpers = source.statements.filter(
    (n): n is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(n) && !!n.name && names.includes(n.name.text),
  );
  expect(helpers.map((h) => h.name!.text)).toEqual(names);
  const js = ts.transpileModule(helpers.map((h) => h.getText(source)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('exports', js + '\nreturn {completionLedger, finalClientPoolJoin};')(
    {},
  ) as MainHelpers;
}
describe('actual main finalization fence and original pool', () => {
  it('observes current node capabilities through IPC without a replacement hello', async () => {
    edge.respond = (_socket, frame) =>
      frame.method === 'client.hello'
        ? {
            clientId: 'acknowledged-original',
            server: { capabilities: { agentNodes: 1, agentPlatformRouting: 1 } },
          }
        : defaultReply(frame);
    const { pool } = await load();
    const client = pool.getLocalBackendClient();
    await connection(client);
    await settledTurn();
    const { event } = await localWindow();
    const original = client.getRepositoryConnection();
    const hellos = edge.writes.filter((entry) => entry.endsWith(':client.hello')).length;
    expect(await invoke(IPC_CHANNELS.BACKEND.NODE_CAPABILITIES, event, undefined)).toEqual({
      ok: true,
      result: {
        server: { capabilities: { agentNodes: 1, localNodeIsolation: 0, agentPlatformRouting: 1 } },
      },
    });
    expect(client.getRepositoryConnection()).toBe(original);
    expect(edge.writes.filter((entry) => entry.endsWith(':client.hello'))).toHaveLength(hellos);
  });
  for (const roots of [5, 7])
    it(`F1/F2/F3 ${roots} original roots and late release stay usable until final retirement`, async () => {
      const { completionLedger, finalClientPoolJoin } = mainHelpers();
      const ledger = completionLedger();
      const { pool, lifecycle } = await load();
      const client = pool.getLocalBackendClient();
      await connection(client);
      await settledTurn();
      const releases = deferred<unknown>(),
        reached = deferred();
      edge.respond = (_s, frame) => {
        if (frame.method === 'repository.context.release') {
          reached.resolve();
          return releases.promise;
        }
        return defaultReply(frame);
      };
      const originals = Array.from({ length: roots }, () => deferred());
      let rootsJoined = 0;
      for (const root of originals) {
        ledger.invoke(() => root.promise, null, [], { kind: 'root' });
        void root.promise.then(() => {
          rootsJoined++;
          ledger.changed();
        });
      }
      const drain = ledger.join(
        () => rootsJoined === roots,
        () => true,
        false,
      );
      for (const root of originals) root.resolve();
      await drain;
      const stillUsable = client.request('host.status');
      await stillUsable;
      const release = ledger.invoke(() => client.request('repository.context.release'), null, [], {
        kind: 'release',
      });
      await reached.promise;
      let acknowledged = false;
      void release.then(() => {
        acknowledged = true;
        ledger.changed();
      });
      const joined = finalClientPoolJoin(
        lifecycle,
        ledger,
        () => rootsJoined === roots && acknowledged,
      );
      await settledTurn();
      expect(edge.sockets[0]!.destroyed).toBe(false);
      releases.resolve({ released: true });
      await release;
      expect((await joined).outcome).toBe('clean');
      await ledger.join(
        () => rootsJoined === roots,
        () => acknowledged,
      );
      ledger.invoke(() => Promise.resolve('original'), null, [], { kind: 'late' });
      expect(ledger.faults.join(';')).toContain('after quiescence');
    });

  it('F4 keeps the exact original fence error as the stable finalization rejection', async () => {
    const { completionLedger, finalClientPoolJoin } = mainHelpers();
    const ledger = completionLedger();
    const { lifecycle } = await load();
    const original = new Error('original acknowledgment failure');
    const joined = finalClientPoolJoin(lifecycle, ledger, () => {
      throw original;
    });
    await expect(joined).rejects.toBe(original);
  });
});

/** Invoke only the extracted original finalization methods with controlled desktop edges. */
function fixtureFinalization(
  lifecycle: ReturnType<Pool['enrollBackendClientLifecycle']>,
  sidebarMode: boolean,
  member?: JsonRpcClient,
  journal?: DirectJournal,
) {
  const filename = path.resolve('test/fixtures/native-review-native/main.ts');
  const text = readFileSync(filename, 'utf8');
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const run = source.statements.find(
    (n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'run',
  )!;
  const names = [
    'poolRetirement',
    'finalRootsJoined',
    'finalQuiescence',
    'finalShutdown',
    'memberQuiescence',
  ];
  const variables = run.body!.statements.filter(
    (n): n is ts.VariableStatement =>
      ts.isVariableStatement(n) &&
      n.declarationList.declarations.some((d) => names.includes(d.name.getText(source))),
  );
  const bodies = run.body!.statements.filter(
    (n): n is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(n) && ['quiesceUi', 'shutdown'].includes(n.name?.text ?? ''),
  );
  const fixture = run
    .body!.statements.filter(ts.isVariableStatement)
    .flatMap((n) => [...n.declarationList.declarations])
    .find((n) => n.name.getText(source) === 'fixture')!.initializer as ts.ObjectLiteralExpression;
  const methods = fixture.properties.filter(
    (n): n is ts.MethodDeclaration =>
      ts.isMethodDeclaration(n) &&
      ['quiesceUi', 'shutdown', 'role'].includes(n.name.getText(source)),
  );
  const helpers = source.statements.filter(
    (n): n is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(n) &&
      ['completionLedger', 'finalClientPoolJoin', 'assertUiTasks', 'disposalComplete'].includes(
        n.name?.text ?? '',
      ),
  );
  expect([variables.length, bodies.length, methods.length, helpers.length]).toEqual([5, 2, 3, 4]);
  const fragments = [...helpers, ...variables, ...bodies].map((n) => n.getText(source)).join('\n');
  const code = ts.transpileModule(
    fragments + '\nreturn {' + methods.map((n) => n.getText(source)).join(',') + '};',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const roots = deferred<unknown>();
  let windowDestroyed = false;
  const close = vi.fn(() => roots.promise),
    destroy = vi.fn(() => {
      windowDestroyed = true;
    });
  const window = {
    isDestroyed: () => windowDestroyed,
    destroy,
    webContents: { id: 71, executeJavaScript: close },
  };
  const httpClose = vi.fn((done: () => void) => done());
  const ledger = mainHelpers().completionLedger();
  const backendDispose = vi.fn();
  const params = {
    lifecycle,
    completions: ledger,
    sidebarMode,
    windows: new Map([['host-A', window]]),
    clients: new Map(member ? [['host-A', member]] : []),
    backendIds: new Map([['host-A', 'remote-A']]),
    remote: async () => ({ id: 'remote-B', client: await pool!.connectBackendClient('remote-B') }),
    stampWindowWithBackend: vi.fn(),
    uiMode: true,
    diagnosticOwnership: true,
    statusProducers: journal ?? { record: vi.fn() },
    pending: new Set(),
    faults: [],
    wireBoundaries: [],
    backend: { disposeAllBackendClients: backendDispose },
    http: { close: httpClose },
  };
  const actual = new Function('exports', ...Object.keys(params), code)(
    {},
    ...Object.values(params),
  ) as {
    quiesceUi(seal?: boolean): Promise<unknown>;
    shutdown(): Promise<void>;
    role(role: 'owner' | 'member' | 'guest'): Promise<void>;
  };
  const receipt = {
    route: { startupSettled: true, closed: true },
    producersClosed: true,
    tasks: [
      'connectionsSaga',
      'daemonEventsSaga',
      'principalSaga',
      'lifecycleReadSaga',
      'repositoryContextSaga',
      ...(sidebarMode ? ['gitReadSaga', 'acceptChangesStatusSaga'] : []),
    ].map((name) => ({ name, iteratorDone: true, joined: true })),
    faults: [],
  };
  return { actual, roots, close, destroy, httpClose, backendDispose, receipt };
}

describe('actual main finalization concurrency', () => {
  for (const sidebar of [false, true])
    it(`F4 shares the original ${sidebar ? 7 : 5}-root finalization with concurrent shutdown`, async () => {
      const { pool, lifecycle } = await load();
      const client = pool.getLocalBackendClient();
      await connection(client);
      await settledTurn();
      const f = fixtureFinalization(lifecycle, sidebar);
      const quiescing = f.actual.quiesceUi();
      expect(f.actual.quiesceUi()).toBe(quiescing);
      const shutdown = f.actual.shutdown();
      expect(f.actual.shutdown()).toBe(shutdown);
      await settledTurn();
      expect(f.close).toHaveBeenCalledTimes(1);
      expect(edge.sockets[0]!.destroyed).toBe(false);
      expect(f.destroy).not.toHaveBeenCalled();
      await client.request('host.status');
      f.roots.resolve(f.receipt);
      await quiescing;
      await shutdown;
      expect(f.destroy).toHaveBeenCalledTimes(1);
      expect(f.httpClose).toHaveBeenCalledTimes(1);
      expect(f.backendDispose).not.toHaveBeenCalled();
    });
  it('F4 retains the original root failure across both concurrent callers without early pool disposal', async () => {
    const { pool, lifecycle } = await load();
    const client = pool.getLocalBackendClient();
    await connection(client);
    const f = fixtureFinalization(lifecycle, true),
      original = new Error('original renderer close failure');
    const quiescing = f.actual.quiesceUi(),
      shutdown = f.actual.shutdown();
    const first = expect(quiescing).rejects.toBe(original),
      second = expect(shutdown).rejects.toBe(original);
    f.roots.reject(original);
    await Promise.all([first, second]);
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.destroy).not.toHaveBeenCalled();
    expect(edge.sockets[0]!.destroyed).toBe(false);
    expect(f.backendDispose).not.toHaveBeenCalled();
  });
});

/** Late auxiliary admission uses the real registered handler and original facade close. */
describe('pool auxiliary admission at retirement', () => {
  it.each(['pool', 'member'] as const)(
    'refuses %s retirement when the macOS keychain owner is unjoined',
    async (scope) => {
      const { pool, lifecycle } = await load();
      const client = pool.getLocalBackendClient();
      await connection(client);
      await settledTurn();
      const original = edge.sockets[0];
      // Enter the macOS branch only at retirement: no native keychain work
      // runs, but the real production exclusion and rejection must survive.
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const memberFence = fence(false);
      const member = scope === 'member' ? lifecycle.retireMember(client, memberFence) : undefined;
      const boundary = fence();
      const retirement = lifecycle.retire(boundary);
      const globalFailure = expect(retirement).rejects.toThrow(
        'Unjoined auxiliary pool owners: keychain-engine',
      );
      const memberFailure = member
        ? expect(member).rejects.toThrow('Original member has unjoined auxiliary owners')
        : Promise.resolve();
      memberFence.set(true);
      await Promise.all([globalFailure, memberFailure]);
      expect(lifecycle.retire(boundary)).toBe(retirement);
      expect(lifecycle.admissionOpen()).toBe(false);
      expect(original.destroyed).toBe(false);
    },
  );

  it('retains late auxiliary admission while the original facade close is pending', async () => {
    const connectionModule = await import('../backend-connection');
    const held = deferred<Awaited<ReturnType<typeof connectionModule.captureFingerprint>>>();
    const probe = vi
      .spyOn(connectionModule, 'captureFingerprint')
      .mockImplementation(() => held.promise);
    const { pool, lifecycle } = await load();
    let invocation: Promise<unknown> | undefined;
    let retirement: ReturnType<typeof lifecycle.retire> | undefined;
    let close: Promise<void> | undefined;
    let socket: ControlledSocket | undefined;
    const releaseClose = () => {
      const release = socket?.originalClose;
      if (release) {
        socket!.originalClose = undefined;
        release();
      }
    };
    try {
      await connection(pool.getLocalBackendClient());
      await settledTurn();
      socket = edge.sockets[0]!;
      socket.holdClose = true;
      const boundary = fence();
      retirement = lifecycle.retire(boundary);
      expect(lifecycle.retire(boundary)).toBe(retirement);
      await settledTurn();
      expect(socket.originalClose).toBeTypeOf('function');
      close = new Promise<void>((resolve) => socket!.once('close', resolve));
      let retired = false;
      void retirement.then(
        () => {
          retired = true;
        },
        () => {
          retired = true;
        },
      );
      const { event } = await localWindow();
      invocation = invoke(IPC_CHANNELS.CONNECTIONS.CAPTURE_FINGERPRINT, event, {
        host: 'controlled-fingerprint.test',
        port: 443,
        token: 'controlled-not-a-credential',
      });
      let handlerSettled = false;
      const observed = invocation.then(
        (value) => {
          handlerSettled = true;
          return { state: 'fulfilled' as const, value };
        },
        (error: unknown) => {
          handlerSettled = true;
          return { state: 'rejected' as const, error };
        },
      );
      await settledTurn();
      expect(retired).toBe(false);
      // On the parent, the independent probe is still held when the real close completes.
      releaseClose();
      await close;
      const result = await retirement;
      expect(result.excludedOwners).toContain('connection-probe');
      expect({
        outcome: result.outcome,
        ownersJoined: result.ownersJoined,
        admissionSealed: result.admissionSealed,
        probeCalls: probe.mock.calls.length,
        handlerSettled,
        closeObserved: result.clients.every((client) =>
          client.closes.every((row) => row.closeObserved),
        ),
      }).toEqual({
        outcome: 'ownership-fault',
        ownersJoined: false,
        admissionSealed: true,
        probeCalls: 0,
        handlerSettled: true,
        closeObserved: true,
      });
      expect(probe).not.toHaveBeenCalled();
      const refused = await observed;
      expect(refused.state).toBe('rejected');
      if (refused.state === 'rejected') {
        expect(refused.error).toEqual(new Error('Auxiliary pool work after admission sealed'));
        expect(result.failures.some((failure) => failure.error === refused.error)).toBe(true);
      }
      expect(result.failures.some((failure) => failure.kind === 'auxiliary')).toBe(true);
      expect(
        result.clients.every((client) => client.closes.every((row) => row.closeObserved)),
      ).toBe(true);
    } finally {
      held.resolve({ ok: true, connected: true, fingerprint: 'ab'.repeat(32), tokenValid: true });
      releaseClose();
      await Promise.allSettled(
        [invocation, retirement, close].filter((value) => value !== undefined),
      );
      probe.mockRestore();
    }
  });

  it('refuses auxiliary work after a clean terminal retirement without replacing the original receipt', async () => {
    const connectionModule = await import('../backend-connection');
    const probe = vi.spyOn(connectionModule, 'captureFingerprint').mockResolvedValue({
      ok: true,
      connected: true,
      fingerprint: 'ab'.repeat(32),
      tokenValid: true,
    });
    const { pool, lifecycle } = await load();
    try {
      await connection(pool.getLocalBackendClient());
      await settledTurn();
      const boundary = fence();
      const original = lifecycle.retire(boundary);
      const receipt = await original;
      expect(receipt).toMatchObject({
        outcome: 'clean',
        ownersJoined: true,
        admissionSealed: true,
        excludedOwners: [],
      });
      const { event } = await localWindow();
      await expect(
        invoke(IPC_CHANNELS.CONNECTIONS.CAPTURE_FINGERPRINT, event, {
          host: 'controlled-fingerprint.test',
          port: 443,
          token: 'controlled-not-a-credential',
        }),
      ).rejects.toThrow('Auxiliary pool work after admission sealed');
      expect(probe).not.toHaveBeenCalled();
      expect(lifecycle.retire(boundary)).toBe(original);
      expect(await original).toBe(receipt);
      expect(receipt.outcome).toBe('clean');
      expect(edge.sockets).toHaveLength(1);
    } finally {
      probe.mockRestore();
    }
  });

  it('preserves an unenrolled fingerprint handler original result and error', async () => {
    const connectionModule = await import('../backend-connection');
    const originalError = new Error('original controlled fingerprint failure');
    const probe = vi
      .spyOn(connectionModule, 'captureFingerprint')
      .mockResolvedValueOnce({
        ok: true,
        connected: true,
        fingerprint: 'ab'.repeat(32),
        tokenValid: false,
        statusCode: 401,
      })
      .mockRejectedValueOnce(originalError);
    const { pool } = await load(false);
    try {
      const { event } = await localWindow();
      const params = {
        host: 'controlled-fingerprint.test',
        port: 443,
        token: 'controlled-not-a-credential',
      };
      await expect(
        invoke(IPC_CHANNELS.CONNECTIONS.CAPTURE_FINGERPRINT, event, params),
      ).resolves.toEqual({
        fingerprint: 'ab'.repeat(32),
        tokenValid: false,
        statusCode: 401,
      });
      await expect(
        invoke(IPC_CHANNELS.CONNECTIONS.CAPTURE_FINGERPRINT, event, params),
      ).rejects.toBe(originalError);
      expect(probe).toHaveBeenCalledTimes(2);
      expect(probe).toHaveBeenNthCalledWith(1, params);
      expect(probe).toHaveBeenNthCalledWith(2, params);
      expect(pool.disposeAllBackendClients()).toBeUndefined();
    } finally {
      probe.mockRestore();
    }
  });
});

// Direct evidence controls execute real pool/client bodies and exact extracted passive consumers.
import { randomUUID } from 'node:crypto';
type DirectJournal = ReturnType<
  typeof import('../../../../../test/fixtures/native-review-native/main').statusProducerJournal
>;
type DirectEvent = Parameters<NonNullable<Parameters<Pool['enrollBackendClientLifecycle']>[0]>>[0];
function directFunctions(file: string, names: string[]): Record<string, (...args: any[]) => any> {
  const text = readFileSync(path.resolve(file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const nodes = source.statements.filter(
    (n): n is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? ''),
  );
  expect(nodes).toHaveLength(names.length);
  const code = ts.transpileModule(nodes.map((n) => n.getText(source)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('exports', 'randomUUID', code + '\nreturn {' + names.join(',') + '};')(
    {},
    randomUUID,
  );
}
function directConsumers() {
  return directFunctions('test/fixtures/native-review-native/review.electron.ts', [
    'companionMainObject',
    'companionMainRequire',
    'companionMainJournal',
    'assertDirectStatusOwners',
    'assertCompanionMainOwnership',
    'companionPhasesOnce',
  ]);
}
async function loadDirect(observer?: (event: DirectEvent) => void) {
  const journal = directFunctions('test/fixtures/native-review-native/main.ts', [
    'statusProducerJournal',
  ]).statusProducerJournal!() as DirectJournal;
  pool = await import('../backend.ipc');
  const lifecycle = pool.enrollBackendClientLifecycle(observer ?? journal.observe);
  pool.__setBackendWindowHooksForTesting({
    openOrFocus: async (id) => {
      edge.opens.push(id);
    },
  });
  pool.registerBackendHandlers();
  const { JsonRpcClient: ActualClient } = await import('../json-rpc-client');
  const original = ActualClient.prototype.request;
  const calls: Array<{
    client: JsonRpcClient;
    callId: string;
    promise: Promise<unknown>;
    entry: unknown;
  }> = [];
  const spy = vi.spyOn(ActualClient.prototype, 'request').mockImplementation(function (
    this: JsonRpcClient,
    ...args: Parameters<JsonRpcClient['request']>
  ) {
    if (args[0] !== 'host.status') return Reflect.apply(original, this, args);
    const callId = randomUUID(),
      clientId = journal.memberId(this),
      entry = this.getRepositoryConnection();
    const fields = { callId, clientId, connectionId: null, incarnationId: null, socketId: null };
    journal.record('request-enter', { ...fields, entryStatus: this.getStatus(), owner: 'unknown' });
    const promise = Reflect.apply(original, this, args) as Promise<unknown>;
    journal.request(this, promise, callId);
    calls.push({ client: this, callId, promise, entry });
    void promise.then(
      () => {
        journal.release(promise);
        journal.record('request-settled', { ...fields, state: 'fulfilled' });
      },
      () => {
        journal.release(promise);
        journal.record('request-settled', { ...fields, state: 'rejected' });
      },
    );
    return promise;
  });
  const retirementFence = fence();
  const retire = () => lifecycle.retire(retirementFence);
  return {
    pool,
    lifecycle,
    journal,
    calls,
    retire,
    stopObservation: () => spy.mockRestore(),
    async cleanup() {
      try {
        await Promise.allSettled(calls.map((call) => call.promise));
        await retire();
      } finally {
        spy.mockRestore();
      }
    },
  };
}
function directCoverage(
  journal: DirectJournal,
  result: Awaited<ReturnType<ReturnType<Pool['enrollBackendClientLifecycle']>['retire']>>,
) {
  const rows = journal.snapshot().rows as Array<Record<string, any>>;
  const calls = new Map(
    rows.filter((row) => row.phase === 'request-enter').map((row) => [row.callId, row]),
  );
  rows.push({
    phase: 'pool-retirement',
    clients: result.clients.map((client) => ({
      generation: client.identity.generation,
      ownersJoined: client.ownersJoined,
      outcome: client.outcome,
      failureKinds: client.failures.map((f) => f.kind),
      closes: client.closes.map((c) => ({
        destroyRequested: c.destroyRequested,
        closeObserved: c.closeObserved,
      })),
    })),
  });
  return { rows, calls };
}

describe('direct status owner evidence', () => {
  it('D1 holds original hello and binds nullable entry to the identical member and request Promise', async () => {
    const hello = deferred<unknown>(),
      reached = nextFrame('client.hello');
    edge.respond = (_socket, frame) =>
      frame.method === 'client.hello' ? hello.promise : defaultReply(frame);
    const f = await loadDirect();
    const client = f.pool.getLocalBackendClient();
    try {
      const { frame } = await reached;
      expect(client.getRepositoryConnection()).toBeNull();
      hello.resolve(defaultReply(frame));
      await connection(client);
      await settledTurn();
      expect(f.calls.length).toBeGreaterThan(0);
      expect(f.calls.some((call) => call.entry === null)).toBe(true);
      expect(f.calls.every((call) => call.client === client)).toBe(true);
      await Promise.all(f.calls.map((call) => call.promise));
      const result = await f.retire();
      expect(result.outcome).toBe('clean');
      const coverage = directCoverage(f.journal, result);
      expect(() =>
        directConsumers().assertDirectStatusOwners!(coverage.rows, coverage.calls),
      ).not.toThrow();
      expect(f.journal.snapshot().failed).toBe(0);
    } finally {
      hello.resolve({});
      await Promise.allSettled(f.calls.map((call) => call.promise));
      await f.cleanup();
    }
  });
  it('D1 retains remote store continuation on its original owner and member', async () => {
    const hold = deferred<unknown>(),
      entered = deferred();
    edge.findGuest = (id) => {
      if (id === 'remote-A') {
        entered.resolve();
        return hold.promise;
      }
      return Promise.resolve(null);
    };
    const f = await loadDirect();
    try {
      const client = await f.pool.connectBackendClient('remote-A');
      await entered.promise;
      await connection(client);
      const retired = f.retire();
      let done = false;
      void retired.then(() => {
        done = true;
      });
      await settledTurn();
      expect(done).toBe(false);
      hold.resolve(null);
      const result = await retired;
      expect(result.outcome).toBe('clean');
      const coverage = directCoverage(f.journal, result);
      expect(() =>
        directConsumers().assertDirectStatusOwners!(coverage.rows, coverage.calls),
      ).not.toThrow();
      expect(
        coverage.rows.some(
          (r) => r.phase === 'direct-request' && r.site === 'captureRemoteHostname',
        ),
      ).toBe(true);
    } finally {
      hold.resolve(null);
      await Promise.allSettled(f.calls.map((call) => call.promise));
      await f.cleanup();
    }
  });
  it('D1 binds the original local window probe and its queue parent', async () => {
    const f = await loadDirect();
    try {
      await expect(f.pool.openBackendWindow('local')).resolves.toEqual({ id: 'local' });
      const result = await f.retire();
      expect(result.outcome).toBe('clean');
      const coverage = directCoverage(f.journal, result);
      expect(
        coverage.rows.some(
          (row) => row.phase === 'direct-request' && row.site === 'performOpenBackendWindow',
        ),
      ).toBe(true);
      directConsumers().assertDirectStatusOwners!(coverage.rows, coverage.calls);
    } finally {
      await f.cleanup();
    }
  });
  it('D5 preserves original rejected metadata and its handled outer failure', async () => {
    edge.respond = (_socket, frame) =>
      frame.method === 'host.status'
        ? Promise.reject(new Error('private-controlled-failure'))
        : defaultReply(frame);
    const f = await loadDirect();
    try {
      const client = f.pool.getLocalBackendClient();
      await connection(client);
      await settledTurn();
      const call = f.calls[0]!;
      let original: unknown;
      try {
        await call.promise;
      } catch (error) {
        original = error;
      }
      expect(original).toBeInstanceOf(Error);
      const result = await f.retire();
      expect(result.outcome).toBe('original-failure');
      expect(result.failures.some((failure) => failure.error === original)).toBe(true);
      expect(JSON.stringify(f.journal.snapshot())).not.toContain('private-controlled-failure');
      const coverage = directCoverage(f.journal, result);
      expect(() =>
        directConsumers().assertDirectStatusOwners!(coverage.rows, coverage.calls),
      ).toThrow();
    } finally {
      await f.cleanup();
    }
  });
  it('D2 separates original heartbeat inner settlement, callback completion and full client drain', async () => {
    vi.useFakeTimers();
    const f = await loadDirect();
    const client = f.pool.getLocalBackendClient();
    const hold = deferred<unknown>();
    try {
      await connection(client);
      await vi.advanceTimersByTimeAsync(0);
      edge.respond = (_socket, frame) =>
        frame.method === 'host.status' ? hold.promise : defaultReply(frame);
      const reached = nextFrame('host.status');
      vi.advanceTimersByTime(30_000);
      await reached;
      const raw = f.calls.at(-1)!.promise;
      const ticket = client.beginRetirement();
      const retired = f.retire();
      const witness = raw.then((value) => {
        const rows = f.journal.snapshot().rows as Array<Record<string, any>>;
        const edge = rows.findLast(
          (row) => row.phase === 'direct-request' && row.site === 'healthCheck',
        )!;
        return {
          value,
          drained: ticket.isDrained(),
          callbackDone: rows.some(
            (row) => row.phase === 'direct-owner-end' && row.ownerId === edge.ownerId,
          ),
        };
      });
      hold.resolve({ hostname: 'original-heartbeat' });
      expect(await witness).toEqual({
        value: { hostname: 'original-heartbeat' },
        drained: false,
        callbackDone: false,
      });
      const result = await retired;
      expect(result.outcome).toBe('clean');
      const coverage = directCoverage(f.journal, result);
      directConsumers().assertDirectStatusOwners!(coverage.rows, coverage.calls);
    } finally {
      hold.resolve({});
      await Promise.allSettled(f.calls.map((call) => call.promise));
      await f.cleanup();
    }
  });
  it('D3 keeps simultaneous and replacement member identities distinct without promoting forced retirement', async () => {
    const f = await loadDirect();
    try {
      const first = await f.pool.connectBackendClient('remote-A');
      const sibling = f.pool.getLocalBackendClient();
      await Promise.all([connection(first), connection(sibling)]);
      await settledTurn();
      f.pool.disconnectBackendClient('remote-A');
      const replacement = await f.pool.connectBackendClient('remote-A');
      await connection(replacement);
      await settledTurn();
      expect(new Set([first, sibling, replacement]).size).toBe(3);
      expect(new Set([first, sibling, replacement].map((c) => f.journal.memberId(c))).size).toBe(3);
      const result = await f.retire();
      expect(result.outcome).toBe('forced');
      const coverage = directCoverage(f.journal, result);
      expect(() =>
        directConsumers().assertDirectStatusOwners!(coverage.rows, coverage.calls),
      ).toThrow();
    } finally {
      await Promise.allSettled(f.calls.map((call) => call.promise));
      await f.cleanup();
    }
  });
  it('D4 refuses a fulfilled external status without an original admitted outer edge', async () => {
    const f = await loadDirect();
    try {
      const client = f.pool.getLocalBackendClient();
      await connection(client);
      await settledTurn();
      const original = client.request('host.status');
      await original;
      const call = f.calls.find((call) => call.promise === original)!;
      const result = await f.retire();
      expect(result.outcome).toBe('clean');
      const coverage = directCoverage(f.journal, result);
      expect(
        coverage.rows.some((row) => row.phase === 'direct-request' && row.callId === call.callId),
      ).toBe(false);
      expect(() =>
        directConsumers().assertDirectStatusOwners!(coverage.rows, coverage.calls),
      ).toThrow('coverage');
    } finally {
      await Promise.allSettled(f.calls.map((call) => call.promise));
      await f.cleanup();
    }
  });
  it('D5 observer failure stays incomplete without changing the original lifecycle outcome', async () => {
    const f = await loadDirect(() => {
      throw new Error('observer-only');
    });
    try {
      const client = f.pool.getLocalBackendClient();
      await connection(client);
      await settledTurn();
      const result = await f.retire();
      expect(result.outcome).toBe('clean');
      expect(f.lifecycle.observationFailures()).toBeGreaterThan(0);
      expect(() =>
        directConsumers().companionMainJournal!(
          f.journal.snapshot(f.lifecycle.observationFailures()),
        ),
      ).toThrow();
    } finally {
      await Promise.allSettled(f.calls.map((call) => call.promise));
      await f.cleanup();
    }
  });
  it('D5 preserves off-path original Promise value rejection and synchronous throw identity', async () => {
    const file = 'src/features/backend/main/backend.ipc.ts';
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const n = source.statements.find(
      (n): n is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(n) && n.name?.text === 'observeStatus',
    )!;
    const code = ts.transpileModule(n.getText(source), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const fn = new Function('poolLifecycle', 'observePool', code + '\nreturn observeStatus;')(
      undefined,
      () => {
        throw new Error('off observer');
      },
    ) as (c: object, s: string, o: undefined, f: () => Promise<unknown>) => Promise<unknown>;
    const value = {},
      result = Promise.resolve(value),
      error = {};
    expect(fn({}, 'healthCheck', undefined, () => result)).toBe(result);
    expect(await result).toBe(value);
    const rejected = Promise.reject(error);
    expect(fn({}, 'healthCheck', undefined, () => rejected)).toBe(rejected);
    await expect(rejected).rejects.toBe(error);
    try {
      fn({}, 'healthCheck', undefined, () => {
        throw error;
      });
      throw new Error('not thrown');
    } catch (caught) {
      expect(caught).toBe(error);
    }
  });
  it('D5 retains original row and byte caps and omits raw values', () => {
    const make = directFunctions('test/fixtures/native-review-native/main.ts', [
      'statusProducerJournal',
    ]).statusProducerJournal!;
    const j = make() as DirectJournal;
    for (let i = 0; i < 129; i++) j.record('bounded-control', { index: i });
    expect(j.snapshot()).toMatchObject({
      retained: 128,
      dropped: 1,
      recordingComplete: false,
      ownerCompletionObserved: false,
    });
    const large = make() as DirectJournal;
    large.record('bounded-control', { value: 'x'.repeat(1_048_577) });
    expect(large.snapshot()).toMatchObject({ retained: 0, dropped: 1, recordingComplete: false });
  });
});

/** Consumer inputs are controlled records, never claims of native enrollment or disposal. */
function directConsumerInput() {
  const scopeId = randomUUID(),
    clientId = randomUUID(),
    otherClient = randomUUID(),
    ownerId = randomUUID(),
    callId = randomUUID();
  const sockets = [randomUUID(), randomUUID()];
  const fields = { callId, clientId, connectionId: null, incarnationId: null, socketId: null };
  const close = { destroyRequested: true, closeObserved: true };
  const clients = [1, 2].map((generation) => ({
    generation,
    ownersJoined: true,
    outcome: 'clean',
    failureKinds: [],
    closes: [{ ...close }],
  }));
  const rows: Array<Record<string, any>> = [
    { phase: 'direct-enrolled', scopeId },
    { phase: 'direct-member', scopeId, clientId, generation: 1 },
    { phase: 'direct-member', scopeId, clientId: otherClient, generation: 2 },
    { phase: 'request-enter', ...fields, entryStatus: 'connecting', owner: 'unknown' },
    {
      phase: 'direct-owner-enter',
      scopeId,
      ownerId,
      parentId: null,
      kind: 'healthCheck',
      callback: true,
      admittedAt: 4,
    },
    {
      phase: 'direct-request',
      scopeId,
      clientId,
      generation: 1,
      ownerId,
      callId,
      site: 'healthCheck',
      observedAt: 5,
    },
    { phase: 'request-settled', ...fields, state: 'fulfilled' },
    { phase: 'direct-owner-end', scopeId, ownerId, completedAt: 6, state: 'fulfilled' },
    { phase: 'renderer-roots-joined', producers: 2, seal: true },
    ...sockets.map((socketId, host) => ({ phase: 'socket-event', socketId, host, event: 'close' })),
    ...clients.map((c, i) => ({
      phase: 'direct-member-retired',
      scopeId,
      clientId: i ? otherClient : clientId,
      ...c,
      instanceId: randomUUID(),
      admissionSealed: true,
    })),
    {
      phase: 'pool-retirement',
      ownersJoined: true,
      admissionSealed: true,
      outcome: 'clean',
      exclusions: [],
      failureKinds: [],
      clients,
    },
    { phase: 'ledger-join-return', producersClosed: true, pending: 0, sealed: true, rows: 1 },
  ];
  const journal = {
    version: 1,
    observed: rows.length,
    retained: rows.length,
    dropped: 0,
    failed: 0,
    directObservationFailures: 0,
    recordingComplete: true,
    ownerCompletionObserved: false,
    ownerCompletionLimit: 'The public client API exposes no original outer healthCheck join',
    rows,
  };
  const source = {
    statusProducers: journal,
    faults: [],
    completionFaults: [],
    pending: 0,
    outstandingOriginals: 0,
    completions: [{ layer: 'client', method: 'host.status', ...fields, state: 'fulfilled' }],
    records: [],
    allocations: sockets.map((socketId, host) => ({ socketId, host, destroyed: true })),
  };
  const tasks = [
    'connectionsSaga',
    'daemonEventsSaga',
    'principalSaga',
    'lifecycleReadSaga',
    'repositoryContextSaga',
    'gitReadSaga',
    'acceptChangesStatusSaga',
  ];
  const quiescence = {
    producers: ['host-A', 'local-B'].map((key, i) => ({
      key,
      sender: i + 1,
      receipt: {
        route: { startupSettled: true, closed: true },
        producersClosed: true,
        faults: [],
        tasks: tasks.map((name) => ({ name, joined: true, iteratorDone: true })),
      },
    })),
    joined: { producersClosed: true, pending: 0, sealed: true, rows: 1 },
  };
  const recount = () => {
    rows.forEach((row, i) => {
      row.sequence = i + 1;
    });
    journal.observed = journal.retained = rows.length;
  };
  recount();
  return {
    source,
    quiescence,
    recount,
    rows,
    initial: { ...journal, rows: [], observed: 0, retained: 0 },
  };
}
describe('direct status owner consumer', () => {
  it('D6 keeps passive unknown and null truthful alongside complete direct coverage', () => {
    const input = directConsumerInput();
    const result = directConsumers().assertCompanionMainOwnership!(
      input.source,
      input.quiescence,
      input.initial,
    );
    expect(result).toMatchObject({
      complete: true,
      nativeStop: 'not asserted',
      privateTicketIdentity: 'not exposed',
    });
    expect(input.rows.find((row) => row.phase === 'request-enter')).toMatchObject({
      owner: 'unknown',
      connectionId: null,
      incarnationId: null,
      socketId: null,
    });
    expect(input.source.completions[0]).not.toHaveProperty('wireRequests');
    expect(input.source.statusProducers.ownerCompletionObserved).toBe(false);
  });
  const failures: Array<[string, (input: ReturnType<typeof directConsumerInput>) => void]> = [
    [
      'missing request edge',
      (x) => {
        x.rows.splice(
          x.rows.findIndex((r) => r.phase === 'direct-request'),
          1,
        );
      },
    ],
    [
      'duplicate request edge',
      (x) => {
        x.rows.splice(6, 0, { ...x.rows[5]! });
      },
    ],
    [
      'foreign client',
      (x) => {
        x.rows[5]!.clientId = randomUUID();
      },
    ],
    [
      'foreign generation',
      (x) => {
        x.rows[5]!.generation = 2;
      },
    ],
    [
      'foreign owner',
      (x) => {
        x.rows[5]!.ownerId = randomUUID();
      },
    ],
    [
      'foreign scope',
      (x) => {
        x.rows[5]!.scopeId = randomUUID();
      },
    ],
    [
      'callback before original request settlement',
      (x) => {
        [x.rows[6], x.rows[7]] = [x.rows[7]!, x.rows[6]!];
      },
    ],
    [
      'unsettled callback',
      (x) => {
        x.rows.splice(7, 1);
      },
    ],
    [
      'late callback',
      (x) => {
        x.rows[7]!.completedAt = 3;
      },
    ],
    [
      'invalid parent',
      (x) => {
        x.rows[4]!.parentId = randomUUID();
      },
    ],
    [
      'failed callback',
      (x) => {
        x.rows[7]!.state = 'rejected';
      },
    ],
    [
      'lost evidence',
      (x) => {
        x.source.statusProducers.dropped = 1;
      },
    ],
    [
      'observer error',
      (x) => {
        x.source.statusProducers.directObservationFailures = 1;
      },
    ],
    [
      'missing member retirement',
      (x) => {
        x.rows.splice(11, 1);
      },
    ],
    [
      'foreign member retirement',
      (x) => {
        x.rows[11]!.clientId = randomUUID();
      },
    ],
    [
      'duplicate member generation',
      (x) => {
        x.rows[2]!.generation = 1;
      },
    ],
    [
      'aggregate exclusion',
      (x) => {
        x.rows[13]!.exclusions = ['unknown'];
      },
    ],
    [
      'aggregate late fault',
      (x) => {
        x.rows[13]!.failureKinds = ['late'];
      },
    ],
    [
      'false facade completion',
      (x) => {
        x.rows[11]!.closes = [{ destroyRequested: true, closeObserved: false }];
      },
    ],
    [
      'lost root',
      (x) => {
        x.quiescence.producers[0]!.receipt.tasks[0]!.joined = false;
      },
    ],
    [
      'privacy field',
      (x) => {
        x.rows[5]!.rawStack = 'forbidden';
      },
    ],
    [
      'claiming private health completion',
      (x) => {
        x.source.statusProducers.ownerCompletionObserved = true;
      },
    ],
  ];
  for (const [name, change] of failures)
    it('D6 refuses ' + name, () => {
      const input = directConsumerInput();
      change(input);
      input.recount();
      expect(() =>
        directConsumers().assertCompanionMainOwnership!(
          input.source,
          input.quiescence,
          input.initial,
        ),
      ).toThrow();
    });
  for (const original of [new Error('primary'), { primary: true }, undefined])
    it('D6 preserves original first error ' + typeof original, async () => {
      const input = directConsumerInput();
      input.rows.splice(5, 1);
      input.recount();
      const consumer = directConsumers();
      const reached: string[] = [];
      let caught: unknown = 'not reached';
      try {
        await consumer.companionPhasesOnce!(
          [
            {
              name: 'body',
              run: () => {
                throw original;
              },
            },
            {
              name: 'ownership',
              run: () =>
                consumer.assertCompanionMainOwnership!(
                  input.source,
                  input.quiescence,
                  input.initial,
                ),
            },
            {
              name: 'close',
              run: () => {
                reached.push('close');
              },
            },
            {
              name: 'archive',
              run: () => {
                reached.push('archive');
              },
            },
          ],
          () => {},
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(original);
      expect(reached).toEqual(['close', 'archive']);
    });
});

describe('M real pool member retirement', () => {
  it('M6 joins a real native route execute and its late original release acknowledgment', async () => {
    const root = { workspaceId: 'controlled-workspace', kind: 'primary' as const };
    const operationId = 'aaaaaaaa-0000-4000-8000-000000000001';
    const preparation = {
      ...nativeFixture.prepare.reviewPreparation,
      root,
      operationId,
      scope: {
        daemonId: 'controlled-daemon',
        authorityScopeId: operationId,
        authorityGeneration: '1',
      },
      contextRevision: { epoch: operationId, sequence: '1' },
    };
    const terminal = deferred<unknown>(),
      releaseAck = deferred<unknown>();
    edge.respond = (_socket, frame) => {
      if (frame.method === 'accept-changes.prepare')
        return {
          ...nativeFixture.prepare,
          reviewPreparation: preparation,
          reviewOperation: { operationId, root, retirementSequence: '0', expiresAfterMs: 300000 },
        };
      if (frame.method === 'accept-changes.execute') return terminal.promise;
      if (frame.method === 'accept-changes.release') return releaseAck.promise;
      return defaultReply(frame);
    };
    const { pool, lifecycle } = await load();
    const client = pool.getLocalBackendClient();
    await connection(client);
    const { event } = await localWindow();
    const channels = IPC_CHANNELS.BACKEND.NATIVE_REVIEW;
    const prepared = (await invoke(channels.PREPARE, event, {
      input: {
        workspaceId: root.workspaceId,
        action: 'create-pr',
        review: { root, choice: { kind: 'saved' } },
      },
    })) as { ok: boolean; result: { id: string } };
    expect(prepared.ok).toBe(true);
    const reached = nextFrame('accept-changes.execute');
    const executing = invoke(channels.EXECUTE, event, {
      root,
      id: prepared.result.id,
      command: { prTitle: 'control' },
    });
    await reached;
    const released = nextFrame('accept-changes.release');
    await invoke(channels.RELEASE, event, { root, id: prepared.result.id });
    const boundary = fence(false);
    const joined = lifecycle.retireMember(client, boundary);
    let finished = false;
    void joined.then(() => {
      finished = true;
    });
    terminal.resolve({
      operationId,
      root,
      state: 'settled',
      success: true,
      steps: [],
      reviewExecution: {
        ...nativeFixture.execute.reviewExecution,
        preparation,
        requestId: operationId,
      },
    });
    await executing;
    await released;
    boundary.set(true);
    await settledTurn();
    expect(finished).toBe(false);
    expect(edge.sockets[0]!.destroyed).toBe(false);
    releaseAck.resolve({ released: true });
    const result = await joined;
    expect(result.outcome).toBe('clean');
    expect(lifecycle.admissionOpen()).toBe(true);
    expect(lifecycle.retireMember(client, boundary)).toBe(joined);
    const next = await pool.connectBackendClient('remote-A');
    await connection(next);
    expect(next).not.toBe(client);
    expect((await lifecycle.retire(fence())).outcome).toBe('clean');
    expect(
      edge.sockets[0]!.frames.filter((f) => f.method === 'accept-changes.execute'),
    ).toHaveLength(1);
    expect(
      edge.sockets[0]!.frames.filter((f) => f.method === 'accept-changes.release'),
    ).toHaveLength(1);
  });

  it('M7 joins a held original hello/store continuation before admitting replacement', async () => {
    const held = deferred<unknown>(),
      entered = deferred();
    edge.findGuest = () => {
      entered.resolve();
      return held.promise;
    };
    const { pool, lifecycle } = await load();
    const client = await pool.connectBackendClient('remote-A');
    await entered.promise;
    const originalFence = fence();
    const retired = lifecycle.retireMember(client, originalFence);
    let complete = false;
    void retired.then(() => {
      complete = true;
    });
    await settledTurn();
    expect(complete).toBe(false);
    expect(edge.sockets[0]!.destroyed).toBe(false);
    held.resolve(null);
    const result = await retired;
    expect(result.outcome).toBe('clean');
    expect(lifecycle.retireMember(client, originalFence)).toBe(retired);
    const replacement = await pool.connectBackendClient('remote-A');
    await connection(replacement);
    expect(replacement).not.toBe(client);
    expect((await lifecycle.retire(fence())).outcome).toBe('clean');
  });
  it('M8 rejects independent work and keeps its fault after the member drained', async () => {
    const { pool, lifecycle } = await load();
    const client = await pool.connectBackendClient('remote-A');
    await connection(client);
    await settledTurn();
    const boundary = fence(false);
    const retired = lifecycle.retireMember(client, boundary);
    await expect(client.request('host.status')).rejects.toThrow('producer');
    boundary.set(true);
    expect((await retired).outcome).toBe('ownership-fault');
    expect((await lifecycle.retire(fence())).outcome).toBe('ownership-fault');
  });
  it('M9 global stop takes the atomic barrier from an in-progress member and forbids Guest', async () => {
    const { pool, lifecycle } = await load();
    const first = await pool.connectBackendClient('remote-A');
    const local = pool.getLocalBackendClient();
    await Promise.all([connection(first), connection(local)]);
    await settledTurn();
    const originalFence = fence(false);
    const member = lifecycle.retireMember(first, originalFence);
    const globalFence = fence(false);
    const all = lifecycle.retire(globalFence);
    expect(lifecycle.admissionOpen()).toBe(false);
    originalFence.set(true);
    await settledTurn();
    expect(edge.sockets.every((s) => !s.destroyed)).toBe(true);
    globalFence.set(true);
    expect((await all).outcome).toBe('clean');
    expect((await member).outcome).toBe('clean');
    await expect(pool.connectBackendClient('guest-after-stop')).rejects.toThrow();
    expect(edge.sockets).toHaveLength(2);
  });
  it('M10 refuses foreign clients and changed original fences without choosing an ordinal', async () => {
    const { pool, lifecycle } = await load();
    const client = await pool.connectBackendClient('remote-A');
    await connection(client);
    await settledTurn();
    expect(() => lifecycle.retireMember({} as JsonRpcClient, fence())).toThrow();
    const boundary = fence(false),
      original = lifecycle.retireMember(client, boundary);
    expect(() => lifecycle.retireMember(client, fence())).toThrow('fence changed');
    boundary.set(true);
    expect((await original).outcome).toBe('ownership-fault');
    await lifecycle.retire(fence());
  });
});

describe('M genuine delayed feed producers', () => {
  const root = { kind: 'primary' as const, workspaceId: 'workspace-1' };
  async function realFeed<T>(factory: (client: JsonRpcClient) => T) {
    const { JsonRpcClient: ActualClient } = await import('../json-rpc-client');
    const client = new ActualClient({
      lifecycle: { scope: Symbol('feed-original'), generation: 1 },
      helloParams: () => ({ clientId: 'original-feed' }),
    });
    const feed = factory(client);
    client.start();
    await connection(client);
    return { client, feed };
  }
  function retireClient(client: JsonRpcClient) {
    const ticket = client.beginMemberRetirement();
    return (async () => {
      if (!ticket.isDrained())
        await new Promise<void>((resolve) => {
          const off = ticket.subscribeChanged(() => {
            if (ticket.isDrained()) {
              off();
              resolve();
            }
          });
        });
      return ticket.seal().finish();
    })();
  }
  const selection = () => ({
    selectionId: 'original-selection',
    scope: {
      daemonId: 'controlled',
      authorityScopeId: 'original-selection',
      authorityGeneration: '1',
    },
    root,
    snapshot: {
      root,
      rootIncarnation: '1',
      selectionRevision: '1',
      selection: { kind: 'neverSaved' },
    },
    retirementSequence: '0',
    expiresAfterMs: 300000,
  });
  it.each([false, true])(
    'M11 joins real delayed selection release; independent identical request=%s is separate',
    async (independent) => {
      const action = deferred<unknown>(),
        release = deferred<unknown>();
      edge.respond = (_socket, frame) =>
        frame.method === 'workspace.repositorySelection.capture'
          ? selection()
          : frame.method === 'workspace.repositorySelection.save'
            ? action.promise
            : frame.method === 'workspace.repositorySelection.release'
              ? release.promise
              : defaultReply(frame);
      const { createRepositorySelectionFeed } = await import('../repository-selection-feed');
      const { client: local, feed: originalFeed } = await realFeed(createRepositorySelectionFeed);
      const captured = local.getRepositoryConnection()!;
      const op = await originalFeed.capture(captured, root);
      const saving = op.confirm({
        kind: 'save',
        choice: { mode: 'explicit-remote', remoteName: 'origin' },
      });
      const cleanup = op.release();
      expect(op.isAdmitted()).toBe(false);
      expect(edge.writes.filter((w) => w.endsWith('repositorySelection.release'))).toHaveLength(0);
      const retired = retireClient(local);
      if (independent)
        await expect(
          local.requestOnCapturedConnection(
            captured,
            'workspace.repositorySelection.release',
            { workspaceId: root.workspaceId, selectionId: 'original-selection' },
            { timeoutMs: 5000 },
          ),
        ).rejects.toThrow('producer');
      action.resolve({
        selectionId: 'original-selection',
        root,
        attempt: {
          status: 'settled',
          receipt: {
            result: { kind: 'failed', code: 'admission-retired' },
            persistence: { kind: 'committed', selectionRevision: '2' },
          },
        },
      });
      await saving;
      await settledTurn();
      expect(edge.writes.filter((w) => w.endsWith('repositorySelection.release'))).toHaveLength(1);
      expect(edge.sockets.find((s) => s.owner === 'local')!.destroyed).toBe(false);
      release.resolve({ released: true });
      await cleanup;
      originalFeed.dispose();
      expect((await retired).outcome).toBe(independent ? 'ownership-fault' : 'clean');
    },
  );
  it('M12 joins original authority read continuation and release before actual member close', async () => {
    const read = deferred<unknown>(),
      release = deferred<unknown>();
    edge.respond = (_socket, frame) =>
      frame.method === 'workspace.repositoryContext.capture'
        ? {
            lifetimeId: 'original-authority',
            scope: { daemonId: 'controlled', authorityScopeId: 'native', authorityGeneration: '1' },
            coverage: { kind: 'workspaceInventory', workspaceId: root.workspaceId },
            retirementSequence: '0',
            expiresAfterMs: 300000,
          }
        : frame.method === 'workspace.repositoryContext'
          ? read.promise
          : frame.method === 'workspace.repositoryContext.release'
            ? release.promise
            : defaultReply(frame);
    const { createRepositoryAuthorityFeed } = await import('../repository-authority-feed');
    const { client, feed } = await realFeed(createRepositoryAuthorityFeed);
    const op = await feed.capture(client.getRepositoryConnection()!, root);
    const original = op.request('workspace.repositoryContext', { workspaceId: root.workspaceId });
    const observed = original.catch((error) => error);
    op.dispose();
    const retired = retireClient(client);
    release.resolve({ released: true });
    await settledTurn();
    expect(edge.sockets[0]!.destroyed).toBe(false);
    const context = (await import('$shared/types/__fixtures__/repository-context.json')).default;
    read.resolve({
      ...context,
      scope: { daemonId: 'controlled', authorityScopeId: 'native', authorityGeneration: '1' },
      revision: { epoch: 'original-authority', sequence: '1' },
    });
    await observed;
    feed.dispose();
    expect((await retired).outcome).toBe('clean');
  });
  it('M13 retains abandoned selection capture through its genuine late release', async () => {
    const capture = deferred<unknown>(),
      release = deferred<unknown>();
    edge.respond = (_socket, frame) =>
      frame.method === 'workspace.repositorySelection.capture'
        ? capture.promise
        : frame.method === 'workspace.repositorySelection.release'
          ? release.promise
          : defaultReply(frame);
    const { createRepositorySelectionFeed } = await import('../repository-selection-feed');
    const { client, feed } = await realFeed(createRepositorySelectionFeed);
    const original = feed.capture(client.getRepositoryConnection()!, root);
    const observed = original.catch((error) => error);
    feed.dispose();
    const retired = retireClient(client);
    capture.resolve(selection());
    await observed;
    await settledTurn();
    expect(edge.sockets[0]!.destroyed).toBe(false);
    expect(edge.writes.filter((w) => w.endsWith('repositorySelection.release'))).toHaveLength(1);
    release.resolve({ released: true });
    expect((await retired).outcome).toBe('clean');
  });
});

describe('M actual fixture original Member fence', () => {
  it('M24 shares original intermediate quiescence and admits Guest only after its member closes', async () => {
    // Remote status refresh reads local preferences before lazily probing the
    // local daemon. One event-loop turn does not join that filesystem read.
    const localProbe = nextFrame('server.pairingInfo', 'local');
    const observed = await loadDirect();
    const { pool, lifecycle } = observed;
    const client = await pool.connectBackendClient('remote-A');
    await connection(client);
    await localProbe;
    await settledTurn();
    const initialSockets = [...edge.sockets];
    const memberSocket = edge.sockets.find((socket) => socket.owner === 'remote-A.test')!;
    const f = fixtureFinalization(lifecycle, true, client, observed.journal);
    const original = f.actual.quiesceUi(false);
    expect(f.actual.quiesceUi(false)).toBe(original);
    let changed = false;
    const originalRole = f.actual.role('guest');
    expect(f.actual.role('guest')).toBe(originalRole);
    await expect(f.actual.role('owner')).rejects.toThrow('Original role transition changed');
    const role = originalRole.then(() => {
      changed = true;
    });
    await settledTurn();
    expect(changed).toBe(false);
    expect(edge.sockets).toEqual(initialSockets);
    f.roots.resolve(f.receipt);
    await original;
    await role;
    expect(memberSocket.destroyed).toBe(true);
    expect(edge.sockets.find((socket) => socket.owner === 'remote-B.test')).toBeDefined();
    await f.actual.quiesceUi();
    await f.actual.shutdown();
    const snapshot = observed.journal.snapshot(lifecycle.observationFailures());
    const rows = snapshot.rows as Array<Record<string, any>>;
    const calls = new Map(
      rows.filter((r) => r.phase === 'request-enter').map((r) => [r.callId, r]),
    );
    expect(snapshot.recordingComplete).toBe(true);
    const originalId = observed.journal.memberId(client);
    expect(
      rows.filter((r) => r.phase === 'direct-member-retired' && r.clientId === originalId),
    ).toHaveLength(1);
    directConsumers().assertDirectStatusOwners!(rows, calls);
    observed.stopObservation();
  });
  it.each([new Error('original roots'), undefined, 'original-value'])(
    'M25 preserves original fence rejection %s and admits nothing',
    async (error) => {
      const { pool, lifecycle } = await load();
      const client = await pool.connectBackendClient('remote-A');
      await connection(client);
      await settledTurn();
      const initialSockets = [...edge.sockets];
      const memberSocket = edge.sockets.find((socket) => socket.owner === 'remote-A.test')!;
      const f = fixtureFinalization(lifecycle, true, client);
      const original = f.actual.quiesceUi(false);
      const seen = original.catch((value) => ({ value }));
      const role = f.actual.role('guest');
      const denied = role.catch((value) => ({ value }));
      f.roots.reject(error);
      expect(((await seen) as { value: unknown }).value).toBe(error);
      expect(((await denied) as { value: unknown }).value).toBe(error);
      expect(edge.sockets).toEqual(initialSockets);
      expect(memberSocket.destroyed).toBe(false);
    },
  );
});

describe('M original admission races', () => {
  it('M26 joins held original hello and its actual descendants before member close', async () => {
    const hello = deferred<unknown>(),
      entered = deferred();
    edge.respond = (socket, frame) => {
      if (socket.owner === 'remote-A.test' && frame.method === 'client.hello') {
        entered.resolve();
        return hello.promise;
      }
      return defaultReply(frame);
    };
    const { pool, lifecycle } = await load();
    const client = await pool.connectBackendClient('remote-A');
    await entered.promise;
    const retired = lifecycle.retireMember(client, fence());
    let completed = false;
    void retired.then(() => {
      completed = true;
    });
    await settledTurn();
    expect(completed).toBe(false);
    hello.resolve(defaultReply({ id: 1, method: 'client.hello' }));
    expect((await retired).outcome).toBe('clean');
    expect((await lifecycle.retire(fence())).outcome).toBe('clean');
  });
  it('M27 preserves pending other-member allocation through global admission closure', async () => {
    const { pool, lifecycle } = await load();
    const client = await pool.connectBackendClient('remote-A');
    await connection(client);
    await settledTurn();
    const allocation = deferred<unknown[]>(),
      entered = deferred();
    edge.list = () => {
      entered.resolve();
      return allocation.promise;
    };
    const pending = pool.connectBackendClient('remote-B');
    await entered.promise;
    const member = lifecycle.retireMember(client, fence());
    const global = lifecycle.retire(fence());
    allocation.resolve([
      {
        id: 'remote-B',
        host: 'remote-B.test',
        hosts: ['remote-B.test'],
        port: 443,
        fingerprint: 'ab'.repeat(32),
      },
    ]);
    const remote = await pending;
    expect(remote).not.toBe(client);
    const final = await global;
    expect(final.failures.map((f) => ({ kind: f.kind, error: f.error }))).toEqual([]);
    expect(final.outcome).toBe('clean');
    expect((await member).outcome).toBe('clean');
  });
});
