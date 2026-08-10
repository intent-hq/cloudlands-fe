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

import { BrowserWindow, ipcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Global lifecycle log so tests can assert construct/start/dispose ordering. */
const lifecycle = vi.hoisted(() => ({ events: [] as Array<{ type: string; seq: number }> }));

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
    request = vi.fn(async () => ({}));
    registerMethod(): () => void {
      return () => {};
    }
    getConfig(): unknown {
      return this.config;
    }
    getStatus(): string {
      return 'disconnected';
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
}));
vi.mock('../connections-store', () => ({
  LOCAL_CONNECTION_ID: 'local',
  list: store.list,
  getActiveId: store.getActiveId,
  setActiveId: store.setActiveId,
  add: store.add,
  forget: store.forget,
  getDecryptedToken: store.getDecryptedToken,
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
  mod.__setBackendWindowHooksForTesting({ captureAndClose, restore });
  return { mod, captureAndClose, restore };
}

/** Install a single fake renderer window and return its `send` spy. */
function installWindow() {
  const send = vi.fn();
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
    { id: 1, isDestroyed: () => false, webContents: { send } } as never,
  ]);
  return send;
}

function findHandler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === channel);
  return call?.[1] as ((event: unknown, data: unknown) => Promise<unknown>) | undefined;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  lifecycle.events = [];
  // Sensible defaults; individual tests override.
  store.getActiveId.mockResolvedValue('local');
  store.list.mockResolvedValue([LOCAL, REMOTE]);
  store.setActiveId.mockResolvedValue(undefined);
  store.getDecryptedToken.mockResolvedValue('secret-token');
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
});

afterEach(() => {
  vi.doUnmock('../backend.ipc');
});

// ---------------------------------------------------------------------------
// Teardown-before-connect ordering
// ---------------------------------------------------------------------------

describe('switchBackend teardown-before-connect', () => {
  it('captures+closes old windows, disposes the old client, then connects + restores', async () => {
    const { mod, captureAndClose, restore } = await loadModule();
    mod.getBackendClient(); // client #1 (local)
    expect(lifecycle.events).toEqual([
      { type: 'construct', seq: 1 },
      { type: 'start', seq: 1 },
    ]);

    const result = await mod.switchBackend('remote-1');
    expect(result).toEqual({ activeId: 'remote-1' });

    // Ordering: capture+close the OLD windows, dispose(#1) BEFORE the new client
    // is constructed/started, and restore the NEW windows only after the swap.
    const kinds = lifecycle.events.map((e) => `${e.type}#${e.seq}`);
    expect(kinds).toEqual([
      'construct#1',
      'start#1',
      'capture#0',
      'dispose#1',
      'construct#2',
      'start#2',
      'restore#0',
    ]);

    // Active id flipped; hooks ran with the right from/to ids.
    expect(store.setActiveId).toHaveBeenCalledWith('remote-1');
    expect(captureAndClose).toHaveBeenCalledWith('local');
    expect(restore).toHaveBeenCalledWith('remote-1');
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
    const send = installWindow();
    const { mod } = await loadModule();
    const { PinMismatchError } = await import('../backend-connection');

    await mod.switchBackend('remote-1'); // now pinned to REMOTE
    const client = mod.getBackendClient() as unknown as {
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
    const send = installWindow();
    const { mod } = await loadModule();
    await mod.switchBackend('remote-1');
    const client = mod.getBackendClient() as unknown as {
      emit(event: string, arg: unknown): void;
    };

    client.emit('error', new Error('ECONNRESET'));
    expect(send.mock.calls.some(([c]) => c === 'connections:cert-mismatch')).toBe(false);
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
      // No remote handshake has mismatched, so there is no sticky mismatch (#823).
      protocolMismatch: null,
    });
  });

  it('connections:capture-fingerprint returns the presented fingerprint', async () => {
    mockCaptureFingerprint.mockResolvedValue({ ok: true, fingerprint: 'AA:BB:CC:DD' });
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:capture-fingerprint');

    await expect(handler!({}, { host: '10.0.0.5', port: 8443, token: 'tok' })).resolves.toEqual({
      fingerprint: 'AA:BB:CC:DD',
    });
    expect(mockCaptureFingerprint).toHaveBeenCalledWith({
      host: '10.0.0.5',
      port: 8443,
      token: 'tok',
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
    await expect(handler!({}, params)).resolves.toEqual({ connection: REMOTE });
    expect(store.add).toHaveBeenCalledWith(params);
    expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true);
  });

  it('connections:forget of a non-active connection just broadcasts', async () => {
    store.getActiveId.mockResolvedValue('local');
    store.forget.mockResolvedValue(undefined);
    const send = installWindow();
    const { mod, captureAndClose, restore } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:forget');

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({ id: 'remote-1' });
    expect(store.forget).toHaveBeenCalledWith('remote-1');
    // Was not the live backend → no full switch/window teardown.
    expect(captureAndClose).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(send.mock.calls.some(([c]) => c === 'connections:changed')).toBe(true);
  });

  it('connections:forget of the ACTIVE connection falls back to a switch to local', async () => {
    store.getActiveId.mockResolvedValue('remote-1');
    store.forget.mockResolvedValue(undefined);
    installWindow();
    const { mod, captureAndClose, restore } = await loadModule();
    mod.getBackendClient();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:forget');

    await expect(handler!({}, { id: 'remote-1' })).resolves.toEqual({ id: 'remote-1' });
    expect(store.forget).toHaveBeenCalledWith('remote-1');
    // Fell back to local: active id flipped + windows switched from remote → local.
    expect(store.setActiveId).toHaveBeenCalledWith('local');
    expect(captureAndClose).toHaveBeenCalledWith('remote-1');
    expect(restore).toHaveBeenCalledWith('local');
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
});
