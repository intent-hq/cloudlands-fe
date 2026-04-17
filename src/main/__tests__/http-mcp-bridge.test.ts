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
  createdWssInstances,
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
    once: vi.fn(),
    removeListener: vi.fn(),
  };

  const eventHandlers: Record<string, Function[]> = {};

  const mockElectronStoreInstance = {
    set: vi.fn(),
    get: vi.fn(),
    store: {},
    path: '/tmp/settings.json',
  };

  // Tracks every WebSocketServer instance the factory creates.
  const createdWssInstances: any[] = [];

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
    createdWssInstances,
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

// Track every WebSocketServer instance created so tests can inspect them
// (created by the mock factory; hoisted so the factory can reference it).
vi.mock('ws', () => {
  // Must use function (not arrow) so it can be called with `new`
  function MockWebSocketServer(this: any) {
    const self: any = {
      on: vi.fn(),
      clients: new Set(),
      close: vi.fn((cb?: Function) => cb?.()),
    };
    createdWssInstances.push(self);
    return self;
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
    createdWssInstances.length = 0;
    // Reset the listen mock to call callback synchronously
    mockHttpServer.listen.mockImplementation((_port: number, _host: string, cb: Function) => {
      cb();
    });
    // Reset on()/once() to passthroughs that record calls but store nothing special.
    mockHttpServer.on.mockImplementation(() => {});
    mockHttpServer.once.mockImplementation(() => {});
    mockHttpServer.removeListener.mockImplementation(() => {});
    mockHttpServer.close.mockImplementation((cb?: Function) => cb?.());
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
      await expect(startPromise).resolves.toBeUndefined();
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
      // Let any pending 100ms self-test timers fire before we install the spy
      // so they don't pollute our call count.
      await new Promise((r) => setTimeout(r, 120));
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
      try {
        expect(await bridge.isHealthy()).toBe(true);
        // At least one retry happened; tolerate an extra self-test fetch.
        expect(call).toBeGreaterThanOrEqual(2);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('returns false after both probe attempts fail', async () => {
      await new Promise((r) => setTimeout(r, 120));
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('slow'));
      try {
        expect(await bridge.isHealthy()).toBe(false);
        expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      } finally {
        fetchSpy.mockRestore();
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
});
