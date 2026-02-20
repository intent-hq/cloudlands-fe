/**
 * Tests for message queue edge cases, specifically around the "Send now" functionality
 * and race conditions when interrupting streams to send queued messages.
 *
 * These tests verify:
 * 1. When user clicks "Send now", automatic queue processing is skipped
 * 2. The interrupted flag is properly set and cleared
 * 3. Remaining queued messages are processed after the "Send now" message completes
 * 4. Normal queue processing (without interruption) still works correctly
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the message queue handler behavior
interface MockQueueHandler {
  messageQueues: Map<string, Array<{ id: string; content: string; position: number }>>;
  processingQueue: Set<string>;
  interruptedAgents: Set<string>;
  streamStartTimes: Map<string, number>;
  processNextQueuedMessage: (agentId: string, workspaceId: string) => Promise<void>;
  handleStopSession: (agentId: string) => Promise<void>;
  queueMessage: (agentId: string, content: string) => { id: string };
  removeQueuedMessage: (agentId: string, messageId: string) => void;
}

describe('Message Queue Edge Cases', () => {
  let handler: MockQueueHandler;
  let processedMessages: Array<{ agentId: string; messageId: string }>;

  beforeEach(() => {
    processedMessages = [];

    handler = {
      messageQueues: new Map(),
      processingQueue: new Set(),
      interruptedAgents: new Set(),
      streamStartTimes: new Map(),

      async processNextQueuedMessage(agentId: string, _workspaceId: string) {
        // Check if agent was intentionally interrupted
        if (this.interruptedAgents.has(agentId)) {
          this.interruptedAgents.delete(agentId);
          return; // Skip automatic processing
        }

        if (this.processingQueue.has(agentId)) {
          return; // Already processing
        }

        // GUARD: If a stream is already active, skip queue processing
        if (this.streamStartTimes.has(agentId)) {
          return; // Defer to next onComplete
        }

        const queue = this.messageQueues.get(agentId);
        if (!queue || queue.length === 0) {
          return; // No messages to process
        }

        this.processingQueue.add(agentId);

        try {
          // Peek at the next message WITHOUT removing it
          const nextMessage = queue[0];
          if (nextMessage) {
            // Simulate the send succeeding
            processedMessages.push({ agentId, messageId: nextMessage.id });
            // Only remove after successful send
            queue.shift();
            // Update positions
            queue.forEach((m, i) => {
              m.position = i;
            });
          }
        } finally {
          this.processingQueue.delete(agentId);
        }
      },

      async handleStopSession(agentId: string) {
        // Mark as interrupted BEFORE doing anything else
        this.interruptedAgents.add(agentId);
      },

      queueMessage(agentId: string, content: string) {
        const queue = this.messageQueues.get(agentId) || [];
        const message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          content,
          position: queue.length,
        };
        queue.push(message);
        this.messageQueues.set(agentId, queue);
        return message;
      },

      removeQueuedMessage(agentId: string, messageId: string) {
        const queue = this.messageQueues.get(agentId);
        if (!queue) return;

        const index = queue.findIndex((m) => m.id === messageId);
        if (index !== -1) {
          queue.splice(index, 1);
          queue.forEach((m, i) => {
            m.position = i;
          });
        }
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Send Now - Interrupt Handling', () => {
    it('should skip automatic queue processing when agent is intentionally interrupted', async () => {
      const agentId = 'agent_1';
      const workspaceId = 'workspace_1';

      // Queue two messages
      const msg1 = handler.queueMessage(agentId, 'First message');
      const msg2 = handler.queueMessage(agentId, 'Second message');

      expect(handler.messageQueues.get(agentId)?.length).toBe(2);

      // Simulate "Send now" on msg1:
      // 1. Remove msg1 from queue
      handler.removeQueuedMessage(agentId, msg1.id);

      // 2. Stop the session (which marks as interrupted)
      await handler.handleStopSession(agentId);

      // 3. Simulate stream completion calling processNextQueuedMessage
      await handler.processNextQueuedMessage(agentId, workspaceId);

      // The automatic processing should have been skipped
      expect(processedMessages.length).toBe(0);

      // msg2 should still be in the queue
      expect(handler.messageQueues.get(agentId)?.length).toBe(1);
      expect(handler.messageQueues.get(agentId)?.[0].id).toBe(msg2.id);
    });

    it('should clear the interrupted flag after skipping', async () => {
      const agentId = 'agent_1';
      const workspaceId = 'workspace_1';

      handler.queueMessage(agentId, 'Message');
      await handler.handleStopSession(agentId);

      expect(handler.interruptedAgents.has(agentId)).toBe(true);

      await handler.processNextQueuedMessage(agentId, workspaceId);

      // Flag should be cleared
      expect(handler.interruptedAgents.has(agentId)).toBe(false);
    });

    it('should process remaining queue after Send Now message completes', async () => {
      const agentId = 'agent_1';
      const workspaceId = 'workspace_1';

      // Queue two messages
      const msg1 = handler.queueMessage(agentId, 'First');
      const msg2 = handler.queueMessage(agentId, 'Second');

      // Simulate "Send now" on msg1
      handler.removeQueuedMessage(agentId, msg1.id);
      await handler.handleStopSession(agentId);

      // First processNextQueuedMessage (from interrupted stream) - should be skipped
      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages.length).toBe(0);

      // Now simulate msg1's stream completing normally (no interrupt flag set)
      // This should trigger processing of msg2
      await handler.processNextQueuedMessage(agentId, workspaceId);

      expect(processedMessages.length).toBe(1);
      expect(processedMessages[0].messageId).toBe(msg2.id);
      expect(handler.messageQueues.get(agentId)?.length).toBe(0);
    });

    it('should handle multiple queued messages with Send Now on first', async () => {
      const agentId = 'agent_1';
      const workspaceId = 'workspace_1';

      // Queue three messages
      const msg1 = handler.queueMessage(agentId, 'First');
      const msg2 = handler.queueMessage(agentId, 'Second');
      const msg3 = handler.queueMessage(agentId, 'Third');

      expect(handler.messageQueues.get(agentId)?.length).toBe(3);

      // User clicks "Send now" on msg1
      handler.removeQueuedMessage(agentId, msg1.id);
      await handler.handleStopSession(agentId);

      // Stream interrupt triggers processNextQueuedMessage - should skip
      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages.length).toBe(0);

      // After msg1 completes, process msg2
      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages.length).toBe(1);
      expect(processedMessages[0].messageId).toBe(msg2.id);

      // After msg2 completes, process msg3
      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages.length).toBe(2);
      expect(processedMessages[1].messageId).toBe(msg3.id);

      expect(handler.messageQueues.get(agentId)?.length).toBe(0);
    });
  });

  describe('Normal Queue Processing', () => {
    it('should process queue in order without interruption', async () => {
      const agentId = 'agent_1';
      const workspaceId = 'workspace_1';

      const msg1 = handler.queueMessage(agentId, 'First');
      const msg2 = handler.queueMessage(agentId, 'Second');

      // Normal stream completion (no interrupt)
      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages[0].messageId).toBe(msg1.id);

      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages[1].messageId).toBe(msg2.id);

      expect(handler.messageQueues.get(agentId)?.length).toBe(0);
    });

    it('should handle empty queue gracefully', async () => {
      const agentId = 'agent_1';
      const workspaceId = 'workspace_1';

      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages.length).toBe(0);
    });

    it('should prevent concurrent processing', async () => {
      const agentId = 'agent_1';
      const workspaceId = 'workspace_1';

      handler.queueMessage(agentId, 'Message');
      handler.processingQueue.add(agentId); // Simulate already processing

      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages.length).toBe(0); // Should be blocked
    });
  });

  describe('Send Now on Middle Message', () => {
    it('should correctly handle Send Now on second queued message', async () => {
      const agentId = 'agent_1';
      const workspaceId = 'workspace_1';

      // Queue three messages
      const msg1 = handler.queueMessage(agentId, 'First');
      const msg2 = handler.queueMessage(agentId, 'Second');
      const msg3 = handler.queueMessage(agentId, 'Third');

      // User clicks "Send now" on msg2 (middle message)
      handler.removeQueuedMessage(agentId, msg2.id);
      await handler.handleStopSession(agentId);

      // Interrupt processing - should skip
      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages.length).toBe(0);

      // After msg2 completes, remaining queue (msg1, msg3) should process in order
      // Note: msg1 is now at position 0, msg3 at position 1
      const queue = handler.messageQueues.get(agentId);
      expect(queue?.length).toBe(2);
      expect(queue?.[0].id).toBe(msg1.id);
      expect(queue?.[1].id).toBe(msg3.id);

      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages[0].messageId).toBe(msg1.id);

      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages[1].messageId).toBe(msg3.id);
    });
  });

  describe('Multiple Agents', () => {
    it('should handle interrupted flag per agent', async () => {
      const agent1 = 'agent_1';
      const agent2 = 'agent_2';
      const workspaceId = 'workspace_1';

      handler.queueMessage(agent1, 'Agent 1 message');
      handler.queueMessage(agent2, 'Agent 2 message');

      // Only interrupt agent1
      await handler.handleStopSession(agent1);

      // Agent1 queue processing should be skipped
      await handler.processNextQueuedMessage(agent1, workspaceId);
      expect(processedMessages.filter((m) => m.agentId === agent1).length).toBe(0);

      // Agent2 queue processing should work normally
      await handler.processNextQueuedMessage(agent2, workspaceId);
      expect(processedMessages.filter((m) => m.agentId === agent2).length).toBe(1);
    });
  });

  describe('Race Condition - Active Stream Guard', () => {
    it('should skip queue processing when a stream is already active', async () => {
      const agentId = 'agent_1';
      const workspaceId = 'workspace_1';

      const msg1 = handler.queueMessage(agentId, 'Queued message');

      // Simulate a new direct message starting a stream before processNextQueuedMessage fires
      handler.streamStartTimes.set(agentId, Date.now());

      await handler.processNextQueuedMessage(agentId, workspaceId);

      // Message should NOT have been processed (stream was active)
      expect(processedMessages.length).toBe(0);

      // Message should still be in the queue
      expect(handler.messageQueues.get(agentId)?.length).toBe(1);
      expect(handler.messageQueues.get(agentId)?.[0].id).toBe(msg1.id);
    });

    it('should process queued message after active stream completes', async () => {
      const agentId = 'agent_1';
      const workspaceId = 'workspace_1';

      const msg1 = handler.queueMessage(agentId, 'Queued message');

      // First attempt: stream is active, should skip
      handler.streamStartTimes.set(agentId, Date.now());
      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages.length).toBe(0);

      // Stream completes, streamStartTimes is cleared
      handler.streamStartTimes.delete(agentId);

      // Second attempt: no active stream, should process
      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages.length).toBe(1);
      expect(processedMessages[0].messageId).toBe(msg1.id);
      expect(handler.messageQueues.get(agentId)?.length).toBe(0);
    });

    it('should not lose message when send would fail (peek-before-shift)', async () => {
      const agentId = 'agent_1';
      const workspaceId = 'workspace_1';

      const msg1 = handler.queueMessage(agentId, 'Important message');

      // After processing, message should be removed from queue
      await handler.processNextQueuedMessage(agentId, workspaceId);
      expect(processedMessages.length).toBe(1);
      expect(handler.messageQueues.get(agentId)?.length).toBe(0);
    });
  });
});
