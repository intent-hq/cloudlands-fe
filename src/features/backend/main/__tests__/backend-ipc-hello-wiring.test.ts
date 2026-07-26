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
import { describe, expect, it, vi } from 'vitest';

const {
  ctorOptions,
  mockGetOrCreateClientId,
  mockPersistClientId,
  mockRunLog,
  startupFailedListeners,
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
  getSidecarRunLog: vi.fn(() => mockRunLog),
  spawnSidecarOnDemand: vi.fn(),
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
});
