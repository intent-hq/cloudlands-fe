/**
 * Tests for Unified Agent Factory
 *
 * Tests the consolidated agent creation service that consolidates
 * createAgent, createInitialAgent, and createContextualAgent into one unified interface.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  UnifiedAgentFactory,
  type UnifiedAgentConfig,
  type CreateAgentResult,
} from '../agent-factory';
import type { Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';

// Mock the typed invoke
vi.mock('$shared/ipc/typed-invoke', () => ({
  typedInvoke: vi.fn().mockResolvedValue({
    success: true,
    data: {
      agent: {
        id: 'agent-123',
        backendSessionId: 'session-123',
        workspaceId: 'workspace-123',
        name: 'Test Agent',
        model: 'sonnet4.5',
        status: 'active',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      sessionId: 'session-123',
    },
  }),
}));

// Mock electron-bridge for user rules
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue({
    success: true,
    data: 'User defined rules',
  }),
}));

// Mock the agent state
vi.mock('../agent-state.svelte', () => ({
  agentState: {
    setAgent: vi.fn(),
    getAgent: vi.fn(),
    addMessage: vi.fn(),
    updateSession: vi.fn(),
  },
  sessionStore: {
    addSession: vi.fn(),
    updateMessages: vi.fn(),
    setStreaming: vi.fn(),
  },
}));

describe('UnifiedAgentFactory', () => {
  let factory: UnifiedAgentFactory;
  let mockWorkspace: Workspace;

  beforeEach(() => {
    factory = UnifiedAgentFactory.getInstance();
    mockWorkspace = {
      id: 'workspace-123' as any,
      title: 'Test Workspace',
      path: '/test/workspace',
      repositoryPath: '/test/workspace',
      worktreePath: undefined,
      branch: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: 'active' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createAgent', () => {
    it('should create an agent with valid configuration', async () => {
      const config: UnifiedAgentConfig = {
        name: 'Test Agent',
        workspaceId: mockWorkspace.id as any,
        model: 'sonnet4.5',
        systemPrompt: 'You are a helpful assistant',
      };

      const result = await factory.createAgent(mockWorkspace, config);

      // Log the result to debug
      if (!result.success) {
        console.error('Agent creation failed:', result.error);
      }

      expect(result.success).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent?.name).toBe('Test Agent');
      expect(result.agent?.status).toBe(AgentStatus.Active);
      expect(result.agentId).toBeDefined();
      expect(result.sessionId).toBeDefined();
      // Note: streamId is no longer returned - agentId is the canonical key for streams
    });

    it('should normalize agent name if too long', async () => {
      const longName = 'A'.repeat(150);
      const config: UnifiedAgentConfig = {
        name: longName,
        workspaceId: mockWorkspace.id as any,
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.name.length).toBeLessThanOrEqual(100);
    });

    it('should use default name if not provided', async () => {
      const config: UnifiedAgentConfig = {
        name: '',
        workspaceId: mockWorkspace.id as any,
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      // When no name and no initialMessage, falls back to generic "Agent" name
      expect(result.agent?.name).toBe('Agent');
    });

    it('should fail if workspace has no path', async () => {
      const invalidWorkspace = { ...mockWorkspace, path: undefined, repositoryPath: undefined };
      const config: UnifiedAgentConfig = {
        name: 'Test Agent',
        workspaceId: mockWorkspace.id as any,
      };

      const result = await factory.createAgent(invalidWorkspace, config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('path');
    });

    it('should respect explicit isBackground: false and not fall back to metadata', async () => {
      const config: UnifiedAgentConfig = {
        name: 'Foreground Agent',
        workspaceId: mockWorkspace.id as any,
        isBackground: false,
        metadata: { isBackground: true },
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.isBackground).toBe(false);
    });

    it('should fall back to metadata.isBackground when isBackground is undefined', async () => {
      const config: UnifiedAgentConfig = {
        name: 'Background via Metadata',
        workspaceId: mockWorkspace.id as any,
        metadata: { isBackground: true },
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.isBackground).toBe(true);
    });

    it('should include metadata in agent state', async () => {
      const config: UnifiedAgentConfig = {
        name: 'Test Agent',
        workspaceId: mockWorkspace.id as any,
        source: 'workspace-initializer',
        metadata: { custom: 'value' },
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.metadata?.source).toBe('workspace-initializer');
      expect(result.agent?.metadata?.custom).toBe('value');
    });
  });
});
