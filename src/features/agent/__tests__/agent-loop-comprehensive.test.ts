/**
 * Comprehensive Agent Loop Tests
 *
 * Tests the complete agent loop including streaming, rendering, and persistence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageAccumulatorService } from '../services/message-accumulator.service';
import { unifiedStateStore } from '$features/agent/services/unified-state-store';
import { sessionStore } from '../browser';
import type { AgentMessage, AgentSession, WorkspaceId } from '../../../shared/types';
import { AgentStatus } from '../../../shared/types';

// Test utilities
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForCondition = async (
  condition: () => boolean,
  timeout = 5000,
  interval = 100,
): Promise<void> => {
  const start = Date.now();
  while (!condition() && Date.now() - start < timeout) {
    await delay(interval);
  }
  if (!condition()) {
    throw new Error('Condition not met within timeout');
  }
};

describe('Agent Loop Comprehensive Tests', () => {
  let accumulator: MessageAccumulatorService;
  let testSessionId: string;
  let testAgentId: string;
  let testWorkspaceId: string;

  beforeEach(() => {
    // Reset services
    MessageAccumulatorService.resetInstance();
    accumulator = MessageAccumulatorService.getInstance({
      maxMessageSize: 100000,
      flushInterval: 100,
      enableCheckpoints: true,
    });

    testSessionId = `test-session-${Date.now()}`;
    testAgentId = `test-agent-${Date.now()}`;
    testWorkspaceId = `test-workspace-${Date.now()}`;

    // Create a test workspace so sessionStore operations work
    unifiedStateStore.setWorkspace({
      id: testWorkspaceId as any,
      name: 'Test Workspace',
      path: '/test/workspace',
      gitBranch: 'main',
      gitRemote: 'origin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpened: new Date().toISOString(),
    });
    unifiedStateStore.setCurrentWorkspace(testWorkspaceId as any);

    // Clear session store
    sessionStore.clearForWorkspace(testWorkspaceId);
  });

  afterEach(() => {
    accumulator.dispose();
    vi.clearAllMocks();
    // Clean up the test workspace - just clear the current workspace
    unifiedStateStore.setCurrentWorkspace(null);
  });

  describe('Streaming Message Flow', () => {
    it('should handle complete streaming lifecycle', async () => {
      const events: any[] = [];

      // Track all events
      accumulator.on('chunk:added', (data: any) => events.push({ type: 'chunk', data }));
      accumulator.on('accumulation:completed', (data: any) =>
        events.push({ type: 'complete', data }),
      );
      accumulator.on('accumulation:flushed', (data: any) => events.push({ type: 'flush', data }));
      accumulator.on('error', (data: any) => events.push({ type: 'error', data }));

      // Start accumulation
      accumulator.startAccumulation(testSessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      // Simulate realistic streaming with varying delays
      const chunks = [
        { content: "I'll ", delay: 50 },
        { content: 'help you ', delay: 100 },
        { content: 'with that. ', delay: 75 },
        { content: 'Let me ', delay: 150 },
        { content: 'process ', delay: 80 },
        { content: 'your request.', delay: 60 },
      ];

      for (let i = 0; i < chunks.length; i++) {
        await delay(chunks[i].delay);
        accumulator.addChunk(testSessionId, chunks[i].content, {
          timestamp: new Date(),
          sequenceNumber: i + 1,
        });
      }

      // Complete the message
      const result = accumulator.complete(testSessionId);

      // Verify results
      expect(result).toBeDefined();
      expect(result?.content).toBe("I'll help you with that. Let me process your request.");
      expect(result?.chunkCount).toBe(6);

      // Verify events were emitted
      expect(events.filter((e) => e.type === 'chunk')).toHaveLength(6);
      expect(events.filter((e) => e.type === 'complete')).toHaveLength(1);
      expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
    });

    it('should handle tool calls during streaming', async () => {
      accumulator.startAccumulation(testSessionId, {
        messageId: 'msg-2',
        role: 'assistant',
        metadata: { hasToolCalls: false },
      });

      // Add text chunk
      accumulator.addChunk(testSessionId, 'Let me search for that. ', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      // Simulate tool call chunk
      const toolCallChunk = {
        type: 'tool_use',
        id: 'tool-1',
        name: 'search',
        input: { query: 'test query' },
      };

      accumulator.addChunk(testSessionId, JSON.stringify(toolCallChunk), {
        timestamp: new Date(),
        sequenceNumber: 2,
        type: 'tool_call',
        hasToolCalls: true,
      });

      // Add result chunk
      accumulator.addChunk(testSessionId, ' Found the information.', {
        timestamp: new Date(),
        sequenceNumber: 3,
      });

      const result = accumulator.complete(testSessionId);
      expect(result?.content).toContain('Let me search for that');
      expect(result?.content).toContain('Found the information');
      // Check if any chunk has tool call metadata
      const hasToolCalls = result?.chunks?.some((c: any) => c.metadata?.hasToolCalls);
      expect(hasToolCalls).toBe(true);
    });

    it('should recover from interrupted streaming', async () => {
      // Start streaming
      accumulator.startAccumulation(testSessionId, {
        messageId: 'msg-3',
        role: 'assistant',
      });

      // Add some chunks
      accumulator.addChunk(testSessionId, 'Processing ', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });
      accumulator.addChunk(testSessionId, 'your request', {
        timestamp: new Date(),
        sequenceNumber: 2,
      });

      // Get partial state
      const partial = accumulator.getAccumulated(testSessionId);
      expect(partial?.content).toBe('Processing your request');
      expect(partial?.isComplete).toBe(false);

      // Simulate interruption and recovery
      accumulator.clear(testSessionId);

      // Restart with same message ID
      accumulator.startAccumulation(testSessionId, {
        messageId: 'msg-3',
        role: 'assistant',
      });

      // Continue from where we left off
      accumulator.addChunk(testSessionId, 'Processing your request', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });
      accumulator.addChunk(testSessionId, '... continuing', {
        timestamp: new Date(),
        sequenceNumber: 3,
      });

      const result = accumulator.complete(testSessionId);
      expect(result?.content).toBe('Processing your request... continuing');
    });
  });

  describe('Session Management', () => {
    it('should manage session lifecycle correctly', async () => {
      // Create session
      const session: AgentSession = {
        id: testAgentId as any,
        backendSessionId: testSessionId as any,
        workspaceId: testWorkspaceId as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: 'test-model',
        systemPrompt: 'Test prompt',
      };

      sessionStore.addSessionForWorkspace(testWorkspaceId, session);

      // Verify session was added
      const addedSession = sessionStore.getSessionForWorkspace(testWorkspaceId, testAgentId);
      expect(addedSession).toBeDefined();

      // Add user message
      const userMessage: AgentMessage = {
        id: 'msg-user-1',
        role: 'user',
        content: 'Hello, agent!',
        timestamp: new Date().toISOString(),
      };
      sessionStore.addMessageForWorkspace(testWorkspaceId, testAgentId, userMessage);

      // Start streaming
      sessionStore.setStreamingForWorkspace(testWorkspaceId, testAgentId, true);
      const streamingSession = sessionStore.getSessionForWorkspace(testWorkspaceId, testAgentId);
      expect(streamingSession?.isStreaming).toBe(true);

      // Add assistant message during streaming
      const assistantMessage: AgentMessage = {
        id: 'msg-assistant-1',
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      };
      sessionStore.addMessageForWorkspace(testWorkspaceId, testAgentId, assistantMessage);

      // Update message content during streaming
      sessionStore.updateMessageForWorkspace(testWorkspaceId, testAgentId, 'msg-assistant-1', {
        content: 'Hello! How can I help you today?',
      });

      // Complete streaming
      sessionStore.setStreamingForWorkspace(testWorkspaceId, testAgentId, false);
      sessionStore.updateMessageForWorkspace(testWorkspaceId, testAgentId, 'msg-assistant-1', {
        isStreaming: false,
      });

      // Verify final state
      const finalSession = sessionStore.getSessionForWorkspace(testWorkspaceId, testAgentId);
      expect(finalSession?.messages).toHaveLength(2);
      expect(finalSession?.messages[1].content).toBe('Hello! How can I help you today?');
      expect(finalSession?.messages[1].isStreaming).toBe(false);
    });

    it('rebuilds message dedup state when replacing session messages', () => {
      const session: AgentSession = {
        id: testAgentId as any,
        backendSessionId: testSessionId as any,
        workspaceId: testWorkspaceId as WorkspaceId,
        name: 'Dedup Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: 'test-model',
        systemPrompt: 'Test prompt',
      };

      const replacementMessage: AgentMessage = {
        id: 'msg-replaced-1',
        role: 'assistant',
        content: 'Replacement message',
        timestamp: new Date().toISOString(),
      };

      sessionStore.addSessionForWorkspace(testWorkspaceId, session);
      sessionStore.updateSessionForWorkspace(testWorkspaceId, testAgentId, {
        messages: [replacementMessage],
      });

      sessionStore.addMessageForWorkspace(testWorkspaceId, testAgentId, replacementMessage);

      const updatedSession = sessionStore.getSessionForWorkspace(testWorkspaceId, testAgentId);
      expect(updatedSession?.messages).toHaveLength(1);
      expect(updatedSession?.messages[0].id).toBe(replacementMessage.id);

      const workspace = unifiedStateStore.getWorkspace(testWorkspaceId as any);
      const agent = workspace?.agents.get(testAgentId as any);
      expect(agent?.messageIdSet.has(replacementMessage.id)).toBe(true);
      expect(agent?.messageIdSet.size).toBe(1);
    });

    it('clears the active agent pointer when clearing a workspace', () => {
      const session: AgentSession = {
        id: testAgentId as any,
        backendSessionId: testSessionId as any,
        workspaceId: testWorkspaceId as WorkspaceId,
        name: 'Active Agent Test',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: 'test-model',
        systemPrompt: 'Test prompt',
      };

      sessionStore.addSessionForWorkspace(testWorkspaceId, session);
      sessionStore.setActiveSessionForWorkspace(testWorkspaceId, testAgentId);

      expect(sessionStore.getActiveSessionForWorkspace(testWorkspaceId)?.id).toBe(testAgentId);

      sessionStore.clearForWorkspace(testWorkspaceId);

      const workspace = unifiedStateStore.getWorkspace(testWorkspaceId as any);
      expect(sessionStore.getActiveSessionForWorkspace(testWorkspaceId)).toBeUndefined();
      expect(workspace?.activeAgentId).toBeNull();
      expect(workspace?.agents.size).toBe(0);
    });

    it('should handle concurrent sessions', async () => {
      const sessionIds = ['session-1', 'session-2', 'session-3'];

      // Create multiple sessions
      sessionIds.forEach((id, index) => {
        const session: AgentSession = {
          id: `agent-${id}` as any,
          backendSessionId: id as any,
          workspaceId: testWorkspaceId as any,
          name: `Agent ${index + 1}`,
          status: AgentStatus.Active,
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          model: 'test-model',
          systemPrompt: 'Test prompt',
        };
        sessionStore.addSessionForWorkspace(testWorkspaceId, session);

        // Start accumulation for each
        accumulator.startAccumulation(id, {
          messageId: `msg-${id}`,
          role: 'assistant',
        });
      });

      // Add chunks to each session concurrently
      await Promise.all(
        sessionIds.map(async (id, index) => {
          await delay(index * 50); // Stagger starts
          accumulator.addChunk(id, `Response for ${id}`, {
            timestamp: new Date(),
            sequenceNumber: 1,
          });
        }),
      );

      // Complete all sessions
      sessionIds.forEach((id) => {
        const result = accumulator.complete(id);
        expect(result?.content).toBe(`Response for ${id}`);
        // Clean up after completion
        accumulator.clear(id);
      });

      // Verify all sessions are independent and cleaned up
      const stats = accumulator.getStats();
      expect(stats.activeAccumulators).toBe(0); // All should be cleaned up
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle malformed chunks gracefully', () => {
      accumulator.startAccumulation(testSessionId, {
        messageId: 'msg-error-1',
        role: 'assistant',
      });

      // Add valid chunk
      accumulator.addChunk(testSessionId, 'Valid content ', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      // Add chunk without explicit sequence number - service auto-increments
      accumulator.addChunk(testSessionId, 'Invalid', {
        timestamp: new Date(),
        sequenceNumber: undefined as any,
      });

      // Should still be able to continue
      accumulator.addChunk(testSessionId, 'continues', {
        timestamp: new Date(),
        sequenceNumber: 3,
      });

      const result = accumulator.complete(testSessionId);
      // Service auto-increments sequence numbers, so all chunks are included
      expect(result?.content).toContain('Valid content');
      expect(result?.content).toContain('Invalid');
      expect(result?.content).toContain('continues');
    });

    it('should enforce message size limits', () => {
      // Create a new accumulator with a smaller limit for this test
      MessageAccumulatorService.resetInstance();
      const limitedAccumulator = MessageAccumulatorService.getInstance({
        maxMessageSize: 10000, // 10KB limit
        flushInterval: 100,
        enableCheckpoints: true,
      });

      limitedAccumulator.startAccumulation(testSessionId, {
        messageId: 'msg-size-1',
        role: 'assistant',
      });

      // Try to add content exceeding 10KB limit
      const largeContent = 'x'.repeat(10001);

      expect(() => {
        limitedAccumulator.addChunk(testSessionId, largeContent, {
          timestamp: new Date(),
          sequenceNumber: 1,
        });
      }).toThrow('Message size limit exceeded');

      // Verify accumulator is still usable
      limitedAccumulator.clear(testSessionId);
      limitedAccumulator.startAccumulation(testSessionId, {
        messageId: 'msg-size-2',
        role: 'assistant',
      });

      limitedAccumulator.addChunk(testSessionId, 'Normal size content', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      const result = limitedAccumulator.complete(testSessionId);
      expect(result?.content).toBe('Normal size content');

      // Reset back to default config for other tests
      MessageAccumulatorService.resetInstance();
      accumulator = MessageAccumulatorService.getInstance({
        maxMessageSize: 100000,
        flushInterval: 100,
        enableCheckpoints: true,
      });
    });

    it('should handle auto-flush timeout', async () => {
      vi.useFakeTimers();

      const flushEvents: any[] = [];
      accumulator.on('flush', (data: any) => flushEvents.push(data));

      accumulator.startAccumulation(testSessionId, {
        messageId: 'msg-flush-1',
        role: 'assistant',
      });

      accumulator.addChunk(testSessionId, 'Partial content', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      // Advance time to trigger flush
      vi.advanceTimersByTime(150);

      expect(flushEvents).toHaveLength(1);
      expect(flushEvents[0].sessionId).toBe(testSessionId);

      // Should still be able to complete
      accumulator.addChunk(testSessionId, ' completed', {
        timestamp: new Date(),
        sequenceNumber: 2,
      });

      const result = accumulator.complete(testSessionId);
      expect(result?.content).toBe('Partial content completed');

      vi.useRealTimers();
    });
  });

  describe('Performance Monitoring', () => {
    it('should track performance metrics', async () => {
      const chunkCount = 100;
      const startTime = Date.now();

      accumulator.startAccumulation(testSessionId, {
        messageId: 'msg-perf-1',
        role: 'assistant',
      });

      // Add many chunks rapidly
      for (let i = 0; i < chunkCount; i++) {
        accumulator.addChunk(testSessionId, `chunk${i} `, {
          timestamp: new Date(),
          sequenceNumber: i + 1,
        });
      }

      const result = accumulator.complete(testSessionId);
      const duration = Date.now() - startTime;

      // Verify performance
      expect(duration).toBeLessThan(500); // Should process 100 chunks in < 500ms
      expect(result?.chunkCount).toBe(chunkCount);

      const stats = accumulator.getStats();
      expect(stats.totalChunksProcessed).toBeGreaterThanOrEqual(chunkCount);
      expect(stats.averageMessageSize).toBeGreaterThan(0);
      expect(stats.largestMessage).toBeGreaterThan(0);
    });
  });
});
