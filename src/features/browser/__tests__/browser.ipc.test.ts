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
  DirectRelay: vi.fn(),
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
  // Used by the workspace-forward-cleanup service behind the provider seam.
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('../../backend/main/tunnel-manager', () => ({
  TunnelManager: mocks.TunnelManager,
}));
vi.mock('../../backend/main/direct-relay', () => ({
  DirectRelay: mocks.DirectRelay,
}));

type IpcHandler = (event: unknown, data: unknown) => Promise<any>;

/** Fresh module registry per test so the lazy tunnel-backend singletons reset. */
async function registerAndGetHandler(channel = 'browser:resolve-url'): Promise<IpcHandler> {
  const { ipcMain } = await import('electron');
  (ipcMain.handle as Mock).mockClear();
  const { registerBrowserHandlers } = await import('../main/browser.ipc');
  registerBrowserHandlers();
  const call = (ipcMain.handle as Mock).mock.calls.find(([ch]) => ch === channel);
  expect(call, `${channel} handler should be registered`).toBeDefined();
  return call![1] as IpcHandler;
}

/**
 * Reach the lazy tunnel-provider seam: run the (mocked) executeActions via
 * the `browser:exec` handler and pull the injected `getTunnelProvider`
 * getter out of the call (arg index 5 of `executeActions`).
 */
async function getInjectedTunnelProviderGetter(): Promise<() => unknown> {
  const handler = await registerAndGetHandler('browser:exec');
  const { executeActions } = await import('../main/browser-action-executor');
  (executeActions as Mock).mockResolvedValue({ success: true, results: [] });
  await handler({}, { actions: [], workspaceId: 'workspace-test' });
  const call = (executeActions as Mock).mock.calls.at(-1);
  expect(call, 'executeActions should have been invoked').toBeDefined();
  return call![5] as () => unknown;
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
      this.backend = 'tunnel';
      this.forwardPort = mocks.forwardPort;
      this.activeForwards = mocks.activeForwards;
      this.dispose = vi.fn();
    });
    mocks.DirectRelay.mockImplementation(function (this: Record<string, unknown>) {
      this.backend = 'direct';
      this.forwardPort = vi.fn();
      this.activeForwards = vi.fn().mockReturnValue([]);
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

describe('browser tunnel-backend selection seam', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.isSameHostBackendActive.mockReturnValue(false);
    mocks.getBackendClient.mockReturnValue({
      getConfig: () => ({ transport: 'tcp', host: '10.0.0.5' }),
    });
    mocks.TunnelManager.mockImplementation(function (this: Record<string, unknown>) {
      this.backend = 'tunnel';
      this.dispose = vi.fn();
    });
    mocks.DirectRelay.mockImplementation(function (this: Record<string, unknown>) {
      this.backend = 'direct';
      this.dispose = vi.fn();
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('selects the /tunnel mux (TunnelManager) for a remote daemon, as a lazy singleton', async () => {
    const getProvider = await getInjectedTunnelProviderGetter();
    const provider = getProvider() as { backend: string };
    expect(provider.backend).toBe('tunnel');
    expect(mocks.TunnelManager).toHaveBeenCalledTimes(1);
    expect(mocks.DirectRelay).not.toHaveBeenCalled();
    expect(getProvider()).toBe(provider);
    expect(mocks.TunnelManager).toHaveBeenCalledTimes(1);
  });

  it('selects the direct relay (DirectRelay) for a local daemon, as a lazy singleton', async () => {
    mocks.isSameHostBackendActive.mockReturnValue(true);
    const getProvider = await getInjectedTunnelProviderGetter();
    const provider = getProvider() as { backend: string };
    expect(provider.backend).toBe('direct');
    expect(mocks.DirectRelay).toHaveBeenCalledTimes(1);
    expect(mocks.TunnelManager).not.toHaveBeenCalled();
    expect(getProvider()).toBe(provider);
    expect(mocks.DirectRelay).toHaveBeenCalledTimes(1);
  });

  it('throws instead of picking a backend when the connection state is unreadable', async () => {
    mocks.getBackendClient.mockImplementation(() => {
      throw new Error('no backend client');
    });
    const getProvider = await getInjectedTunnelProviderGetter();
    expect(() => getProvider()).toThrow(/Cannot select a tunnel backend/);
    expect(mocks.TunnelManager).not.toHaveBeenCalled();
    expect(mocks.DirectRelay).not.toHaveBeenCalled();
  });

  it('disposes both backends on backend-connection-changed and rebuilds on next use', async () => {
    const { app } = await import('electron');
    const getProvider = await getInjectedTunnelProviderGetter();
    const remote = getProvider() as { backend: string };
    expect(remote.backend).toBe('tunnel');
    // The handed-out provider is the ownership wrapper (no dispose on the
    // seam); disposal is observed on the underlying constructed backend.
    const remoteBackend = mocks.TunnelManager.mock.instances[0] as unknown as { dispose: Mock };

    const listener = (app.on as Mock).mock.calls.find(
      ([event]) => event === 'backend-connection-changed',
    )?.[1] as () => void;
    expect(listener, 'backend-connection-changed listener should be registered').toBeDefined();

    mocks.isSameHostBackendActive.mockReturnValue(true);
    listener();
    expect(remoteBackend.dispose).toHaveBeenCalledTimes(1);

    const local = getProvider() as { backend: string };
    expect(local.backend).toBe('direct');
    expect(local).not.toBe(remote);
  });
});
