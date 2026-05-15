/**
 * Tests for agent-loader.ts
 * Verifies that the loader correctly uses the backend's agent:persistence:list endpoint
 * and properly filters/transforms the response data.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';

// Mock must be defined before any imports that use it
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(),
}));

describe('agent-loader', () => {
  let getStoredAgentsFromDisk: any;
  let invalidateAgentCache: any;
  let invoke: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the module to clear cached data
    vi.resetModules();

    // Re-import both modules after reset
    const electronBridge = await import('$lib/electron-bridge');
    invoke = electronBridge.invoke;

    const agentLoader = await import('../agent-loader');
    getStoredAgentsFromDisk = agentLoader.getStoredAgentsFromDisk;
    invalidateAgentCache = agentLoader.invalidateAgentCache;
  });

  describe('getStoredAgentsFromDisk', () => {
    it('should load agents from backend persistence list endpoint', async () => {
      const workspaceId = 'test-workspace-id';
      const agentId = 'agent-test-123';

      // Mock the agent:persistence:list response
      vi.mocked(invoke).mockResolvedValueOnce({
        success: true,
        data: [
          {
            id: agentId,
            backendAgentId: agentId,
            workspaceId,
            name: 'Test Agent',
            status: 'Active',
            messages: [
              { role: 'user', content: 'Hello' },
              { role: 'assistant', content: 'Hi there!' },
            ],
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:01:00Z',
            metadata: {
              isInitialAgent: false,
            },
          },
        ],
      });

      const agents = await getStoredAgentsFromDisk(workspaceId);

      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe(agentId);
      expect(agents[0].name).toBe('Test Agent');
      expect(agents[0].status).toBe('Active');
      expect(agents[0].messages).toHaveLength(2);
      expect(agents[0].isInitialAgent).toBe(false);
    });

    it('should handle wrapped agents response format', async () => {
      const workspaceId = 'test-workspace-id';
      const agentId = 'agent-test-456';

      // Mock response with { agents: [...] } wrapper
      vi.mocked(invoke).mockResolvedValueOnce({
        success: true,
        data: {
          agents: [
            {
              id: agentId,
              backendAgentId: agentId,
              workspaceId,
              name: 'Test Agent Wrapped',
              status: 'Active',
              messages: [{ role: 'user', content: 'Test' }],
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:01:00Z',
            },
          ],
        },
      });

      const agents = await getStoredAgentsFromDisk(workspaceId);

      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe(agentId);
      expect(agents[0].name).toBe('Test Agent Wrapped');
    });

    it('should skip deleted agents', async () => {
      const workspaceId = 'test-workspace-id';

      // Mock response with both deleted and active agents
      vi.mocked(invoke).mockResolvedValueOnce({
        success: true,
        data: [
          {
            id: 'agent-deleted',
            workspaceId,
            name: 'Deleted Agent',
            status: 'deleted',
            messages: [],
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:01:00Z',
          },
          {
            id: 'agent-active',
            workspaceId,
            name: 'Active Agent',
            status: 'Active',
            messages: [],
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:01:00Z',
          },
        ],
      });

      const agents = await getStoredAgentsFromDisk(workspaceId);

      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('agent-active');
      expect(agents[0].name).toBe('Active Agent');
    });

    it('should skip terminal IDs', async () => {
      const workspaceId = 'test-workspace-id';

      // Mock response with both terminal and agent entries
      vi.mocked(invoke).mockResolvedValueOnce({
        success: true,
        data: [
          {
            id: 'terminal-1763679158073',
            workspaceId,
            name: 'Terminal Session',
            status: 'Active',
            messages: [],
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:01:00Z',
          },
          {
            id: 'agent-valid',
            workspaceId,
            name: 'Valid Agent',
            status: 'Active',
            messages: [],
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:01:00Z',
          },
        ],
      });

      const agents = await getStoredAgentsFromDisk(workspaceId);

      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('agent-valid');
      expect(agents[0].name).toBe('Valid Agent');
    });

    it('should return empty array on backend failure', async () => {
      const workspaceId = 'test-workspace-id';

      // Mock failed response
      vi.mocked(invoke).mockResolvedValueOnce({
        success: false,
        error: 'Backend error',
      });

      const agents = await getStoredAgentsFromDisk(workspaceId);

      expect(agents).toHaveLength(0);
    });

    it('should use frontend cache for rapid calls', async () => {
      const workspaceId = 'test-workspace-id';

      // Mock the first call
      vi.mocked(invoke).mockResolvedValueOnce({
        success: true,
        data: [
          {
            id: 'agent-1',
            workspaceId,
            name: 'Agent 1',
            status: 'Active',
            messages: [],
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:01:00Z',
          },
        ],
      });

      // First call
      const agents1 = await getStoredAgentsFromDisk(workspaceId);
      expect(agents1).toHaveLength(1);

      // Second call should use cache (invoke should only be called once)
      const agents2 = await getStoredAgentsFromDisk(workspaceId);
      expect(agents2).toHaveLength(1);
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache when requested', async () => {
      const workspaceId = 'test-workspace-id';

      // Mock the first call
      vi.mocked(invoke).mockResolvedValue({
        success: true,
        data: [
          {
            id: 'agent-1',
            workspaceId,
            name: 'Agent 1',
            status: 'Active',
            messages: [],
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:01:00Z',
          },
        ],
      });

      // First call
      await getStoredAgentsFromDisk(workspaceId);
      expect(invoke).toHaveBeenCalledTimes(1);

      // Invalidate cache
      invalidateAgentCache(workspaceId);

      // Second call should hit backend again
      await getStoredAgentsFromDisk(workspaceId);
      expect(invoke).toHaveBeenCalledTimes(2);
    });
  });
});
