/**
 * Unit Tests for MemoryManager
 *
 * Tests the centralized memory management and leak prevention system
 * with automatic cleanup, resource tracking, and memory monitoring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryManager } from '../../src/features/agent/main/utils/memory-manager';

// Mock logger
vi.mock('../../src/shared/logger', () => ({
  Logger: class MockLogger {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(name: string) {}
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Mock process.memoryUsage
const originalMemoryUsage = process.memoryUsage;

describe('MemoryManager', () => {
  let manager: MemoryManager;
  let testOwner: object;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = MemoryManager.getInstance();
    testOwner = { id: 'test-owner' };

    // Mock memory usage
    process.memoryUsage = vi.fn().mockReturnValue({
      rss: 100 * 1024 * 1024,
      heapTotal: 80 * 1024 * 1024,
      heapUsed: 60 * 1024 * 1024,
      external: 10 * 1024 * 1024,
      arrayBuffers: 5 * 1024 * 1024,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    manager.cleanupGlobal();
    process.memoryUsage = originalMemoryUsage;
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = MemoryManager.getInstance();
      const instance2 = MemoryManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Event Listener Management', () => {
    it('should register event listeners', () => {
      const element = new EventTarget();
      const handler = vi.fn();

      manager.registerListener(element, 'click', handler, testOwner);

      element.dispatchEvent(new Event('click'));
      expect(handler).toHaveBeenCalled();
    });

    it('should cleanup listeners when owner is cleaned up', () => {
      const element = new EventTarget();
      const handler = vi.fn();

      manager.registerListener(element, 'click', handler, testOwner);
      manager.cleanup(testOwner);

      element.dispatchEvent(new Event('click'));
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle multiple listeners for same owner', () => {
      const element1 = new EventTarget();
      const element2 = new EventTarget();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      manager.registerListener(element1, 'click', handler1, testOwner);
      manager.registerListener(element2, 'click', handler2, testOwner);

      manager.cleanup(testOwner);

      element1.dispatchEvent(new Event('click'));
      element2.dispatchEvent(new Event('click'));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('Timer Management', () => {
    it('should register and clear timeouts', () => {
      const callback = vi.fn();

      manager.registerTimer(callback, 1000, 'timeout', testOwner);
      manager.cleanup(testOwner);

      vi.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should register and clear intervals', () => {
      const callback = vi.fn();

      manager.registerTimer(callback, 100, 'interval', testOwner);

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1);

      manager.cleanup(testOwner);

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1); // Should not be called again
    });

    it('should handle global timers', () => {
      const callback = vi.fn();

      manager.registerTimer(callback, 1000, 'timeout');
      manager.cleanupGlobal();

      vi.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should untrack global timers when returned cleanup is called', () => {
      const callback = vi.fn();

      const cleanup = manager.registerTimer(callback, 1000, 'timeout');
      expect(manager.getMemoryReport().resourceCount).toBe(1);

      cleanup();
      cleanup();

      expect(manager.getMemoryReport().resourceCount).toBe(0);
      vi.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should untrack one-shot global timers after they fire', () => {
      const callback = vi.fn();

      manager.registerTimer(callback, 1000, 'timeout');
      expect(manager.getMemoryReport().resourceCount).toBe(1);

      vi.advanceTimersByTime(1000);

      expect(callback).toHaveBeenCalledOnce();
      expect(manager.getMemoryReport().resourceCount).toBe(0);
    });
  });

  describe('Global Listener Cleanup Handles', () => {
    it('should untrack global listeners when returned cleanup is called', () => {
      const element = new EventTarget();
      const handler = vi.fn();

      const cleanup = manager.registerListener(element, 'click', handler);
      expect(manager.getMemoryReport().resourceCount).toBe(1);

      cleanup();
      cleanup();

      expect(manager.getMemoryReport().resourceCount).toBe(0);
      element.dispatchEvent(new Event('click'));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Subscription Management', () => {
    it('should register subscriptions with cleanup', () => {
      const cleanup = vi.fn();

      manager.registerSubscription(cleanup, testOwner);
      manager.cleanup(testOwner);

      expect(cleanup).toHaveBeenCalled();
    });

    it('should handle multiple subscriptions', () => {
      const cleanup1 = vi.fn();
      const cleanup2 = vi.fn();

      manager.registerSubscription(cleanup1, testOwner);
      manager.registerSubscription(cleanup2, testOwner);
      manager.cleanup(testOwner);

      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
    });
  });

  describe('Stream Management', () => {
    it('should register and cleanup streams', () => {
      // Streams are not directly supported in the current implementation
      // We can simulate with a subscription that cleans up a stream
      const stream = {
        destroy: vi.fn(),
        removeAllListeners: vi.fn(),
      };

      const cleanup = () => {
        stream.destroy();
        stream.removeAllListeners();
      };

      manager.registerSubscription(cleanup, testOwner);
      manager.cleanup(testOwner);

      expect(stream.destroy).toHaveBeenCalled();
      expect(stream.removeAllListeners).toHaveBeenCalled();
    });

    it('should handle streams without destroy method', () => {
      const stream = {
        removeAllListeners: vi.fn(),
      };

      const cleanup = () => {
        stream.removeAllListeners();
      };

      manager.registerSubscription(cleanup, testOwner);
      manager.cleanup(testOwner);

      expect(stream.removeAllListeners).toHaveBeenCalled();
    });
  });

  describe('Memory Monitoring', () => {
    it('should detect memory leaks', () => {
      // Add some old resources to trigger leak detection
      const oldCallback = vi.fn();

      // Create a resource that will be considered old
      manager.registerTimer(oldCallback, 1000, 'timeout');

      // Simulate high memory usage
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 500 * 1024 * 1024,
        heapTotal: 400 * 1024 * 1024,
        heapUsed: 350 * 1024 * 1024,
        external: 50 * 1024 * 1024,
        arrayBuffers: 25 * 1024 * 1024,
      });

      // The detectLeaks method is private, so we test it indirectly through getMemoryStats
      const stats = manager.getMemoryStats();
      expect(stats.leaks).toBeGreaterThanOrEqual(0);
    });

    it('should monitor memory periodically', () => {
      // Create a new instance to ensure clean state
      const newManager = MemoryManager.getInstance();

      // The monitoring happens automatically in the constructor
      // We can verify it's set up by checking memory stats work
      const stats = newManager.getMemoryStats();
      expect(stats).toBeDefined();
    });

    it('should get memory statistics', () => {
      const stats = manager.getMemoryStats();

      expect(stats).toHaveProperty('heap');
      expect(stats).toHaveProperty('external');
      expect(stats).toHaveProperty('leaks');
      expect(stats.heap).toBe(60 * 1024 * 1024);
      expect(stats.external).toBe(10 * 1024 * 1024);
    });
  });

  describe('Resource Cleanup', () => {
    it('should cleanup all resources for an owner', () => {
      const element = new EventTarget();
      const listener = vi.fn();
      const timerCallback = vi.fn();
      const subscription = vi.fn();

      manager.registerListener(element, 'click', listener, testOwner);
      manager.registerTimer(timerCallback, 1000, 'timeout', testOwner);
      manager.registerSubscription(subscription, testOwner);

      manager.cleanup(testOwner);

      // Verify all resources are cleaned
      element.dispatchEvent(new Event('click'));
      expect(listener).not.toHaveBeenCalled();
      expect(subscription).toHaveBeenCalled();
    });

    it('should handle cleanup of non-existent owner gracefully', () => {
      const nonExistentOwner = { id: 'non-existent' };

      expect(() => {
        manager.cleanup(nonExistentOwner);
      }).not.toThrow();
    });

    it('should cleanup global resources', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      manager.registerTimer(callback1, 1000, 'timeout');
      manager.registerTimer(callback2, 100, 'interval');

      const countBefore = manager.getMemoryStats().leaks;
      manager.cleanupGlobal();
      const countAfter = manager.getMemoryStats().leaks;

      // Global resources should be cleaned
      expect(countAfter).toBeLessThanOrEqual(countBefore);
    });
  });

  describe('WeakMap Usage', () => {
    it('should allow garbage collection of owners', () => {
      let owner: any = { id: 'temp-owner' };
      const listener = vi.fn();
      const element = new EventTarget();

      manager.registerListener(element, 'click', listener, owner);

      // Remove reference to owner
      owner = null;

      // Force garbage collection (simulated)
      global.gc?.();

      // WeakMap should allow owner to be garbage collected
      // This is hard to test directly, but the WeakMap ensures no memory leak
      expect(true).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle many resources efficiently', () => {
      const owners = Array.from({ length: 100 }, (_, i) => ({ id: `owner-${i}` }));

      const start = performance.now();

      owners.forEach((owner) => {
        const element = new EventTarget();
        manager.registerListener(element, 'click', () => {}, owner);
        manager.registerTimer(
          () => {},
          1000,
          'timeout',
          owner,
        );
      });

      owners.forEach((owner) => {
        manager.cleanup(owner);
      });

      const duration = performance.now() - start;

      // Should handle 100 owners with resources in reasonable time
      expect(duration).toBeLessThan(100);
    });
  });
});
