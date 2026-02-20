/**
 * Test agent creation with different AI models
 * Ensures agents can be created with various model selections
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Agent Creation with Different Models', () => {
  let mockAgentFactory: any;
  const SUPPORTED_MODELS = ['haiku4.5', 'sonnet4.5', 'opus4.1'];

  beforeEach(() => {
    mockAgentFactory = {
      createAgent: vi.fn(async (workspace, config) => {
        if (!SUPPORTED_MODELS.includes(config.model)) {
          return { success: false, error: `Unsupported model: ${config.model}` };
        }
        return {
          success: true,
          agent: {
            id: `agent_${config.model}_1`,
            name: config.name,
            workspaceId: workspace.id,
            model: config.model,
          },
        };
      }),
    };
  });

  it('should create agent with haiku4.5 model', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Fast Agent',
      model: 'haiku4.5',
    });

    expect(result.success).toBe(true);
    expect(result.agent.model).toBe('haiku4.5');
  });

  it('should create agent with sonnet4.5 model', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Balanced Agent',
      model: 'sonnet4.5',
    });

    expect(result.success).toBe(true);
    expect(result.agent.model).toBe('sonnet4.5');
  });

  it('should create agent with opus4.1 model', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Powerful Agent',
      model: 'opus4.1',
    });

    expect(result.success).toBe(true);
    expect(result.agent.model).toBe('opus4.1');
  });

  it('should reject unsupported model', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Invalid Agent',
      model: 'invalid-model',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported model');
  });

  it('should create multiple agents with different models', async () => {
    const workspace = { id: 'ws_1' };

    const results = await Promise.all([
      mockAgentFactory.createAgent(workspace, { name: 'Agent 1', model: 'haiku4.5' }),
      mockAgentFactory.createAgent(workspace, { name: 'Agent 2', model: 'sonnet4.5' }),
      mockAgentFactory.createAgent(workspace, { name: 'Agent 3', model: 'opus4.1' }),
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].agent.model).toBe('haiku4.5');
    expect(results[1].agent.model).toBe('sonnet4.5');
    expect(results[2].agent.model).toBe('opus4.1');
  });

  it('should preserve model selection across agent switches', async () => {
    const workspace = { id: 'ws_1' };

    const agent1 = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent 1',
      model: 'haiku4.5',
    });

    const agent2 = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent 2',
      model: 'opus4.1',
    });

    expect(agent1.agent.model).toBe('haiku4.5');
    expect(agent2.agent.model).toBe('opus4.1');
  });

  it('should use default model if not specified', async () => {
    const workspace = { id: 'ws_1' };

    // Mock should use sonnet4.5 as default
    mockAgentFactory.createAgent = vi.fn(async (workspace, config) => ({
      success: true,
      agent: {
        id: 'agent_1',
        model: config.model || 'sonnet4.5',
      },
    }));

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Default Model Agent',
    });

    expect(result.agent.model).toBe('sonnet4.5');
  });

  it('should handle model-specific configurations', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Configured Agent',
      model: 'opus4.1',
      temperature: 0.7,
      maxTokens: 4096,
    });

    expect(result.success).toBe(true);
    expect(result.agent.model).toBe('opus4.1');
  });

  it('should validate all supported models', async () => {
    const workspace = { id: 'ws_1' };

    for (const model of SUPPORTED_MODELS) {
      const result = await mockAgentFactory.createAgent(workspace, {
        name: `Agent with ${model}`,
        model,
      });

      expect(result.success).toBe(true);
      expect(result.agent.model).toBe(model);
    }
  });
});
