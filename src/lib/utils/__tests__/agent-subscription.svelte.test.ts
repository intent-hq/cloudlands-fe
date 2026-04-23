/**
 * Tests for agent-subscription.svelte.ts
 * Tests the reactive subscription utility for agent state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { writable } from 'svelte/store';
import type { AgentSession } from '$features/agent/agent-ipc-bridge';
import { AgentStatus } from '$shared/types';
import { createCollection } from '$lib/store/utils/collection-utils';

// Production code stores messages as a Collection<AgentMessage, 'id'> inside
// the agent-session slice. Tests that synthesize slice state directly must
// match that shape, otherwise selectors like `getItems(stored.messages)` blow
// up trying to iterate `collection.ids`.
function toStoredSession(session: any) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  return { ...session, messages: createCollection<any, 'id'>('id', messages) };
}

const mockDiskAgents = vi.hoisted(() => ({
  agents: [] as Array<{ id: string; name?: string }>,
}));

const agentServiceMocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  getStore: vi.fn(),
  getSession: vi.fn(),
  restoreSessionWithoutBackend: vi.fn(),
}));

const browserMocks = vi.hoisted(() => ({
  subscribeToAgent: vi.fn(),
}));

const workspaceMocks = vi.hoisted(() => ({
  getReduxStore: vi.fn(),
  selectCurrentWorkspace: vi.fn(),
  selectWorkspaceById: vi.fn(),
  state: {
    current: { id: 'test-workspace', name: 'Test Workspace' },
    byId: {
      'test-workspace': { id: 'test-workspace', name: 'Test Workspace' },
    } as Record<string, { id: string; name: string }>,
    workspaceAgents: { byWorkspaceId: {} as Record<string, any> },
  },
  listeners: new Set<() => void>(),
}));

// Mock dependencies
vi.mock('$features/agent/agent-ipc-bridge', () => ({
  agentService: agentServiceMocks,
}));

// Mock subscribeToAgent - this is what the implementation uses
vi.mock('$features/agent/browser', () => ({
  subscribeToAgent: browserMocks.subscribeToAgent,
}));

vi.mock('$lib/utils/agent-loader', () => ({
  getStoredAgentsFromDisk: vi.fn(async () => mockDiskAgents.agents),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: workspaceMocks.getReduxStore,
}));

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectCurrentWorkspace: { select: workspaceMocks.selectCurrentWorkspace },
  selectWorkspaceById: { select: workspaceMocks.selectWorkspaceById },
}));

import { agentService } from '$features/agent/agent-ipc-bridge';
import { subscribeToAgent } from '$features/agent/browser';
import { useAgentSubscription, useAllAgentsSubscription } from '../agent-subscription.svelte';

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

    workspaceMocks.state.current = { id: 'test-workspace', name: 'Test Workspace' };
    workspaceMocks.state.byId = {
      'test-workspace': { id: 'test-workspace', name: 'Test Workspace' },
    };
    workspaceMocks.listeners.clear();
    workspaceMocks.getReduxStore.mockReturnValue({
      getState: () => workspaceMocks.state,
      subscribe: (listener: () => void) => {
        workspaceMocks.listeners.add(listener);
        return () => {
          workspaceMocks.listeners.delete(listener);
        };
      },
    });
    workspaceMocks.selectCurrentWorkspace.mockImplementation((state: any) => state.current);
    workspaceMocks.selectWorkspaceById.mockImplementation((state: any, id: string) => state.byId[id]);
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

    it('should isolate streaming between agents in different workspaces', () => {
      // Regression: streaming updates for workspace-B agent must not leak into
      // a subscription for a workspace-A agent.
      const agentA: AgentSession = {
        id: 'ws-a-agent' as any,
        backendSessionId: 'ws-a-agent' as any,
        workspaceId: 'workspace-A' as any,
        name: 'Workspace A Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg-a' as any,
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

      const agentB: AgentSession = {
        id: 'ws-b-agent' as any,
        backendSessionId: 'ws-b-agent' as any,
        workspaceId: 'workspace-B' as any,
        name: 'Workspace B Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg-b' as any,
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

      mockSessions.push(agentA);
      mockSessions.push(agentB);

      const cleanup = $effect.root(() => {
        const subA = useAgentSubscription('ws-a-agent');
        const subB = useAgentSubscription('ws-b-agent');

        flushSync();

        // Stream into workspace-B agent only
        agentB.messages[0].contentBlocks = [{ type: 'text', text: 'B streaming text' }];
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();

        // Workspace-A subscription must NOT pick up workspace-B content
        expect(subA.current?.messages[0].contentBlocks?.[0].text).toBe('');
        expect(subA.current?.workspaceId).toBe('workspace-A');
        // Workspace-B subscription sees its own content
        expect(subB.current?.messages[0].contentBlocks?.[0].text).toBe('B streaming text');
        expect(subB.current?.workspaceId).toBe('workspace-B');

        // Now stream into workspace-A agent
        agentA.messages[0].contentBlocks = [{ type: 'text', text: 'A streaming text' }];
        mockStore.set({ sessions: mockSessions, activeSessionId: null });
        flushSync();

        // Each subscription sees only its own agent's content
        expect(subA.current?.messages[0].contentBlocks?.[0].text).toBe('A streaming text');
        expect(subB.current?.messages[0].contentBlocks?.[0].text).toBe('B streaming text');
      });

      cleanup();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useAllAgentsSubscription – cross-workspace isolation
// ═══════════════════════════════════════════════════════════════════════════════

describe('useAllAgentsSubscription – workspace isolation', () => {
  let mockStore: ReturnType<typeof writable>;
  let mockSessions: AgentSession[];

  // Helper to build workspaceAgents + agentSessions Redux state from mockSessions
  function buildWorkspaceAgentsState() {
    const byWorkspaceId: Record<string, any> = {};
    for (const session of mockSessions) {
      const wsId = String(session.workspaceId);
      if (!byWorkspaceId[wsId]) {
        byWorkspaceId[wsId] = { agentIds: [] as string[] };
      }
      const ws = byWorkspaceId[wsId];
      if (!ws.agentIds.includes(session.id)) ws.agentIds.push(session.id);
    }
    return byWorkspaceId;
  }

  function buildAgentSessionsState() {
    const byAgentId: Record<string, any> = {};
    const agentIdsByWorkspace: Record<string, string[]> = {};
    for (const session of mockSessions) {
      byAgentId[session.id] = toStoredSession(session);
      const wsId = String(session.workspaceId);
      if (!agentIdsByWorkspace[wsId]) agentIdsByWorkspace[wsId] = [];
      if (!agentIdsByWorkspace[wsId].includes(session.id)) agentIdsByWorkspace[wsId].push(session.id);
    }
    return { byAgentId, agentIdsByWorkspace };
  }


  beforeEach(() => {
    vi.clearAllMocks();

    mockSessions = [];
    mockDiskAgents.agents = [];
    mockStore = writable({ sessions: mockSessions, activeSessionId: null });

    // Add workspace entries for workspace isolation tests
    workspaceMocks.state.byId = {
      'test-workspace': { id: 'test-workspace', name: 'Test Workspace' },
      'workspace-A': { id: 'workspace-A', name: 'Workspace A' },
      'workspace-B': { id: 'workspace-B', name: 'Workspace B' },
    };
    workspaceMocks.selectWorkspaceById.mockImplementation((state: any, id: string) => state.byId[id]);
    // Reset Redux state - getState dynamically builds from mockSessions
    workspaceMocks.listeners.clear();
    workspaceMocks.getReduxStore.mockReturnValue({
      getState: () => ({
        ...workspaceMocks.state,
        workspaceAgents: { byWorkspaceId: buildWorkspaceAgentsState() },
        agentSessions: buildAgentSessionsState(),
      }),
      subscribe: (listener: () => void) => {
        workspaceMocks.listeners.add(listener);
        return () => { workspaceMocks.listeners.delete(listener); };
      },
    });

    vi.mocked(agentService.restoreSessionWithoutBackend).mockResolvedValue(true);
  });

  function makeAgent(id: string, workspaceId: string, overrides: Partial<AgentSession> = {}): AgentSession {
    return {
      id: id as any,
      backendSessionId: id as any,
      workspaceId: workspaceId as any,
      name: `Agent ${id}`,
      status: AgentStatus.Active,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivity: new Date(),
      isProcessing: false,
      ...overrides,
    };
  }

  it('current getter filters agents by workspaceId', () => {
    const agentA = makeAgent('agent-a', 'workspace-A');
    const agentB = makeAgent('agent-b', 'workspace-B');
    const agentA2 = makeAgent('agent-a2', 'workspace-A');
    mockSessions.push(agentA, agentB, agentA2);

    const cleanup = $effect.root(() => {
      const sub = useAllAgentsSubscription('workspace-A');

      flushSync();

      // .current should only contain workspace-A agents
      const currentIds = sub.current.map((s: AgentSession) => s.id);
      expect(currentIds).toContain('agent-a');
      expect(currentIds).toContain('agent-a2');
      expect(currentIds).not.toContain('agent-b');

      // .all should contain everything
      expect(sub.all).toHaveLength(3);
    });

    cleanup();
  });

  it('re-publishes existing sessions with the requested workspaceId', async () => {
    const existingSession = makeAgent('agent-a', 'stale-workspace');
    mockDiskAgents.agents.splice(0, mockDiskAgents.agents.length, {
      id: 'agent-a',
      name: existingSession.name,
    });

    // Put the existing agent into the Redux mock state so selectAgentById finds it
    const byWorkspaceId = buildWorkspaceAgentsState();
    // Add the agent under test-workspace (existing in Redux with stale workspaceId)
    byWorkspaceId['test-workspace'] = {
      agentIds: ['agent-a'],
    };

    // Also add to agentSessions
    const agentSessionsState = buildAgentSessionsState();
    agentSessionsState.byAgentId['agent-a'] = toStoredSession(existingSession);
    if (!agentSessionsState.agentIdsByWorkspace['test-workspace']) {
      agentSessionsState.agentIdsByWorkspace['test-workspace'] = [];
    }
    if (!agentSessionsState.agentIdsByWorkspace['test-workspace'].includes('agent-a')) {
      agentSessionsState.agentIdsByWorkspace['test-workspace'].push('agent-a');
    }

    const mockDispatch = vi.fn();
    workspaceMocks.getReduxStore.mockReturnValue({
      getState: () => ({
        ...workspaceMocks.state,
        workspaceAgents: { byWorkspaceId },
        agentSessions: agentSessionsState,
      }),
      subscribe: (listener: () => void) => {
        workspaceMocks.listeners.add(listener);
        return () => { workspaceMocks.listeners.delete(listener); };
      },
      dispatch: mockDispatch,
    });

    const cleanup = $effect.root(() => {
      useAllAgentsSubscription('test-workspace');
    });

    flushSync();
    await vi.waitFor(() => {
      // Now expects Redux dispatch with upsertAgentSession instead of addSessionForWorkspace
      expect(mockDispatch).toHaveBeenCalled();
    });
    // Should NOT fall back to restoreSessionWithoutBackend since agent exists in Redux
    expect(agentService.restoreSessionWithoutBackend).not.toHaveBeenCalled();

    cleanup();
  });

  it('streaming updates in workspace-B do not appear in workspace-A current list', () => {
    const agentA = makeAgent('agent-a', 'workspace-A', {
      messages: [
        {
          id: 'msg-a' as any,
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'A initial' }],
          timestamp: new Date().toISOString(),
        },
      ],
    });
    const agentB = makeAgent('agent-b', 'workspace-B', {
      isProcessing: true,
      messages: [
        {
          id: 'msg-b' as any,
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: '' }],
          timestamp: new Date().toISOString(),
          isStreaming: true,
        },
      ],
    });
    mockSessions.push(agentA, agentB);

    const cleanup = $effect.root(() => {
      const subA = useAllAgentsSubscription('workspace-A');

      flushSync();

      // Simulate streaming into workspace-B agent
      agentB.messages[0].contentBlocks = [{ type: 'text', text: 'B streaming content' }];
      mockStore.set({ sessions: mockSessions, activeSessionId: null });
      flushSync();

      // workspace-A current list must NOT contain workspace-B agent
      const currentA = subA.current;
      expect(currentA).toHaveLength(1);
      expect(currentA[0].id).toBe('agent-a');
      // workspace-A agent content is unchanged
      expect(currentA[0].messages[0].contentBlocks?.[0].text).toBe('A initial');
    });

    cleanup();
  });

  it('workspace getter function re-evaluates filtering dynamically', () => {
    const agentA = makeAgent('agent-a', 'workspace-A');
    const agentB = makeAgent('agent-b', 'workspace-B');
    mockSessions.push(agentA, agentB);

    // Use $state so the $derived resolvedWsId inside useAllAgentsSubscription
    // re-evaluates when we change the workspace.
    let activeWorkspace = $state('workspace-A');

    const cleanup = $effect.root(() => {
      // Pass a getter so filtering is dynamic
      const sub = useAllAgentsSubscription(() => activeWorkspace);

      flushSync();

      expect(sub.current.map((s: AgentSession) => s.id)).toEqual(['agent-a']);

      // Switch workspace — $state assignment triggers $derived re-evaluation
      activeWorkspace = 'workspace-B';
      // Re-trigger store to force re-evaluation
      mockStore.set({ sessions: mockSessions, activeSessionId: null });
      flushSync();

      expect(sub.current.map((s: AgentSession) => s.id)).toEqual(['agent-b']);
    });

    cleanup();
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// useAllAgentsSubscription – loading state during session recovery
// ═══════════════════════════════════════════════════════════════════════════════

describe('useAllAgentsSubscription – loading state', () => {
  let mockStore: ReturnType<typeof writable>;
  let mockSessions: AgentSession[];

  beforeEach(() => {
    vi.clearAllMocks();

    mockSessions = [];
    mockStore = writable({ sessions: mockSessions, activeSessionId: null });

    vi.mocked(agentService.restoreSessionWithoutBackend).mockResolvedValue(true);

    // Build workspace agents state dynamically from mockSessions
    function buildWsAgentsState() {
      const byWorkspaceId: Record<string, any> = {};
      for (const session of mockSessions) {
        const wsId = String(session.workspaceId);
        if (!byWorkspaceId[wsId]) {
          byWorkspaceId[wsId] = { agentIds: [] as string[] };
        }
        const ws = byWorkspaceId[wsId];
        if (!ws.agentIds.includes(session.id)) ws.agentIds.push(session.id);
      }
      return byWorkspaceId;
    }
    function buildAgentSessionsState2() {
      const byAgentId: Record<string, any> = {};
      const agentIdsByWorkspace: Record<string, string[]> = {};
      for (const session of mockSessions) {
        byAgentId[session.id] = toStoredSession(session);
        const wsId = String(session.workspaceId);
        if (!agentIdsByWorkspace[wsId]) agentIdsByWorkspace[wsId] = [];
        if (!agentIdsByWorkspace[wsId].includes(session.id)) agentIdsByWorkspace[wsId].push(session.id);
      }
      return { byAgentId, agentIdsByWorkspace };
    }
    workspaceMocks.state.byId = {
      'test-workspace': { id: 'test-workspace', name: 'Test Workspace' },
      'ws-1': { id: 'ws-1', name: 'Workspace 1' },
      'ws-2': { id: 'ws-2', name: 'Workspace 2' },
      'some-workspace': { id: 'some-workspace', name: 'Some Workspace' },
    };
    workspaceMocks.selectWorkspaceById.mockImplementation((state: any, id: string) => state.byId[id]);
    workspaceMocks.listeners.clear();
    workspaceMocks.getReduxStore.mockReturnValue({
      getState: () => ({
        ...workspaceMocks.state,
        workspaceAgents: { byWorkspaceId: buildWsAgentsState() },
        agentSessions: buildAgentSessionsState2(),
      }),
      subscribe: (listener: () => void) => {
        workspaceMocks.listeners.add(listener);
        return () => {
          workspaceMocks.listeners.delete(listener);
        };
      },
    });
  });

  function makeAgent(id: string, workspaceId: string): AgentSession {
    return {
      id: id as any,
      backendSessionId: id as any,
      workspaceId: workspaceId as any,
      name: `Agent ${id}`,
      status: AgentStatus.Active,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivity: new Date(),
      isProcessing: false,
    };
  }

  /** Helper to put agents into mockSessions (which getState() builds from dynamically) */
  function addAgentsToReduxState(_workspaceId: string, agents: AgentSession[]) {
    for (const a of agents) {
      const idx = mockSessions.findIndex(s => s.id === a.id);
      if (idx === -1) mockSessions.push(a);
      else mockSessions[idx] = a;
    }
  }

  it('loading starts true when workspaceId is provided and store is empty', () => {
    // Simulate session recovery: store is empty initially
    const cleanup = $effect.root(() => {
      const sub = useAllAgentsSubscription('test-workspace');

      flushSync();

      // loading should be true because we haven't confirmed agents yet
      expect(sub.loading).toBe(true);
      // current should be empty
      expect(sub.current).toHaveLength(0);
    });

    cleanup();
  });

  it('loading becomes false when agents exist in store', () => {
    // Simulate normal state: agents already exist in Redux
    const agent = makeAgent('agent-1', 'test-workspace');
    addAgentsToReduxState('test-workspace', [agent]);

    const cleanup = $effect.root(() => {
      const sub = useAllAgentsSubscription('test-workspace');

      flushSync();

      // loading should become false because agents exist
      expect(sub.loading).toBe(false);
      expect(sub.current).toHaveLength(1);
    });

    cleanup();
  });

  it('loading is false when no workspaceId is provided', () => {
    // Without workspaceId, we don't need to show loading
    const cleanup = $effect.root(() => {
      const sub = useAllAgentsSubscription();

      flushSync();

      // loading should be false since no workspace filtering needed
      expect(sub.loading).toBe(false);
    });

    cleanup();
  });

  it('prevents "No agents yet" flash during session recovery', () => {
    // This is the key regression test for the bug fix.
    // During session recovery, the store may briefly be empty.
    // The sidebar should show skeleton loader, NOT "No agents yet".

    // Start with empty store (simulates recovery state)
    const cleanup = $effect.root(() => {
      const sub = useAllAgentsSubscription('test-workspace');

      flushSync();

      // At this point, we should be in loading state
      // UI should show skeleton loader because:
      // - loading is true (prevents "No agents yet")
      // - current is empty (no agents to render)
      expect(sub.loading).toBe(true);
      expect(sub.current).toHaveLength(0);

      // When loading=true AND current.length=0, UI shows skeleton (correct)
      // Previously, loading would start as false, causing "No agents yet" flash
    });

    cleanup();
  });

  it('loading transitions to true when workspace changes to one without agents', () => {
    // ws-1 has agents in Redux, ws-2 does not
    const agent = makeAgent('agent-1', 'ws-1');
    addAgentsToReduxState('ws-1', [agent]);

    const cleanup = $effect.root(() => {
      // First subscription: ws-1 has agents
      const sub1 = useAllAgentsSubscription('ws-1');
      flushSync();
      expect(sub1.loading).toBe(false);
      expect(sub1.current).toHaveLength(1);

      // Second subscription: ws-2 has no agents — loading should be true
      const sub2 = useAllAgentsSubscription('ws-2');
      flushSync();
      expect(sub2.loading).toBe(true);
      expect(sub2.current).toHaveLength(0);
    });

    cleanup();
  });

  it('loading starts false when no workspaceId and stays consistent', () => {
    // When workspaceId starts undefined, loading should be false.
    // This verifies the initial state is correct for the no-workspace case.
    const cleanup = $effect.root(() => {
      const sub = useAllAgentsSubscription(undefined);
      flushSync();
      expect(sub.loading).toBe(false);

      // Adding agents to Redux state shouldn't change loading state for undefined workspace
      const agent = makeAgent('agent-1', 'some-workspace');
      addAgentsToReduxState('some-workspace', [agent]);
      // Notify subscribers of state change
      for (const listener of workspaceMocks.listeners) listener();
      flushSync();
      expect(sub.loading).toBe(false);
    });

    cleanup();
  });

  it('loading does not stay stuck true when getter always returns undefined', () => {
    // Regression: when workspaceId is a getter that resolves to undefined,
    // isLoading was initialized to true (function source) but the workspace-change
    // effect never fired because resolvedWsId and lastCheckedWorkspaceId both
    // started as undefined. This left loading stuck true indefinitely.
    const cleanup = $effect.root(() => {
      const sub = useAllAgentsSubscription(() => undefined);
      flushSync();
      // After the first effect cycle, loading should be false since there's
      // no workspace to load agents for.
      expect(sub.loading).toBe(false);
    });

    cleanup();
  });

});