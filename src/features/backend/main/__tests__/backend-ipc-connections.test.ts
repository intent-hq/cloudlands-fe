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
  getLocalDaemonProtocolVersion: vi.fn(() => null),
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
  updateMetadata: vi.fn(),
  replaceSecret: vi.fn(),
  forget: vi.fn(),
  getDecryptedToken: vi.fn(),
  setHostname: vi.fn(),
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
  setDaemonVersion: store.setDaemonVersion,
  setUpdateSupported: store.setUpdateSupported,
  setTcAddress: store.setTcAddress,
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

    // Ordering: construct/start the target's client, and open its window only
    // after the connect + authenticated probe. The local pool member (#1) is
    // never disposed — main-process services stay on it.
    const kinds = lifecycle.events.map((e) => `${e.type}#${e.seq}`);
    expect(kinds).toEqual(['construct#1', 'start#1', 'construct#2', 'start#2', 'open#0']);

    // The open never flips the persisted whole-app selection.
    expect(store.setActiveId).not.toHaveBeenCalled();
    expect(openOrFocus).toHaveBeenCalledWith('remote-1');
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
    const { mod } = await loadModule();
    const remote = (await mod.connectBackendClient('remote-1')) as unknown as { status: string };
    remote.status = 'connected';
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update-backend');
    expect(handler).toBeDefined();

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({ ok: true });
    expect(rpc.calls).toContain('system.requestUpdate');
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

  it('connections:update changes remote presentation metadata without revalidating its saved address', async () => {
    const updated = { ...REMOTE, label: 'Editing Mac', accent: 'violet' as const };
    store.getDecryptedToken.mockRejectedValue(new Error('undecryptable secret material'));
    store.updateMetadata.mockResolvedValue(updated);
    const send = installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:update');

    await expect(
      handler!({}, { id: REMOTE.id, label: 'Editing Mac', accent: 'violet' }),
    ).resolves.toEqual({ status: 'updated', connection: updated });
    expect(store.updateMetadata).toHaveBeenCalledWith(REMOTE.id, {
      label: 'Editing Mac',
      accent: 'violet',
      host: REMOTE.host,
      port: REMOTE.port,
      fingerprint: REMOTE.fingerprint,
    });
    expect(mockCaptureFingerprint).not.toHaveBeenCalled();
    expect(store.getDecryptedToken).not.toHaveBeenCalled();
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
    // A remote open's probe is bounded (5s) so a black-holed connect cannot
    // sit out the 30s client default before the window appears.
    expect(remote?.request).toHaveBeenCalledWith('host.status', undefined, {
      timeoutMs: 5_000,
    });
    expect(mod.getBackendClient()).toBe(local);
    expect(mod.getBackendClientForConnection('local')).toBe(local);
    expect(openOrFocus).toHaveBeenCalledWith('remote-1');
    expect(store.setActiveId).not.toHaveBeenCalled();
  });

  it('connections:open opens the window and retains the client when the remote probe fails', async () => {
    // An unreachable/rejecting remote must not fail the click silently: the
    // window opens anyway, the pooled client is RETAINED (its reconnect loop
    // keeps retrying), and the renderer's connection-lost overlay owns
    // recovery. Local stays untouched.
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

  it('connections:open opens the window on a probe auth/cert failure and replays the latched event', async () => {
    // A cert-mismatch/auth-rejected probe failure also opens the window: the
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

  it('connections:publish-self rejects when every local IP is loopback (nothing routable)', async () => {
    installPairingInfo({ localIps: ['127.0.0.1', '::1'] });
    store.add.mockResolvedValue(SELF_RECORD);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await expect(findHandler('connections:publish-self')!({}, undefined)).rejects.toThrow(
      /no routable local IP/,
    );
    expect(store.add).not.toHaveBeenCalled();
  });

  it('connections:publish-self persists the pairingInfo tcAddress on the self record', async () => {
    installPairingInfo({ tcAddress: 'tc7f2a91.tailcat.net' });
    store.add.mockResolvedValue(SELF_RECORD);
    installWindow();
    const { mod } = await loadModule();
    mod.registerBackendHandlers();

    await findHandler('connections:publish-self')!({}, undefined);
    expect(store.setTcAddress).toHaveBeenCalledWith('self-1', 'tc7f2a91.tailcat.net');
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
        return { localIps: ['10.0.0.5'], tcAddress: 'tc7f2a91.tailcat.net' };
      }
      return {};
    };
    const { mod } = await loadModule();
    await mod.openBackendWindow('remote-1');

    await vi.waitFor(() =>
      expect(store.setTcAddress).toHaveBeenCalledWith('remote-1', 'tc7f2a91.tailcat.net'),
    );
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
