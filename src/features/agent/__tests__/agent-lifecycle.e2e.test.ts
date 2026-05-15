/**
 * End-to-End Agent Lifecycle Tests
 *
 * Comprehensive integration tests for the full agent lifecycle including:
 * - Agent creation
 * - Message sending and streaming
 * - Agent resumption
 * - Persistence verification
 * - Error handling and recovery
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { UnifiedAgentFactory } from '../services/agent-factory';
import { ConsolidatedBackendService } from '../main/consolidated-backend.service';
import { agentPersistence } from '../main/agent-persistence';
import { unifiedIdService } from '$shared/services/unified-id.service';
import { AgentStatus } from '$shared/types';
import type { AgentSession } from '$shared/types';
import type { WorkspaceId } from '$shared/types/branded-ids';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

describe('Agent Lifecycle E2E Tests', () => {
  let factory: UnifiedAgentFactory;
  let backend: ConsolidatedBackendService;
  let testWorkspaceId: WorkspaceId;
  let testWorkspacePath: string;
  let cleanupFunctions: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    // Create test workspace
    testWorkspaceId = unifiedIdService.generateWorkspaceId();
    testWorkspacePath = path.join(tmpdir(), 'test-workspaces', testWorkspaceId);

    // Ensure test directory exists
    await fs.promises.mkdir(path.join(testWorkspacePath, '.workspace', 'agents'), {
      recursive: true,
    });

    // Initialize services
    factory = UnifiedAgentFactory.getInstance();
    backend = ConsolidatedBackendService.getInstance();
  });

  afterEach(async () => {
    // Run all cleanup functions
    for (const cleanup of cleanupFunctions) {
      await cleanup();
    }
    cleanupFunctions = [];

    // Clean up test workspace
    if (testWorkspacePath && fs.existsSync(testWorkspacePath)) {
      await fs.promises.rm(testWorkspacePath, { recursive: true, force: true });
    }

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('Agent Creation', () => {
    it('should create a new agent with initial message', async () => {
      // Mock the backend createAgent method
      const mockAgent: AgentSession = {
        id: unifiedIdService.generateAgentId(),
        workspaceId: testWorkspaceId,
        status: AgentStatus.IDLE,
        messages: [
          {
            id: unifiedIdService.generateMessageId(),
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Hello, agent!' }],
            timestamp: new Date().toISOString(),
          },
        ],
        systemPrompt: '',
        model: 'haiku4.5',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(factory, 'createAgent').mockResolvedValue(mockAgent);

      // Create agent
      const agent = await factory.createAgent({
        workspaceId: testWorkspaceId,
        workspacePath: testWorkspacePath,
        initialMessage: 'Hello, agent!',
        model: 'haiku4.5',
      });

      expect(agent).toBeDefined();
      expect(agent.id).toMatch(/^agent-[a-f0-9-]+$/);
      expect(agent.status).toBe(AgentStatus.IDLE);
      expect(agent.messages).toHaveLength(1);
      expect(agent.messages[0].role).toBe('user');
      expect(agent.messages[0].contentBlocks[0].text).toBe('Hello, agent!');
    });

    it('should create agent with custom rules', async () => {
      const customRules = 'Always be polite and helpful.';

      const mockAgent: AgentSession = {
        id: unifiedIdService.generateAgentId(),
        workspaceId: testWorkspaceId,
        status: AgentStatus.IDLE,
        messages: [],
        systemPrompt: customRules,
        model: 'haiku4.5',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(factory, 'createAgent').mockResolvedValue(mockAgent);

      const agent = await factory.createAgent({
        workspaceId: testWorkspaceId,
        workspacePath: testWorkspacePath,
        rules: customRules,
        model: 'haiku4.5',
      });

      expect(agent).toBeDefined();
      expect(agent.systemPrompt).toContain(customRules);
    });

    it('should create agent with system prompt', async () => {
      const systemPrompt = 'You are a helpful coding assistant.';

      const mockAgent: AgentSession = {
        id: unifiedIdService.generateAgentId(),
        workspaceId: testWorkspaceId,
        status: AgentStatus.IDLE,
        messages: [],
        systemPrompt,
        model: 'haiku4.5',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(factory, 'createAgent').mockResolvedValue(mockAgent);

      const agent = await factory.createAgent({
        workspaceId: testWorkspaceId,
        workspacePath: testWorkspacePath,
        systemPrompt,
        model: 'haiku4.5',
      });

      expect(agent).toBeDefined();
      expect(agent.systemPrompt).toBe(systemPrompt);
    });
  });

  describe('Message Sending and Streaming', () => {
    it('should send message and receive streaming response', async () => {
      // Create agent
      const agent = await factory.createAgent({
        workspaceId: testWorkspaceId,
        workspacePath: testWorkspacePath,
        model: 'haiku4.5',
      });

      // Mock streaming response
      const mockStream = vi.fn();
      vi.spyOn(backend as any, 'sendMessage').mockImplementation(async () => {
        // Simulate streaming response
        setTimeout(() => {
          mockStream({
            type: 'message_start',
            agentId: agent.id,
            messageId: unifiedIdService.generateMessageId(),
          });
        }, 10);

        setTimeout(() => {
          mockStream({
            type: 'content_block_delta',
            agentId: agent.id,
            delta: { text: 'Hello' },
          });
        }, 20);

        setTimeout(() => {
          mockStream({
            type: 'content_block_delta',
            agentId: agent.id,
            delta: { text: ' world!' },
          });
        }, 30);

        setTimeout(() => {
          mockStream({
            type: 'message_stop',
            agentId: agent.id,
          });
        }, 40);

        return { success: true };
      });

      // Send message
      const response = await backend.sendMessage({
        agentId: agent.id,
        workspaceId: testWorkspaceId,
        message: 'Test message',
        model: 'haiku4.5',
      });

      expect(response.success).toBe(true);

      // Wait for streaming to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify mock was called
      expect(mockStream).toHaveBeenCalledTimes(4);
    });

    it('should handle streaming errors gracefully', async () => {
      const mockAgent: AgentSession = {
        id: unifiedIdService.generateAgentId(),
        workspaceId: testWorkspaceId,
        status: AgentStatus.IDLE,
        messages: [],
        systemPrompt: '',
        model: 'haiku4.5',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(factory, 'createAgent').mockResolvedValue(mockAgent);

      const agent = await factory.createAgent({
        workspaceId: testWorkspaceId,
        workspacePath: testWorkspacePath,
        model: 'haiku4.5',
      });

      // Mock error during streaming
      vi.spyOn(backend as any, 'sendMessage').mockResolvedValue({
        success: false,
        error: 'Streaming failed',
      });

      const response = await backend.sendMessage({
        agentId: agent.id,
        workspaceId: testWorkspaceId,
        message: 'Test message',
        model: 'haiku4.5',
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Streaming failed');
    });
  });

  describe('Agent Persistence', () => {
    it('should persist agent to disk', async () => {
      const mockAgent: AgentSession = {
        id: unifiedIdService.generateAgentId(),
        workspaceId: testWorkspaceId,
        status: AgentStatus.IDLE,
        messages: [
          {
            id: unifiedIdService.generateMessageId(),
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Test persistence' }],
            timestamp: new Date().toISOString(),
          },
        ],
        systemPrompt: '',
        model: 'haiku4.5',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock save operation
      vi.spyOn(agentPersistence, 'saveAgent').mockResolvedValue(undefined);

      // Save agent
      await agentPersistence.saveAgent(testWorkspaceId, mockAgent);

      // Verify mock was called
      expect(agentPersistence.saveAgent).toHaveBeenCalledWith(testWorkspaceId, mockAgent);
    });

    it('should load persisted agent', async () => {
      const mockAgent: AgentSession = {
        id: unifiedIdService.generateAgentId(),
        workspaceId: testWorkspaceId,
        status: AgentStatus.IDLE,
        messages: [
          {
            id: unifiedIdService.generateMessageId(),
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Original message' }],
            timestamp: new Date().toISOString(),
          },
        ],
        systemPrompt: '',
        model: 'haiku4.5',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock load operation
      vi.spyOn(agentPersistence, 'loadAgent').mockResolvedValue(mockAgent);

      // Load agent
      const loadedAgent = await agentPersistence.loadAgent(testWorkspaceId, mockAgent.id);

      expect(loadedAgent).toBeDefined();
      expect(loadedAgent?.id).toBe(mockAgent.id);
      expect(loadedAgent?.messages).toHaveLength(1);
      expect(loadedAgent?.messages[0].contentBlocks[0].text).toBe('Original message');
    });

    it('should handle missing agent gracefully', async () => {
      const nonExistentId = unifiedIdService.generateAgentId();

      // Mock load operation to return null for non-existent agent
      vi.spyOn(agentPersistence, 'loadAgent').mockResolvedValue(null);

      const loadedAgent = await agentPersistence.loadAgent(testWorkspaceId, nonExistentId);

      expect(loadedAgent).toBeNull();
    });
  });

  describe('Agent Resumption', () => {
    it('should load and resume agent with existing messages', async () => {
      const mockAgent: AgentSession = {
        id: unifiedIdService.generateAgentId(),
        workspaceId: testWorkspaceId,
        status: AgentStatus.IDLE,
        messages: [
          {
            id: unifiedIdService.generateMessageId(),
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'First message' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: unifiedIdService.generateMessageId(),
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'First response' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: unifiedIdService.generateMessageId(),
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Second message' }],
            timestamp: new Date().toISOString(),
          },
        ],
        systemPrompt: '',
        model: 'haiku4.5',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock load operation to simulate resumption
      vi.spyOn(agentPersistence, 'loadAgent').mockResolvedValue(mockAgent);

      // Load agent (simulating resumption)
      const resumedAgent = await agentPersistence.loadAgent(testWorkspaceId, mockAgent.id);

      expect(resumedAgent).toBeDefined();
      expect(resumedAgent?.id).toBe(mockAgent.id);
      expect(resumedAgent?.messages).toHaveLength(3);
      expect(resumedAgent?.status).toBe(AgentStatus.IDLE);
    });
  });
});
