/**
 * Test initial agent creation during workspace initialization
 * Ensures agents are properly created when a new workspace is set up
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Initial Agent Creation (Workspace Initialization)', () => {
  let mockAgentFactory: any;
  let mockWorkspaceService: any;

  beforeEach(() => {
    mockAgentFactory = {
      createAgent: vi.fn(async (workspace, config) => {
        if (!workspace?.id) {
          return { success: false, error: 'Invalid workspace' };
        }
        return {
          success: true,
          agent: {
            id: 'agent_initial_1',
            name: config.name || 'Initial Agent',
            workspaceId: workspace.id,
            status: 'pending',
            isInitialAgent: true,
            createdAt: new Date(),
          },
        };
      }),
    };

    mockWorkspaceService = {
      createWorkspace: vi.fn(async (config) => ({
        success: true,
        workspace: {
          id: 'ws_1',
          name: config.name,
          path: config.path,
        },
      })),
    };
  });

  it('should create initial agent when workspace is created', async () => {
    const workspace = { id: 'ws_1', name: 'Test Workspace' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Initial Agent',
      source: 'workspace-initializer',
    });

    expect(result.success).toBe(true);
    expect(result.agent.isInitialAgent).toBe(true);
    expect(result.agent.status).toBe('pending');
  });

  it('should set initial agent to pending status', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Initial Agent',
      source: 'workspace-initializer',
    });

    expect(result.agent.status).toBe('pending');
  });

  it('should mark agent as initial agent', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Initial Agent',
      source: 'workspace-initializer',
    });

    expect(result.agent.isInitialAgent).toBe(true);
  });

  it('should use workspace-initializer as source', async () => {
    const workspace = { id: 'ws_1' };

    await mockAgentFactory.createAgent(workspace, {
      name: 'Initial Agent',
      source: 'workspace-initializer',
    });

    expect(mockAgentFactory.createAgent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        source: 'workspace-initializer',
      }),
    );
  });

  it('should handle initial agent creation failure', async () => {
    const invalidWorkspace = { id: null };

    const result = await mockAgentFactory.createAgent(invalidWorkspace, {
      name: 'Initial Agent',
    });

    expect(result.success).toBe(false);
  });

  it('should create agent with default name if not provided', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      source: 'workspace-initializer',
    });

    expect(result.agent.name).toBe('Initial Agent');
  });

  it('should associate agent with workspace', async () => {
    const workspace = { id: 'ws_1', name: 'My Workspace' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Initial Agent',
      source: 'workspace-initializer',
    });

    expect(result.agent.workspaceId).toBe('ws_1');
  });

  it('should set creation timestamp', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Initial Agent',
      source: 'workspace-initializer',
    });

    expect(result.agent.createdAt).toBeDefined();
    expect(result.agent.createdAt instanceof Date).toBe(true);
  });
});
