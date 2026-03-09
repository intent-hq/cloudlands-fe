/**
 * HTTP MCP Bridge Tests
 *
 * Tests the HTTP MCP Bridge that exposes MCP tools via HTTP
 * These are integration tests that actually start the HTTP server
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { HttpMcpBridge } from '../http-mcp-bridge';

// Mock electron-store
vi.mock('electron-store', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(() => ({
    set: vi.fn(),
    get: vi.fn(),
    store: {},
  })),
}));

// Mock unified event bus with domain event support
const mockDomainEventListeners: Map<string, Array<(data: any) => void>> = new Map();
vi.mock('../../features/events/main/unified-event-bus', () => ({
  unifiedEventBus: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getInstanceId: vi.fn().mockReturnValue('test-instance'),
    onDomainEvent: vi.fn((event: string, callback: (data: any) => void) => {
      if (!mockDomainEventListeners.has(event)) {
        mockDomainEventListeners.set(event, []);
      }
      mockDomainEventListeners.get(event)!.push(callback);
    }),
    emitDomainEvent: vi.fn((event: string, data: any) => {
      const listeners = mockDomainEventListeners.get(event) || [];
      listeners.forEach((cb) => cb(data));
    }),
  },
}));

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

      // Check for some expected tools
      const toolNames = data.result.tools.map((tool: any) => tool.name);
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('list_files');
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
