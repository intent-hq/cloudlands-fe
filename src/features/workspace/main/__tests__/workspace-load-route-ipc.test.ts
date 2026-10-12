/** Actual pool + JsonRpcClient + main routes + renderer transport.
 * Controlled boundaries: Electron frame/preload delivery, storage/identity and Duplex.
 * No native IPC, real daemon, socket-peer or service-readiness claim.
 */
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { app, BrowserWindow, ipcMain, webContents } from 'electron';
import {
  mockInvoke,
  registerMockIpcHandler,
  unregisterMockIpcHandler,
  resetMockIpcRouter,
} from '$shared/ipc-mock-router';
import { IPC_CHANNELS, EVENT_CHANNELS, getAllowedChannels } from '$shared/ipc-registry';
import type { BrowserWindow as ElectronWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  event: undefined as IpcMainInvokeEvent | undefined,
  registered: new Set<string>(),
  failRegistration: undefined as string | undefined,
  initRepo: vi.fn(),
  initHistory: vi.fn(),
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const app = Object.assign(new EventEmitter(), {
    getPath: vi.fn(() => '/tmp/test/userData'),
    getAppPath: vi.fn(() => '/tmp/test-app'),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
    isReady: vi.fn(() => true),
    isPackaged: false,
  });
  return {
    app,
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn() },
    BrowserWindow: {
      fromWebContents: vi.fn(),
      getAllWindows: vi.fn(() => []),
      getFocusedWindow: vi.fn(() => null),
    },
    webContents: { fromFrame: vi.fn() },
    dialog: { showMessageBox: vi.fn() },
  };
});
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

vi.unmock('../../../protocol/main/protocol-adapter');
vi.mock('../../../system/main/system.ipc', () => ({ getFocusedWindowWorkspaceId: () => null }));
vi.mock('../../../terminal/main/terminal.ipc', () => ({ cleanupWorkspaceTerminals: vi.fn() }));
vi.mock('../../../metadata-fs/main/metadata-fs-factory', () => ({ clearMetadataFSCache: vi.fn() }));
vi.mock('../workspace-path.service', () => ({ getWorkspacePath: vi.fn() }));
vi.mock('../repo-registry', () => ({
  initRepoRegistry: edge.initRepo,
  getAllRepos: () => [],
  addRepo: vi.fn(),
  removeRepo: vi.fn(),
  syncRepos: vi.fn(),
  clearRepos: vi.fn(),
}));
vi.mock('../change-history-persistence', async (original) => ({
  ...(await original<typeof import('../change-history-persistence')>()),
  initChangeHistory: edge.initHistory,
}));
vi.mock('../../../tools/main/tool.service', () => ({ ToolService: class {} }));
vi.mock('../../../tools/main/executor-manager', () => ({ executorManager: {} }));
vi.mock('../../../acp-official/main/server/acp-server', () => ({ ACPServer: class {} }));

const windows = new Map<object, ElectronWindow>();
const cleanups: Array<() => void> = [];
type Pool = typeof import('../../../backend/main/backend.ipc');
let lifecycle: ReturnType<Pool['enrollBackendClientLifecycle']> | undefined;
// Exact expected failures belong to each deliberately induced error below.
// Never exclude controlled transport/request failures from the physical receipt.
type Retirement = Awaited<ReturnType<NonNullable<typeof lifecycle>['retire']>>;
let expectedOutcome: Retirement['outcome'] = 'clean';
let expectedFailures: unknown[] = [];
const expectedClientFailures = new Map<number, unknown[]>();
let expectedTransportError: Error | undefined;
let expectedPoolOnlyFailures = false;
let expectedClientGenerations: number[] | undefined;
const platform = process.platform;
beforeEach(() => {
  vi.resetModules();
  expectedOutcome = 'clean';
  expectedFailures = [];
  expectedClientFailures.clear();
  expectedTransportError = undefined;
  expectedPoolOnlyFailures = false;
  expectedClientGenerations = undefined;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.stubEnv('INTENTD_SOCKET', '/controlled-workspace-load.sock');
  vi.stubEnv('INTENTD_WS_URL', '');
  vi.stubEnv('INTENTD_TCP', '');
  edge.sockets = [];
  edge.beforeSocketReturn = undefined;
  edge.respond = undefined;
  edge.autoHello = false;
  edge.registered.clear();
  edge.failRegistration = undefined;
  edge.initRepo.mockReset();
  edge.initHistory.mockReset();
  resetMockIpcRouter();
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
  Object.assign(webContents, {
    fromFrame: (frame: unknown) =>
      [...windows.keys()].find(
        (sender) => (sender as { mainFrame: unknown }).mainFrame === frame,
      ) ?? null,
  });
  vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
    if (channel === edge.failRegistration || edge.registered.has(channel))
      throw new Error('Controlled duplicate registration');
    edge.registered.add(channel);
    registerMockIpcHandler(channel, (payload) => handler(edge.event!, payload));
  });
  vi.mocked(ipcMain.removeHandler).mockImplementation((channel) => {
    edge.registered.delete(channel);
    unregisterMockIpcHandler(channel);
  });
});
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
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
      const failureContext = JSON.stringify(receipt, (_key, value) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value,
      );
      expect(receipt.outcome, failureContext).toBe(expectedOutcome);
      expect(receipt.failures, failureContext).toEqual(expectedFailures);
      if (expectedTransportError) expect(receipt.failures[0]?.error).toBe(expectedTransportError);
      if (expectedPoolOnlyFailures) {
        expect(receipt.failures[0]?.error).toBeInstanceOf(Error);
        expect(receipt.failures[1]?.error).toBeInstanceOf(Error);
        expect(receipt.failures[0]?.error).not.toBe(receipt.failures[1]?.error);
      }
      expect(receipt.excludedOwners).toEqual([]);
      if (expectedClientGenerations) {
        expect(
          receipt.clients.map((client) => client.identity.generation),
          failureContext,
        ).toEqual(expectedClientGenerations);
        expect(receipt.clients).toHaveLength(expectedClientGenerations.length);
        expect(new Set(receipt.clients.map((client) => client.identity.instance)).size).toBe(
          expectedClientGenerations.length,
        );
        for (const client of receipt.clients) expect(client.identity.scope).toBe(lifecycle.scope);
      }
      for (const client of receipt.clients) {
        const failures = expectedClientFailures.get(client.identity.generation) ?? [];
        expect(client.outcome).toBe(failures.length ? 'original-failure' : 'clean');
        expect(client.failures).toEqual(failures);
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
    resetMockIpcRouter();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

function expectCapturedFailure(error: Record<string, unknown>) {
  const failure = {
    owner: { kind: 'captured-request' },
    kind: 'original',
    error: expect.objectContaining({ name: 'JsonRpcError', ...error }),
  };
  expectedOutcome = 'original-failure';
  expectedFailures.push(failure);
  expectedClientFailures.set(1, [...expectedFailures]);
}

const channels = IPC_CHANNELS.WORKSPACE_LOAD;
const WS = 'amber-forest';
function workspaceRow() {
  return {
    id: WS,
    title: 'Daemon workspace',
    branch: 'work',
    status: 'Active',
    repositoryPath: '/canonical/repository',
    worktreePath: '/canonical/worktrees/amber-forest',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    agentSummary: { count: 1, agentIds: ['agent-a'], agents: [] },
    gitSummary: { ahead: 2, behind: 0, hasUnpushed: true },
    diffSummary: { totalAdditions: 1, totalDeletions: 0, fileCount: 1 },
  };
}
async function harness(install = true) {
  const pool = await import('../../../backend/main/backend.ipc');
  const origins = pool.enrollBackendConnectionOrigins();
  lifecycle = pool.enrollBackendClientLifecycle();
  const { setupWorkspaceLoadIPC } = await import('../workspace.ipc');
  const { stampWindowWithBackend } = await import('../../../../main/window-backend');
  const send = vi.fn();
  const frame = { send };
  const sender = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false });
  const window = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => false,
  });
  windows.set(sender, window as unknown as ElectronWindow);
  stampWindowWithBackend(window as unknown as ElectronWindow);
  const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  edge.event = event;
  const readBackend = vi.fn(pool.getBackendClientForConnection);
  let dispose: (() => void) | undefined;
  if (install) {
    dispose = setupWorkspaceLoadIPC({ origins, readBackend });
    cleanups.push(dispose);
  }
  cleanups.push(() => origins.dispose());
  const invoke = (channel: string, payload?: unknown) => mockInvoke(channel, payload);
  async function ready() {
    edge.autoHello = true;
    const client = pool.getBackendClient();
    const socket = edge.sockets[edge.sockets.length - 1];
    // Pool's JsonRpcClient publishes status, so join that real boundary.
    const status = new Promise<void>((resolve) => {
      const onStatus = (value: string) => {
        if (value === 'connected') {
          client.off('status', onStatus);
          resolve();
        }
      };
      client.on('status', onStatus);
    });
    socket.emit('connect');
    await status;
    return { client, socket };
  }
  async function prepare(workspaceId = WS) {
    const observed = (await invoke(channels.OBSERVE_ORIGIN)) as {
      ok: true;
      result: WorkspaceLoadOriginRef;
    };
    expect(observed.ok).toBe(true);
    const prepared = (await invoke(channels.PREPARE, {
      ...observed.result,
      requestId: 'request-a',
      workspaceId,
    })) as { ok: true; result: WorkspaceLoadRouteRef };
    expect(prepared.ok).toBe(true);
    return prepared.result;
  }
  return {
    pool,
    origins,
    setupWorkspaceLoadIPC,
    readBackend,
    dispose,
    ready,
    prepare,
    invoke,
    frame,
    send,
    sender,
    event,
    window,
    stampWindowWithBackend,
  };
}

// Wire oracle: documented workspace.get, file.exists, git.getConfig and settings.get
// shapes, also used by workspace-load-open-wire.test.ts; no daemon deployment proof.
function openReply(frame: Frame): unknown {
  switch (frame.method) {
    case 'workspace.get':
      return { workspace: workspaceRow() };
    case 'file.exists':
      return { exists: true, isFile: false, isDirectory: true };
    case 'git.getConfig':
      return {
        config: '[remote "origin"]\n  url = https://github.com/contract-owner/contract-repo.git\n',
      };
    case 'settings.get':
      return { path: 'workspace.changeHistory', value: {}, revision: 1 };
    default:
      return defaultReply(frame);
  }
}

describe('physical workspace-load registration', () => {
  it('registers one owner without allocating a client or initializing ordinary workspace state', async () => {
    const h = await harness();
    expect(edge.sockets).toEqual([]);
    expect(h.readBackend).not.toHaveBeenCalled();
    expect(edge.initRepo).not.toHaveBeenCalled();
    expect(edge.initHistory).not.toHaveBeenCalled();
    expect(() =>
      h.setupWorkspaceLoadIPC({ origins: h.origins, readBackend: h.readBackend }),
    ).toThrow();
    expect(await h.invoke(channels.OBSERVE_ORIGIN)).toEqual({
      ok: false,
      error: {
        code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
        message: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
      },
    });
    registerMockIpcHandler('independent:owner', () => 'alive');
    h.dispose!();
    h.dispose!();
    await expect(h.invoke(channels.OBSERVE_ORIGIN)).rejects.toThrow();
    expect(await h.invoke('independent:owner')).toBe('alive');
  });

  it('rolls back only successfully installed handlers after a registration failure', async () => {
    const h = await harness(false);
    edge.failRegistration = channels.READ;
    registerMockIpcHandler(channels.READ, () => 'other-owner');
    expect(() =>
      h.setupWorkspaceLoadIPC({ origins: h.origins, readBackend: h.readBackend }),
    ).toThrow();
    await expect(h.invoke(channels.OBSERVE_ORIGIN)).rejects.toThrow();
    expect(await h.invoke(channels.READ)).toBe('other-owner');
  });

  it('uses the generated allowlist inputs for all six public bridge names', () => {
    const expected = [
      'workspace-load:observe-origin',
      'workspace-load:prepare',
      'workspace-load:read',
      'workspace-load:release',
      'workspace-load:release-origin',
      'workspace-load:retired',
    ];
    expect(Object.values(channels)).toEqual(expected);
    for (const name of expected) expect(getAllowedChannels()).toContain(name);
    expect(EVENT_CHANNELS).toContain('workspace-load:retired');
    // Actual generated preload exercise is in the startup suite, not inferred from this assertion.
  });

  it.each([
    ['observe-origin', { unexpected: true }],
    ['prepare', {}],
    ['read', {}],
    ['release', {}],
    ['release-origin', {}],
  ])('returns strict invalid-params control envelopes for %s', async (operation, input) => {
    const h = await harness();
    expect(await h.invoke('workspace-load:' + operation, input)).toEqual({
      ok: false,
      error: {
        code: 'INVALID_PARAMS',
        message: 'Invalid workspace load parameters',
      },
    });
  });

  it('runs the actual validated canonical OPEN and keeps READ settlement inside result', async () => {
    const h = await harness();
    edge.respond = (_socket, frame) => openReply(frame);
    const { socket } = await h.ready();
    const ref = await h.prepare();
    const result = await h.invoke(channels.READ, { ...ref, operation: 'open' });
    expect(result).toMatchObject({
      ok: true,
      result: {
        ref,
        current: true,
        settlement: {
          status: 'fulfilled',
          value: { success: true, data: { id: WS, title: 'Daemon workspace' } },
        },
      },
    });
    expect(Object.keys(result as object).sort()).toEqual(['ok', 'result']);
    expect(socket.frames.find((f) => f.method === 'workspace.get')?.params).toEqual({
      workspaceId: WS,
    });
    expect(socket.frames.find((f) => f.method === 'file.exists')?.params).toEqual({
      workspaceId: WS,
      path: '/canonical/worktrees/amber-forest',
    });
    expect(edge.initRepo).not.toHaveBeenCalled();
    expect(edge.initHistory).not.toHaveBeenCalled();
  });

  it.each([-32601, 'malformed'])(
    'retires in the READ reply before canonical file.exists folding: %s',
    async (kind) => {
      const h = await harness();
      if (kind === -32601)
        expectCapturedFailure({
          code: 'METHOD_NOT_FOUND',
          rpcCode: -32601,
          message: 'Method not found',
          data: { code: 'METHOD_NOT_FOUND' },
        });
      edge.respond = (_socket, frame) => {
        if (frame.method === 'file.exists') {
          if (kind === -32601) return Promise.reject({ code: -32601, message: 'Method not found' });
          return { exists: 'invalid' };
        }
        return openReply(frame);
      };
      await h.ready();
      const ref = await h.prepare();
      h.send.mockImplementation(() => {}); // Withhold any notification delivery.
      expect(await h.invoke(channels.READ, { ...ref, operation: 'open' })).toEqual({
        ok: true,
        result: { ref, current: false, reason: 'retired' },
      });
    },
  );

  it('preserves ordinary daemon error fields and canonical missing-workspace folding', async () => {
    const h = await harness();
    await h.ready();
    const ref = await h.prepare();
    expectCapturedFailure({
      code: 'CONTROLLED',
      rpcCode: -32020,
      message: 'Ordinary failure',
      data: { code: 'CONTROLLED', detail: 'kept' },
    });
    expectCapturedFailure({
      code: 'SERVER_ERROR',
      rpcCode: -32004,
      message: 'Workspace not found',
      data: { code: 'SERVER_ERROR' },
    });
    edge.respond = (_socket, frame) =>
      frame.method === 'workspace.get'
        ? Promise.reject({
            code: -32020,
            message: 'Ordinary failure',
            data: { code: 'CONTROLLED', detail: 'kept' },
          })
        : defaultReply(frame);
    expect(await h.invoke(channels.READ, { ...ref, operation: 'get' })).toEqual({
      ok: true,
      result: {
        ref,
        current: true,
        settlement: {
          status: 'rejected',
          error: {
            code: 'CONTROLLED',
            message: 'Ordinary failure',
            rpcCode: -32020,
            data: { code: 'CONTROLLED', detail: 'kept' },
          },
        },
      },
    });
    edge.respond = (_socket, frame) =>
      frame.method === 'workspace.get'
        ? Promise.reject({ code: -32004, message: 'Workspace not found' })
        : defaultReply(frame);
    expect(await h.invoke(channels.READ, { ...ref, operation: 'open' })).toMatchObject({
      ok: true,
      result: {
        ref,
        current: true,
        settlement: { status: 'fulfilled', value: { success: false } },
      },
    });
  });

  it('rejects a different sender frame and rechecks after capturing frame.send', async () => {
    const h = await harness();
    await h.ready();
    const ref = await h.prepare();
    edge.event = { ...h.event, senderFrame: {} } as IpcMainInvokeEvent;
    expect(await h.invoke(channels.READ, { ...ref, operation: 'get' })).toEqual({
      ok: true,
      result: { ref, current: false, reason: 'retired' },
    });
    edge.event = h.event;
    h.send.mockClear();
    Object.defineProperty(h.frame, 'send', {
      configurable: true,
      get() {
        h.stampWindowWithBackend(h.window as unknown as ElectronWindow);
        return h.send;
      },
    });
    h.origins.dispose();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('sends retirement only through the captured frame with the original receiver', async () => {
    const h = await harness();
    await h.ready();
    const ref = await h.prepare();
    expect(await h.invoke(channels.RELEASE, ref)).toEqual({ ok: true, result: null });
    expect(h.send).toHaveBeenCalledWith(channels.RETIRED, { kind: 'route', ...ref });
    expect(h.send.mock.contexts[0]).toBe(h.frame);
    expect(await h.invoke(channels.RELEASE_ORIGIN, { originId: ref.originId })).toEqual({
      ok: true,
      result: null,
    });
  });
});

it('preserves the canonical converter including its ordinary transport fallback', async () => {
  const { JsonRpcError, toErrorPayload } = await import('../../../backend/main/json-rpc-errors');
  expect(
    toErrorPayload(
      new JsonRpcError({ code: -32602, message: 'Rejected', data: { detail: 'kept' } }),
    ),
  ).toEqual({
    code: 'INVALID_PARAMS',
    message: 'Rejected',
    data: { detail: 'kept', code: 'INVALID_PARAMS' },
    rpcCode: -32602,
  });
  expect(toErrorPayload(new Error('Offline'))).toEqual({
    code: 'TRANSPORT_ERROR',
    message: 'Offline',
    data: { code: 'TRANSPORT_ERROR' },
  });
});

it('keeps canonical Chief reads local and folds ordinary file access denial into a cleared worktree', async () => {
  const h = await harness();
  expectCapturedFailure({
    code: 'ACCESS_DENIED',
    rpcCode: -32001,
    message: 'Permission denied',
    data: { code: 'ACCESS_DENIED' },
  });
  edge.respond = (_socket, frame) =>
    frame.method === 'file.exists'
      ? Promise.reject({
          code: -32001,
          message: 'Permission denied',
          data: { code: 'ACCESS_DENIED' },
        })
      : openReply(frame);
  const { socket } = await h.ready();
  const { CHIEF_WORKSPACE_ID } = await import('../../../../shared/types/branded-ids');
  const chief = await h.prepare(CHIEF_WORKSPACE_ID);
  expect(await h.invoke(channels.READ, { ...chief, operation: 'open' })).toMatchObject({
    ok: true,
    result: {
      current: true,
      settlement: {
        status: 'fulfilled',
        value: { success: true, data: { id: CHIEF_WORKSPACE_ID } },
      },
    },
  });
  expect(
    socket.frames.filter((frame) => ['workspace.get', 'file.exists'].includes(frame.method)),
  ).toEqual([]);
  const ordinary = await h.prepare();
  expect(await h.invoke(channels.READ, { ...ordinary, operation: 'open' })).toMatchObject({
    ok: true,
    result: {
      current: true,
      settlement: {
        status: 'fulfilled',
        value: { success: true, data: { id: WS, worktreePath: undefined } },
      },
    },
  });
});

describe('terminal physical enrollment disposal', () => {
  it('notifies an empty enrollment once, supports reentry and refuses reenrollment', async () => {
    const h = await harness(false);
    let wakes = 0;
    const stop = h.origins.subscribeChanged(() => {
      if (++wakes > 1) h.origins.dispose();
    });
    expect(wakes).toBe(1);
    h.origins.dispose();
    h.origins.dispose();
    stop();
    expect(wakes).toBe(2);
    h.pool.getBackendClient(); // Actual later allocation cannot wake the detached subscriber.
    expect(wakes).toBe(2);
    expect(h.pool.getBackendClientForConnection('local')).toBeUndefined();
    expect(h.origins.capture('local')).toBeNull();
    expect(() => h.pool.enrollBackendConnectionOrigins()).toThrow();
  });

  it('retires retained physical handles but leaves existing clients to the real pool owner', async () => {
    const h = await harness(false);
    const { client, socket } = await h.ready();
    const remote = await h.pool.connectBackendClient('remote-A');
    const disposeRemote = vi.spyOn(remote!, 'dispose');
    expectedClientGenerations = [1, 2]; // Existing local and unrelated remote, both joined.
    const captured = h.origins.capture('local')!;
    expect(captured.read().state).toBe('ready');
    let terminalWakes = 0;
    captured.subscribeChanged(() => {
      if (captured.read().state === 'retired') {
        terminalWakes++;
        h.origins.dispose();
      }
    });
    const disposeClient = vi.spyOn(client, 'dispose');
    h.origins.dispose();
    h.origins.dispose();
    expect(captured.read().state).toBe('retired');
    expect(terminalWakes).toBe(1);
    expect(h.pool.getBackendClientForConnection('local')).toBe(client);
    expect(disposeClient).not.toHaveBeenCalled();
    expect(socket.destroyed).toBe(false);
    expect(disposeRemote).not.toHaveBeenCalled();
    expect(h.pool.getBackendClientForConnection('remote-A')).toBe(remote);
    // A later physical event cannot notify the retired scope again.
    client.once('error', (error: Error) => {
      expectedTransportError = error;
    });
    expectedOutcome = 'original-failure';
    expectedFailures = [
      {
        owner: null,
        kind: 'transport',
        error: expect.objectContaining({ name: 'Error', message: 'Connection closed' }),
      },
      // Original status/list work resumes after the induced close. These five
      // local client requests fail during the genuine retirement join; retain
      // every failure observed in the first run, without excluding that work.
      ...Array.from({ length: 5 }, () => ({
        owner: { kind: 'request' },
        kind: 'original',
        error: expect.objectContaining({
          name: 'Error',
          message: 'Original transport unavailable during retirement',
        }),
      })),
    ];
    expectedClientFailures.set(1, expectedFailures);
    socket.emit('close');
    expect(expectedTransportError).toBeInstanceOf(Error);
    expect(terminalWakes).toBe(1);
  });

  it('seals future allocation instead of silently reopening a disposed enrollment', async () => {
    const h = await harness(false);
    h.origins.dispose();
    edge.autoHello = true;
    // The controlled hello is completed during teardown after insertion was
    // refused. Its two original label/update callbacks use the missing pooled
    // remote accessor; the pool records both errors, the client itself is clean.
    expectedOutcome = 'original-failure';
    expectedPoolOnlyFailures = true;
    expectedClientGenerations = [1]; // Refused remote insertion still has a real lifecycle owner.
    expectedFailures = Array.from({ length: 2 }, () => ({
      kind: 'original',
      error: expect.objectContaining({
        name: 'Error',
        message: 'Backend client is not connected: remote-A',
      }),
    }));
    const refused = await h.pool.connectBackendClient('remote-A');
    expect(refused?.getRepositoryConnection()).toBeNull();
    expect(h.pool.getBackendClientForConnection('remote-A')).toBeUndefined();
    expect(h.origins.capture('remote-A')).toBeNull();
    // The enrolled lifecycle owns physical shutdown; insertion is already refused.
    expect(refused?.getStatus()).not.toBe('connected');
  });
});
