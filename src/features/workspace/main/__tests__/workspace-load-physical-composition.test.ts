/** Actual pool + JsonRpcClient + main routes + renderer transport.
 * Controlled boundaries: Electron frame/preload delivery, storage/identity and Duplex.
 * No native IPC, real daemon, socket-peer or service-readiness claim.
 */
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { app, BrowserWindow } from 'electron';
import type { BrowserWindow as ElectronWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonRpcClient } from '../../../backend/main/json-rpc-client';
import type {
  WorkspaceLoadOriginRef,
  WorkspaceLoadRouteRef,
} from '$shared/types/workspace-load-route';

interface Frame {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}
const edge = vi.hoisted(() => ({
  sockets: [] as ControlledSocket[],
  beforeSocketReturn: undefined as undefined | ((socket: ControlledSocket) => void),
  respond: undefined as undefined | ((socket: ControlledSocket, frame: Frame) => unknown),
  list: undefined as undefined | (() => Promise<unknown[]>),
  findGuest: undefined as undefined | ((id: string) => Promise<unknown>),
  persist: undefined as undefined | (() => Promise<void>),
  device: undefined as undefined | (() => Promise<boolean>),
  identityChanged: false,
  guest: false,
  credentialChanged: undefined as undefined | ((id: string) => void),
  autoHello: false,
}));
vi.mock('../../../../main/window', async () => import('../../../../main/window-backend'));
vi.mock('../../../backend/main/client-identity', () => ({
  buildMainClientHelloParams: async () => ({ clientId: 'lifecycle-control' }),
  getOrCreateClientId: async () => 'lifecycle-control',
  persistClientId: () => edge.persist?.() ?? Promise.resolve(),
  setLocalHostIdentity: () => {
    const changed = edge.identityChanged;
    edge.identityChanged = false;
    return changed;
  },
}));
vi.mock('../../../backend/main/connections-store', () => ({
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
vi.mock('../../../backend/main/guest-sessions-store', () => ({
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
  createBackendSocket(config: { transport: string; host?: string }) {
    const socket = new ControlledSocket(config.transport === 'uds' ? 'local' : config.host!);
    edge.sockets.push(socket);
    edge.beforeSocketReturn?.(socket);
    return socket;
  },
}));

function defaultReply(frame: Frame): unknown {
  switch (frame.method) {
    case 'client.hello':
      return { clientId: 'physical-composition-client' };
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
    case 'workspace.get':
      return { workspace: { id: frame.params!.workspaceId, title: 'Original' } };
    default:
      return { released: true };
  }
}
class ControlledSocket extends Duplex {
  readonly frames: Frame[] = [];
  readonly replies = new Set<Frame>();
  readonly claimed = new Set<Frame>();
  readonly waiters: Array<{ method: string; resolve(frame: Frame): void }> = [];
  constructor(readonly owner: string) {
    super();
  }
  _read() {}
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    const frame = JSON.parse(chunk.toString()) as Frame;
    this.frames.push(frame);
    const index = this.waiters.findIndex((waiter) => waiter.method === frame.method);
    if (index !== -1) {
      this.claimed.add(frame);
      this.waiters.splice(index, 1)[0].resolve(frame);
    }
    if (frame.method !== 'client.hello' || edge.autoHello) {
      void Promise.resolve(edge.respond?.(this, frame) ?? defaultReply(frame)).then(
        (result) => this.reply(frame, result),
        (error: unknown) => this.fail(frame, error),
      );
    }
    done();
  }
  next(method: string): Promise<Frame> {
    const frame = this.frames.find((item) => item.method === method && !this.claimed.has(item));
    if (frame) {
      this.claimed.add(frame);
      return Promise.resolve(frame);
    }
    return new Promise((resolve) => this.waiters.push({ method, resolve }));
  }
  reply(frame: Frame, result = defaultReply(frame)): void {
    if (this.replies.has(frame) || this.destroyed) return;
    this.replies.add(frame);
    this.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) + '\n'));
  }
  fail(frame: Frame, error: unknown): void {
    if (this.replies.has(frame) || this.destroyed) return;
    this.replies.add(frame);
    this.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error }) + '\n'));
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const channels = {
  OBSERVE_ORIGIN: 'composition:observe',
  PREPARE: 'composition:prepare',
  READ: 'composition:read',
  RELEASE: 'composition:release',
  RELEASE_ORIGIN: 'composition:release-origin',
  RETIRED: 'composition:retired',
};
const windows = new Map<object, ElectronWindow>();
const cleanups: Array<() => void> = [];
const releases: Array<() => void> = [];
type Pool = typeof import('../../../backend/main/backend.ipc');
let lifecycle: ReturnType<Pool['enrollBackendClientLifecycle']> | undefined;
type Retirement = Awaited<ReturnType<NonNullable<typeof lifecycle>['retire']>>;
let expectedOutcome: Retirement['outcome'] = 'clean';
let expectedFailures: unknown[] = [];
let expectedClients: Array<{
  generation: number;
  outcome: Retirement['outcome'];
  failures: unknown[];
}> = [];
let inducedError: Error | undefined;
const platform = process.platform;
beforeEach(() => {
  vi.resetModules();
  expectedOutcome = 'clean';
  expectedFailures = [];
  expectedClients = [{ generation: 1, outcome: 'clean', failures: [] }];
  inducedError = undefined;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.stubEnv('INTENTD_SOCKET', '/controlled-workspace-load.sock');
  vi.stubEnv('INTENTD_WS_URL', '');
  vi.stubEnv('INTENTD_TCP', '');
  edge.sockets = [];
  edge.beforeSocketReturn = undefined;
  edge.respond = undefined;
  edge.autoHello = false;
  const events = new EventEmitter();
  Object.assign(app, {
    on: events.on.bind(events),
    once: events.once.bind(events),
    emit: events.emit.bind(events),
    removeListener: events.removeListener.bind(events),
  });
  vi.mocked(BrowserWindow.fromWebContents).mockImplementation(
    (sender) => windows.get(sender) ?? null,
  );
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
});
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    // Failure-safe release of every controlled hold before joining genuine pool work.
    for (const release of releases.splice(0)) release();
    edge.autoHello = true;
    for (const socket of edge.sockets) {
      if (socket.destroyed) continue;
      if (!socket.frames.some((frame) => frame.method === 'client.hello')) socket.emit('connect');
      for (const frame of socket.frames) if (frame.method === 'client.hello') socket.reply(frame);
    }
    if (lifecycle) {
      const receipt = await lifecycle.retire({
        ready: () => true,
        subscribeChanged: () => () => {},
      });
      expect(receipt.ownersJoined).toBe(true);
      expect(receipt.admissionSealed).toBe(true);
      expect(receipt.outcome).toBe(expectedOutcome);
      expect(receipt.failures).toEqual(expectedFailures);
      if (inducedError) expect(receipt.failures[0]?.error).toBe(inducedError);
      expect(receipt.excludedOwners).toEqual([]);
      expect(
        receipt.clients.map((client) => ({
          generation: client.identity.generation,
          outcome: client.outcome,
          failures: client.failures,
        })),
      ).toEqual(expectedClients);
      for (const client of receipt.clients) {
        expect(client.ownersJoined).toBe(true);
        expect(client.admissionSealed).toBe(true);
        expect(client.closes.length).toBeGreaterThan(0);
        for (const close of client.closes) {
          expect(close.destroyRequested).toBe(true);
          expect(close.closeObserved).toBe(true);
        }
      }
      expect(edge.sockets.every((socket) => socket.destroyed)).toBe(true);
    }
  } finally {
    lifecycle = undefined;
    windows.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

async function harness() {
  const pool = await import('../../../backend/main/backend.ipc');
  const origins = pool.enrollBackendConnectionOrigins();
  lifecycle = pool.enrollBackendClientLifecycle();
  const { stampWindowWithBackend } = await import('../../../../main/window-backend');
  const { createWorkspaceLoadRoutes } = await import('../workspace-load-route');
  const { createElectronWorkspaceLoadTransport } =
    await import('../../../../lib/client/live/workspace-load-route-transport');
  const { JsonRpcError } = await import('../../../backend/main/json-rpc-errors');
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const window = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => false,
  });
  const native = window as unknown as ElectronWindow;
  windows.set(sender, native);
  stampWindowWithBackend(native);
  const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const seen: Array<{ channel: string; payload: unknown }> = [];
  const replyControls = {
    suppressNotices: false,
    prepare: undefined as undefined | ((reply: Promise<unknown>) => Promise<unknown>),
    beforePrepare: undefined as undefined | (() => Promise<void>),
    afterRelease: undefined as undefined | ((payload: unknown) => void),
  };
  const readBackend = vi.fn(pool.getBackendClientForConnection);
  const routes = createWorkspaceLoadRoutes({
    originAdmission: { kind: 'physical', origins },
    readBackend,
    open: async () => {
      throw new Error('OPEN service coverage is in workspace-load-open-wire.test.ts');
    },
    errorPayload: (error) =>
      error instanceof JsonRpcError
        ? error.toErrorPayload()
        : {
            code: 'TRANSPORT_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
    notify: (frame, retirement) => {
      expect(frame).toBe(event.senderFrame);
      if (replyControls.suppressNotices) return;
      for (const listener of [...listeners.values()]) listener(retirement);
    },
  });
  cleanups.push(() => routes.dispose());
  const api: Window['electronAPI'] = {
    invoke: vi.fn(function (
      this: Window['electronAPI'],
      channel: string,
      payload?: unknown,
    ): Promise<unknown> {
      expect(this).toBe(api);
      seen.push({ channel, payload });
      const operation = (async () => {
        switch (channel) {
          case channels.OBSERVE_ORIGIN:
            return routes.observeOrigin(event);
          case channels.PREPARE:
            if (replyControls.beforePrepare) await replyControls.beforePrepare();
            return routes.prepare(event, payload);
          case channels.READ:
            return routes.read(event, payload);
          case channels.RELEASE:
            routes.release(event, payload);
            replyControls.afterRelease?.(payload);
            return;
          case channels.RELEASE_ORIGIN:
            return routes.releaseOrigin(event, payload);
          default:
            throw new Error(`Unexpected controlled channel: ${channel}`);
        }
      })().then(
        (result) => ({ ok: true, result }),
        (error: unknown) => ({
          ok: false,
          error: {
            code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
            message: String(error),
          },
        }),
      );
      return channel === channels.PREPARE && replyControls.prepare
        ? replyControls.prepare(operation)
        : operation;
    }),
    on: vi.fn(function (
      this: Window['electronAPI'],
      _channel: string,
      listener: (...args: unknown[]) => void,
    ) {
      expect(this).toBe(api);
      const id = `listener-${listeners.size}`;
      listeners.set(id, listener);
      return id;
    }),
    offById: vi.fn(function (this: Window['electronAPI'], _channel: string, id: string) {
      expect(this).toBe(api);
      listeners.delete(id);
    }),
    send: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    devInstance: null,
    devPort: null,
  };
  const transport = createElectronWorkspaceLoadTransport(channels, () => api);
  async function acknowledge(client: JsonRpcClient, socket = edge.sockets.at(-1)!) {
    socket.emit('connect');
    socket.reply(await socket.next('client.hello'));
    await client.request('controlled.ready');
  }
  return {
    pool,
    origins,
    routes,
    event,
    sender,
    native,
    stampWindowWithBackend,
    readBackend,
    transport,
    seen,
    listeners,
    replyControls,
    acknowledge,
  };
}
const tuple = (
  origin: WorkspaceLoadOriginRef,
  requestId = 'first',
  workspaceId = 'amber-forest',
) => ({ originId: origin.originId, requestId, workspaceId });

// Every origin below comes from the actual enrolled pool; no synthetic physical handles.
describe('physical workspace load composition', () => {
  it('captures inside socket construction before await/insertion and prepares only its acknowledged connection', async () => {
    const h = await harness();
    expect(await h.transport.observeOrigin()).toBeNull();
    expect(edge.sockets).toHaveLength(0);
    let mainOrigin: WorkspaceLoadOriginRef | undefined;
    let rendererOrigin: ReturnType<typeof h.transport.observeOrigin> | undefined;
    edge.beforeSocketReturn = () => {
      mainOrigin = h.routes.observeOrigin(h.event);
      rendererOrigin = h.transport.observeOrigin();
      expect(h.pool.getBackendClientForConnection('local')).toBeUndefined();
      expect(h.origins.capture('local')!.read()).toMatchObject({
        state: 'pending',
        incarnation: null,
        hello: null,
      });
    };
    const client = h.pool.getLocalBackendClient();
    const observed = await rendererOrigin!;
    const pending = observed!.prepare('first', 'amber-forest', new AbortController().signal);
    expect(edge.sockets[0].frames).toEqual([]);
    expect(h.readBackend).not.toHaveBeenCalled();
    await h.acknowledge(client);
    const route = (await pending)!;
    expect(await route.read('get')).toEqual({
      workspace: { id: 'amber-forest', title: 'Original' },
    });
    expect(edge.sockets).toHaveLength(1);
    expect(edge.sockets[0].frames.filter((frame) => frame.method === 'workspace.get')).toEqual([
      expect.objectContaining({ method: 'workspace.get', params: { workspaceId: 'amber-forest' } }),
    ]);
    h.routes.releaseOrigin(h.event, mainOrigin!);
    observed!.release();
  });

  it.each(['dial', 'hello'] as const)(
    'cancels during pending %s without retiring a sibling origin request',
    async (phase) => {
      const h = await harness();
      const client = h.pool.getLocalBackendClient();
      if (phase === 'hello') {
        edge.sockets[0].emit('connect');
        await edge.sockets[0].next('client.hello');
      }
      const origin = (await h.transport.observeOrigin())!;
      const controller = new AbortController();
      const cancelled = origin.prepare('cancelled', 'amber-forest', controller.signal);
      const sibling = origin.prepare('sibling', 'amber-forest', new AbortController().signal);
      controller.abort();
      expect(await cancelled).toBeNull();
      expect(origin.isCurrent()).toBe(true);
      if (phase === 'dial') await h.acknowledge(client);
      else {
        edge.sockets[0].reply(
          edge.sockets[0].frames.find((frame) => frame.method === 'client.hello')!,
        );
        await client.request('controlled.ready');
      }
      const ready = (await sibling)!;
      expect(await ready.read('get')).toHaveProperty('workspace.id', 'amber-forest');
      expect(h.seen.filter((call) => call.channel === channels.RELEASE)).toEqual([
        {
          channel: channels.RELEASE,
          payload: expect.objectContaining({ requestId: 'cancelled', workspaceId: 'amber-forest' }),
        },
      ]);
      origin.release();
    },
  );

  it('uses an early tuple tombstone when abort overtakes delivery of PREPARE', async () => {
    const h = await harness();
    const client = h.pool.getLocalBackendClient();
    const origin = (await h.transport.observeOrigin())!;
    const deliver = deferred<void>();
    releases.push(() => deliver.resolve());
    h.replyControls.beforePrepare = () => deliver.promise;
    const request = new AbortController();
    const pending = origin.prepare('late-prepare', 'amber-forest', request.signal);
    request.abort();
    expect(await pending).toBeNull();
    deliver.resolve();
    await deliver.promise;
    h.replyControls.beforePrepare = undefined;
    await h.acknowledge(client);
    const sibling = await origin.prepare('sibling', 'amber-forest', new AbortController().signal);
    expect(await sibling!.read('get')).toHaveProperty('workspace.id', 'amber-forest');
    expect(origin.isCurrent()).toBe(true);
    origin.release();
  });

  it('drains and releases a created route whose IPC reply arrives after local abort', async () => {
    const h = await harness();
    const client = h.pool.getLocalBackendClient();
    await h.acknowledge(client);
    const origin = (await h.transport.observeOrigin())!;
    const deliver = deferred<void>();
    releases.push(() => deliver.resolve());
    const created = deferred<unknown>();
    h.replyControls.prepare = async (reply) => {
      const value = await reply;
      created.resolve(value);
      await deliver.promise;
      return value;
    };
    const request = new AbortController();
    const pending = origin.prepare('late-reply', 'amber-forest', request.signal);
    const envelope = (await created.promise) as { result: WorkspaceLoadRouteRef };
    request.abort();
    expect(await pending).toBeNull();
    const released = deferred<void>();
    h.replyControls.afterRelease = (payload) => {
      if ((payload as WorkspaceLoadRouteRef).routeId === envelope.result.routeId)
        released.resolve();
    };
    deliver.resolve();
    await released.promise;
    expect(h.seen.filter((call) => call.channel === channels.RELEASE)).toEqual([
      { channel: channels.RELEASE, payload: tuple(envelope.result, 'late-reply') },
      { channel: channels.RELEASE, payload: envelope.result },
    ]);
    expect((await h.routes.read(h.event, { ...envelope.result, operation: 'get' })).current).toBe(
      false,
    );
    expect(origin.isCurrent()).toBe(true);
    origin.release();
  });

  it('protects pending tuples against wrong workspace/frame and bounds early cancellations', async () => {
    const h = await harness();
    const client = h.pool.getLocalBackendClient();
    const origin = h.routes.observeOrigin(h.event);
    const first = tuple(origin);
    const pending = h.routes.prepare(h.event, first);
    h.routes.release(h.event, { ...first, workspaceId: 'wrong' });
    h.routes.release({ ...h.event, senderFrame: {} } as IpcMainInvokeEvent, first);
    for (let i = 1; i < 128; i++) h.routes.release(h.event, tuple(origin, `early-${i}`));
    await expect(h.routes.prepare(h.event, tuple(origin, 'overflow'))).rejects.toThrow();
    await expect(h.routes.prepare(h.event, tuple(origin, 'early-1'))).rejects.toThrow();
    await h.acknowledge(client);
    const ready = await pending;
    expect((await h.routes.read(h.event, { ...ready, operation: 'get' })).current).toBe(true);
    h.routes.release(h.event, first);
    expect((await h.routes.read(h.event, { ...ready, operation: 'get' })).current).toBe(false);
  });

  it.each(['dispose', 'frame', 'ttl'] as const)(
    'terminates pending preparation on %s without waiting for hello',
    async (boundary) => {
      const h = await harness();
      h.pool.getLocalBackendClient();
      const origin = (await h.transport.observeOrigin())!;
      const pending = origin.prepare('first', 'amber-forest', new AbortController().signal);
      if (boundary === 'dispose') h.routes.dispose();
      else if (boundary === 'frame') h.stampWindowWithBackend(h.native);
      else {
        // Fake Date only: no reconnect/heartbeat timers are advanced.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 300_001);
        const observed = h.seen.find((call) => call.channel === channels.PREPARE)!.payload;
        await expect(
          h.routes.prepare(h.event, { ...Object(observed), requestId: 'expired' }),
        ).rejects.toThrow();
      }
      // The old frame cannot receive RETIRED; its pending IPC error still settles it.
      expect(await pending).toBeNull();
      expect(edge.sockets[0].frames.filter((frame) => frame.method === 'workspace.get')).toEqual(
        [],
      );
      expect(origin.isCurrent()).toBe(false);
    },
  );

  it.each(['socket', 'hello', 'member'] as const)(
    'never adopts a successor after %s replacement',
    async (boundary) => {
      const h = await harness();
      const client = h.pool.getLocalBackendClient();
      await h.acknowledge(client);
      const captured = h.origins.capture('local')!;
      const origin = (await h.transport.observeOrigin())!;
      const route = (await origin.prepare('first', 'amber-forest', new AbortController().signal))!;
      if (boundary === 'socket') {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        inducedError = new Error('lost original socket');
        expectedOutcome = 'original-failure';
        expectedFailures = [{ owner: null, kind: 'transport', error: inducedError }];
        expectedClients = [{ generation: 1, outcome: expectedOutcome, failures: expectedFailures }];
        edge.sockets[0].emit('error', inducedError);
        await vi.advanceTimersByTimeAsync(1000);
        await h.acknowledge(client);
        vi.useRealTimers();
      } else if (boundary === 'hello') {
        edge.autoHello = true;
        await client.request('client.hello', {});
      } else {
        expectedOutcome = 'forced';
        expectedFailures = [
          {
            owner: null,
            kind: 'forced',
            error: expect.objectContaining({ name: 'Error', message: 'Legacy disposal' }),
          },
        ];
        expectedClients = [
          { generation: 1, outcome: 'forced', failures: expectedFailures },
          { generation: 2, outcome: 'clean', failures: [] },
        ];
        h.pool.disconnectBackendClient('local');
        const next = h.pool.getLocalBackendClient();
        await h.acknowledge(next);
      }
      expect(captured.read()).toEqual({ state: 'retired' });
      expect(origin.isCurrent()).toBe(false);
      await expect(route.read('get')).rejects.toThrow();
      expect(
        edge.sockets
          .flatMap((socket) => socket.frames)
          .filter((frame) => frame.method === 'workspace.get'),
      ).toEqual([]);
    },
  );

  it('consumes pending ownership before synchronous subscription wake can release it', async () => {
    const h = await harness();
    h.pool.getLocalBackendClient();
    const origin = h.routes.observeOrigin(h.event);
    const first = tuple(origin);
    const socket = edge.sockets[0];
    // Real physical subscribeChanged immediately calls wake. Its second source read
    // reaches this real Duplex getter; no origin/state/subscription is fabricated.
    let prototype = Object.getPrototypeOf(socket);
    let descriptor: PropertyDescriptor | undefined;
    while (prototype && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, 'destroyed');
      prototype = Object.getPrototypeOf(prototype);
    }
    if (!descriptor?.get) throw new Error('Duplex destroyed getter is required');
    const originalDestroyed = descriptor.get;
    let reads = 0;
    Object.defineProperty(socket, 'destroyed', {
      configurable: true,
      get() {
        if (++reads === 2) h.routes.release(h.event, first);
        return Reflect.apply(originalDestroyed, socket, []);
      },
    });
    const pending = h.routes.prepare(h.event, first);
    await expect(pending).rejects.toThrow();
    delete (socket as unknown as { destroyed?: boolean }).destroyed;
    await expect(h.routes.prepare(h.event, first)).rejects.toThrow();
    expect(h.routes.observeOrigin(h.event)).toHaveProperty('originId');
  });

  it('keeps final stream-entry fencing after a traffic observer cancels the route', async () => {
    const h = await harness();
    const client = h.pool.getLocalBackendClient();
    await h.acknowledge(client);
    const origin = (await h.transport.observeOrigin())!;
    const request = new AbortController();
    const route = (await origin.prepare('first', 'amber-forest', request.signal))!;
    expectedOutcome = 'original-failure';
    expectedFailures = [
      {
        owner: { kind: 'captured-request' },
        kind: 'original',
        error: expect.objectContaining({
          name: 'Error',
          message: 'Captured repository connection is unavailable',
        }),
      },
    ];
    expectedClients = [{ generation: 1, outcome: expectedOutcome, failures: expectedFailures }];
    const stop = client.observeTraffic((message) => {
      if (message.type === 'request' && message.method === 'workspace.get') route.release();
    });
    cleanups.push(stop);
    await expect(route.read('get')).rejects.toThrow();
    expect(edge.sockets[0].frames.filter((frame) => frame.method === 'workspace.get')).toEqual([]);
  });
  it('preserves ordinary daemon error fields through the actual composition', async () => {
    const h = await harness();
    const client = h.pool.getLocalBackendClient();
    await h.acknowledge(client);
    const origin = (await h.transport.observeOrigin())!;
    const route = (await origin.prepare('first', 'amber-forest', new AbortController().signal))!;
    expectedOutcome = 'original-failure';
    expectedFailures = [
      {
        owner: { kind: 'captured-request' },
        kind: 'original',
        error: expect.objectContaining({
          name: 'JsonRpcError',
          message: 'Access denied',
          code: 'FORBIDDEN',
          rpcCode: -32003,
          data: { code: 'FORBIDDEN', resource: 'workspace' },
        }),
      },
    ];
    expectedClients = [{ generation: 1, outcome: expectedOutcome, failures: expectedFailures }];
    edge.respond = (_socket, frame) =>
      frame.method === 'workspace.get'
        ? Promise.reject({
            code: -32003,
            message: 'Access denied',
            data: { code: 'FORBIDDEN', resource: 'workspace' },
          })
        : defaultReply(frame);
    await expect(route.read('get')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Access denied',
      rpcCode: -32003,
      data: { code: 'FORBIDDEN', resource: 'workspace' },
    });
    expect(origin.isCurrent()).toBe(true);
    edge.respond = undefined;
    expect(await route.read('get')).toHaveProperty('workspace.id', 'amber-forest');
    origin.release();
  });

  it('retires from the same READ reply before rejection even when RETIRED delivery is withheld', async () => {
    const h = await harness();
    const client = h.pool.getLocalBackendClient();
    await h.acknowledge(client);
    const origin = (await h.transport.observeOrigin())!;
    const route = (await origin.prepare('first', 'amber-forest', new AbortController().signal))!;
    const held = deferred<unknown>();
    releases.push(() => held.resolve({ workspace: { id: 'amber-forest', title: 'Late' } }));
    edge.respond = (_socket, frame) =>
      frame.method === 'workspace.get' ? held.promise : defaultReply(frame);
    h.replyControls.suppressNotices = true;
    const order: string[] = [];
    origin.onRetired(() => order.push('retired'));
    const pending = route.read('get').then(
      () => order.push('fulfilled'),
      () => order.push('rejected'),
    );
    await edge.sockets[0].next('workspace.get');
    edge.autoHello = true;
    await client.request('client.hello', {});
    expect(origin.isCurrent()).toBe(true);
    held.resolve({ workspace: { id: 'amber-forest', title: 'Late' } });
    await pending;
    expect(order).toEqual(['retired', 'rejected']);
    expect(origin.isCurrent()).toBe(false);
  });
});
