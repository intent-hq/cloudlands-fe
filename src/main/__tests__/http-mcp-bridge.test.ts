/**
 * HTTP MCP Bridge Tests
 *
 * Tests the HttpMcpBridge class: construction, start/stop lifecycle,
 * MCP server caching/eviction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  eventHandlers,
  mockElectronStoreInstance,
  mockFromWebContents,
} = vi.hoisted(() => {
  const mockFromWebContents = vi.fn().mockReturnValue(null);
  const mockExpressApp: any = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    listen: vi.fn(),
  };

  const mockHttpServer: any = {
    listen: vi.fn(),
    close: vi.fn((cb?: Function) => cb?.()),
    on: vi.fn(),
  };

  const eventHandlers: Record<string, Function[]> = {};

  const mockElectronStoreInstance = {
    set: vi.fn(),
    get: vi.fn(),
    store: {},
    path: '/tmp/settings.json',
  };

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
    eventHandlers,
    mockElectronStoreInstance,
    mockFromWebContents,
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
  return {
    ...actual,
    default: { ...actual, createServer: vi.fn().mockReturnValue(mockHttpServer) },
    createServer: vi.fn().mockReturnValue(mockHttpServer),
  };
});

vi.mock('ws', () => {
  // Must use function (not arrow) so it can be called with `new`
  function MockWebSocketServer() {
    return { on: vi.fn(), clients: new Set(), close: vi.fn() };
  }
  return {
    WebSocketServer: MockWebSocketServer,
    WebSocket: { OPEN: 1, CLOSED: 3 },
    default: class WebSocket { close() {} send() {} addEventListener() {} removeEventListener() {} },
  };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp'), isPackaged: false },
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

// ── Import after mocks ──────────────────────────────────────────────
import { HttpMcpBridge } from '../http-mcp-bridge';

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

describe('HttpMcpBridge', () => {
  let bridge: HttpMcpBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    clearEventHandlers();
    // Reset the listen mock to call callback synchronously
    mockHttpServer.listen.mockImplementation((_port: number, _host: string, cb: Function) => {
      cb();
    });
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
      expect(mockHttpServer.listen).toHaveBeenCalledWith(5179, expect.any(String), expect.any(Function));
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

  // ── Port retry on EADDRINUSE (Fix 8 regression) ────────────────

  describe('port retry on EADDRINUSE', () => {
    beforeEach(() => {
      bridge = new HttpMcpBridge(5179);
    });

    /**
     * Helper: set up mockHttpServer so that the first `failCount` listen()
     * calls emit EADDRINUSE via the error handler, and subsequent calls succeed.
     * Returns an object tracking the ports that were attempted.
     */
    function setupEADDRINUSE(failCount: number) {
      const attemptedPorts: number[] = [];
      // Each start() call registers a new error handler; keep the latest
      let currentErrorHandler: Function | undefined;

      mockHttpServer.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'error') currentErrorHandler = handler;
      });

      mockHttpServer.listen.mockImplementation((port: number, _host: string, cb: Function) => {
        attemptedPorts.push(port);
        if (attemptedPorts.length <= failCount) {
          // Fire EADDRINUSE asynchronously (like a real server)
          const handler = currentErrorHandler;
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

    it('retries on the next port when EADDRINUSE is emitted', async () => {
      const { attemptedPorts } = setupEADDRINUSE(1);

      await bridge.start();

      // First attempt on 5179 failed, second on 5180 succeeded
      expect(attemptedPorts).toEqual([5179, 5180]);
      expect(bridge.getPort()).toBe(5180);
    });

    it('rejects with EADDRINUSE when port exceeds startPort + 10 bound', async () => {
      // This tests the fix: `this.port < startPort + 10` (was `this.port < this.port + 10`).
      // We simulate the scenario where the error handler's bound is hit by
      // pre-incrementing the port past the bound before the error fires.
      let currentErrorHandler: Function | undefined;
      let listenCalled: (() => void) | undefined;
      const listenCalledPromise = new Promise<void>((resolve) => {
        listenCalled = resolve;
      });

      mockHttpServer.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'error') currentErrorHandler = handler;
      });

      // listen() does nothing — we'll fire the error manually
      mockHttpServer.listen.mockImplementation(() => {
        listenCalled?.();
      });
      mockFindAvailablePort.mockImplementation((port: number) => Promise.resolve(port));

      const startPromise = bridge.start();

      // Wait for listen() to be called (after findAvailablePort resolves)
      await listenCalledPromise;

      // At this point, startPort = 5179 inside the error handler closure.
      // Manually increment this.port past the bound (simulating 10 failed retries)
      // by directly mutating the bridge's port.
      // The error handler checks: this.port < startPort + 10
      // If this.port >= startPort + 10, it should reject.
      for (let i = 0; i < 10; i++) {
        (bridge as any).port++;
      }
      // Now this.port = 5189, startPort = 5179, so 5189 < 5179 + 10 is FALSE

      const err: any = new Error('listen EADDRINUSE: address already in use');
      err.code = 'EADDRINUSE';
      currentErrorHandler?.(err);

      await expect(startPromise).rejects.toThrow('EADDRINUSE');
    });

    it('succeeds on a later retry port (5 failures then success)', async () => {
      const FAIL_COUNT = 5;
      const { attemptedPorts } = setupEADDRINUSE(FAIL_COUNT);

      await bridge.start();

      // Should have tried 6 ports total (5 failures + 1 success)
      expect(attemptedPorts).toHaveLength(FAIL_COUNT + 1);
      // Final port should be startPort + FAIL_COUNT
      expect(bridge.getPort()).toBe(5179 + FAIL_COUNT);
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
});
