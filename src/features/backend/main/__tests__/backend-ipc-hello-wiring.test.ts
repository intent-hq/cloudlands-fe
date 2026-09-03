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
  getLocalUpdateSupported,
  setConnectionMode,
  setDaemonVersionInfo,
  setLocalUpdateSupported,
} from '../connection-mode';
import { Logger } from '$shared/logger';

const {
  ctorOptions,
  mockGetOrCreateClientId,
  mockPersistClientId,
  mockSetDaemonVersion,
  mockSetUpdateSupported,
  mockSetTcAddress,
  mockSetHosts,
  mockGetDetectHosts,
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
  mockSetTcAddress: vi.fn(async () => false),
  mockSetHosts: vi.fn(async () => true),
  mockGetDetectHosts: vi.fn(async () => true),
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
    getConnectedVia(): null {
      return null;
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
  setTcAddress: mockSetTcAddress,
  setHosts: mockSetHosts,
  getDetectHosts: mockGetDetectHosts,
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
    const { getLogLevel, LogLevel, LOGGING_CONFIG } =
      await import('../../../../shared/logging-config');
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

  it('clears the stored flag to null when system.status omits updateSupported (older daemon)', async () => {
    systemStatus.value = { status: 'ok' }; // no updateSupported field
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    // A successful flagless response is a conclusive "unknown" — a
    // previously-persisted true must not survive a daemon replaced by one
    // too old to report the field.
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(mockSetUpdateSupported).toHaveBeenCalledWith('conn-remote', null);
    });

    // A malformed (non-boolean) field clears the same way.
    mockSetUpdateSupported.mockClear();
    systemStatus.value = { updateSupported: 'yes' };
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(mockSetUpdateSupported).toHaveBeenCalledWith('conn-remote', null);
    });

    disconnectBackendClient('conn-remote');
  });
});

describe('backend.ipc remote tcAddress capture on hello', () => {
  afterEach(() => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    mockSetUpdateSupported.mockClear();
    mockSetUpdateSupported.mockResolvedValue(false);
    mockSetTcAddress.mockClear();
    mockSetTcAddress.mockResolvedValue(false);
    systemStatus.value = {};
  });

  it('persists the advertised tunnel address keyed by the connection id', async () => {
    systemStatus.value = { tcAddress: 'tc7f2a91.tailcat.net' };
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(mockSetTcAddress).toHaveBeenCalledWith('conn-remote', 'tc7f2a91.tailcat.net');
    });

    disconnectBackendClient('conn-remote');
  });

  it('clears the stored address to null when system.status omits tcAddress', async () => {
    // PROTOCOL §5: the field is omitted — never null — when the tunnel is
    // disabled or the sidecar is down; a successful flagless response is a
    // conclusive "no tunnel" (see extractTcAddress for the trade-off note).
    systemStatus.value = { updateSupported: true }; // no tcAddress field
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(mockSetTcAddress).toHaveBeenCalledWith('conn-remote', null);
    });

    disconnectBackendClient('conn-remote');
  });

  it('clears to null on a malformed (non-string or empty) tcAddress', async () => {
    systemStatus.value = { tcAddress: 42 };
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(mockSetTcAddress).toHaveBeenCalledWith('conn-remote', null);
    });

    // Whitespace-only clears the same way.
    mockSetTcAddress.mockClear();
    systemStatus.value = { tcAddress: '   ' };
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(mockSetTcAddress).toHaveBeenCalledWith('conn-remote', null);
    });

    disconnectBackendClient('conn-remote');
  });

  it('broadcasts connections:changed when only the tunnel address changed', async () => {
    systemStatus.value = { tcAddress: 'tc7f2a91.tailcat.net' };
    const { connectBackendClient, disconnectBackendClient } = await import('../backend.ipc');
    await connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    const onHelloResult = poolCtor.onHelloResult as (result: unknown) => void;

    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);

    // updateSupported unchanged, tcAddress changed → still broadcasts.
    mockSetUpdateSupported.mockResolvedValueOnce(false);
    mockSetTcAddress.mockResolvedValueOnce(true);
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(send.mock.calls.filter(([c]) => c === 'connections:changed').length).toBeGreaterThan(
        0,
      );
    });

    disconnectBackendClient('conn-remote');
  });

  it('never captures for the local backend (pooled local client)', async () => {
    systemStatus.value = { tcAddress: 'tc7f2a91.tailcat.net' };
    const { getBackendClient } = await import('../backend.ipc');
    getBackendClient();
    const onHelloResult = ctorOptions[0].onHelloResult as (result: unknown) => void;

    onHelloResult({ server: { version: '0.9.0' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSetTcAddress).not.toHaveBeenCalled();
  });
});

describe('backend.ipc remote localIps capture on hello', () => {
  afterEach(() => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    mockSetUpdateSupported.mockClear();
    mockSetUpdateSupported.mockResolvedValue(false);
    mockSetTcAddress.mockClear();
    mockSetTcAddress.mockResolvedValue(false);
    mockSetHosts.mockClear();
    mockGetDetectHosts.mockClear();
    mockGetDetectHosts.mockResolvedValue(true);
    systemStatus.value = {};
  });

  async function connectRemote() {
    const mod = await import('../backend.ipc');
    await mod.connectBackendClient('conn-remote');
    const poolCtor = ctorOptions[ctorOptions.length - 1];
    return {
      mod,
      onHelloResult: poolCtor.onHelloResult as (result: unknown) => void,
      remoteRequest: vi.mocked(mod.getBackendClientForId('conn-remote').request),
    };
  }

  it('persists the extra addresses a remote system.status reports (server.pairingInfo is local-only)', async () => {
    // PROTOCOL §system.status shape; localIps is served to remote callers.
    systemStatus.value = {
      status: 'ok',
      updateSupported: true,
      localIps: ['172.96.161.227', '100.85.97.67'],
    };
    const { mod, onHelloResult, remoteRequest } = await connectRemote();

    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(mockSetHosts).toHaveBeenCalledWith('conn-remote', ['172.96.161.227', '100.85.97.67']);
    });
    // PROTOCOL: `system.status` takes no params — the exact wire call.
    expect(remoteRequest).toHaveBeenCalledWith('system.status');
    expect(mockGetDetectHosts).toHaveBeenCalledWith('conn-remote');

    mod.disconnectBackendClient('conn-remote');
  });

  it('drops the host write when the pooled client is replaced during the preceding store writes', async () => {
    systemStatus.value = { updateSupported: true, localIps: ['172.96.161.227'] };
    // Hold the tcAddress write open so the disconnect lands mid-capture,
    // AFTER the initial stale-client check already passed.
    let releaseTcAddress!: () => void;
    const gate = new Promise<void>((resolve) => (releaseTcAddress = resolve));
    mockSetTcAddress.mockImplementationOnce(async () => {
      await gate;
      return false;
    });
    const { mod, onHelloResult } = await connectRemote();

    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => expect(mockSetTcAddress).toHaveBeenCalledTimes(1));

    mod.disconnectBackendClient('conn-remote');
    releaseTcAddress();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockSetHosts).not.toHaveBeenCalled();
  });

  it('filters bound loopback entries out before persisting (diagnostic surface keeps them)', async () => {
    systemStatus.value = {
      localIps: ['127.0.0.1', '172.96.161.227', '::1', '[::1]', '::ffff:127.0.0.1'],
    };
    const { mod, onHelloResult } = await connectRemote();

    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(mockSetHosts).toHaveBeenCalledWith('conn-remote', ['172.96.161.227']);
    });

    mod.disconnectBackendClient('conn-remote');
  });

  it('leaves the stored hosts untouched on an empty, loopback-only, or absent localIps', async () => {
    const { mod, onHelloResult } = await connectRemote();

    // Listener down: PROTOCOL says localIps is empty (never null).
    systemStatus.value = { updateSupported: true, localIps: [] };
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => expect(mockSetUpdateSupported).toHaveBeenCalledTimes(1));

    // Loopback-only bind: every entry is filtered out.
    systemStatus.value = { updateSupported: true, localIps: ['127.0.0.1', '::1'] };
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => expect(mockSetUpdateSupported).toHaveBeenCalledTimes(2));

    // Older daemon without the field at all.
    systemStatus.value = { updateSupported: true };
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => expect(mockSetUpdateSupported).toHaveBeenCalledTimes(3));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSetHosts).not.toHaveBeenCalled();

    mod.disconnectBackendClient('conn-remote');
  });

  it('skips the host refresh for records that opted out of IP detection', async () => {
    mockGetDetectHosts.mockResolvedValue(false);
    systemStatus.value = { updateSupported: true, localIps: ['172.96.161.227', '100.85.97.67'] };
    const { mod, onHelloResult } = await connectRemote();

    onHelloResult({ server: { version: '0.9.0' } });
    // The other captures from the same response still land.
    await vi.waitFor(() => {
      expect(mockSetUpdateSupported).toHaveBeenCalledWith('conn-remote', true);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockGetDetectHosts).toHaveBeenCalledWith('conn-remote');
    expect(mockSetHosts).not.toHaveBeenCalled();

    mod.disconnectBackendClient('conn-remote');
  });

  it('broadcasts connections:changed only when the persisted host list actually changed', async () => {
    systemStatus.value = { localIps: ['172.96.161.227'] };
    const { mod, onHelloResult } = await connectRemote();

    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);

    const broadcasts = () => send.mock.calls.filter(([c]) => c === 'connections:changed').length;

    // updateSupported and tcAddress unchanged → a changed hosts list alone
    // still pushes the refreshed list so the edit panel's "Detected
    // addresses" updates.
    mockSetUpdateSupported.mockResolvedValueOnce(false);
    mockSetTcAddress.mockResolvedValueOnce(false);
    mockSetHosts.mockResolvedValueOnce(true);
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => {
      expect(mockSetHosts).toHaveBeenCalledTimes(1);
      expect(broadcasts()).toBe(1);
    });
    expect(mockSetHosts).toHaveBeenCalledWith('conn-remote', ['172.96.161.227']);

    // The routine every-connect hello with an identical list: the store
    // skips the write and nothing is broadcast (no per-reconnect IPC churn).
    mockSetUpdateSupported.mockResolvedValueOnce(false);
    mockSetTcAddress.mockResolvedValueOnce(false);
    mockSetHosts.mockResolvedValueOnce(false);
    onHelloResult({ server: { version: '0.9.0' } });
    await vi.waitFor(() => expect(mockSetHosts).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(broadcasts()).toBe(1);

    mod.disconnectBackendClient('conn-remote');
  });

  it('never captures for the local backend (pooled local client)', async () => {
    systemStatus.value = { localIps: ['172.96.161.227'] };
    const { getBackendClient } = await import('../backend.ipc');
    getBackendClient();
    const onHelloResult = ctorOptions[0].onHelloResult as (result: unknown) => void;

    onHelloResult({ server: { version: '0.9.0' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSetHosts).not.toHaveBeenCalled();
  });
});

describe('backend.ipc local external updateSupported capture on hello', () => {
  afterEach(() => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    systemStatus.value = {};
    mockSetUpdateSupported.mockClear();
    __resetConnectionModeForTesting();
  });

  /** Rebuild the pooled LOCAL client so its hello observer is deterministic. */
  async function freshLocalOnHelloResult(): Promise<(result: unknown) => void> {
    const { disconnectBackendClient, getBackendClient } = await import('../backend.ipc');
    disconnectBackendClient('local');
    getBackendClient();
    return ctorOptions[ctorOptions.length - 1].onHelloResult as (result: unknown) => void;
  }

  function installChangedSpy() {
    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);
    return () => send.mock.calls.filter(([c]) => c === 'connections:changed');
  }

  it('captures true for the external local daemon and broadcasts connections:changed', async () => {
    const onHelloResult = await freshLocalOnHelloResult();
    setConnectionMode('external');
    systemStatus.value = { updateSupported: true };
    const changedCalls = installChangedSpy();

    onHelloResult({});
    await vi.waitFor(() => {
      expect(getLocalUpdateSupported()).toBe(true);
      expect(changedCalls().length).toBeGreaterThan(0);
    });
    // The local flag lives in connection-mode state, never the store.
    expect(mockSetUpdateSupported).not.toHaveBeenCalled();
  });

  it('captures an explicit false (unsupported is conclusive)', async () => {
    const onHelloResult = await freshLocalOnHelloResult();
    setConnectionMode('external');
    systemStatus.value = { updateSupported: false };

    onHelloResult({});
    await vi.waitFor(() => {
      expect(getLocalUpdateSupported()).toBe(false);
    });
  });

  it('re-hello resets the flag to unknown before re-capturing (reconnect may be a replaced daemon)', async () => {
    const onHelloResult = await freshLocalOnHelloResult();
    setConnectionMode('external');
    systemStatus.value = { updateSupported: true };
    const changedCalls = installChangedSpy();

    onHelloResult({});
    await vi.waitFor(() => expect(getLocalUpdateSupported()).toBe(true));
    const afterFirst = changedCalls().length;

    // A reconnect may face a replaced daemon: the previously-captured flag is
    // reset (broadcast) before the fresh capture answers (broadcast again).
    onHelloResult({});
    expect(getLocalUpdateSupported()).toBeNull();
    await vi.waitFor(() => expect(getLocalUpdateSupported()).toBe(true));
    expect(changedCalls().length).toBe(afterFirst + 2);
  });

  it('keeps null for a flagless/malformed system.status (unknown daemon capability)', async () => {
    const onHelloResult = await freshLocalOnHelloResult();
    setConnectionMode('external');
    systemStatus.value = { status: 'ok' }; // no updateSupported field

    onHelloResult({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getLocalUpdateSupported()).toBeNull();

    systemStatus.value = { updateSupported: 'yes' };
    onHelloResult({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getLocalUpdateSupported()).toBeNull();
  });

  it('clears a previously-captured flag in sidecar mode instead of capturing', async () => {
    const onHelloResult = await freshLocalOnHelloResult();
    setConnectionMode('sidecar');
    setLocalUpdateSupported(true);
    systemStatus.value = { updateSupported: true };
    const changedCalls = installChangedSpy();

    onHelloResult({});
    await vi.waitFor(() => {
      expect(getLocalUpdateSupported()).toBeNull();
      expect(changedCalls().length).toBeGreaterThan(0);
    });
  });

  it('resets a previously-captured flag synchronously on reconnect (no stale value in the capture window)', async () => {
    const onHelloResult = await freshLocalOnHelloResult();
    setConnectionMode('external');
    setLocalUpdateSupported(true);
    // Keep the capture pending: the daemon behind the socket may have been
    // replaced, so the old `true` must not be advertised while it answers.
    let resolveStatus!: (value: unknown) => void;
    systemStatus.value = new Promise((resolve) => (resolveStatus = resolve));

    onHelloResult({});
    expect(getLocalUpdateSupported()).toBeNull();

    resolveStatus({ updateSupported: false });
    await vi.waitFor(() => expect(getLocalUpdateSupported()).toBe(false));
  });

  it('concludes unknown when the capture request fails (reset is not undone)', async () => {
    const onHelloResult = await freshLocalOnHelloResult();
    setConnectionMode('external');
    setLocalUpdateSupported(true);
    let rejectStatus!: (reason: unknown) => void;
    const failing = new Promise((_resolve, reject) => (rejectStatus = reject));
    // The capture catches the rejection; this handler only keeps the shared
    // fixture promise itself off vitest's unhandled-rejection tracker.
    failing.catch(() => {});
    systemStatus.value = failing;

    onHelloResult({});
    expect(getLocalUpdateSupported()).toBeNull();

    rejectStatus(new Error('boom'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getLocalUpdateSupported()).toBeNull();
  });

  it('re-pushes backend:status when the captured flag changes (behind-pin suppression sees the flag)', async () => {
    const onHelloResult = await freshLocalOnHelloResult();
    setConnectionMode('external');
    systemStatus.value = { updateSupported: true };
    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { id: 1, isDestroyed: () => false, webContents: { send } } as never,
    ]);

    onHelloResult({});
    await vi.waitFor(() => {
      const statusCalls = send.mock.calls.filter(([c]) => c === 'backend:status');
      expect(statusCalls.length).toBeGreaterThan(0);
      // The re-pushed payload carries the flag-bearing transport info.
      expect(statusCalls.at(-1)?.[1]).toMatchObject({
        transport: expect.objectContaining({ mode: 'external-uds', updateSupported: true }),
      });
    });
  });

  it('discards a stale result when the local client was disposed mid-flight', async () => {
    const onHelloResult = await freshLocalOnHelloResult();
    setConnectionMode('external');
    let resolveStatus!: (value: unknown) => void;
    systemStatus.value = new Promise((resolve) => (resolveStatus = resolve));

    onHelloResult({});
    const { disconnectBackendClient } = await import('../backend.ipc');
    disconnectBackendClient('local');
    resolveStatus({ updateSupported: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getLocalUpdateSupported()).toBeNull();
  });

  it('recaptures via refreshLocalUpdateSupported when the hello raced the startup mode resolution', async () => {
    // Field scenario (adopted sitter-supervised daemon): the pooled local
    // client is constructed during setupConfigIPC and its hello resolves
    // BEFORE startIntentdSidecar resolves the connection mode, so the
    // hello-time capture sees `unknown` and skips — and no later hello re-runs
    // it while the socket stays connected. The daemon's version still renders
    // (the adoption probe sets it), so the Devices row showed the behind-pin
    // dot without the Update menu.
    const onHelloResult = await freshLocalOnHelloResult();
    systemStatus.value = { updateSupported: true };

    onHelloResult({}); // hello fires while the mode is still 'unknown'
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getLocalUpdateSupported()).toBeNull();

    // startIntentdSidecar then adopts the daemon and re-runs the capture.
    setConnectionMode('external');
    const { refreshLocalUpdateSupported } = await import('../backend.ipc');
    await refreshLocalUpdateSupported();
    expect(getLocalUpdateSupported()).toBe(true);
  });
});
