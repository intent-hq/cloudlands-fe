/**
 * HTTP MCP Bridge Tests
 *
 * Tests the HttpMcpBridge class: construction, start/stop lifecycle,
 * MCP server caching/eviction.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

// ── Hoisted mock state ──────────────────────────────────────────────
const {
  mockCreateWorkspaceMCPServer,
  mockRegisterPRTools,
  mockUnregisterPRTools,
  mockProtocolAdapter,
  mockFindAvailablePort,
  mockStoreMcpToolParams,
  mockExpressApp,
  mockHttpServer,
  mockElectronApp,
  eventHandlers,
  mockElectronStoreInstance,
  mockFromWebContents,
  createdWssInstances,
  createdHttpServers,
  makeMockHttpServer,
  mockIsWebSocketApiEnabled,
  mockIsDiscoveryEnabled,
  mockStartDiscovery,
  mockStopDiscovery,
  mockClearDiscoveryAutoOffTimer,
  wsApiServerNextStart,
  createdWsApiServers,
} = vi.hoisted(() => {
  const mockFromWebContents = vi.fn().mockReturnValue(null);
  const mockExpressApp: any = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    listen: vi.fn(),
  };

  // Shared spies that aggregate calls across every server instance created
  // by the factory. Tests configure behavior (mockImplementation) on these
  // shared spies and every fresh instance delegates through them. Per-instance
  // identity is preserved separately in `createdHttpServers` so tests can
  // assert "each failed attempt closed its own server" (T6).
  const mockHttpServer: any = {
    listen: vi.fn(),
    close: vi.fn((cb?: Function) => cb?.()),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };

  const createdHttpServers: any[] = [];
  function makeMockHttpServer() {
    const instance: any = {
      listen: vi.fn((...args: any[]) => (mockHttpServer.listen as any)(...args)),
      close: vi.fn((...args: any[]) => (mockHttpServer.close as any)(...args)),
      on: vi.fn((...args: any[]) => (mockHttpServer.on as any)(...args)),
      once: vi.fn((...args: any[]) => (mockHttpServer.once as any)(...args)),
      removeListener: vi.fn(
        (...args: any[]) => (mockHttpServer.removeListener as any)(...args),
      ),
    };
    createdHttpServers.push(instance);
    return instance;
  }

  const eventHandlers: Record<string, Function[]> = {};

  const mockElectronApp = { getPath: vi.fn().mockReturnValue('/tmp'), isPackaged: false };

  const mockElectronStoreInstance = {
    set: vi.fn(),
    get: vi.fn(),
    store: {},
    path: '/tmp/settings.json',
  };

  // Tracks every WebSocketServer instance the factory creates.
  const createdWssInstances: any[] = [];

  const createdWsApiServers: any[] = [];

  return {
    mockCreateWorkspaceMCPServer: vi.fn().mockResolvedValue({
      getTools: vi.fn().mockReturnValue([{ name: 'test_tool' }]),
      handleMessage: vi.fn().mockResolvedValue({ jsonrpc: '2.0', result: {} }),
      setToolCallContext: vi.fn(),
      clearToolCallContext: vi.fn(),
      notifyToolsListChanged: vi.fn(),
    }),
    mockRegisterPRTools: vi.fn(),
    mockUnregisterPRTools: vi.fn(),
    mockProtocolAdapter: {
      getWorkspace: vi.fn().mockResolvedValue(null),
    },
    mockFindAvailablePort: vi.fn().mockImplementation((port: number) => Promise.resolve(port)),
    mockStoreMcpToolParams: vi.fn(),
    mockExpressApp,
    mockHttpServer,
    mockElectronApp,
    eventHandlers,
    mockElectronStoreInstance,
    mockFromWebContents,
    createdWssInstances,
    createdHttpServers,
    makeMockHttpServer,
    // WS API + discovery defaults: disabled so existing bridge tests are
    // unaffected. Tests that exercise the WS API path opt in by configuring
    // these mocks before starting / updating the bridge.
    mockIsWebSocketApiEnabled: vi.fn().mockReturnValue(false),
    mockIsDiscoveryEnabled: vi.fn().mockReturnValue(false),
    mockStartDiscovery: vi.fn(),
    mockStopDiscovery: vi.fn(),
    mockClearDiscoveryAutoOffTimer: vi.fn(),
    createdWsApiServers,
    // Per-test override for what the next `new WebSocketApiServer().start()`
    // returns. Default: a resolved Promise (no-op).
    wsApiServerNextStart: { value: () => Promise.resolve() as Promise<void> },
  };
});

// ── Module mocks ────────────────────────────────────────────────────
vi.mock('express', () => {
  const expressFn: any = () => mockExpressApp;
  expressFn.json = vi.fn().mockReturnValue(vi.fn());
  return { default: expressFn };
});

vi.mock('http', async (importOriginal) => {
  const actual = await importOriginal() as any;
  // Each createServer() call returns a *fresh* mock instance so tests can
  // verify per-attempt teardown (T6). The shared spies on `mockHttpServer`
  // still receive all calls via delegation, so existing tests that assert
  // against `mockHttpServer.listen`/`.close` continue to work.
  return {
    ...actual,
    default: { ...actual, createServer: vi.fn(() => makeMockHttpServer()) },
    createServer: vi.fn(() => makeMockHttpServer()),
  };
});

// Track every WebSocketServer instance created so tests can inspect them
// (created by the mock factory; hoisted so the factory can reference it).
vi.mock('../utils/ws-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/ws-runtime')>();
  // Must use function (not arrow) so it can be called with `new`
  function MockWebSocketServer(this: any, options?: any) {
    const handlers: Record<string, Function[]> = {};
    const self: any = {
      options,
      on: vi.fn((event: string, cb: Function) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(cb);
        return self;
      }),
      emit: vi.fn((event: string, ...args: any[]) => {
        for (const handler of handlers[event] || []) {
          handler(...args);
        }
        return true;
      }),
      clients: new Set(),
      close: vi.fn((cb?: Function) => cb?.()),
    };
    createdWssInstances.push(self);
    return self;
  }
  class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;

    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  }
  return {
    ...actual,
    getWebSocketClass: () => MockWebSocket,
    getWebSocketServerClass: () => MockWebSocketServer,
  };
});

vi.mock('electron', () => ({
  app: mockElectronApp,
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { fromWebContents: mockFromWebContents },
}));

vi.mock('electron-store', () => ({
  __esModule: true,
  default: function MockElectronStore() {
    return mockElectronStoreInstance;
  },
}));

vi.mock('../../features/mcp/main/mcp/index', () => ({
  createWorkspaceMCPServer: mockCreateWorkspaceMCPServer,
  registerPRTools: mockRegisterPRTools,
  unregisterPRTools: mockUnregisterPRTools,
}));

vi.mock('../../features/protocol/main/protocol-adapter', () => ({
  protocolAdapter: mockProtocolAdapter,
}));

// unified-event-bus was deleted; workspace cleanup is now handled by sagas
// The setupWorkspaceCleanupListeners() in HttpMcpBridge is now a no-op

vi.mock('../../utils/port-utils', () => ({
  findAvailablePort: mockFindAvailablePort,
}));

vi.mock('../../shared/services/mcp-tool-params-cache', () => ({
  storeMcpToolParams: mockStoreMcpToolParams,
}));

// WS API server: a controllable stub. Tests can swap `wsApiServerNextStart.value`
// to make `start()` reject and exercise the unrecoverable hook (L8).
vi.mock('../websocket-api-server', () => {
  function MockWebSocketApiServer(this: any, port: number) {
    let running = false;
    const startFn = wsApiServerNextStart.value;
    const self: any = {
      start: vi.fn(async () => {
        const result = startFn();
        await result;
        running = true;
      }),
      stop: vi.fn(async () => {
        running = false;
      }),
      isRunning: () => running,
      getPort: () => port,
      getCertFingerprint: () => 'AA:BB',
    };
    createdWsApiServers.push(self);
    return self;
  }
  return { WebSocketApiServer: MockWebSocketApiServer };
});

vi.mock('../websocket-auth', () => ({
  isWebSocketApiEnabled: mockIsWebSocketApiEnabled,
  isDiscoveryEnabled: mockIsDiscoveryEnabled,
  // Re-export the rest as no-ops so any incidental imports keep working.
  generateToken: vi.fn().mockReturnValue('tok'),
  getToken: vi.fn().mockReturnValue('tok'),
  validateToken: vi.fn().mockReturnValue(true),
  setWebSocketApiEnabled: vi.fn(),
  setDiscoveryEnabled: vi.fn(),
  extractBearerToken: vi.fn().mockReturnValue(null),
  getWssCertFingerprint: vi.fn().mockReturnValue(null),
}));

vi.mock('../websocket-discovery', () => ({
  startDiscovery: mockStartDiscovery,
  stopDiscovery: mockStopDiscovery,
  isDiscoveryActive: vi.fn().mockReturnValue(false),
}));

// ── Import after mocks ──────────────────────────────────────────────
import { __resolveWsModuleForTests } from '../utils/ws-runtime';
import { HttpMcpBridge } from '../http-mcp-bridge';

const originalNodeEnv = process.env.NODE_ENV;
const originalClearDiscoveryAutoOffTimer = (globalThis as any)
  .__clearWebSocketDiscoveryAutoOffTimer;

function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env.NODE_ENV;
    return;
  }
  process.env.NODE_ENV = value;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Start the bridge and simulate the server listen callback.
 * Handles the async flow: findAvailablePort -> server.listen -> callback.
 */
async function startBridge(b: HttpMcpBridge): Promise<void> {
  // Make server.listen call its callback synchronously
  mockHttpServer.listen.mockImplementation((_port: number, _host: string, cb: Function) => {
    cb();
  });
  await b.start();
}

/** Clear event handler registry between tests. */
function clearEventHandlers() {
  for (const key of Object.keys(eventHandlers)) {
    delete eventHandlers[key];
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ws module resolution', () => {
  class MockWebSocket {}
  class DefaultWebSocket {}
  class MockWebSocketServer {}

  it.each([
    ['module.WebSocketServer', { WebSocket: MockWebSocket, WebSocketServer: MockWebSocketServer }],
    ['module.Server', { WebSocket: MockWebSocket, Server: MockWebSocketServer }],
    [
      'module.default.WebSocketServer',
      { WebSocket: MockWebSocket, default: { WebSocketServer: MockWebSocketServer } },
    ],
    [
      'module.default.Server',
      { WebSocket: MockWebSocket, default: { Server: MockWebSocketServer } },
    ],
  ])('resolves WebSocketServer from %s', (_label, moduleValue) => {
    const resolved = __resolveWsModuleForTests(moduleValue);

    expect(resolved.WebSocket).toBe(MockWebSocket);
    expect(resolved.WebSocketServer).toBe(MockWebSocketServer);
  });

  it('resolves the client constructor from default.WebSocket', () => {
    const resolved = __resolveWsModuleForTests({
      Server: MockWebSocketServer,
      default: { WebSocket: DefaultWebSocket },
    });

    expect(resolved.WebSocket).toBe(DefaultWebSocket);
    expect(resolved.WebSocketServer).toBe(MockWebSocketServer);
  });

  it('resolves packaged ws shape where the module value is the client and Server is attached', () => {
    class PackagedWebSocket {
      static Server = MockWebSocketServer;
    }

    const resolved = __resolveWsModuleForTests(PackagedWebSocket);

    expect(resolved.WebSocket).toBe(PackagedWebSocket);
    expect(resolved.WebSocketServer).toBe(MockWebSocketServer);
  });

  it('throws a safe diagnostic when no constructable server is available', () => {
    expect(() =>
      __resolveWsModuleForTests({
        WebSocket: MockWebSocket,
        Server: 'not-a-constructor',
        default: { WebSocketServer: {} },
      }),
    ).toThrow(/Unable to resolve ws WebSocketServer constructor; module shape: .*Server:string/);
  });
});

describe('HttpMcpBridge', () => {
  let bridge: HttpMcpBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    clearEventHandlers();
    createdWssInstances.length = 0;
    createdHttpServers.length = 0;
    createdWsApiServers.length = 0;
    mockIsWebSocketApiEnabled.mockReturnValue(false);
    mockIsDiscoveryEnabled.mockReturnValue(false);
    wsApiServerNextStart.value = () => Promise.resolve();
    // Reset the listen mock to call callback synchronously
    mockHttpServer.listen.mockImplementation((_port: number, _host: string, cb: Function) => {
      cb();
    });
    // Reset on()/once() to passthroughs that record calls but store nothing special.
    mockHttpServer.on.mockImplementation(() => {});
    mockHttpServer.once.mockImplementation(() => {});
    mockHttpServer.removeListener.mockImplementation(() => {});
    mockHttpServer.close.mockImplementation((cb?: Function) => cb?.());
    mockElectronApp.isPackaged = false;
    (globalThis as any).__clearWebSocketDiscoveryAutoOffTimer = mockClearDiscoveryAutoOffTimer;
    setNodeEnv(originalNodeEnv);
  });

  afterEach(async () => {
    // HttpMcpBridge starts a setInterval in its constructor (startCacheCleanupInterval).
    // Always call stop() to clear it and prevent leaked timers / flaky hangs.
    await bridge?.stop();
  });

  afterEach(() => {
    if (originalClearDiscoveryAutoOffTimer) {
      (globalThis as any).__clearWebSocketDiscoveryAutoOffTimer =
        originalClearDiscoveryAutoOffTimer;
    } else {
      delete (globalThis as any).__clearWebSocketDiscoveryAutoOffTimer;
    }
  });

  afterEach(async () => {
    // HttpMcpBridge starts a setInterval in its constructor (startCacheCleanupInterval).
    // Always call stop() to clear it and prevent leaked timers / flaky hangs.
    await bridge?.stop();
  });

  // ── Construction ────────────────────────────────────────────────

  describe('construction', () => {
    it('creates an instance without errors', () => {
      bridge = new HttpMcpBridge(5179);
      expect(bridge).toBeInstanceOf(HttpMcpBridge);
    });

    it('uses the provided port', () => {
      bridge = new HttpMcpBridge(9999);
      expect(bridge.getPort()).toBe(9999);
    });

    it('falls back to env var or default port', () => {
      const origEnv = process.env.HTTP_MCP_PORT;
      process.env.HTTP_MCP_PORT = '7777';
      bridge = new HttpMcpBridge();
      expect(bridge.getPort()).toBe(7777);
      process.env.HTTP_MCP_PORT = origEnv;
    });

    it('initializes ElectronStore and sets start time', () => {
      bridge = new HttpMcpBridge(5179);
      expect(mockElectronStoreInstance.set).toHaveBeenCalledWith(
        'http-bridge-start-time',
        expect.any(String),
      );
    });

    it('handles ElectronStore initialization failure gracefully', () => {
      // Make the store.set throw
      mockElectronStoreInstance.set.mockImplementationOnce(() => {
        throw new Error('Store init failed');
      });
      // Should not throw — the constructor catches the error
      const b = new HttpMcpBridge(5179);
      expect(b).toBeInstanceOf(HttpMcpBridge);
      // Assign to `bridge` so top-level afterEach cleans up the interval
      bridge = b;
    });

    it('sets up express app with middleware and routes', () => {
      bridge = new HttpMcpBridge(5179);
      // express().use() should have been called for CORS and JSON middleware
      expect(mockExpressApp.use).toHaveBeenCalled();
      // Routes should be registered
      expect(mockExpressApp.get).toHaveBeenCalled();
      expect(mockExpressApp.post).toHaveBeenCalled();
    });

    it.each(['http://127.0.0.1:5177', 'http://localhost:5177'])(
      'allows explicit dev renderer origin %s in CORS response',
      (origin) => {
        bridge = new HttpMcpBridge(5179);
        const corsMiddleware = mockExpressApp.use.mock.calls[0][0];
        const req = { method: 'POST', headers: { origin } };
        const res = { header: vi.fn(), sendStatus: vi.fn() };
        const next = vi.fn();

        corsMiddleware(req, res, next);

        expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', origin);
        expect(res.header).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
        expect(res.header).toHaveBeenCalledWith('Vary', 'Origin');
        expect(next).toHaveBeenCalled();
      },
    );

    it.each(['https://example.com', 'null', 'file://'])(
      'does not grant CORS access to disallowed browser origin %s',
      (origin) => {
        bridge = new HttpMcpBridge(5179);
        const corsMiddleware = mockExpressApp.use.mock.calls[0][0];
        const req = { method: 'POST', headers: { origin } };
        const res = { header: vi.fn(), sendStatus: vi.fn() };
        const next = vi.fn();

        corsMiddleware(req, res, next);

        expect(res.header).not.toHaveBeenCalledWith(
          'Access-Control-Allow-Origin',
          expect.anything(),
        );
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
      },
    );

    it('continues no-origin requests for non-browser clients without CORS headers', () => {
      bridge = new HttpMcpBridge(5179);
      const corsMiddleware = mockExpressApp.use.mock.calls[0][0];
      const req = { method: 'POST', headers: {} };
      const res = { header: vi.fn(), sendStatus: vi.fn() };
      const next = vi.fn();

      corsMiddleware(req, res, next);

      expect(res.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        expect.anything(),
      );
      expect(res.sendStatus).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('allows browser workspace identity header in trusted CORS preflight', () => {
      bridge = new HttpMcpBridge(5179);
      const corsMiddleware = mockExpressApp.use.mock.calls[0][0];
      const req = { method: 'OPTIONS', headers: { origin: 'app://workspaces' } };
      const res = { header: vi.fn(), sendStatus: vi.fn() };
      const next = vi.fn();

      corsMiddleware(req, res, next);

      expect(res.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'app://workspaces',
      );
      expect(res.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'Content-Type, x-workspace-id',
      );
      expect(res.sendStatus).toHaveBeenCalledWith(200);
      expect(next).not.toHaveBeenCalled();
    });

    it.each(['https://example.com', 'null', 'file://'])(
      'rejects disallowed browser preflight from %s without CORS headers',
      (origin) => {
        bridge = new HttpMcpBridge(5179);
        const corsMiddleware = mockExpressApp.use.mock.calls[0][0];
        const req = { method: 'OPTIONS', headers: { origin } };
        const res = { header: vi.fn(), sendStatus: vi.fn() };
        const next = vi.fn();

        corsMiddleware(req, res, next);

        expect(res.header).not.toHaveBeenCalledWith(
          'Access-Control-Allow-Origin',
          expect.anything(),
        );
        expect(res.sendStatus).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
      },
    );

    it('setupWorkspaceCleanupListeners is a no-op (handled by sagas)', () => {
      bridge = new HttpMcpBridge(5179);
      // Event listeners are no longer registered directly — handled by sagas
      expect(eventHandlers['workspace:deleting']).toBeUndefined();
      expect(eventHandlers['workspace:deleted']).toBeUndefined();
      expect(eventHandlers['workspace:updated']).toBeUndefined();
    });
  });

  // ── Start / Stop Lifecycle ──────────────────────────────────────

  describe('start/stop lifecycle', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
    });

    it('start() creates HTTP server and listens on the correct port', async () => {
      await bridge.start();

      // Verify the HTTP server was told to listen on the correct port and host
      expect(mockHttpServer.listen).toHaveBeenCalledWith(5179, '127.0.0.1', expect.any(Function));
      expect(mockHttpServer.listen).not.toHaveBeenCalledWith(
        5179,
        '0.0.0.0',
        expect.any(Function),
      );
    });

    it('start() listens on IPv4 loopback in production', async () => {
      setNodeEnv('production');

      await bridge.start();

      expect(mockHttpServer.listen).toHaveBeenCalledWith(5179, '127.0.0.1', expect.any(Function));
      expect(mockHttpServer.listen).not.toHaveBeenCalledWith(
        5179,
        '0.0.0.0',
        expect.any(Function),
      );
    });

    it('start() listens on IPv4 loopback when packaged', async () => {
      mockElectronApp.isPackaged = true;

      await bridge.start();

      expect(mockHttpServer.listen).toHaveBeenCalledWith(5179, '127.0.0.1', expect.any(Function));
      expect(mockHttpServer.listen).not.toHaveBeenCalledWith(
        5179,
        '0.0.0.0',
        expect.any(Function),
      );
    });

    it('start() calls findAvailablePort', async () => {
      await bridge.start();

      expect(mockFindAvailablePort).toHaveBeenCalledWith(5179, 10);
    });

    it('start() sets HTTP_MCP_PORT env var after binding', async () => {
      await bridge.start();

      expect(process.env.HTTP_MCP_PORT).toBe('5179');
    });

    it('stop() closes server and cleans up', async () => {
      await bridge.start();
      await bridge.stop();

      expect(mockHttpServer.close).toHaveBeenCalled();
    });

    it('stop() without start does not throw', async () => {
      await expect(bridge.stop()).resolves.not.toThrow();
    });

    it('stop() clears the cache cleanup interval', async () => {
      await bridge.start();

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      await bridge.stop();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('stop() clears the WebSocket discovery auto-off timer hook', async () => {
      await bridge.stop();

      expect(mockClearDiscoveryAutoOffTimer).toHaveBeenCalledTimes(1);
    });

    it('stop() clears all cached MCP servers', async () => {
      await bridge.start();

      await bridge.stop();
      const statsAfter = bridge.getMcpServerCacheStats();
      expect(statsAfter.total).toBe(0);
    });
  });

  // ── MCP Server Caching ──────────────────────────────────────────

  describe('MCP server caching', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
    });

    it('getMcpServerCacheStats returns empty stats initially', () => {
      const stats = bridge.getMcpServerCacheStats();
      expect(stats.total).toBe(0);
      expect(stats.servers).toHaveLength(0);
    });

    it('clearMcpServersForWorkspace returns 0 when no servers cached', () => {
      const count = bridge.clearMcpServersForWorkspace('nonexistent');
      expect(count).toBe(0);
    });

    it('clearAllMcpServers returns 0 when no servers cached', () => {
      const count = bridge.clearAllMcpServers();
      expect(count).toBe(0);
    });

    it('clearMcpServersForWorkspace can be called directly (used by sagas)', () => {
      // workspace:deleting and workspace:deleted are now handled by sagas which
      // call bridge.clearMcpServersForWorkspace() directly
      const clearSpy = vi.spyOn(bridge, 'clearMcpServersForWorkspace');
      bridge.clearMcpServersForWorkspace('ws-123');
      expect(clearSpy).toHaveBeenCalledWith('ws-123');
    });

    it('healthCheckMcpServers returns correct stats with no servers', async () => {
      const result = await bridge.healthCheckMcpServers();
      expect(result).toEqual({
        checked: 0,
        healthy: 0,
        unhealthy: 0,
        removed: [],
      });
    });

    it('healthCheckMcpServers filters by workspaceId', async () => {
      const result = await bridge.healthCheckMcpServers('specific-ws');
      expect(result.checked).toBe(0);
    });
  });

  // ── Route Handler Tests (adapted from integration tests) ────────

  describe('Health Check (route handler)', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
    });

    it('should respond to health check via route handler', async () => {
      await startBridge(bridge);

      // Extract the /health GET handler registered on the mock express app
      const healthCall = mockExpressApp.get.mock.calls.find(
        (call: any[]) => call[0] === '/health',
      );
      expect(healthCall).toBeDefined();
      const healthHandler = healthCall![1];

      const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await healthHandler({}, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          service: 'http-mcp-bridge',
          timestamp: expect.any(String),
          tools: expect.any(Array),
        }),
      );
    });
  });

  describe('MCP Protocol (route handler)', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
    });

    it('should handle tools/list request via route handler', async () => {
      await startBridge(bridge);

      // Extract the /mcp POST handler
      const mcpCall = mockExpressApp.post.mock.calls.find(
        (call: any[]) => call[0] === '/mcp',
      );
      expect(mcpCall).toBeDefined();
      const mcpHandler = mcpCall![1];

      const req = {
        body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
        headers: { 'x-workspace-id': 'test-ws' },
        header: vi.fn().mockReturnValue('test-ws'),
      };
      const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await mcpHandler(req, res);

      // The handler should respond (either with result or error)
      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.jsonrpc).toBe('2.0');
    });
  });

  describe('Tool Execution (route handler)', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
    });

    it('should handle workspace_api tool call via route handler', async () => {
      await startBridge(bridge);

      const mcpCall = mockExpressApp.post.mock.calls.find(
        (call: any[]) => call[0] === '/mcp',
      );
      expect(mcpCall).toBeDefined();
      const mcpHandler = mcpCall![1];

      const req = {
        body: {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'workspace_api',
            arguments: { code: 'return await ws.workspace.info()' },
          },
          id: 2,
        },
        headers: { 'x-workspace-id': 'test-ws' },
        header: vi.fn().mockReturnValue('test-ws'),
      };
      const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      await mcpHandler(req, res);

      // The handler should respond (either with result or error)
      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.jsonrpc).toBe('2.0');
    });
  });

  describe('MCP Server Cache Management', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
    });

    it('should provide cache stats', () => {
      const stats = bridge.getMcpServerCacheStats();
      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(stats.servers)).toBe(true);
    });
  });


  // ── getPort ─────────────────────────────────────────────────────

  describe('getPort', () => {
    it('returns the configured port', () => {
      bridge = new HttpMcpBridge(4242);
      expect(bridge.getPort()).toBe(4242);
    });
  });

  // ── Port retry on EADDRINUSE (serialised start with backoff + fallthrough) ─

  describe('port retry on EADDRINUSE', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
      // Zero backoff so tests finish instantly.
      (bridge as any).listenBackoffMs = [0, 0, 0];
    });

    /**
     * Helper: set up mockHttpServer so that the first `failCount` listen()
     * calls emit EADDRINUSE via the error handler, and subsequent calls succeed.
     * Returns an object tracking the ports that were attempted.
     */
    function setupEADDRINUSE(failCount: number) {
      const attemptedPorts: number[] = [];
      // Track error handlers: each once('error') pushes; each listen uses the latest.
      const errorHandlers: Function[] = [];

      mockHttpServer.once.mockImplementation((event: string, handler: Function) => {
        if (event === 'error') errorHandlers.push(handler);
      });
      mockHttpServer.removeListener.mockImplementation(
        (event: string, handler: Function) => {
          if (event === 'error') {
            const idx = errorHandlers.indexOf(handler);
            if (idx >= 0) errorHandlers.splice(idx, 1);
          }
        },
      );

      mockHttpServer.listen.mockImplementation((port: number, _host: string, cb: Function) => {
        attemptedPorts.push(port);
        if (attemptedPorts.length <= failCount) {
          const handler = errorHandlers[errorHandlers.length - 1];
          setTimeout(() => {
            const err: any = new Error('listen EADDRINUSE: address already in use');
            err.code = 'EADDRINUSE';
            handler?.(err);
          }, 0);
        } else {
          cb();
        }
      });

      mockFindAvailablePort.mockImplementation((port: number) => Promise.resolve(port));

      return { attemptedPorts };
    }

    it('retries the SAME port with backoff before falling through', async () => {
      const { attemptedPorts } = setupEADDRINUSE(1);
      await bridge.start();
      // One failure on 5179 → waits → retries 5179 → succeeds.
      expect(attemptedPorts).toEqual([5179, 5179]);
      expect(bridge.getPort()).toBe(5179);
    });

    it('falls through to the next port after same-port attempts are exhausted', async () => {
      // backoff length 3 → 4 attempts per port. Fail all 4 on 5179, succeed on 5180.
      const { attemptedPorts } = setupEADDRINUSE(4);
      await bridge.start();
      expect(attemptedPorts).toEqual([5179, 5179, 5179, 5179, 5180]);
      expect(bridge.getPort()).toBe(5180);
    });

    it('start() rejects cleanly on persistent EADDRINUSE (no unhandled exception)', async () => {
      // Fail every attempt so start() is forced to give up.
      // 10 ports × 4 attempts = 40 failures is enough.
      setupEADDRINUSE(1000);
      // Track unhandledRejection / uncaughtException while start runs.
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      const onUncaught = (err: unknown) => unhandled.push(err);
      process.on('unhandledRejection', onUnhandled);
      process.on('uncaughtException', onUncaught);
      try {
        await expect(bridge.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
        // Give the loop a tick to surface any async error.
        await new Promise((r) => setTimeout(r, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
        process.off('uncaughtException', onUncaught);
      }
    });

    it('start() refuses to run while server is still non-null (must stop() first)', async () => {
      await startBridge(bridge);
      // Don't call stop(); start() should refuse.
      await expect(bridge.start()).rejects.toThrow(/server is still running/i);
    });
  });

  // ── stop() lifecycle: WSS close + null refs (DoD #3) ───────────
  describe('stop() lifecycle', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).listenBackoffMs = [0, 0, 0];
    });

    it('closes the WebSocketServer and nulls server/wss', async () => {
      await startBridge(bridge);
      const wssInstance = (bridge as any).wss;
      expect((bridge as any).server).not.toBeNull();
      expect(wssInstance).not.toBeNull();
      // Spy on close() so we can assert it was called even if the real ws
      // module is used at runtime (createRequire bypasses vi.mock).
      const closeSpy = vi.spyOn(wssInstance, 'close').mockImplementation((cb?: any) => {
        if (typeof cb === 'function') cb();
      });

      await bridge.stop();

      expect(closeSpy).toHaveBeenCalled();
      expect(mockHttpServer.close).toHaveBeenCalled();
      expect((bridge as any).server).toBeNull();
      expect((bridge as any).wss).toBeNull();
    });

    it('unregisters the browser IPC broadcast adapter on stop', async () => {
      await startBridge(bridge);
      expect((global as any).__browserIpcBroadcast).toEqual(expect.any(Function));

      await bridge.stop();

      expect((global as any).__browserIpcBroadcast).toBeUndefined();
    });

    it('terminates any connected WebSocket clients before closing WSS', async () => {
      await startBridge(bridge);
      const wssInstance = (bridge as any).wss;
      expect(wssInstance).not.toBeNull();
      // Make close() resolve synchronously so stop() can progress.
      vi.spyOn(wssInstance, 'close').mockImplementation((cb?: any) => {
        if (typeof cb === 'function') cb();
      });
      const client1 = { terminate: vi.fn() };
      const client2 = { terminate: vi.fn() };
      // wssInstance.clients is a Set-like from real ws; we can add to it.
      (wssInstance.clients as Set<any>).add(client1);
      (wssInstance.clients as Set<any>).add(client2);

      await bridge.stop();

      expect(client1.terminate).toHaveBeenCalled();
      expect(client2.terminate).toHaveBeenCalled();
    });

    // ── stop() coordination with in-flight start() retries (Fix 4) ────
    it('start() aborts cleanly without binding when stop() fires during backoff', async () => {
      // Backoff long enough that stop() can race in before the retry completes.
      (bridge as any).listenBackoffMs = [50, 50, 50];

      // Every listen() attempt returns EADDRINUSE so start() falls into backoff.
      const errorHandlers: Function[] = [];
      mockHttpServer.once.mockImplementation((event: string, handler: Function) => {
        if (event === 'error') errorHandlers.push(handler);
      });
      mockHttpServer.removeListener.mockImplementation(
        (event: string, handler: Function) => {
          if (event === 'error') {
            const idx = errorHandlers.indexOf(handler);
            if (idx >= 0) errorHandlers.splice(idx, 1);
          }
        },
      );
      let listenCalls = 0;
      mockHttpServer.listen.mockImplementation(
        (_port: number, _host: string, _cb: Function) => {
          listenCalls++;
          const handler = errorHandlers[errorHandlers.length - 1];
          setTimeout(() => {
            const err: any = new Error('listen EADDRINUSE');
            err.code = 'EADDRINUSE';
            handler?.(err);
          }, 0);
        },
      );
      mockFindAvailablePort.mockImplementation((port: number) => Promise.resolve(port));

      const startPromise = bridge.start();
      // Let start() enter its first backoff sleep.
      await new Promise((r) => setTimeout(r, 10));
      // Fire stop() while start() is mid-retry.
      const stopPromise = bridge.stop();

      // start() must return without throwing AND without publishing a server.
      // It signals the abort via the 'aborted' return value (R2) so callers
      // like restart() can distinguish "bound successfully" from "bailed out".
      await expect(startPromise).resolves.toBe('aborted');
      await expect(stopPromise).resolves.toBeUndefined();
      expect((bridge as any).server).toBeNull();
      expect((bridge as any).wss).toBeNull();
      // Should have attempted at least once; the flag cut the retries short.
      expect(listenCalls).toBeGreaterThanOrEqual(1);
    });

    it('stop() completes promptly even with an in-flight restart (bounded wait)', async () => {
      await startBridge(bridge);
      // Kick off a restart; immediately call stop() to race with it.
      // We don't care about restart's outcome — just that stop() is bounded.
      const restartPromise = bridge.restart().catch(() => {
        /* expected: may fail because stop() races the restart */
      });
      const start = Date.now();
      await bridge.stop();
      const elapsed = Date.now() - start;
      // The wait in stop() is capped at 1s; total should be well under 2s.
      expect(elapsed).toBeLessThan(2000);
      await restartPromise;
      expect((bridge as any).server).toBeNull();
    });
  });

  // ── restart() serialisation + ensureHealthy() behaviour (DoD #2, #6) ───
  describe('restart() and ensureHealthy()', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).listenBackoffMs = [0, 0, 0];
      (bridge as any).healthRetryBackoffMs = 0;
    });

    it('concurrent restart() calls share one in-flight promise', async () => {
      await startBridge(bridge);
      const startSpy = vi.spyOn(bridge, 'start');
      const stopSpy = vi.spyOn(bridge, 'stop');

      // Fire three concurrent restart() calls.
      const [r1, r2, r3] = [bridge.restart(), bridge.restart(), bridge.restart()];
      // They should all resolve — and represent exactly ONE stop/start pair.
      await Promise.all([r1, r2, r3]);

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it('restart() releases the in-flight promise after completion', async () => {
      await startBridge(bridge);
      await bridge.restart();
      expect((bridge as any).restartPromise).toBeNull();
      // A subsequent restart() should actually run.
      const startSpy = vi.spyOn(bridge, 'start');
      await bridge.restart();
      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it('restart() preserves the WebSocket discovery auto-off timer hook', async () => {
      mockIsWebSocketApiEnabled.mockReturnValue(true);
      mockIsDiscoveryEnabled.mockReturnValue(true);
      await startBridge(bridge);
      mockClearDiscoveryAutoOffTimer.mockClear();
      mockStartDiscovery.mockClear();

      await bridge.restart();

      expect(mockClearDiscoveryAutoOffTimer).not.toHaveBeenCalled();
      expect(mockStartDiscovery).toHaveBeenCalledWith(5180, 'AA:BB');
    });

    it('ensureHealthy() returns true without restarting when /health is ok', async () => {
      await startBridge(bridge);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'ok' }),
      } as any);
      const restartSpy = vi.spyOn(bridge, 'restart');
      try {
        expect(await bridge.ensureHealthy()).toBe(true);
        expect(restartSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('ensureHealthy() is idempotent under concurrent callers', async () => {
      await startBridge(bridge);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'ok' }),
      } as any);
      try {
        const results = await Promise.all([
          bridge.ensureHealthy(),
          bridge.ensureHealthy(),
          bridge.ensureHealthy(),
          bridge.ensureHealthy(),
        ]);
        expect(results).toEqual([true, true, true, true]);
        // Coalesced probe — at most one fetch per burst.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('ensureHealthy() emits httpBridgeUnrecoverable when restart fails', async () => {
      await startBridge(bridge);
      // /health keeps returning non-ok so isHealthy() → false.
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ status: 'down' }),
      } as any);
      // Force restart() to throw.
      const restartSpy = vi
        .spyOn(bridge, 'restart')
        .mockRejectedValue(new Error('restart boom'));

      const { onHttpBridgeUnrecoverable } = await import('../http-mcp-bridge');
      const handler = vi.fn();
      const off = onHttpBridgeUnrecoverable(handler);
      try {
        expect(await bridge.ensureHealthy()).toBe(false);
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            reason: 'restart-failed',
            port: expect.any(Number),
            timestamp: expect.any(Number),
          }),
        );
      } finally {
        off();
        fetchSpy.mockRestore();
        restartSpy.mockRestore();
      }
    });

    it('emitHttpBridgeUnrecoverable swallows async handler rejections (no unhandled rejection)', async () => {
      await startBridge(bridge);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ status: 'down' }),
      } as any);
      const restartSpy = vi
        .spyOn(bridge, 'restart')
        .mockRejectedValue(new Error('restart boom'));

      const { onHttpBridgeUnrecoverable } = await import('../http-mcp-bridge');
      // Async handler whose returned Promise rejects — must not leak.
      const asyncHandler = vi.fn(async () => {
        throw new Error('async handler boom');
      });
      const off = onHttpBridgeUnrecoverable(asyncHandler);

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        expect(await bridge.ensureHealthy()).toBe(false);
        expect(asyncHandler).toHaveBeenCalledTimes(1);
        // Give the microtask queue a few ticks so any rejection would surface.
        await new Promise((r) => setTimeout(r, 10));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
        off();
        fetchSpy.mockRestore();
        restartSpy.mockRestore();
      }
    });

    // L8: dynamic WS API server start failures bubble into the same
    // unrecoverable hook with reason 'ws-api-start-failed'.
    it('updateWebSocketApiServer() emits ws-api-start-failed on dynamic start failure', async () => {
      await startBridge(bridge);

      // Arrange: WS API is now enabled, but the next start() will reject.
      mockIsWebSocketApiEnabled.mockReturnValue(true);
      const wsBoom = new Error('ws listen EADDRINUSE');
      wsApiServerNextStart.value = () => Promise.reject(wsBoom);

      const { onHttpBridgeUnrecoverable } = await import('../http-mcp-bridge');
      const handler = vi.fn();
      const off = onHttpBridgeUnrecoverable(handler);
      try {
        await expect(bridge.updateWebSocketApiServer()).rejects.toBe(wsBoom);
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            reason: 'ws-api-start-failed',
            error: wsBoom,
            port: expect.any(Number),
            timestamp: expect.any(Number),
          }),
        );
        expect(bridge.getWebSocketApiServer()).toBeNull();
      } finally {
        off();
        mockIsWebSocketApiEnabled.mockReturnValue(false);
        wsApiServerNextStart.value = () => Promise.resolve();
      }
    });

    it('updateWebSocketApiServer() releases stopped dynamic server before toggle-on creates a replacement', async () => {
      await startBridge(bridge);

      mockIsWebSocketApiEnabled.mockReturnValue(true);
      await bridge.updateWebSocketApiServer();
      const firstServer = createdWsApiServers[0];
      expect(firstServer).toBeDefined();
      expect(bridge.getWebSocketApiServer()).toBe(firstServer);

      mockIsWebSocketApiEnabled.mockReturnValue(false);
      await bridge.updateWebSocketApiServer();
      expect(firstServer.stop).toHaveBeenCalledTimes(1);
      expect(bridge.getWebSocketApiServer()).toBeNull();

      await bridge.updateWebSocketApiServer();
      expect(firstServer.stop).toHaveBeenCalledTimes(1);

      mockIsWebSocketApiEnabled.mockReturnValue(true);
      await bridge.updateWebSocketApiServer();
      const secondServer = createdWsApiServers[1];
      expect(secondServer).toBeDefined();
      expect(secondServer).not.toBe(firstServer);
      expect(bridge.getWebSocketApiServer()).toBe(secondServer);
    });

    it('repeated WebSocket API enable and disable cycles release stopped dynamic servers', async () => {
      await startBridge(bridge);

      for (let cycle = 0; cycle < 5; cycle++) {
        mockIsWebSocketApiEnabled.mockReturnValue(true);
        await bridge.updateWebSocketApiServer();
        const currentServer = bridge.getWebSocketApiServer();
        expect(currentServer).toBe(createdWsApiServers[cycle]);
        expect(currentServer?.isRunning()).toBe(true);

        mockIsWebSocketApiEnabled.mockReturnValue(false);
        await bridge.updateWebSocketApiServer();
        expect(currentServer?.stop).toHaveBeenCalledTimes(1);
        expect(currentServer?.isRunning()).toBe(false);
        expect(bridge.getWebSocketApiServer()).toBeNull();
      }

      expect(createdWsApiServers).toHaveLength(5);
      expect(new Set(createdWsApiServers).size).toBe(5);
      for (const stoppedServer of createdWsApiServers) {
        expect(stoppedServer.stop).toHaveBeenCalledTimes(1);
      }
    });
  });

  // ── isHealthy() load tolerance (DoD #4) ────────────────────────
  describe('isHealthy() load tolerance', () => {
    beforeEach(async () => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).healthRetryBackoffMs = 0;
      await startBridge(bridge);
      const { __resetCriticalMemoryPressureForTests } = await import('../http-mcp-bridge');
      __resetCriticalMemoryPressureForTests();
    });

    it('returns true (skips probe) when memory-critical signal is fresh', async () => {
      const { notifyCriticalMemoryPressure } = await import('../http-mcp-bridge');
      notifyCriticalMemoryPressure();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ status: 'down' }),
      } as any);
      try {
        expect(await bridge.isHealthy()).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('retries once before declaring unhealthy', async () => {
      // T10: deterministic fake-timer advancement instead of racing a
      // real 120ms sleep to flush the 100ms self-test fetch.
      vi.useFakeTimers({ shouldAdvanceTime: false });
      try {
        let call = 0;
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
          call++;
          if (call === 1) return Promise.reject(new Error('slow'));
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ status: 'ok' }),
          } as any);
        });
        // Flush the bridge's 100ms self-test timer so it consumes call #1.
        await vi.advanceTimersByTimeAsync(120);
        // Reset the counter so the assertion applies to the real isHealthy.
        call = 0;
        const probePromise = bridge.isHealthy();
        // Advance through the retry backoff (set to 0 above).
        await vi.advanceTimersByTimeAsync(10);
        expect(await probePromise).toBe(true);
        expect(call).toBeGreaterThanOrEqual(2);
        fetchSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns false after both probe attempts fail', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      try {
        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockRejectedValue(new Error('slow'));
        // Flush any pending self-test first.
        await vi.advanceTimersByTimeAsync(120);
        const probePromise = bridge.isHealthy();
        // Advance through the retry backoff.
        await vi.advanceTimersByTimeAsync(10);
        expect(await probePromise).toBe(false);
        expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
        fetchSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── IPC-over-HTTP: BrowserWindow.fromWebContents one-time patch (Fix 7) ─
  describe('IPC-over-HTTP BrowserWindow.fromWebContents patch (Fix 7)', () => {
    let ipcHandler: (req: any, res: any) => Promise<void>;

    const makeRes = () => {
      const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
      return res;
    };

    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);

      // Extract the /ipc POST handler registered on the express app.
      const ipcPostCall = mockExpressApp.post.mock.calls.find(
        (call: any[]) => call[0] === '/ipc',
      );
      expect(ipcPostCall).toBeDefined();
      ipcHandler = ipcPostCall![1];

      // Set up a global IPC handler map with a simple echo handler.
      const handlers = new Map<string, (...args: any[]) => any>();
      handlers.set('test-channel', async (_event: any, data: any) => ({
        success: true,
        echo: data,
      }));
      (global as any).__ipcHandlerFunctions = handlers;
    });

    afterEach(() => {
      delete (global as any).__ipcHandlerFunctions;
    });

    it('BrowserWindow.fromWebContents is patched at most once (one-time patch)', async () => {
      const { BrowserWindow } = await import('electron');

      // Warm up: trigger the first IPC request to apply the one-time patch.
      // The module-level `fromWebContentsPatched` flag may already be true
      // from a prior test run in this file; capture the reference before/after.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const fnBefore = BrowserWindow.fromWebContents;
      await ipcHandler(
        { body: { channel: 'test-channel', data: 'a' } },
        makeRes(),
      );
      const fnAfterFirst = BrowserWindow.fromWebContents;

      // Second request — should NOT change the function reference again.
      await ipcHandler(
        { body: { channel: 'test-channel', data: 'b' } },
        makeRes(),
      );
      const fnAfterSecond = BrowserWindow.fromWebContents;

      // The function reference must be stable after the first patch.
      expect(fnAfterSecond).toBe(fnAfterFirst);

      // If the patch was applied during this test, the function should differ
      // from the original mock. If it was already patched by a prior test,
      // fnBefore === fnAfterFirst is also acceptable (idempotent).
      // Either way, the key invariant is fnAfterFirst === fnAfterSecond.
    });

    it('two sequential IPC-over-HTTP requests both succeed (no patch stomping)', async () => {
      // Warm up: ensure the one-time patch is applied (may have been applied
      // by a prior test; the handler is idempotent either way).
      const warmupRes = makeRes();
      await ipcHandler(
        { body: { channel: 'test-channel', data: 'warmup' } },
        warmupRes,
      );

      // Now fire two more requests sequentially — both must succeed.
      const res1 = makeRes();
      const res2 = makeRes();
      await ipcHandler({ body: { channel: 'test-channel', data: { id: 1 } } }, res1);
      await ipcHandler({ body: { channel: 'test-channel', data: { id: 2 } } }, res2);

      expect(res1.json).toHaveBeenCalledWith({ success: true, echo: { id: 1 } });
      expect(res2.json).toHaveBeenCalledWith({ success: true, echo: { id: 2 } });
      expect(res1.status).not.toHaveBeenCalled();
      expect(res2.status).not.toHaveBeenCalled();
    });

    it('concurrent IPC-over-HTTP requests both succeed after patch is applied', async () => {
      // Ensure the one-time patch is applied first.
      await ipcHandler(
        { body: { channel: 'test-channel', data: 'warmup' } },
        makeRes(),
      );

      // Now fire two requests concurrently — the bug was that per-request
      // patching/unpatching caused the second to fail.
      const res1 = makeRes();
      const res2 = makeRes();
      await Promise.all([
        ipcHandler({ body: { channel: 'test-channel', data: { id: 1 } } }, res1),
        ipcHandler({ body: { channel: 'test-channel', data: { id: 2 } } }, res2),
      ]);

      expect(res1.json).toHaveBeenCalledWith({ success: true, echo: { id: 1 } });
      expect(res2.json).toHaveBeenCalledWith({ success: true, echo: { id: 2 } });
      expect(res1.status).not.toHaveBeenCalled();
      expect(res2.status).not.toHaveBeenCalled();
    });

    it('patched fromWebContents returns null for synthetic senders and delegates for real ones', async () => {
      const { BrowserWindow } = await import('electron');

      // Trigger a request to ensure the patch is applied
      await ipcHandler(
        { body: { channel: 'test-channel', data: 'x' } },
        makeRes(),
      );

      // For non-synthetic senders, the patched function should delegate
      // to the original mock (which returns null by default).
      const fakeRealWebContents = { id: 999 };
      BrowserWindow.fromWebContents(fakeRealWebContents as any);
      expect(mockFromWebContents).toHaveBeenCalledWith(fakeRealWebContents);
    });
  });

  // ── Pre-listen error-handler invariant (T1) ────────────────────────
  describe('listen-attempt invariants (T1)', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).listenBackoffMs = [0, 0, 0];
    });

    it("attaches once('error') before every listen(), including retries", async () => {
      // Fail the first 2 attempts (same port, backoff), succeed on the 3rd.
      const errorHandlers: Function[] = [];
      mockHttpServer.once.mockImplementation((event: string, handler: Function) => {
        if (event === 'error') errorHandlers.push(handler);
      });
      mockHttpServer.removeListener.mockImplementation(
        (event: string, handler: Function) => {
          if (event === 'error') {
            const idx = errorHandlers.indexOf(handler);
            if (idx >= 0) errorHandlers.splice(idx, 1);
          }
        },
      );
      let listenCount = 0;
      mockHttpServer.listen.mockImplementation(
        (_port: number, _host: string, cb: Function) => {
          listenCount++;
          if (listenCount <= 2) {
            const handler = errorHandlers[errorHandlers.length - 1];
            setTimeout(() => {
              const err: any = new Error('EADDRINUSE');
              err.code = 'EADDRINUSE';
              handler?.(err);
            }, 0);
          } else {
            cb();
          }
        },
      );
      mockFindAvailablePort.mockImplementation((p: number) => Promise.resolve(p));

      await bridge.start();

      // Invariant: every time listen was called, a matching once('error')
      // must have been registered *strictly earlier* on the SAME server
      // instance. With the per-instance factory, createdHttpServers holds
      // each fresh server; we check per-instance call order.
      expect(listenCount).toBeGreaterThanOrEqual(3);
      for (const inst of createdHttpServers) {
        const listenOrders: number[] = (inst.listen.mock.invocationCallOrder ?? [])
          .slice();
        const onceErrorOrders: number[] = inst.once.mock.calls
          .map((call: any[], idx: number) =>
            call[0] === 'error' ? inst.once.mock.invocationCallOrder[idx] : -1,
          )
          .filter((n: number) => n > 0);
        if (listenOrders.length === 0) continue; // skip servers never used
        const earliestOnceError = Math.min(...onceErrorOrders);
        const earliestListen = Math.min(...listenOrders);
        expect(onceErrorOrders.length).toBeGreaterThanOrEqual(1);
        expect(earliestOnceError).toBeLessThan(earliestListen);
      }
    });
  });

  // ── Per-attempt server/WSS cleanup (T6) ────────────────────────────
  describe('per-attempt server cleanup (T6)', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).listenBackoffMs = [0, 0, 0];
    });

    it('closes the failed server/WSS on each EADDRINUSE and creates a fresh pair for the retry', async () => {
      const errorHandlers: Function[] = [];
      mockHttpServer.once.mockImplementation((event: string, handler: Function) => {
        if (event === 'error') errorHandlers.push(handler);
      });
      mockHttpServer.removeListener.mockImplementation(
        (event: string, handler: Function) => {
          if (event === 'error') {
            const idx = errorHandlers.indexOf(handler);
            if (idx >= 0) errorHandlers.splice(idx, 1);
          }
        },
      );
      let listenCount = 0;
      mockHttpServer.listen.mockImplementation(
        (_port: number, _host: string, cb: Function) => {
          listenCount++;
          if (listenCount <= 2) {
            const handler = errorHandlers[errorHandlers.length - 1];
            setTimeout(() => {
              const err: any = new Error('EADDRINUSE');
              err.code = 'EADDRINUSE';
              handler?.(err);
            }, 0);
          } else {
            cb();
          }
        },
      );
      mockFindAvailablePort.mockImplementation((p: number) => Promise.resolve(p));

      await bridge.start();

      // Three listenOnce attempts → three fresh createServer() instances.
      expect(createdHttpServers.length).toBeGreaterThanOrEqual(3);

      // The two failed server instances must each have had close() called
      // on their own instance (not just the shared spy). The final (3rd)
      // one is the currently-bound server — it must NOT have been closed.
      const failed = createdHttpServers.slice(0, 2);
      const bound = createdHttpServers[createdHttpServers.length - 1];
      for (const inst of failed) {
        expect(inst.close).toHaveBeenCalled();
      }
      expect(bound.close).not.toHaveBeenCalled();

      // And: distinct HTTP server instances (retries did not reuse the
      // failed one). This is the core T6 invariant.
      expect(failed[0]).not.toBe(bound);
      expect(failed[1]).not.toBe(bound);
      expect(failed[0]).not.toBe(failed[1]);
    });
  });

  // ── Start pre-check does not mutate this.port (C5) ─────────────────
  describe('port pre-check isolation (C5)', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).listenBackoffMs = [0, 0, 0];
    });

    it('keeps retrying the originally-requested port even when findAvailablePort drifts', async () => {
      // Simulate findAvailablePort returning a *different* port (9999).
      // Prior to C5 this mutated this.port and the retry loop then used
      // 9999 as its startPort, skipping same-port backoff on 5179.
      mockFindAvailablePort.mockImplementation(() => Promise.resolve(9999));

      const attempted: number[] = [];
      mockHttpServer.listen.mockImplementation(
        (port: number, _host: string, cb: Function) => {
          attempted.push(port);
          cb();
        },
      );

      await bridge.start();

      // First attempt must be on 5179 (the original), not on 9999 that
      // findAvailablePort returned.
      expect(attempted[0]).toBe(5179);
      expect(bridge.getPort()).toBe(5179);
    });
  });

  // ── Health probe timeout (T9) ──────────────────────────────────────
  describe('health probe timeout (T9)', () => {
    beforeEach(async () => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).healthRetryBackoffMs = 0;
      await startBridge(bridge);
      const { __resetCriticalMemoryPressureForTests } = await import('../http-mcp-bridge');
      __resetCriticalMemoryPressureForTests();
    });

    it('exports HTTP_MCP_HEALTH_CHECK_TIMEOUT_MS === 5000', async () => {
      const { HTTP_MCP_HEALTH_CHECK_TIMEOUT_MS } = await import('../http-mcp-bridge');
      expect(HTTP_MCP_HEALTH_CHECK_TIMEOUT_MS).toBe(5000);
    });

    it('aborts the health fetch after the 5s timeout (fake timers)', async () => {
      const { HTTP_MCP_HEALTH_CHECK_TIMEOUT_MS } = await import('../http-mcp-bridge');
      // Install fake timers AFTER startBridge has completed so the bridge's
      // internal cleanup interval is already scheduled on real time.
      vi.useFakeTimers({ shouldAdvanceTime: false });

      // fetch() returns a promise that only settles when the abort signal
      // fires — mimicking a timed-out request. Each call records its signal.
      // Only track probe fetches (those carrying an AbortSignal); the bridge
      // also fires a one-shot self-test fetch from start() at real +100ms that
      // has no signal and must not be counted here or the abortedCalls.length
      // assertions below flake when that real-timer callback lands mid-test.
      const abortedCalls: AbortSignal[] = [];
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation((_url: any, opts: any = {}) => {
          const signal: AbortSignal | undefined = opts.signal;
          if (!signal) {
            // Bridge's start-time self-test fetch — return a benign resolved
            // response so the self-test chain completes silently.
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ status: 'ok' }),
            } as any);
          }
          abortedCalls.push(signal);
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              const err: any = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        });

      try {
        const resultPromise = bridge.isHealthy(HTTP_MCP_HEALTH_CHECK_TIMEOUT_MS);
        // Let the first probe register its AbortController.setTimeout.
        await vi.advanceTimersByTimeAsync(1);
        expect(abortedCalls.length).toBe(1);
        expect(abortedCalls[0].aborted).toBe(false);
        // Advance to just before the timeout — signal must NOT have aborted
        // yet (guards against a too-eager timer).
        await vi.advanceTimersByTimeAsync(HTTP_MCP_HEALTH_CHECK_TIMEOUT_MS - 2);
        expect(abortedCalls[0].aborted).toBe(false);
        // Tripping the timer aborts the signal and kicks off the retry.
        await vi.advanceTimersByTimeAsync(10);
        expect(abortedCalls[0].aborted).toBe(true);
        // Second probe runs; advance past its timeout too.
        await vi.advanceTimersByTimeAsync(HTTP_MCP_HEALTH_CHECK_TIMEOUT_MS + 10);
        const result = await resultPromise;
        expect(result).toBe(false);
        expect(abortedCalls.length).toBe(2);
        expect(abortedCalls[1].aborted).toBe(true);
      } finally {
        fetchSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  // ── External stop during in-flight restart (R1) ────────────────────
  describe('external stop vs in-flight restart (R1)', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).listenBackoffMs = [0, 0, 0];
    });

    it('external stop() fired during restart() prevents restart from re-binding', async () => {
      await startBridge(bridge);

      // Make restart's internal start() wait long enough for an external
      // stop() to race with it. We do this by making listen() never call
      // its callback for the second-phase start. The internal stop() still
      // completes normally.
      let listenCalls = 0;
      const errorHandlers: Function[] = [];
      mockHttpServer.once.mockImplementation((event: string, handler: Function) => {
        if (event === 'error') errorHandlers.push(handler);
      });
      mockHttpServer.listen.mockImplementation(
        (_port: number, _host: string, cb: Function) => {
          listenCalls++;
          if (listenCalls === 1) {
            // First call = the initial startBridge above; succeed.
            cb();
          }
          // Subsequent calls (inside restart) hang so stop() can race in.
        },
      );

      const restartPromise = bridge.restart().catch(() => {
        /* may reject if stop() terminates the cycle */
      });
      // Give restart() a tick to begin.
      await new Promise((r) => setTimeout(r, 10));
      // External stop() bumps externalStopGeneration and forces abort.
      await bridge.stop();
      await restartPromise;

      // After everything settles, no server should be bound.
      expect((bridge as any).server).toBeNull();
      expect((bridge as any).wss).toBeNull();
    });
  });

  // ── Per-client WebSocket error handler (R5) ────────────────────────
  describe('per-client WebSocket error handler (R5)', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).listenBackoffMs = [0, 0, 0];
    });

    it("attaches 'error' listener to each ws client and terminates on error", async () => {
      await startBridge(bridge);
      const wss = (bridge as any).wss;
      expect(wss).not.toBeNull();

      // The bridge registered a 'connection' handler on the real WSS.
      // Simulate a client connecting by invoking the real wss.emit() path:
      // we just directly look up and invoke the registered handler.
      // In production, wss.on('connection', …) accepts a callback; the
      // real ws module stores it internally. We can emit on it:
      const fakeWs: any = {
        _errorHandler: undefined as any,
        _closeHandler: undefined as any,
        on: vi.fn(function (this: any, event: string, cb: Function) {
          if (event === 'error') this._errorHandler = cb;
          if (event === 'close') this._closeHandler = cb;
        }),
        terminate: vi.fn(),
      };

      // Trigger the bridge's 'connection' handler.
      wss.emit('connection', fakeWs);

      // The bridge must have attached its own 'error' (and 'close') listener.
      expect(fakeWs.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(fakeWs._errorHandler).toBeDefined();

      // Simulate the client emitting an error: the attached handler must
      // call terminate() (and not rethrow).
      expect(() => fakeWs._errorHandler(new Error('client boom'))).not.toThrow();
      expect(fakeWs.terminate).toHaveBeenCalled();
    });
  });

  describe('/ipc-events WebSocket origin allowlist', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).listenBackoffMs = [0, 0, 0];
    });

    const runVerifyClient = async (origin?: string) => {
      await startBridge(bridge);
      const wss = (bridge as any).wss;
      expect(wss).not.toBeNull();
      const done = vi.fn();
      const emitSpy = vi.spyOn(wss, 'emit');

      wss.options.verifyClient(
        {
          origin,
          secure: false,
          req: { headers: origin === undefined ? {} : { origin } },
        },
        done,
      );

      return { done, emitSpy };
    };

    it.each(['app://workspaces', 'http://127.0.0.1:5177', 'http://localhost:5177'])(
      'accepts trusted renderer WebSocket origin %s',
      async (origin) => {
        const { done } = await runVerifyClient(origin);

        expect(done).toHaveBeenCalledWith(true);
      },
    );

    it.each(['https://example.com', 'null', 'file://'])(
      'rejects disallowed browser WebSocket origin %s before connection handlers run',
      async (origin) => {
        const { done, emitSpy } = await runVerifyClient(origin);

        expect(done).toHaveBeenCalledWith(false, 403, 'Forbidden');
        expect(emitSpy).not.toHaveBeenCalledWith(
          'connection',
          expect.anything(),
          expect.anything(),
        );
      },
    );

    it('accepts no-origin WebSocket clients for local non-browser callers', async () => {
      const { done } = await runVerifyClient();

      expect(done).toHaveBeenCalledWith(true);
    });
  });

  describe('browser IPC workspace scoping', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).listenBackoffMs = [0, 0, 0];
    });

    const makeFakeClient = (wss: any) => {
      const client: any = {
        readyState: 1,
        send: vi.fn(),
        on: vi.fn(),
        terminate: vi.fn(() => {
          client.readyState = 3;
          wss.clients.delete(client);
        }),
      };
      return client;
    };

    const connectBrowserClient = (wss: any, workspaceId: string) => {
      const client = makeFakeClient(wss);
      wss.clients.add(client);
      wss.emit('connection', client, {
        url: `/ipc-events?workspaceId=${workspaceId}`,
        headers: {},
      });
      return client;
    };

    it('only forwards workspace-scoped content broadcasts to matching WebSocket clients', async () => {
      await startBridge(bridge);
      const wss = (bridge as any).wss;
      expect(wss).not.toBeNull();

      const ws1 = connectBrowserClient(wss, 'ws-1');
      const ws2 = connectBrowserClient(wss, 'ws-2');

      try {
        const cases = [
          ['file:content-changed', { workspaceId: 'ws-1', content: 'file secret' }],
          ['note:updated', { workspaceId: 'ws-1', noteId: 'spec', content: 'spec secret' }],
          [
            'note:content-changed',
            { workspaceId: 'ws-1', noteId: 'task-1', content: 'task secret' },
          ],
          [
            'note:content-changed:ws-1',
            { workspaceId: 'ws-1', noteId: 'task-1', content: 'task secret' },
          ],
          [
            'events:new',
            {
              workspaceId: 'ws-1',
              event: {
                type: 'note:updated',
                workspaceId: 'ws-1',
                data: { content: 'wrapped note secret' },
              },
            },
          ],
        ] as const;

        for (const [channel, data] of cases) {
          ws1.send.mockClear();
          ws2.send.mockClear();

          (global as any).__browserIpcBroadcast(channel, data);

          expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ channel, data }));
          expect(ws2.send).not.toHaveBeenCalled();
        }
      } finally {
        ws1.terminate();
        ws2.terminate();
      }
    });

    it('drops content-bearing browser broadcasts when workspace identity is unavailable', async () => {
      await startBridge(bridge);
      const wss = (bridge as any).wss;
      expect(wss).not.toBeNull();

      const ws1 = connectBrowserClient(wss, 'ws-1');
      const ws2 = connectBrowserClient(wss, 'ws-2');

      try {
        (global as any).__browserIpcBroadcast('note:updated', {
          noteId: 'spec',
          content: 'unscoped spec secret',
        });
        (global as any).__browserIpcBroadcast('events:new', {
          event: {
            type: 'note:updated',
            data: { content: 'unscoped wrapped secret' },
          },
        });

        expect(ws1.send).not.toHaveBeenCalled();
        expect(ws2.send).not.toHaveBeenCalled();
      } finally {
        ws1.terminate();
        ws2.terminate();
      }
    });

    it('routes IPC-over-HTTP agent stream sends only to the request workspace clients', async () => {
      await startBridge(bridge);
      const wss = (bridge as any).wss;
      expect(wss).not.toBeNull();

      const ws1 = connectBrowserClient(wss, 'ws-1');
      const ws2 = connectBrowserClient(wss, 'ws-2');
      const handlers = new Map<string, (...args: any[]) => any>();
      handlers.set(
        'test-agent-stream',
        async (event: any, data: { agentId: string }) => {
          event.sender.send(`agent:stream:${data.agentId}`, {
            type: 'chunk',
            data: 'secret',
          });
          return { success: true };
        },
      );
      (global as any).__ipcHandlerFunctions = handlers;

      try {
        const ipcPostCall = mockExpressApp.post.mock.calls.find(
          (call: any[]) => call[0] === '/ipc',
        );
        expect(ipcPostCall).toBeDefined();
        const ipcHandler = ipcPostCall![1];
        const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };

        await ipcHandler(
          {
            body: { channel: 'test-agent-stream', data: { agentId: 'agent-1' } },
            headers: { 'x-workspace-id': 'ws-1' },
            url: '/ipc',
          },
          res,
        );

        expect(res.json).toHaveBeenCalledWith({ success: true });
        expect(ws1.send).toHaveBeenCalledWith(
          JSON.stringify({
            channel: 'agent:stream:agent-1',
            data: { type: 'chunk', data: 'secret' },
          }),
        );
        expect(ws2.send).not.toHaveBeenCalled();
      } finally {
        delete (global as any).__ipcHandlerFunctions;
        ws1.terminate();
        ws2.terminate();
      }
    });

    it('uses IPC body workspaceId as browser stream routing fallback', async () => {
      await startBridge(bridge);
      const wss = (bridge as any).wss;
      expect(wss).not.toBeNull();

      const ws1 = connectBrowserClient(wss, 'ws-1');
      const ws2 = connectBrowserClient(wss, 'ws-2');
      const handlers = new Map<string, (...args: any[]) => any>();
      handlers.set('test-agent-stream', async (event: any) => {
        event.sender.send('agent:stream:agent-1', { type: 'chunk', data: 'secret' });
        return { success: true };
      });
      (global as any).__ipcHandlerFunctions = handlers;

      try {
        const ipcPostCall = mockExpressApp.post.mock.calls.find(
          (call: any[]) => call[0] === '/ipc',
        );
        expect(ipcPostCall).toBeDefined();
        const ipcHandler = ipcPostCall![1];
        const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };

        await ipcHandler(
          {
            body: {
              channel: 'test-agent-stream',
              data: { agentId: 'agent-1', workspaceId: 'ws-1' },
            },
            headers: {},
            url: '/ipc',
          },
          res,
        );

        expect(res.json).toHaveBeenCalledWith({ success: true });
        expect(ws1.send).toHaveBeenCalledWith(
          JSON.stringify({
            channel: 'agent:stream:agent-1',
            data: { type: 'chunk', data: 'secret' },
          }),
        );
        expect(ws2.send).not.toHaveBeenCalled();
      } finally {
        delete (global as any).__ipcHandlerFunctions;
        ws1.terminate();
        ws2.terminate();
      }
    });

    it('drops IPC-over-HTTP stream sends when request workspace identity is unavailable', async () => {
      await startBridge(bridge);
      const wss = (bridge as any).wss;
      expect(wss).not.toBeNull();

      const ws1 = connectBrowserClient(wss, 'ws-1');
      const ws2 = connectBrowserClient(wss, 'ws-2');
      const handlers = new Map<string, (...args: any[]) => any>();
      handlers.set('test-agent-stream', async (event: any) => {
        event.sender.send('agent:stream:agent-1', { type: 'chunk', data: 'secret' });
        return { success: true };
      });
      (global as any).__ipcHandlerFunctions = handlers;

      try {
        const ipcPostCall = mockExpressApp.post.mock.calls.find(
          (call: any[]) => call[0] === '/ipc',
        );
        expect(ipcPostCall).toBeDefined();
        const ipcHandler = ipcPostCall![1];
        const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };

        await ipcHandler(
          {
            body: { channel: 'test-agent-stream', data: { agentId: 'agent-1' } },
            headers: {},
            url: '/ipc',
          },
          res,
        );

        expect(res.json).toHaveBeenCalledWith({ success: true });
        expect(ws1.send).not.toHaveBeenCalled();
        expect(ws2.send).not.toHaveBeenCalled();
      } finally {
        delete (global as any).__ipcHandlerFunctions;
        ws1.terminate();
        ws2.terminate();
      }
    });
  });

  // ── Unrecoverable handler Set snapshot (R6) ────────────────────────
  describe('unrecoverable handler snapshot (R6)', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
      (bridge as any).listenBackoffMs = [0, 0, 0];
      (bridge as any).healthRetryBackoffMs = 0;
    });

    it('handler that unsubscribes itself during emission does not skip peers', async () => {
      await startBridge(bridge);
      // Force ensureHealthy() to emit via the restart-failed path.
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ status: 'down' }),
      } as any);
      const restartSpy = vi
        .spyOn(bridge, 'restart')
        .mockRejectedValue(new Error('restart boom'));

      const { onHttpBridgeUnrecoverable } = await import('../http-mcp-bridge');
      // handlerA unsubscribes handlerB mid-iteration; before the snapshot
      // fix this would either skip handlerC (Set.forEach semantics) or
      // throw on iterator-after-mutation. With the Array.from snapshot,
      // all three registered handlers must be invoked exactly once.
      const handlerA = vi.fn(() => {
        offB();
        offC();
      });
      const handlerB = vi.fn();
      const handlerC = vi.fn();
      const offA = onHttpBridgeUnrecoverable(handlerA);
      const offB = onHttpBridgeUnrecoverable(handlerB);
      const offC = onHttpBridgeUnrecoverable(handlerC);

      try {
        await bridge.ensureHealthy();
        expect(handlerA).toHaveBeenCalledTimes(1);
        expect(handlerB).toHaveBeenCalledTimes(1);
        expect(handlerC).toHaveBeenCalledTimes(1);
      } finally {
        offA();
        // B/C already detached by handlerA but calling is idempotent.
        offB();
        offC();
        fetchSpy.mockRestore();
        restartSpy.mockRestore();
      }
    });
  });
});
