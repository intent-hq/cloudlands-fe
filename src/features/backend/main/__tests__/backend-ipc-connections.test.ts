/**
 * T3 — switch orchestration + connections registry IPC (backend.ipc.ts).
 *
 * Covers the two behaviours the spec calls out as must-assert:
 *   - **Teardown-before-connect**: a `switchBackend` disposes the previous
 *     JSON-RPC client (socket/timers/listeners) BEFORE the new target's client
 *     is constructed/started, and a bad target is rejected before ANY teardown.
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
}));

vi.mock('../json-rpc-client', () => {
  let seq = 0;
  class FakeJsonRpcClient {
    private readonly id = ++seq;
    private readonly config: unknown;
    private readonly listeners = new Map<string, Array<(arg: unknown) => void>>();
    constructor(opts: { config: unknown }) {
      this.config = opts.config;
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
      for (const h of this.listeners.get(event) ?? []) h(arg);
    }
    start(): void {
      lifecycle.events.push({ type: 'start', seq: this.id });
    }
    dispose(): void {
      lifecycle.events.push({ type: 'dispose', seq: this.id });
    }
    request = vi.fn(async (method: string) => {
      rpc.calls.push(method);
      return rpc.handler(method);
    });
    registerMethod(): () => void {
      return () => {};
    }
    getConfig(): unknown {
      return this.config;
    }
    /** Steerable status so connectivity-gated paths can be exercised. */
    status = 'disconnected';
    getStatus(): string {
      return this.status;
    }
    getReconnectAttempts(): number {
      return 0;
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
  spawnSidecarOnDemand: vi.fn(),
}));

vi.mock('../../../browser/main/browser-exec-reverse', () => ({
  registerBrowserExecReverseHandler: vi.fn(),
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
  forget: vi.fn(),
  getDecryptedToken: vi.fn(),
  setHostname: vi.fn(),
  setDaemonVersion: vi.fn(),
  setHosts: vi.fn(),
  getDetectHosts: vi.fn(),
}));
vi.mock('../connections-store', () => ({
  LOCAL_CONNECTION_ID: 'local',
  list: store.list,
  getActiveId: store.getActiveId,
  setActiveId: store.setActiveId,
  add: store.add,
  forget: store.forget,
  getDecryptedToken: store.getDecryptedToken,
  setHostname: store.setHostname,
  setDaemonVersion: store.setDaemonVersion,
  setHosts: store.setHosts,
  getDetectHosts: store.getDetectHosts,
  // Keychain-sync lifecycle wiring (T3); inert in these suites.
  onConnectionsMutated: () => () => {},
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

/** Import a fresh backend.ipc module and inject window-teardown hook spies. */
async function loadModule() {
  const mod = await import('../backend.ipc');
  // Spies record into the shared lifecycle log so ordering vs client
  // construct/dispose can be asserted (capture BEFORE dispose, restore AFTER).
  const captureAndClose = vi.fn(async () => {
    lifecycle.events.push({ type: 'capture', seq: 0 });
  });
  const restore = vi.fn(() => {
    lifecycle.events.push({ type: 'restore', seq: 0 });
  });
  const openOrFocus = vi.fn();
  const ensureLocalWindowBeforeClose = vi.fn();
  const closeForBackend = vi.fn();
  mod.__setBackendWindowHooksForTesting({
    captureAndClose,
    restore,
    openOrFocus,
    ensureLocalWindowBeforeClose,
    closeForBackend,
  });
  return {
    mod,
    captureAndClose,
    restore,
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
  // Sensible defaults; individual tests override.
  store.getActiveId.mockResolvedValue('local');
  store.list.mockResolvedValue([LOCAL, REMOTE]);
  store.setActiveId.mockResolvedValue(undefined);
  store.getDecryptedToken.mockResolvedValue('secret-token');
  store.setHostname.mockResolvedValue(undefined);
  store.setDaemonVersion.mockResolvedValue(false);
  store.setHosts.mockResolvedValue(undefined);
  store.getDetectHosts.mockResolvedValue(true);
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
// Teardown-before-connect ordering
// ---------------------------------------------------------------------------

describe('switchBackend teardown-before-connect', () => {
  it('captures+closes old windows, keeps local connected, then connects + restores', async () => {
    const { mod, captureAndClose, restore } = await loadModule();
    mod.getBackendClient(); // client #1 (local)
    expect(lifecycle.events).toEqual([
      { type: 'construct', seq: 1 },
      { type: 'start', seq: 1 },
    ]);

    const result = await mod.switchBackend('remote-1');
    expect(result).toEqual({ activeId: 'remote-1' });

    // Ordering: capture+close the OLD windows, then construct/start the new
    // client, and restore the NEW windows only after the connect. The local
    // pool member (#1) is never disposed — main-process services stay on it.
    const kinds = lifecycle.events.map((e) => `${e.type}#${e.seq}`);
    expect(kinds).toEqual([
      'construct#1',
      'start#1',
      'capture#0',
      'construct#2',
      'start#2',
      'restore#0',
    ]);

    // Active id flipped; hooks ran with the right from/to ids.
    expect(store.setActiveId).toHaveBeenCalledWith('remote-1');
    expect(captureAndClose).toHaveBeenCalledWith('local');
    expect(restore).toHaveBeenCalledWith('remote-1');

    // Menu-rebuild trigger fired so backend-gated items track the switch (#1889).
    expect(vi.mocked(app.emit)).toHaveBeenCalledWith('backend-connection-changed');
  });

  it('rejects an unknown target BEFORE any teardown (live client untouched)', async () => {
    store.list.mockResolvedValue([LOCAL]); // no remote-1
    const { mod, captureAndClose, restore } = await loadModule();
    mod.getBackendClient(); // client #1
    lifecycle.events = [];

    await expect(mod.switchBackend('remote-1')).rejects.toThrow(/unknown or incomplete/i);

    // No window teardown, no dispose, no new construct, no active-id flip.
    expect(lifecycle.events).toEqual([]);
    expect(store.setActiveId).not.toHaveBeenCalled();
    expect(captureAndClose).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it('rejects a remote with no stored token before any teardown', async () => {
    store.getDecryptedToken.mockResolvedValue(null);
    const { mod } = await loadModule();
    mod.getBackendClient();
    lifecycle.events = [];

    await expect(mod.switchBackend('remote-1')).rejects.toThrow(/no stored token/i);
    expect(lifecycle.events).toEqual([]);
    expect(store.setActiveId).not.toHaveBeenCalled();
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

    await mod.switchBackend('remote-1'); // remote-1's pooled client is live
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
    await mod.switchBackend('remote-1');
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

    // A fresh client (re-pair / switch) clears the latch: the list stops
    // replaying a mismatch that no longer describes the live client.
    mod.disconnectBackendClient('remote-1');
    await mod.connectBackendClient('remote-1');
    await expect(handler!({ sender: remoteSender }, undefined)).resolves.toMatchObject({
      certMismatch: null,
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

    await mod.switchBackend('remote-1'); // remote-1's pooled client is live
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

    await mod.switchBackend('remote-1');
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

    // A fresh client (re-pair / switch) clears the latch: the list stops
    // replaying a rejection that no longer describes the live client.
    await mod.switchBackend('remote-1');
    await expect(handler!({ sender: remoteSender }, undefined)).resolves.toMatchObject({
      authRejected: null,
    });
  });

  it('carries the 403 statusCode (WS API disabled) on the payload', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();
    const { AuthRejectedError } = await import('../backend-connection');

    await mod.switchBackend('remote-1');
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

    await mod.switchBackend('remote-1');
    let client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };
    client.emit('error', new AuthRejectedError(401));
    expect(send.mock.calls.filter(([c]) => c === 'connections:auth-rejected')).toHaveLength(1);

    // A switch disposes the old client and builds a fresh one → latch resets.
    await mod.switchBackend('remote-1');
    client = mod.getBackendClientForId('remote-1') as unknown as {
      emit(event: string, arg: unknown): void;
    };
    client.emit('error', new AuthRejectedError(401));
    expect(send.mock.calls.filter(([c]) => c === 'connections:auth-rejected')).toHaveLength(2);
  });

  it('does not emit an auth-rejected event for a generic transport error', async () => {
    const send = installWindow('remote-1');
    const { mod } = await loadModule();
    await mod.switchBackend('remote-1');
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
      connections: [LOCAL, REMOTE],
      activeId: 'local',
      windowBackendId: 'local',
      // No remote handshake has mismatched, so there is no sticky mismatch (#823).
      protocolMismatch: null,
      // No auth rejection has fired, so there is no sticky rejection either.
      authRejected: null,
      // No pinned cert has mismatched, so there is no sticky cert failure.
      certMismatch: null,
      // The app's pinned intentd version rides the list payload.
      pinnedVersion: '0.1.0',
      // No client reports 'connected' (the fake pool returns 'disconnected').
      connectedIds: [],
    });
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
    const { mod } = await loadModule();
    const remote = (await mod.connectBackendClient('remote-1')) as unknown as { status: string };
    remote.status = 'connected';
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update-backend');
    expect(handler).toBeDefined();

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({ ok: true });
    expect(rpc.calls).toContain('system.requestUpdate');
  });

  it('connections:update-backend rejects the local id as unsupported', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:update-backend')!({}, { id: 'local' })).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(rpc.calls).not.toContain('system.requestUpdate');
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

  it('connections:add upserting a NON-active connection does not reconnect', async () => {
    store.add.mockResolvedValue(REMOTE);
    store.getActiveId.mockResolvedValue('local');
    installWindow();
    const { mod, captureAndClose, restore } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:add');

    await handler!(
      {},
      { label: 'Studio Mac', host: '10.0.0.5', port: 8443, fingerprint: 'AA:BB:CC:DD', token: 't' },
    );
    // Not the live backend → no client swap / window teardown.
    expect(captureAndClose).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it('connections:add refreshes an active client without tearing down windows', async () => {
    store.add.mockResolvedValue(REMOTE);
    store.getActiveId.mockResolvedValue('remote-1');
    const send = installWindow();
    const { mod, captureAndClose, restore } = await loadModule();
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
    expect(captureAndClose).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(store.setActiveId).not.toHaveBeenCalled();
    expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true);
  });

  it('connections:open keeps the local client and windows while opening the remote', async () => {
    const { mod, captureAndClose, openOrFocus } = await loadModule();
    const local = mod.getBackendClient();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:open');

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({ id: 'remote-1' });

    const remote = mod.getBackendClientForConnection('remote-1');
    expect(remote).toBeDefined();
    expect(remote).not.toBe(local);
    expect(remote?.request).toHaveBeenCalledWith('host.status');
    expect(mod.getBackendClient()).toBe(local);
    expect(mod.getBackendClientForConnection('local')).toBe(local);
    expect(captureAndClose).not.toHaveBeenCalled();
    expect(openOrFocus).toHaveBeenCalledWith('remote-1');
    expect(store.setActiveId).not.toHaveBeenCalled();
  });

  it('connections:open drops only a failed remote and leaves local usable', async () => {
    rpc.handler = async (method) => {
      if (method === 'host.status') throw new Error('remote rejected');
      return {};
    };
    const { mod, captureAndClose, openOrFocus } = await loadModule();
    const local = mod.getBackendClient();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:open');

    await expect(handler!({}, { id: 'remote-1' })).rejects.toThrow('remote rejected');

    expect(mod.getBackendClient()).toBe(local);
    expect(mod.getBackendClientForConnection('local')).toBe(local);
    expect(mod.getBackendClientForConnection('remote-1')).toBeUndefined();
    expect(captureAndClose).not.toHaveBeenCalled();
    expect(openOrFocus).not.toHaveBeenCalled();
  });

  it('connections:forget closes and disconnects only that secondary backend', async () => {
    store.getActiveId.mockResolvedValue('local');
    store.forget.mockResolvedValue(undefined);
    const send = installWindow();
    const { mod, captureAndClose, restore, ensureLocalWindowBeforeClose, closeForBackend } =
      await loadModule();
    const local = mod.getBackendClient();
    const remote = await mod.connectBackendClient('remote-1');
    mod.registerBackendHandlers();
    const handler = findHandler('connections:forget');

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({ id: 'remote-1' });
    expect(store.forget).toHaveBeenCalledWith('remote-1');
    // Was not the live backend → no full switch/window teardown.
    expect(captureAndClose).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
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

  it('connections:forget of the active connection disposes only its pooled client', async () => {
    store.getActiveId.mockResolvedValue('remote-1');
    store.forget.mockResolvedValue(undefined);
    installWindow();
    const { mod, captureAndClose, restore, ensureLocalWindowBeforeClose, closeForBackend } =
      await loadModule();
    const local = mod.getBackendClient(); // the always-on local pool member
    await mod.switchBackend('remote-1');
    lifecycle.events = [];
    captureAndClose.mockClear();
    restore.mockClear();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:forget');

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({ id: 'remote-1' });
    expect(store.forget).toHaveBeenCalledWith('remote-1');
    expect(ensureLocalWindowBeforeClose).toHaveBeenCalledWith('remote-1');
    expect(closeForBackend).toHaveBeenCalledWith('remote-1');
    expect(ensureLocalWindowBeforeClose.mock.invocationCallOrder[0]).toBeLessThan(
      closeForBackend.mock.invocationCallOrder[0],
    );
    expect(captureAndClose).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(mod.getBackendClientForConnection('remote-1')).toBeUndefined();
    // The local pool member survives untouched — no retarget/rebuild needed.
    expect(mod.getBackendClientForConnection('local')).toBe(local);
    expect(lifecycle.events.map((event) => event.type)).toEqual(['dispose']);
  });

  it('connections:switch routes through switchBackend', async () => {
    const { mod, captureAndClose, restore } = await loadModule();
    mod.getBackendClient();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:switch');

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({ activeId: 'remote-1' });
    expect(captureAndClose).toHaveBeenCalledWith('local');
    expect(restore).toHaveBeenCalledWith('remote-1');
  });

  it('rejects invalid params (missing token on capture) via the Zod schema', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:capture-fingerprint');

    await expect(handler!({}, { host: '10.0.0.5', port: 8443 })).rejects.toThrow();
    expect(mockCaptureFingerprint).not.toHaveBeenCalled();
  });

  it('rejects invalid params (missing id on switch) via the Zod schema', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:switch');

    await expect(handler!({}, {})).rejects.toThrow();
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
      detectHosts: true,
      syncExcluded: false,
    });
    // All local IPs persist as candidate hosts; the hostname persists too.
    expect(store.setHosts).toHaveBeenCalledWith('self-1', ['192.168.1.10', '10.0.0.5']);
    expect(store.setHostname).toHaveBeenCalledWith('self-1', "Clement's Mac Studio");
    // Self fingerprint persisted (normalized) + suppression marker cleared.
    expect(localPrefs.values.get('selfBackendFingerprint')).toBe('11:22:33:44');
    expect(localPrefs.values.has('selfPublishSuppressed')).toBe(false);
    // Returned record is token-free (the store's shape) and the list rebroadcast.
    expect(result.connection.id).toBe('self-1');
    expect(result.connection).not.toHaveProperty('token');
    expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true);
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

  it('connections:publish-self works while a remote backend is active (pooled local client)', async () => {
    installPairingInfo();
    store.add.mockResolvedValue(SELF_RECORD);
    const { mod } = await loadModule();
    await mod.switchBackend('remote-1'); // remote windows active; local member persists
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

  it('refreshes via the pooled local client even while a remote backend is active', async () => {
    installPairingInfo();
    store.add.mockResolvedValue(SELF_RECORD);
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, fingerprint: '11:22:33:44' }]);
    const { mod } = await loadModule();
    await mod.switchBackend('remote-1'); // remote windows active; local member persists
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
  it('switchBackend builds the wss config with the stored candidate hosts', async () => {
    store.list.mockResolvedValue([LOCAL, { ...REMOTE, hosts: ['10.0.0.5', '192.168.1.5'] }]);
    const { mod } = await loadModule();
    await mod.switchBackend('remote-1');
    const config = mod.getBackendClientForId('remote-1').getConfig() as {
      host?: string;
      hosts?: string[];
    };
    expect(config.host).toBe('10.0.0.5');
    expect(config.hosts).toEqual(['10.0.0.5', '192.168.1.5']);
  });

  it('switchBackend falls back to a one-element host list for records without hosts', async () => {
    const { mod } = await loadModule();
    await mod.switchBackend('remote-1');
    const config = mod.getBackendClientForId('remote-1').getConfig() as { hosts?: string[] };
    expect(config.hosts).toEqual(['10.0.0.5']);
  });

  it('persists refreshed candidate hosts from server.pairingInfo after a switch', async () => {
    installWindow();
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') {
        return { localIps: ['10.0.0.5', '192.168.1.5'], hostname: 'studio' };
      }
      return {};
    };
    const { mod } = await loadModule();
    await mod.switchBackend('remote-1');

    await vi.waitFor(() =>
      expect(store.setHosts).toHaveBeenCalledWith('remote-1', ['10.0.0.5', '192.168.1.5']),
    );
  });

  it('skips the pairingInfo refresh when the record opted out of IP detection', async () => {
    store.getDetectHosts.mockResolvedValue(false);
    const { mod } = await loadModule();
    await mod.switchBackend('remote-1');

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
    // Must not reject the switch, and the stored hosts stay untouched.
    await expect(mod.switchBackend('remote-1')).resolves.toEqual({ activeId: 'remote-1' });
    await vi.waitFor(() => expect(rpc.calls).toContain('server.pairingInfo'));
    expect(store.setHosts).not.toHaveBeenCalled();
  });

  it('ignores a malformed pairingInfo result (no localIps)', async () => {
    rpc.handler = async (method) => {
      if (method === 'server.pairingInfo') return { hostname: 'studio' };
      return {};
    };
    const { mod } = await loadModule();
    await mod.switchBackend('remote-1');
    await vi.waitFor(() => expect(rpc.calls).toContain('server.pairingInfo'));
    expect(store.setHosts).not.toHaveBeenCalled();
  });

  it('drops a pairingInfo result that lands after its pooled client was torn down', async () => {
    installWindow();
    // Track the persisted active id so the second switch sees remote-1 as the
    // outgoing backend and disposes its pooled client mid-flight.
    let activeId = 'local';
    store.getActiveId.mockImplementation(async () => activeId);
    store.setActiveId.mockImplementation(async (id: string) => {
      activeId = id;
    });
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
    await mod.switchBackend('remote-1');
    await vi.waitFor(() => expect(rpc.calls).toContain('server.pairingInfo'));

    // remote-1's pooled client is disposed while the refresh is still in flight…
    await mod.switchBackend('local');
    releasePairingInfo();

    // …so the stale answer must NOT be persisted under remote-1.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.setHosts).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Switch-queue TOCTOU (monorepo#2228): the forget/add handlers make their
// active-id decision INSIDE the serialized switch queue, so a concurrent
// switch can never make the decision stale — forget's fall-back-to-local must
// not disconnect a backend the user just selected, and a re-pair of A must
// not switch back to A after the user selected B.
// ---------------------------------------------------------------------------

describe('forget/add active-id decisions inside the switch queue (monorepo#2228)', () => {
  const REMOTE2 = {
    id: 'remote-2',
    label: 'Laptop',
    host: '10.0.0.6',
    port: 8443,
    fingerprint: 'EE:FF:00:11',
    isLocal: false,
  };

  /** Stateful active-id so `setActiveId` writes are visible to later reads. */
  function installStatefulActiveId(initial: string): () => string {
    let activeId = initial;
    store.getActiveId.mockImplementation(async () => activeId);
    store.setActiveId.mockImplementation(async (id: string) => {
      activeId = id;
    });
    return () => activeId;
  }

  it('forget(A) racing a switch to B does not take the stale fall-back-to-local', async () => {
    store.list.mockResolvedValue([LOCAL, REMOTE, REMOTE2]);
    store.forget.mockResolvedValue(undefined);
    const getActive = installStatefulActiveId('remote-1');
    installWindow();
    const { mod, restore } = await loadModule();
    mod.registerBackendHandlers();
    const forgetHandler = findHandler('connections:forget')!;

    // Park the user's switch to B at its window-teardown await point…
    let releaseSwitch!: () => void;
    const gate = new Promise<void>((resolve) => (releaseSwitch = resolve));
    const captureAndClose = vi.fn(async () => {
      if (captureAndClose.mock.calls.length === 1) await gate;
    });
    mod.__setBackendWindowHooksForTesting({ captureAndClose, restore });

    const switchToB = mod.switchBackend('remote-2');
    await vi.waitFor(() => expect(captureAndClose).toHaveBeenCalledTimes(1));
    // …then forget(A) lands while that switch is still in flight.
    const forget = forgetHandler({}, { id: 'remote-1' });

    // The enqueued forget makes NO progress (not even the store forget) while
    // the switch is in flight — the whole decision waits its queue turn.
    await Promise.resolve();
    await Promise.resolve();
    expect(store.forget).not.toHaveBeenCalled();

    releaseSwitch();
    await expect(switchToB).resolves.toEqual({ activeId: 'remote-2' });
    await expect(forget).resolves.toEqual({ id: 'remote-1' });

    // A was no longer active at decision time → record forgotten, but no
    // fall-back-to-local switch: the FE stays on the B the user selected.
    expect(store.forget).toHaveBeenCalledWith('remote-1');
    expect(store.setActiveId.mock.calls.map(([id]) => id)).toEqual(['remote-2']);
    expect(getActive()).toBe('remote-2');
    expect(captureAndClose).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('remote-2');
  });

  it('re-pairing A racing a switch to B never switches back to A', async () => {
    store.list.mockResolvedValue([LOCAL, REMOTE, REMOTE2]);
    store.add.mockResolvedValue(REMOTE); // upsert of remote-1 (refreshed token)
    const getActive = installStatefulActiveId('remote-1');
    installWindow();
    const { mod, restore } = await loadModule();
    mod.registerBackendHandlers();
    const addHandler = findHandler('connections:add')!;

    // Park the user's switch to B at its window-teardown await point…
    let releaseSwitch!: () => void;
    const gate = new Promise<void>((resolve) => (releaseSwitch = resolve));
    const captureAndClose = vi.fn(async () => {
      if (captureAndClose.mock.calls.length === 1) await gate;
    });
    mod.__setBackendWindowHooksForTesting({ captureAndClose, restore });

    const switchToB = mod.switchBackend('remote-2');
    await vi.waitFor(() => expect(captureAndClose).toHaveBeenCalledTimes(1));
    // …then the re-pair of A lands while that switch is still in flight.
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

    releaseSwitch();
    await expect(switchToB).resolves.toEqual({ activeId: 'remote-2' });
    // A was no longer active at decision time → upsert only, no switch-back.
    await expect(add).resolves.toEqual({ connection: REMOTE, switched: false });

    expect(store.setActiveId.mock.calls.map(([id]) => id)).toEqual(['remote-2']);
    expect(getActive()).toBe('remote-2');
    expect(captureAndClose).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('remote-2');
  });

  it('a rejected enqueued forget does not poison the queue for later switches', async () => {
    store.forget.mockRejectedValue(new Error('cannot forget the reserved local connection'));
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const forgetHandler = findHandler('connections:forget')!;

    await expect(forgetHandler({}, { id: 'remote-1' })).rejects.toThrow(/cannot forget/i);
    await expect(mod.switchBackend('remote-1')).resolves.toEqual({ activeId: 'remote-1' });
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
