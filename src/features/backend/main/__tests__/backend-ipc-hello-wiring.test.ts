/**
 * backend.ipc.ts §5.17 identity wiring: the shared main-process JsonRpcClient
 * must be constructed with a `helloParams` provider that presents the
 * persisted clientId on every (re)connect, and an `onHelloResult` observer
 * that persists a daemon-returned clientId (first-run mint).
 *
 * Also covers the sidecar run-log bridge: the `backend:get-sidecar-run-log`
 * handler returns the pinned payload, and a sidecar startup failure is
 * broadcast on `backend:status` with a `sidecarStartupFailed` marker.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetConnectionModeForTesting,
  getDaemonVersionInfo,
  setConnectionMode,
  setDaemonVersionInfo,
} from '../connection-mode';

const {
  ctorOptions,
  mockGetOrCreateClientId,
  mockPersistClientId,
  mockRunLog,
  startupFailedListeners,
  mockStartupFailure,
} = vi.hoisted(() => ({
  ctorOptions: [] as Array<Record<string, unknown>>,
  mockGetOrCreateClientId: vi.fn(async () => 'cli-persisted'),
  mockPersistClientId: vi.fn(async () => {}),
  mockRunLog: {
    available: true,
    startedAt: '2026-07-26T00:00:00.000Z',
    endedAt: null,
    exitCode: null,
    signal: null,
    spawnError: null,
    lines: ['line one', 'line two'],
  },
  startupFailedListeners: [] as Array<(reason: string) => void>,
  mockStartupFailure: { current: null as { reason: string } | null },
}));

vi.mock('../json-rpc-client', () => ({
  JsonRpcClient: class {
    constructor(opts: Record<string, unknown>) {
      ctorOptions.push(opts);
    }
    on(): this {
      return this;
    }
    start(): void {}
    dispose(): void {}
    request = vi.fn(async () => ({}));
    registerMethod(): () => void {
      return () => {};
    }
    getConfig(): unknown {
      return { transport: 'uds', socketPath: '/tmp/test.sock' };
    }
    getStatus(): string {
      return 'disconnected';
    }
    getReconnectAttempts(): number {
      return 0;
    }
  },
}));

vi.mock('../client-identity', () => ({
  getOrCreateClientId: mockGetOrCreateClientId,
  persistClientId: mockPersistClientId,
}));

vi.mock('../intentd-sidecar', () => ({
  onSidecarGaveUp: vi.fn(),
  onSidecarStartupFailed: vi.fn((listener: (reason: string) => void) => {
    startupFailedListeners.push(listener);
    return () => {};
  }),
  getLocalDaemonProtocolVersion: vi.fn(() => null),
  getSidecarRunLog: vi.fn(() => mockRunLog),
  getSidecarStartupFailure: vi.fn(() => mockStartupFailure.current),
  spawnSidecarOnDemand: vi.fn(),
}));

vi.mock('../intentd-version-pin', () => ({
  readPinnedVersion: vi.fn(() => '0.1.0'),
}));

vi.mock('../../../browser/main/browser-exec-reverse', () => ({
  registerBrowserExecReverseHandler: vi.fn(),
}));

describe('backend.ipc client identity wiring (§5.17)', () => {
  it('constructs the shared JsonRpcClient with helloParams presenting the persisted clientId', async () => {
    const { getBackendClient } = await import('../backend.ipc');
    getBackendClient();

    expect(ctorOptions).toHaveLength(1);
    const helloParams = ctorOptions[0].helloParams as () => Promise<unknown>;
    expect(typeof helloParams).toBe('function');
    await expect(helloParams()).resolves.toEqual({ clientId: 'cli-persisted' });
    expect(mockGetOrCreateClientId).toHaveBeenCalled();
  });

  it('persists a daemon-returned clientId from the hello result (ignores malformed results)', async () => {
    const { getBackendClient } = await import('../backend.ipc');
    getBackendClient();

    const onHelloResult = ctorOptions[0].onHelloResult as (result: unknown) => void;
    expect(typeof onHelloResult).toBe('function');

    onHelloResult({ clientId: 'cli-9b21', protocolVersion: '2.2', server: {} });
    expect(mockPersistClientId).toHaveBeenCalledWith('cli-9b21');

    onHelloResult(undefined);
    onHelloResult(null);
    onHelloResult({ clientId: 42 });
    onHelloResult({});
    expect(mockPersistClientId).toHaveBeenCalledTimes(1);
  });
});

describe('backend.ipc sidecar run-log bridge', () => {
  it('registers backend:get-sidecar-run-log returning the pinned payload', async () => {
    const { registerBackendHandlers } = await import('../backend.ipc');
    registerBackendHandlers();

    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'backend:get-sidecar-run-log');
    expect(call).toBeDefined();

    const handler = call![1] as () => Promise<unknown>;
    await expect(handler()).resolves.toEqual({
      available: true,
      startedAt: '2026-07-26T00:00:00.000Z',
      endedAt: null,
      exitCode: null,
      signal: null,
      spawnError: null,
      lines: ['line one', 'line two'],
    });
  });

  it('broadcasts a sidecarStartupFailed marker on backend:status when the listener fires', async () => {
    const { registerBackendHandlers } = await import('../backend.ipc');
    registerBackendHandlers();

    expect(startupFailedListeners.length).toBeGreaterThan(0);

    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);

    startupFailedListeners[0]('intentd binary not found');

    expect(send).toHaveBeenCalledWith(
      'backend:status',
      expect.objectContaining({
        status: 'disconnected',
        sidecarStartupFailed: true,
        reason: 'intentd binary not found',
      }),
    );
  });

  it('exposes a latched startup failure on the backend:get-status response', async () => {
    const { registerBackendHandlers } = await import('../backend.ipc');
    registerBackendHandlers();

    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'backend:get-status');
    expect(call).toBeDefined();
    const handler = call![1] as () => Promise<Record<string, unknown>>;

    mockStartupFailure.current = null;
    const clean = await handler();
    expect(clean.sidecarStartupFailed).toBeUndefined();
    expect(clean.sidecarStartupFailedReason).toBeUndefined();

    mockStartupFailure.current = { reason: 'intentd binary not found' };
    await expect(handler()).resolves.toEqual(
      expect.objectContaining({
        status: 'disconnected',
        sidecarStartupFailed: true,
        sidecarStartupFailedReason: 'intentd binary not found',
      }),
    );
    mockStartupFailure.current = null;
  });
});

describe('backend.ipc daemon version refresh on hello (#3448)', () => {
  afterEach(async () => {
    __resetConnectionModeForTesting();
    const { __setActiveConnectionMetaForTesting } = await import('../backend.ipc');
    __setActiveConnectionMetaForTesting(null);
  });

  async function getOnHelloResult(): Promise<(result: unknown) => void> {
    const { getBackendClient } = await import('../backend.ipc');
    getBackendClient();
    return ctorOptions[0].onHelloResult as (result: unknown) => void;
  }

  it('refreshes the stored version info and re-broadcasts backend:status (local external-uds)', async () => {
    const onHelloResult = await getOnHelloResult();
    setConnectionMode('external');
    setDaemonVersionInfo({ daemonVersion: '0.1.0', pinnedVersion: '0.1.0', versionMismatch: false });

    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);

    onHelloResult({ clientId: 'cli-x', server: { version: '0.2.0' } });

    expect(getDaemonVersionInfo()).toEqual({
      daemonVersion: '0.2.0',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });
    expect(send).toHaveBeenCalledWith(
      'backend:status',
      expect.objectContaining({
        transport: expect.objectContaining({
          mode: 'external-uds',
          daemonVersion: '0.2.0',
          versionMismatch: true,
        }),
      }),
    );
  });

  it('does not let a remote backend hello overwrite the local daemon version info', async () => {
    const onHelloResult = await getOnHelloResult();
    const { __setActiveConnectionMetaForTesting } = await import('../backend.ipc');
    setConnectionMode('external');
    setDaemonVersionInfo({ daemonVersion: '0.1.0', pinnedVersion: '0.1.0', versionMismatch: false });
    __setActiveConnectionMetaForTesting({ id: 'conn-1', host: 'remote', port: 443 });

    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);

    onHelloResult({ server: { version: '9.9.9' } });

    expect(getDaemonVersionInfo()).toEqual({
      daemonVersion: '0.1.0',
      pinnedVersion: '0.1.0',
      versionMismatch: false,
    });
    expect(send).not.toHaveBeenCalledWith(
      'backend:status',
      expect.objectContaining({ transport: expect.anything() }),
    );
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  });

  it('leaves stored info unchanged and skips the broadcast for a malformed server.version', async () => {
    const onHelloResult = await getOnHelloResult();
    setConnectionMode('external');
    setDaemonVersionInfo({ daemonVersion: '0.1.0', pinnedVersion: '0.1.0', versionMismatch: false });

    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);

    onHelloResult({ server: {} });
    onHelloResult({ server: { version: 42 } });
    onHelloResult({});

    expect(getDaemonVersionInfo()).toEqual({
      daemonVersion: '0.1.0',
      pinnedVersion: '0.1.0',
      versionMismatch: false,
    });
    expect(send).not.toHaveBeenCalledWith(
      'backend:status',
      expect.objectContaining({ transport: expect.anything() }),
    );
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  });
});
