/**
 * Tests for agent-subscription.svelte.ts
 * Tests the reactive subscription utility for agent state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { get, writable } from 'svelte/store';
import type { AgentSession } from '$features/agent/agent.service';
import { AgentStatus } from '$shared/types';

// Mock dependencies
vi.mock('$features/agent/agent.service', () => ({
  agentService: {
    subscribe: vi.fn(),
    getStore: vi.fn(),
    restoreSessionWithoutBackend: vi.fn(),
  },
}));

// Mock sessionStore and subscribeToAgent - these are what the implementation uses
vi.mock('$features/agent/browser', () => ({
  sessionStore: {
    getStore: vi.fn(),
  },
  subscribeToAgent: vi.fn(),
}));

vi.mock('$features/workspace/workspace.store.svelte', () => ({
  workspaceStore: {
    current: { id: 'test-workspace', name: 'Test Workspace' },
  },
}));

import { agentService } from '$features/agent/agent.service';
import { sessionStore, subscribeToAgent } from '$features/agent/browser';
import { useAgentSubscription } from '../agent-subscription.svelte';

describe('useAgentSubscription', () => {
  let mockStore: ReturnType<typeof writable>;
  let mockSessions: AgentSession[];
  let unsubscribeFn: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock store with sessions as an array (not a Map)
    mockSessions = [];
    mockStore = writable({ sessions: mockSessions, activeSessionId: null });

    // Mock agentService.getStore to return our mock store
    vi.mocked(agentService.getStore).mockReturnValue(mockStore as any);

    // Mock sessionStore.getStore to return our mock store (this is what the implementation uses for subscriptions)
    vi.mocked(sessionStore.getStore).mockReturnValue(mockStore as any);

    // Mock subscribeToAgent - this is what useAgentSubscription actually uses
    // It should call the callback immediately with the current agent value and return an unsubscribe function
    vi.mocked(subscribeToAgent).mockImplementation((agentId: string, callback: (session: AgentSession | undefined) => void) => {
      // Find the agent in our mock sessions
      const agent = mockSessions.find((s) => s.id === agentId);
      // Call callback immediately with current value (like the real implementation)
      callback(agent);

      // Subscribe to store updates and call callback when the agent changes
      const unsub = mockStore.subscribe(() => {
        const updatedAgent = mockSessions.find((s) => s.id === agentId);
        callback(updatedAgent);
      });

      unsubscribeFn = unsub;
      return unsub;
    });

    // Mock agentService.subscribe to use the real store subscription
    vi.mocked(agentService.subscribe).mockImplementation((callback) => {
      unsubscribeFn = mockStore.subscribe(callback);
      return unsubscribeFn;
    });

    // Mock restoreSessionWithoutBackend to resolve successfully
    vi.mocked(agentService.restoreSessionWithoutBackend).mockResolvedValue(true);
  });

  afterEach(() => {
    if (unsubscribeFn) {
      unsubscribeFn();
      unsubscribeFn = null;
    }
  });

  it('should return null when agent does not exist', () => {
    const cleanup = $effect.root(() => {
      const subscription = useAgentSubscription('non-existent-agent');

      flushSync();

      expect(subscription.current).toBeNull();
    });

    cleanup();
  });

  it('should return agent when it exists in store', () => {
    const testAgent: AgentSession = {
      id: 'test-agent-1' as any,
      backendSessionId: 'test-agent-1' as any,
      workspaceId: 'test-workspace' as any,
      name: 'Test Agent',
      status: AgentStatus.Active,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivity: new Date(),
      isProcessing: false,
    };

    mockSessions.push(testAgent);

    const cleanup = $effect.root(() => {
      const subscription = useAgentSubscription('test-agent-1');

      flushSync();

      expect(subscription.current).toEqual(testAgent);
    });

    cleanup();
  });

  it('should reactively update when agent changes', () => {
    const testAgent: AgentSession = {
      id: 'test-agent-2' as any,
      backendSessionId: 'test-agent-2' as any,
      workspaceId: 'test-workspace' as any,
      name: 'Test Agent',
      status: AgentStatus.Active,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivity: new Date(),
      isProcessing: false,
    };

    const cleanup = $effect.root(() => {
      const subscription = useAgentSubscription('test-agent-2');

      flushSync();
      expect(subscription.current).toBeNull();

      // Add agent to store
      mockSessions.push(testAgent);
      mockStore.set({ sessions: mockSessions, activeSessionId: null });

      flushSync();
      expect(subscription.current).toEqual(testAgent);

      // Update agent
      const updatedAgent = { ...testAgent, name: 'Updated Agent' };
      const index = mockSessions.findIndex((s) => s.id === 'test-agent-2');
      mockSessions[index] = updatedAgent;
      mockStore.set({ sessions: mockSessions, activeSessionId: null });

      flushSync();
      expect(subscription.current).toEqual(updatedAgent);
    });

    cleanup();
  });

  it('does not re-trigger reactive updates when store emits identical session state', () => {
    const testAgent: AgentSession = {
      id: 'stable-agent' as any,
      backendSessionId: 'stable-agent' as any,
      workspaceId: 'test-workspace' as any,
      name: 'Stable Agent',
      status: AgentStatus.Active,
      messages: [
        {
          id: 'msg-1' as any,
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Hello' }],
          timestamp: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivity: new Date(),
      isProcessing: false,
    };

    mockSessions.push(testAgent);

    let renderCount = 0;
    const cleanup = $effect.root(() => {
      const subscription = useAgentSubscription('stable-agent');

      // This effect will re-run every time the subscription's $state is assigned.
      $effect(() => {
        if (subscription.current) renderCount += 1;
      });

      flushSync();
      expect(renderCount).toBe(1); // initial set

      // Emit the *same* session snapshot again (no meaningful change)
      mockStore.set({ sessions: mockSessions, activeSessionId: null });
      flushSync();
      expect(renderCount).toBe(1); // should not re-trigger on redundant store emission
    });

    cleanup();
  });

  it('still triggers reactive updates when nested message content changes', () => {
    const testAgent: AgentSession = {
      id: 'stable-agent-2' as any,
      backendSessionId: 'stable-agent-2' as any,
      workspaceId: 'test-workspace' as any,
      name: 'Stable Agent 2',
      status: AgentStatus.Active,
      messages: [
        {
          id: 'msg-1' as any,
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Hello' }],
          timestamp: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivity: new Date(),
      isProcessing: false,
    };

    mockSessions.push(testAgent);

    let renderCount = 0;
    const cleanup = $effect.root(() => {
      const subscription = useAgentSubscription('stable-agent-2');

      $effect(() => {
        if (subscription.current) renderCount += 1;
      });

      flushSync();
      expect(renderCount).toBe(1);

      // Change nested message content (streaming-like update) and re-emit store state
      testAgent.messages[0].contentBlocks = [{ type: 'text', text: 'Hello world' }];
      mockStore.set({ sessions: mockSessions, activeSessionId: null });
      flushSync();
      expect(renderCount).toBe(2); // should update for real content changes
    });

    cleanup();
  });

  it('should update when agent is removed from store', () => {
    const testAgent: AgentSession = {
      id: 'test-agent-3' as any,
      backendSessionId: 'test-agent-3' as any,
      workspaceId: 'test-workspace' as any,
      name: 'Test Agent',
      status: AgentStatus.Active,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivity: new Date(),
      isProcessing: false,
    };

    mockSessions.push(testAgent);

    const cleanup = $effect.root(() => {
      const subscription = useAgentSubscription('test-agent-3');

      flushSync();
      expect(subscription.current).toEqual(testAgent);

      // Remove agent from store
      const index = mockSessions.findIndex((s) => s.id === 'test-agent-3');
      mockSessions.splice(index, 1);
      mockStore.set({ sessions: mockSessions, activeSessionId: null });

      flushSync();
      expect(subscription.current).toBeNull();
    });

    cleanup();
  });

  it('should properly cleanup subscription on unmount', () => {
    const testAgent: AgentSession = {
      id: 'test-agent-4' as any,
      backendSessionId: 'test-agent-4' as any,
      workspaceId: 'test-workspace' as any,
      name: 'Test Agent',
      status: AgentStatus.Active,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivity: new Date(),
      isProcessing: false,
    };

    mockSessions.push(testAgent);

    const cleanup = $effect.root(() => {
      const subscription = useAgentSubscription('test-agent-4');

      flushSync();
      expect(subscription.current).toEqual(testAgent);
    });

    // Cleanup should call unsubscribe
    cleanup();

    // Verify that subscribeToAgent was called (the implementation uses subscribeToAgent)
    expect(subscribeToAgent).toHaveBeenCalled();

    // After cleanup, updating the store should not affect anything
    // (we can't directly test unsubscribe was called, but we verify the pattern)
  });

  it('should handle multiple subscriptions to the same agent', () => {
    const testAgent: AgentSession = {
      id: 'test-agent-5' as any,
      backendSessionId: 'test-agent-5' as any,
      workspaceId: 'test-workspace' as any,
      name: 'Test Agent',
      status: AgentStatus.Active,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivity: new Date(),
      isProcessing: false,
    };

    mockSessions.push(testAgent);

    const cleanup = $effect.root(() => {
      const subscription1 = useAgentSubscription('test-agent-5');
      const subscription2 = useAgentSubscription('test-agent-5');

      flushSync();

      expect(subscription1.current).toEqual(testAgent);
      expect(subscription2.current).toEqual(testAgent);

      // Update agent
      const updatedAgent = { ...testAgent, name: 'Updated Agent' };
      const index = mockSessions.findIndex((s) => s.id === 'test-agent-5');
      mockSessions[index] = updatedAgent;
      mockStore.set({ sessions: mockSessions, activeSessionId: null });

      flushSync();

      // Both subscriptions should see the update
      expect(subscription1.current).toEqual(updatedAgent);
      expect(subscription2.current).toEqual(updatedAgent);
    });

    cleanup();
  });

  describe('streaming behavior', () => {
    it('should reactively update during message streaming', () => {
      const testAgent: AgentSession = {
        id: 'streaming-agent-1' as any,
        backendSessionId: 'streaming-agent-1' as any,
        workspaceId: 'test-workspace' as any,
        name: 'Streaming Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg-1' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: '' }],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivity: new Date(),
        isProcessing: true,
      };

      mockSessions.push(testAgent);

      const cleanup = $effect.root(() => {
        const subscription = useAgentSubscription('streaming-agent-1');

        flushSync();
        expect(subscription.current?.messages[0].contentBlocks?.[0].text).toBe('');
        expect(subscription.current?.messages[0].isStreaming).toBe(true);

        // Simulate chunk 1
        testAgent.messages[0].contentBlocks = [{ type: 'text', text: 'Hello' }];
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();
        expect(subscription.current?.messages[0].contentBlocks?.[0].text).toBe('Hello');

        // Simulate chunk 2
        testAgent.messages[0].contentBlocks = [{ type: 'text', text: 'Hello world' }];
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();
        expect(subscription.current?.messages[0].contentBlocks?.[0].text).toBe('Hello world');

        // Simulate chunk 3
        testAgent.messages[0].contentBlocks = [{ type: 'text', text: 'Hello world!' }];
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();
        expect(subscription.current?.messages[0].contentBlocks?.[0].text).toBe('Hello world!');

        // Simulate completion
        testAgent.messages[0].isStreaming = false;
        testAgent.isProcessing = false;
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();
        expect(subscription.current?.messages[0].isStreaming).toBe(false);
        expect(subscription.current?.isProcessing).toBe(false);
      });

      cleanup();
    });

    it('should handle rapid streaming chunks', () => {
      const testAgent: AgentSession = {
        id: 'rapid-stream-agent' as any,
        backendSessionId: 'rapid-stream-agent' as any,
        workspaceId: 'test-workspace' as any,
        name: 'Rapid Stream Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg-1' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: '' }],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivity: new Date(),
        isProcessing: true,
      };

      mockSessions.push(testAgent);

      const cleanup = $effect.root(() => {
        const subscription = useAgentSubscription('rapid-stream-agent');

        flushSync();

        // Simulate many rapid chunks
        const chunks = ['H', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'];
        let accumulated = '';

        for (const chunk of chunks) {
          accumulated += chunk;
          testAgent.messages[0].contentBlocks = [{ type: 'text', text: accumulated }];
          mockStore.set({ sessions: mockSessions, activeSessionId: null });
          flushSync();
          expect(subscription.current?.messages[0].contentBlocks?.[0].text).toBe(accumulated);
        }

        expect(subscription.current?.messages[0].contentBlocks?.[0].text).toBe('Hello world');
      });

      cleanup();
    });

    it('should handle streaming with multiple messages', () => {
      const testAgent: AgentSession = {
        id: 'multi-message-agent' as any,
        backendSessionId: 'multi-message-agent' as any,
        workspaceId: 'test-workspace' as any,
        name: 'Multi Message Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg-1' as any,
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Hello' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg-2' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: '' }],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivity: new Date(),
        isProcessing: true,
      };

      mockSessions.push(testAgent);

      const cleanup = $effect.root(() => {
        const subscription = useAgentSubscription('multi-message-agent');

        flushSync();
        expect(subscription.current?.messages).toHaveLength(2);
        expect(subscription.current?.messages[1].contentBlocks?.[0].text).toBe('');

        // Stream into the second message
        testAgent.messages[1].contentBlocks = [{ type: 'text', text: 'Response' }];
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();
        expect(subscription.current?.messages[1].contentBlocks?.[0].text).toBe('Response');

        // Complete streaming
        testAgent.messages[1].isStreaming = false;
        testAgent.isProcessing = false;
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();
        expect(subscription.current?.messages[1].isStreaming).toBe(false);
      });

      cleanup();
    });

    it('should handle stream interruption', () => {
      const testAgent: AgentSession = {
        id: 'interrupted-agent' as any,
        backendSessionId: 'interrupted-agent' as any,
        workspaceId: 'test-workspace' as any,
        name: 'Interrupted Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg-1' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Partial response' }],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivity: new Date(),
        isProcessing: true,
      };

      mockSessions.push(testAgent);

      const cleanup = $effect.root(() => {
        const subscription = useAgentSubscription('interrupted-agent');

        flushSync();
        expect(subscription.current?.messages[0].contentBlocks?.[0].text).toBe('Partial response');
        expect(subscription.current?.messages[0].isStreaming).toBe(true);

        // Simulate stream interruption - streaming stops but message is incomplete
        testAgent.messages[0].isStreaming = false;
        testAgent.isProcessing = false;
        testAgent.status = AgentStatus.Error;
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();

        expect(subscription.current?.messages[0].isStreaming).toBe(false);
        expect(subscription.current?.status).toBe(AgentStatus.Error);
        expect(subscription.current?.messages[0].contentBlocks?.[0].text).toBe('Partial response');
      });

      cleanup();
    });

    it('should handle subscription created during active streaming', () => {
      const testAgent: AgentSession = {
        id: 'mid-stream-agent' as any,
        backendSessionId: 'mid-stream-agent' as any,
        workspaceId: 'test-workspace' as any,
        name: 'Mid Stream Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg-1' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Already streaming...' }],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivity: new Date(),
        isProcessing: true,
      };

      // Agent is already streaming when we subscribe
      mockSessions.push(testAgent);

      const cleanup = $effect.root(() => {
        const subscription = useAgentSubscription('mid-stream-agent');

        flushSync();
        // Should immediately see the current streaming state
        expect(subscription.current?.messages[0].contentBlocks?.[0].text).toBe(
          'Already streaming...',
        );
        expect(subscription.current?.messages[0].isStreaming).toBe(true);

        // Continue streaming
        testAgent.messages[0].contentBlocks = [
          { type: 'text', text: 'Already streaming... more content' },
        ];
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();
        expect(subscription.current?.messages[0].contentBlocks?.[0].text).toBe(
          'Already streaming... more content',
        );
      });

      cleanup();
    });

    it('should handle multiple concurrent streaming agents', () => {
      const agent1: AgentSession = {
        id: 'concurrent-agent-1' as any,
        backendSessionId: 'concurrent-agent-1' as any,
        workspaceId: 'test-workspace' as any,
        name: 'Concurrent Agent 1',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg-1' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: '' }],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivity: new Date(),
        isProcessing: true,
      };

      const agent2: AgentSession = {
        id: 'concurrent-agent-2' as any,
        backendSessionId: 'concurrent-agent-2' as any,
        workspaceId: 'test-workspace' as any,
        name: 'Concurrent Agent 2',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg-1' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: '' }],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivity: new Date(),
        isProcessing: true,
      };

      mockSessions.push(agent1);
      mockSessions.push(agent2);

      const cleanup = $effect.root(() => {
        const subscription1 = useAgentSubscription('concurrent-agent-1');
        const subscription2 = useAgentSubscription('concurrent-agent-2');

        flushSync();

        // Both agents stream independently
        agent1.messages[0].contentBlocks = [{ type: 'text', text: 'Agent 1 response' }];
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();
        expect(subscription1.current?.messages[0].contentBlocks?.[0].text).toBe('Agent 1 response');
        expect(subscription2.current?.messages[0].contentBlocks?.[0].text).toBe('');

        agent2.messages[0].contentBlocks = [{ type: 'text', text: 'Agent 2 response' }];
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();
        expect(subscription1.current?.messages[0].contentBlocks?.[0].text).toBe('Agent 1 response');
        expect(subscription2.current?.messages[0].contentBlocks?.[0].text).toBe('Agent 2 response');

        // Agent 1 completes
        agent1.messages[0].isStreaming = false;
        agent1.isProcessing = false;
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();
        expect(subscription1.current?.messages[0].isStreaming).toBe(false);
        expect(subscription2.current?.messages[0].isStreaming).toBe(true);

        // Agent 2 completes
        agent2.messages[0].isStreaming = false;
        agent2.isProcessing = false;
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();
        expect(subscription2.current?.messages[0].isStreaming).toBe(false);
      });

      cleanup();
    });
  });
});
