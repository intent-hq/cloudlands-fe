/** Actual WorkspaceService, pool and JsonRpcClient; only native/storage/transport edges controlled.
 * No startup, IPC registration, real daemon, or native service launch.
 */
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { app, BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceService } from '../workspace.service';

interface Frame {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}
const edge = vi.hoisted(() => ({ sockets: [] as ControlledSocket[] }));
vi.mock('../../../../main/window', async () => ({
  ...(await import('../../../../main/window-backend')),
  getFocusedWindowBackendId: () => 'local',
}));
vi.mock('../../../backend/main/client-identity', () => ({
  buildMainClientHelloParams: async () => ({ clientId: 'owned-reconnect-client' }),
  getOrCreateClientId: async () => 'owned-reconnect-client',
  persistClientId: async () => {},
  setLocalHostIdentity: () => false,
}));
vi.mock('../../../backend/main/connections-store', () => ({
  list: async () => [],
  getActiveId: async () => 'local',
  setDetectedDeviceKind: async () => false,
  setHostname: async () => false,
  setDaemonVersion: async () => false,
  setUpdateSupported: async () => false,
  setTcAddress: async () => false,
  setHosts: async () => false,
  getDetectHosts: async () => false,
  onConnectionsMutated: () => () => {},
}));
vi.mock('../../../backend/main/guest-sessions-store', () => ({
  list: async () => [],
  findById: async () => null,
  onGuestSessionsMutated: () => () => {},
  onGuestCredentialReplaced: () => () => {},
  onGuestSessionRemovedBySync: () => () => {},
  createInvitedSyncAdapter: () => ({}),
}));
vi.mock('../../../backend/main/intentd-sidecar', () => ({
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
vi.mock('../../../backend/main/backend-connection', async (original) => ({
  ...(await original<typeof import('../../../backend/main/backend-connection')>()),
  createBackendSocket() {
    const socket = new ControlledSocket();
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
  _read() {}
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    const frame = JSON.parse(chunk.toString()) as Frame;
    this.frames.push(frame);
    queueMicrotask(() =>
      this.emit(
        'data',
        Buffer.from(JSON.stringify({ id: frame.id, result: defaultReply(frame) }) + '\n'),
      ),
    );
    done();
  }
  _destroy(error: Error | null, done: (error?: Error | null) => void) {
    done(error);
  }
}

type Pool = typeof import('../../../backend/main/backend.ipc');
type Lifecycle = ReturnType<Pool['enrollBackendClientLifecycle']>;
type Observation = Parameters<NonNullable<Parameters<Pool['enrollBackendClientLifecycle']>[0]>>[0];
type Receipt = Awaited<ReturnType<Lifecycle['retire']>>;
let pool: Pool | undefined;
let lifecycle: Lifecycle | undefined;
let retirement: Promise<Receipt> | undefined;
let observer: ((event: Observation) => void) | undefined;
let events: Observation[];
let services: WorkspaceService[];
let releases: Array<() => void>;
let expectedPoolFailures: Receipt['failures'];
let expectedTransportError: Error | undefined;
let expectedGenerations: number[];
const platform = process.platform;
const boundary = { ready: () => true, subscribeChanged: () => () => {} };

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.stubEnv('INTENTD_SOCKET', '/controlled-owned-reconnect.sock');
  vi.stubEnv('INTENTD_WS_URL', '');
  vi.stubEnv('INTENTD_TCP', '');
  edge.sockets = [];
  events = [];
  services = [];
  releases = [];
  pool = undefined;
  lifecycle = undefined;
  retirement = undefined;
  observer = undefined;
  expectedPoolFailures = [];
  expectedTransportError = undefined;
  expectedGenerations = [1];
  const applicationEvents = new EventEmitter();
  Object.assign(app, {
    on: applicationEvents.on.bind(applicationEvents),
    once: applicationEvents.once.bind(applicationEvents),
    emit: applicationEvents.emit.bind(applicationEvents),
    removeListener: applicationEvents.removeListener.bind(applicationEvents),
  });
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
});

function retire() {
  return (retirement ??= lifecycle!.retire(boundary));
}
function assertReceipt(receipt: Receipt) {
  const transportFailures = expectedTransportError
    ? [{ owner: null, kind: 'transport', error: expectedTransportError }]
    : [];
  expect(receipt.ownersJoined).toBe(true);
  expect(receipt.admissionSealed).toBe(true);
  expect(receipt.excludedOwners).toEqual([]);
  expect(receipt.failures).toEqual([...expectedPoolFailures, ...transportFailures]);
  expect(receipt.outcome).toBe(
    expectedPoolFailures.length || expectedTransportError ? 'original-failure' : 'clean',
  );
  expect(receipt.clients.map((client) => client.identity.generation)).toEqual(expectedGenerations);
  for (const client of receipt.clients) {
    expect(client.ownersJoined).toBe(true);
    expect(client.admissionSealed).toBe(true);
    expect(client.failures).toEqual(transportFailures);
    expect(client.outcome).toBe(expectedTransportError ? 'original-failure' : 'clean');
    for (const close of client.closes) {
      expect(close.destroyRequested).toBe(true);
      expect(close.closeObserved).toBe(true);
    }
  }
  expect(receipt.clients.flatMap((client) => client.closes)).toHaveLength(edge.sockets.length);
  expect(edge.sockets.every((socket) => socket.destroyed)).toBe(true);
}

afterEach(async () => {
  try {
    for (const service of services) service.cleanup();
    for (const release of releases) release();
    if (lifecycle) assertReceipt(await retire());
    else if (pool) {
      const sockets = [...edge.sockets];
      pool!.disposeAllBackendClients();
      const closed = sockets.map((socket) =>
        socket.closed
          ? Promise.resolve()
          : new Promise<void>((resolve) => socket.once('close', resolve)),
      );
      await Promise.all(closed);
      expect(edge.sockets.every((socket) => socket.destroyed)).toBe(true);
      expect(edge.sockets.every((socket) => socket.closed)).toBe(true);
    }
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

async function load(enrolled = true) {
  pool = await import('../../../backend/main/backend.ipc');
  if (enrolled)
    lifecycle = pool!.enrollBackendClientLifecycle((event) => {
      events.push(event);
      observer?.(event);
    });
  return pool;
}
async function connect() {
  const client = pool!.getLocalBackendClient();
  await client.request('controlled.ready');
  expect(client.getStatus()).toBe('connected');
  return client;
}
async function service() {
  const { WorkspaceService } = await import('../workspace.service');
  const result = new WorkspaceService();
  services.push(result);
  return result;
}
function callbackEntries() {
  return events.filter(
    (event) => event.phase === 'owner-enter' && event.kind === 'owned-reconnect-callback',
  );
}
function listFrames() {
  return edge.sockets
    .flatMap((socket) => socket.frames)
    .filter((frame) => frame.method === 'workspace.list');
}
// Observe the actual stable emitter registration without replacing its methods.
function observeRegistration() {
  const on = vi.spyOn(EventEmitter.prototype, 'on');
  return () => {
    const index = on.mock.calls.findIndex(([name]) => name === 'reconnected');
    if (index === -1) throw new Error('Real reconnect listener was not installed');
    const emitter = on.mock.contexts[index] as EventEmitter;
    const listener = on.mock.calls[index]![1] as (backendId: string) => void | Promise<void>;
    on.mockRestore();
    expect(emitter.listeners('reconnected')).toContain(listener);
    return { emitter, listener };
  };
}

describe('workspace reconnect ownership', () => {
  it('invalidates the actual service cache after a physical reconnect and preserves wire coalescing', async () => {
    await load();
    const client = await connect();
    const current = await service();
    const result = await Promise.all([current.listWorkspaces(), current.listWorkspaces()]);
    expect(result.every((value) => value.ok)).toBe(true);
    await current.listWorkspaces({ includeArchived: true });
    expect(listFrames().map((frame) => frame.params)).toEqual([
      { includeArchived: false },
      { includeArchived: true },
    ]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const reconnected = new Promise<void>((resolve) => client.once('reconnected', resolve));
    expectedTransportError = new Error('controlled reconnect transport failure');
    edge.sockets[0]!.emit('error', expectedTransportError);
    await vi.advanceTimersToNextTimerAsync();
    await reconnected;
    await Promise.all([
      current.listWorkspaces(),
      current.listWorkspaces({ includeArchived: true }),
    ]);
    expect(listFrames().map((frame) => frame.params)).toEqual([
      { includeArchived: false },
      { includeArchived: true },
      { includeArchived: false },
      { includeArchived: true },
    ]);
    expect(callbackEntries()).toHaveLength(1);
    expect(edge.sockets).toHaveLength(2);
  });

  it.each(['service cleanup', 'pool retirement'] as const)(
    '%s removes the real service listener',
    async (reason) => {
      await load();
      const client = await connect();
      const current = await service();
      const finishCapture = observeRegistration();
      expect((await current.listWorkspaces()).ok).toBe(true);
      const { emitter, listener } = finishCapture();
      if (reason === 'service cleanup') current.cleanup();
      else assertReceipt(await retire());
      expect(emitter.listeners('reconnected')).not.toContain(listener);
      client.emit('reconnected');
      listener('local');
      expect(callbackEntries()).toHaveLength(0);
      current.cleanup();
      current.cleanup();
      expect(emitter.listeners('reconnected')).not.toContain(listener);
    },
  );

  it('drains an admitted returned promise after unsubscribe while stopping new callbacks', async () => {
    await load();
    const client = await connect();
    const pending = deferred();
    releases.push(() => pending.resolve());
    const handler = vi.fn(() => pending.promise);
    const finishCapture = observeRegistration();
    const off = pool!.onBackendReconnectedOwned(handler);
    const { emitter, listener } = finishCapture();
    client.emit('reconnected');
    off();
    off();
    expect(emitter.listeners('reconnected')).not.toContain(listener);
    listener('local');
    const join = retire();
    expect(client.beginRetirement().isDrained()).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    pending.resolve();
    assertReceipt(await join);
    listener('local');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each(['throw', 'reject'] as const)(
    'retains original callback %s identity while joining the client',
    async (mode) => {
      await load();
      const client = await connect();
      const failure = new Error('owned callback failure');
      expectedPoolFailures = [{ kind: 'original', error: failure }];
      const pending = deferred();
      releases.push(() => pending.resolve());
      pool!.onBackendReconnectedOwned(() => {
        if (mode === 'throw') throw failure;
        return pending.promise;
      });
      if (mode === 'throw') expect(() => client.emit('reconnected')).toThrow(failure);
      else {
        client.emit('reconnected');
        pending.reject(failure);
      }
      const receipt = await retire();
      assertReceipt(receipt);
      expect(receipt.failures[0]!.error).toBe(failure);
    },
  );

  it('makes disposal inside a callback idempotent before a reentrant reconnect', async () => {
    await load();
    const client = await connect();
    const handler = vi.fn(() => {
      off();
      client.emit('reconnected');
      off();
    });
    const off = pool!.onBackendReconnectedOwned(handler);
    client.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(1);
    assertReceipt(await retire());
  });

  it('joins callback work when that callback starts pool retirement', async () => {
    await load();
    const client = await connect();
    const pending = deferred();
    releases.push(() => pending.resolve());
    const handler = vi.fn(() => {
      retire();
      client.emit('reconnected');
      return pending.promise;
    });
    pool!.onBackendReconnectedOwned(handler);
    client.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.beginRetirement().isDrained()).toBe(false);
    pending.resolve();
    assertReceipt(await retirement!);
  });

  it.each(['dispose', 'retire'] as const)(
    'does not start user work after owner-observer reentrant %s',
    async (action) => {
      await load();
      const client = await connect();
      const handler = vi.fn();
      const off = pool!.onBackendReconnectedOwned(handler);
      observer = (event) => {
        if (event.phase !== 'owner-enter' || event.kind !== 'owned-reconnect-callback') return;
        if (action === 'dispose') off();
        else retire();
      };
      client.emit('reconnected');
      expect(handler).not.toHaveBeenCalled();
      assertReceipt(await retire());
    },
  );

  it('refuses registration if allocation reenters retirement, without installing a listener', async () => {
    await load();
    observer = (event) => {
      if (event.phase === 'member') retire();
    };
    const handler = vi.fn();
    expect(() => pool!.onBackendReconnectedOwned(handler)).toThrow('admission is closed');
    assertReceipt(await retire());
    expect(edge.sockets).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
    expect(() => pool!.onBackendReconnectedOwned(handler)).toThrow('admission is closed');
  });

  it('joins the emitting member, blocks its late events, and follows its real replacement', async () => {
    await load();
    const client = await connect();
    const pending = deferred();
    releases.push(() => pending.resolve());
    const handler = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockImplementation(() => undefined);
    const off = pool!.onBackendReconnectedOwned(handler);
    client.emit('reconnected');
    const memberJoin = lifecycle!.retireMember(client, boundary);
    expect(client.beginRetirement().isDrained()).toBe(false);
    client.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(1);
    pending.resolve();
    const member = await memberJoin;
    expect(member.outcome).toBe('clean');
    expect(member.failures).toEqual([]);
    const replacement = await connect();
    expect(replacement).not.toBe(client);
    replacement.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(2);
    expectedGenerations = [1, 2];
    off();
    assertReceipt(await retire());
  });

  it('keeps unenrolled default filtering and actual unsubscribe behavior', async () => {
    await load(false);
    const client = await connect();
    const handler = vi.fn();
    const finishCapture = observeRegistration();
    const off = pool!.onBackendReconnectedOwned(handler);
    const { emitter, listener } = finishCapture();
    emitter.emit('reconnected', 'another-backend');
    expect(handler).not.toHaveBeenCalled();
    client.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    expect(emitter.listeners('reconnected')).not.toContain(listener);
    client.emit('reconnected');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
