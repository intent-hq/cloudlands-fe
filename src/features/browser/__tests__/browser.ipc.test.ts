/**
 * Tests for the `browser:resolve-url` IPC handler (`browser.ipc.ts`): wiring
 * of the shared resolver to the live backend connection (loopback context +
 * tunnel provider), Zod validation, and the never-throws error envelope.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { BackendConnectionConfig } from '../../backend/main/backend-connection';

const mocks = vi.hoisted(() => ({
  forwardPort: vi.fn(),
  activeForwards: vi.fn(),
  TunnelManager: vi.fn(),
  DirectRelay: vi.fn(),
  getBackendClient: vi.fn(),
  getBackendClientForConnection: vi.fn(),
  getBackendIdForIpcSender: vi.fn(),
  getPrimaryBackendId: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));

vi.mock('../main/embedded-browser-cdp-service', () => ({
  embeddedBrowserCdp: {
    registerTab: vi.fn(),
    unregisterTab: vi.fn(),
    openDevToolsPanel: vi.fn(),
  },
}));
vi.mock('../main/browser-action-executor', () => ({
  executeActions: vi.fn(),
}));
vi.mock('../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(() => ({
    windowCount: 1,
    browserClientsNotified: false,
    delivered: true,
  })),
}));
vi.mock('../../backend/main/backend.ipc', () => ({
  BACKEND_CLIENT_DISCONNECTED_EVENT: 'backend-client-disconnected',
  getBackendClient: mocks.getBackendClient,
  getBackendClientForConnection: mocks.getBackendClientForConnection,
  // Fail-closed like production: no fallback to the primary client.
  getBackendClientForId: (id: string) => {
    const client = mocks.getBackendClientForConnection(id);
    if (!client) throw new Error(`Backend client is not connected: ${id}`);
    return client;
  },
  getLocalBackendClient: mocks.getBackendClient,
  getBackendIdForIpcSender: mocks.getBackendIdForIpcSender,
  getPrimaryBackendId: mocks.getPrimaryBackendId,
  // Used by the workspace-forward-cleanup service behind the provider seam.
  onBackendNotification: mocks.onBackendNotification,
  onBackendReconnected: mocks.onBackendReconnected,
}));
vi.mock('../../../main/window', () => ({
  getFocusedWindowBackendId: () => mocks.getPrimaryBackendId(),
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
    mocks.getBackendIdForIpcSender.mockReturnValue('remote-1');
    mocks.getPrimaryBackendId.mockReturnValue('remote-1');
    mocks.getBackendClient.mockReturnValue({
      getConfig: () => ({ transport: 'tcp', host: '10.0.0.5' }),
    });
    mocks.getBackendClientForConnection.mockImplementation(() => mocks.getBackendClient());
    mocks.onBackendNotification.mockImplementation(() => () => {});
    mocks.onBackendReconnected.mockImplementation(() => () => {});
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

  it('forwards explicit pin intent in the browser open event', async () => {
    const { executeActions } = await import('../main/browser-action-executor');
    vi.mocked(executeActions).mockImplementationOnce(async (_input, openTab) => {
      openTab?.('https://example.com', 'adjacent', true, undefined, true);
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

  it('forwards the visible flag in the browser open event (monorepo#3045)', async () => {
    const { executeActions } = await import('../main/browser-action-executor');
    vi.mocked(executeActions).mockImplementationOnce(async (_input, openTab) => {
      openTab?.(
        'https://example.com',
        'adjacent',
        true,
        undefined,
        undefined,
        'agent-1',
        undefined,
        { width: 1280, height: 800 },
        false,
      );
      return { success: true, results: [] };
    });
    const { executeBrowserActions } = await import('../main/browser.ipc');
    const { sendToWorkspaceWindows } = await import('../../system/main/system.ipc');

    await executeBrowserActions(
      [{ action: 'openTab', url: 'https://example.com' }],
      undefined,
      'agent-1',
      'ws-1',
    );

    expect(sendToWorkspaceWindows).toHaveBeenCalledWith(
      'ws-1',
      'browser:open-tab',
      expect.objectContaining({
        url: 'https://example.com',
        workspaceId: 'ws-1',
        ownerAgentId: 'agent-1',
        emulatedSize: { width: 1280, height: 800 },
        visible: false,
      }),
    );
  });

  it('rewrites daemon.localhost to 127.0.0.1 when the backend is same-host', async () => {
    mocks.getBackendIdForIpcSender.mockReturnValue('local');
    mocks.getBackendClient.mockReturnValue({
      getConfig: () => ({ transport: 'uds', socketPath: '/tmp/intentd.sock' }),
    });
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

  it.each(['localhost', '127.0.0.1'])(
    'uses the pooled saved remote for a renderer URL while the local backend is primary (%s)',
    async (host) => {
      const localClient = {
        getConfig: () => ({ transport: 'uds' as const, socketPath: '/tmp/intentd.sock' }),
      };
      const remoteClient = {
        getConfig: () => ({ transport: 'wss', host }),
      };
      mocks.getPrimaryBackendId.mockReturnValue('local');
      mocks.getBackendClient.mockReturnValue(localClient);
      mocks.getBackendIdForIpcSender.mockReturnValue('remote-loopback');
      mocks.getBackendClientForConnection.mockImplementation((id: string) =>
        id === 'remote-loopback' ? remoteClient : localClient,
      );
      mocks.forwardPort.mockResolvedValue(54321);
      const handler = await registerAndGetHandler();
      const invoke = vi.fn((channel: string, payload: unknown) => handler({}, payload));
      vi.stubGlobal('window', { electronAPI: { invoke } });
      const { resolveBrowserLinkForOpen } = await import('../../../lib/utils/browser-link-open');

      const requestedUrl = 'http://localhost:8080/script-output';
      const resolved = await resolveBrowserLinkForOpen(requestedUrl);

      expect(invoke).toHaveBeenCalledWith('browser:resolve-url', { url: requestedUrl });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.TunnelManager).toHaveBeenCalledTimes(1);
      expect(mocks.DirectRelay).not.toHaveBeenCalled();
      expect(mocks.forwardPort).toHaveBeenCalledWith(8080);
      const tunnelOptions = mocks.TunnelManager.mock.calls[0][0] as { getConfig: () => unknown };
      expect(tunnelOptions.getConfig()).toEqual({ transport: 'wss', host });
      expect(resolved).toEqual({
        url: 'http://127.0.0.1:54321/script-output',
        requestedUrl,
      });
    },
  );

  it('uses the originating pooled saved remote after a non-loopback probe fails', async () => {
    const sender = { id: 42 };
    const localClient = {
      getConfig: () => ({ transport: 'uds' as const, socketPath: '/tmp/intentd.sock' }),
    };
    const remoteConfig: BackendConnectionConfig = {
      transport: 'wss',
      host: 'saved-remote.example.com',
      port: 443,
      token: 'remote-token',
      fingerprint: 'AA:BB:CC:DD',
    };
    const remoteClient = { getConfig: () => remoteConfig };
    mocks.getPrimaryBackendId.mockReturnValue('local');
    mocks.getBackendClient.mockReturnValue(localClient);
    mocks.getBackendIdForIpcSender.mockImplementation((candidate) =>
      candidate === sender ? 'remote-saved' : 'local',
    );
    mocks.getBackendClientForConnection.mockImplementation((id: string) =>
      id === 'remote-saved' ? remoteClient : localClient,
    );
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    mocks.forwardPort.mockResolvedValue(54321);
    const handler = await registerAndGetHandler();
    const invoke = vi.fn((channel: string, payload: unknown) => {
      expect(channel).toBe('browser:resolve-url');
      return handler({ sender }, payload);
    });
    vi.stubGlobal('window', { electronAPI: { invoke } });
    const { resolveBrowserLinkForOpen } = await import('../../../lib/utils/browser-link-open');

    const requestedUrl = 'http://localhost:8080/script-output';
    const resolved = await resolveBrowserLinkForOpen(requestedUrl);

    expect(mocks.getBackendIdForIpcSender).toHaveBeenCalledWith(sender);
    expect(fetchMock).toHaveBeenCalledWith('http://saved-remote.example.com:8080', {
      signal: expect.any(AbortSignal),
    });
    expect(mocks.TunnelManager).toHaveBeenCalledTimes(1);
    expect(mocks.DirectRelay).not.toHaveBeenCalled();
    expect(mocks.forwardPort).toHaveBeenCalledWith(8080);
    const tunnelOptions = mocks.TunnelManager.mock.calls[0][0] as { getConfig: () => unknown };
    expect(tunnelOptions.getConfig()).toEqual(remoteConfig);
    expect(resolved).toEqual({
      url: 'http://127.0.0.1:54321/script-output',
      requestedUrl,
    });
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
    mocks.getBackendClient.mockReturnValue({
      getConfig: () => {
        throw new Error('no backend config');
      },
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

describe('browser:open-devtools-panel IPC handler', () => {
  beforeEach(() => vi.resetModules());

  it('validates and forwards the exact tab and panel request', async () => {
    const handler = await registerAndGetHandler('browser:open-devtools-panel');
    const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');

    await expect(handler({}, { tabId: 'tab-1', panel: 'sources' })).resolves.toEqual({
      success: true,
    });
    expect(embeddedBrowserCdp.openDevToolsPanel).toHaveBeenCalledWith('tab-1', 'sources');
  });

  it('rejects unsupported DevTools panels', async () => {
    const handler = await registerAndGetHandler('browser:open-devtools-panel');
    const result = await handler({}, { tabId: 'tab-1', panel: 'network' });

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('browser tunnel-backend selection seam', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getBackendIdForIpcSender.mockReturnValue('remote-1');
    mocks.getPrimaryBackendId.mockReturnValue('remote-1');
    mocks.getBackendClient.mockReturnValue({
      getConfig: () => ({ transport: 'tcp', host: '10.0.0.5' }),
    });
    mocks.getBackendClientForConnection.mockImplementation(() => mocks.getBackendClient());
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

  it('selects TunnelManager for a saved remote reached through loopback WSS', async () => {
    mocks.getBackendClient.mockReturnValue({
      getConfig: () => ({ transport: 'wss', host: '127.0.0.1' }),
    });
    const getProvider = await getInjectedTunnelProviderGetter();
    const provider = getProvider() as { backend: string };
    expect(provider.backend).toBe('tunnel');
    expect(mocks.TunnelManager).toHaveBeenCalledTimes(1);
    expect(mocks.DirectRelay).not.toHaveBeenCalled();
  });

  it('selects the direct relay (DirectRelay) for a local daemon, as a lazy singleton', async () => {
    mocks.getBackendIdForIpcSender.mockReturnValue('local');
    mocks.getBackendClient.mockReturnValue({
      getConfig: () => ({ transport: 'uds', socketPath: '/tmp/intentd.sock' }),
    });
    const getProvider = await getInjectedTunnelProviderGetter();
    const provider = getProvider() as { backend: string };
    expect(provider.backend).toBe('direct');
    expect(mocks.DirectRelay).toHaveBeenCalledTimes(1);
    expect(mocks.TunnelManager).not.toHaveBeenCalled();
    expect(getProvider()).toBe(provider);
    expect(mocks.DirectRelay).toHaveBeenCalledTimes(1);
  });

  it('selects DirectRelay for an intentional loopback development transport', async () => {
    mocks.getBackendIdForIpcSender.mockReturnValue('local');
    mocks.getBackendClient.mockReturnValue({
      getConfig: () => ({ transport: 'tcp', host: 'localhost' }),
    });
    const getProvider = await getInjectedTunnelProviderGetter();
    const provider = getProvider() as { backend: string };
    expect(provider.backend).toBe('direct');
    expect(mocks.DirectRelay).toHaveBeenCalledTimes(1);
    expect(mocks.TunnelManager).not.toHaveBeenCalled();
  });

  it('throws instead of picking a backend when the connection state is unreadable', async () => {
    mocks.getBackendClient.mockReturnValue({
      getConfig: () => {
        throw new Error('no backend config');
      },
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

    mocks.getBackendIdForIpcSender.mockReturnValue('local');
    mocks.getBackendClient.mockReturnValue({
      getConfig: () => ({ transport: 'uds', socketPath: '/tmp/intentd.sock' }),
    });
    listener();
    expect(remoteBackend.dispose).toHaveBeenCalledTimes(1);

    const getLocalProvider = await getInjectedTunnelProviderGetter();
    const local = getLocalProvider() as { backend: string };
    expect(local.backend).toBe('direct');
    expect(local).not.toBe(remote);
  });

  it('disposes only the departing pooled client manager and rebuilds it on re-pair', async () => {
    const notificationDisposers = new Map<string, Mock>();
    const reconnectDisposers = new Map<string, Mock>();
    mocks.onBackendNotification.mockImplementation((_handler, backendId: string) => {
      const dispose = vi.fn();
      notificationDisposers.set(backendId, dispose);
      return dispose;
    });
    mocks.onBackendReconnected.mockImplementation((_handler, backendId: string) => {
      const dispose = vi.fn();
      reconnectDisposers.set(backendId, dispose);
      return dispose;
    });
    const request = (workspaceId: string) =>
      vi.fn(async (method: string) =>
        method === 'events.subscribe'
          ? { subscriptionId: `sub-${workspaceId}` }
          : { workspaces: [{ id: workspaceId, archived: false }] },
      );
    const remoteA = {
      getConfig: () => ({ transport: 'wss' as const, host: 'remote-a.example' }),
      request: request('workspace-a'),
    };
    const remoteB = {
      getConfig: () => ({ transport: 'wss' as const, host: 'remote-b.example' }),
      request: request('workspace-b'),
    };
    const local = {
      getConfig: () => ({ transport: 'uds' as const, socketPath: '/tmp/intentd.sock' }),
      request: request('workspace-local'),
    };
    mocks.getBackendClientForConnection.mockImplementation((id: string) => {
      if (id === 'remote-a') return remoteA;
      if (id === 'remote-b') return remoteB;
      return local;
    });

    const handler = await registerAndGetHandler('browser:exec');
    const { app } = await import('electron');
    const { executeActions } = await import('../main/browser-action-executor');
    (executeActions as Mock).mockResolvedValue({ success: true, results: [] });
    const getProvider = async (backendId: string, workspaceId: string): Promise<unknown> => {
      mocks.getBackendIdForIpcSender.mockReturnValue(backendId);
      await handler({}, { actions: [], workspaceId });
      return ((executeActions as Mock).mock.calls.at(-1)![5] as () => unknown)();
    };

    const providerA = await getProvider('remote-a', 'workspace-a');
    const providerB = await getProvider('remote-b', 'workspace-b');
    const directProvider = await getProvider('local', 'workspace-local');
    const managerA = mocks.TunnelManager.mock.instances[0] as unknown as {
      dispose: Mock;
      forwardPort: Mock;
      onForwardDropped?: (remotePort: number) => void;
    };
    const managerB = mocks.TunnelManager.mock.instances[1] as unknown as {
      dispose: Mock;
      forwardPort: Mock;
    };
    const direct = mocks.DirectRelay.mock.instances[0] as unknown as { dispose: Mock };
    managerA.forwardPort = vi.fn(async () => 48080);
    managerB.forwardPort = vi.fn(async () => 58080);
    await (providerA as { forwardPort(remotePort: number): Promise<number> }).forwardPort(8080);
    await (providerB as { forwardPort(remotePort: number): Promise<number> }).forwardPort(8080);
    managerA.dispose.mockImplementation(() => managerA.onForwardDropped?.(8080));

    const listener = (app.on as Mock).mock.calls.find(
      ([event]) => event === 'backend-client-disconnected',
    )?.[1] as (client: unknown) => void;
    expect(listener, 'pooled-client disconnect listener should be registered').toBeDefined();
    listener(remoteA);

    expect(managerA.dispose).toHaveBeenCalledTimes(1);
    expect(managerB.dispose).not.toHaveBeenCalled();
    expect(direct.dispose).not.toHaveBeenCalled();
    expect(notificationDisposers.get('remote-a')).toHaveBeenCalledTimes(1);
    expect(reconnectDisposers.get('remote-a')).toHaveBeenCalledTimes(1);
    expect(notificationDisposers.get('remote-b')).not.toHaveBeenCalled();
    expect(notificationDisposers.get('local')).not.toHaveBeenCalled();
    expect(reconnectDisposers.get('remote-b')).not.toHaveBeenCalled();
    expect(reconnectDisposers.get('local')).not.toHaveBeenCalled();
    expect(await getProvider('remote-b', 'workspace-b')).toBe(providerB);
    expect(await getProvider('local', 'workspace-local')).toBe(directProvider);
    expect(await getProvider('remote-a', 'workspace-a')).not.toBe(providerA);
    expect(mocks.TunnelManager).toHaveBeenCalledTimes(3);
  });
});
