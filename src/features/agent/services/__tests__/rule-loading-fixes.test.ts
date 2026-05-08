/**
 * Test Agent Creation with agentType
 *
 * Verifies that:
 * 1. Agents are created successfully with agentType
 * 2. Backend builds system prompts (frontend doesn't have systemPrompt)
 * 3. Agent metadata is properly set
 * 4. Different agent types work correctly
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

// Mock IPC and Redux dependencies
vi.mock('$shared/ipc/typed-invoke', () => ({
  typedInvoke: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue({ success: true, data: '' }),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({
    getState: () => ({ workspaceAgents: { byWorkspaceId: {} } }),
    dispatch: vi.fn(),
  }),
}));



import { UnifiedAgentFactory } from '../agent-factory';
import { WorkspaceId } from '../../../../shared/types/branded-ids';
import { AgentStatus } from '../../../../shared/types/agent.types';

describe('Agent Creation with agentType', () => {
  let factory: UnifiedAgentFactory;

  beforeAll(() => {
    factory = new UnifiedAgentFactory();
  });

  describe('Agent Type Based Creation', () => {
    it('should create agent with workspace type', async () => {
      const mockWorkspace = {
        id: WorkspaceId('test-workspace'),
        name: 'Test Workspace',
        path: '/tmp/test-workspace-rules',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const config = {
        name: 'Test Agent',
        workspaceId: mockWorkspace.id,
        agentType: 'workspace',
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.name).toBe('Test Agent');
      expect(result.agent?.metadata?.agentType).toBe('workspace');
      // systemPrompt is built by backend, not available in frontend
      expect(result.agent?.systemPrompt).toBeUndefined();
    });

    it('should create agent with debug type', async () => {
      const mockWorkspace = {
        id: WorkspaceId('test-workspace-2'),
        name: 'Test Workspace 2',
        path: '/tmp/test-workspace-rules-2',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const config = {
        name: 'Debug Agent',
        workspaceId: mockWorkspace.id,
        agentType: 'debug',
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.name).toBe('Debug Agent');
      expect(result.agent?.metadata?.agentType).toBe('debug');
      expect(result.agent?.status).toBe(AgentStatus.Idle);
    });

    it('should create agent with chat type', async () => {
      const mockWorkspace = {
        id: WorkspaceId('test-workspace-3'),
        name: 'Test Workspace 3',
        path: '/tmp/test-workspace-rules-3',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const config = {
        name: 'Chat Agent',
        workspaceId: mockWorkspace.id,
        agentType: 'chat',
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.name).toBe('Chat Agent');
      expect(result.agent?.metadata?.agentType).toBe('chat');
    });
  });

  describe('Agent Metadata', () => {
    it('should preserve custom metadata', async () => {
      const mockWorkspace = {
        id: WorkspaceId('test-workspace-4'),
        name: 'Test Workspace 4',
        path: '/tmp/test-workspace-rules-4',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const config = {
        name: 'Metadata Agent',
        workspaceId: mockWorkspace.id,
        agentType: 'task-loop',
        metadata: {
          source: 'test',
          custom: 'value',
        },
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.metadata?.custom).toBe('value');
      expect(result.agent?.metadata?.source).toBe('test');
      expect(result.agent?.metadata?.agentType).toBe('task-loop');
    });
  });
});

describe('Agent Creation Edge Cases', () => {
  let factory: UnifiedAgentFactory;

  beforeAll(() => {
    factory = new UnifiedAgentFactory();
  });

  it('should handle agent creation with minimal config', async () => {
    const mockWorkspace = {
      id: WorkspaceId('test-workspace-edge-1'),
      name: 'Test Workspace',
      path: '/tmp/test-workspace-edge-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const config = {
      name: 'Minimal Agent',
      workspaceId: mockWorkspace.id,
      // No agentType - backend will use default
    };

    const result = await factory.createAgent(mockWorkspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.name).toBe('Minimal Agent');
    expect(result.agent?.workspaceId).toBe(mockWorkspace.id);
  });

  it('should handle agent creation with all optional fields', async () => {
    const mockWorkspace = {
      id: WorkspaceId('test-workspace-edge-2'),
      name: 'Test Workspace',
      path: '/tmp/test-workspace-edge-2',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const config = {
      name: 'Full Config Agent',
      workspaceId: mockWorkspace.id,
      agentType: 'task-focused',
      metadata: {
        source: 'test',
        custom: 'value',
      },
      initialMessage: 'Hello',
    };

    const result = await factory.createAgent(mockWorkspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.name).toBe('Full Config Agent');
    expect(result.agent?.metadata?.custom).toBe('value');
    expect(result.agent?.metadata?.agentType).toBe('task-focused');
  });

  it('should handle agent creation without agentType', async () => {
    const mockWorkspace = {
      id: WorkspaceId('test-workspace-edge-3'),
      name: 'Test Workspace',
      path: '/tmp/test-workspace-edge-3',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const config = {
      name: 'No Type Agent',
      workspaceId: mockWorkspace.id,
    };

    const result = await factory.createAgent(mockWorkspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.name).toBe('No Type Agent');
  });

  it('should handle agent creation with context references', async () => {
    const mockWorkspace = {
      id: WorkspaceId('test-workspace-edge-4'),
      name: 'Test Workspace',
      path: '/tmp/test-workspace-edge-4',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const config = {
      name: 'Context Agent',
      workspaceId: mockWorkspace.id,
      agentType: 'debug',
      contextReferences: [{ type: 'file', path: '/test.ts', content: 'test' }],
    };

    const result = await factory.createAgent(mockWorkspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.name).toBe('Context Agent');
    expect(result.agent?.metadata?.agentType).toBe('debug');
  });
});
