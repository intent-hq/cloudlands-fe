/**
 * Tests for Message Accumulator Service
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageAccumulatorService } from '../message-accumulator.service';
import { AgentError, AgentErrorCode } from '../../errors/agent-errors';

describe('MessageAccumulatorService', () => {
  let accumulator: MessageAccumulatorService;

  beforeEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();

    // Reset the singleton instance for each test
    MessageAccumulatorService.resetInstance();

    // Create a new instance for each test
    accumulator = MessageAccumulatorService.getInstance({
      flushInterval: 100, // Short interval for testing
      checkpointInterval: 50,
      maxMessageSize: 1024, // 1KB for testing
    });
    accumulator.clearAll();
    accumulator.resetStats();
  });

  afterEach(() => {
    accumulator.clearAll();
    vi.clearAllTimers();
    vi.useRealTimers();
    MessageAccumulatorService.resetInstance();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = MessageAccumulatorService.getInstance();
      const instance2 = MessageAccumulatorService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Start Accumulation', () => {
    it('should start accumulation for a session', () => {
      const sessionId = 'test-session-123';
      accumulator.startAccumulation(sessionId, { agentId: 'agent-123' });

      const accumulated = accumulator.getAccumulated(sessionId);
      expect(accumulated).toBeDefined();
      expect(accumulated?.sessionId).toBe(sessionId);
      expect(accumulated?.content).toBe('');
      expect(accumulated?.chunks).toHaveLength(0);
      expect(accumulated?.isComplete).toBe(false);
    });

    it('should not create duplicate accumulators', () => {
      const sessionId = 'test-session-123';
      accumulator.startAccumulation(sessionId);
      accumulator.startAccumulation(sessionId); // Try to start again

      const stats = accumulator.getStats();
      expect(stats.activeAccumulators).toBe(1);
    });

    it('should emit start event', () => {
      const handler = vi.fn();
      accumulator.on('accumulation:started', handler);

      const sessionId = 'test-session-123';
      accumulator.startAccumulation(sessionId);
      accumulator.flushBatch(); // Flush any pending async operations

      expect(handler).toHaveBeenCalledWith({ sessionId });
    });
  });

  describe('Add Chunks', () => {
    const sessionId = 'test-session-123';

    beforeEach(() => {
      accumulator.startAccumulation(sessionId);
    });

    it('should add chunks to accumulator', () => {
      accumulator.addChunk(sessionId, 'Hello ');
      accumulator.addChunk(sessionId, 'World!');

      const accumulated = accumulator.getAccumulated(sessionId);
      expect(accumulated?.content).toBe('Hello World!');
      expect(accumulated?.chunks).toHaveLength(2);
      expect(accumulated?.chunkCount).toBe(2);
    });

    it('should track sequence numbers', () => {
      accumulator.addChunk(sessionId, 'First');
      accumulator.addChunk(sessionId, 'Second');
      accumulator.addChunk(sessionId, 'Third');

      const accumulated = accumulator.getAccumulated(sessionId);
      expect(accumulated?.chunks[0].sequenceNumber).toBe(1);
      expect(accumulated?.chunks[1].sequenceNumber).toBe(2);
      expect(accumulated?.chunks[2].sequenceNumber).toBe(3);
    });

    it('should track byte size', () => {
      const chunk = 'Test chunk';
      accumulator.addChunk(sessionId, chunk);

      const accumulated = accumulator.getAccumulated(sessionId);
      expect(accumulated?.byteSize).toBe(Buffer.byteLength(chunk, 'utf8'));
    });

    it('should throw error when exceeding size limit', () => {
      const largeChunk = 'x'.repeat(2000); // Exceeds 1KB limit

      expect(() => {
        accumulator.addChunk(sessionId, largeChunk);
      }).toThrow(AgentError);
    });

    it('should not add chunks to completed accumulator', () => {
      accumulator.addChunk(sessionId, 'First');
      accumulator.complete(sessionId);
      accumulator.addChunk(sessionId, 'Second'); // Should be ignored

      const accumulated = accumulator.getAccumulated(sessionId);
      expect(accumulated?.content).toBe('First');
      expect(accumulated?.chunks).toHaveLength(1);
    });

    it('should emit chunk added event', () => {
      const handler = vi.fn();
      accumulator.on('chunk:added', handler);

      accumulator.addChunk(sessionId, 'Test');
      accumulator.flushBatch(); // Flush any pending async operations

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          sequenceNumber: 1,
        }),
      );
    });

    it('should include metadata with chunks', () => {
      const metadata = { source: 'test' };
      accumulator.addChunk(sessionId, 'Test', metadata);

      const accumulated = accumulator.getAccumulated(sessionId);
      expect(accumulated?.chunks[0].metadata).toEqual(metadata);
    });
  });

  describe('Content Blocks', () => {
    const sessionId = 'test-session-123';

    beforeEach(() => {
      accumulator.startAccumulation(sessionId);
    });

    it('should add content blocks', () => {
      const block = { type: 'tool_call', content: 'test' };
      accumulator.addContentBlock(sessionId, block as any);

      const accumulated = accumulator.getAccumulated(sessionId);
      expect(accumulated?.contentBlocks).toHaveLength(1);
      expect(accumulated?.contentBlocks[0]).toEqual(block);
    });

    it('should emit block added event', () => {
      const handler = vi.fn();
      accumulator.on('block:added', handler);

      const block = { type: 'tool_call', content: 'test' };
      accumulator.addContentBlock(sessionId, block as any);
      accumulator.flushBatch(); // Flush any pending async operations

      expect(handler).toHaveBeenCalledWith({ sessionId, block });
    });
  });

  describe('Complete Accumulation', () => {
    const sessionId = 'test-session-123';

    beforeEach(() => {
      accumulator.startAccumulation(sessionId);
    });

    it('should complete accumulation', () => {
      accumulator.addChunk(sessionId, 'Test content');
      const completed = accumulator.complete(sessionId);

      expect(completed.isComplete).toBe(true);
      expect(completed.content).toBe('Test content');
    });

    it('should emit completion event', () => {
      const handler = vi.fn();
      accumulator.on('accumulation:completed', handler);

      accumulator.addChunk(sessionId, 'Test');
      accumulator.complete(sessionId);
      accumulator.flushBatch(); // Flush any pending async operations

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          message: expect.objectContaining({
            content: 'Test',
            isComplete: true,
          }),
        }),
      );
    });

    it('should throw error for non-existent session', () => {
      expect(() => {
        accumulator.complete('non-existent');
      }).toThrow(AgentError);
    });
  });

  describe('Get Partial Content', () => {
    const sessionId = 'test-session-123';

    it('should get partial content', () => {
      accumulator.startAccumulation(sessionId);
      accumulator.addChunk(sessionId, 'Partial ');
      accumulator.addChunk(sessionId, 'content');

      const partial = accumulator.getPartialContent(sessionId);
      expect(partial.content).toBe('Partial content');
      expect(partial.contentBlocks).toBeDefined();
    });

    it('should return empty content for non-existent session', () => {
      const partial = accumulator.getPartialContent('non-existent');
      expect(partial.content).toBe('');
      expect(partial.contentBlocks).toEqual([]);
    });
  });

  describe('Clear Accumulator', () => {
    const sessionId = 'test-session-123';

    beforeEach(() => {
      accumulator.startAccumulation(sessionId);
    });

    it('should clear specific accumulator', () => {
      accumulator.addChunk(sessionId, 'Test');
      accumulator.clear(sessionId);

      const accumulated = accumulator.getAccumulated(sessionId);
      expect(accumulated).toBeUndefined();
    });

    it('should emit clear event', () => {
      const handler = vi.fn();
      accumulator.on('accumulation:cleared', handler);

      accumulator.clear(sessionId);
      accumulator.flushBatch(); // Flush any pending async operations

      expect(handler).toHaveBeenCalledWith({ sessionId });
    });

    it('should update stats when clearing', () => {
      const stats1 = accumulator.getStats();
      expect(stats1.activeAccumulators).toBe(1);

      accumulator.clear(sessionId);

      const stats2 = accumulator.getStats();
      expect(stats2.activeAccumulators).toBe(0);
    });
  });

  describe('Clear All', () => {
    it('should clear all accumulators', () => {
      accumulator.startAccumulation('session-1');
      accumulator.startAccumulation('session-2');
      accumulator.startAccumulation('session-3');

      const stats1 = accumulator.getStats();
      expect(stats1.activeAccumulators).toBe(3);

      accumulator.clearAll();

      const stats2 = accumulator.getStats();
      expect(stats2.activeAccumulators).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should track statistics', () => {
      const sessionId1 = 'session-1';
      const sessionId2 = 'session-2';

      accumulator.startAccumulation(sessionId1);
      accumulator.startAccumulation(sessionId2);

      accumulator.addChunk(sessionId1, 'Test 1');
      accumulator.addChunk(sessionId1, 'Test 2');
      accumulator.addChunk(sessionId2, 'Test 3');

      const stats = accumulator.getStats();
      expect(stats.activeAccumulators).toBe(2);
      expect(stats.totalChunksProcessed).toBe(3);
      expect(stats.totalBytesAccumulated).toBeGreaterThan(0);
      expect(stats.largestMessage).toBeGreaterThan(0);
    });
  });

  describe('Flush Timer', () => {
    it('should emit flush event periodically', async () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      accumulator.on('accumulation:flushed', handler);

      const sessionId = 'test-session';
      accumulator.startAccumulation(sessionId);
      accumulator.addChunk(sessionId, 'Test content');

      // Advance time to trigger flush (100ms is the flush interval)
      // The timer is reset when chunk is added, so we need to wait the full interval
      vi.advanceTimersByTime(100);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          content: 'Test content',
        }),
      );

      vi.useRealTimers();
    });
  });

  describe('Checkpoint Timer', () => {
    it('should emit checkpoint event periodically', async () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      accumulator.on('checkpoint:saved', handler);

      const sessionId = 'test-session';
      accumulator.startAccumulation(sessionId);
      accumulator.addChunk(sessionId, 'Test content');

      // Advance time to trigger checkpoint (50ms is the checkpoint interval)
      vi.advanceTimersByTime(50);

      expect(handler).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          checkpoint: expect.objectContaining({
            content: 'Test content',
          }),
        }),
      );

      vi.useRealTimers();
    });
  });

  describe('Session Aliasing', () => {
    const sessionId = 'test-session-123';
    const aliasId = 'alias-456';

    beforeEach(() => {
      accumulator.startAccumulation(sessionId);
    });

    // Session aliasing has been removed - these tests are no longer applicable
    it.skip('should create session alias - REMOVED FEATURE', () => {
      // Session aliasing has been removed from the accumulator
      // Direct session IDs are now used without aliasing
    });

    it.skip('should resolve alias when getting accumulated content - REMOVED FEATURE', () => {
      // Session aliasing has been removed from the accumulator
      // Direct session IDs are now used without aliasing
    });

    it.skip('should resolve alias in getPartialContent - REMOVED FEATURE', () => {
      // Session aliasing has been removed from the accumulator
      // Direct session IDs are now used without aliasing
    });

    it.skip('should clean up aliases when session is cleared - REMOVED FEATURE', () => {
      // Session aliasing has been removed from the accumulator
      // Direct session IDs are now used without aliasing
    });
  });

  describe('Error Handling', () => {
    it('should throw error when adding chunk to non-existent session', () => {
      expect(() => {
        accumulator.addChunk('non-existent', 'Test');
      }).toThrow(AgentError);
    });

    it('should throw error when adding content block to non-existent session', () => {
      expect(() => {
        accumulator.addContentBlock('non-existent', {} as any);
      }).toThrow(AgentError);
    });
  });
});
