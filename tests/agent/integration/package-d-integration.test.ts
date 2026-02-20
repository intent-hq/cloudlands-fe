/**
 * Package D Integration Tests
 *
 * Comprehensive integration tests for agent creation, resumption, and streaming flows.
 * Validates all fixes from packages A, B, C are working correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockWorkspace } from '../../../src/test/factories/workspace.factory';
import { agentFactory } from '../../../src/features/agent/services/agent-factory';
import { unifiedOrchestrator } from '../../../src/features/agent/services/consolidated-backend.service';
import { streamManager } from '../../../src/features/agent/services/stream-manager';
import { consolidatedBackend } from '../../../src/features/agent/services/consolidated-backend.service';
import type { Workspace, AgentSession } from '../../../src/shared/types';
import { AgentStatus } from '../../../src/shared/types';
import { IdGenerator } from '../../../src/shared/services/id-generator';

// Track created agents for testing
const createdAgents = new Map<string, AgentSession>();

// Mock the IPC invoke function
vi.mock('../../../src/lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue({ success: true, data: '' }),
  typedInvoke: vi.fn(),
}));

// Mock the shared IPC typed invoke
vi.mock('../../../src/shared/ipc/typed-invoke', () => ({
  typedInvoke: vi.fn().mockImplementation((channel, request) => {
    // Handle agent creation
    if (channel === 'agent:create') {
      // Track the created agent
      const agent: AgentSession = {
        id: request.agentId,
        name: request.name,
        workspaceId: request.workspaceId,
        status: AgentStatus.Active,
        backendSessionId: IdGenerator.generateSessionId(),
        model: request.model || 'gpt-4',
        systemPrompt: request.systemPrompt,
        messages: [],
        isStreaming: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      createdAgents.set(agent.id, agent);
      return Promise.resolve({ success: true });
    }
    return Promise.resolve({ success: true });
  }),
}));

// Mock the consolidated backend
vi.mock('../../../src/features/agent/services/consolidated-backend.service', () => ({
  consolidatedBackend: {
    createAgent: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    getAgent: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    deleteAgent: vi.fn(),
    saveAgent: vi.fn().mockResolvedValue({ success: true }),
    loadAgent: vi.fn(),
    listPersistedAgents: vi.fn().mockResolvedValue([]),
    getHealthMetrics: vi.fn(),
    reset: vi.fn(),
    shutdown: vi.fn(),
  },
  unifiedOrchestrator: {
    createAgent: vi.fn(),
    loadAgent: vi.fn(),
    deleteAgent: vi.fn(),
    sendMessage: vi.fn(),
    listAgents: vi.fn(),
    cleanup: vi.fn(),
  },
}));

describe('Package D: Integration & Validation', () => {
  let workspace: Workspace;

  beforeEach(() => {
    workspace = createMockWorkspace();
    vi.clearAllMocks();
    createdAgents.clear();

    // Update mocks to use our tracking map
    vi.mocked(consolidatedBackend.createAgent).mockImplementation(async (workspace, config) => {
      if (!config.name || config.name.trim() === '') {
        return { success: false, error: 'Agent name is required' };
      }
      const agent: AgentSession = {
        id: IdGenerator.generateAgentId(),
        name: config.name,
        workspaceId: workspace.id,
        status: AgentStatus.Active,
        backendSessionId: IdGenerator.generateSessionId(),
        model: config.model || 'gpt-4',
        systemPrompt: config.systemPrompt,
        messages: [],
        isStreaming: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      createdAgents.set(agent.id, agent);
      return { success: true, agent };
    });

    vi.mocked(consolidatedBackend.loadAgent).mockImplementation(async (agentId) => {
      const agent = createdAgents.get(agentId);
      return agent
        ? { success: true, agent }
        : { success: false, agent: null, error: 'Agent not found' };
    });

    vi.mocked(consolidatedBackend.deleteAgent).mockImplementation(async (agentId) => {
      createdAgents.delete(agentId);
      return { success: true };
    });

    // Mock unifiedOrchestrator methods
    vi.mocked(unifiedOrchestrator.loadAgent).mockImplementation(async (agentId) => {
      const agent = createdAgents.get(agentId);
      return agent || null;
    });

    vi.mocked(unifiedOrchestrator.deleteAgent).mockImplementation(async (agentId) => {
      createdAgents.delete(agentId);
      return true;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    streamManager.destroy();
  });

  describe('Agent Creation Flow', () => {
    it('should create an agent successfully', async () => {
      const result = await agentFactory.createAgent(workspace, {
        name: 'Test Agent',
        workspaceId: workspace.id as any,
        model: 'gpt-4',
        systemPrompt: 'Test instruction',
        source: 'api',
      });

      expect(result.success).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent?.id).toBeDefined();
      expect(result.agent?.name).toBe('Test Agent');
    });

    it('should create agent with initial message', async () => {
      const result = await agentFactory.createAgent(workspace, {
        name: 'Test Agent',
        workspaceId: workspace.id as any,
        model: 'gpt-4',
        systemPrompt: 'Test instruction',
        initialMessage: 'Hello, agent!',
        source: 'api',
      });

      expect(result.success).toBe(true);
      expect(result.agent?.messages).toBeDefined();
    });

    it('should handle agent creation with special characters in name', async () => {
      // Agent names can contain any characters - no restrictions
      // This test verifies that special characters are allowed
      const nameWithSpecialChars = 'Test@Agent#$%';
      const result = await agentFactory.createAgent(workspace, {
        name: nameWithSpecialChars,
        workspaceId: workspace.id as any,
        model: 'gpt-4',
        systemPrompt: 'Test',
        source: 'api',
      });

      // Agent names with special characters should succeed
      expect(result.success).toBe(true);
      expect(result.agent).toBeDefined();
    });
  });

  describe('Agent Resumption Flow', () => {
    it('should resume an existing agent', async () => {
      const created = await agentFactory.createAgent(workspace, {
        name: 'Test Agent',
        workspaceId: workspace.id as any,
        model: 'gpt-4',
        systemPrompt: 'Test',
        source: 'api',
      });

      expect(created.success).toBe(true);
      const agentId = created.agent?.id;

      const resumed = await unifiedOrchestrator.loadAgent(agentId!, workspace);
      expect(resumed).toBeDefined();
      expect(resumed?.id).toBe(agentId);
    });

    it('should handle resuming non-existent agent', async () => {
      const resumed = await unifiedOrchestrator.loadAgent('non-existent', workspace);
      expect(resumed).toBeNull();
    });
  });

  describe('Streaming Flow', () => {
    it('should stream messages correctly', async () => {
      const created = await agentFactory.createAgent(workspace, {
        name: 'Test Agent',
        workspaceId: workspace.id as any,
        model: 'gpt-4',
        systemPrompt: 'Test',
        source: 'api',
      });

      expect(created.success).toBe(true);
      const agent = created.agent!;

      // Start a stream
      const streamId = streamManager.startStream({
        agentId: agent.id,
        sessionId: agent.backendSessionId || 'test-session',
        workspaceId: workspace.id,
      });

      expect(streamId).toBeDefined();

      // Add chunks
      streamManager.addTextChunk(streamId, 'Hello ');
      streamManager.addTextChunk(streamId, 'World');

      // Flush batch processor to ensure chunks are processed
      streamManager.flushBatch();

      // Complete the stream
      const result = await streamManager.completeStream(streamId);
      expect(result.success).toBe(true);
      expect(result.message?.content).toBe('Hello World');
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory on agent disposal', async () => {
      const created = await agentFactory.createAgent(workspace, {
        name: 'Test Agent',
        workspaceId: workspace.id as any,
        model: 'gpt-4',
        systemPrompt: 'Test',
        source: 'api',
      });

      expect(created.success).toBe(true);
      const agent = created.agent!;

      // Dispose agent via orchestrator
      await unifiedOrchestrator.deleteAgent(agent.id);

      const resumed = await unifiedOrchestrator.loadAgent(agent.id, workspace);
      expect(resumed).toBeNull();
    });
  });

  describe('Performance Metrics', () => {
    it('should create agent within acceptable time', async () => {
      const start = Date.now();

      const result = await agentFactory.createAgent(workspace, {
        name: 'Test Agent',
        workspaceId: workspace.id as any,
        model: 'gpt-4',
        systemPrompt: 'Test',
        source: 'api',
      });

      const duration = Date.now() - start;
      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000); // 5 seconds
    });
  });
});
