/**
 * Agent Streaming Tests
 *
 * Comprehensive tests for agent message streaming functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageAccumulatorService } from '../services/message-accumulator.service';

describe('Agent Message Streaming', () => {
  let accumulator: MessageAccumulatorService;

  beforeEach(() => {
    MessageAccumulatorService.resetInstance();
    accumulator = MessageAccumulatorService.getInstance({
      maxMessageSize: 1000,
      flushInterval: 100,
      enableCheckpoints: false,
    });
  });

  afterEach(() => {
    accumulator.dispose();
  });

  describe('Basic Streaming', () => {
    it('should accumulate message chunks in order', () => {
      const sessionId = 'test-session';
      const messageId = 'msg-1';

      accumulator.startAccumulation(sessionId, {
        messageId,
        role: 'assistant',
      });

      const chunks = ['Hello, ', 'how can I ', 'help you today?'];

      chunks.forEach((content, index) => {
        accumulator.addChunk(sessionId, content, {
          timestamp: new Date(),
          sequenceNumber: index + 1,
        });
      });

      const result = accumulator.complete(sessionId);
      expect(result?.content).toBe('Hello, how can I help you today?');
      expect(result?.chunkCount).toBe(3);
    });

    it('should handle out-of-order chunks', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      // Add chunks out of order
      accumulator.addChunk(sessionId, 'third', {
        timestamp: new Date(),
        sequenceNumber: 3,
      });

      accumulator.addChunk(sessionId, 'first ', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      accumulator.addChunk(sessionId, 'second ', {
        timestamp: new Date(),
        sequenceNumber: 2,
      });

      const result = accumulator.complete(sessionId);
      expect(result?.content).toBe('first second third');
    });

    it('should handle duplicate chunks', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      // Add same chunk multiple times
      const chunk = {
        content: 'duplicate',
        timestamp: new Date(),
        sequenceNumber: 1,
      };

      accumulator.addChunk(sessionId, chunk.content, {
        timestamp: chunk.timestamp,
        sequenceNumber: chunk.sequenceNumber,
      });
      accumulator.addChunk(sessionId, chunk.content, {
        timestamp: chunk.timestamp,
        sequenceNumber: chunk.sequenceNumber,
      });
      accumulator.addChunk(sessionId, chunk.content, {
        timestamp: chunk.timestamp,
        sequenceNumber: chunk.sequenceNumber,
      });

      const result = accumulator.complete(sessionId);
      expect(result?.content).toBe('duplicate');
      expect(result?.chunkCount).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing session gracefully', () => {
      expect(() => {
        accumulator.addChunk('non-existent', 'test', {
          timestamp: new Date(),
          sequenceNumber: 1,
        });
      }).toThrow('No accumulator found');
    });

    it('should enforce maximum message size', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      // Try to add content exceeding max size
      const largeContent = 'x'.repeat(1001); // Exceeds 1000 byte limit

      expect(() => {
        accumulator.addChunk(sessionId, largeContent, {
          timestamp: new Date(),
          sequenceNumber: 1,
        });
      }).toThrow('Message size limit exceeded');
    });

    it('should handle concurrent accumulations', () => {
      const sessions = ['session-1', 'session-2', 'session-3'];

      sessions.forEach((sessionId, index) => {
        accumulator.startAccumulation(sessionId, {
          messageId: `msg-${index}`,
          role: 'assistant',
        });

        accumulator.addChunk(sessionId, `Content for ${sessionId}`, {
          timestamp: new Date(),
          sequenceNumber: 1,
        });
      });

      sessions.forEach((sessionId) => {
        const result = accumulator.complete(sessionId);
        expect(result?.content).toBe(`Content for ${sessionId}`);
      });
    });
  });

  describe('Event Emission', () => {
    it('should emit chunk events', () =>
      new Promise<void>((resolve) => {
        const sessionId = 'test-session';

        accumulator.on('chunk:added', (data: any) => {
          expect(data.sessionId).toBe(sessionId);
          expect(data.chunkSize).toBeGreaterThan(0);
          resolve();
        });

        accumulator.startAccumulation(sessionId, {
          messageId: 'msg-1',
          role: 'assistant',
        });

        accumulator.addChunk(sessionId, 'test chunk', {
          timestamp: new Date(),
          sequenceNumber: 1,
        });
      }));

    it('should emit complete event', () =>
      new Promise<void>((resolve) => {
        const sessionId = 'test-session';

        accumulator.on('accumulation:completed', (data: any) => {
          expect(data.sessionId).toBe(sessionId);
          expect(data.message.content).toBe('complete message');
          resolve();
        });

        accumulator.startAccumulation(sessionId, {
          messageId: 'msg-1',
          role: 'assistant',
        });

        accumulator.addChunk(sessionId, 'complete message', {
          timestamp: new Date(),
          sequenceNumber: 1,
        });

        accumulator.complete(sessionId);
      }));

    it('should emit error events', () =>
      new Promise<void>((resolve) => {
        const sessionId = 'test-session';

        accumulator.on('error', (data: any) => {
          expect(data.sessionId).toBe(sessionId);
          expect(data.error).toBeDefined();
          resolve();
        });

        accumulator.startAccumulation(sessionId, {
          messageId: 'msg-1',
          role: 'assistant',
        });

        // Trigger error by exceeding max size
        const largeContent = 'x'.repeat(1001);

        try {
          accumulator.addChunk(sessionId, largeContent, {
            timestamp: new Date(),
            sequenceNumber: 1,
          });
        } catch (error) {
          // Error is expected, event should have been emitted
        }
      }));
  });

  describe('Auto-flush', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should auto-flush after timeout', () => {
      const sessionId = 'test-session';
      const flushSpy = vi.fn();

      accumulator.on('flush', flushSpy);

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      accumulator.addChunk(sessionId, 'partial', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      // Advance time to trigger flush
      vi.advanceTimersByTime(150);

      expect(flushSpy).toHaveBeenCalled();
    });

    it('should reset flush timer on new chunks', () => {
      const sessionId = 'test-session';
      const flushSpy = vi.fn();

      accumulator.on('flush', flushSpy);

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      accumulator.addChunk(sessionId, 'first', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      // Advance time but not enough to flush
      vi.advanceTimersByTime(50);

      // Add another chunk, should reset timer
      accumulator.addChunk(sessionId, ' second', {
        timestamp: new Date(),
        sequenceNumber: 2,
      });

      // Advance time again
      vi.advanceTimersByTime(60);

      // Should not have flushed yet
      expect(flushSpy).not.toHaveBeenCalled();

      // Advance past flush interval
      vi.advanceTimersByTime(50);

      expect(flushSpy).toHaveBeenCalled();
    });
  });

  describe('Statistics', () => {
    it('should track accumulation statistics', () => {
      const sessions = ['session-1', 'session-2'];

      sessions.forEach((sessionId, index) => {
        accumulator.startAccumulation(sessionId, {
          messageId: `msg-${index}`,
          role: 'assistant',
        });

        accumulator.addChunk(sessionId, 'x'.repeat(100), {
          timestamp: new Date(),
          sequenceNumber: 1,
        });
      });

      const stats = accumulator.getStats();
      expect(stats.activeAccumulators).toBe(2);
      expect(stats.totalBytesAccumulated).toBe(200);
      expect(stats.totalChunksProcessed).toBe(2);
    });

    it('should track largest message', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      accumulator.addChunk(sessionId, 'x'.repeat(500), {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      accumulator.complete(sessionId);

      const stats = accumulator.getStats();
      expect(stats.largestMessage).toBe(500);
    });
  });

  describe('Recovery', () => {
    it('should recover partial messages', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      accumulator.addChunk(sessionId, 'partial message', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      // Get partial message without finishing
      const partial = accumulator.getAccumulated(sessionId);
      expect(partial?.content).toBe('partial message');
      expect(partial?.isComplete).toBe(false);
    });

    it('should clear accumulation', () => {
      const sessionId = 'test-session';

      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      accumulator.addChunk(sessionId, 'to be cleared', {
        timestamp: new Date(),
        sequenceNumber: 1,
      });

      accumulator.clear(sessionId);

      const result = accumulator.getAccumulated(sessionId);
      expect(result).toBeUndefined();
    });
  });
});
