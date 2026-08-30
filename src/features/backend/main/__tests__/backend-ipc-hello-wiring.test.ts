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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetConnectionModeForTesting,
  getDaemonVersionInfo,
  setConnectionMode,
  setDaemonVersionInfo,
} from '../connection-mode';
import { Logger } from '$shared/logger';

const {
  ctorOptions,
  mockGetOrCreateClientId,
  mockPersistClientId,
  mockSetDaemonVersion,
  mockSetUpdateSupported,
  systemStatus,
  mockRunLog,
  startupFailedListeners,
  mockStartupFailure,
} = vi.hoisted(() => ({
  ctorOptions: [] as Array<Record<string, unknown>>,
  mockGetOrCreateClientId: vi.fn(async () => 'cli-persisted'),
  mockPersistClientId: vi.fn(async () => {}),
  mockSetDaemonVersion: vi.fn(async () => false),
  mockSetUpdateSupported: vi.fn(async () => false),
  // `system.status` result the fake client answers with; tests override.
  systemStatus: { value: {} as unknown },
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
    request = vi.fn(async (method: string) =>
      method === 'system.status' ? systemStatus.value : {},
    );
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

vi.mock('../connections-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../connections-store')>()),
  list: vi.fn(async () => [
    {
      id: 'conn-remote',
      isLocal: false,
      host: 'remote.example',
      hosts: ['remote.example'],
      port: 443,
      fingerprint: 'AA:BB:CC',
    },
  ]),
  getDecryptedToken: vi.fn(async () => 'tok-remote'),
  setDaemonVersion: mockSetDaemonVersion,
  setUpdateSupported: mockSetUpdateSupported,
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
  afterEach(() => {
    __resetConnectionModeForTesting();
  });

  async function getOnHelloResult(): Promise<(result: unknown) => void> {
    const { getBackendClient } = await import('../backend.ipc');
    getBackendClient();
    return ctorOptions[0].onHelloResult as (result: unknown) => void;
  }

  it('refreshes the stored version info and re-broadcasts backend:status (local external-uds)', async () => {
    const onHelloResult = await getOnHelloResult();
    setConnectionMode('external');
    setDaemonVersionInfo({
      daemonVersion: '0.1.0',
      daemonBuildCommit: 'abc1234',
      pinnedVersion: '0.1.0',
      versionMismatch: false,
    });

    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);

    onHelloResult({
      clientId: 'cli-x',
      server: { version: '0.2.0', buildCommit: 'abc1234' },
    });

    expect(getDaemonVersionInfo()).toEqual({
      daemonVersion: '0.2.0',
      daemonBuildCommit: 'abc1234',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });
    expect(send).toHaveBeenCalledWith(
      'backend:status',
      expect.objectContaining({
        transport: expect.objectContaining({
          mode: 'external-uds',
          daemonVersion: '0.2.0',
          daemonBuildCommit: 'abc1234',
          versionMismatch: true,
        }),
      }),
    );
  });

  it('detects a build-commit change when the daemon version is unchanged', async () => {
    const onHelloResult = await getOnHelloResult();
    setConnectionMode('external');
    setDaemonVersionInfo({
      daemonVersion: '0.2.0',
      daemonBuildCommit: 'abc1234',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });

    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);

    onHelloResult({ server: { version: '0.2.0', buildCommit: 'def5678' } });

    expect(getDaemonVersionInfo()).toEqual({
      daemonVersion: '0.2.0',
      daemonBuildCommit: 'def5678',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });
    expect(send).toHaveBeenCalledWith(
      'backend:status',
      expect.objectContaining({
        transport: expect.objectContaining({ daemonBuildCommit: 'def5678' }),
      }),
    );
  });

  it('accepts an old daemon hello without a build commit', async () => {
    const onHelloResult = await getOnHelloResult();
    setConnectionMode('external');
    setDaemonVersionInfo({
      daemonVersion: '0.2.0',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });

    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ webContents: { send } } as never]);

    onHelloResult({ server: { version: '0.2.0' } });

    expect(getDaemonVersionInfo()).toEqual({
      daemonVersion: '0.2.0',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('does not let a remote backend hello overwrite the local daemon version info', async () => {
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    setConnectionMode('external');
    setDaemonVersionInfo({
      daemonVersion: '0.1.0',
      pinnedVersion: '0.1.0',
      versionMismatch: false,
    });
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

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
    disconnectBackendClient('conn-remote');
  });

  it('leaves stored info unchanged and skips the broadcast for a malformed server.version', async () => {
    const onHelloResult = await getOnHelloResult();
    setConnectionMode('external');
    setDaemonVersionInfo({
      daemonVersion: '0.1.0',
      pinnedVersion: '0.1.0',
      versionMismatch: false,
    });

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

describe('backend.ipc daemon build-identity log on hello (#3649)', () => {
  beforeEach(async () => {
    const { __resetDaemonBuildLogForTesting } = await import('../backend.ipc');
    __resetDaemonBuildLogForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function getPrimaryOnHelloResult(): Promise<(result: unknown) => void> {
    const { getBackendClient } = await import('../backend.ipc');
    getBackendClient();
    return ctorOptions[0].onHelloResult as (result: unknown) => void;
  }

  it('pins the BuildInfo category at INFO so the line survives the packaged WARN default', async () => {
    const { getLogLevel, LogLevel, LOGGING_CONFIG } = await import(
      '../../../../shared/logging-config'
    );
    expect(getLogLevel('BuildInfo')).toBeLessThanOrEqual(LogLevel.INFO);
    expect(getLogLevel('BuildInfo')).toBeLessThanOrEqual(LOGGING_CONFIG.defaultLevel);
  });

  it('logs the connected daemon build once, dedupes reconnects, re-logs on a build change', async () => {
    const onHelloResult = await getPrimaryOnHelloResult();
    const info = vi.spyOn(Logger.prototype, 'info');

    onHelloResult({ server: { version: '0.2.0', buildCommit: 'abc1234' } });
    onHelloResult({ server: { version: '0.2.0', buildCommit: 'abc1234' } });

    const buildLogs = () => info.mock.calls.filter(([msg]) => msg === 'Connected to intentd');
    expect(buildLogs()).toHaveLength(1);
    expect(buildLogs()[0][1]).toEqual({
      connectionId: 'local',
      version: '0.2.0',
      buildCommit: 'abc1234',
    });

    onHelloResult({ server: { version: '0.3.0', buildCommit: 'def5678' } });
    expect(buildLogs()).toHaveLength(2);
    expect(buildLogs()[1][1]).toEqual({
      connectionId: 'local',
      version: '0.3.0',
      buildCommit: 'def5678',
    });
  });

  it('does not log for hellos without a well-formed server.version', async () => {
    const onHelloResult = await getPrimaryOnHelloResult();
    const info = vi.spyOn(Logger.prototype, 'info');

    onHelloResult(undefined);
    onHelloResult({});
    onHelloResult({ server: {} });
    onHelloResult({ server: { version: 42 } });

    expect(info.mock.calls.filter(([msg]) => msg === 'Connected to intentd')).toHaveLength(0);
  });

  it('logs a secondary pool member daemon build keyed by its connection id', async () => {
    const { connectBackendClient } = await import('../backend.ipc');
    const info = vi.spyOn(Logger.prototype, 'info');

    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;
    expect(typeof onHelloResult).toBe('function');

    onHelloResult({ server: { version: '0.9.0', buildCommit: 'fed9876' } });
    onHelloResult({ server: { version: '0.9.0', buildCommit: 'fed9876' } });

    const buildLogs = info.mock.calls.filter(([msg]) => msg === 'Connected to intentd');
    expect(buildLogs).toHaveLength(1);
    expect(buildLogs[0][1]).toEqual({
      connectionId: 'conn-remote',
      version: '0.9.0',
      buildCommit: 'fed9876',
    });

    const { disconnectBackendClient } = await import('../backend.ipc');
    disconnectBackendClient('conn-remote');
  });
});

describe('backend.ipc remote daemon version capture on hello', () => {
  afterEach(() => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    mockSetDaemonVersion.mockClear();
    mockSetDaemonVersion.mockResolvedValue(false);
  });

  it('persists a pool member remote daemon version keyed by its connection id', async () => {
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    onHelloResult({ server: { version: '0.9.0', buildCommit: 'fed9876' } });
    await vi.waitFor(() => {
      expect(mockSetDaemonVersion).toHaveBeenCalledWith('conn-remote', '0.9.0');
    });

    disconnectBackendClient('conn-remote');
  });

  it('broadcasts connections:changed only when the captured version actually changed', async () => {
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);

    // Unchanged version (the store dedupes): no broadcast.
    mockSetDaemonVersion.mockResolvedValueOnce(false);
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => expect(mockSetDaemonVersion).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send.mock.calls.filter(([c]) => c === 'connections:changed')).toHaveLength(0);

    // A changed version pushes the refreshed list to every window.
    mockSetDaemonVersion.mockResolvedValueOnce(true);
    onHelloResult({ server: { version: '1.0.0' } });
    await vi.waitFor(() => {
      expect(send.mock.calls.filter(([c]) => c === 'connections:changed').length).toBeGreaterThan(
        0,
      );
    });

    disconnectBackendClient('conn-remote');
  });

  it('never captures for the local backend (pooled local client)', async () => {
    const { getBackendClient } = await import('../backend.ipc');
    getBackendClient();
    const onHelloResult = ctorOptions[0].onHelloResult as (result: unknown) => void;

    onHelloResult({ server: { version: '0.9.0' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSetDaemonVersion).not.toHaveBeenCalled();
  });

  it('ignores hellos without a well-formed server.version', async () => {
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    onHelloResult(undefined);
    onHelloResult({});
    onHelloResult({ server: {} });
    onHelloResult({ server: { version: 42 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSetDaemonVersion).not.toHaveBeenCalled();

    disconnectBackendClient('conn-remote');
  });
});

describe('backend.ipc remote updateSupported capture on hello', () => {
  afterEach(() => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    mockSetUpdateSupported.mockClear();
    mockSetUpdateSupported.mockResolvedValue(false);
    systemStatus.value = {};
  });

  it('persists a pool member remote updateSupported flag keyed by its connection id', async () => {
    systemStatus.value = { updateSupported: true };
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(mockSetUpdateSupported).toHaveBeenCalledWith('conn-remote', true);
    });

    disconnectBackendClient('conn-remote');
  });

  it('persists an explicit updateSupported: false (unsupported is conclusive)', async () => {
    systemStatus.value = { updateSupported: false };
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(mockSetUpdateSupported).toHaveBeenCalledWith('conn-remote', false);
    });

    disconnectBackendClient('conn-remote');
  });

  it('broadcasts connections:changed only when the captured flag actually changed', async () => {
    systemStatus.value = { updateSupported: true };
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);

    // Unchanged flag (the store dedupes): no broadcast.
    mockSetUpdateSupported.mockResolvedValueOnce(false);
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => expect(mockSetUpdateSupported).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send.mock.calls.filter(([c]) => c === 'connections:changed')).toHaveLength(0);

    // A changed flag pushes the refreshed list to every window.
    mockSetUpdateSupported.mockResolvedValueOnce(true);
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(send.mock.calls.filter(([c]) => c === 'connections:changed').length).toBeGreaterThan(
        0,
      );
    });

    disconnectBackendClient('conn-remote');
  });

  it('never captures for the local backend (pooled local client)', async () => {
    systemStatus.value = { updateSupported: true };
    const { getBackendClient } = await import('../backend.ipc');
    getBackendClient();
    const onHelloResult = ctorOptions[0].onHelloResult as (result: unknown) => void;

    onHelloResult({ server: { version: '0.9.0' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSetUpdateSupported).not.toHaveBeenCalled();
  });

  it('leaves the stored flag as-is when system.status omits updateSupported (older daemon)', async () => {
    systemStatus.value = { status: 'ok' }; // no updateSupported field
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    onHelloResult({ server: { version: '0.9.0' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSetUpdateSupported).not.toHaveBeenCalled();

    // A malformed (non-boolean) field is ignored the same way.
    systemStatus.value = { updateSupported: 'yes' };
    onHelloResult({ server: { version: '0.9.0' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSetUpdateSupported).not.toHaveBeenCalled();

    disconnectBackendClient('conn-remote');
  });
});
