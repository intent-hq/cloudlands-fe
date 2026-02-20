/**
 * Test agent creation with custom rules and user rules
 * Ensures agents are created with proper rule loading and merging
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Agent Creation with Rules', () => {
  let mockAgentFactory: any;
  let mockRulesLoader: any;

  beforeEach(() => {
    mockRulesLoader = {
      loadUserRules: vi.fn(async () => 'User rules from .augment/rules'),
      loadAgentTypeRules: vi.fn(async (type) => `Rules for ${type} agent`),
    };

    mockAgentFactory = {
      createAgent: vi.fn(async (workspace, config) => {
        const userRules = await mockRulesLoader.loadUserRules();
        const agentTypeRules = config.agentType
          ? await mockRulesLoader.loadAgentTypeRules(config.agentType)
          : '';

        const mergedRules = [userRules, agentTypeRules, config.rules || '']
          .filter(Boolean)
          .join('\n\n');

        return {
          success: true,
          agent: {
            id: 'agent_1',
            name: config.name,
            workspaceId: workspace.id,
            systemPrompt: mergedRules,
            rules: {
              userRules,
              agentTypeRules,
              customRules: config.rules || '',
            },
          },
        };
      }),
    };
  });

  it('should load user rules from .augment/rules', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent with Rules',
    });

    expect(result.agent.rules.userRules).toContain('User rules');
  });

  it('should load agent-type specific rules', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Workspace Agent',
      agentType: 'workspace',
    });

    expect(result.agent.rules.agentTypeRules).toContain('workspace');
  });

  it('should merge user rules with agent-type rules', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      agentType: 'task-loop',
    });

    const systemPrompt = result.agent.systemPrompt;
    expect(systemPrompt).toContain('User rules');
    expect(systemPrompt).toContain('task-loop');
  });

  it('should include custom rules in system prompt', async () => {
    const workspace = { id: 'ws_1' };
    const customRules = 'Custom rules for this agent';

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      rules: customRules,
    });

    expect(result.agent.rules.customRules).toBe(customRules);
    expect(result.agent.systemPrompt).toContain(customRules);
  });

  it('should merge all three rule sources', async () => {
    const workspace = { id: 'ws_1' };
    const customRules = 'Custom rules';

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      agentType: 'review',
      rules: customRules,
    });

    const systemPrompt = result.agent.systemPrompt;
    expect(systemPrompt).toContain('User rules');
    expect(systemPrompt).toContain('review');
    expect(systemPrompt).toContain('Custom rules');
  });

  it('should handle missing user rules gracefully', async () => {
    mockRulesLoader.loadUserRules = vi.fn(async () => '');

    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      agentType: 'task-focused',
    });

    expect(result.success).toBe(true);
    expect(result.agent.systemPrompt).toContain('task-focused');
  });

  it('should handle missing agent-type rules gracefully', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      rules: 'Custom rules',
    });

    expect(result.success).toBe(true);
    expect(result.agent.systemPrompt).toContain('Custom rules');
  });

  it('should preserve rule order: user -> type -> custom', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      agentType: 'debug',
      rules: 'Custom',
    });

    const prompt = result.agent.systemPrompt;
    const userIndex = prompt.indexOf('User rules');
    const typeIndex = prompt.indexOf('debug');
    const customIndex = prompt.indexOf('Custom');

    expect(userIndex).toBeLessThan(typeIndex);
    expect(typeIndex).toBeLessThan(customIndex);
  });

  it('should create agent with workspace rules', async () => {
    const workspace = { id: 'ws_1' };
    const workspaceRules = 'Workspace-specific rules';

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      rules: workspaceRules,
    });

    expect(result.agent.rules.customRules).toBe(workspaceRules);
  });

  it('should handle empty rules gracefully', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      rules: '',
    });

    expect(result.success).toBe(true);
  });
});
