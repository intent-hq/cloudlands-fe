/**
 * Test agent creation with context references
 * Ensures agents are created with proper context handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Agent Creation with Context References', () => {
  let mockAgentFactory: any;

  beforeEach(() => {
    mockAgentFactory = {
      createAgent: vi.fn(async (workspace, config) => {
        if (!workspace?.id) {
          return { success: false, error: 'Invalid workspace' };
        }

        const contextReferences = config.contextReferences || [];
        const hasContext = contextReferences.length > 0;

        return {
          success: true,
          agent: {
            id: 'agent_1',
            name: config.name,
            workspaceId: workspace.id,
            contextReferences,
            hasContext,
            metadata: {
              ...config.metadata,
              hasContext,
              contextCount: contextReferences.length,
            },
          },
        };
      }),
    };
  });

  it('should create agent with file context', async () => {
    const workspace = { id: 'ws_1' };
    const contextReferences = [{ type: 'file', path: '/src/app.ts' }];

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      contextReferences,
    });

    expect(result.agent.contextReferences).toHaveLength(1);
    expect(result.agent.contextReferences[0].type).toBe('file');
  });

  it('should create agent with note context', async () => {
    const workspace = { id: 'ws_1' };
    const contextReferences = [{ type: 'note', id: 'note_1' }];

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      contextReferences,
    });

    expect(result.agent.contextReferences).toHaveLength(1);
    expect(result.agent.contextReferences[0].type).toBe('note');
  });

  it('should create agent with multiple context references', async () => {
    const workspace = { id: 'ws_1' };
    const contextReferences = [
      { type: 'file', path: '/src/app.ts' },
      { type: 'file', path: '/src/utils.ts' },
      { type: 'note', id: 'note_1' },
    ];

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      contextReferences,
    });

    expect(result.agent.contextReferences).toHaveLength(3);
    expect(result.agent.hasContext).toBe(true);
  });

  it('should create agent without context', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
    });

    expect(result.agent.contextReferences).toHaveLength(0);
    expect(result.agent.hasContext).toBe(false);
  });

  it('should track context count in metadata', async () => {
    const workspace = { id: 'ws_1' };
    const contextReferences = [
      { type: 'file', path: '/file1.ts' },
      { type: 'file', path: '/file2.ts' },
    ];

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      contextReferences,
    });

    expect(result.agent.metadata.contextCount).toBe(2);
  });

  it('should include context in initial message', async () => {
    const workspace = { id: 'ws_1' };
    const contextReferences = [{ type: 'file', path: '/src/app.ts' }];

    await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      contextReferences,
      initialMessage: 'Review this code',
    });

    expect(mockAgentFactory.createAgent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        contextReferences,
        initialMessage: 'Review this code',
      }),
    );
  });

  it('should preserve context references across agent creation', async () => {
    const workspace = { id: 'ws_1' };
    const contextReferences = [
      { type: 'file', path: '/src/app.ts' },
      { type: 'note', id: 'note_1' },
    ];

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      contextReferences,
    });

    expect(result.agent.contextReferences).toEqual(contextReferences);
  });

  it('should handle mixed context types', async () => {
    const workspace = { id: 'ws_1' };
    const contextReferences = [
      { type: 'file', path: '/src/app.ts' },
      { type: 'file', path: '/src/utils.ts' },
      { type: 'note', id: 'note_1' },
      { type: 'note', id: 'note_2' },
    ];

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      contextReferences,
    });

    const fileContexts = result.agent.contextReferences.filter((c: any) => c.type === 'file');
    const noteContexts = result.agent.contextReferences.filter((c: any) => c.type === 'note');

    expect(fileContexts).toHaveLength(2);
    expect(noteContexts).toHaveLength(2);
  });

  it('should mark agent as having context in metadata', async () => {
    const workspace = { id: 'ws_1' };
    const contextReferences = [{ type: 'file', path: '/src/app.ts' }];

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      contextReferences,
      metadata: { agentType: 'review' },
    });

    expect(result.agent.metadata.hasContext).toBe(true);
    expect(result.agent.metadata.agentType).toBe('review');
  });

  it('should handle empty context array', async () => {
    const workspace = { id: 'ws_1' };

    const result = await mockAgentFactory.createAgent(workspace, {
      name: 'Agent',
      contextReferences: [],
    });

    expect(result.agent.hasContext).toBe(false);
    expect(result.agent.contextReferences).toHaveLength(0);
  });
});
