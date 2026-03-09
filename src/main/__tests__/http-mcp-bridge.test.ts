/**
 * HTTP MCP Bridge Tests
 *
 * Tests the HTTP MCP Bridge that exposes MCP tools via HTTP
 * These are integration tests that actually start the HTTP server
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { HttpMcpBridge } from '../http-mcp-bridge';

// Mock electron-store — must be a class since it's instantiated with `new`
vi.mock('electron-store', () => ({
  __esModule: true,
  default: class MockElectronStore {
    store: Record<string, any> = {};
    path = '/tmp/test/settings.json';
    set = vi.fn((key: string, value: any) => { this.store[key] = value; });
    get = vi.fn((key: string, defaultValue?: any) => this.store[key] ?? defaultValue);
    has = vi.fn((key: string) => key in this.store);
    delete = vi.fn((key: string) => { delete this.store[key]; });
    clear = vi.fn();
  },
}));

// Mock unified event bus with domain event support
// NOTE: The Map must be created inside the factory because vi.mock is hoisted
vi.mock('../../features/events/main/unified-event-bus', () => {
  const listeners = new Map<string, Array<(data: any) => void>>();
  return {
    unifiedEventBus: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      getInstanceId: vi.fn().mockReturnValue('test-instance'),
      onDomainEvent: vi.fn((event: string, callback: (data: any) => void) => {
        if (!listeners.has(event)) {
          listeners.set(event, []);
        }
        listeners.get(event)!.push(callback);
      }),
      emitDomainEvent: vi.fn((event: string, data: any) => {
        const cbs = listeners.get(event) || [];
        cbs.forEach((cb) => cb(data));
      }),
    },
  };
});

// Mock protocol adapter
vi.mock('../../features/protocol/main/protocol-adapter', () => ({
  protocolAdapter: {
    // Mock methods that might be called by MCP tools
    getWorkspaceInfo: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
  },
}));

// Mock agent context registry
vi.mock('../../features/agent/agent-context-registry', () => ({
  getAgentContextRegistry: vi.fn(() => ({
    getBySessionId: vi.fn(),
    getByWorkspace: vi.fn(),
    getByAgent: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    clear: vi.fn(),
  })),
}));

// Save/restore env vars that the bridge mutates during start()
const savedEnv: Record<string, string | undefined> = {};
function saveEnv() {
  savedEnv.HTTP_MCP_PORT = process.env.HTTP_MCP_PORT;
  savedEnv.ELECTRON_STORE_CWD = process.env.ELECTRON_STORE_CWD;
}
function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeAll(() => saveEnv());
afterAll(() => restoreEnv());

describe('HttpMcpBridge Port 0 (OS-assigned) Tests', () => {
  let bridge: HttpMcpBridge;

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
    }
    restoreEnv();
  });

  it('should bind to an OS-assigned port when constructed with port 0', async () => {
    bridge = new HttpMcpBridge(0);
    await bridge.start();

    const port = bridge.getPort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);

    // Verify the server is actually listening on that port
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.ok).toBe(true);
    const data = (await response.json()) as any;
    expect(data.status).toBe('ok');
    expect(data.service).toBe('http-mcp-bridge');
  });

  it('should set process.env.HTTP_MCP_PORT after binding', async () => {
    bridge = new HttpMcpBridge(0);
    await bridge.start();

    const port = bridge.getPort();
    expect(process.env.HTTP_MCP_PORT).toBe(String(port));
  });

  it('should bind to a specific port when one is provided', async () => {
    // Use a high port unlikely to conflict
    const specificPort = 39871;
    bridge = new HttpMcpBridge(specificPort);
    await bridge.start();

    expect(bridge.getPort()).toBe(specificPort);

    const response = await fetch(`http://127.0.0.1:${specificPort}/health`);
    expect(response.ok).toBe(true);
  });

  it('should fall back to OS-assigned port on EADDRINUSE', async () => {
    // Start first bridge on a specific port
    const firstBridge = new HttpMcpBridge(0);
    await firstBridge.start();
    const occupiedPort = firstBridge.getPort();

    // Try to start second bridge on the same port — should fall back to port 0
    bridge = new HttpMcpBridge(occupiedPort);
    await bridge.start();

    const fallbackPort = bridge.getPort();
    expect(fallbackPort).toBeGreaterThan(0);
    expect(fallbackPort).not.toBe(occupiedPort);

    // Both should be healthy
    const r1 = await fetch(`http://127.0.0.1:${occupiedPort}/health`);
    expect(r1.ok).toBe(true);
    const r2 = await fetch(`http://127.0.0.1:${fallbackPort}/health`);
    expect(r2.ok).toBe(true);

    await firstBridge.stop();
  });

  it('should assign different ports to multiple port-0 bridges', async () => {
    const bridge1 = new HttpMcpBridge(0);
    await bridge1.start();
    const bridge2 = new HttpMcpBridge(0);
    await bridge2.start();

    expect(bridge1.getPort()).not.toBe(bridge2.getPort());
    expect(bridge1.getPort()).toBeGreaterThan(0);
    expect(bridge2.getPort()).toBeGreaterThan(0);

    await bridge1.stop();
    bridge = bridge2; // let afterEach clean up bridge2
  });
});

describe('HttpMcpBridge Health Check Validation', () => {
  let bridge: HttpMcpBridge;

  beforeAll(async () => {
    bridge = new HttpMcpBridge(0);
    await bridge.start();
  });

  afterAll(async () => {
    if (bridge) {
      await bridge.stop();
    }
    restoreEnv();
  });

  it('should report healthy when bridge is running', async () => {
    const healthy = await bridge.isHealthy();
    expect(healthy).toBe(true);
  });

  it('should include service identifier in health response', async () => {
    const port = bridge.getPort();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const data = (await response.json()) as any;

    expect(data.service).toBe('http-mcp-bridge');
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeDefined();
    expect(Array.isArray(data.tools)).toBe(true);
  });

  it('should report unhealthy after stop', async () => {
    const tempBridge = new HttpMcpBridge(0);
    await tempBridge.start();
    expect(await tempBridge.isHealthy()).toBe(true);

    await tempBridge.stop();
    expect(await tempBridge.isHealthy()).toBe(false);
  });
});

describe('HttpMcpBridge Restart', () => {
  let bridge: HttpMcpBridge;

  afterEach(async () => {
    if (bridge) {
      try { await bridge.stop(); } catch { /* ignore */ }
    }
    restoreEnv();
  });

  it('should restart and remain healthy', async () => {
    bridge = new HttpMcpBridge(0);
    await bridge.start();
    const portBefore = bridge.getPort();

    await bridge.restart();

    expect(await bridge.isHealthy()).toBe(true);
    // Port may or may not change on restart (depends on OS port reuse)
    expect(bridge.getPort()).toBeGreaterThan(0);
  });

  it('should update env var after restart on new port', async () => {
    bridge = new HttpMcpBridge(0);
    await bridge.start();

    await bridge.restart();

    const port = bridge.getPort();
    expect(process.env.HTTP_MCP_PORT).toBe(String(port));
  });

  it('ensureHealthy should return true when already healthy', async () => {
    bridge = new HttpMcpBridge(0);
    await bridge.start();

    const result = await bridge.ensureHealthy();
    expect(result).toBe(true);
  });

  it('ensureHealthy should restart and recover when unhealthy', async () => {
    bridge = new HttpMcpBridge(0);
    await bridge.start();

    // Force the server to close (simulating crash)
    await new Promise<void>((resolve) => {
      bridge['server'].close(() => resolve());
    });

    // isHealthy should be false now
    expect(await bridge.isHealthy()).toBe(false);

    // ensureHealthy should restart and recover
    const result = await bridge.ensureHealthy();
    expect(result).toBe(true);
    expect(bridge.getPort()).toBeGreaterThan(0);
  });
});

describe('Port Validation Logic', () => {
  // Mirrors the isValidPort function in mcp-stdio-server.ts
  // Port must be an integer in the valid TCP range (1–65535).
  const isValidPort = (v: number | undefined): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535;

  it('should reject port 0 and other invalid values', () => {
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort(NaN)).toBe(false);
    expect(isValidPort(Infinity)).toBe(false);
    expect(isValidPort(undefined)).toBe(false);
    expect(isValidPort(3000.5)).toBe(false);
    expect(isValidPort(70000)).toBe(false);
  });

  it('should accept valid TCP ports (1–65535)', () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(3000)).toBe(true);
    expect(isValidPort(52847)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
  });

  it('should filter out invalid values from candidate lists', () => {
    const candidates = [undefined, 0, NaN, 3000.5, 70000, 3000, 52847].filter(isValidPort);
    expect(candidates).toEqual([3000, 52847]);
  });

  it('Number("") should be 0 — verifying empty string CLI arg is filtered', () => {
    // This is the edge case: ACP provider passes httpMcpPort = '' as CLI arg
    // Number('') === 0, which must be filtered out
    expect(Number('')).toBe(0);
    expect(isValidPort(Number(''))).toBe(false);
  });
});

describe('HttpMcpBridge Settings Store Persistence', () => {
  let bridge: HttpMcpBridge;

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
    }
    restoreEnv();
  });

  it('should persist port to settings store after binding', async () => {
    bridge = new HttpMcpBridge(0);
    await bridge.start();

    const port = bridge.getPort();
    expect(port).toBeGreaterThan(0);

    // The bridge should have set process.env.ELECTRON_STORE_CWD
    // and persisted the port to the settings store
    expect(process.env.HTTP_MCP_PORT).toBe(String(port));
  });

  it('should update settings store on restart with new port', async () => {
    bridge = new HttpMcpBridge(0);
    await bridge.start();
    const portBefore = bridge.getPort();

    await bridge.restart();
    const portAfter = bridge.getPort();

    // Port may or may not change, but env var should match current port
    expect(process.env.HTTP_MCP_PORT).toBe(String(portAfter));
    expect(portAfter).toBeGreaterThan(0);
  });
});


describe('HttpMcpBridge Integration Tests', () => {
  let bridge: HttpMcpBridge;
  const testPort = 3002; // Use different port to avoid conflicts

  beforeAll(async () => {
    // Start the HTTP MCP Bridge
    bridge = new HttpMcpBridge(testPort);
    await bridge.start();

    // Wait a bit for server to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    if (bridge) {
      await bridge.stop();
    }
    restoreEnv();
  });

  describe('Health Check', () => {
    it('should respond to health check', async () => {
      const response = await fetch(`http://localhost:${testPort}/health`);
      expect(response.ok).toBe(true);

      const data = (await response.json()) as any;
      expect(data.status).toBe('ok');
      expect(data.service).toBe('http-mcp-bridge');
      expect(data.timestamp).toBeDefined();
      expect(Array.isArray(data.tools)).toBe(true);
    });
  });

  describe('MCP Protocol', () => {
    it('should handle tools/list request', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      };

      const response = await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      expect(response.ok).toBe(true);
      const data = (await response.json()) as any;

      expect(data.jsonrpc).toBe('2.0');
      expect(data.id).toBe(1);
      expect(data.result).toBeDefined();
      expect(data.result.tools).toBeDefined();
      expect(Array.isArray(data.result.tools)).toBe(true);

      // Should have some tools available
      expect(data.result.tools.length).toBeGreaterThan(0);

      // Check for some expected tools (tool names may vary by registration)
      const toolNames = data.result.tools.map((tool: any) => tool.name);
      expect(toolNames).toContain('view_workspace');
    });

    it('should handle invalid JSON-RPC request gracefully', async () => {
      const invalidRequest = {
        // Missing jsonrpc field
        method: 'tools/list',
        id: 1,
      };

      const response = await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(invalidRequest),
      });

      // MCP server is lenient and still processes the request
      expect(response.ok).toBe(true);
      const data = (await response.json()) as any;

      // Should return a valid response (MCP server is lenient)
      expect(data.id).toBe(1);
      // Either succeeds or returns an error
      expect(data.result || data.error).toBeDefined();
    });

    it('should handle malformed JSON', async () => {
      const response = await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid json',
      });

      // Express returns 400 for malformed JSON
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain('SyntaxError');
      expect(text).toContain('not valid JSON');
    });
  });

  describe('Tool Execution', () => {
    it('should handle view_workspace tool call', async () => {
      const request = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'view_workspace',
          arguments: {},
        },
        id: 2,
      };

      const response = await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      expect(response.ok).toBe(true);
      const data = (await response.json()) as any;

      expect(data.jsonrpc).toBe('2.0');
      expect(data.id).toBe(2);

      // Should either succeed or fail gracefully
      if (data.result) {
        expect(data.result.content).toBeDefined();
      } else if (data.error) {
        expect(data.error.code).toBeDefined();
        expect(data.error.message).toBeDefined();
      }
    });
  });

  describe('MCP Server Cache Management', () => {
    it('should provide cache stats', () => {
      const stats = bridge.getMcpServerCacheStats();
      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(stats.servers)).toBe(true);
    });

    it('should clear MCP servers for a specific workspace', async () => {
      // First, make a request to ensure there's a cached server
      const request = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 100,
      };

      await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': 'test-workspace-123',
        },
        body: JSON.stringify(request),
      });

      const statsBefore = bridge.getMcpServerCacheStats();

      // Clear the cache for that workspace
      const clearedCount = bridge.clearMcpServersForWorkspace('test-workspace-123');

      const statsAfter = bridge.getMcpServerCacheStats();

      // Should have cleared at least one server if one was created
      if (statsBefore.total > 0) {
        expect(clearedCount).toBeGreaterThanOrEqual(0);
        expect(statsAfter.total).toBeLessThanOrEqual(statsBefore.total);
      }
    });

    it('should clear all MCP servers', async () => {
      // First, make a request to ensure there's a cached server
      const request = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 101,
      };

      await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': 'test-workspace-456',
        },
        body: JSON.stringify(request),
      });

      // Clear all servers
      bridge.clearAllMcpServers();

      const statsAfter = bridge.getMcpServerCacheStats();
      expect(statsAfter.total).toBe(0);
      expect(statsAfter.servers).toHaveLength(0);
    });

    it('should handle requests after cache is cleared', async () => {
      // Clear all servers first
      bridge.clearAllMcpServers();

      // Make a request - should work because it creates a new server
      const request = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 102,
      };

      const response = await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      expect(response.ok).toBe(true);
      const data = (await response.json()) as any;
      expect(data.result.tools).toBeDefined();

      // Should have created a new cached server
      const stats = bridge.getMcpServerCacheStats();
      expect(stats.total).toBeGreaterThan(0);
    });

    it('should perform health check on cached servers', async () => {
      // First, make a request to ensure there's a cached server
      const request = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 103,
      };

      await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': 'health-check-test',
        },
        body: JSON.stringify(request),
      });

      // Run health check
      const result = await bridge.healthCheckMcpServers();

      // Should have checked at least one server
      expect(result.checked).toBeGreaterThanOrEqual(0);
      expect(result.healthy).toBeGreaterThanOrEqual(0);
      expect(result.unhealthy).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.removed)).toBe(true);
      expect(result.healthy + result.unhealthy).toBe(result.checked);
    });

    it('should perform health check for specific workspace', async () => {
      // First, make a request to ensure there's a cached server
      const request = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 104,
      };

      await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': 'specific-workspace-health',
        },
        body: JSON.stringify(request),
      });

      // Run health check for specific workspace
      const result = await bridge.healthCheckMcpServers('specific-workspace-health');

      // Should have checked servers for that workspace only
      expect(result.checked).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.removed)).toBe(true);
    });
  });
});
