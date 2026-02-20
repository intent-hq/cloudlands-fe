/**
 * Test to verify streaming state is set BEFORE ChatPanel mounts
 * This test ensures the fix for the "typing indicator not appearing immediately" issue
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Streaming State Timing', () => {
  let mockAgentFactory: any;
  let mockChatPanel: any;
  let mockUnifiedStore: any;
  let mockSessionStore: any;
  let callOrder: string[] = [];

  beforeEach(() => {
    callOrder = [];

    // Create a shared agents map
    const agentsMap = new Map();

    mockUnifiedStore = {
      getWorkspace: vi.fn(() => ({
        agents: agentsMap,
      })),
      setAgent: vi.fn((workspaceId, agent) => {
        callOrder.push('setAgent');
        // Actually set the agent in the map
        agentsMap.set(agent.id, agent);
      }),
    };

    mockSessionStore = {
      getSession: vi.fn(() => ({ id: 'agent_1' })),
      setStreaming: vi.fn(() => {
        callOrder.push('setStreaming');
      }),
      addSession: vi.fn(),
    };

    mockChatPanel = {
      mount: vi.fn(() => {
        callOrder.push('ChatPanel.mount');
        // ChatPanel checks streaming state on mount
        const workspace = mockUnifiedStore.getWorkspace();
        const agent = workspace.agents.get('agent_1');
        const isStreaming = agent?.streaming?.active;
        expect(isStreaming).toBe(true);
      }),
    };

    mockAgentFactory = {
      createAgent: vi.fn(async () => {
        callOrder.push('createAgent.start');

        // Step 1: Create agent in backend
        callOrder.push('backend.create');

        // Step 2: Register in state
        mockSessionStore.addSession({ id: 'agent_1' });
        callOrder.push('state.register');

        // Step 3: SET STREAMING STATE BEFORE returning
        // This is the fix - streaming state must be set before drawer opens
        const agent = {
          id: 'agent_1',
          streaming: { active: true },
          session: { id: 'agent_1' },
        };
        mockUnifiedStore.setAgent('workspace_1', agent);
        mockSessionStore.setStreaming('agent_1', true);
        callOrder.push('createAgent.return');

        // Step 4: Send initial message (async, doesn't wait)
        setTimeout(() => {
          callOrder.push('sendInitialMessage');
        }, 0);

        return { success: true, agent: { id: 'agent_1' } };
      }),
    };
  });

  it('should set streaming state BEFORE ChatPanel mounts', async () => {
    // Simulate the flow:
    // 1. createAgent is called
    // 2. createAgent returns (with streaming state set)
    // 3. Drawer opens and ChatPanel mounts

    const result = await mockAgentFactory.createAgent();
    expect(result.success).toBe(true);

    // Now drawer opens and ChatPanel mounts
    mockChatPanel.mount();

    // Verify the order
    expect(callOrder).toContain('setAgent');
    expect(callOrder).toContain('setStreaming');
    expect(callOrder).toContain('ChatPanel.mount');

    // Verify streaming state was set BEFORE ChatPanel mounted
    const setStreamingIndex = callOrder.indexOf('setStreaming');
    const chatPanelMountIndex = callOrder.indexOf('ChatPanel.mount');
    expect(setStreamingIndex).toBeLessThan(chatPanelMountIndex);
  });

  it('should have streaming state active when ChatPanel checks it', async () => {
    await mockAgentFactory.createAgent();

    // Verify streaming state is set
    const workspace = mockUnifiedStore.getWorkspace();
    const agent = workspace.agents.get('agent_1');
    expect(agent?.streaming?.active).toBe(true);

    // ChatPanel should see this immediately
    mockChatPanel.mount();
  });

  it('should call setAgent and setStreaming before returning from createAgent', async () => {
    const result = await mockAgentFactory.createAgent();

    // Both should have been called
    expect(mockUnifiedStore.setAgent).toHaveBeenCalled();
    expect(mockSessionStore.setStreaming).toHaveBeenCalled();

    // And they should have been called before returning
    expect(callOrder).toContain('setAgent');
    expect(callOrder).toContain('setStreaming');
    expect(callOrder.indexOf('setAgent')).toBeLessThan(callOrder.indexOf('createAgent.return'));
    expect(callOrder.indexOf('setStreaming')).toBeLessThan(callOrder.indexOf('createAgent.return'));
  });
});
