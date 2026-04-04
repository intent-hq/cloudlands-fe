/**
 * Integration tests for streaming functionality
 *
 * Tests the complete streaming flow with all new services integrated.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACPProviderStreaming, testStreamManager } from '../../../src/features/agent/agent-providers/acp-provider-streaming';
import { messageAccumulator } from '../../../src/features/agent/services/message-accumulator.service';

describe('Streaming Integration', () => {
  let streaming: ACPProviderStreaming;
  const agentId = 'test-agent';
  const sessionId = 'test-session';
  const frontendSessionId = 'frontend-session';

  beforeEach(() => {
    streaming = new ACPProviderStreaming(agentId);
    streaming.setInternalSessionId(sessionId);
  });

  afterEach(() => {
    streaming.dispose();
    testStreamManager.cleanupAll();
    messageAccumulator.clearAll();
  });

  describe('Session Management', () => {
    it('should start a streaming session with proper ID mapping', () => {
      const callbacks = {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
      };

      streaming.startStreaming({
        frontendSessionId,
        ...callbacks,
      });

      // Should be able to find session by any ID
      const session = testStreamManager.getSession(agentId);
      expect(session).toBeDefined();
      expect(session?.sessionId).toBe(sessionId);
      expect(session?.frontendSessionId).toBe(frontendSessionId);
    });

    it('should handle session updates with different IDs', async () => {
      const onChunk = vi.fn();

      streaming.startStreaming({
        frontendSessionId,
        onChunk,
      });

      // Send update with backend session ID
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello' },
        },
      });

      expect(onChunk).toHaveBeenCalledWith('Hello');

      // Send update with frontend session ID
      await streaming.handleSessionUpdate({
        sessionId: frontendSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: ' World' },
        },
      });

      expect(onChunk).toHaveBeenCalledWith(' World');
    });
  });

  describe('Message Accumulation', () => {
    it('should accumulate text chunks correctly', async () => {
      const onChunk = vi.fn();
      const onComplete = vi.fn();

      streaming.startStreaming({
        frontendSessionId,
        onChunk,
        onComplete,
      });

      // Send multiple chunks
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello' },
        },
      });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: ' World' },
        },
      });

      // Complete the stream
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'done',
          stopReason: 'end_turn',
        },
      });

      // Check accumulated content
      expect(onComplete).toHaveBeenCalled();
      const finalMessage = onComplete.mock.calls[0][0];
      expect(finalMessage.content).toBe('Hello World');
    });

    it('should accumulate content blocks correctly', async () => {
      const onContentBlocks = vi.fn();
      const onComplete = vi.fn();

      streaming.startStreaming({
        frontendSessionId,
        onContentBlocks,
        onComplete,
      });

      // Send tool call
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          content: {
            id: 'tool-1',
            name: 'test_tool',
            input: { param: 'value' },
          },
        },
      });

      expect(onContentBlocks).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'tool_use',
          name: 'test_tool',
          tool_use_id: 'tool-1',
        }),
      ]);

      // Send tool result
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          content: {
            toolCallId: 'tool-1',
            result: { output: 'success' },
          },
        },
      });

      // Complete and check accumulated blocks
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'done',
        },
      });

      const finalMessage = onComplete.mock.calls[0][0];
      expect(finalMessage.contentBlocks).toHaveLength(2);
      expect(finalMessage.contentBlocks[0].type).toBe('tool_use');
      expect(finalMessage.contentBlocks[1].type).toBe('tool_result');
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully', async () => {
      const onError = vi.fn();

      streaming.startStreaming({
        frontendSessionId,
        onError,
      });

      const error = new Error('Stream failed');
      await streaming.handleError(error);

      expect(onError).toHaveBeenCalledWith(error);
    });

    it('should clean up on error', async () => {
      streaming.startStreaming({
        frontendSessionId,
      });

      const error = new Error('Stream failed');
      await streaming.handleError(error);

      // Session should be cleaned up
      const session = testStreamManager.getSession(agentId);
      expect(session).toBeUndefined();
    });
  });

  describe('Cleanup', () => {
    it('should clean up all resources on dispose', () => {
      streaming.startStreaming({
        frontendSessionId,
      });

      // Initialize accumulator properly
      messageAccumulator.startAccumulation(sessionId);
      messageAccumulator.addChunk(sessionId, 'test');

      streaming.dispose();

      // Everything should be cleaned up
      expect(testStreamManager.getSession(agentId)).toBeUndefined();
      expect(messageAccumulator.getAccumulated(sessionId)).toBeUndefined();
    });

    it('should handle multiple cleanup calls safely', () => {
      streaming.startStreaming({
        frontendSessionId,
      });

      // Multiple cleanup calls should not throw
      expect(() => {
        streaming.cleanup();
        streaming.cleanup();
        streaming.dispose();
      }).not.toThrow();
    });
  });

  describe('Stall Detection', () => {
    it('should detect stalled streams', () => {
      vi.useFakeTimers();

      streaming.startStreaming({
        frontendSessionId,
      });

      // Initially not stalled
      expect(streaming.isStalled()).toBe(false);

      // Advance time beyond stall threshold
      vi.advanceTimersByTime(31000);

      // Should now be stalled
      expect(streaming.isStalled()).toBe(true);

      vi.useRealTimers();
    });

    it('should reset stall detection on activity', async () => {
      vi.useFakeTimers();

      streaming.startStreaming({
        frontendSessionId,
      });

      // Advance time partially
      vi.advanceTimersByTime(20000);

      // Send update to reset activity
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'active' },
        },
      });

      // Advance time again but less than threshold from last activity
      vi.advanceTimersByTime(20000);

      // Should not be stalled
      expect(streaming.isStalled()).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('Message Formatting', () => {
    it('should properly format messages', async () => {
      const onComplete = vi.fn();
      const onChunk = vi.fn();

      streaming.startStreaming({
        frontendSessionId,
        onComplete,
        onChunk,
      });

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Test message' },
        },
      });

      // Verify chunk was received
      expect(onChunk).toHaveBeenCalledWith('Test message');

      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'done',
          stopReason: 'end_turn',
        },
      });

      expect(onComplete).toHaveBeenCalled();
      const finalMessage = onComplete.mock.calls[0][0];

      // Check message format
      expect(finalMessage).toHaveProperty('id');
      expect(finalMessage).toHaveProperty('role', 'assistant');
      expect(finalMessage).toHaveProperty('content', 'Test message');
      expect(finalMessage).toHaveProperty('timestamp');
      expect(finalMessage).toHaveProperty('metadata');
      expect(finalMessage.metadata.stopReason).toBe('end_turn');
    });

    it('should handle mixed content types', async () => {
      const onChunk = vi.fn();
      const onContentBlocks = vi.fn();
      const onComplete = vi.fn();

      streaming.startStreaming({
        frontendSessionId,
        onChunk,
        onContentBlocks,
        onComplete,
      });

      // Send text
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Calling tool...' },
        },
      });

      // Send tool call
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          content: {
            id: 'calc-1',
            name: 'calculator',
            input: { operation: 'add', a: 1, b: 2 },
          },
        },
      });

      // Send more text
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: ' Result: 3' },
        },
      });

      // Complete
      await streaming.handleSessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'done',
        },
      });

      const finalMessage = onComplete.mock.calls[0][0];
      expect(finalMessage.content).toBe('Calling tool... Result: 3');
      expect(finalMessage.contentBlocks).toHaveLength(1);
      expect(finalMessage.contentBlocks[0].type).toBe('tool_use');
    });
  });
});
