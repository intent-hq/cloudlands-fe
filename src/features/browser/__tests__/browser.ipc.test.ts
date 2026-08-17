/**
 * Tests for the `browser:resolve-url` IPC handler (`browser.ipc.ts`): wiring
 * of the shared resolver to the live backend connection (loopback context +
 * tunnel provider), Zod validation, and the never-throws error envelope.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const mocks = vi.hoisted(() => ({
  forwardPort: vi.fn(),
  activeForwards: vi.fn(),
  TunnelManager: vi.fn(),
  getBackendClient: vi.fn(),
  isSameHostBackendActive: vi.fn(),
}));

vi.mock('../main/embedded-browser-cdp-service', () => ({
  embeddedBrowserCdp: { registerTab: vi.fn(), unregisterTab: vi.fn() },
}));
vi.mock('../main/browser-action-executor', () => ({
  executeActions: vi.fn(),
}));
vi.mock('../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(),
}));
vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: mocks.getBackendClient,
  isSameHostBackendActive: mocks.isSameHostBackendActive,
}));
vi.mock('../../backend/main/tunnel-manager', () => ({
  TunnelManager: mocks.TunnelManager,
}));

type IpcHandler = (event: unknown, data: unknown) => Promise<any>;

/** Fresh module registry per test so the lazy TunnelManager singleton resets. */
async function registerAndGetHandler(): Promise<IpcHandler> {
  const { ipcMain } = await import('electron');
  (ipcMain.handle as Mock).mockClear();
  const { registerBrowserHandlers } = await import('../main/browser.ipc');
  registerBrowserHandlers();
  const call = (ipcMain.handle as Mock).mock.calls.find(([ch]) => ch === 'browser:resolve-url');
  expect(call, 'browser:resolve-url handler should be registered').toBeDefined();
  return call![1] as IpcHandler;
}

describe('browser:resolve-url IPC handler', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    mocks.isSameHostBackendActive.mockReturnValue(false);
    mocks.getBackendClient.mockReturnValue({
      getConfig: () => ({ transport: 'tcp', host: '10.0.0.5' }),
    });
    mocks.forwardPort.mockResolvedValue(45678);
    mocks.activeForwards.mockReturnValue([]);
    mocks.TunnelManager.mockImplementation(function (this: Record<string, unknown>) {
      this.forwardPort = mocks.forwardPort;
      this.activeForwards = mocks.activeForwards;
      this.dispose = vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('passes non-loopback URLs through unchanged', async () => {
    const handler = await registerAndGetHandler();
    const result = await handler({}, { url: 'https://example.com/docs' });
    expect(result).toEqual({ url: 'https://example.com/docs', rewritten: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards explicit pin intent in the browser open event', async () => {
    const { executeActions } = await import('../main/browser-action-executor');
    vi.mocked(executeActions).mockImplementationOnce(async (_input, openTab) => {
      openTab?.('https://example.com', 'adjacent', true, true);
      return { success: true, results: [] };
    });
    const { executeBrowserActions } = await import('../main/browser.ipc');
    const { sendToWorkspaceWindows } = await import('../../system/main/system.ipc');

    await executeBrowserActions(
      [{ action: 'openTab', url: 'https://example.com', pin: true }],
      undefined,
      'agent-1',
      'ws-1',
    );

    expect(sendToWorkspaceWindows).toHaveBeenCalledWith(
      'ws-1',
      'browser:open-tab',
      expect.objectContaining({
        url: 'https://example.com',
        position: 'adjacent',
        workspaceId: 'ws-1',
        allowDuplicate: true,
        pin: true,
      }),
    );
  });

  it('rewrites daemon.localhost to 127.0.0.1 when the backend is same-host', async () => {
    mocks.isSameHostBackendActive.mockReturnValue(true);
    const handler = await registerAndGetHandler();
    const result = await handler({}, { url: 'http://daemon.localhost:3000/a' });
    expect(result.url).toBe('http://127.0.0.1:3000/a');
    expect(result.rewritten).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rewrites daemon.localhost to the remote daemon host when the probe succeeds', async () => {
    const handler = await registerAndGetHandler();
    const result = await handler({}, { url: 'http://daemon.localhost:3000/a?b=1' });
    expect(result.url).toBe('http://10.0.0.5:3000/a?b=1');
    expect(result.rewritten).toBe(true);
    expect(result.requestedUrl).toBe('http://daemon.localhost:3000/a?b=1');
    expect(result.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('http://10.0.0.5:3000', {
      signal: expect.any(AbortSignal),
    });
  });

  it('falls back to the daemon tunnel when the remote probe fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const handler = await registerAndGetHandler();
    const result = await handler({}, { url: 'http://daemon.localhost:8080/page' });
    expect(mocks.forwardPort).toHaveBeenCalledWith(8080);
    expect(result.url).toBe('http://127.0.0.1:45678/page');
    expect(result.tunneled).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('passes a URL pointing at an active tunnel-local forward through untouched', async () => {
    mocks.activeForwards.mockReturnValue([{ remotePort: 8742, localPort: 50241 }]);
    const handler = await registerAndGetHandler();
    const result = await handler({}, { url: 'http://127.0.0.1:50241/page' });
    expect(result.url).toBe('http://127.0.0.1:50241/page');
    expect(result.rewritten).toBe(false);
    expect(result.reason).toContain('active daemon-tunnel forward');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.forwardPort).not.toHaveBeenCalled();
  });

  it('returns the rewritten URL plus an error when both probe and tunnel fail', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    mocks.forwardPort.mockRejectedValue(new Error('tunnel closed'));
    const handler = await registerAndGetHandler();
    const result = await handler({}, { url: 'http://daemon.localhost:8080/page' });
    expect(result.url).toBe('http://10.0.0.5:8080/page');
    expect(result.rewritten).toBe(true);
    expect(result.tunneled).toBeUndefined();
    expect(result.error).toContain('not reachable');
  });

  it('assumes a local daemon when the backend connection state is unreadable', async () => {
    mocks.getBackendClient.mockImplementation(() => {
      throw new Error('no backend client');
    });
    const handler = await registerAndGetHandler();
    const result = await handler({}, { url: 'http://daemon.localhost:3000/' });
    expect(result.url).toBe('http://127.0.0.1:3000/');
    expect(result.rewritten).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the rewritten URL plus an error when the tunnel provider cannot be constructed', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    mocks.TunnelManager.mockImplementation(function () {
      throw new Error('tunnel manager exploded');
    });
    const handler = await registerAndGetHandler();
    const result = await handler({}, { url: 'http://daemon.localhost:3000/' });
    expect(result.url).toBe('http://10.0.0.5:3000/');
    expect(result.rewritten).toBe(true);
    expect(result.tunneled).toBeUndefined();
    expect(result.error).toContain('not reachable');
  });

  it('degrades to a non-rewritten passthrough when resolution throws, even a non-Error', async () => {
    vi.doMock('../main/loopback-url-resolver', () => ({
      resolveBrowserUrl: vi.fn().mockImplementation(() => {
        // eslint-disable-next-line no-throw-literal
        throw 'resolver blew up';
      }),
    }));
    try {
      const handler = await registerAndGetHandler();
      const result = await handler({}, { url: 'http://daemon.localhost:3000/' });
      expect(result.url).toBe('http://daemon.localhost:3000/');
      expect(result.rewritten).toBe(false);
      expect(result.error).toBe('URL resolution failed: resolver blew up');
    } finally {
      vi.doUnmock('../main/loopback-url-resolver');
    }
  });

  it('returns a VALIDATION_ERROR envelope for invalid payloads', async () => {
    const handler = await registerAndGetHandler();
    const result = await handler({}, { notUrl: 123 });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('rewrite-only mode rewrites without probing or tunneling', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const handler = await registerAndGetHandler();
    const result = await handler(
      {},
      { url: 'http://daemon.localhost:3000/a', mode: 'rewrite-only' },
    );
    expect(result.url).toBe('http://10.0.0.5:3000/a');
    expect(result.rewritten).toBe(true);
    expect(result.error).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.forwardPort).not.toHaveBeenCalled();
  });

  it('mode: "full" behaves like an absent mode (probe runs)', async () => {
    const handler = await registerAndGetHandler();
    const result = await handler({}, { url: 'http://daemon.localhost:3000/a', mode: 'full' });
    expect(result.url).toBe('http://10.0.0.5:3000/a');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('rejects an unknown mode with a VALIDATION_ERROR envelope', async () => {
    const handler = await registerAndGetHandler();
    const result = await handler({}, { url: 'http://localhost:3000/', mode: 'probe-hard' });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});
