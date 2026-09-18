import { TC_ADDRESS } from '../../../../test/fixtures/tc-address.fixture';
/**
 * T3 — open orchestration + connections registry IPC (backend.ipc.ts).
 *
 * Covers the behaviours the spec calls out as must-assert:
 *   - **Validated open**: `openBackendWindow` connects a pooled client, probes
 *     it with an authenticated request, and only then opens the window; an
 *     unknown/incomplete target or a missing secret is rejected before any
 *     window opens, while a remote whose probe merely FAILS (unreachable, bad
 *     token/cert) still gets its window — the retained client keeps retrying
 *     and the renderer overlay / latched failure events own recovery.
 *   - **Cert-mismatch propagation**: a {@link PinMismatchError} from the pinned
 *     `wss` transport surfaces a single `connections:cert-mismatch` failure
 *     event to the renderer instead of silently reconnecting.
 * Plus: the `connections:*` request channels are reachable over IPC with
 * validated params.
 *
 * The real JsonRpcClient/window module/connections store are mocked so the
 * orchestration is exercised without a live socket or the Electron window graph.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Global lifecycle log so tests can assert construct/start/dispose ordering. */
const lifecycle = vi.hoisted(() => ({ events: [] as Array<{ type: string; seq: number }> }));

/** Steerable per-method RPC responder for the fake client (tests override). */
const rpc = vi.hoisted(() => ({
  handler: (async () => ({})) as (method: string) => Promise<unknown>,
  calls: [] as string[],
  payloads: [] as Array<[string, unknown]>,
  /** Per-call `params` argument, parallel to `calls`. */
  // eslint-disable-next-line themis/collection-state-shape -- test-only RPC recorder, not Redux state
  params: [] as unknown[],
  /** Per-call `options` argument, parallel to `calls`. */
  options: [] as Array<{ timeoutMs?: number } | undefined>,
}));

vi.mock('../json-rpc-client', () => {
  let seq = 0;
  class FakeJsonRpcClient {
    private readonly id = ++seq;
    private readonly config: unknown;
    private readonly onHelloResult?: (result: unknown) => void;
    private status = 'disconnected';
    private readonly listeners = new Map<string, Array<(arg: unknown) => void>>();
    constructor(opts: { config: unknown; onHelloResult?: (result: unknown) => void }) {
      this.config = opts.config;
      this.onHelloResult = opts.onHelloResult;
      lifecycle.events.push({ type: 'construct', seq: this.id });
    }
    on(event: string, handler: (arg: unknown) => void): this {
      const arr = this.listeners.get(event) ?? [];
      arr.push(handler);
      this.listeners.set(event, arr);
      return this;
    }
    off(): this {
      return this;
    }
    emit(event: string, arg?: unknown): void {
      if (event === 'status' && typeof arg === 'string') this.status = arg;
      for (const h of this.listeners.get(event) ?? []) h(arg);
    }
    hello(result: unknown): void {
      this.onHelloResult?.(result);
    }
    start(): void {
      lifecycle.events.push({ type: 'start', seq: this.id });
    }
    dispose(): void {
      lifecycle.events.push({ type: 'dispose', seq: this.id });
    }
    request = vi.fn(async (method: string, params?: unknown, options?: { timeoutMs?: number }) => {
      rpc.calls.push(method);
      rpc.payloads.push([method, params]);
      rpc.params.push(params);
      rpc.options.push(options);
      return rpc.handler(method);
    });
    registerMethod(): () => void {
      return () => {};
    }
    getConfig(): unknown {
      return this.config;
    }
    getStatus(): string {
      return this.status;
    }
    getConnectedVia(): null {
      return null;
    }
    getReconnectAttempts(): number {
      return 0;
    }
    isConnectionLimited(): boolean {
      return false;
    }
    getConnectionLimitRetryAfterMs(): number | null {
      return null;
    }
  }
  return { JsonRpcClient: FakeJsonRpcClient };
});

vi.mock('../client-identity', () => ({
  getOrCreateClientId: vi.fn(async () => 'cli-test'),
  persistClientId: vi.fn(async () => {}),
}));

vi.mock('../intentd-sidecar', () => ({
  onSidecarGaveUp: vi.fn(),
  onSidecarStartupFailed: vi.fn(() => () => {}),
  getSidecarRunLog: vi.fn(() => ({ available: false })),
  getSidecarStartupFailure: vi.fn(() => null),
  getLocalDaemonProtocolVersion: vi.fn(() => null),
  spawnSidecarOnDemand: vi.fn(),
}));

vi.mock('../../../browser/main/browser-exec-reverse', () => ({
  registerBrowserExecReverseHandler: vi.fn(),
}));

// The orphan kill-and-restart flow is covered by orphan-recovery.test.ts; here
// it is stubbed so the IPC handler's post-restart broadcast can be asserted.
const mockRestartOrphanedSidecar = vi.hoisted(() => vi.fn());
vi.mock('../orphan-recovery', () => ({
  defaultKill: vi.fn(),
  restartOrphanedSidecar: mockRestartOrphanedSidecar,
}));

// Deterministic intentd version pin (the real reader would read the repo's
// live intentd.version file, making list-shape assertions drift on every bump).
vi.mock('../intentd-version-pin', () => ({
  readPinnedVersion: vi.fn(() => '0.1.0'),
}));

// Preserve the real PinMismatchError + resolveBackendConfig; stub captureFingerprint.
const mockCaptureFingerprint = vi.hoisted(() => vi.fn());
vi.mock('../backend-connection', async (importActual) => {
  const actual = await importActual<typeof import('../backend-connection')>();
  return { ...actual, captureFingerprint: mockCaptureFingerprint };
});

// Connections store: in-test doubles for the CRUD + active-id surface.
const store = vi.hoisted(() => ({
  list: vi.fn(),
  getActiveId: vi.fn(),
  setActiveId: vi.fn(),
  add: vi.fn(),
  updateMetadata: vi.fn(),
  replaceSecret: vi.fn(),
  forget: vi.fn(),
  getDecryptedToken: vi.fn(),
  setHostname: vi.fn(),
  setDetectedDeviceKind: vi.fn(),
  setDaemonVersion: vi.fn(),
  setUpdateSupported: vi.fn(),
  setTcAddress: vi.fn(),
  setHosts: vi.fn(),
  getDetectHosts: vi.fn(),
}));
vi.mock('../connections-store', () => ({
  LOCAL_CONNECTION_ID: 'local',
  list: store.list,
  getActiveId: store.getActiveId,
  setActiveId: store.setActiveId,
  add: store.add,
  updateMetadata: store.updateMetadata,
  replaceSecret: store.replaceSecret,
  forget: store.forget,
  getDecryptedToken: store.getDecryptedToken,
  setHostname: store.setHostname,
  setDetectedDeviceKind: store.setDetectedDeviceKind,
  setDaemonVersion: store.setDaemonVersion,
  setUpdateSupported: store.setUpdateSupported,
  setTcAddress: store.setTcAddress,
  setHosts: store.setHosts,
  getDetectHosts: store.getDetectHosts,
  // Keychain-sync lifecycle wiring (T3); inert in these suites.
  onConnectionsMutated: () => () => {},
}));

// Guest sessions store: an in-test double with the credential-replaced and
// removed-by-sync seams captured so a re-join / remote forget can be
// simulated against the pool.
const guestStore = vi.hoisted(() => ({
  list: vi.fn(),
  findById: vi.fn(),
  forget: vi.fn(),
  leaveWorkspace: vi.fn(),
  setWorkspaces: vi.fn(),
  getDecryptedToken: vi.fn(),
  setTcAddress: vi.fn(),
  setHosts: vi.fn(),
  replacedListeners: [] as Array<(id: string) => void>,
  removedListeners: [] as Array<(id: string) => void>,
}));
vi.mock('../guest-sessions-store', () => ({
  list: guestStore.list,
  findById: guestStore.findById,
  forget: guestStore.forget,
  leaveWorkspace: guestStore.leaveWorkspace,
  setWorkspaces: guestStore.setWorkspaces,
  getDecryptedToken: guestStore.getDecryptedToken,
  setHostname: vi.fn(async () => false),
  setTcAddress: guestStore.setTcAddress,
  setHosts: guestStore.setHosts,
  listSyncRecords: vi.fn(async () => []),
  applyRemoteSyncRecord: vi.fn(async () => false),
  onGuestSessionsMutated: () => () => {},
  onGuestCredentialReplaced: (listener: (id: string) => void) => {
    guestStore.replacedListeners.push(listener);
    return () => {};
  },
  onGuestSessionRemovedBySync: (listener: (id: string) => void) => {
    guestStore.removedListeners.push(listener);
    return () => {};
  },
}));

// Keychain-sync lifecycle: controllable double for the T4 settings IPC. The
// registered handle is captured so tests can drive getStatus/requestReconcile
// and the onStatusChanged broadcast seam directly.
const keychainSync = vi.hoisted(() => ({
  enabled: false,
  status: null as unknown,
  requestReconcile: vi.fn(),
  resetStatus: vi.fn(),
  initOptions: null as { onStatusChanged?: (status: unknown) => void } | null,
}));
vi.mock('../keychain-sync-lifecycle', () => ({
  KEYCHAIN_SYNC_ENABLED_KEY: 'keychainSyncEnabled',
  isKeychainSyncEnabled: vi.fn(async () => keychainSync.enabled),
  initKeychainSyncLifecycle: vi.fn((options) => {
    keychainSync.initOptions = options;
    return {
      getStatus: () => keychainSync.status,
      requestReconcile: keychainSync.requestReconcile,
      resetStatus: keychainSync.resetStatus.mockImplementation(() => {
        keychainSync.status = null;
      }),
      dispose: () => {},
    };
  }),
}));

// Stateful local-prefs double: the self-publish helpers (self fingerprint +
// "do not auto-publish" marker) read back what they persisted.
const localPrefs = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    setLocalPref: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    getLocalPref: vi.fn(async (key: string) => values.get(key)),
    deleteLocalPref: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
});
vi.mock('../../../../main/local-prefs', () => ({
  setLocalPref: localPrefs.setLocalPref,
  getLocalPref: localPrefs.getLocalPref,
  deleteLocalPref: localPrefs.deleteLocalPref,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REMOTE = {
  id: 'remote-1',
  label: 'Studio Mac',
  host: '10.0.0.5',
  port: 8443,
  fingerprint: 'AA:BB:CC:DD',
  isLocal: false,
};
const LOCAL = {
  id: 'local',
  label: 'This machine (local)',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
};
const GUEST = {
  id: 'guest-1',
  label: 'studio.local',
  host: '10.0.0.9',
  hosts: ['10.0.0.9'],
  port: 8443,
  fingerprint: 'EE:FF:00:11',
  tcAddress: null,
  hostname: null,
  principalId: 'prn_7',
  login: 'octocat',
  tokenEncrypted: true,
  workspaces: [{ id: 'ws-guest', title: 'Guest project' }],
  updatedAt: 1,
};

/** Import a fresh backend.ipc module and inject window hook spies. */
async function loadModule() {
  const mod = await import('../backend.ipc');
  // The openOrFocus spy records into the shared lifecycle log so ordering vs
  // client construct/start can be asserted (open AFTER the client connects).
  const openOrFocus = vi.fn(async () => {
    lifecycle.events.push({ type: 'open', seq: 0 });
  });
  const ensureLocalWindowBeforeClose = vi.fn();
  const closeForBackend = vi.fn();
  mod.__setBackendWindowHooksForTesting({
    openOrFocus,
    ensureLocalWindowBeforeClose,
    closeForBackend,
  });
  return {
    mod,
    openOrFocus,
    ensureLocalWindowBeforeClose,
    closeForBackend,
  };
}

/**
 * Install a single fake renderer window and return its `send` spy. Pass a
 * `backendId` to stamp the window (and wire `fromWebContents`) so it receives
 * backend-scoped broadcasts; unstamped windows resolve to the local default.
 */
function installWindow(backendId?: string) {
  const send = vi.fn();
  const window = { id: 1, backendId, isDestroyed: () => false, webContents: { send } };
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([window as never]);
  vi.mocked(BrowserWindow.fromWebContents).mockImplementation((sender) =>
    sender === window.webContents ? (window as never) : null,
  );
  return send;
}

function installBackendWindows() {
  const localSender = { id: 'local-sender' };
  const remoteSender = { id: 'remote-sender' };
  const localSend = vi.fn();
  const remoteSend = vi.fn();
  const localWindow = {
    id: 1,
    backendId: 'local',
    isDestroyed: () => false,
    webContents: { ...localSender, send: localSend },
  };
  const remoteWindow = {
    id: 2,
    backendId: 'remote-1',
    isDestroyed: () => false,
    webContents: { ...remoteSender, send: remoteSend },
  };
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([localWindow, remoteWindow] as never);
  vi.mocked(BrowserWindow.fromWebContents).mockImplementation((sender) => {
    if (sender === localSender) return localWindow as never;
    if (sender === remoteSender) return remoteWindow as never;
    if (sender === localWindow.webContents) return localWindow as never;
    if (sender === remoteWindow.webContents) return remoteWindow as never;
    return null;
  });
  return { localSender, remoteSender, localSend, remoteSend, localWindow, remoteWindow };
}

function findHandler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === channel);
  return call?.[1] as ((event: unknown, data: unknown) => Promise<unknown>) | undefined;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  lifecycle.events = [];
  rpc.handler = async () => ({});
  rpc.calls = [];
  rpc.payloads = [];
  rpc.params = [];
  rpc.options = [];
  // Sensible defaults; individual tests override.
  store.getActiveId.mockResolvedValue('local');
  store.list.mockResolvedValue([LOCAL, REMOTE]);
  store.setActiveId.mockResolvedValue(undefined);
  store.getDecryptedToken.mockResolvedValue('secret-token');
  store.setHostname.mockResolvedValue(undefined);
  store.setDaemonVersion.mockResolvedValue(false);
  store.setHosts.mockResolvedValue(undefined);
  store.getDetectHosts.mockResolvedValue(true);
  guestStore.list.mockResolvedValue([]);
  guestStore.findById.mockResolvedValue(null);
  guestStore.forget.mockResolvedValue(true);
  guestStore.leaveWorkspace.mockResolvedValue(true);
  guestStore.setWorkspaces.mockResolvedValue(false);
  guestStore.getDecryptedToken.mockResolvedValue(null);
  guestStore.setTcAddress.mockResolvedValue(false);
  guestStore.setHosts.mockResolvedValue(false);
  guestStore.replacedListeners = [];
  guestStore.removedListeners = [];
  keychainSync.enabled = false;
  keychainSync.status = null;
  keychainSync.initOptions = null;
  localPrefs.values.clear();
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  Object.defineProperty(BrowserWindow, 'getFocusedWindow', {
    value: vi.fn(() => null),
    configurable: true,
  });
});

afterEach(() => {
  vi.doUnmock('../backend.ipc');
});

// ---------------------------------------------------------------------------
// Connect-before-open ordering
// ---------------------------------------------------------------------------

describe('openBackendWindow connect-before-open', () => {
  it('keeps local connected, connects the target, then opens its window', async () => {
    const { mod, openOrFocus } = await loadModule();
    mod.getBackendClient(); // client #1 (local)
    expect(lifecycle.events).toEqual([
      { type: 'construct', seq: 1 },
      { type: 'start', seq: 1 },
    ]);

    const result = await mod.openBackendWindow('remote-1');
    expect(result).toEqual({ id: 'remote-1' });

    // Ordering: construct/start the target's client, and open its window once
    // the pooled client exists. The local pool member (#1) is never disposed —
    // main-process services stay on it.
    const kinds = lifecycle.events.map((e) => `${e.type}#${e.seq}`);
    expect(kinds).toEqual(['construct#1', 'start#1', 'construct#2', 'start#2', 'open#0']);

    // The open never flips the persisted whole-app selection.
    expect(store.setActiveId).not.toHaveBeenCalled();
    expect(openOrFocus).toHaveBeenCalledWith('remote-1');
  });

  it('opens a remote window immediately while its host.status never answers (black-holed host)', async () => {
    // A dead remote never answers any request. The open must not wait on a
    // pre-window probe (nor its timeout): the window appears as soon as the
    // pooled client is built and the renderer's overlay owns the feedback.
    rpc.handler = (method) => {
      if (method === 'host.status') return new Promise(() => {});
      return Promise.resolve({});
    };
    const { mod, openOrFocus } = await loadModule();
    mod.getBackendClient();

    const open = mod.openBackendWindow('remote-1');
    const settled = await Promise.race([
      open,
      new Promise<'stalled'>((r) => setTimeout(() => r('stalled'), 500)),
    ]);
    expect(settled).toEqual({ id: 'remote-1' });
    expect(openOrFocus).toHaveBeenCalledWith('remote-1');
    // The client is retained so its reconnect loop keeps retrying.
    expect(mod.getBackendClientForConnection('remote-1')).toBeDefined();
    expect(lifecycle.events.filter((e) => e.type === 'dispose')).toEqual([]);
  });

  it('a black-holed first remote open does not delay a second remote open', async () => {
    const REMOTE_B = { ...REMOTE, id: 'remote-2', label: 'Other', host: '10.0.0.6' };
    store.list.mockResolvedValue([LOCAL, REMOTE, REMOTE_B]);
    rpc.handler = (method) => {
      if (method === 'host.status') return new Promise(() => {});
      return Promise.resolve({});
    };
    const { mod, openOrFocus } = await loadModule();
    mod.getBackendClient();

    const openA = mod.openBackendWindow('remote-1');
    const openB = mod.openBackendWindow('remote-2');
    const settled = await Promise.race([
      Promise.all([openA, openB]),
      new Promise<'stalled'>((r) => setTimeout(() => r('stalled'), 500)),
    ]);
    expect(settled).toEqual([{ id: 'remote-1' }, { id: 'remote-2' }]);
    expect(openOrFocus.mock.calls.map(([id]) => id)).toEqual(['remote-1', 'remote-2']);
  });

  it('a local open still awaits the host.status probe and rejects on failure', async () => {
    rpc.handler = async (method) => {
      if (method === 'host.status') throw new Error('daemon not ready');
      return {};
    };
    const { mod, openOrFocus } = await loadModule();

    await expect(mod.openBackendWindow('local')).rejects.toThrow(/daemon not ready/);
    expect(openOrFocus).not.toHaveBeenCalled();
    // The always-on local member is never torn down on a failed probe.
    expect(lifecycle.events.filter((e) => e.type === 'dispose')).toEqual([]);
  });

  it('rejects an unknown target BEFORE any window opens (live client untouched)', async () => {
    store.list.mockResolvedValue([LOCAL]); // no remote-1
    const { mod, openOrFocus } = await loadModule();
    mod.getBackendClient(); // client #1
    lifecycle.events = [];

    await expect(mod.openBackendWindow('remote-1')).rejects.toThrow(/unknown or incomplete/i);

    // No new construct, no window open, no active-id flip.
    expect(lifecycle.events).toEqual([]);
    expect(store.setActiveId).not.toHaveBeenCalled();
    expect(openOrFocus).not.toHaveBeenCalled();
  });

  it('rejects a remote with no stored token before any window opens', async () => {
    store.getDecryptedToken.mockResolvedValue(null);
    const { mod, openOrFocus } = await loadModule();
    mod.getBackendClient();
    lifecycle.events = [];

    await expect(mod.openBackendWindow('remote-1')).rejects.toThrow(/no stored token/i);
    expect(lifecycle.events).toEqual([]);
    expect(openOrFocus).not.toHaveBeenCalled();
  });

  it('a guest re-join evicts the pooled client built on the superseded credential', async () => {
    guestStore.findById.mockImplementation(async (id: string) => (id === GUEST.id ? GUEST : null));
    guestStore.getDecryptedToken.mockResolvedValue('guest-token-v1');
    const { mod } = await loadModule();
    mod.getBackendClient(); // client #1 (local)
    lifecycle.events = [];

    await mod.openBackendWindow(GUEST.id);
    const stale = mod.getBackendClientForConnection(GUEST.id);
    expect(stale).toBeDefined();
    expect((stale?.getConfig() as { token?: string }).token).toBe('guest-token-v1');
    expect(lifecycle.events.map((e) => e.type)).toEqual(['construct', 'start', 'open']);
    const staleSeq = lifecycle.events[0].seq;

    // The store replaces the credential under the same id (a second invite
    // to the same daemon) and notifies; the stale pool member must go.
    guestStore.getDecryptedToken.mockResolvedValue('guest-token-v2');
    expect(guestStore.replacedListeners).toHaveLength(1);
    for (const listener of guestStore.replacedListeners) listener(GUEST.id);
    expect(lifecycle.events.at(-1)).toEqual({ type: 'dispose', seq: staleSeq });
    expect(mod.getBackendClientForConnection(GUEST.id)).toBeUndefined();
    // The local pool member is untouched.
    expect(mod.getBackendClientForConnection('local')).toBeDefined();

    // The next open rebuilds the member from the store: fresh credential.
    await mod.openBackendWindow(GUEST.id);
    const fresh = mod.getBackendClientForConnection(GUEST.id);
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(stale);
    expect((fresh?.getConfig() as { token?: string }).token).toBe('guest-token-v2');

    // A replacement for an id with no pooled client is a no-op.
    lifecycle.events = [];
    for (const listener of guestStore.replacedListeners) listener('guest-unknown');
    expect(lifecycle.events).toEqual([]);
  });

  it('a guest re-join during client construction lands the fresh credential, never the superseded one', async () => {
    guestStore.findById.mockImplementation(async (id: string) => (id === GUEST.id ? GUEST : null));
    let release!: (token: string) => void;
    guestStore.getDecryptedToken.mockImplementationOnce(
      () => new Promise<string>((resolve) => (release = resolve)),
    );
    const { mod } = await loadModule();

    // Construction #1 is blocked reading the (old) credential from the store.
    const pending = mod.connectBackendClient(GUEST.id);
    await vi.waitFor(() => expect(guestStore.getDecryptedToken).toHaveBeenCalledOnce());

    // The credential is replaced while that read is in flight, then the old
    // read completes: its config is superseded and must not be pooled.
    guestStore.getDecryptedToken.mockResolvedValue('guest-token-v2');
    for (const listener of guestStore.replacedListeners) listener(GUEST.id);
    release('guest-token-v1');

    const client = await pending;
    expect((client.getConfig() as { token?: string }).token).toBe('guest-token-v2');
    expect(mod.getBackendClientForConnection(GUEST.id)).toBe(client);
    expect(guestStore.getDecryptedToken).toHaveBeenCalledTimes(2);
  });

  it('a guest re-join with windows open rebuilds the client and replays the reconnect marker', async () => {
    guestStore.findById.mockImplementation(async (id: string) => (id === GUEST.id ? GUEST : null));
    guestStore.getDecryptedToken.mockResolvedValue('guest-token-v1');
    const send = installWindow(GUEST.id);
    const { mod } = await loadModule();
    const reconnected = vi.fn();
    mod.onAnyBackendReconnected(reconnected);

    await mod.openBackendWindow(GUEST.id);
    const stale = mod.getBackendClientForConnection(GUEST.id);
    send.mockClear();

    guestStore.getDecryptedToken.mockResolvedValue('guest-token-v2');
    for (const listener of guestStore.replacedListeners) listener(GUEST.id);

    // No further open: the live window's client is rebuilt on the fresh
    // credential and told to re-subscribe, exactly like an owner re-pair.
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        'backend:status',
        expect.objectContaining({ status: 'connected', reconnected: true }),
      );
    });
    const fresh = mod.getBackendClientForConnection(GUEST.id);
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(stale);
    expect((fresh?.getConfig() as { token?: string }).token).toBe('guest-token-v2');
    expect(reconnected).toHaveBeenCalledWith(GUEST.id);
  });

  it('a guest forgotten on another device (sync tombstone) evicts the pooled client and closes its windows', async () => {
    guestStore.findById.mockImplementation(async (id: string) => (id === GUEST.id ? GUEST : null));
    guestStore.getDecryptedToken.mockResolvedValue('guest-token-v1');
    const { mod, ensureLocalWindowBeforeClose, closeForBackend } = await loadModule();
    mod.getBackendClient(); // client #1 (local)
    lifecycle.events = [];

    await mod.openBackendWindow(GUEST.id);
    const stale = mod.getBackendClientForConnection(GUEST.id);
    expect(stale).toBeDefined();
    expect(lifecycle.events.map((e) => e.type)).toEqual(['construct', 'start', 'open']);
    const staleSeq = lifecycle.events[0].seq;
    lifecycle.events = [];

    // The keychain pull applies the tombstone: the store deletes the record
    // and notifies. Nothing may keep serving the forgotten credential.
    guestStore.findById.mockResolvedValue(null);
    guestStore.getDecryptedToken.mockResolvedValue(null);
    expect(guestStore.removedListeners).toHaveLength(1);
    for (const listener of guestStore.removedListeners) listener(GUEST.id);
    expect(lifecycle.events).toEqual([{ type: 'dispose', seq: staleSeq }]);
    expect(mod.getBackendClientForConnection(GUEST.id)).toBeUndefined();
    expect(mod.getBackendClientForConnection('local')).toBeDefined();

    // Window teardown mirrors an owner forget: local fallback first, then
    // the guest's windows.
    await vi.waitFor(() => expect(closeForBackend).toHaveBeenCalledWith(GUEST.id));
    expect(ensureLocalWindowBeforeClose).toHaveBeenCalledWith(GUEST.id);
    expect(ensureLocalWindowBeforeClose.mock.invocationCallOrder[0]).toBeLessThan(
      closeForBackend.mock.invocationCallOrder[0],
    );
    // No rebuild: the record is gone, so a connect for the id fails closed.
    await expect(mod.connectBackendClient(GUEST.id)).rejects.toThrow(/unknown or incomplete/i);
    expect(lifecycle.events.filter((e) => e.type === 'construct')).toEqual([]);

    // A tombstone for an id with no pooled client touches nothing.
    lifecycle.events = [];
    closeForBackend.mockClear();
    for (const listener of guestStore.removedListeners) listener('guest-unknown');
    await Promise.resolve();
    expect(lifecycle.events).toEqual([]);
    expect(closeForBackend).not.toHaveBeenCalled();
  });

  it('a sync tombstone racing a guest client construction never pools the deleted credential', async () => {
    guestStore.findById.mockImplementation(async (id: string) => (id === GUEST.id ? GUEST : null));
    let release!: (token: string) => void;
    guestStore.getDecryptedToken.mockImplementationOnce(
      () => new Promise<string>((resolve) => (release = resolve)),
    );
    const { mod } = await loadModule();

    const pending = mod.connectBackendClient(GUEST.id);
    await vi.waitFor(() => expect(guestStore.getDecryptedToken).toHaveBeenCalledOnce());

    // The record is deleted while the credential read is in flight.
    guestStore.findById.mockResolvedValue(null);
    for (const listener of guestStore.removedListeners) listener(GUEST.id);
    release('guest-token-v1');

    await expect(pending).rejects.toThrow(/unknown or incomplete/i);
    expect(mod.getBackendClientForConnection(GUEST.id)).toBeUndefined();
    expect(lifecycle.events.filter((e) => e.type === 'construct')).toEqual([]);
  });

  it('a connected guest persists the routes its daemon advertises in the guest registry', async () => {
    guestStore.findById.mockImplementation(async (id: string) => (id === GUEST.id ? GUEST : null));
    guestStore.getDecryptedToken.mockResolvedValue('guest-token-v1');
    guestStore.setTcAddress.mockResolvedValue(true);
    guestStore.setHosts.mockResolvedValue(true);
    rpc.handler = async (method) => {
      if (method === 'system.status') {
        return {
          updateSupported: true,
          tcAddress: 'tc7f2a91.tailcat.net',
          localIps: ['10.0.0.9', '10.0.0.42', '127.0.0.1'],
        };
      }
      if (method === 'server.pairingInfo') {
        return { localIps: ['10.0.0.9', '10.0.0.42'], tcAddress: 'tc7f2a91.tailcat.net' };
      }
      return {};
    };
    const send = installWindow(GUEST.id);
    const { mod } = await loadModule();

    await mod.openBackendWindow(GUEST.id);
    const client = mod.getBackendClientForId(GUEST.id) as unknown as {
      hello(result: unknown): void;
    };
    client.hello({ server: { version: '6.8.0' } });

    await vi.waitFor(() => {
      expect(guestStore.setTcAddress).toHaveBeenCalledWith(GUEST.id, 'tc7f2a91.tailcat.net');
      // Loopback never becomes a dial candidate.
      expect(guestStore.setHosts).toHaveBeenCalledWith(GUEST.id, ['10.0.0.9', '10.0.0.42']);
    });
    // The owner registry is never asked to persist a guest's routes (an
    // unknown id there would silently drop them).
    expect(store.setHosts).not.toHaveBeenCalledWith(GUEST.id, expect.anything());
    expect(store.setTcAddress).not.toHaveBeenCalledWith(GUEST.id, expect.anything());
    expect(store.setUpdateSupported).not.toHaveBeenCalledWith(GUEST.id, expect.anything());
    // Renderers learn the refreshed record through the guest list push.
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith('guest-sessions:changed', expect.anything()),
    );
  });
});

// ---------------------------------------------------------------------------
// Cert-mismatch propagation
// ---------------------------------------------------------------------------

describe('pinned-cert mismatch propagation', () => {
  it('emits a single connections:cert-mismatch failure event on PinMismatchError', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();
    const { PinMismatchError } = await import('../backend-connection');

    await mod.openBackendWindow('remote-1'); // remote-1's pooled client is live
    const client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };

    client.emit('error', new PinMismatchError('AA:BB:CC:DD', 'EE:FF:00:11'));

    const mismatchCalls = send.mock.calls.filter(([c]) => c === 'connections:cert-mismatch');
    expect(mismatchCalls).toHaveLength(1);
    expect(mismatchCalls[0][1]).toEqual({
      id: 'remote-1',
      host: '10.0.0.5',
      port: 8443,
      expectedFingerprint: 'AA:BB:CC:DD',
      actualFingerprint: 'EE:FF:00:11',
    });

    // The reconnect loop re-raises on every retry — still only one modal.
    client.emit('error', new PinMismatchError('AA:BB:CC:DD', 'EE:FF:00:11'));
    expect(send.mock.calls.filter(([c]) => c === 'connections:cert-mismatch')).toHaveLength(1);
  });

  it('does not emit a mismatch event for a generic transport error', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1');
    const client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };

    client.emit('error', new Error('ECONNRESET'));
    expect(send.mock.calls.some(([c]) => c === 'connections:cert-mismatch')).toBe(false);
  });

  it('latches a pooled-client mismatch fired with zero windows and replays it on connections:list', async () => {
    // Boot-wide restore path: the pooled client connects BEFORE any window for
    // its backend exists, so the one-shot broadcast fires into the void. The
    // window created afterwards must still learn the mismatch from its initial
    // list fetch — a changed cert is a blocking trust decision, never droppable.
    const { mod } = await loadModule();
    const { PinMismatchError } = await import('../backend-connection');
    mod.registerBackendHandlers();

    const pooled = (await mod.connectBackendClient('remote-1')) as unknown as {
      emit(event: string, arg: unknown): void;
    };
    pooled.emit('error', new PinMismatchError('AA:BB:CC:DD', 'EE:FF:00:11'));

    // The window appears only now (restore creates it after the connect).
    const { localSender, remoteSender } = installBackendWindows();
    const handler = findHandler('connections:list');
    await expect(handler!({ sender: remoteSender }, undefined)).resolves.toMatchObject({
      certMismatch: {
        id: 'remote-1',
        host: '10.0.0.5',
        port: 8443,
        expectedFingerprint: 'AA:BB:CC:DD',
        actualFingerprint: 'EE:FF:00:11',
      },
    });
    // A window bound to a different (local) backend does not replay it.
    await expect(handler!({ sender: localSender }, undefined)).resolves.toMatchObject({
      certMismatch: null,
    });

    // A fresh client (re-pair) clears the latch: the list stops
    // replaying a mismatch that no longer describes the live client.
    mod.disconnectBackendClient('remote-1');
    await mod.connectBackendClient('remote-1');
    await expect(handler!({ sender: remoteSender }, undefined)).resolves.toMatchObject({
      certMismatch: null,
    });
  });

  it('carries the per-host mismatch list from a raced PinMismatchError (#1746)', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();
    const { PinMismatchError } = await import('../backend-connection');

    await mod.openBackendWindow('remote-1');
    const client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };

    client.emit(
      'error',
      new PinMismatchError('AA:BB:CC:DD', 'EE:FF:00:11', [
        { host: '10.0.0.5', expected: 'AA:BB:CC:DD', actual: 'EE:FF:00:11' },
        { host: '192.168.1.9', expected: 'AA:BB:CC:DD', actual: '22:33:44:55' },
      ]),
    );

    const mismatchCalls = send.mock.calls.filter(([c]) => c === 'connections:cert-mismatch');
    expect(mismatchCalls).toHaveLength(1);
    expect(mismatchCalls[0][1]).toMatchObject({
      id: 'remote-1',
      expectedFingerprint: 'AA:BB:CC:DD',
      actualFingerprint: 'EE:FF:00:11',
      mismatches: [
        { host: '10.0.0.5', expectedFingerprint: 'AA:BB:CC:DD', actualFingerprint: 'EE:FF:00:11' },
        {
          host: '192.168.1.9',
          expectedFingerprint: 'AA:BB:CC:DD',
          actualFingerprint: '22:33:44:55',
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Non-fatal per-host cert warnings (#1746)
// ---------------------------------------------------------------------------

describe('non-fatal per-host cert-warning propagation', () => {
  it('broadcasts connections:cert-warnings when the client observes a pin-mismatch', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();

    await mod.openBackendWindow('remote-1');
    const client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };

    client.emit('cert-warning', {
      host: '192.168.1.9',
      expected: 'AA:BB:CC:DD',
      actual: '22:33:44:55',
    });

    const warningCalls = send.mock.calls.filter(([c]) => c === 'connections:cert-warnings');
    expect(warningCalls).toHaveLength(1);
    expect(warningCalls[0][1]).toEqual({
      id: 'remote-1',
      warnings: [
        {
          host: '192.168.1.9',
          expectedFingerprint: 'AA:BB:CC:DD',
          actualFingerprint: '22:33:44:55',
        },
      ],
    });

    // The connection race re-observes the same mismatch on every reconnect
    // attempt — an unchanged fingerprint re-broadcasts nothing.
    client.emit('cert-warning', {
      host: '192.168.1.9',
      expected: 'AA:BB:CC:DD',
      actual: '22:33:44:55',
    });
    expect(send.mock.calls.filter(([c]) => c === 'connections:cert-warnings')).toHaveLength(1);
  });

  it('broadcasts an empty warnings array when the accumulated set is cleared', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();

    await mod.openBackendWindow('remote-1');
    const client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };
    client.emit('cert-warning', {
      host: '192.168.1.9',
      expected: 'AA:BB:CC:DD',
      actual: '22:33:44:55',
    });
    expect(send.mock.calls.filter(([c]) => c === 'connections:cert-warnings')).toHaveLength(1);

    // Dispose (re-pair path) — a renderer listening only on the dedicated
    // channel must be told the stale hosts are gone.
    mod.disconnectBackendClient('remote-1');
    const warningCalls = send.mock.calls.filter(([c]) => c === 'connections:cert-warnings');
    expect(warningCalls).toHaveLength(2);
    expect(warningCalls[1][1]).toEqual({ id: 'remote-1', warnings: [] });

    // With nothing accumulated, a fresh client's clear broadcasts nothing.
    await mod.connectBackendClient('remote-1');
    expect(send.mock.calls.filter(([c]) => c === 'connections:cert-warnings')).toHaveLength(2);
  });

  it('accumulates per-host warnings and keeps the latest fingerprint per host', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();

    await mod.openBackendWindow('remote-1');
    const client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };

    client.emit('cert-warning', {
      host: '192.168.1.9',
      expected: 'AA:BB:CC:DD',
      actual: '22:33:44:55',
    });
    client.emit('cert-warning', {
      host: '10.0.0.99',
      expected: 'AA:BB:CC:DD',
      actual: '66:77:88:99',
    });
    // The same host later presents a DIFFERENT cert — latest fingerprint wins.
    client.emit('cert-warning', {
      host: '192.168.1.9',
      expected: 'AA:BB:CC:DD',
      actual: 'FF:FF:FF:FF',
    });

    const warningCalls = send.mock.calls.filter(([c]) => c === 'connections:cert-warnings');
    expect(warningCalls).toHaveLength(3);
    expect(warningCalls.at(-1)?.[1]).toEqual({
      id: 'remote-1',
      warnings: [
        {
          host: '192.168.1.9',
          expectedFingerprint: 'AA:BB:CC:DD',
          actualFingerprint: 'FF:FF:FF:FF',
        },
        {
          host: '10.0.0.99',
          expectedFingerprint: 'AA:BB:CC:DD',
          actualFingerprint: '66:77:88:99',
        },
      ],
    });
  });

  it('latches warnings fired with zero windows and replays them on connections:list', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const pooled = (await mod.connectBackendClient('remote-1')) as unknown as {
      emit(event: string, arg: unknown): void;
    };
    pooled.emit('cert-warning', {
      host: '192.168.1.9',
      expected: 'AA:BB:CC:DD',
      actual: '22:33:44:55',
    });

    const { localSender, remoteSender } = installBackendWindows();
    const handler = findHandler('connections:list');
    await expect(handler!({ sender: remoteSender }, undefined)).resolves.toMatchObject({
      certWarnings: {
        id: 'remote-1',
        warnings: [
          {
            host: '192.168.1.9',
            expectedFingerprint: 'AA:BB:CC:DD',
            actualFingerprint: '22:33:44:55',
          },
        ],
      },
    });
    // A window bound to a different (local) backend does not replay it.
    await expect(handler!({ sender: localSender }, undefined)).resolves.toMatchObject({
      certWarnings: null,
    });

    // A fresh client (re-pair) clears the accumulated warnings: the next
    // connect re-observes any still-mismatching host.
    mod.disconnectBackendClient('remote-1');
    await mod.connectBackendClient('remote-1');
    await expect(handler!({ sender: remoteSender }, undefined)).resolves.toMatchObject({
      certWarnings: null,
    });
  });
});

// ---------------------------------------------------------------------------
// WSS auth-rejection propagation
// ---------------------------------------------------------------------------

describe('WSS auth-rejection propagation', () => {
  it('emits a single connections:auth-rejected failure event on AuthRejectedError', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();
    const { AuthRejectedError } = await import('../backend-connection');

    await mod.openBackendWindow('remote-1'); // remote-1's pooled client is live
    const client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };

    client.emit('error', new AuthRejectedError(401));

    const rejectedCalls = send.mock.calls.filter(([c]) => c === 'connections:auth-rejected');
    expect(rejectedCalls).toHaveLength(1);
    expect(rejectedCalls[0][1]).toEqual({
      id: 'remote-1',
      host: '10.0.0.5',
      port: 8443,
      statusCode: 401,
    });

    // The reconnect loop re-raises on every retry — still only one notice.
    client.emit('error', new AuthRejectedError(401));
    expect(send.mock.calls.filter(([c]) => c === 'connections:auth-rejected')).toHaveLength(1);
  });

  it('latches the rejection and replays it on connections:list for late subscribers', async () => {
    const { localSender, remoteSender } = installBackendWindows();
    const { mod } = await loadModule();
    const { AuthRejectedError } = await import('../backend-connection');
    mod.registerBackendHandlers();

    await mod.openBackendWindow('remote-1');
    const client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };
    client.emit('error', new AuthRejectedError(401));

    // A renderer created/reloaded AFTER the one-shot broadcast still learns the
    // rejection from its initial list fetch (the sticky #823 pattern) — gated
    // to windows bound to the rejected backend.
    const handler = findHandler('connections:list');
    await expect(handler!({ sender: remoteSender }, undefined)).resolves.toMatchObject({
      authRejected: { id: 'remote-1', host: '10.0.0.5', port: 8443, statusCode: 401 },
    });
    // A window bound to a different (local) backend does not replay it.
    await expect(handler!({ sender: localSender }, undefined)).resolves.toMatchObject({
      authRejected: null,
    });

    // A fresh client (re-pair) clears the latch: the list stops
    // replaying a rejection that no longer describes the live client.
    mod.disconnectBackendClient('remote-1');
    await mod.connectBackendClient('remote-1');
    await expect(handler!({ sender: remoteSender }, undefined)).resolves.toMatchObject({
      authRejected: null,
    });
  });

  it('carries the 403 statusCode (WS API disabled) on the payload', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();
    const { AuthRejectedError } = await import('../backend-connection');

    await mod.openBackendWindow('remote-1');
    const client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };

    client.emit('error', new AuthRejectedError(403));

    const rejectedCalls = send.mock.calls.filter(([c]) => c === 'connections:auth-rejected');
    expect(rejectedCalls).toHaveLength(1);
    expect(rejectedCalls[0][1]).toMatchObject({ statusCode: 403 });
  });

  it('resets the once-latch when a fresh client is constructed', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();
    const { AuthRejectedError } = await import('../backend-connection');

    await mod.openBackendWindow('remote-1');
    let client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };
    client.emit('error', new AuthRejectedError(401));
    expect(send.mock.calls.filter(([c]) => c === 'connections:auth-rejected')).toHaveLength(1);

    // A dispose + rebuild yields a fresh client → latch resets.
    mod.disconnectBackendClient('remote-1');
    await mod.connectBackendClient('remote-1');
    client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };
    client.emit('error', new AuthRejectedError(401));
    expect(send.mock.calls.filter(([c]) => c === 'connections:auth-rejected')).toHaveLength(2);
  });

  it('does not emit an auth-rejected event for a generic transport error', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1');
    const client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };

    client.emit('error', new Error('ECONNRESET'));
    expect(send.mock.calls.some(([c]) => c === 'connections:auth-rejected')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// IPC channel reachability + validation
// ---------------------------------------------------------------------------

describe('connections:* IPC handlers', () => {
  it('connections:list returns the list + active selection', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:list');
    expect(handler).toBeDefined();

    await expect(handler!({}, undefined)).resolves.toEqual({
      connections: [
        { ...LOCAL, status: 'disconnected' },
        { ...REMOTE, status: 'not-open' },
      ],
      activeId: 'local',
      windowBackendId: 'local',
      // No remote handshake has mismatched, so there is no sticky mismatch (#823).
      protocolMismatch: null,
      // No auth rejection has fired, so there is no sticky rejection either.
      authRejected: null,
      // No pinned cert has mismatched, so there is no sticky cert failure.
      certMismatch: null,
      // No non-fatal per-host mismatch has been observed either (#1746).
      certWarnings: null,
      // The app's pinned intentd version rides the list payload.
      pinnedVersion: '0.1.0',
      // No client reports 'connected' (the fake pool returns 'disconnected').
      connectedIds: [],
    });
  });

  it('connections:list enriches the local record with the external daemon version + updateSupported', async () => {
    const { mod } = await loadModule();
    // Same module registry as the loaded backend.ipc (vi.resetModules ran in
    // beforeEach), so this state is the instance the handler reads.
    const connectionMode = await import('../connection-mode');
    connectionMode.setConnectionMode('external');
    connectionMode.setDaemonVersionInfo({
      daemonVersion: '0.2.0',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });
    connectionMode.setLocalUpdateSupported(true);
    mod.registerBackendHandlers();

    await expect(findHandler('connections:list')!({}, undefined)).resolves.toMatchObject({
      connections: [
        { ...LOCAL, daemonVersion: '0.2.0', updateSupported: true, status: 'disconnected' },
        { ...REMOTE, status: 'not-open' },
      ],
    });
    connectionMode.__resetConnectionModeForTesting();
  });

  it('connections:list maps the external daemon version into the connected local row intentdVersion', async () => {
    const { mod } = await loadModule();
    const connectionMode = await import('../connection-mode');
    connectionMode.setConnectionMode('external');
    connectionMode.setDaemonVersionInfo({
      daemonVersion: '0.2.0',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });
    mod.registerBackendHandlers();
    // Only a CONNECTED local row shows the inline version, like remotes.
    const local = mod.getBackendClient() as unknown as { status: string };
    local.status = 'connected';

    const result = (await findHandler('connections:list')!({}, undefined)) as {
      connections: Array<Record<string, unknown>>;
    };
    expect(result.connections.find((c) => c.id === 'local')).toMatchObject({
      status: 'connected',
      intentdVersion: '0.2.0',
    });
    connectionMode.__resetConnectionModeForTesting();
  });

  it('connections:list leaves the local record unenriched in sidecar mode', async () => {
    const { mod } = await loadModule();
    const connectionMode = await import('../connection-mode');
    connectionMode.setConnectionMode('sidecar');
    connectionMode.setDaemonVersionInfo({
      daemonVersion: '0.2.0',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });
    connectionMode.setLocalUpdateSupported(true);
    mod.registerBackendHandlers();

    const result = (await findHandler('connections:list')!({}, undefined)) as {
      connections: Array<Record<string, unknown>>;
    };
    const local = result.connections.find((c) => c.id === 'local');
    expect(local).not.toHaveProperty('daemonVersion');
    expect(local).not.toHaveProperty('updateSupported');
    connectionMode.__resetConnectionModeForTesting();
  });

  it('connections:list reports connected pool members in connectedIds', async () => {
    const { mod } = await loadModule();
    mod.getBackendClient(); // local stays 'disconnected'
    const remote = (await mod.connectBackendClient('remote-1')) as unknown as { status: string };
    remote.status = 'connected';
    mod.registerBackendHandlers();

    await expect(findHandler('connections:list')!({}, undefined)).resolves.toMatchObject({
      connectedIds: ['remote-1'],
    });
  });

  it('re-broadcasts connections:changed when a pool member connects or drops', async () => {
    const send = installWindow();
    const { mod } = await loadModule();
    const remote = (await mod.connectBackendClient('remote-1')) as unknown as {
      status: string;
      emit(event: string, arg: unknown): void;
    };
    mod.registerBackendHandlers();

    remote.status = 'connected';
    remote.emit('status', 'connected');
    await vi.waitFor(() => {
      const changed = send.mock.calls.filter(([c]) => c === 'connections:changed');
      expect(changed.at(-1)?.[1]).toMatchObject({ connectedIds: ['remote-1'] });
    });

    remote.status = 'disconnected';
    remote.emit('status', 'disconnected');
    await vi.waitFor(() => {
      const changed = send.mock.calls.filter(([c]) => c === 'connections:changed');
      expect(changed.at(-1)?.[1]).toMatchObject({ connectedIds: [] });
    });
  });

  it('connections:update-backend routes system.requestUpdate to the pooled client', async () => {
    let accepted = false;
    rpc.handler = async (method) => {
      if (method === 'system.status')
        return { version: accepted ? '0.1.0' : '0.0.1', exactUpdateSupported: true };
      if (method === 'system.requestUpdate') {
        accepted = true;
        return { ok: true, targetVersion: '0.1.0' };
      }
      return {};
    };
    const { mod } = await loadModule();
    const remote = (await mod.connectBackendClient('remote-1')) as unknown as { status: string };
    remote.status = 'connected';
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update-backend');
    expect(handler).toBeDefined();

    await expect(
      handler!({}, { id: 'remote-1', targetVersion: '99.0.0', url: 'https://attacker/asset' }),
    ).resolves.toEqual({ ok: true });
    expect(rpc.payloads.filter(([method]) => method === 'system.requestUpdate')).toEqual([
      ['system.requestUpdate', { targetVersion: '0.1.0' }],
    ]);
  });

  it('coalesces simultaneous update requests for one device', async () => {
    let finish: (value: unknown) => void = () => {};
    const current = new Promise((resolve) => {
      finish = resolve;
    });
    let accepted = false;
    rpc.handler = async (method) => {
      if (method === 'system.status')
        return accepted ? current : { version: '0.0.1', exactUpdateSupported: true };
      if (method === 'system.requestUpdate') {
        accepted = true;
        return { ok: true, targetVersion: '0.1.0' };
      }
      return {};
    };
    const { mod } = await loadModule();
    const remote = (await mod.connectBackendClient('remote-1')) as unknown as { status: string };
    remote.status = 'connected';
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update-backend')!;
    const first = handler({}, { id: 'remote-1' });
    const second = handler({}, { id: 'remote-1' });
    await vi.waitFor(() =>
      expect(rpc.calls.filter((method) => method === 'system.requestUpdate')).toHaveLength(1),
    );
    finish({ version: '0.1.0' });
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
  });

  it('connections:update-backend rejects the local id as unsupported in sidecar/unknown mode', async () => {
    const { mod } = await loadModule();
    const connectionMode = await import('../connection-mode');
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update-backend')!;

    // Default (unresolved) mode — the FE manages its own sidecar.
    await expect(handler({}, { id: 'local' })).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });

    // Explicit sidecar mode — the app updater owns the sidecar, never this RPC.
    connectionMode.setConnectionMode('sidecar');
    const local = mod.getBackendClient() as unknown as { status: string };
    local.status = 'connected';
    await expect(handler({}, { id: 'local' })).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(rpc.calls).not.toContain('system.requestUpdate');
    connectionMode.__resetConnectionModeForTesting();
  });

  it('connections:update-backend routes the local id to the pooled local client in external mode', async () => {
    const { mod } = await loadModule();
    const connectionMode = await import('../connection-mode');
    connectionMode.setConnectionMode('external');
    mod.registerBackendHandlers();
    const local = mod.getBackendClient() as unknown as { status: string };
    local.status = 'connected';

    await expect(findHandler('connections:update-backend')!({}, { id: 'local' })).resolves.toEqual({
      ok: true,
    });
    expect(rpc.calls).toContain('system.requestUpdate');
    connectionMode.__resetConnectionModeForTesting();
  });

  it('connections:update-backend rejects the local id as unsupported over a non-UDS transport', async () => {
    // External mode with an env transport override (the INTENTD_WS_URL
    // two-terminal dev flow): the pooled local client is not UDS, so the
    // routing must mirror the capture's transport guard and refuse.
    const priorWsUrl = process.env.INTENTD_WS_URL;
    process.env.INTENTD_WS_URL = 'ws://127.0.0.1:51337/ws';
    try {
      const { mod } = await loadModule();
      const connectionMode = await import('../connection-mode');
      connectionMode.setConnectionMode('external');
      mod.registerBackendHandlers();
      const local = mod.getBackendClient() as unknown as { status: string };
      local.status = 'connected';

      await expect(
        findHandler('connections:update-backend')!({}, { id: 'local' }),
      ).resolves.toEqual({ ok: false, reason: 'unsupported' });
      expect(rpc.calls).not.toContain('system.requestUpdate');
      connectionMode.__resetConnectionModeForTesting();
    } finally {
      if (priorWsUrl === undefined) delete process.env.INTENTD_WS_URL;
      else process.env.INTENTD_WS_URL = priorWsUrl;
    }
  });

  it('connections:update-backend reports not-connected for a disconnected external local daemon', async () => {
    const { mod } = await loadModule();
    const connectionMode = await import('../connection-mode');
    connectionMode.setConnectionMode('external');
    mod.registerBackendHandlers();
    mod.getBackendClient(); // pooled local client stays 'disconnected'

    await expect(findHandler('connections:update-backend')!({}, { id: 'local' })).resolves.toEqual({
      ok: false,
      reason: 'not-connected',
    });
    expect(rpc.calls).not.toContain('system.requestUpdate');
    connectionMode.__resetConnectionModeForTesting();
  });

  it('connections:update-backend reports not-connected without a live client', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update-backend')!;

    // No pooled client at all for the id.
    await expect(handler({}, { id: 'remote-1' })).resolves.toEqual({
      ok: false,
      reason: 'not-connected',
    });

    // A pooled but disconnected client is not updatable either.
    await mod.connectBackendClient('remote-1'); // fake status stays 'disconnected'
    await expect(handler({}, { id: 'remote-1' })).resolves.toEqual({
      ok: false,
      reason: 'not-connected',
    });
    expect(rpc.calls).not.toContain('system.requestUpdate');
  });

  it('connections:update-backend maps -32601 to unsupported (daemon too old)', async () => {
    const { JsonRpcError } = await import('../json-rpc-errors');
    rpc.handler = async (method) => {
      if (method === 'system.requestUpdate') {
        throw new JsonRpcError({ code: -32601, message: 'Method not found' });
      }
      if (method === 'system.status') return { version: '0.0.1', exactUpdateSupported: true };
      return {};
    };
    const { mod } = await loadModule();
    const remote = (await mod.connectBackendClient('remote-1')) as unknown as { status: string };
    remote.status = 'connected';
    mod.registerBackendHandlers();

    await expect(
      findHandler('connections:update-backend')!({}, { id: 'remote-1' }),
    ).resolves.toEqual({ ok: false, reason: 'unsupported' });
  });

  it('connections:update-backend surfaces a structured daemon failure', async () => {
    const { JsonRpcError } = await import('../json-rpc-errors');
    rpc.handler = async (method) => {
      if (method === 'system.requestUpdate') {
        throw new JsonRpcError({ code: -32000, message: 'daemon is not sitter-supervised' });
      }
      if (method === 'system.status') return { version: '0.0.1', exactUpdateSupported: true };
      return {};
    };
    const { mod } = await loadModule();
    const remote = (await mod.connectBackendClient('remote-1')) as unknown as { status: string };
    remote.status = 'connected';
    mod.registerBackendHandlers();

    await expect(
      findHandler('connections:update-backend')!({}, { id: 'remote-1' }),
    ).resolves.toEqual({
      ok: false,
      reason: 'failed',
      message: 'daemon is not sitter-supervised',
    });
  });

  describe('daemonUpdateDisconnectedAt marker on backend:status', () => {
    type FakeClient = { status: string; emit(event: string, arg?: unknown): void };
    const MARKER = 'daemonUpdateDisconnectedAt';
    const pendingOperations: Promise<unknown>[] = [];
    const testClients: FakeClient[] = [];
    const T0 = new Date('2026-01-01T00:00:00Z').getTime();

    /** Remote-1 window + connected pooled client + handlers, ready to update. */
    async function setupConnectedRemote() {
      const { localSender, remoteSender, localSend, remoteSend } = installBackendWindows();
      const { mod } = await loadModule();
      mod.getBackendClient();
      const remote = (await mod.connectBackendClient('remote-1')) as unknown as FakeClient;
      remote.status = 'connected';
      mod.registerBackendHandlers();
      const handler = findHandler('connections:update-backend')!;
      const previous = rpc.handler;
      let onAccepted: (() => void) | undefined;
      rpc.handler = async (method) => {
        if (method === 'system.status')
          return {
            version: '0.0.1',
            exactUpdateSupported: true,
            targetUpdate: { targetVersion: '0.1.0', state: 'installing' },
          };
        const result = await previous(method);
        if (method === 'system.requestUpdate') {
          onAccepted?.();
          return { ok: true, targetVersion: '0.1.0' };
        }
        return result;
      };
      // Observe acceptance separately: the production IPC now remains pending
      // through restart. Each test drives drops while that operation is live.
      const update = async (event: unknown, params: unknown) => {
        const accepted = new Promise<{ ok: true }>((resolve) => {
          onAccepted = () => resolve({ ok: true });
        });
        const result = handler(event, params);
        pendingOperations.push(result);
        return Promise.race([accepted, result]);
      };
      testClients.push(remote);
      const getStatus = findHandler('backend:get-status')!;
      const payloadsOf = (send: ReturnType<typeof vi.fn>) => () =>
        send.mock.calls
          .filter(([c]) => c === 'backend:status')
          .map(([, payload]) => payload as Record<string, unknown>);
      return {
        mod,
        remote,
        update,
        getStatus,
        localSender,
        remoteSender,
        localSend,
        statusPayloads: payloadsOf(remoteSend),
        localStatusPayloads: payloadsOf(localSend),
      };
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(T0);
    });

    afterEach(async () => {
      rpc.handler = async () => ({ version: '0.1.0', exactUpdateSupported: true });
      for (const client of testClients.splice(0)) client.status = 'connected';
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all(pendingOperations.splice(0));
      vi.useRealTimers();
    });

    it('carries the first-drop time on the status broadcasts and snapshot after a successful request', async () => {
      const { remote, update, getStatus, remoteSender, localSender, localSend, statusPayloads } =
        await setupConnectedRemote();

      await expect(update({}, { id: 'remote-1' })).resolves.toEqual({ ok: true });

      vi.setSystemTime(T0 + 1_500);
      remote.emit('status', 'disconnected');
      expect(statusPayloads().at(-1)).toEqual(
        expect.objectContaining({ status: 'disconnected', [MARKER]: T0 + 1_500 }),
      );
      // Later pushes for the same restart keep the ORIGINAL drop time so every
      // window (including one opened mid-outage) shares one deadline.
      vi.setSystemTime(T0 + 4_000);
      remote.emit('status', 'connecting');
      expect(statusPayloads().at(-1)).toEqual(
        expect.objectContaining({ status: 'connecting', [MARKER]: T0 + 1_500 }),
      );
      await expect(getStatus({ sender: remoteSender }, undefined)).resolves.toEqual(
        expect.objectContaining({ status: 'connecting', [MARKER]: T0 + 1_500 }),
      );

      // Other backends are untouched: the local snapshot carries no marker.
      const localSnapshot = (await getStatus({ sender: localSender }, undefined)) as Record<
        string,
        unknown
      >;
      expect(localSnapshot).not.toHaveProperty(MARKER);
      expect(localSend).not.toHaveBeenCalledWith(
        'backend:status',
        expect.objectContaining({ [MARKER]: expect.anything() }),
      );
    });

    it('omits the marker until the client actually drops', async () => {
      const { remote, update, getStatus, remoteSender, statusPayloads } =
        await setupConnectedRemote();
      await expect(update({}, { id: 'remote-1' })).resolves.toEqual({ ok: true });

      await expect(getStatus({ sender: remoteSender }, undefined)).resolves.not.toHaveProperty(
        MARKER,
      );
      remote.emit('status', 'connected');
      expect(statusPayloads().at(-1)).toMatchObject({ status: 'connected' });
      expect(statusPayloads().at(-1)).not.toHaveProperty(MARKER);
    });

    it('does not flag a disconnect that was not preceded by an update request', async () => {
      const { remote, statusPayloads } = await setupConnectedRemote();

      remote.emit('status', 'disconnected');
      expect(statusPayloads()).toHaveLength(1);
      expect(statusPayloads()[0]).not.toHaveProperty(MARKER);
    });

    it('never sends the local marker to a remote window (unscoped orphan-restart broadcast)', async () => {
      const { mod, update, statusPayloads, localStatusPayloads } = await setupConnectedRemote();
      const connectionMode = await import('../connection-mode');
      connectionMode.setConnectionMode('external');
      try {
        const local = mod.getBackendClient() as unknown as FakeClient;
        local.status = 'connected';

        await expect(update({}, { id: 'local' })).resolves.toEqual({ ok: true });
        vi.setSystemTime(T0 + 1_000);
        local.emit('status', 'disconnected');
        expect(localStatusPayloads().at(-1)).toEqual(
          expect.objectContaining({ status: 'disconnected', [MARKER]: T0 + 1_000 }),
        );

        mockRestartOrphanedSidecar.mockResolvedValueOnce({ ok: true, spawned: true });
        await expect(
          findHandler('backend:restart-orphaned-sidecar')!({}, undefined),
        ).resolves.toMatchObject({ ok: true });
        expect(mockRestartOrphanedSidecar).toHaveBeenCalledTimes(1);

        // The unscoped restart broadcast reached the remote window without the
        // local marker; nothing the remote window received carried it.
        expect(statusPayloads().length).toBeGreaterThan(0);
        for (const payload of statusPayloads()) expect(payload).not.toHaveProperty(MARKER);
      } finally {
        connectionMode.__resetConnectionModeForTesting();
      }
    });

    it('forgets the pending update when the client is disposed and rebuilt', async () => {
      const { mod, remote, update, getStatus, remoteSender, statusPayloads } =
        await setupConnectedRemote();
      await expect(update({}, { id: 'remote-1' })).resolves.toEqual({ ok: true });
      remote.emit('status', 'disconnected');
      expect(statusPayloads().at(-1)).toHaveProperty(MARKER);

      mod.disconnectBackendClient('remote-1');
      const rebuilt = (await mod.connectBackendClient('remote-1')) as unknown as FakeClient;
      expect(rebuilt).not.toBe(remote);

      rebuilt.emit('status', 'connecting');
      expect(statusPayloads().at(-1)).toMatchObject({ status: 'connecting' });
      expect(statusPayloads().at(-1)).not.toHaveProperty(MARKER);
      await expect(getStatus({ sender: remoteSender }, undefined)).resolves.not.toHaveProperty(
        MARKER,
      );
    });

    it('records nothing when the request fails', async () => {
      const { JsonRpcError } = await import('../json-rpc-errors');
      rpc.handler = async (method) => {
        if (method === 'system.requestUpdate') {
          throw new JsonRpcError({ code: -32000, message: 'daemon is not sitter-supervised' });
        }
        return {};
      };
      const { remote, update, statusPayloads } = await setupConnectedRemote();

      await expect(update({}, { id: 'remote-1' })).resolves.toMatchObject({ ok: false });

      remote.emit('status', 'disconnected');
      expect(statusPayloads().at(-1)).toMatchObject({ status: 'disconnected' });
      expect(statusPayloads().at(-1)).not.toHaveProperty(MARKER);
    });

    it('records nothing for a not-connected target', async () => {
      const { remote, update, statusPayloads } = await setupConnectedRemote();
      remote.status = 'disconnected';

      await expect(update({}, { id: 'remote-1' })).resolves.toEqual({
        ok: false,
        reason: 'not-connected',
      });

      remote.emit('status', 'connecting');
      expect(statusPayloads().at(-1)).not.toHaveProperty(MARKER);
    });

    it('clears the marker once the backend reconnects after the drop', async () => {
      const { remote, update, getStatus, remoteSender, statusPayloads } =
        await setupConnectedRemote();
      await update({}, { id: 'remote-1' });

      // A connected status BEFORE any drop is not a completed restart: the
      // entry survives (the later drop below still carries the marker).
      remote.emit('status', 'connected');
      expect(statusPayloads().at(-1)).toMatchObject({ status: 'connected' });
      expect(statusPayloads().at(-1)).not.toHaveProperty(MARKER);

      vi.setSystemTime(T0 + 2_000);
      remote.emit('status', 'disconnected');
      remote.emit('status', 'connecting');
      expect(statusPayloads().at(-1)).toEqual(
        expect.objectContaining({ status: 'connecting', [MARKER]: T0 + 2_000 }),
      );

      remote.emit('status', 'connected');
      remote.emit('reconnected');
      const [connected, reconnected] = statusPayloads().slice(-2);
      expect(connected).toMatchObject({ status: 'connected' });
      expect(connected).not.toHaveProperty(MARKER);
      expect(reconnected).toMatchObject({ status: 'connected', reconnected: true });
      expect(reconnected).not.toHaveProperty(MARKER);

      // A later unrelated drop is a plain disconnect again.
      remote.emit('status', 'disconnected');
      expect(statusPayloads().at(-1)).not.toHaveProperty(MARKER);
      await expect(getStatus({ sender: remoteSender }, undefined)).resolves.not.toHaveProperty(
        MARKER,
      );
    });

    it('omits the marker once the request is older than the TTL', async () => {
      const { mod, remote, update, getStatus, remoteSender, statusPayloads } =
        await setupConnectedRemote();
      await update({}, { id: 'remote-1' });

      const dropAt = T0 + mod.DAEMON_UPDATE_PENDING_TTL_MS - 1;
      vi.setSystemTime(dropAt);
      remote.emit('status', 'disconnected');
      expect(statusPayloads().at(-1)).toEqual(expect.objectContaining({ [MARKER]: dropAt }));

      vi.setSystemTime(dropAt + 1);
      remote.emit('status', 'connecting');
      expect(statusPayloads().at(-1)).toMatchObject({ status: 'connecting' });
      expect(statusPayloads().at(-1)).not.toHaveProperty(MARKER);
      await expect(getStatus({ sender: remoteSender }, undefined)).resolves.not.toHaveProperty(
        MARKER,
      );
    });
  });

  it('connections:capture-fingerprint returns the presented fingerprint', async () => {
    mockCaptureFingerprint.mockResolvedValue({
      ok: true,
      fingerprint: 'AA:BB:CC:DD',
      tokenValid: true,
    });
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:capture-fingerprint');

    await expect(handler!({}, { host: '10.0.0.5', port: 8443, token: 'tok' })).resolves.toEqual({
      fingerprint: 'AA:BB:CC:DD',
      tokenValid: true,
    });
    expect(mockCaptureFingerprint).toHaveBeenCalledWith({
      host: '10.0.0.5',
      port: 8443,
      token: 'tok',
    });
  });

  it('connections:capture-fingerprint passes a token rejection through with its status', async () => {
    mockCaptureFingerprint.mockResolvedValue({
      ok: true,
      fingerprint: 'AA:BB:CC:DD',
      tokenValid: false,
      statusCode: 401,
    });
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:capture-fingerprint');

    await expect(handler!({}, { host: '10.0.0.5', port: 8443, token: 'tok' })).resolves.toEqual({
      fingerprint: 'AA:BB:CC:DD',
      tokenValid: false,
      statusCode: 401,
    });
  });

  it('connections:capture-fingerprint rejects on a structured capture failure', async () => {
    mockCaptureFingerprint.mockResolvedValue({
      ok: false,
      code: 'timeout',
      error: 'fingerprint capture timed out after 10000ms',
    });
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:capture-fingerprint');

    await expect(handler!({}, { host: '10.0.0.5', port: 8443, token: 'tok' })).rejects.toThrow(
      /timed out/i,
    );
  });

  it('connections:add stores the connection and broadcasts the changed list', async () => {
    store.add.mockResolvedValue(REMOTE);
    const send = installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:add');

    const params = {
      label: 'Studio Mac',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: 'AA:BB:CC:DD',
      token: 'secret-token',
    };
    await expect(handler!({}, params)).resolves.toEqual({ connection: REMOTE, switched: false });
    expect(store.add).toHaveBeenCalledWith(params);
    expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true);
  });

  it('connections:add passes the detectHosts option through to the store (#1746)', async () => {
    store.add.mockResolvedValue(REMOTE);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:add');

    const params = {
      label: 'Studio Mac',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: 'AA:BB:CC:DD',
      token: 'secret-token',
      detectHosts: false,
    };
    await expect(handler!({}, params)).resolves.toEqual({ connection: REMOTE, switched: false });
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ detectHosts: false }));
  });

  it('connections:add passes syncExcluded through to the store (iCloud opt-out)', async () => {
    store.add.mockResolvedValue(REMOTE);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:add');

    const params = {
      label: 'Studio Mac',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: 'AA:BB:CC:DD',
      token: 'secret-token',
      syncExcluded: true,
    };
    await expect(handler!({}, params)).resolves.toEqual({ connection: REMOTE, switched: false });
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ syncExcluded: true }));
  });

  it('connections:add without syncExcluded leaves the flag absent (store default = synced)', async () => {
    store.add.mockResolvedValue(REMOTE);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:add');

    const params = {
      label: 'Studio Mac',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: 'AA:BB:CC:DD',
      token: 'secret-token',
    };
    await expect(handler!({}, params)).resolves.toEqual({ connection: REMOTE, switched: false });
    expect(store.add).toHaveBeenCalledWith(
      expect.not.objectContaining({ syncExcluded: expect.anything() }),
    );
  });

  it('connections:update changes remote presentation metadata without revalidating its saved address', async () => {
    const updated = {
      ...REMOTE,
      label: 'Editing Mac',
      accent: 'violet' as const,
      detectedDeviceKind: 'macStudio' as const,
      deviceIcon: 'cat' as const,
    };
    store.getDecryptedToken.mockRejectedValue(new Error('undecryptable secret material'));
    store.updateMetadata.mockResolvedValue(updated);
    const send = installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update');

    await expect(
      handler!(
        {},
        {
          id: REMOTE.id,
          label: 'Editing Mac',
          accent: 'violet',
          detectedDeviceKind: 'macStudio',
          deviceIcon: 'cat',
        },
      ),
    ).resolves.toEqual({ status: 'updated', connection: updated });
    expect(store.updateMetadata).toHaveBeenCalledWith(
      REMOTE.id,
      expect.objectContaining({
        label: 'Editing Mac',
        accent: 'violet',
        host: REMOTE.host,
        port: REMOTE.port,
        fingerprint: REMOTE.fingerprint,
        detectedDeviceKind: 'macStudio',
        deviceIcon: 'cat',
      }),
    );
    expect(mockCaptureFingerprint).not.toHaveBeenCalled();
    expect(store.getDecryptedToken).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('connections:changed', expect.any(Object));
  });

  it('connections:update forwards a local device icon to the store', async () => {
    const updated = { ...LOCAL, deviceIcon: 'cat' as const };
    store.updateMetadata.mockResolvedValue(updated);
    const send = installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update');

    const params = { id: 'local', label: LOCAL.label, accent: null, deviceIcon: 'cat' };
    await expect(handler!({}, params)).resolves.toEqual({ status: 'updated', connection: updated });
    expect(store.updateMetadata).toHaveBeenCalledWith('local', params);
    expect(send).toHaveBeenCalledWith('connections:changed', expect.any(Object));
  });

  it('connections:update forwards detectHosts / syncExcluded flips to the store without revalidating', async () => {
    const updated = { ...REMOTE, detectHosts: false, syncExcluded: true };
    store.updateMetadata.mockResolvedValue(updated);
    const send = installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update');

    await expect(
      handler!(
        {},
        {
          id: REMOTE.id,
          label: REMOTE.label,
          accent: 'violet',
          detectHosts: false,
          syncExcluded: true,
        },
      ),
    ).resolves.toEqual({ status: 'updated', connection: updated });
    expect(store.updateMetadata).toHaveBeenCalledWith(
      REMOTE.id,
      expect.objectContaining({ detectHosts: false, syncExcluded: true }),
    );
    expect(mockCaptureFingerprint).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('connections:changed', expect.any(Object));
  });

  it('tests unsaved address values with the saved secret without saving or opening a window', async () => {
    mockCaptureFingerprint.mockResolvedValue({
      ok: true,
      fingerprint: REMOTE.fingerprint,
      connected: true,
      tokenValid: true,
    });
    const { mod, openOrFocus } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:test');

    await expect(handler!({}, { id: REMOTE.id, host: '10.0.0.99', port: 9443 })).resolves.toEqual({
      status: 'success',
      fingerprint: REMOTE.fingerprint,
    });
    // Two-phase probe (monorepo#3782): the fingerprint is captured WITHOUT
    // the saved secret first; the token is transmitted only once the
    // presented certificate matched the saved pin — and the authenticated
    // capture pins that fingerprint at the TLS handshake so a swapped
    // certificate aborts before the token is written (TOCTOU).
    expect(mockCaptureFingerprint).toHaveBeenNthCalledWith(1, { host: '10.0.0.99', port: 9443 });
    expect(mockCaptureFingerprint).toHaveBeenNthCalledWith(2, {
      host: '10.0.0.99',
      port: 9443,
      token: 'secret-token',
      expectedFingerprint: REMOTE.fingerprint,
    });
    expect(store.updateMetadata).not.toHaveBeenCalled();
    expect(store.replaceSecret).not.toHaveBeenCalled();
    expect(openOrFocus).not.toHaveBeenCalled();
  });

  it('tests a write-only secret override without decrypting or persisting it', async () => {
    store.getDecryptedToken.mockRejectedValue(new Error('stored secret is undecryptable'));
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:test');

    const result = await handler!(
      {},
      { id: REMOTE.id, host: '10.0.0.99', port: 9443, token: 'preview-token' },
    );

    expect(result).toEqual({ status: 'success', fingerprint: REMOTE.fingerprint });
    expect(store.getDecryptedToken).not.toHaveBeenCalled();
    expect(store.updateMetadata).not.toHaveBeenCalled();
    expect(store.replaceSecret).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('preview-token');
    // The unauthenticated probe never carries the override token either.
    expect(mockCaptureFingerprint).toHaveBeenNthCalledWith(1, { host: '10.0.0.99', port: 9443 });
    expect(mockCaptureFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'preview-token' }),
    );
  });

  it('returns token-free guidance when testing cannot decrypt the saved secret', async () => {
    store.getDecryptedToken.mockRejectedValue(
      new Error('raw decrypt failure with secret-material'),
    );
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:test');

    const result = await handler!({}, { id: REMOTE.id, host: '10.0.0.99', port: 9443 });

    expect(result).toEqual({ status: 'secret-unavailable' });
    expect(JSON.stringify(result)).not.toContain('decrypt');
    expect(JSON.stringify(result)).not.toContain('secret-material');
    expect(mockCaptureFingerprint).not.toHaveBeenCalled();
    expect(store.updateMetadata).not.toHaveBeenCalled();
  });

  it('requires explicit fingerprint confirmation before persisting an address change', async () => {
    const changedFingerprint = 'DD:EE:FF';
    mockCaptureFingerprint.mockResolvedValue({
      ok: true,
      fingerprint: changedFingerprint,
      connected: true,
      tokenValid: true,
    });
    store.updateMetadata.mockResolvedValue({
      ...REMOTE,
      host: '10.0.0.99',
      port: 9443,
      fingerprint: changedFingerprint,
    });
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update');
    const params = {
      id: REMOTE.id,
      label: REMOTE.label,
      accent: 'blue' as const,
      host: '10.0.0.99',
      port: 9443,
    };

    await expect(handler!({}, params)).resolves.toEqual({
      status: 'fingerprint-confirmation-required',
      expectedFingerprint: REMOTE.fingerprint,
      actualFingerprint: changedFingerprint,
    });
    expect(store.updateMetadata).not.toHaveBeenCalled();
    // Trust before transmission (monorepo#3782): the changed host was probed
    // exactly once, WITHOUT the saved secret — declining the fingerprint means
    // the token never reached the new host.
    expect(mockCaptureFingerprint).toHaveBeenCalledTimes(1);
    expect(mockCaptureFingerprint).toHaveBeenCalledWith({ host: '10.0.0.99', port: 9443 });

    await expect(
      handler!({}, { ...params, confirmedFingerprint: changedFingerprint }),
    ).resolves.toMatchObject({ status: 'updated' });
    // Only the confirmed retry transmits the saved token (phase two), pinned
    // to the just-confirmed fingerprint at the TLS handshake.
    expect(mockCaptureFingerprint).toHaveBeenCalledTimes(3);
    expect(mockCaptureFingerprint).toHaveBeenNthCalledWith(3, {
      host: '10.0.0.99',
      port: 9443,
      token: 'secret-token',
      expectedFingerprint: changedFingerprint,
    });
    expect(store.updateMetadata).toHaveBeenCalledWith(
      REMOTE.id,
      expect.objectContaining({
        host: '10.0.0.99',
        port: 9443,
        fingerprint: changedFingerprint,
      }),
    );
  });

  it('surfaces a certificate swap between the probe and the verify as a fresh confirmation', async () => {
    // TOCTOU regression (monorepo#3782): the unauthenticated probe sees the
    // saved pin, but the host swaps its certificate before the authenticated
    // verify. The handshake-level pin aborts that capture (structured
    // fingerprint-mismatch, token never written) and the handler surfaces a
    // fresh confirmation requirement instead of persisting.
    const swappedFingerprint = 'EE:FF:00:11';
    mockCaptureFingerprint
      .mockResolvedValueOnce({
        ok: true,
        fingerprint: REMOTE.fingerprint,
        connected: false,
        tokenValid: true,
        statusCode: 401,
      })
      .mockResolvedValueOnce({
        ok: false,
        code: 'fingerprint-mismatch',
        error: 'certificate fingerprint mismatch',
        actualFingerprint: swappedFingerprint,
      });
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update');

    await expect(
      handler!(
        {},
        { id: REMOTE.id, label: REMOTE.label, accent: 'blue', host: '10.0.0.99', port: 9443 },
      ),
    ).resolves.toEqual({
      status: 'fingerprint-confirmation-required',
      expectedFingerprint: REMOTE.fingerprint,
      actualFingerprint: swappedFingerprint,
    });
    expect(store.updateMetadata).not.toHaveBeenCalled();
    // The verify carried the handshake pin that stopped the token.
    expect(mockCaptureFingerprint).toHaveBeenNthCalledWith(2, {
      host: '10.0.0.99',
      port: 9443,
      token: 'secret-token',
      expectedFingerprint: REMOTE.fingerprint,
    });
  });

  it('returns token-free guidance when an address change cannot decrypt the saved secret', async () => {
    store.getDecryptedToken.mockRejectedValue(
      new Error('raw decrypt failure with secret-material'),
    );
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update');

    const result = await handler!(
      {},
      {
        id: REMOTE.id,
        label: REMOTE.label,
        accent: 'blue',
        host: '10.0.0.99',
        port: 9443,
      },
    );

    expect(result).toEqual({ status: 'secret-unavailable' });
    expect(JSON.stringify(result)).not.toContain('decrypt');
    expect(JSON.stringify(result)).not.toContain('secret-material');
    expect(mockCaptureFingerprint).not.toHaveBeenCalled();
    expect(store.updateMetadata).not.toHaveBeenCalled();
  });

  it('leaves the saved secret unchanged when rotation authentication fails', async () => {
    mockCaptureFingerprint.mockResolvedValue({
      ok: true,
      fingerprint: REMOTE.fingerprint,
      connected: false,
      tokenValid: false,
      statusCode: 401,
    });
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:rotate-secret');

    await expect(handler!({}, { id: REMOTE.id, token: 'replacement' })).resolves.toEqual({
      status: 'authentication-rejected',
      statusCode: 401,
    });
    expect(store.replaceSecret).not.toHaveBeenCalled();
  });

  it('rotates a validated secret without returning it', async () => {
    mockCaptureFingerprint.mockResolvedValue({
      ok: true,
      fingerprint: REMOTE.fingerprint,
      connected: true,
      tokenValid: true,
    });
    let secretReplaced = false;
    store.replaceSecret.mockImplementation(async () => {
      secretReplaced = true;
      return REMOTE;
    });
    const { mod } = await loadModule();
    const before = await mod.connectBackendClient(REMOTE.id);
    store.getDecryptedToken.mockClear();
    store.getDecryptedToken.mockImplementation(async () => {
      if (!secretReplaced) throw new Error('old secret cannot be decrypted');
      return 'replacement';
    });
    mod.registerBackendHandlers();
    const handler = findHandler('connections:rotate-secret');

    const result = await handler!({}, { id: REMOTE.id, token: 'replacement' });
    expect(result).toEqual({ status: 'updated', connection: REMOTE });
    expect(JSON.stringify(result)).not.toContain('replacement');
    expect(store.replaceSecret).toHaveBeenCalledWith(REMOTE.id, 'replacement', REMOTE.fingerprint);
    expect(store.replaceSecret.mock.invocationCallOrder[0]).toBeLessThan(
      store.getDecryptedToken.mock.invocationCallOrder[0],
    );
    expect(mod.getBackendClientForConnection(REMOTE.id)).not.toBe(before);
  });

  it('rebuilds only the affected open pooled client after an address change', async () => {
    const other = {
      ...REMOTE,
      id: 'remote-2',
      host: '10.0.0.6',
      fingerprint: '11:22:33',
    };
    store.list.mockResolvedValue([LOCAL, REMOTE, other]);
    mockCaptureFingerprint.mockResolvedValue({
      ok: true,
      fingerprint: REMOTE.fingerprint,
      connected: true,
      tokenValid: true,
    });
    store.updateMetadata.mockResolvedValue({ ...REMOTE, host: '10.0.0.99' });
    const { mod } = await loadModule();
    const affectedBefore = await mod.connectBackendClient(REMOTE.id);
    const otherBefore = await mod.connectBackendClient(other.id);
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update');

    await handler!(
      {},
      {
        id: REMOTE.id,
        label: REMOTE.label,
        accent: 'blue',
        host: '10.0.0.99',
        port: REMOTE.port,
      },
    );

    expect(mod.getBackendClientForConnection(REMOTE.id)).not.toBe(affectedBefore);
    expect(mod.getBackendClientForConnection(other.id)).toBe(otherBefore);
  });

  it('rebuilds an open pooled client when detectHosts flips off so it stops dialing the cleared extras', async () => {
    const withExtras = { ...REMOTE, hosts: ['10.0.0.5', '192.168.1.5'] };
    store.list.mockResolvedValue([LOCAL, withExtras]);
    store.updateMetadata.mockImplementation(async () => {
      const cleared = { ...REMOTE, detectHosts: false, hosts: [] };
      store.list.mockResolvedValue([LOCAL, cleared]);
      return cleared;
    });
    const { mod } = await loadModule();
    const before = await mod.connectBackendClient(REMOTE.id);
    expect((before.getConfig() as { hosts?: string[] }).hosts).toEqual(['10.0.0.5', '192.168.1.5']);
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update');

    await handler!({}, { id: REMOTE.id, label: REMOTE.label, accent: 'blue', detectHosts: false });

    const after = mod.getBackendClientForConnection(REMOTE.id);
    expect(after).not.toBe(before);
    expect((after!.getConfig() as { hosts?: string[] }).hosts).toEqual(['10.0.0.5']);
    expect(mockCaptureFingerprint).not.toHaveBeenCalled();
  });

  it('does not rebuild an open pooled client for a metadata edit that leaves detectHosts as-is', async () => {
    store.updateMetadata.mockResolvedValue({ ...REMOTE, label: 'Renamed' });
    const { mod } = await loadModule();
    const before = await mod.connectBackendClient(REMOTE.id);
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update');

    await handler!({}, { id: REMOTE.id, label: 'Renamed', accent: 'blue', detectHosts: true });

    expect(mod.getBackendClientForConnection(REMOTE.id)).toBe(before);
  });

  it('serializes connection tests so each uses a stable saved-secret snapshot', async () => {
    // Each test now performs a two-phase capture (unauthenticated probe, then
    // authenticated verify — monorepo#3782), so gate every capture call.
    const gates: Array<(value: unknown) => void> = [];
    mockCaptureFingerprint.mockImplementation(() => new Promise((resolve) => gates.push(resolve)));
    const capturedOk = {
      ok: true,
      fingerprint: REMOTE.fingerprint,
      connected: true,
      tokenValid: true,
    };
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:test')!;

    const first = handler({}, { id: REMOTE.id, host: '10.0.0.8', port: 8443 });
    const second = handler({}, { id: REMOTE.id, host: '10.0.0.9', port: 8443 });
    await vi.waitFor(() => expect(mockCaptureFingerprint).toHaveBeenCalledTimes(1));
    gates[0]!(capturedOk);
    await vi.waitFor(() => expect(mockCaptureFingerprint).toHaveBeenCalledTimes(2));
    gates[1]!(capturedOk);
    await expect(first).resolves.toMatchObject({ status: 'success' });
    // The second test's probe starts only after the first fully settled.
    await vi.waitFor(() => expect(mockCaptureFingerprint).toHaveBeenCalledTimes(3));
    gates[2]!(capturedOk);
    await vi.waitFor(() => expect(mockCaptureFingerprint).toHaveBeenCalledTimes(4));
    gates[3]!(capturedOk);
    await expect(second).resolves.toMatchObject({ status: 'success' });
  });

  it('accepts separator-equivalent saved and captured fingerprints', async () => {
    const saved = { ...REMOTE, fingerprint: 'aa:bb:cc' };
    store.list.mockResolvedValue([LOCAL, saved]);
    mockCaptureFingerprint.mockResolvedValue({
      ok: true,
      fingerprint: 'AA BB CC',
      connected: true,
      tokenValid: true,
    });
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:test')!;

    await expect(
      handler({}, { id: saved.id, host: saved.host, port: saved.port }),
    ).resolves.toEqual({
      status: 'success',
      fingerprint: 'AA:BB:CC',
    });
  });

  it('rejects local, unknown, and malformed edit operations before mutation', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const testHandler = findHandler('connections:test');
    const updateHandler = findHandler('connections:update');

    await expect(testHandler!({}, { id: LOCAL.id, host: '127.0.0.1', port: 8443 })).rejects.toThrow(
      'local',
    );
    await expect(
      testHandler!({}, { id: 'missing', host: '127.0.0.1', port: 8443 }),
    ).rejects.toThrow('Unknown');
    await expect(
      updateHandler!(
        {},
        {
          id: REMOTE.id,
          label: REMOTE.label,
          accent: 'blue',
          host: '127.0.0.1',
          port: 70_000,
        },
      ),
    ).rejects.toThrow();
    expect(store.updateMetadata).not.toHaveBeenCalled();
    expect(store.replaceSecret).not.toHaveBeenCalled();
  });

  it('connections:update rejects invalid accent metadata before touching the store', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update');

    await expect(
      handler!({}, { id: REMOTE.id, label: 'Editing Mac', accent: 'chartreuse' }),
    ).rejects.toThrow();
    expect(store.updateMetadata).not.toHaveBeenCalled();
  });

  it('connections:list reports pooled status without opening saved remotes', async () => {
    const { mod } = await loadModule();
    mod.getBackendClient();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:list');

    await expect(handler!({}, undefined)).resolves.toMatchObject({
      connections: [
        { id: LOCAL.id, status: 'disconnected' },
        { id: REMOTE.id, status: 'not-open' },
      ],
    });
    expect(mod.getBackendClientForConnection(REMOTE.id)).toBeUndefined();
  });

  it('pooled-client status transitions rebroadcast refreshed connection state', async () => {
    const send = installWindow();
    const { mod } = await loadModule();
    mod.getBackendClient();
    const remote = (await mod.connectBackendClient(REMOTE.id)) as unknown as {
      emit(event: string, arg: unknown): void;
      hello(result: unknown): void;
    };
    mod.registerBackendHandlers();

    remote.emit('status', 'connecting');
    await vi.waitFor(() => {
      const changed = send.mock.calls.filter(([channel]) => channel === 'connections:changed');
      expect(changed.at(-1)?.[1]).toMatchObject({
        connections: expect.arrayContaining([
          expect.objectContaining({ id: REMOTE.id, status: 'connecting' }),
        ]),
      });
    });

    remote.hello({ server: { version: '6.8.0', buildCommit: 'abc123' } });
    remote.emit('status', 'connected');
    await vi.waitFor(() => {
      const changed = send.mock.calls.filter(([channel]) => channel === 'connections:changed');
      expect(changed.at(-1)?.[1]).toMatchObject({
        connections: expect.arrayContaining([
          expect.objectContaining({
            id: REMOTE.id,
            status: 'connected',
            intentdVersion: '6.8.0',
          }),
        ]),
      });
    });
    // Only the self-fingerprint probe and the reconnect-hello hostname +
    // updateSupported re-captures may hit the wire here — never a
    // fingerprint capture.
    expect(
      rpc.calls.every(
        (method) =>
          method === 'server.pairingInfo' || method === 'host.status' || method === 'system.status',
      ),
    ).toBe(true);
    expect(mockCaptureFingerprint).not.toHaveBeenCalled();

    remote.emit('status', 'disconnected');
    await vi.waitFor(() => {
      const changed = send.mock.calls.filter(([channel]) => channel === 'connections:changed');
      const payload = changed.at(-1)?.[1] as ConnectionsListResult;
      const record = payload.connections.find((connection) => connection.id === REMOTE.id);
      expect(record).toMatchObject({ status: 'disconnected' });
      expect(record).not.toHaveProperty('intentdVersion');
    });
  });

  it('connections:add upserting a NON-active connection does not reconnect', async () => {
    store.add.mockResolvedValue(REMOTE);
    store.getActiveId.mockResolvedValue('local');
    installWindow();
    const { mod, openOrFocus } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:add');

    await handler!(
      {},
      { label: 'Studio Mac', host: '10.0.0.5', port: 8443, fingerprint: 'AA:BB:CC:DD', token: 't' },
    );
    // Not the live backend → no client swap / window changes.
    expect(openOrFocus).not.toHaveBeenCalled();
  });

  it('connections:add re-pairing a LIVE non-active backend rebuilds its client in place', async () => {
    store.add.mockResolvedValue(REMOTE);
    store.getActiveId.mockResolvedValue('local'); // open-only state: remote-1 has windows but is not active
    const send = installWindow('remote-1');
    const { mod, openOrFocus } = await loadModule();
    mod.getBackendClient(); // warm the always-on local pool member
    await mod.connectBackendClient('remote-1'); // the re-paired target serves open windows
    mod.registerBackendHandlers();
    const handler = findHandler('connections:add');
    lifecycle.events = [];

    const params = {
      label: 'Studio Mac',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: 'AA:BB:CC:DD',
      token: 'fresh-token',
    };
    // Not the persisted active id → switched stays false (wire compat), but
    // the live client is still rebuilt so the refreshed token reaches the
    // backend's open windows instead of the stale pooled client.
    await expect(handler!({}, params)).resolves.toEqual({ connection: REMOTE, switched: false });

    expect(lifecycle.events.map((e) => e.type)).toEqual(['dispose', 'construct', 'start']);
    expect(openOrFocus).not.toHaveBeenCalled();
    expect(store.setActiveId).not.toHaveBeenCalled();
    // The replayed reconnect marker reaches the backend's windows so daemon
    // event subscriptions re-subscribe against the new client.
    expect(
      send.mock.calls.some(
        ([c, payload]) =>
          c === 'backend:status' && (payload as { reconnected?: boolean }).reconnected === true,
      ),
    ).toBe(true);
  });

  it('connections:add refreshes an active client without touching windows', async () => {
    store.add.mockResolvedValue(REMOTE);
    store.getActiveId.mockResolvedValue('remote-1');
    const send = installWindow();
    const { mod, openOrFocus } = await loadModule();
    mod.getBackendClient(); // warm the always-on local pool member
    await mod.connectBackendClient('remote-1'); // the active target's pooled client is live
    mod.registerBackendHandlers();
    const handler = findHandler('connections:add');
    lifecycle.events = [];

    const params = {
      label: 'Studio Mac',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: 'AA:BB:CC:DD',
      token: 'fresh-token',
    };
    await expect(handler!({}, params)).resolves.toEqual({ connection: REMOTE, switched: true });

    // Client-only dispose + rebuild so the refreshed token takes effect without
    // destroying local or other-backend windows.
    expect(lifecycle.events.map((e) => e.type)).toEqual(['dispose', 'construct', 'start']);
    const disposed = lifecycle.events.find((e) => e.type === 'dispose')!;
    const constructed = lifecycle.events.find((e) => e.type === 'construct')!;
    expect(disposed.seq).toBeLessThan(constructed.seq);
    expect(openOrFocus).not.toHaveBeenCalled();
    expect(store.setActiveId).not.toHaveBeenCalled();
    expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true);
  });

  it('connections:open keeps the local client and windows while opening the remote', async () => {
    const { mod, openOrFocus } = await loadModule();
    const local = mod.getBackendClient();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:open');

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({
      status: 'opened',
      id: 'remote-1',
    });

    const remote = mod.getBackendClientForConnection('remote-1');
    expect(remote).toBeDefined();
    expect(remote).not.toBe(local);
    expect(mod.getBackendClient()).toBe(local);
    expect(mod.getBackendClientForConnection('local')).toBe(local);
    expect(openOrFocus).toHaveBeenCalledWith('remote-1');
    expect(store.setActiveId).not.toHaveBeenCalled();
  });

  it('connections:open opens the window and retains the client when the remote rejects requests', async () => {
    // An unreachable/rejecting remote must not fail the click silently: the
    // window opens, the pooled client is RETAINED (its reconnect loop keeps
    // retrying), and the renderer's connection-lost overlay owns recovery.
    // Local stays untouched.
    rpc.handler = async (method) => {
      if (method === 'host.status') throw new Error('remote unreachable');
      return {};
    };
    const { mod, openOrFocus } = await loadModule();
    const local = mod.getBackendClient();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:open');

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({
      status: 'opened',
      id: 'remote-1',
    });

    expect(mod.getBackendClient()).toBe(local);
    expect(mod.getBackendClientForConnection('local')).toBe(local);
    expect(mod.getBackendClientForConnection('remote-1')).toBeDefined();
    expect(lifecycle.events.filter((e) => e.type === 'dispose')).toEqual([]);
    expect(openOrFocus).toHaveBeenCalledWith('remote-1');
    expect(store.setActiveId).not.toHaveBeenCalled();
  });

  it('connections:open opens the window on an auth/cert failure and replays the latched event', async () => {
    // A cert-mismatch/auth-rejected remote also opens the window: the
    // transport raises the typed error on the retained client, whose latched
    // failure event is replayed to the new window via connections:list — the
    // trust modal / re-pair overlay surfaces there instead of a failed click.
    const { AuthRejectedError } = await import('../backend-connection');
    rpc.handler = async (method) => {
      if (method === 'host.status') throw new AuthRejectedError(401);
      return {};
    };
    const { mod, openOrFocus } = await loadModule();
    mod.registerBackendHandlers();
    const open = findHandler('connections:open');

    await expect(open!({}, { id: 'remote-1' })).resolves.toEqual({
      status: 'opened',
      id: 'remote-1',
    });
    expect(openOrFocus).toHaveBeenCalledWith('remote-1');

    // The retained client's transport raises the same rejection on its
    // reconnect attempts; the window created by the open learns it from the
    // sticky replay on its initial list fetch.
    const client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };
    client.emit('error', new AuthRejectedError(401));
    const { remoteSender } = installBackendWindows();
    const list = findHandler('connections:list');
    await expect(list!({ sender: remoteSender }, undefined)).resolves.toMatchObject({
      authRejected: { id: 'remote-1', host: '10.0.0.5', port: 8443, statusCode: 401 },
    });
  });

  it('returns token-free open guidance and connects after write-only secret recovery', async () => {
    let secretReplaced = false;
    store.getDecryptedToken.mockImplementation(async () => {
      if (!secretReplaced) throw new Error('raw decrypt failure with secret-material');
      return 'replacement';
    });
    store.replaceSecret.mockImplementation(async () => {
      secretReplaced = true;
      return REMOTE;
    });
    mockCaptureFingerprint.mockResolvedValue({
      ok: true,
      fingerprint: REMOTE.fingerprint,
      connected: true,
      tokenValid: true,
    });
    const { mod, openOrFocus } = await loadModule();
    mod.registerBackendHandlers();
    const open = findHandler('connections:open');
    const rotate = findHandler('connections:rotate-secret');

    const blocked = await open!({}, { id: REMOTE.id });

    expect(blocked).toEqual({ status: 'secret-unavailable' });
    expect(JSON.stringify(blocked)).not.toContain('decrypt');
    expect(JSON.stringify(blocked)).not.toContain('secret-material');
    expect(openOrFocus).not.toHaveBeenCalled();

    await expect(rotate!({}, { id: REMOTE.id, token: 'replacement' })).resolves.toMatchObject({
      status: 'updated',
    });
    await expect(open!({}, { id: REMOTE.id })).resolves.toEqual({
      status: 'opened',
      id: REMOTE.id,
    });
    expect(openOrFocus).toHaveBeenCalledWith(REMOTE.id);
  });

  it('connections:forget closes and disconnects only that secondary backend', async () => {
    store.getActiveId.mockResolvedValue('local');
    store.forget.mockResolvedValue(undefined);
    const send = installWindow();
    const { mod, ensureLocalWindowBeforeClose, closeForBackend } = await loadModule();
    const local = mod.getBackendClient();
    const remote = await mod.connectBackendClient('remote-1');
    mod.registerBackendHandlers();
    const handler = findHandler('connections:forget');

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({ id: 'remote-1' });
    expect(store.forget).toHaveBeenCalledWith('remote-1');
    expect(ensureLocalWindowBeforeClose).toHaveBeenCalledWith('remote-1');
    expect(closeForBackend).toHaveBeenCalledWith('remote-1');
    expect(ensureLocalWindowBeforeClose.mock.invocationCallOrder[0]).toBeLessThan(
      closeForBackend.mock.invocationCallOrder[0],
    );
    expect(mod.getBackendClient()).toBe(local);
    expect(mod.getBackendClientForConnection('remote-1')).toBeUndefined();
    expect(lifecycle.events.filter((event) => event.type === 'dispose')).toEqual([
      expect.objectContaining({ seq: expect.any(Number) }),
    ]);
    expect(remote).not.toBe(local);
    expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true);
  });

  it('connections:forget of a connection with an open window disposes only its pooled client', async () => {
    store.getActiveId.mockResolvedValue('local');
    store.forget.mockResolvedValue(undefined);
    installWindow();
    const { mod, ensureLocalWindowBeforeClose, closeForBackend } = await loadModule();
    const local = mod.getBackendClient(); // the always-on local pool member
    await mod.openBackendWindow('remote-1');
    lifecycle.events = [];
    mod.registerBackendHandlers();
    const handler = findHandler('connections:forget');

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({ id: 'remote-1' });
    expect(store.forget).toHaveBeenCalledWith('remote-1');
    expect(ensureLocalWindowBeforeClose).toHaveBeenCalledWith('remote-1');
    expect(closeForBackend).toHaveBeenCalledWith('remote-1');
    expect(ensureLocalWindowBeforeClose.mock.invocationCallOrder[0]).toBeLessThan(
      closeForBackend.mock.invocationCallOrder[0],
    );
    expect(mod.getBackendClientForConnection('remote-1')).toBeUndefined();
    // The local pool member survives untouched — no retarget/rebuild needed.
    expect(mod.getBackendClientForConnection('local')).toBe(local);
    expect(lifecycle.events.map((event) => event.type)).toEqual(['dispose']);
  });

  it('rejects invalid params (missing token on capture) via the Zod schema', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:capture-fingerprint');

    await expect(handler!({}, { host: '10.0.0.5', port: 8443 })).rejects.toThrow();
    expect(mockCaptureFingerprint).not.toHaveBeenCalled();
  });

  it('rejects invalid params (non-boolean syncExcluded on add) via the Zod schema', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:add');

    const params = {
      label: 'Studio Mac',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: 'AA:BB:CC:DD',
      token: 'secret-token',
      syncExcluded: 'yes',
    };
    await expect(handler!({}, params)).rejects.toThrow();
    expect(store.add).not.toHaveBeenCalled();
  });

  it('rejects invalid params (missing id on open) via the Zod schema', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:open');

    await expect(handler!({}, {})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Keychain-sync settings IPC (T4)
// ---------------------------------------------------------------------------

describe('keychain-sync settings IPC (T4)', () => {
  const onMac = process.platform === 'darwin';

  it('connections:sync-get-state returns supported + pref + lifecycle status', async () => {
    keychainSync.enabled = true;
    keychainSync.status = { state: 'active' };
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:sync-get-state');
    expect(handler).toBeDefined();

    await expect(handler!({}, undefined)).resolves.toEqual({
      supported: onMac,
      enabled: true,
      status: { state: 'active' },
    });
  });

  it('connections:sync-get-state reports null status before the first reconcile', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:sync-get-state');

    await expect(handler!({}, undefined)).resolves.toEqual({
      supported: onMac,
      enabled: false,
      status: null,
    });
  });

  it('connections:sync-set-enabled persists the pref and requests a reconcile on enable', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:sync-set-enabled');
    expect(handler).toBeDefined();

    keychainSync.enabled = true; // what isKeychainSyncEnabled reads back after the write
    await expect(handler!({}, { enabled: true })).resolves.toEqual({
      supported: onMac,
      enabled: true,
      status: null,
    });
    expect(localPrefs.setLocalPref).toHaveBeenCalledWith('keychainSyncEnabled', true);
    expect(keychainSync.requestReconcile).toHaveBeenCalledTimes(1);
  });

  it('connections:sync-set-enabled(false) persists without requesting a reconcile', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:sync-set-enabled');

    await expect(handler!({}, { enabled: false })).resolves.toEqual({
      supported: onMac,
      enabled: false,
      status: null,
    });
    expect(localPrefs.setLocalPref).toHaveBeenCalledWith('keychainSyncEnabled', false);
    expect(keychainSync.requestReconcile).not.toHaveBeenCalled();
    expect(keychainSync.resetStatus).not.toHaveBeenCalled();
  });

  it('connections:sync-set-enabled(true) clears the stale pre-disable status (PR #1715 review)', async () => {
    // A verdict left over from before the last disable must not leak into the
    // re-enable response — the UI should fall back to "checking" (status null)
    // until the fresh reconcile lands.
    keychainSync.status = { state: 'unavailable', reason: 'unavailable', message: 'locked' };
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:sync-set-enabled');

    keychainSync.enabled = true;
    await expect(handler!({}, { enabled: true })).resolves.toEqual({
      supported: onMac,
      enabled: true,
      status: null,
    });
    expect(keychainSync.resetStatus).toHaveBeenCalledTimes(1);
    expect(keychainSync.requestReconcile).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid params (non-boolean enabled) via the Zod schema', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:sync-set-enabled');

    await expect(handler!({}, { enabled: 'yes' })).rejects.toThrow();
    expect(localPrefs.setLocalPref).not.toHaveBeenCalled();
  });

  it('broadcasts connections:sync-status-changed to every window on a status change', async () => {
    const send = installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const status = { state: 'unavailable', reason: 'unavailable', message: 'locked' };
    keychainSync.initOptions?.onStatusChanged?.(status);
    expect(send).toHaveBeenCalledWith('connections:sync-status-changed', status);
  });
});

// ---------------------------------------------------------------------------
// Self-publish IPC (publish THIS machine's backend to the synced registry)
// ---------------------------------------------------------------------------

describe('self-publish IPC', () => {
  const PAIRING_INFO = {
    token: 'a'.repeat(64),
    certFingerprint: '11:22:33:44',
    port: 5181,
    path: '/ws',
    localIps: ['192.168.1.10', '10.0.0.5'],
    hostname: 'my-mac.local',
    prettyHostname: "Clement's Mac Studio",
    deviceKind: 'macStudio',
  };
  const SELF_RECORD = {
    id: 'self-1',
    label: "Clement's Mac Studio",
    host: '192.168.1.10',
    port: 5181,
    fingerprint: '11:22:33:44',
    isLocal: false,
  };

  function installPairingInfo(overrides: Partial<typeof PAIRING_INFO> | null = {}) {
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        if (overrides === null) throw new Error('server.* methods are local-only');
        return { ...PAIRING_INFO, ...overrides };
      }
      return {};
    };
  }

  it('connections:publish-self builds the record from pairingInfo and upserts it (token stays in main)', async () => {
    installPairingInfo();
    store.add.mockResolvedValue(SELF_RECORD);
    const send = installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:publish-self')!;

    const result = (await handler({}, undefined)) as { connection: { id: string } };

    // Record per spec Mechanics: label = hostname (pretty preferred), host =
    // first local IP, port = bound wsApi port, fingerprint + token from
    // pairingInfo, detectHosts on. The token goes to the store only. Publishing
    // is explicit user intent to sync, so the exclusion flag is force-cleared.
    expect(store.add).toHaveBeenCalledWith({
      label: "Clement's Mac Studio",
      host: '192.168.1.10',
      port: 5181,
      fingerprint: '11:22:33:44',
      token: 'a'.repeat(64),
      detectedDeviceKind: 'macStudio',
      detectHosts: true,
      syncExcluded: false,
    });
    // All local IPs persist as candidate hosts; the hostname persists too.
    expect(store.setHosts).toHaveBeenCalledWith('self-1', ['192.168.1.10', '10.0.0.5']);
    expect(store.setHostname).toHaveBeenCalledWith('self-1', "Clement's Mac Studio");
    expect(store.add).toHaveBeenCalledWith(
      expect.objectContaining({ detectedDeviceKind: 'macStudio' }),
    );
    expect(store.setDetectedDeviceKind).toHaveBeenCalledWith('local', 'macStudio');
    // Self fingerprint persisted (normalized) + suppression marker cleared.
    expect(localPrefs.values.get('selfBackendFingerprint')).toBe('11:22:33:44');
    expect(localPrefs.values.has('selfPublishSuppressed')).toBe(false);
    // Returned record is token-free (the store's shape) and the list rebroadcast.
    expect(result.connection.id).toBe('self-1');
    expect(result.connection).not.toHaveProperty('token');
    expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true);
  });

  it('connections:publish-self rejects override-only device kinds from pairingInfo', async () => {
    installPairingInfo({ deviceKind: 'robot' });
    store.add.mockResolvedValue(SELF_RECORD);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:publish-self')!({}, undefined);

    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ detectedDeviceKind: null }));
    expect(store.setDetectedDeviceKind).toHaveBeenCalledWith('local', null);
  });

  it('connections:publish-self sets hosts even for a single IP (stale extras must converge)', async () => {
    installPairingInfo({ localIps: ['192.168.1.10'] });
    store.add.mockResolvedValue(SELF_RECORD);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:publish-self')!({}, undefined);
    // add() preserves old extras minus only the new primary, so skipping
    // setHosts here would keep syncing an address whose interface is gone.
    expect(store.setHosts).toHaveBeenCalledWith('self-1', ['192.168.1.10']);
  });

  it('connections:publish-self filters loopback entries out of the published hosts', async () => {
    // Loopback is only reachable from THIS machine — publishing it hands
    // other devices a candidate that dials their own local daemon.
    installPairingInfo({
      localIps: ['127.0.0.1', '192.168.1.10', '::1', 'localhost', '10.0.0.5'],
    });
    store.add.mockResolvedValue(SELF_RECORD);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:publish-self')!({}, undefined);
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ host: '192.168.1.10' }));
    expect(store.setHosts).toHaveBeenCalledWith('self-1', ['192.168.1.10', '10.0.0.5']);
  });

  it('connections:publish-self rejects when every local IP is loopback and no tunnel exists', async () => {
    installPairingInfo({ localIps: ['127.0.0.1', '::1'] });
    store.add.mockResolvedValue(SELF_RECORD);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:publish-self')!({}, undefined)).rejects.toThrow(
      /no routable local IP or tunnel address/,
    );
    expect(store.add).not.toHaveBeenCalled();
  });

  it('connections:publish-self publishes in tunnel-only posture (loopback bind + tcAddress)', async () => {
    // Tunnel-only: the daemon binds loopback only, so localIps filters to
    // empty — the dialable tc address stands in as the record's host.
    installPairingInfo({ localIps: ['127.0.0.1', '::1'], tcAddress: TC_ADDRESS });
    store.add.mockResolvedValue({ ...SELF_RECORD, host: TC_ADDRESS });
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:publish-self')!({}, undefined);
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ host: TC_ADDRESS }));
    // No routable IPs to persist as extras; the tc address rides its own field.
    expect(store.setHosts).toHaveBeenCalledWith('self-1', []);
    expect(store.setTcAddress).toHaveBeenCalledWith('self-1', TC_ADDRESS);
  });

  it('connections:publish-self persists the pairingInfo tcAddress on the self record', async () => {
    installPairingInfo({ tcAddress: TC_ADDRESS });
    store.add.mockResolvedValue(SELF_RECORD);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:publish-self')!({}, undefined);
    expect(store.setTcAddress).toHaveBeenCalledWith('self-1', TC_ADDRESS);
  });

  it('connections:publish-self clears the tcAddress when pairingInfo omits it (tunnel down)', async () => {
    installPairingInfo();
    store.add.mockResolvedValue(SELF_RECORD);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:publish-self')!({}, undefined);
    // pairingInfo omits the field whenever the tunnel is not running — a
    // conclusive clear so a stale address never keeps syncing.
    expect(store.setTcAddress).toHaveBeenCalledWith('self-1', null);
  });

  it('connections:publish-self re-publish clears the "do not auto-publish" marker', async () => {
    installPairingInfo();
    store.add.mockResolvedValue(SELF_RECORD);
    localPrefs.values.set('selfPublishSuppressed', true);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:publish-self')!({}, undefined);
    expect(localPrefs.values.has('selfPublishSuppressed')).toBe(false);
  });

  it('connections:publish-self rejects when the WebSocket API is off (port null)', async () => {
    installPairingInfo({ port: null as never });
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:publish-self')!({}, undefined)).rejects.toThrow(
      /WebSocket API is not enabled/i,
    );
    expect(store.add).not.toHaveBeenCalled();
    expect(localPrefs.values.has('selfBackendFingerprint')).toBe(false);
  });

  it('connections:publish-self rejects on a malformed pairingInfo result', async () => {
    installPairingInfo({ token: '' });
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:publish-self')!({}, undefined)).rejects.toThrow(
      /malformed server\.pairingInfo/i,
    );
    expect(store.add).not.toHaveBeenCalled();
  });

  it('connections:publish-self works while a remote backend is open (pooled local client)', async () => {
    installPairingInfo();
    store.add.mockResolvedValue(SELF_RECORD);
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1'); // remote window open; local member persists
    mod.registerBackendHandlers();

    const result = (await findHandler('connections:publish-self')!({}, undefined)) as {
      connection: { id: string };
    };
    expect(result.connection.id).toBe('self-1');
    expect(store.add).toHaveBeenCalled();
  });

  it('connections:self-published-state matches a record by the live fingerprint', async () => {
    installPairingInfo();
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:self-published-state')!({}, undefined)).resolves.toEqual({
      published: true,
      suppressed: false,
      selfConnectionId: 'remote-1',
    });
  });

  it('connections:self-published-state matches by the persisted fingerprint when the probe fails', async () => {
    installPairingInfo(null); // local daemon rejects/unreachable → fail-soft
    localPrefs.values.set('selfBackendFingerprint', '11:22:33:44');
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:self-published-state')!({}, undefined)).resolves.toEqual({
      published: true,
      suppressed: false,
      selfConnectionId: 'remote-1',
    });
  });

  it('connections:self-published-state reports unpublished + the suppression marker', async () => {
    installPairingInfo();
    localPrefs.values.set('selfPublishSuppressed', true);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    // No stored record carries the self fingerprint → not published.
    await expect(findHandler('connections:self-published-state')!({}, undefined)).resolves.toEqual({
      published: false,
      suppressed: true,
      selfConnectionId: null,
    });
  });

  it('connections:forget of the self entry sets the "do not auto-publish" marker', async () => {
    store.forget.mockResolvedValue(undefined);
    localPrefs.values.set('selfBackendFingerprint', '11:22:33:44');
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:forget')!({}, { id: 'remote-1' });
    expect(localPrefs.values.get('selfPublishSuppressed')).toBe(true);
  });

  it('connections:forget of an unrelated remote leaves the marker untouched', async () => {
    store.forget.mockResolvedValue(undefined);
    localPrefs.values.set('selfBackendFingerprint', '99:88:77:66');
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:forget')!({}, { id: 'remote-1' });
    expect(localPrefs.values.has('selfPublishSuppressed')).toBe(false);
  });

  it('a FAILED forget of the self entry does not latch the marker (still refreshable)', async () => {
    store.forget.mockRejectedValue(new Error('store write failure'));
    localPrefs.values.set('selfBackendFingerprint', '11:22:33:44');
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:forget')!({}, { id: 'remote-1' })).rejects.toThrow(
      /store write failure/,
    );
    // Suppression only after a successful forget: latching it while the entry
    // stays published would permanently disable refresh-self with no way out.
    expect(localPrefs.values.has('selfPublishSuppressed')).toBe(false);
  });

  it('connections:unpublish-self removes the self entry WITHOUT latching the marker', async () => {
    store.forget.mockResolvedValue(undefined);
    localPrefs.values.set('selfBackendFingerprint', '11:22:33:44');
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:unpublish-self')!({}, undefined)).resolves.toEqual({
      removed: true,
    });
    expect(store.forget).toHaveBeenCalledWith('remote-1');
    // Unlike forgetting the self entry, unpublish never suppresses
    // auto-publish offers.
    expect(localPrefs.values.has('selfPublishSuppressed')).toBe(false);
  });

  it('connections:unpublish-self is a no-op { removed: false } while unpublished', async () => {
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    // No stored record carries the (absent) self fingerprint.
    await expect(findHandler('connections:unpublish-self')!({}, undefined)).resolves.toEqual({
      removed: false,
    });
    expect(store.forget).not.toHaveBeenCalled();
    expect(localPrefs.values.has('selfPublishSuppressed')).toBe(false);
  });

  it('a FAILED unpublish-self store forget propagates and latches nothing', async () => {
    store.forget.mockRejectedValue(new Error('store write failure'));
    localPrefs.values.set('selfBackendFingerprint', '11:22:33:44');
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:unpublish-self')!({}, undefined)).rejects.toThrow(
      /store write failure/,
    );
    expect(localPrefs.values.has('selfPublishSuppressed')).toBe(false);
  });

  it('connections:unpublish-self falls back to the LIVE fingerprint (parity with self-published-state)', async () => {
    // No persisted self fingerprint — only the live server.pairingInfo probe
    // identifies the record, exactly like the self-published-state lookup that
    // told the UI "published" in the first place (PR #1781 review).
    installPairingInfo();
    store.forget.mockResolvedValue(undefined);
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:unpublish-self')!({}, undefined)).resolves.toEqual({
      removed: true,
    });
    expect(store.forget).toHaveBeenCalledWith('remote-1');
    expect(localPrefs.values.has('selfPublishSuppressed')).toBe(false);
  });

  it('connections:publish-self is serialized behind a queued unpublish (rapid off→on)', async () => {
    // Rapid WSS off→on: the publish upsert must not land while the unpublish
    // critical section is still running/queued — it would be deleted right
    // after (PR #1781 review). Hold the unpublish open on its store.list read.
    installPairingInfo();
    store.forget.mockResolvedValue(undefined);
    store.add.mockResolvedValue(SELF_RECORD);
    localPrefs.values.set('selfBackendFingerprint', '11:22:33:44');
    let releaseList: (records: unknown[]) => void;
    const gatedList = new Promise<unknown[]>((resolve) => {
      releaseList = resolve;
    });
    store.list.mockImplementationOnce(() => gatedList);
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const unpublishPromise = findHandler('connections:unpublish-self')!({}, undefined);
    const publishPromise = findHandler('connections:publish-self')!({}, undefined);
    await new Promise((resolve) => setImmediate(resolve));
    // The publish is enqueued behind the still-open unpublish: no upsert yet.
    expect(store.add).not.toHaveBeenCalled();

    releaseList!([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    await expect(unpublishPromise).resolves.toEqual({ removed: true });
    await publishPromise;
    // Removal strictly precedes the fresh upsert.
    expect(store.forget.mock.invocationCallOrder[0]).toBeLessThan(
      store.add.mock.invocationCallOrder[0],
    );
  });
});

// ---------------------------------------------------------------------------
// Self-entry refresh IPC (token rotation / WSS port change freshness)
// ---------------------------------------------------------------------------

describe('self-entry refresh IPC', () => {
  const PAIRING_INFO = {
    token: 'a'.repeat(64),
    certFingerprint: '11:22:33:44',
    port: 5181,
    path: '/ws',
    localIps: ['192.168.1.10', '10.0.0.5'],
    hostname: 'my-mac.local',
    prettyHostname: "Clement's Mac Studio",
  };
  const SELF_RECORD = {
    id: 'self-1',
    label: "Clement's Mac Studio",
    host: '192.168.1.10',
    port: 5181,
    fingerprint: '11:22:33:44',
    isLocal: false,
  };

  function installPairingInfo(overrides: Partial<typeof PAIRING_INFO> | null = {}) {
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        if (overrides === null) throw new Error('server.* methods are local-only');
        return { ...PAIRING_INFO, ...overrides };
      }
      return {};
    };
  }

  it('re-upserts the published entry from live pairingInfo (token rotation freshness)', async () => {
    // Published: a stored record carries the self fingerprint.
    installPairingInfo({ token: 'b'.repeat(64) });
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, id: 'self-1', fingerprint: '11:22:33:44' }]);
    store.add.mockResolvedValue(SELF_RECORD);
    const send = installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const result = await findHandler('connections:refresh-self')!({}, undefined);

    // The rotated token reaches the store; the fingerprint dedupe collapses
    // the upsert into the existing record with a fresh updatedAt.
    expect(result).toEqual({ refreshed: true });
    expect(store.add).toHaveBeenCalledWith({
      label: "Clement's Mac Studio",
      host: '192.168.1.10',
      port: 5181,
      fingerprint: '11:22:33:44',
      token: 'b'.repeat(64),
      detectedDeviceKind: null,
      detectHosts: true,
    });
    // Regression (PR #1762 review): the refresh upsert must NOT carry a
    // syncExcluded value — the store preserves the survivor's flag when it is
    // absent, so a refresh can never flip a user's explicit per-backend
    // exclusion back to synced. Publish (explicit intent) passes false instead.
    expect(store.add).toHaveBeenCalledWith(
      expect.not.objectContaining({ syncExcluded: expect.anything() }),
    );
    expect(store.setHosts).toHaveBeenCalledWith('self-1', ['192.168.1.10', '10.0.0.5']);
    expect(store.setHostname).toHaveBeenCalledWith('self-1', "Clement's Mac Studio");
    // A refresh never touches the suppression marker.
    expect(localPrefs.values.has('selfPublishSuppressed')).toBe(false);
    expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true);
  });

  it('refresh-self propagates a rotated tcAddress (and clears an omitted one)', async () => {
    installPairingInfo({ tcAddress: 'tc9d0c22.tailcat.net' });
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, id: 'self-1', fingerprint: '11:22:33:44' }]);
    store.add.mockResolvedValue(SELF_RECORD);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:refresh-self')!({}, undefined);
    expect(store.setTcAddress).toHaveBeenCalledWith('self-1', 'tc9d0c22.tailcat.net');

    // A later refresh without the field (tunnel disabled) conclusively clears.
    store.setTcAddress.mockClear();
    installPairingInfo();
    await findHandler('connections:refresh-self')!({}, undefined);
    expect(store.setTcAddress).toHaveBeenCalledWith('self-1', null);
  });

  it('re-upserts under the new port/host after a WSS port change', async () => {
    installPairingInfo({ port: 6200, localIps: ['192.168.1.99'] });
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, id: 'self-1', fingerprint: '11:22:33:44' }]);
    store.add.mockResolvedValue({ ...SELF_RECORD, host: '192.168.1.99', port: 6200 });
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const result = await findHandler('connections:refresh-self')!({}, undefined);

    expect(result).toEqual({ refreshed: true });
    expect(store.add).toHaveBeenCalledWith(
      expect.objectContaining({ host: '192.168.1.99', port: 6200, fingerprint: '11:22:33:44' }),
    );
  });

  it('refreshes in tunnel-only posture (loopback bind + tcAddress, no routable IP)', async () => {
    // Tunnel-only: localIps filters to empty but the tunnel is dialable —
    // the refresh must keep the entry fresh instead of no-opping, or the
    // record goes stale on the user's other devices.
    installPairingInfo({ localIps: ['127.0.0.1', '::1'], tcAddress: TC_ADDRESS });
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, id: 'self-1', fingerprint: '11:22:33:44' }]);
    store.add.mockResolvedValue({ ...SELF_RECORD, host: TC_ADDRESS });
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const result = await findHandler('connections:refresh-self')!({}, undefined);

    expect(result).toEqual({ refreshed: true });
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ host: TC_ADDRESS }));
    expect(store.setTcAddress).toHaveBeenCalledWith('self-1', TC_ADDRESS);
  });

  it('stays a no-op when neither a routable IP nor a tcAddress exists', async () => {
    installPairingInfo({ localIps: ['127.0.0.1'] });
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, id: 'self-1', fingerprint: '11:22:33:44' }]);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const result = await findHandler('connections:refresh-self')!({}, undefined);

    expect(result).toEqual({ refreshed: false });
    expect(store.add).not.toHaveBeenCalled();
  });

  it('matches the published entry by the persisted fingerprint after a cert change', async () => {
    // The live fingerprint differs from the stored record's, but the persisted
    // self fingerprint still matches → refresh proceeds.
    installPairingInfo({ certFingerprint: 'FF:EE:DD:CC' });
    localPrefs.values.set('selfBackendFingerprint', '11:22:33:44');
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, id: 'self-1', fingerprint: '11:22:33:44' }]);
    store.add.mockResolvedValue({ ...SELF_RECORD, fingerprint: 'FF:EE:DD:CC' });
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const result = await findHandler('connections:refresh-self')!({}, undefined);

    expect(result).toEqual({ refreshed: true });
    // The persisted self fingerprint follows the live one.
    expect(localPrefs.values.get('selfBackendFingerprint')).toBe('FF:EE:DD:CC');
  });

  it('is a strict no-op while the "do not auto-publish" marker is set', async () => {
    installPairingInfo();
    localPrefs.values.set('selfPublishSuppressed', true);
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const result = await findHandler('connections:refresh-self')!({}, undefined);

    expect(result).toEqual({ refreshed: false });
    expect(rpc.calls).toHaveLength(0); // never even probes pairingInfo
    expect(store.add).not.toHaveBeenCalled();
    // The marker stays set — refresh never clears it.
    expect(localPrefs.values.get('selfPublishSuppressed')).toBe(true);
  });

  it('is a no-op when no published self entry exists', async () => {
    installPairingInfo();
    store.list.mockResolvedValue([LOCAL, REMOTE]); // no self-fingerprint record
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const result = await findHandler('connections:refresh-self')!({}, undefined);

    expect(result).toEqual({ refreshed: false });
    expect(store.add).not.toHaveBeenCalled();
  });

  it('is a fail-soft no-op when the pairing info is unavailable (probe fails)', async () => {
    installPairingInfo(null);
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const result = await findHandler('connections:refresh-self')!({}, undefined);

    expect(result).toEqual({ refreshed: false });
    expect(store.add).not.toHaveBeenCalled();
  });

  it('is a no-op when the WSS listener is down (port null)', async () => {
    installPairingInfo({ port: null as never });
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    const result = await findHandler('connections:refresh-self')!({}, undefined);

    expect(result).toEqual({ refreshed: false });
    expect(store.add).not.toHaveBeenCalled();
  });

  it('refreshes via the pooled local client even while a remote backend is open', async () => {
    installPairingInfo();
    store.add.mockResolvedValue(SELF_RECORD);
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1'); // remote window open; local member persists
    mod.registerBackendHandlers();

    const result = await findHandler('connections:refresh-self')!({}, undefined);

    expect(result).toEqual({ refreshed: true });
    expect(store.add).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Hide the self entry from the owning machine's connections list: the record
// stays in the store (keychain sync pushes it to OTHER devices) but never
// renders on the machine it describes — connecting to yourself is meaningless.
// ---------------------------------------------------------------------------

describe('connections:list hides the self entry on the owning machine', () => {
  const SELF_ENTRY = {
    id: 'self-1',
    label: "Clement's Mac Studio",
    host: '192.168.1.10',
    port: 5181,
    fingerprint: '11:22:33:44',
    isLocal: false,
  };
  // Full PROTOCOL §5 pairingInfo shape for the live-probe answer (localIps is
  // always an array, path is always "/ws").
  const LIVE_PAIRING_INFO = {
    token: 'a'.repeat(64),
    certFingerprint: '11:22:33:44',
    port: 5181,
    path: '/ws',
    localIps: ['192.168.1.10'],
    hostname: 'my-mac.local',
    prettyHostname: "Clement's Mac Studio",
  };

  it('filters the record whose fingerprint matches the persisted self fingerprint', async () => {
    localPrefs.values.set('selfBackendFingerprint', '11:22:33:44');
    store.list.mockResolvedValue([LOCAL, REMOTE, SELF_ENTRY]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:list')!({}, undefined)).resolves.toMatchObject({
      connections: [LOCAL, REMOTE],
    });
  });

  it('matches the fingerprint case-insensitively (store dedupe normalization)', async () => {
    localPrefs.values.set('selfBackendFingerprint', '11:22:33:44');
    store.list.mockResolvedValue([
      LOCAL,
      { ...SELF_ENTRY, fingerprint: '11:22:33:44'.toLowerCase() },
    ]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:list')!({}, undefined)).resolves.toMatchObject({
      connections: [LOCAL],
    });
  });

  it('hides nothing when no self fingerprint was ever persisted', async () => {
    store.list.mockResolvedValue([LOCAL, REMOTE, SELF_ENTRY]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:list')!({}, undefined)).resolves.toMatchObject({
      connections: [LOCAL, REMOTE, SELF_ENTRY],
    });
  });

  it('filters the connections:changed broadcast payload too', async () => {
    localPrefs.values.set('selfBackendFingerprint', '11:22:33:44');
    store.add.mockResolvedValue(REMOTE);
    store.list.mockResolvedValue([LOCAL, REMOTE, SELF_ENTRY]);
    const send = installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:add')!(
      {},
      { label: 'Studio Mac', host: '10.0.0.5', port: 8443, fingerprint: 'AA:BB:CC:DD', token: 't' },
    );
    const changed = send.mock.calls.find(([c]) => c === 'connections:changed');
    expect(changed?.[1]).toMatchObject({ connections: [LOCAL, REMOTE] });
  });

  it('is presentation-only: self-published-state still reports published while the list hides it', async () => {
    localPrefs.values.set('selfBackendFingerprint', '11:22:33:44');
    store.list.mockResolvedValue([LOCAL, SELF_ENTRY]);
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') throw new Error('probe down');
      return {};
    };
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:list')!({}, undefined)).resolves.toMatchObject({
      connections: [LOCAL],
    });
    await expect(findHandler('connections:self-published-state')!({}, undefined)).resolves.toEqual({
      published: true,
      suppressed: false,
      selfConnectionId: 'self-1',
    });
  });

  it('filters a record matching the LIVE daemon fingerprint (nothing persisted)', async () => {
    // Never published from this machine, but the record synced in from
    // another device and matches the live local daemon's cert. The probe is
    // not awaited by the list itself — it hides on the next list once cached.
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        return LIVE_PAIRING_INFO;
      }
      return {};
    };
    store.list.mockResolvedValue([LOCAL, REMOTE, SELF_ENTRY]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const list = findHandler('connections:list')!;

    await list({}, undefined); // kicks off the probe
    await vi.waitFor(async () => {
      await expect(list({}, undefined)).resolves.toMatchObject({
        connections: [LOCAL, REMOTE],
      });
    });
  });

  it('matches the live fingerprint case-insensitively', async () => {
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        return { ...LIVE_PAIRING_INFO, certFingerprint: '11:22:33:44'.toLowerCase() };
      }
      return {};
    };
    store.list.mockResolvedValue([LOCAL, SELF_ENTRY]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const list = findHandler('connections:list')!;

    await list({}, undefined);
    await vi.waitFor(async () => {
      await expect(list({}, undefined)).resolves.toMatchObject({
        connections: [LOCAL],
      });
    });
  });

  it('re-broadcasts the list to renderers once the live probe resolves', async () => {
    const send = installWindow();
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        return LIVE_PAIRING_INFO;
      }
      return {};
    };
    store.list.mockResolvedValue([LOCAL, SELF_ENTRY]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    // The first list cannot hide the live match yet (probe in flight)…
    await expect(findHandler('connections:list')!({}, undefined)).resolves.toMatchObject({
      connections: [LOCAL, SELF_ENTRY],
    });
    // …but the probe's resolution pushes a corrected list to every window.
    await vi.waitFor(() => {
      const changed = send.mock.calls.filter(([channel]) => channel === 'connections:changed');
      expect(changed.length).toBeGreaterThan(0);
      expect(changed.at(-1)?.[1]).toMatchObject({ connections: [LOCAL] });
    });
  });

  it('does not re-broadcast when the live fingerprint hides nothing (common case)', async () => {
    const send = installWindow();
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        // Resolves fine, but no stored record matches this fingerprint.
        return { ...LIVE_PAIRING_INFO, certFingerprint: 'FF:EE:DD:CC' };
      }
      return {};
    };
    store.list.mockResolvedValue([LOCAL, REMOTE]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const list = findHandler('connections:list')!;

    await list({}, undefined); // kicks off the probe
    // Wait for the probe's broadcast gate to run its store read (the list
    // itself did one), then give a would-be broadcast a macrotask to land.
    await vi.waitFor(() => expect(store.list.mock.calls.length).toBeGreaterThanOrEqual(2));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The fingerprint was cached (no re-probe)…
    await list({}, undefined);
    expect(rpc.calls.filter((m) => m === 'server.pairingInfo')).toHaveLength(1);
    // …without a redundant connections:changed push (the list is unchanged).
    expect(send.mock.calls.filter(([channel]) => channel === 'connections:changed')).toHaveLength(
      0,
    );
  });

  it('combines the persisted and live fingerprints (both records hide)', async () => {
    // A stale persisted key (pre-cert-rotation entry) and the live cert each
    // match a different stored record — both must hide.
    localPrefs.values.set('selfBackendFingerprint', '99:88:77:66');
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        return LIVE_PAIRING_INFO;
      }
      return {};
    };
    const SELF_OLD = { ...SELF_ENTRY, id: 'self-old', fingerprint: '99:88:77:66' };
    store.list.mockResolvedValue([LOCAL, REMOTE, SELF_ENTRY, SELF_OLD]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const list = findHandler('connections:list')!;

    // The stored key hides self-old immediately; the live match follows.
    await expect(list({}, undefined)).resolves.toMatchObject({
      connections: [LOCAL, REMOTE, SELF_ENTRY],
    });
    await vi.waitFor(async () => {
      await expect(list({}, undefined)).resolves.toMatchObject({
        connections: [LOCAL, REMOTE],
      });
    });
  });

  it('hides nothing when the probe fails and no fingerprint was persisted (fail-soft)', async () => {
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') throw new Error('probe down');
      return {};
    };
    store.list.mockResolvedValue([LOCAL, REMOTE, SELF_ENTRY]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const list = findHandler('connections:list')!;

    await list({}, undefined);
    await vi.waitFor(() => expect(rpc.calls).toContain('server.pairingInfo'));
    await expect(list({}, undefined)).resolves.toMatchObject({
      connections: [LOCAL, REMOTE, SELF_ENTRY],
    });
  });

  it('caches a successful live probe for the session (one pairingInfo call across lists)', async () => {
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        return LIVE_PAIRING_INFO;
      }
      return {};
    };
    store.list.mockResolvedValue([LOCAL, SELF_ENTRY]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const list = findHandler('connections:list')!;

    await list({}, undefined);
    await vi.waitFor(async () => {
      await expect(list({}, undefined)).resolves.toMatchObject({ connections: [LOCAL] });
    });
    await list({}, undefined);
    await findHandler('connections:self-published-state')!({}, undefined);

    expect(rpc.calls.filter((m) => m === 'server.pairingInfo')).toHaveLength(1);
  });

  it('retries the live probe on a later list after a failed probe (not cached)', async () => {
    let failures = 0;
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        if (failures === 0) {
          failures += 1;
          throw new Error('daemon still starting');
        }
        return LIVE_PAIRING_INFO;
      }
      return {};
    };
    store.list.mockResolvedValue([LOCAL, SELF_ENTRY]);
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const list = findHandler('connections:list')!;

    // First list: probe fails (not cached) → nothing hides. A later list
    // retries the probe; once it succeeds the self entry hides.
    await expect(list({}, undefined)).resolves.toMatchObject({
      connections: [LOCAL, SELF_ENTRY],
    });
    await vi.waitFor(async () => {
      await expect(list({}, undefined)).resolves.toMatchObject({
        connections: [LOCAL],
      });
    });
    expect(rpc.calls.filter((m) => m === 'server.pairingInfo')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Multi-host candidates + post-connect refresh (#1746)
// ---------------------------------------------------------------------------

describe('multi-host candidates (#1746)', () => {
  it('openBackendWindow builds the wss config with the stored candidate hosts', async () => {
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, hosts: ['10.0.0.5', '192.168.1.5'] }]);
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1');
    const config = mod.getBackendClientForId('remote-1').getConfig() as {
      host?: string;
      hosts?: string[];
    };
    expect(config.host).toBe('10.0.0.5');
    expect(config.hosts).toEqual(['10.0.0.5', '192.168.1.5']);
  });

  it('openBackendWindow falls back to a one-element host list for records without hosts', async () => {
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1');
    const config = mod.getBackendClientForId('remote-1').getConfig() as { hosts?: string[] };
    expect(config.hosts).toEqual(['10.0.0.5']);
  });

  it('persists refreshed candidate hosts from server.pairingInfo after an open', async () => {
    installWindow();
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        return { localIps: ['10.0.0.5', '192.168.1.5'], hostname: 'studio' };
      }
      return {};
    };
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1');

    await vi.waitFor(() =>
      expect(store.setHosts).toHaveBeenCalledWith('remote-1', ['10.0.0.5', '192.168.1.5']),
    );
  });

  it('refreshes the stored tcAddress from the same pairingInfo response', async () => {
    installWindow();
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        return { localIps: ['10.0.0.5'], tcAddress: TC_ADDRESS };
      }
      return {};
    };
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1');

    await vi.waitFor(() => expect(store.setTcAddress).toHaveBeenCalledWith('remote-1', TC_ADDRESS));
  });

  it('clears the stored tcAddress when a successful pairingInfo omits it', async () => {
    installWindow();
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        return { localIps: ['10.0.0.5'] };
      }
      return {};
    };
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1');

    await vi.waitFor(() => expect(store.setTcAddress).toHaveBeenCalledWith('remote-1', null));
  });

  it('skips the pairingInfo refresh when the record opted out of IP detection', async () => {
    store.getDetectHosts.mockResolvedValue(false);
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1');

    // The hostname capture still runs, but no pairingInfo call on the remote
    // client and no setHosts. (The local pool member's own self-fingerprint
    // probe may issue server.pairingInfo — that one targets local.)
    const remoteRequest = vi.mocked(mod.getBackendClientForId('remote-1').request);
    await vi.waitFor(() =>
      expect(remoteRequest.mock.calls.map(([m]) => m)).toContain('host.status'),
    );
    expect(remoteRequest.mock.calls.map(([m]) => m)).not.toContain('server.pairingInfo');
    expect(store.setHosts).not.toHaveBeenCalled();
  });

  it('fails soft when the daemon rejects server.pairingInfo (local-only gating)', async () => {
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        throw new Error('server.* methods are local-only');
      }
      return {};
    };
    const { mod } = await loadModule();
    // Must not reject the open, and the stored hosts stay untouched.
    await expect(mod.openBackendWindow('remote-1')).resolves.toEqual({ id: 'remote-1' });
    await vi.waitFor(() => expect(rpc.calls).toContain('server.pairingInfo'));
    expect(store.setHosts).not.toHaveBeenCalled();
  });

  it('ignores a malformed pairingInfo result (no localIps)', async () => {
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') return { hostname: 'studio' };
      return {};
    };
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1');
    await vi.waitFor(() => expect(rpc.calls).toContain('server.pairingInfo'));
    expect(store.setHosts).not.toHaveBeenCalled();
  });

  it('drops a pairingInfo result that lands after its pooled client was torn down', async () => {
    installWindow();
    // Hold the pairingInfo answer open until the test releases it.
    let releasePairingInfo!: () => void;
    const gate = new Promise<void>((resolve) => (releasePairingInfo = resolve));
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        await gate;
        return { localIps: ['10.9.9.9'], hostname: 'other' };
      }
      return {};
    };
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1');
    await vi.waitFor(() => expect(rpc.calls).toContain('server.pairingInfo'));

    // remote-1's pooled client is disposed while the refresh is still in flight…
    mod.disconnectBackendClient('remote-1');
    releasePairingInfo();

    // …so the stale answer must NOT be persisted under remote-1.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.setHosts).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Connection-queue TOCTOU (monorepo#2228): the forget/add handlers run their
// whole read-decide sequence INSIDE the serialized connection-operation queue,
// so a concurrent operation can never make the decision stale — a forget must
// not tear down a client mid-open, and a re-pair's active-id read must wait
// its queue turn.
// ---------------------------------------------------------------------------

describe('forget/add decisions inside the connection-operation queue (monorepo#2228)', () => {
  const REMOTE2 = {
    id: 'remote-2',
    label: 'Laptop',
    host: '10.0.0.6',
    port: 8443,
    fingerprint: 'EE:FF:00:11',
    isLocal: false,
  };

  it('forget(A) racing an open of B waits its queue turn', async () => {
    store.list.mockResolvedValue([LOCAL, REMOTE, REMOTE2]);
    store.forget.mockResolvedValue(undefined);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const forgetHandler = findHandler('connections:forget')!;

    // Park the user's open of B at its window-hook await point…
    let releaseOpen!: () => void;
    const gate = new Promise<void>((resolve) => (releaseOpen = resolve));
    const openOrFocus = vi.fn(async () => {
      if (openOrFocus.mock.calls.length === 1) await gate;
    });
    const ensureLocalWindowBeforeClose = vi.fn();
    const closeForBackend = vi.fn();
    mod.__setBackendWindowHooksForTesting({
      openOrFocus,
      ensureLocalWindowBeforeClose,
      closeForBackend,
    });

    const openB = mod.openBackendWindow('remote-2');
    await vi.waitFor(() => expect(openOrFocus).toHaveBeenCalledTimes(1));
    // …then forget(A) lands while that open is still in flight.
    const forget = forgetHandler({}, { id: 'remote-1' });

    // The enqueued forget makes NO progress (not even the store forget) while
    // the open is in flight — the whole decision waits its queue turn.
    await Promise.resolve();
    await Promise.resolve();
    expect(store.forget).not.toHaveBeenCalled();

    releaseOpen();
    await expect(openB).resolves.toEqual({ id: 'remote-2' });
    await expect(forget).resolves.toEqual({ id: 'remote-1' });

    expect(store.forget).toHaveBeenCalledWith('remote-1');
    expect(closeForBackend).toHaveBeenCalledWith('remote-1');
    // B's freshly opened client survives the forget of A.
    expect(mod.getBackendClientForConnection('remote-2')).toBeDefined();
  });

  it('re-pairing A racing an open of B makes its active-id decision after the open', async () => {
    store.list.mockResolvedValue([LOCAL, REMOTE, REMOTE2]);
    store.add.mockResolvedValue(REMOTE); // upsert of remote-1 (refreshed token)
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const addHandler = findHandler('connections:add')!;

    // Park the user's open of B at its window-hook await point…
    let releaseOpen!: () => void;
    const gate = new Promise<void>((resolve) => (releaseOpen = resolve));
    const openOrFocus = vi.fn(async () => {
      if (openOrFocus.mock.calls.length === 1) await gate;
    });
    mod.__setBackendWindowHooksForTesting({ openOrFocus });

    const openB = mod.openBackendWindow('remote-2');
    await vi.waitFor(() => expect(openOrFocus).toHaveBeenCalledTimes(1));
    // …then the re-pair of A lands while that open is still in flight.
    const add = addHandler(
      {},
      {
        label: 'Studio Mac',
        host: '10.0.0.5',
        port: 8443,
        fingerprint: 'AA:BB:CC:DD',
        token: 'fresh-token',
      },
    );

    // The enqueued add makes no progress while the open is in flight.
    await Promise.resolve();
    await Promise.resolve();
    expect(store.add).not.toHaveBeenCalled();

    releaseOpen();
    await expect(openB).resolves.toEqual({ id: 'remote-2' });
    // A was not active at decision time → upsert only, no client rebuild.
    await expect(add).resolves.toEqual({ connection: REMOTE, switched: false });
  });

  it('a rejected enqueued forget does not poison the queue for later opens', async () => {
    store.forget.mockRejectedValue(new Error('cannot forget the reserved local connection'));
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const forgetHandler = findHandler('connections:forget')!;

    await expect(forgetHandler({}, { id: 'remote-1' })).rejects.toThrow(/cannot forget/i);
    await expect(mod.openBackendWindow('remote-1')).resolves.toEqual({ id: 'remote-1' });
  });
});

// ---------------------------------------------------------------------------
// Additive backend client pool
// ---------------------------------------------------------------------------

describe('backend client pool', () => {
  it('keeps the local primary client unchanged when a remote connects', async () => {
    const { mod } = await loadModule();
    const local = mod.getBackendClient();

    const remote = await mod.connectBackendClient('remote-1');

    expect(remote).not.toBe(local);
    expect(mod.getBackendClient()).toBe(local);
    expect(mod.getBackendClientForConnection('local')).toBe(local);
    expect(mod.getBackendClientForConnection('remote-1')).toBe(remote);
    expect(lifecycle.events.map((event) => event.type)).toEqual([
      'construct',
      'start',
      'construct',
      'start',
    ]);
    const { registerBrowserExecReverseHandler } =
      await import('../../../browser/main/browser-exec-reverse');
    expect(registerBrowserExecReverseHandler).toHaveBeenCalledWith(
      local,
      expect.objectContaining({ backendId: 'local', savedRemote: false }),
    );
    expect(registerBrowserExecReverseHandler).toHaveBeenCalledWith(
      remote,
      expect.objectContaining({ backendId: 'remote-1', savedRemote: true }),
    );
  });

  it('treats the focused remote window as current for menu and quit gates', async () => {
    const { localWindow, remoteWindow } = installBackendWindows();
    const { mod } = await loadModule();
    mod.getBackendClient();
    await mod.connectBackendClient('remote-1');

    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(remoteWindow as never);
    expect(mod.isRemoteBackendActive()).toBe(true);
    expect(mod.isSameHostBackendActive()).toBe(false);
    expect(mod.getFocusedBackendClient()).toBe(mod.getBackendClientForConnection('remote-1'));

    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(localWindow as never);
    expect(mod.isRemoteBackendActive()).toBe(false);
    expect(mod.getFocusedBackendClient()).toBe(mod.getBackendClientForConnection('local'));
  });

  it('deduplicates concurrent connects for the same connection id', async () => {
    const { mod } = await loadModule();

    const [first, second] = await Promise.all([
      mod.connectBackendClient('remote-1'),
      mod.connectBackendClient('remote-1'),
    ]);

    expect(second).toBe(first);
    expect(lifecycle.events.map((event) => event.type)).toEqual(['construct', 'start']);
  });

  it('disconnects one remote without disposing the local primary client', async () => {
    const { mod } = await loadModule();
    const local = mod.getBackendClient();
    const remote = await mod.connectBackendClient('remote-1');
    lifecycle.events = [];
    vi.mocked(app.emit).mockClear();

    mod.disconnectBackendClient('remote-1');

    expect(lifecycle.events.map((event) => event.type)).toEqual(['dispose']);
    expect(vi.mocked(app.emit)).toHaveBeenCalledWith(mod.BACKEND_CLIENT_DISCONNECTED_EVENT, remote);
    expect(vi.mocked(app.emit)).not.toHaveBeenCalledWith('backend-connection-changed');
    expect(mod.getBackendClient()).toBe(local);
    expect(mod.getBackendClientForConnection('local')).toBe(local);
    expect(mod.getBackendClientForConnection('remote-1')).toBeUndefined();
  });

  it('scopes main-process reconnect listeners to their backend', async () => {
    const { mod } = await loadModule();
    const local = mod.getBackendClient() as unknown as { emit(event: string): void };
    const remote = (await mod.connectBackendClient('remote-1')) as unknown as {
      emit(event: string): void;
    };
    const onLocalReconnect = vi.fn();
    const onRemoteReconnect = vi.fn();
    mod.onBackendReconnected(onLocalReconnect, 'local');
    mod.onBackendReconnected(onRemoteReconnect, 'remote-1');

    local.emit('reconnected');
    expect(onLocalReconnect).toHaveBeenCalledTimes(1);
    expect(onRemoteReconnect).not.toHaveBeenCalled();

    remote.emit('reconnected');
    expect(onLocalReconnect).toHaveBeenCalledTimes(1);
    expect(onRemoteReconnect).toHaveBeenCalledTimes(1);
  });
});

describe('per-window backend IPC routing', () => {
  it('reports the calling window backend without changing the persisted active selection', async () => {
    const { mod } = await loadModule();
    const { localSender, remoteSender } = installBackendWindows();
    mod.registerBackendHandlers();
    const list = findHandler('connections:list')!;

    await expect(list({ sender: localSender }, undefined)).resolves.toMatchObject({
      activeId: 'local',
      windowBackendId: 'local',
    });
    await expect(list({ sender: remoteSender }, undefined)).resolves.toMatchObject({
      activeId: 'local',
      windowBackendId: 'remote-1',
    });
    expect(store.setActiveId).not.toHaveBeenCalled();
  });

  it('tailors connections:changed to each recipient window', async () => {
    store.add.mockResolvedValue(REMOTE);
    const { mod } = await loadModule();
    const { localSender, localSend, remoteSend } = installBackendWindows();
    mod.registerBackendHandlers();

    await findHandler('connections:add')!(
      { sender: localSender },
      {
        label: 'Studio Mac',
        host: '10.0.0.5',
        port: 8443,
        fingerprint: 'AA:BB:CC:DD',
        token: 'secret-token',
      },
    );

    expect(localSend).toHaveBeenCalledWith(
      'connections:changed',
      expect.objectContaining({ activeId: 'local', windowBackendId: 'local' }),
    );
    expect(remoteSend).toHaveBeenCalledWith(
      'connections:changed',
      expect.objectContaining({ activeId: 'local', windowBackendId: 'remote-1' }),
    );
    expect(store.setActiveId).not.toHaveBeenCalled();
  });

  it('routes requests, subscriptions, unsubscriptions, and status to the sender client', async () => {
    const { mod } = await loadModule();
    const localClient = mod.getBackendClient();
    const remoteClient = await mod.connectBackendClient('remote-1');
    const { localSender, remoteSender } = installBackendWindows();
    mod.registerBackendHandlers();

    const request = findHandler('backend:request')!;
    const subscribe = findHandler('backend:subscribe')!;
    const unsubscribe = findHandler('backend:unsubscribe')!;
    const getStatus = findHandler('backend:get-status')!;

    await request(
      { sender: localSender },
      { method: 'workspace.list', params: { archived: false }, timeoutMs: 1_000 },
    );
    await request(
      { sender: remoteSender },
      { method: 'workspace.get', params: { id: 'remote-workspace' } },
    );
    expect(localClient.request).toHaveBeenCalledWith(
      'workspace.list',
      { archived: false },
      { timeoutMs: 1_000 },
    );
    expect(remoteClient.request).toHaveBeenCalledWith(
      'workspace.get',
      { id: 'remote-workspace' },
      { timeoutMs: undefined },
    );

    await subscribe({ sender: localSender }, { eventTypes: ['workspace:*'] });
    await subscribe({ sender: remoteSender }, { eventTypes: ['agent:*'] });
    await unsubscribe({ sender: localSender }, { subscriptionId: 'local-sub' });
    await unsubscribe({ sender: remoteSender }, { subscriptionId: 'remote-sub' });
    expect(localClient.request).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['workspace:*'],
    });
    expect(remoteClient.request).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['agent:*'],
    });
    expect(localClient.request).toHaveBeenCalledWith('events.unsubscribe', {
      subscriptionId: 'local-sub',
    });
    expect(remoteClient.request).toHaveBeenCalledWith('events.unsubscribe', {
      subscriptionId: 'remote-sub',
    });

    await expect(getStatus({ sender: localSender }, undefined)).resolves.toMatchObject({
      transport: { mode: 'sidecar-uds' },
    });
    await expect(getStatus({ sender: remoteSender }, undefined)).resolves.toMatchObject({
      transport: { mode: 'external-ws', target: 'wss:10.0.0.5:8443' },
    });
  });

  it('keeps a remote request failure isolated from local requests', async () => {
    const { mod } = await loadModule();
    const localClient = mod.getBackendClient();
    const remoteClient = await mod.connectBackendClient('remote-1');
    const { localSender, remoteSender } = installBackendWindows();
    mod.registerBackendHandlers();
    const request = findHandler('backend:request')!;
    vi.mocked(remoteClient.request).mockRejectedValueOnce(new Error('remote unavailable'));

    await expect(
      request({ sender: remoteSender }, { method: 'workspace.list' }),
    ).resolves.toMatchObject({ ok: false, error: { message: 'remote unavailable' } });
    await expect(
      request({ sender: localSender }, { method: 'workspace.list' }),
    ).resolves.toMatchObject({ ok: true });
    expect(localClient.request).toHaveBeenCalledWith('workspace.list', undefined, {
      timeoutMs: undefined,
    });
  });

  it('delivers notifications and status only to windows bound to the emitting client', async () => {
    const { mod } = await loadModule();
    const localClient = mod.getBackendClient() as unknown as {
      emit(event: string, arg: unknown): void;
    };
    const remoteClient = (await mod.connectBackendClient('remote-1')) as unknown as {
      emit(event: string, arg: unknown): void;
    };
    const { localSend, remoteSend } = installBackendWindows();

    localClient.emit('notification', { method: 'events.event', params: { backend: 'local' } });
    remoteClient.emit('notification', { method: 'events.event', params: { backend: 'remote' } });
    localClient.emit('status', 'connected');
    remoteClient.emit('status', 'disconnected');

    expect(localSend).toHaveBeenCalledWith('backend:notification', {
      method: 'events.event',
      params: { backend: 'local' },
    });
    expect(localSend).not.toHaveBeenCalledWith(
      'backend:notification',
      expect.objectContaining({ params: { backend: 'remote' } }),
    );
    expect(remoteSend).toHaveBeenCalledWith('backend:notification', {
      method: 'events.event',
      params: { backend: 'remote' },
    });
    expect(remoteSend).not.toHaveBeenCalledWith(
      'backend:notification',
      expect.objectContaining({ params: { backend: 'local' } }),
    );
    expect(localSend).toHaveBeenCalledWith(
      'backend:status',
      expect.objectContaining({
        status: 'connected',
        transport: expect.objectContaining({ mode: 'sidecar-uds' }),
      }),
    );
    expect(remoteSend).toHaveBeenCalledWith(
      'backend:status',
      expect.objectContaining({
        status: 'disconnected',
        transport: expect.objectContaining({
          mode: 'external-ws',
          target: 'wss:10.0.0.5:8443',
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Guest sessions IPC (multiplayer w4): token-free list + Leave host
// ---------------------------------------------------------------------------

describe('guest-sessions:* IPC handlers', () => {
  function installGuest() {
    guestStore.list.mockResolvedValue([GUEST]);
    guestStore.findById.mockImplementation(async (id: string) => (id === GUEST.id ? GUEST : null));
    guestStore.getDecryptedToken.mockResolvedValue('guest-token-v1');
  }

  it('guest-sessions:list distinguishes no pooled client, open-disconnected and open-connected', async () => {
    installGuest();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:list')!;

    // No window for the host has been opened: the session exists, no status.
    await expect(handler({}, undefined)).resolves.toEqual({
      sessions: [GUEST],
      openIds: [],
      connectedIds: [],
    });

    const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as { status: string };
    await expect(handler({}, undefined)).resolves.toEqual({
      sessions: [GUEST],
      openIds: [GUEST.id],
      connectedIds: [],
    });

    guest.status = 'connected';
    await expect(handler({}, undefined)).resolves.toEqual({
      sessions: [GUEST],
      openIds: [GUEST.id],
      connectedIds: [GUEST.id],
    });
  });

  it('re-broadcasts guest-sessions:changed when a guest pooled client appears, connects or drops', async () => {
    installGuest();
    const send = installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as {
      status: string;
      emit(event: string, arg: unknown): void;
    };
    const lastChanged = () =>
      send.mock.calls.filter(([c]) => c === 'guest-sessions:changed').at(-1)?.[1];

    // The pooled client's first 'connecting' moves the id into openIds.
    guest.emit('status', 'connecting');
    await vi.waitFor(() =>
      expect(lastChanged()).toEqual({ sessions: [GUEST], openIds: [GUEST.id], connectedIds: [] }),
    );

    guest.status = 'connected';
    guest.emit('status', 'connected');
    await vi.waitFor(() =>
      expect(lastChanged()).toEqual({
        sessions: [GUEST],
        openIds: [GUEST.id],
        connectedIds: [GUEST.id],
      }),
    );

    guest.status = 'disconnected';
    guest.emit('status', 'disconnected');
    await vi.waitFor(() =>
      expect(lastChanged()).toEqual({ sessions: [GUEST], openIds: [GUEST.id], connectedIds: [] }),
    );
  });

  it('disposing an already-disconnected pooled guest moves the id out of openIds in every window', async () => {
    // The real client suppresses a same-status transition on dispose, so the
    // status forwarder alone cannot announce the eviction.
    const { JsonRpcClient } =
      await vi.importActual<typeof import('../json-rpc-client')>('../json-rpc-client');
    const real = new JsonRpcClient({
      config: { mode: 'external-uds', socketPath: '/tmp/not-dialed.sock' },
    } as never);
    const status = vi.fn();
    real.on('status', status);
    real.dispose();
    expect(status).not.toHaveBeenCalled();

    installGuest();
    const send = installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as {
      emit(event: string, arg: unknown): void;
    };
    const lastChanged = () =>
      send.mock.calls.filter(([c]) => c === 'guest-sessions:changed').at(-1)?.[1];
    guest.emit('status', 'disconnected');
    await vi.waitFor(() =>
      expect(lastChanged()).toEqual({ sessions: [GUEST], openIds: [GUEST.id], connectedIds: [] }),
    );

    // Its last window closed: the pool entry goes, and so must openIds.
    mod.disconnectBackendClient(GUEST.id);
    expect(mod.getBackendClientForConnection(GUEST.id)).toBeUndefined();
    await vi.waitFor(() =>
      expect(lastChanged()).toEqual({ sessions: [GUEST], openIds: [], connectedIds: [] }),
    );
    await expect(findHandler('guest-sessions:list')!({}, undefined)).resolves.toEqual({
      sessions: [GUEST],
      openIds: [],
      connectedIds: [],
    });
  });

  it('a paired (owner) backend status change does not broadcast guest-sessions:changed', async () => {
    const send = installWindow();
    const { mod } = await loadModule();
    const remote = (await mod.connectBackendClient('remote-1')) as unknown as {
      status: string;
      emit(event: string, arg: unknown): void;
    };
    mod.registerBackendHandlers();
    remote.status = 'connected';
    remote.emit('status', 'connected');
    await vi.waitFor(() => {
      expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true);
    });
    expect(send.mock.calls.some(([c]) => c === 'guest-sessions:changed')).toBe(false);
  });

  /**
   * The joined-workspace list on a guest record is only a last-known cache
   * (keychain-imported and pre-field rows have none): each (re)connect hello
   * hydrates it from the host's membership-filtered `workspace.list`.
   */
  describe('joined-workspace hydration on guest connect', () => {
    type HelloClient = { hello(result: unknown): void };
    const hello = { server: { version: '6.8.0', buildCommit: 'abc123' } };

    it('reconciles the cached list from workspace.list through the guest connection and re-broadcasts', async () => {
      installGuest();
      guestStore.setWorkspaces.mockResolvedValue(true);
      rpc.handler = async (method) =>
        method === 'workspace.list'
          ? {
              workspaces: [
                { id: 'ws-guest', title: 'Guest project', myRole: 'collaborator', memberCount: 2 },
                { id: 'ws-new', title: 'Joined elsewhere', myRole: 'collaborator', memberCount: 3 },
              ],
            }
          : {};
      const send = installWindow();
      const { mod } = await loadModule();
      mod.registerBackendHandlers();
      const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as HelloClient;
      send.mockClear();

      guest.hello(hello);
      await vi.waitFor(() =>
        expect(guestStore.setWorkspaces).toHaveBeenCalledWith(
          GUEST.id,
          [
            { id: 'ws-guest', title: 'Guest project' },
            { id: 'ws-new', title: 'Joined elsewhere' },
          ],
          expect.any(Function),
        ),
      );
      expect(rpc.params[rpc.calls.indexOf('workspace.list')]).toBeUndefined();
      await vi.waitFor(() =>
        expect(send.mock.calls.some(([c]) => c === 'guest-sessions:changed')).toBe(true),
      );
    });

    it('never lists workspaces on a paired (owner) backend hello', async () => {
      installGuest();
      const { mod } = await loadModule();
      mod.registerBackendHandlers();
      const remote = (await mod.connectBackendClient('remote-1')) as unknown as HelloClient;
      remote.hello(hello);
      await vi.waitFor(() => expect(rpc.calls).toContain('host.status'));
      expect(rpc.calls).not.toContain('workspace.list');
      expect(guestStore.setWorkspaces).not.toHaveBeenCalled();
    });

    it('keeps the cached list when the host refuses or is unreachable', async () => {
      installGuest();
      rpc.handler = async (method) => {
        if (method === 'workspace.list') throw new Error('socket closed');
        return {};
      };
      const send = installWindow();
      const { mod } = await loadModule();
      mod.registerBackendHandlers();
      const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as HelloClient;
      send.mockClear();

      guest.hello(hello);
      await vi.waitFor(() => expect(rpc.calls).toContain('workspace.list'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(guestStore.setWorkspaces).not.toHaveBeenCalled();
      expect(send.mock.calls.some(([c]) => c === 'guest-sessions:changed')).toBe(false);
    });

    it('keeps the cached list when workspace.list is not the documented shape', async () => {
      installGuest();
      rpc.handler = async (method) =>
        method === 'workspace.list' ? { workspaces: [{ id: 'ws-guest' }] } : {};
      const { mod } = await loadModule();
      mod.registerBackendHandlers();
      const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as HelloClient;

      guest.hello(hello);
      await vi.waitFor(() => expect(rpc.calls).toContain('workspace.list'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(guestStore.setWorkspaces).not.toHaveBeenCalled();
    });

    it('a snapshot requested before a per-workspace Leave cannot restore the left workspace', async () => {
      installGuest();
      let cached = [...GUEST.workspaces];
      guestStore.findById.mockImplementation(async (id: string) =>
        id === GUEST.id ? { ...GUEST, workspaces: [...cached] } : null,
      );
      guestStore.list.mockImplementation(async () => [{ ...GUEST, workspaces: [...cached] }]);
      guestStore.setWorkspaces.mockImplementation(async (_id: string, refs: typeof cached) => {
        cached = [...refs];
        return true;
      });
      guestStore.leaveWorkspace.mockImplementation(async (_id: string, workspaceId: string) => {
        cached = cached.filter((w) => w.id !== workspaceId);
        return true;
      });
      let release!: (value: unknown) => void;
      const snapshot = new Promise((resolve) => {
        release = resolve;
      });
      rpc.handler = async (method) =>
        method === 'workspace.list'
          ? snapshot
          : method === 'workspace.members.leave'
            ? { left: true }
            : {};
      const { mod } = await loadModule();
      mod.registerBackendHandlers();
      const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as HelloClient & {
        status: string;
      };
      guest.status = 'connected';
      guest.hello(hello);
      await vi.waitFor(() => expect(rpc.calls).toContain('workspace.list'));

      await expect(
        findHandler('guest-sessions:leave-workspace')!(
          {},
          { id: GUEST.id, workspaceId: 'ws-guest' },
        ),
      ).resolves.toMatchObject({ left: true });
      expect(cached).toEqual([]);

      // The pre-Leave membership answers only now: it must be discarded.
      release({ workspaces: GUEST.workspaces });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(guestStore.setWorkspaces).not.toHaveBeenCalled();
      expect(
        (await findHandler('guest-sessions:list')!({}, undefined)).sessions[0].workspaces,
      ).toEqual([]);
    });

    it('a snapshot requested before a Leave the host already applied (-32602) is discarded too', async () => {
      installGuest();
      let release!: (value: unknown) => void;
      const snapshot = new Promise((resolve) => {
        release = resolve;
      });
      const { JsonRpcError } = await import('../json-rpc-errors');
      rpc.handler = async (method) => {
        if (method === 'workspace.list') return snapshot;
        if (method === 'workspace.members.leave') {
          throw new JsonRpcError({ code: -32602, message: 'not a member' });
        }
        return {};
      };
      const { mod } = await loadModule();
      mod.registerBackendHandlers();
      const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as HelloClient & {
        status: string;
      };
      guest.status = 'connected';
      guest.hello(hello);
      await vi.waitFor(() => expect(rpc.calls).toContain('workspace.list'));

      await expect(
        findHandler('guest-sessions:leave-workspace')!(
          {},
          { id: GUEST.id, workspaceId: 'ws-guest' },
        ),
      ).resolves.toMatchObject({ left: false });
      expect(guestStore.leaveWorkspace).toHaveBeenCalledWith(GUEST.id, 'ws-guest');

      release({ workspaces: GUEST.workspaces });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(guestStore.setWorkspaces).not.toHaveBeenCalled();
    });

    it('a late first-hello snapshot cannot overwrite the newer hello snapshot on the same client', async () => {
      installGuest();
      guestStore.setWorkspaces.mockResolvedValue(true);
      let release!: (value: unknown) => void;
      const first = new Promise((resolve) => {
        release = resolve;
      });
      let reads = 0;
      rpc.handler = async (method) =>
        method === 'workspace.list' ? (++reads === 1 ? first : { workspaces: [] }) : {};
      const { mod } = await loadModule();
      mod.registerBackendHandlers();
      const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as HelloClient;

      guest.hello(hello);
      await vi.waitFor(() => expect(reads).toBe(1));
      guest.hello(hello);
      await vi.waitFor(() =>
        expect(guestStore.setWorkspaces).toHaveBeenCalledWith(GUEST.id, [], expect.any(Function)),
      );

      release({
        workspaces: [{ id: 'ws-stale', title: 'Old membership', myRole: 'collaborator' }],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(guestStore.setWorkspaces).toHaveBeenCalledTimes(1);
      expect(guestStore.setWorkspaces).not.toHaveBeenCalledWith(
        GUEST.id,
        [{ id: 'ws-stale', title: 'Old membership' }],
        expect.any(Function),
      );
    });

    it('a snapshot with no Leave in flight is still applied after an unrelated round trip', async () => {
      installGuest();
      guestStore.setWorkspaces.mockResolvedValue(true);
      let release!: (value: unknown) => void;
      const snapshot = new Promise((resolve) => {
        release = resolve;
      });
      rpc.handler = async (method) => (method === 'workspace.list' ? snapshot : {});
      const { mod } = await loadModule();
      mod.registerBackendHandlers();
      const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as HelloClient;
      guest.hello(hello);
      await vi.waitFor(() => expect(rpc.calls).toContain('workspace.list'));

      release({
        workspaces: [{ id: 'ws-guest', title: 'Renamed', myRole: 'collaborator', memberCount: 2 }],
      });
      await vi.waitFor(() =>
        expect(guestStore.setWorkspaces).toHaveBeenCalledWith(
          GUEST.id,
          [{ id: 'ws-guest', title: 'Renamed' }],
          expect.any(Function),
        ),
      );
    });

    it('a failed hydration logs only a bounded code, never the host message', async () => {
      installGuest();
      const marker = 'SENTINEL-hydration-detail-9c1e';
      rpc.handler = async (method) => {
        if (method === 'workspace.list') throw new Error(`socket closed ${marker}`);
        return {};
      };
      const { Logger } = await import('$shared/logger');
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const { mod } = await loadModule();
      mod.registerBackendHandlers();
      const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as HelloClient;
      guest.hello(hello);

      await vi.waitFor(() =>
        expect(warn.mock.calls.some(([message]) => /hydrate guest/.test(String(message)))).toBe(
          true,
        ),
      );
      const hydrationWarns = warn.mock.calls.filter(([message]) =>
        /hydrate guest/.test(String(message)),
      );
      expect(JSON.stringify(hydrationWarns)).not.toContain(marker);
      expect(hydrationWarns[0][1]).toEqual({ id: GUEST.id, code: 'transport' });
      warn.mockRestore();
    });

    /**
     * Between hellos the cached titles would go stale on a host-side rename:
     * the guest hello subscribes to the host's `workspace:updated` /
     * `workspace:deleted` (PROTOCOL §6.2) and a matching event re-runs the
     * hydration, single-flight with trailing coalesce.
     */
    describe('refresh on host workspace events', () => {
      type EventClient = HelloClient & { emit(event: string, arg: unknown): void };
      const SUB_ID = 'guest-ws-sub-1';

      function workspaceEvent(subscriptionId: string, type: string, data: unknown) {
        return { method: 'events.event', params: { subscriptionId, event: { type, data } } };
      }

      /** Answers `events.subscribe` with SUB_ID and `workspace.list` from `titles`. */
      function installHost(titles: () => string) {
        rpc.handler = async (method) => {
          if (method === 'events.subscribe') return { subscriptionId: SUB_ID };
          if (method === 'workspace.list') {
            return { workspaces: [{ id: 'ws-guest', title: titles(), myRole: 'collaborator' }] };
          }
          return {};
        };
      }

      async function connectGuest() {
        installGuest();
        guestStore.setWorkspaces.mockResolvedValue(true);
        const send = installWindow();
        const { mod } = await loadModule();
        mod.registerBackendHandlers();
        const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as EventClient;
        guest.hello(hello);
        await vi.waitFor(() => expect(rpc.calls).toContain('events.subscribe'));
        await vi.waitFor(() => expect(guestStore.setWorkspaces).toHaveBeenCalledTimes(1));
        send.mockClear();
        guestStore.setWorkspaces.mockClear();
        return { guest, send, mod };
      }

      it('the guest hello subscribes the pooled client to the host workspace events', async () => {
        installHost(() => 'Guest project');
        await connectGuest();
        expect(rpc.params[rpc.calls.indexOf('events.subscribe')]).toEqual({
          eventTypes: ['workspace:updated', 'workspace:deleted'],
        });
      });

      it('a host rename on the guest subscription re-hydrates the cache and broadcasts the new title', async () => {
        let title = 'Guest project';
        installHost(() => title);
        const { guest, send } = await connectGuest();
        // A store mock that commits: `list` answers with whatever the last
        // `setWorkspaces` wrote, so the broadcast payload is observable.
        let record = GUEST;
        guestStore.list.mockImplementation(async () => [record]);
        guestStore.setWorkspaces.mockImplementation(
          async (_id: string, workspaces: Array<{ id: string; title: string }>) => {
            record = { ...record, workspaces };
            return true;
          },
        );

        title = 'Renamed on host';
        guest.emit(
          'notification',
          workspaceEvent(SUB_ID, 'workspace:updated', {
            workspaceId: 'ws-guest',
            changes: { title: 'Renamed on host' },
          }),
        );
        await vi.waitFor(() =>
          expect(guestStore.setWorkspaces).toHaveBeenCalledWith(
            GUEST.id,
            [{ id: 'ws-guest', title: 'Renamed on host' }],
            expect.any(Function),
          ),
        );
        await vi.waitFor(() => {
          const changed = send.mock.calls.filter(([c]) => c === 'guest-sessions:changed');
          expect(changed.length).toBeGreaterThan(0);
          expect(changed.at(-1)?.[1]).toMatchObject({
            sessions: [
              { id: GUEST.id, workspaces: [{ id: 'ws-guest', title: 'Renamed on host' }] },
            ],
          });
        });
      });

      describe('one subscription per transport generation', () => {
        const subscribes = () => rpc.calls.filter((m) => m === 'events.subscribe').length;

        it('repeated hellos on the same socket reuse the subscription', async () => {
          installHost(() => 'Guest project');
          const { guest } = await connectGuest();
          expect(subscribes()).toBe(1);

          // Same-socket capability re-hellos (e.g. the daemon learning the
          // host identity) must not acquire another lease.
          for (let i = 0; i < 5; i += 1) guest.hello(hello);
          await vi.waitFor(() =>
            expect(rpc.calls.filter((m) => m === 'workspace.list').length).toBeGreaterThan(1),
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(subscribes()).toBe(1);

          // The single lease still routes events.
          guest.emit(
            'notification',
            workspaceEvent(SUB_ID, 'workspace:updated', {
              workspaceId: 'ws-guest',
              changes: { title: 'Renamed on host' },
            }),
          );
          await vi.waitFor(() => expect(guestStore.setWorkspaces).toHaveBeenCalled());
        });

        it('a hello while the first subscribe is in flight does not start a second one', async () => {
          const releases: Array<(value: unknown) => void> = [];
          rpc.handler = async (method) => {
            if (method === 'events.subscribe')
              return new Promise((resolve) => releases.push(resolve));
            if (method === 'workspace.list') return { workspaces: [] };
            return {};
          };
          installGuest();
          guestStore.setWorkspaces.mockResolvedValue(true);
          const { mod } = await loadModule();
          mod.registerBackendHandlers();
          const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as EventClient;
          guest.hello(hello);
          await vi.waitFor(() => expect(releases).toHaveLength(1));
          guest.hello(hello);
          guest.hello(hello);
          await vi.waitFor(() =>
            expect(rpc.calls.filter((m) => m === 'workspace.list').length).toBe(3),
          );
          expect(releases).toHaveLength(1);

          releases[0]({ subscriptionId: SUB_ID });
          await new Promise((resolve) => setTimeout(resolve, 0));
          guest.hello(hello);
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(releases).toHaveLength(1);
        });

        it('a reconnect forgets the old lease and the reconnect hello acquires exactly one new one', async () => {
          let nextSub = 1;
          rpc.handler = async (method) => {
            if (method === 'events.subscribe')
              return { subscriptionId: `guest-ws-sub-${nextSub++}` };
            if (method === 'workspace.list') return { workspaces: [] };
            return {};
          };
          installGuest();
          guestStore.setWorkspaces.mockResolvedValue(true);
          const { mod } = await loadModule();
          mod.registerBackendHandlers();
          const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as EventClient;
          guest.hello(hello);
          await vi.waitFor(() => expect(subscribes()).toBe(1));
          guest.emit('status', 'connected');
          const reads = () => rpc.calls.filter((m) => m === 'workspace.list').length;

          // Socket drops: the daemon dropped the lease with it, so events
          // carrying the old id are no longer ours.
          guest.emit('status', 'disconnected');
          guest.emit('status', 'connecting');
          const before = reads();
          guest.emit(
            'notification',
            workspaceEvent('guest-ws-sub-1', 'workspace:updated', {
              workspaceId: 'ws-guest',
              changes: { title: 'Stale' },
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(reads()).toBe(before);

          // The reconnect hello subscribes once more; a follow-up same-socket
          // hello reuses that lease.
          guest.hello(hello);
          guest.hello(hello);
          await vi.waitFor(() => expect(reads()).toBe(before + 2));
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(subscribes()).toBe(2);
          guest.emit('status', 'connected');

          guest.emit(
            'notification',
            workspaceEvent('guest-ws-sub-2', 'workspace:updated', {
              workspaceId: 'ws-guest',
              changes: { title: 'Fresh' },
            }),
          );
          await vi.waitFor(() => expect(reads()).toBe(before + 3));
        });

        it('a registry read crossing a reconnect never sends a stale subscribe on the new socket', async () => {
          let nextSub = 1;
          rpc.handler = async (method) => {
            if (method === 'events.subscribe')
              return { subscriptionId: `guest-ws-sub-${nextSub++}` };
            if (method === 'workspace.list') return { workspaces: [] };
            return {};
          };
          installGuest();
          guestStore.setWorkspaces.mockResolvedValue(true);
          const { mod } = await loadModule();
          mod.registerBackendHandlers();
          const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as EventClient;
          const reads = () => rpc.calls.filter((m) => m === 'workspace.list').length;

          // The hello's registry read (a real file read in production) is held
          // while the socket drops and redials underneath it.
          const pendingReads: Array<(value: typeof GUEST) => void> = [];
          guestStore.findById.mockImplementation(
            () => new Promise((resolve) => pendingReads.push(resolve)),
          );
          guest.hello(hello);
          await vi.waitFor(() => expect(pendingReads.length).toBeGreaterThan(0));
          expect(subscribes()).toBe(0);

          guest.emit('status', 'disconnected');
          guest.emit('status', 'connecting');
          guestStore.findById.mockResolvedValue(GUEST);
          guest.hello(hello);
          await vi.waitFor(() => expect(subscribes()).toBe(1));
          guest.emit('status', 'connected');

          // The old reads settle: they must not issue a second subscribe.
          for (const resolve of pendingReads) resolve(GUEST);
          await new Promise((resolve) => setTimeout(resolve, 20));
          expect(subscribes()).toBe(1);

          // The live lease is the new socket's, and it routes.
          const before = reads();
          guest.emit(
            'notification',
            workspaceEvent('guest-ws-sub-1', 'workspace:updated', {
              workspaceId: 'ws-guest',
              changes: { title: 'Fresh' },
            }),
          );
          await vi.waitFor(() => expect(reads()).toBe(before + 1));
        });

        it('a subscribe answered after the socket dropped is discarded', async () => {
          const releases: Array<(value: unknown) => void> = [];
          rpc.handler = async (method) => {
            if (method === 'events.subscribe')
              return new Promise((resolve) => releases.push(resolve));
            if (method === 'workspace.list') return { workspaces: [] };
            return {};
          };
          installGuest();
          guestStore.setWorkspaces.mockResolvedValue(true);
          const { mod } = await loadModule();
          mod.registerBackendHandlers();
          const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as EventClient;
          guest.hello(hello);
          await vi.waitFor(() => expect(releases).toHaveLength(1));

          guest.emit('status', 'disconnected');
          releases[0]({ subscriptionId: SUB_ID });
          await new Promise((resolve) => setTimeout(resolve, 0));
          const before = rpc.calls.filter((m) => m === 'workspace.list').length;
          guest.emit(
            'notification',
            workspaceEvent(SUB_ID, 'workspace:updated', {
              workspaceId: 'ws-guest',
              changes: { title: 'Stale' },
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(rpc.calls.filter((m) => m === 'workspace.list').length).toBe(before);

          // The next generation's hello is not blocked by the stale in-flight guard.
          guest.emit('status', 'connecting');
          guest.hello(hello);
          await vi.waitFor(() => expect(releases).toHaveLength(2));
        });

        it('a torn-down client stops routing host events and a rebuilt one subscribes afresh', async () => {
          installHost(() => 'Guest project');
          const { guest, mod } = await connectGuest();
          const reads = () => rpc.calls.filter((m) => m === 'workspace.list').length;

          mod.disconnectBackendClient(GUEST.id);
          // The real client's `dispose()` flips status to `disconnected` before
          // dropping its listeners; the fake only records the call.
          guest.emit('status', 'disconnected');
          const before = reads();
          guest.emit(
            'notification',
            workspaceEvent(SUB_ID, 'workspace:updated', {
              workspaceId: 'ws-guest',
              changes: { title: 'After dispose' },
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(reads()).toBe(before);

          const rebuilt = (await mod.connectBackendClient(GUEST.id)) as unknown as EventClient;
          rebuilt.hello(hello);
          await vi.waitFor(() => expect(subscribes()).toBe(2));
        });
      });

      it('a membership removal and a deletion re-hydrate too', async () => {
        installHost(() => 'Guest project');
        const { guest } = await connectGuest();
        const reads = () => rpc.calls.filter((m) => m === 'workspace.list').length;
        const before = reads();

        guest.emit(
          'notification',
          workspaceEvent(SUB_ID, 'workspace:updated', {
            workspaceId: 'ws-guest',
            changes: { members: true, removedPrincipalId: GUEST.principalId },
          }),
        );
        await vi.waitFor(() => expect(reads()).toBe(before + 1));

        guest.emit(
          'notification',
          workspaceEvent(SUB_ID, 'workspace:deleted', { workspaceId: 'ws-guest' }),
        );
        await vi.waitFor(() => expect(reads()).toBe(before + 2));
      });

      it('ignores deltas that cannot change a title and events on other subscriptions', async () => {
        installHost(() => 'Guest project');
        const { guest } = await connectGuest();
        const before = rpc.calls.filter((m) => m === 'workspace.list').length;

        guest.emit(
          'notification',
          workspaceEvent(SUB_ID, 'workspace:updated', {
            workspaceId: 'ws-guest',
            changes: { lastActivity: '2026-09-18T00:00:00Z' },
          }),
        );
        guest.emit(
          'notification',
          workspaceEvent('renderer-sub-9', 'workspace:updated', {
            workspaceId: 'ws-guest',
            changes: { title: 'Renamed on host' },
          }),
        );
        guest.emit('notification', { method: 'agent.idle', params: { agentId: 'a1' } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(rpc.calls.filter((m) => m === 'workspace.list').length).toBe(before);
        expect(guestStore.setWorkspaces).not.toHaveBeenCalled();
      });

      it('a burst of events collapses into one in-flight read plus one trailing read', async () => {
        const releases: Array<(value: unknown) => void> = [];
        rpc.handler = async (method) => {
          if (method === 'events.subscribe') return { subscriptionId: SUB_ID };
          if (method === 'workspace.list') return new Promise((resolve) => releases.push(resolve));
          return {};
        };
        installGuest();
        guestStore.setWorkspaces.mockResolvedValue(true);
        const { mod } = await loadModule();
        mod.registerBackendHandlers();
        const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as EventClient;
        guest.hello(hello);
        await vi.waitFor(() => expect(releases).toHaveLength(1));
        releases[0]({ workspaces: [] });
        await vi.waitFor(() => expect(guestStore.setWorkspaces).toHaveBeenCalledTimes(1));

        const rename = (title: string) =>
          workspaceEvent(SUB_ID, 'workspace:updated', {
            workspaceId: 'ws-guest',
            changes: { title },
          });
        for (const title of ['A', 'B', 'C', 'D']) guest.emit('notification', rename(title));
        await vi.waitFor(() => expect(releases).toHaveLength(2));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(releases).toHaveLength(2);

        releases[1]({ workspaces: [{ id: 'ws-guest', title: 'C' }] });
        await vi.waitFor(() => expect(releases).toHaveLength(3));
        releases[2]({ workspaces: [{ id: 'ws-guest', title: 'D' }] });
        await vi.waitFor(() =>
          expect(guestStore.setWorkspaces).toHaveBeenLastCalledWith(
            GUEST.id,
            [{ id: 'ws-guest', title: 'D' }],
            expect.any(Function),
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(releases).toHaveLength(3);
      });

      it('never subscribes a paired (owner) backend to workspace events', async () => {
        installGuest();
        const { mod } = await loadModule();
        mod.registerBackendHandlers();
        const remote = (await mod.connectBackendClient('remote-1')) as unknown as EventClient;
        remote.hello(hello);
        await vi.waitFor(() => expect(rpc.calls).toContain('host.status'));
        expect(rpc.calls).not.toContain('events.subscribe');

        remote.emit(
          'notification',
          workspaceEvent(SUB_ID, 'workspace:updated', {
            workspaceId: 'ws-1',
            changes: { title: 'Owner rename' },
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(rpc.calls).not.toContain('workspace.list');
        expect(guestStore.setWorkspaces).not.toHaveBeenCalled();
      });
    });

    describe('commit-boundary fencing against the real store', () => {
      type RealStore = typeof import('../guest-sessions-store');
      let real: RealStore;
      let directory: string;
      let sessionId: string;
      let backend: Awaited<ReturnType<typeof loadModule>>['mod'];
      let client: HelloClient;
      let setupElectron: Record<string, unknown>;
      const renameSpies: Array<{ mockRestore(): void }> = [];

      /** Hold the store's atomic rename so a mutation stays in flight until released. */
      async function holdNextWrite() {
        const fs = (await import('node:fs')).promises;
        const originalRename = fs.rename.bind(fs);
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
          release = resolve;
        });
        const rename = vi.spyOn(fs, 'rename').mockImplementationOnce(async (...args) => {
          await pending;
          return originalRename(...args);
        });
        renameSpies.push(rename);
        return { rename, release };
      }

      beforeEach(async () => {
        const fs = await import('node:fs/promises');
        directory = await fs.mkdtemp('/tmp/guest-hydration-real-store-');
        setupElectron = { ...(await import('electron')) };
        vi.doMock('electron', () => ({
          ...setupElectron,
          safeStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (s: string) => Buffer.from(s),
            decryptString: (b: Buffer) => b.toString(),
          },
        }));
        vi.mocked(app.getPath).mockReturnValue(directory);
        real = await vi.importActual<RealStore>('../guest-sessions-store');
        await real.applyRemoteSyncRecord({ ...GUEST, detectHosts: false, token: 'fixture-token' });
        sessionId = (await real.list())[0].id;
        guestStore.list.mockImplementation(real.list);
        guestStore.findById.mockImplementation(real.findById);
        guestStore.setWorkspaces.mockImplementation(real.setWorkspaces);
        guestStore.leaveWorkspace.mockImplementation(real.leaveWorkspace);
        guestStore.getDecryptedToken.mockImplementation(real.getDecryptedToken);
        installWindow();
        backend = (await loadModule()).mod;
        backend.registerBackendHandlers();
        client = (await backend.connectBackendClient(sessionId)) as unknown as HelloClient;
        await real.setWorkspaces(sessionId, GUEST.workspaces);
      });

      afterEach(async () => {
        backend.disconnectBackendClient(sessionId);
        await real.__drainWriteChainForTesting();
        for (const spy of renameSpies.splice(0)) spy.mockRestore();
        for (const fn of [
          guestStore.list,
          guestStore.findById,
          guestStore.setWorkspaces,
          guestStore.leaveWorkspace,
          guestStore.getDecryptedToken,
        ]) {
          fn.mockReset();
        }
        const fs = await import('node:fs/promises');
        await fs.rm(directory, { recursive: true, force: true });
        vi.doMock('electron', () => setupElectron);
      });

      it.each(['before the list answers', 'while the list answer is queued'])(
        'a same-daemon re-join replacing the record %s fences the old hydration at the write',
        async (timing) => {
          const unsubscribe = real.onGuestCredentialReplaced((id) => {
            for (const listener of guestStore.replacedListeners) listener(id);
          });
          let releaseList!: (value: unknown) => void;
          const pendingList = new Promise((resolve) => {
            releaseList = resolve;
          });
          rpc.handler = async (method) => (method === 'workspace.list' ? pendingList : {});
          client.hello(hello);
          await vi.waitFor(() => expect(rpc.calls).toContain('workspace.list'));

          const write = await holdNextWrite();
          const replacement = real.add({
            ...GUEST,
            token: 'replacement-token',
            workspace: { id: 'ws-new', title: 'Fresh join' },
          });
          try {
            await vi.waitFor(() => expect(write.rename).toHaveBeenCalledTimes(1));
            if (timing === 'before the list answers') {
              write.release();
              await replacement;
              expect(backend.getBackendClientForConnection(sessionId)).not.toBe(client);
            }
            releaseList({ workspaces: GUEST.workspaces });
            if (timing === 'while the list answer is queued') {
              await vi.waitFor(() =>
                expect(guestStore.setWorkspaces).toHaveBeenCalledWith(
                  sessionId,
                  GUEST.workspaces,
                  expect.any(Function),
                ),
              );
            }
            write.release();
            await replacement;
            await real.__drainWriteChainForTesting();
            expect((await real.list())[0].workspaces).toEqual([
              ...GUEST.workspaces,
              { id: 'ws-new', title: 'Fresh join' },
            ]);
          } finally {
            write.release();
            await replacement;
            unsubscribe();
          }
        },
      );

      it('a Leave during the hydration store write wins once the write chain drains', async () => {
        const write = await holdNextWrite();
        rpc.handler = async (method) =>
          method === 'workspace.list'
            ? { workspaces: [{ id: 'ws-guest', title: 'Renamed' }] }
            : method === 'workspace.members.leave'
              ? { left: true }
              : {};
        client.hello(hello);
        try {
          await vi.waitFor(() => expect(write.rename).toHaveBeenCalledTimes(1));
          const leave = findHandler('guest-sessions:leave-workspace')!(
            {},
            { id: sessionId, workspaceId: 'ws-guest' },
          );
          await vi.waitFor(() => expect(guestStore.leaveWorkspace).toHaveBeenCalled());
          write.release();
          await expect(leave).resolves.toMatchObject({ left: true });
          await real.__drainWriteChainForTesting();
          expect((await real.list())[0].workspaces).toEqual([]);
        } finally {
          write.release();
        }
      });

      it('an undisturbed snapshot still commits through the real store', async () => {
        rpc.handler = async (method) =>
          method === 'workspace.list'
            ? { workspaces: [{ id: 'ws-guest', title: 'Renamed', myRole: 'collaborator' }] }
            : {};
        client.hello(hello);
        await vi.waitFor(async () =>
          expect((await real.list())[0].workspaces).toEqual([{ id: 'ws-guest', title: 'Renamed' }]),
        );
      });
    });
  });

  it('guest-sessions:leave revokes on the host (5 s bound), forgets locally, then tears the host windows down', async () => {
    installGuest();
    const { mod, ensureLocalWindowBeforeClose, closeForBackend } = await loadModule();
    const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as { status: string };
    guest.status = 'connected';
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:leave')!;

    await expect(handler({}, { id: GUEST.id })).resolves.toEqual({ id: GUEST.id, revoked: true });
    const revokeIndex = rpc.calls.indexOf('principal.revokeSelf');
    expect(revokeIndex).toBeGreaterThanOrEqual(0);
    expect(rpc.options[revokeIndex]).toEqual({ timeoutMs: mod.GUEST_REVOKE_SELF_TIMEOUT_MS });
    expect(mod.GUEST_REVOKE_SELF_TIMEOUT_MS).toBe(5000);
    expect(guestStore.forget).toHaveBeenCalledWith(GUEST.id);
    expect(ensureLocalWindowBeforeClose).toHaveBeenCalledWith(GUEST.id);
    expect(closeForBackend).toHaveBeenCalledWith(GUEST.id);
    expect(mod.getBackendClientForConnection(GUEST.id)).toBeUndefined();
    // The paired-backend registry is never touched by a guest leave.
    expect(store.forget).not.toHaveBeenCalled();
  });

  it('guest-sessions:leave still deletes locally when principal.revokeSelf fails, logging only a bounded code', async () => {
    installGuest();
    const sentinel = 'SENTINEL-host-detail-7f3a';
    rpc.handler = async (method) => {
      if (method === 'principal.revokeSelf') throw new Error(`host unreachable ${sentinel}`);
      return {};
    };
    // Same module registry as the loaded backend.ipc (vi.resetModules ran in
    // beforeEach), so the spy lands on the Logger class it actually binds.
    const { Logger } = await import('$shared/logger');
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const { mod, closeForBackend } = await loadModule();
    const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as { status: string };
    guest.status = 'connected';
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:leave')!;

    await expect(handler({}, { id: GUEST.id })).resolves.toEqual({ id: GUEST.id, revoked: false });
    expect(rpc.calls).toContain('principal.revokeSelf');
    expect(guestStore.forget).toHaveBeenCalledWith(GUEST.id);
    expect(closeForBackend).toHaveBeenCalledWith(GUEST.id);
    const revokeWarn = warn.mock.calls.find(([message]) => /revokeSelf/.test(String(message)));
    expect(revokeWarn).toBeDefined();
    expect(JSON.stringify(revokeWarn)).not.toContain(sentinel);
    expect(revokeWarn![1]).toEqual({ id: GUEST.id, code: 'transport' });
  });

  it('guest-sessions:leave skips the revoke when no pooled client is connected', async () => {
    installGuest();
    const { mod, closeForBackend } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:leave')!;

    await expect(handler({}, { id: GUEST.id })).resolves.toEqual({ id: GUEST.id, revoked: false });
    expect(rpc.calls).not.toContain('principal.revokeSelf');
    expect(guestStore.forget).toHaveBeenCalledWith(GUEST.id);
    expect(closeForBackend).toHaveBeenCalledWith(GUEST.id);
  });

  it('guest-sessions:leave settles an already-absent id as completion without touching any store', async () => {
    const { mod, closeForBackend } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:leave')!;

    await expect(handler({}, { id: 'guest-unknown' })).resolves.toEqual({
      id: 'guest-unknown',
      revoked: false,
    });
    expect(rpc.calls).not.toContain('principal.revokeSelf');
    expect(guestStore.forget).not.toHaveBeenCalled();
    expect(closeForBackend).not.toHaveBeenCalled();
  });

  it('guest-sessions:leave-workspace asks the host over the pooled client (10 s bound) and drops the workspace locally', async () => {
    installGuest();
    rpc.handler = async (method) => (method === 'workspace.members.leave' ? { left: true } : {});
    const { mod, closeForBackend } = await loadModule();
    const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as { status: string };
    guest.status = 'connected';
    mod.registerBackendHandlers();
    const constructed = lifecycle.events.filter((e) => e.type === 'construct').length;
    const handler = findHandler('guest-sessions:leave-workspace')!;

    await expect(handler({}, { id: GUEST.id, workspaceId: 'ws-guest' })).resolves.toEqual({
      id: GUEST.id,
      workspaceId: 'ws-guest',
      left: true,
    });
    const leaveIndex = rpc.calls.indexOf('workspace.members.leave');
    expect(leaveIndex).toBeGreaterThanOrEqual(0);
    expect(rpc.params[leaveIndex]).toEqual({ workspaceId: 'ws-guest' });
    expect(rpc.options[leaveIndex]).toEqual({ timeoutMs: mod.GUEST_LEAVE_WORKSPACE_TIMEOUT_MS });
    expect(mod.GUEST_LEAVE_WORKSPACE_TIMEOUT_MS).toBe(10_000);
    expect(guestStore.leaveWorkspace).toHaveBeenCalledWith(GUEST.id, 'ws-guest');
    // No throwaway client: the pooled one served the request.
    expect(lifecycle.events.filter((e) => e.type === 'construct')).toHaveLength(constructed);
    // The session and its windows stay: only *Leave host* forgets / tears down.
    expect(guestStore.forget).not.toHaveBeenCalled();
    expect(closeForBackend).not.toHaveBeenCalled();
    expect(mod.getBackendClientForConnection(GUEST.id)).toBeDefined();
  });

  it('guest-sessions:leave-workspace dials a short-lived client when the host has no pooled client, and never pools it', async () => {
    installGuest();
    rpc.handler = async (method) => (method === 'workspace.members.leave' ? { left: true } : {});
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:leave-workspace')!;

    await expect(handler({}, { id: GUEST.id, workspaceId: 'ws-guest' })).resolves.toEqual({
      id: GUEST.id,
      workspaceId: 'ws-guest',
      left: true,
    });
    expect(rpc.calls).toContain('workspace.members.leave');
    const constructs = lifecycle.events.filter((e) => e.type === 'construct');
    expect(constructs).toHaveLength(1);
    expect(lifecycle.events).toContainEqual({ type: 'dispose', seq: constructs[0].seq });
    expect(mod.getBackendClientForConnection(GUEST.id)).toBeUndefined();
    expect(guestStore.leaveWorkspace).toHaveBeenCalledWith(GUEST.id, 'ws-guest');
  });

  it('guest-sessions:leave-workspace keeps the local record and rejects bounded when the host refuses', async () => {
    installGuest();
    const sentinel = 'SENTINEL-leave-detail-2c9e';
    rpc.handler = async (method) => {
      if (method === 'workspace.members.leave') throw new Error(`socket closed ${sentinel}`);
      return {};
    };
    const { Logger } = await import('$shared/logger');
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const { mod } = await loadModule();
    const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as { status: string };
    guest.status = 'connected';
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:leave-workspace')!;

    const failure = (await handler({}, { id: GUEST.id, workspaceId: 'ws-guest' }).catch(
      (e: unknown) => e,
    )) as Error & { code?: string };
    expect(failure).toBeInstanceOf(mod.GuestWorkspaceLeaveError);
    expect(failure.code).toBe('transport');
    expect(failure.message).not.toContain(sentinel);
    expect(guestStore.leaveWorkspace).not.toHaveBeenCalled();
    const leaveWarn = warn.mock.calls.find(([message]) => /members\.leave/.test(String(message)));
    expect(leaveWarn).toBeDefined();
    expect(JSON.stringify(leaveWarn)).not.toContain(sentinel);
    expect(leaveWarn![1]).toEqual({ id: GUEST.id, workspaceId: 'ws-guest', code: 'transport' });
  });

  it('guest-sessions:leave-workspace treats an already-gone membership (-32602) as done and drops the record', async () => {
    installGuest();
    const { JsonRpcError } = await import('../json-rpc-errors');
    rpc.handler = async (method) => {
      if (method === 'workspace.members.leave')
        throw new JsonRpcError({ code: -32602, message: 'not a member' });
      return {};
    };
    const { mod } = await loadModule();
    const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as { status: string };
    guest.status = 'connected';
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:leave-workspace')!;

    await expect(handler({}, { id: GUEST.id, workspaceId: 'ws-guest' })).resolves.toEqual({
      id: GUEST.id,
      workspaceId: 'ws-guest',
      left: false,
    });
    expect(guestStore.leaveWorkspace).toHaveBeenCalledWith(GUEST.id, 'ws-guest');
  });

  it('guest-sessions:leave-workspace settles a workspace absent from the record as completion without an RPC', async () => {
    installGuest();
    const { mod } = await loadModule();
    const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as { status: string };
    guest.status = 'connected';
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:leave-workspace')!;

    await expect(handler({}, { id: GUEST.id, workspaceId: 'ws-elsewhere' })).resolves.toEqual({
      id: GUEST.id,
      workspaceId: 'ws-elsewhere',
      left: false,
    });
    await expect(handler({}, { id: 'guest-unknown', workspaceId: 'ws-guest' })).resolves.toEqual({
      id: 'guest-unknown',
      workspaceId: 'ws-guest',
      left: false,
    });
    expect(rpc.calls).not.toContain('workspace.members.leave');
    expect(guestStore.leaveWorkspace).not.toHaveBeenCalled();
  });

  /** Store double whose row disappears on forget, like the real registry. */
  function installForgettableGuest() {
    let present = true;
    guestStore.list.mockImplementation(async () => (present ? [GUEST] : []));
    guestStore.findById.mockImplementation(async (id: string) =>
      present && id === GUEST.id ? GUEST : null,
    );
    guestStore.forget.mockImplementation(async (id: string) => {
      if (id === GUEST.id) present = false;
      return true;
    });
    guestStore.getDecryptedToken.mockResolvedValue('guest-token-v1');
  }

  it('a repeated guest-sessions:leave after a successful leave is idempotent', async () => {
    installForgettableGuest();
    const { mod, closeForBackend } = await loadModule();
    const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as { status: string };
    guest.status = 'connected';
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:leave')!;

    await expect(handler({}, { id: GUEST.id })).resolves.toEqual({ id: GUEST.id, revoked: true });
    await expect(handler({}, { id: GUEST.id })).resolves.toEqual({ id: GUEST.id, revoked: false });
    expect(rpc.calls.filter((m) => m === 'principal.revokeSelf')).toHaveLength(1);
    expect(guestStore.forget).toHaveBeenCalledTimes(1);
    expect(closeForBackend).toHaveBeenCalledTimes(1);
  });

  it('concurrent guest-sessions:leave calls for one host revoke and forget exactly once', async () => {
    installForgettableGuest();
    const { mod, closeForBackend } = await loadModule();
    const guest = (await mod.connectBackendClient(GUEST.id)) as unknown as { status: string };
    guest.status = 'connected';
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:leave')!;

    const results = await Promise.all([
      handler({}, { id: GUEST.id }),
      handler({}, { id: GUEST.id }),
      handler({}, { id: GUEST.id }),
    ]);
    expect(results).toEqual([
      { id: GUEST.id, revoked: true },
      { id: GUEST.id, revoked: false },
      { id: GUEST.id, revoked: false },
    ]);
    expect(rpc.calls.filter((m) => m === 'principal.revokeSelf')).toHaveLength(1);
    expect(guestStore.forget).toHaveBeenCalledTimes(1);
    expect(closeForBackend).toHaveBeenCalledTimes(1);
    expect(mod.getBackendClientForConnection(GUEST.id)).toBeUndefined();
  });

  it('a repeated leave tears down a pooled client the first leave left behind, but never a paired one', async () => {
    installGuest();
    const { mod, closeForBackend } = await loadModule();
    await mod.connectBackendClient(GUEST.id);
    await mod.connectBackendClient(REMOTE.id);
    mod.registerBackendHandlers();
    const handler = findHandler('guest-sessions:leave')!;
    // The row is gone (forgotten by a leave whose teardown did not finish) but
    // the pooled client survived.
    guestStore.findById.mockResolvedValue(null);

    await expect(handler({}, { id: GUEST.id })).resolves.toEqual({ id: GUEST.id, revoked: false });
    expect(rpc.calls).not.toContain('principal.revokeSelf');
    expect(guestStore.forget).not.toHaveBeenCalled();
    expect(closeForBackend).toHaveBeenCalledWith(GUEST.id);
    expect(mod.getBackendClientForConnection(GUEST.id)).toBeUndefined();

    await expect(handler({}, { id: REMOTE.id })).resolves.toEqual({
      id: REMOTE.id,
      revoked: false,
    });
    expect(closeForBackend).not.toHaveBeenCalledWith(REMOTE.id);
    expect(mod.getBackendClientForConnection(REMOTE.id)).toBeDefined();
    expect(store.forget).not.toHaveBeenCalled();
  });
});
