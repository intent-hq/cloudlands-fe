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
    getStatus(): string {
      return 'disconnected';
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
  setHosts: store.setHosts,
  getDetectHosts: store.getDetectHosts,
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
  mod.__setBackendWindowHooksForTesting({ captureAndClose, restore, openOrFocus });
  return { mod, captureAndClose, restore, openOrFocus };
}

/** Install a single fake renderer window and return its `send` spy. */
function installWindow() {
  const send = vi.fn();
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
    { id: 1, isDestroyed: () => false, webContents: { send } } as never,
  ]);
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
  return { localSender, remoteSender, localSend, remoteSend };
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
  store.setHosts.mockResolvedValue(undefined);
  store.getDetectHosts.mockResolvedValue(true);
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
// WSS auth-rejection propagation
// ---------------------------------------------------------------------------

describe('WSS auth-rejection propagation', () => {
  it('emits a single connections:auth-rejected failure event on AuthRejectedError', async () => {
    const send = installWindow();
    const { mod } = await loadModule();
    const { AuthRejectedError } = await import('../backend-connection');

    await mod.switchBackend('remote-1'); // now pinned to REMOTE
    const client = mod.getBackendClient() as unknown as {
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
    installWindow();
    const { mod } = await loadModule();
    const { AuthRejectedError } = await import('../backend-connection');
    mod.registerBackendHandlers();

    await mod.switchBackend('remote-1');
    const client = mod.getBackendClient() as unknown as {
      emit(event: string, arg: unknown): void;
    };
    client.emit('error', new AuthRejectedError(401));

    // A renderer created/reloaded AFTER the one-shot broadcast still learns the
    // rejection from its initial list fetch (the sticky #823 pattern).
    const handler = findHandler('connections:list');
    await expect(handler!({}, undefined)).resolves.toMatchObject({
      authRejected: { id: 'remote-1', host: '10.0.0.5', port: 8443, statusCode: 401 },
    });

    // A fresh client (re-pair / switch) clears the latch: the list stops
    // replaying a rejection that no longer describes the live client.
    await mod.switchBackend('remote-1');
    await expect(handler!({}, undefined)).resolves.toMatchObject({ authRejected: null });
  });

  it('carries the 403 statusCode (WS API disabled) on the payload', async () => {
    const send = installWindow();
    const { mod } = await loadModule();
    const { AuthRejectedError } = await import('../backend-connection');

    await mod.switchBackend('remote-1');
    const client = mod.getBackendClient() as unknown as {
      emit(event: string, arg: unknown): void;
    };

    client.emit('error', new AuthRejectedError(403));

    const rejectedCalls = send.mock.calls.filter(([c]) => c === 'connections:auth-rejected');
    expect(rejectedCalls).toHaveLength(1);
    expect(rejectedCalls[0][1]).toMatchObject({ statusCode: 403 });
  });

  it('resets the once-latch when a fresh client is constructed', async () => {
    const send = installWindow();
    const { mod } = await loadModule();
    const { AuthRejectedError } = await import('../backend-connection');

    await mod.switchBackend('remote-1');
    let client = mod.getBackendClient() as unknown as {
      emit(event: string, arg: unknown): void;
    };
    client.emit('error', new AuthRejectedError(401));
    expect(send.mock.calls.filter(([c]) => c === 'connections:auth-rejected')).toHaveLength(1);

    // A switch disposes the old client and builds a fresh one → latch resets.
    await mod.switchBackend('remote-1');
    client = mod.getBackendClient() as unknown as { emit(event: string, arg: unknown): void };
    client.emit('error', new AuthRejectedError(401));
    expect(send.mock.calls.filter(([c]) => c === 'connections:auth-rejected')).toHaveLength(2);
  });

  it('does not emit an auth-rejected event for a generic transport error', async () => {
    const send = installWindow();
    const { mod } = await loadModule();
    await mod.switchBackend('remote-1');
    const client = mod.getBackendClient() as unknown as {
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
      // No remote handshake has mismatched, so there is no sticky mismatch (#823).
      protocolMismatch: null,
      // No auth rejection has fired, so there is no sticky rejection either.
      authRejected: null,
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
    mod.getBackendClient(); // client #1 (pinned to whatever was live)
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

  it('rejects invalid params (missing id on open) via the Zod schema', async () => {
    const { mod } = await loadModule();
    mod.registerBackendHandlers();
    const handler = findHandler('connections:open');

    await expect(handler!({}, {})).rejects.toThrow();
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
    const config = mod.getBackendClient().getConfig() as { host?: string; hosts?: string[] };
    expect(config.host).toBe('10.0.0.5');
    expect(config.hosts).toEqual(['10.0.0.5', '192.168.1.5']);
  });

  it('switchBackend falls back to a one-element host list for records without hosts', async () => {
    const { mod } = await loadModule();
    await mod.switchBackend('remote-1');
    const config = mod.getBackendClient().getConfig() as { hosts?: string[] };
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

    // The hostname capture still runs, but no pairingInfo call and no setHosts.
    await vi.waitFor(() => expect(rpc.calls).toContain('host.status'));
    expect(rpc.calls).not.toContain('server.pairingInfo');
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

  it('drops a pairingInfo result that lands after a switch to another backend', async () => {
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
    await mod.switchBackend('remote-1');
    await vi.waitFor(() => expect(rpc.calls).toContain('server.pairingInfo'));

    // The active backend changes while the refresh is still in flight…
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
    await mod.connectBackendClient('remote-1');
    lifecycle.events = [];

    mod.disconnectBackendClient('remote-1');

    expect(lifecycle.events.map((event) => event.type)).toEqual(['dispose']);
    expect(mod.getBackendClient()).toBe(local);
    expect(mod.getBackendClientForConnection('local')).toBe(local);
    expect(mod.getBackendClientForConnection('remote-1')).toBeUndefined();
  });
});

describe('per-window backend IPC routing', () => {
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
