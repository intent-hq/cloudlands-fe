/**
 * Tests for UnifiedSaveQueue
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnifiedSaveQueue } from '../unified-save-queue';
import { installLocalStorageMock } from '$lib/store/utils/test-helpers/local-storage-mock';

const mockLocalStorage = installLocalStorageMock();

describe('UnifiedSaveQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should use default options', () => {
      const queue = new UnifiedSaveQueue();
      expect(queue).toBeDefined();
    });

    it('should accept custom options', () => {
      const onError = vi.fn();
      const queue = new UnifiedSaveQueue({
        debounceMs: 500,
        maxRetries: 5,
        onError,
      });
      expect(queue).toBeDefined();
    });
  });

  describe('schedule', () => {
    it('should add item to queue', () => {
      const queue = new UnifiedSaveQueue({ debounceMs: 100 });
      queue.schedule('test-key', { value: 'test' });
      // Item is queued but not saved yet
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });

    it('should debounce multiple schedules', () => {
      const queue = new UnifiedSaveQueue({ debounceMs: 100 });
      queue.schedule('key1', { value: 1 });
      queue.schedule('key2', { value: 2 });
      queue.schedule('key1', { value: 3 }); // Override key1

      vi.advanceTimersByTime(100);

      // Should save latest value for key1 and key2
      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(2);
    });

    it('should not schedule on disposed queue', () => {
      const queue = new UnifiedSaveQueue({ debounceMs: 100 });
      queue.dispose();
      queue.schedule('test-key', { value: 'test' });

      vi.advanceTimersByTime(100);
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('should save all queued items', async () => {
      const queue = new UnifiedSaveQueue({ debounceMs: 100 });
      queue.schedule('key1', { value: 1 });
      queue.schedule('key2', { value: 2 });

      await queue.flush();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('key1', JSON.stringify({ value: 1 }));
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('key2', JSON.stringify({ value: 2 }));
    });

    it('should do nothing if queue is empty', async () => {
      const queue = new UnifiedSaveQueue();
      await queue.flush();
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });

    it('should call onError for failed saves', async () => {
      const onError = vi.fn();
      const queue = new UnifiedSaveQueue({ maxRetries: 1, onError });

      mockLocalStorage.setItem.mockImplementationOnce(() => {
        throw new Error('Storage error');
      });

      queue.schedule('test-key', { value: 'test' });
      await queue.flush();

      expect(onError).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should mark queue as disposed', () => {
      const queue = new UnifiedSaveQueue();
      queue.dispose();
      // After dispose, schedule should not work
      queue.schedule('test', { value: 1 });
      vi.advanceTimersByTime(1000);
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });

    it('should flush pending items on dispose', async () => {
      const queue = new UnifiedSaveQueue({ debounceMs: 1000 });
      queue.schedule('test-key', { value: 'test' });
      queue.dispose();

      // Wait for async flush
      await vi.advanceTimersByTimeAsync(100);
      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });
  });
});
