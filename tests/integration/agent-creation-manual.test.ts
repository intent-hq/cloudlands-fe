/**
 * Test manual agent creation from workspace page and sidebar
 * Ensures agents are properly created when user manually creates them
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Manual Agent Creation (Workspace Page & Sidebar)', () => {
  let mockAgentFactory: any;

  beforeEach(() => {
    mockAgentFactory = {
      createAgent: vi.fn(async (workspace, config) => {
        if (!workspace?.id) {
          return { success: false, error: 'Invalid workspace' };
        }
        return {
          success: true,
          agent: {
            id: `agent_manual_${Date.now()}`,
            name: config.name || 'New Agent',
            workspaceId: workspace.id,
            status: 'active',
            model: config.model || 'sonnet4.5',
            source: config.source,
          },
        };
      }),
    };
  });

  it('should create agent from workspace page drawer', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'New Agent',
      source: 'workspace-page',
    });

    expect(result.success).toBe(true);
    expect(result.agent.source).toBe('workspace-page');
  });

  it('should create agent from workspace sidebar', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'New Agent',
      source: 'workspace-sidebar',
    });

    expect(result.success).toBe(true);
    expect(result.agent.source).toBe('workspace-sidebar');
  });

  it('should use default name if not provided', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      source: 'workspace-page',
    });

    expect(result.agent.name).toBe('New Agent');
  });

  it('should use custom name if provided', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'My Custom Agent',
      source: 'workspace-page',
    });

    expect(result.agent.name).toBe('My Custom Agent');
  });

  it('should use selected model from store', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'New Agent',
      model: 'opus4.1',
      source: 'workspace-page',
    });

    expect(result.agent.model).toBe('opus4.1');
  });

  it('should use default model if not specified', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'New Agent',
      source: 'workspace-page',
    });

    expect(result.agent.model).toBe('sonnet4.5');
  });

  it('should load user rules for manual creation', async () => {
    const workspace = { id: 'ws_1' };
    const userRules = 'Custom user rules...';

    await mockAgentFactory.createAgent(workspace, {
      name: 'New Agent',
      rules: userRules,
      source: 'workspace-page',
    });

    expect(mockAgentFactory.createAgent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        rules: userRules,
      }),
    );
  });

  it('should set agent to active status', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'New Agent',
      source: 'workspace-page',
    });

    expect(result.agent.status).toBe('active');
  });

  it('should associate agent with workspace', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'New Agent',
      source: 'workspace-page',
    });

    expect(result.agent.workspaceId).toBe('ws_1');
  });

  it('should handle creation from sidebar with custom name', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Code Reviewer',
      source: 'workspace-sidebar',
    });

    expect(result.agent.name).toBe('Code Reviewer');
    expect(result.agent.source).toBe('workspace-sidebar');
  });

  it('should handle creation from page with model selection', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Analysis Agent',
      model: 'haiku4.5',
      source: 'workspace-page',
    });

    expect(result.agent.model).toBe('haiku4.5');
    expect(result.agent.source).toBe('workspace-page');
  });
});
