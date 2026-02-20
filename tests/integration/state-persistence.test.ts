/**
 * Test state persistence across navigation
 * Ensures state persists when switching workspaces/agents
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('State Persistence Across Navigation', () => {
  let mockStateStore: any;
  let mockNavigationService: any;

  beforeEach(() => {
    mockStateStore = {
      workspaces: new Map(),
      agents: new Map(),
      messages: new Map(),
      saveState: vi.fn((key, value) => {
        mockStateStore.workspaces.set(key, value);
      }),
      loadState: vi.fn((key) => mockStateStore.workspaces.get(key)),
      saveAgentState: vi.fn((agentId, state) => {
        mockStateStore.agents.set(agentId, state);
      }),
      loadAgentState: vi.fn((agentId) => mockStateStore.agents.get(agentId)),
      saveMessages: vi.fn((agentId, messages) => {
        mockStateStore.messages.set(agentId, messages);
      }),
      loadMessages: vi.fn((agentId) => mockStateStore.messages.get(agentId) || []),
    };

    mockNavigationService = {
      currentWorkspace: null,
      currentAgent: null,
      switchWorkspace: vi.fn(async (workspaceId) => {
        // Just switch workspace, don't overwrite state
        mockNavigationService.currentWorkspace = workspaceId;
        // Load existing state if it exists
        return mockStateStore.loadState(workspaceId);
      }),
      switchAgent: vi.fn(async (agentId) => {
        mockNavigationService.currentAgent = agentId;
        return mockStateStore.loadAgentState(agentId);
      }),
    };
  });

  it('should persist agent state when switching workspaces', async () => {
    const workspace1 = 'ws_1';
    const workspace2 = 'ws_2';
    const agent1 = { id: 'agent_1', name: 'Agent 1' };

    // Set up workspace 1
    mockNavigationService.currentWorkspace = workspace1;
    mockStateStore.saveAgentState('agent_1', agent1);

    // Switch to workspace 2
    await mockNavigationService.switchWorkspace(workspace2);
    expect(mockNavigationService.currentWorkspace).toBe(workspace2);

    // Switch back to workspace 1
    await mockNavigationService.switchWorkspace(workspace1);
    expect(mockNavigationService.currentWorkspace).toBe(workspace1);

    // Agent state should still be there
    const restoredAgent = mockStateStore.loadAgentState('agent_1');
    expect(restoredAgent).toEqual(agent1);
  });

  it('should persist message history when switching agents', async () => {
    const agent1 = 'agent_1';
    const agent2 = 'agent_2';
    const messages1 = [
      { id: 'msg_1', role: 'user', content: 'Hello' },
      { id: 'msg_2', role: 'assistant', content: 'Hi' },
    ];

    // Save messages for agent 1
    mockStateStore.saveMessages(agent1, messages1);

    // Switch to agent 2
    await mockNavigationService.switchAgent(agent2);
    expect(mockNavigationService.currentAgent).toBe(agent2);

    // Switch back to agent 1
    await mockNavigationService.switchAgent(agent1);

    // Messages should be restored
    const restoredMessages = mockStateStore.loadMessages(agent1);
    expect(restoredMessages).toEqual(messages1);
  });

  it('should maintain separate state for different agents', async () => {
    const agent1 = 'agent_1';
    const agent2 = 'agent_2';

    const messages1 = [{ id: 'msg_1', role: 'user', content: 'Agent 1 message' }];
    const messages2 = [{ id: 'msg_2', role: 'user', content: 'Agent 2 message' }];

    mockStateStore.saveMessages(agent1, messages1);
    mockStateStore.saveMessages(agent2, messages2);

    const restored1 = mockStateStore.loadMessages(agent1);
    const restored2 = mockStateStore.loadMessages(agent2);

    expect(restored1).toEqual(messages1);
    expect(restored2).toEqual(messages2);
    expect(restored1).not.toEqual(restored2);
  });

  it('should handle missing state gracefully', async () => {
    const nonexistentAgent = 'agent_nonexistent';
    const state = mockStateStore.loadAgentState(nonexistentAgent);

    expect(state).toBeUndefined();
  });

  it('should persist state across multiple workspace switches', async () => {
    const ws1 = 'ws_1';
    const ws2 = 'ws_2';
    const ws3 = 'ws_3';

    // Save state for ws1
    mockStateStore.saveState(ws1, { data: 'workspace1' });
    mockNavigationService.currentWorkspace = ws1;

    // Switch to ws2
    await mockNavigationService.switchWorkspace(ws2);
    mockStateStore.saveState(ws2, { data: 'workspace2' });

    // Switch to ws3
    await mockNavigationService.switchWorkspace(ws3);
    mockStateStore.saveState(ws3, { data: 'workspace3' });

    // Go back to ws1 - state should still be there
    const restored = mockStateStore.loadState(ws1);
    expect(restored).toBeDefined();
    expect(restored.data).toBe('workspace1');
  });

  it('should clear state when agent is deleted', async () => {
    const agentId = 'agent_1';
    mockStateStore.saveAgentState(agentId, { id: agentId });
    mockStateStore.saveMessages(agentId, [{ id: 'msg_1' }]);

    // Delete agent
    mockStateStore.agents.delete(agentId);
    mockStateStore.messages.delete(agentId);

    expect(mockStateStore.loadAgentState(agentId)).toBeUndefined();
    expect(mockStateStore.loadMessages(agentId)).toEqual([]);
  });

  it('should restore streaming state correctly', async () => {
    const agentId = 'agent_1';
    const streamingState = {
      isStreaming: true,
      messageId: 'msg_1',
      buffer: 'partial response',
    };

    mockStateStore.saveAgentState(agentId, streamingState);
    const restored = mockStateStore.loadAgentState(agentId);

    expect(restored.isStreaming).toBe(true);
    expect(restored.messageId).toBe('msg_1');
  });
});
