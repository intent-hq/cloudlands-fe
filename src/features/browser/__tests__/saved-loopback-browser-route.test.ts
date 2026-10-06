// Exercises the registered reverse handler, actual IPC executor wiring, actual
// action executor, context derivation and resolver. Transport registration, UI
// delivery and workspace-lifetime subscription are controlled fixture boundaries.
// protocol-version-ok-file: synthetic hello capability used to verify originating-client selection
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonRpcClient } from '../../backend/main/json-rpc-client';
import type { BackendConnectionConfig } from '../../backend/main/backend-connection';
import type { TunnelManagerOptions } from '../../backend/main/tunnel-manager';
import type { ExecutionResult } from '../main/browser-action-executor';

const fixture = vi.hoisted(() => ({
  forwardPort: vi.fn(),
  constructorFailure: null as Error | null,
  realForward: false,
  managers: [] as Array<{ dispose(): void }>,
  options: [] as Array<{ getConfig(): unknown; getProtocolVersion(): unknown }>,
  directRelay: vi.fn(),
  focusedBackend: vi.fn(),
  primaryClient: vi.fn(),
  protocol: vi.fn(),
  ownerRequest: vi.fn(),
  send: vi.fn(),
}));

vi.mock('../../backend/main/tunnel-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../backend/main/tunnel-manager')>();
  return {
    ...actual,
    TunnelManager: vi.fn(function (options: TunnelManagerOptions) {
      if (fixture.constructorFailure) throw fixture.constructorFailure;
      fixture.options.push(options);
      const manager = new actual.TunnelManager(options);
      fixture.managers.push(manager);
      if (!fixture.realForward)
        vi.spyOn(manager, 'forwardPort').mockImplementation(fixture.forwardPort);
      return manager;
    }),
  };
});
vi.mock('../../backend/main/direct-relay', () => ({ DirectRelay: fixture.directRelay }));
vi.mock('../../backend/main/backend.ipc', () => ({
  BACKEND_CLIENT_DISCONNECTED_EVENT: 'backend-client-disconnected',
  getBackendClientForId: fixture.primaryClient,
  getBackendIdForIpcSender: vi.fn(),
  getConnectedDaemonProtocolVersion: fixture.protocol,
  getBackendClient: () => ({ request: fixture.ownerRequest }),
}));
vi.mock('../../../main/window', () => ({ getFocusedWindowBackendId: fixture.focusedBackend }));
vi.mock('../main/workspace-forward-cleanup.service', () => ({
  ensureWorkspaceForwardCleanup: vi.fn(),
  disposeWorkspaceForwardCleanupForClient: vi.fn(),
  resetWorkspaceForwardCleanup: vi.fn(),
}));
vi.mock('../main/embedded-browser-cdp-service', () => ({
  DEFAULT_AGENT_VIEWPORT: { width: 1280, height: 800 },
  AGENT_VIEWPORT_MIN_PX: 320,
  AGENT_VIEWPORT_MAX_PX: 3840,
  embeddedBrowserCdp: {
    waitForTabRegistration: vi.fn().mockResolvedValue(true),
    findModelTabByExactUrl: vi.fn().mockResolvedValue(undefined),
    findModelTabByRequestedUrl: vi.fn().mockResolvedValue(undefined),
    setTabOwner: vi.fn(),
    listAllTabs: vi.fn(async () => {
      const tab = fixture.send.mock.calls.at(-1)?.[2];
      return { tabs: tab ? [{ ...tab, mounted: true }] : [], stale: false };
    }),
  },
}));
vi.mock('../main/browser-capture-service', () => ({ browserCapture: {} }));
vi.mock('../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: fixture.send,
  getWindowIdForWorkspace: () => 1,
  getWindowIdsForWorkspace: () => [1],
}));

import { registerBrowserExecReverseHandler } from '../main/browser-exec-reverse';
import { TunnelForbiddenError } from '../../backend/main/tunnel-manager';

describe('saved-loopback browser.exec forwarding', () => {
  const requestedUrl = 'http://daemon.localhost:8080/preview?q=1#section';
  const fetchMock = vi.fn();
  const disposers: Array<() => void> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    fixture.constructorFailure = null;
    fixture.realForward = false;
    fixture.options.length = 0;
    fixture.forwardPort.mockReset().mockResolvedValue(45678);
    fixture.protocol.mockReturnValue('10.4');
    fixture.ownerRequest.mockResolvedValue({
      agent: { id: 'fixture-agent', name: 'Fixture agent' },
    });
    fixture.send.mockReturnValue({
      delivered: true,
      windowCount: 1,
      browserClientsNotified: false,
    });
    // A saved-client reverse call must never fall back to the focused local client.
    fixture.focusedBackend.mockImplementation(() => {
      throw new Error('wrong focused backend');
    });
    fixture.primaryClient.mockImplementation(() => {
      throw new Error('wrong primary client');
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    for (const manager of fixture.managers.splice(0)) manager.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function savedRoute(host = 'localhost') {
    const config: BackendConnectionConfig = {
      transport: 'wss',
      host,
      port: 9443,
      token: 'saved-fixture-token',
      fingerprint: 'AA:BB:CC:DD',
    };
    let callback: ((params: unknown) => Promise<ExecutionResult>) | undefined;
    const getConfig = vi.fn(() => config);
    const registerMethod = vi.fn((method: string, handler: typeof callback) => {
      expect(method).toBe('browser.exec');
      callback = handler;
      return () => {
        callback = undefined;
      };
    });
    const connection = {};
    const client = {
      getConfig,
      registerMethod,
      getRepositoryConnection: () => connection,
      requestOnCapturedConnection: async (captured: object, method: string, params: unknown) => {
        expect(captured).toBe(connection);
        expect(method).toBe('browser.listTabs');
        expect(params).toEqual({ workspaceId: 'fixture-workspace' });
        const tab = fixture.send.mock.calls.at(-1)?.[2];
        return {
          tabs: tab
            ? [
                {
                  ...tab,
                  hostClientId: 'fixture-client',
                  hostConnected: true,
                  visibility: 'hidden',
                  createdAt: '2026-10-05T06:00:00Z',
                  updatedAt: '2026-10-05T06:00:00Z',
                },
              ]
            : [],
        };
      },
    } as unknown as JsonRpcClient;
    disposers.push(
      registerBrowserExecReverseHandler(client, {
        backendId: 'saved-loopback-fixture',
        savedRemote: true,
        // Deliberately no executor override: use the production default route.
      }),
    );
    return {
      config,
      getConfig,
      open: () =>
        callback!({
          actions: [{ action: 'openTab', url: requestedUrl, visible: false }],
          workspaceId: 'fixture-workspace',
          agentId: 'fixture-agent',
        }),
    };
  }

  it('returns the actual forwarding failure through the saved reverse route', async () => {
    fixture.forwardPort.mockRejectedValue(new Error('SAVED_FORWARD_FAILURE'));
    const route = savedRoute();
    const result = await route.open();
    expect(result.success).toBe(false);
    expect(result.results[0]?.error).toContain('SAVED_FORWARD_FAILURE');
    expect(result.error).toContain('SAVED_FORWARD_FAILURE');
    expect(fixture.forwardPort).toHaveBeenCalledExactlyOnceWith(8080);
    expect(fixture.options[0].getConfig()).toEqual(route.config);
    expect(fixture.options[0].getProtocolVersion()).toBe('10.4');
    expect(fixture.protocol).toHaveBeenLastCalledWith('saved-loopback-fixture');
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.directRelay).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.focusedBackend).not.toHaveBeenCalled();
    expect(fixture.primaryClient).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('saved-fixture-token');
  });

  it('returns provider construction failure through the saved reverse route', async () => {
    fixture.constructorFailure = new Error('SAVED_PROVIDER_FAILURE');
    const result = await savedRoute().open();
    expect(result.results[0]?.error).toContain('SAVED_PROVIDER_FAILURE');
    expect(fixture.forwardPort).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports config disappearing after saved-remote selection using the real manager', async () => {
    fixture.realForward = true;
    const route = savedRoute();
    route.getConfig
      .mockReturnValueOnce(route.config) // context
      .mockReturnValueOnce(route.config) // backend choice
      .mockImplementation(() => {
        throw new Error('fixture config unavailable');
      });
    const result = await route.open();
    expect(result.results[0]?.error).toContain('no active backend config');
    expect(fixture.forwardPort).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.directRelay).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['localhost', '127.0.0.1'])(
    'preserves successful repeated resolution (%s)',
    async (host) => {
      const route = savedRoute(host);
      const first = await route.open();
      const second = await route.open();
      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(fixture.options).toHaveLength(1);
      expect(fixture.forwardPort).toHaveBeenCalledTimes(2);
      expect(fixture.send.mock.calls.map((call) => call[2].url)).toEqual([
        'http://127.0.0.1:45678/preview?q=1#section',
        'http://127.0.0.1:45678/preview?q=1#section',
      ]);
      expect(fixture.options[0].getConfig()).toEqual(route.config);
      expect(fixture.directRelay).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('does not open a tab or use a local relay after owner-only refusal', async () => {
    fixture.forwardPort.mockRejectedValue(new TunnelForbiddenError());
    const result = await savedRoute().open();
    expect(result.success).toBe(false);
    expect(result.results[0]?.error).toContain('cannot be forwarded');
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.directRelay).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a later successful request without retaining an earlier forwarding error', async () => {
    fixture.forwardPort.mockRejectedValueOnce(new Error('TRANSIENT_FORWARD_FAILURE'));
    const route = savedRoute();
    const failed = await route.open();
    expect(failed.success).toBe(false);
    expect(failed.error).toContain('TRANSIENT_FORWARD_FAILURE');
    expect(fixture.send).not.toHaveBeenCalled();
    const recovered = await route.open();
    expect(recovered.success).toBe(true);
    expect(recovered.error).toBeUndefined();
    expect(fixture.forwardPort).toHaveBeenCalledTimes(2);
    expect(fixture.options).toHaveLength(1);
    expect(fixture.send).toHaveBeenCalledTimes(1);
  });
});
