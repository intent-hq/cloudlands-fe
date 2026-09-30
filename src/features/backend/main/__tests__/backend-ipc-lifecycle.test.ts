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
beforeEach(() => {
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

  it('P8 preserves the unenrolled immediate void disposer and refuses retroactive or duplicate enrollment', async () => {
    const { pool } = await load(false);
    const client = pool.getLocalBackendClient();
    expect(() => pool.enrollBackendClientLifecycle()).toThrow('unowned empty pool');
    expect(() => client.beginRetirement()).toThrow('not enrolled');
    expect(pool.disposeAllBackendClients()).toBeUndefined();
    expect(edge.sockets[0]!.destroyed).toBe(true);
  });

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
) {
  const filename = path.resolve('test/fixtures/native-review-native/main.ts');
  const text = readFileSync(filename, 'utf8');
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const run = source.statements.find(
    (n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'run',
  )!;
  const names = ['poolRetirement', 'finalRootsJoined', 'finalQuiescence', 'finalShutdown'];
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
      ts.isMethodDeclaration(n) && ['quiesceUi', 'shutdown'].includes(n.name.getText(source)),
  );
  const helpers = source.statements.filter(
    (n): n is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(n) &&
      ['completionLedger', 'finalClientPoolJoin', 'assertUiTasks', 'disposalComplete'].includes(
        n.name?.text ?? '',
      ),
  );
  expect([variables.length, bodies.length, methods.length, helpers.length]).toEqual([4, 2, 2, 4]);
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
    windows: new Map([['controlled', window]]),
    uiMode: true,
    diagnosticOwnership: true,
    statusProducers: { record: vi.fn() },
    pending: new Set(),
    faults: [],
    wireBoundaries: [],
    backend: { disposeAllBackendClients: backendDispose },
    http: { close: httpClose },
  };
  const actual = new Function('exports', ...Object.keys(params), code)(
    {},
    ...Object.values(params),
  ) as { quiesceUi(seal?: boolean): Promise<unknown>; shutdown(): Promise<void> };
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
