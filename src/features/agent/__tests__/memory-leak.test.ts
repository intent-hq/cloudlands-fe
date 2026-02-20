/**
 * Memory Leak Tests
 *
 * Tests to ensure proper cleanup and disposal of resources
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageAccumulatorService } from '../services/message-accumulator.service';

// Mock disposal classes for testing
class DisposeManager {
  private static instance: DisposeManager;
  private disposables = new Map<string, { dispose: () => void | Promise<void>; name: string }>();
  private disposed = new Set<string>();

  static getInstance(): DisposeManager {
    if (!DisposeManager.instance) {
      DisposeManager.instance = new DisposeManager();
    }
    return DisposeManager.instance;
  }

  register(disposable: { dispose: () => void | Promise<void> }, name: string): string {
    const id = `${name}-${Date.now()}-${Math.random()}`;
    this.disposables.set(id, { dispose: disposable.dispose, name });
    return id;
  }

  async dispose(id: string): Promise<void> {
    const disposable = this.disposables.get(id);
    if (disposable && !this.disposed.has(id)) {
      try {
        await disposable.dispose();
      } catch (error) {
        // Swallow errors to match expected behavior
      }
      this.disposed.add(id);
    }
  }

  async disposeAll(): Promise<void> {
    for (const [id, disposable] of this.disposables.entries()) {
      if (!this.disposed.has(id)) {
        try {
          await disposable.dispose();
        } catch (error) {
          // Continue disposing other resources even if one fails
        }
        this.disposed.add(id);
      }
    }
  }

  reset(): void {
    this.disposables.clear();
    this.disposed.clear();
  }

  getStats(): { total: number; disposed: number; byName: Map<string, number> } {
    const byName = new Map<string, number>();
    for (const [, { name }] of this.disposables) {
      byName.set(name, (byName.get(name) || 0) + 1);
    }
    return {
      total: this.disposables.size,
      disposed: this.disposed.size,
      byName,
    };
  }
}

class DisposableEventListener {
  private target: EventTarget;
  private event: string;
  private handler: EventListener;
  private options?: AddEventListenerOptions;

  constructor(
    target: EventTarget,
    event: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ) {
    this.target = target;
    this.event = event;
    this.handler = handler;
    this.options = options;
    target.addEventListener(event, handler, options);
  }

  dispose(): void {
    this.target.removeEventListener(this.event, this.handler, this.options);
  }
}

class DisposableTimer {
  private timerId: NodeJS.Timeout | null;
  private isInterval: boolean;

  private constructor(timerId: NodeJS.Timeout, isInterval: boolean) {
    this.timerId = timerId;
    this.isInterval = isInterval;
  }

  static setTimeout(callback: () => void, delay: number): DisposableTimer {
    const timerId = setTimeout(callback, delay);
    return new DisposableTimer(timerId, false);
  }

  static setInterval(callback: () => void, delay: number): DisposableTimer {
    const timerId = setInterval(callback, delay);
    return new DisposableTimer(timerId, true);
  }

  dispose(): void {
    if (this.timerId) {
      if (this.isInterval) {
        clearInterval(this.timerId);
      } else {
        clearTimeout(this.timerId);
      }
      this.timerId = null;
    }
  }
}

class DisposableCollection {
  private disposables: Array<{ dispose: () => void }> = [];

  add(disposable: { dispose: () => void }): void {
    this.disposables.push(disposable);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      try {
        disposable.dispose();
      } catch (error) {
        // Continue disposing other resources even if one fails
      }
    }
    this.disposables = [];
  }
}

describe('Memory Leak Prevention', () => {
  let disposeManager: DisposeManager;

  beforeEach(() => {
    disposeManager = DisposeManager.getInstance();
    disposeManager.reset(); // Reset before each test
  });

  afterEach(async () => {
    // Only dispose if not already disposed (for error handling tests)
    if (disposeManager.getStats().total > 0) {
      await disposeManager.disposeAll();
    }
    disposeManager.reset(); // Reset for next test
  });

  describe('DisposeManager', () => {
    it('should register and dispose resources', async () => {
      const mockDisposable = {
        dispose: vi.fn(),
      };

      const id = disposeManager.register(mockDisposable, 'test-resource');
      expect(id).toBeTruthy();

      await disposeManager.dispose(id);
      expect(mockDisposable.dispose).toHaveBeenCalledOnce();
    });

    it('should dispose all resources on disposeAll', async () => {
      const disposables = Array.from({ length: 5 }, (_, i) => ({
        dispose: vi.fn(),
        name: `resource-${i}`,
      }));

      const ids = disposables.map((d, i) => disposeManager.register(d, d.name));

      await disposeManager.disposeAll();

      disposables.forEach((d) => {
        expect(d.dispose).toHaveBeenCalledOnce();
      });
    });

    it('should handle disposal errors gracefully', async () => {
      const errorDisposable = {
        dispose: vi.fn(() => {
          throw new Error('Disposal failed');
        }),
      };

      const id = disposeManager.register(errorDisposable, 'error-resource');

      // Should not throw
      await expect(disposeManager.dispose(id)).resolves.not.toThrow();

      // Clean up manually since dispose failed
      disposeManager.reset();
    });

    it('should track disposal statistics', () => {
      // Start fresh
      disposeManager.reset();

      const disposables = [{ dispose: vi.fn() }, { dispose: vi.fn() }, { dispose: vi.fn() }];

      disposeManager.register(disposables[0], 'type-a');
      disposeManager.register(disposables[1], 'type-a');
      disposeManager.register(disposables[2], 'type-b');

      const stats = disposeManager.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byName.get('type-a')).toBe(2);
      expect(stats.byName.get('type-b')).toBe(1);
    });
  });

  describe('DisposableEventListener', () => {
    it('should add and remove event listeners', () => {
      // Create a mock EventTarget since we might not have DOM
      const target = new EventTarget();
      const handler = vi.fn();

      const disposable = new DisposableEventListener(target, 'click', handler);

      // Trigger event
      target.dispatchEvent(new Event('click'));
      expect(handler).toHaveBeenCalledOnce();

      // Dispose
      disposable.dispose();

      // Should not trigger after disposal
      target.dispatchEvent(new Event('click'));
      expect(handler).toHaveBeenCalledOnce(); // Still only once
    });

    it('should handle options correctly', () => {
      // Create a mock EventTarget
      const target = new EventTarget();
      const handler = vi.fn();

      const disposable = new DisposableEventListener(target, 'click', handler, {
        capture: true,
        once: true,
      });

      target.dispatchEvent(new Event('click', { bubbles: true }));
      expect(handler).toHaveBeenCalledOnce();

      disposable.dispose();
    });
  });

  describe('DisposableTimer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should handle setTimeout disposal', () => {
      const callback = vi.fn();
      const timer = DisposableTimer.setTimeout(callback, 1000);

      vi.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();

      timer.dispose();

      vi.advanceTimersByTime(600);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle setInterval disposal', () => {
      const callback = vi.fn();
      const timer = DisposableTimer.setInterval(callback, 100);

      vi.advanceTimersByTime(250);
      expect(callback).toHaveBeenCalledTimes(2);

      timer.dispose();

      vi.advanceTimersByTime(200);
      expect(callback).toHaveBeenCalledTimes(2); // No more calls
    });
  });

  describe('DisposableCollection', () => {
    it('should dispose multiple resources', async () => {
      const disposables = Array.from({ length: 3 }, () => ({
        dispose: vi.fn(),
      }));

      const collection = new DisposableCollection();
      disposables.forEach((d) => collection.add(d));

      collection.dispose();

      disposables.forEach((d) => {
        expect(d.dispose).toHaveBeenCalledOnce();
      });
    });

    it('should handle disposal errors in collection', async () => {
      const disposables = [
        { dispose: vi.fn() },
        {
          dispose: vi.fn(() => {
            throw new Error('Failed');
          }),
        },
        { dispose: vi.fn() },
      ];

      const collection = new DisposableCollection();
      disposables.forEach((d) => collection.add(d));

      // Should not throw
      collection.dispose();

      // All should be called despite error
      expect(disposables[0].dispose).toHaveBeenCalled();
      expect(disposables[1].dispose).toHaveBeenCalled();
      expect(disposables[2].dispose).toHaveBeenCalled();
    });
  });

  describe('MessageAccumulatorService Memory Management', () => {
    let accumulator: MessageAccumulatorService;

    beforeEach(() => {
      MessageAccumulatorService.resetInstance();
      accumulator = MessageAccumulatorService.getInstance();
    });

    afterEach(() => {
      accumulator.dispose();
    });

    it('should clean up timers on dispose', () => {
      const sessionId = 'test-session';

      // Start accumulation which creates timers
      accumulator.startAccumulation(sessionId, {
        messageId: 'msg-1',
        role: 'assistant',
      });

      // Add some chunks
      accumulator.addChunk(sessionId, 'test', {
        sequenceNumber: 1,
      });

      // Spy on clearTimeout
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Dispose should clear all timers
      accumulator.dispose();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should clear all accumulators on dispose', () => {
      const sessions = ['session-1', 'session-2', 'session-3'];

      sessions.forEach((sessionId) => {
        accumulator.startAccumulation(sessionId, {
          messageId: `msg-${sessionId}`,
          role: 'assistant',
        });
        accumulator.addChunk(sessionId, `content for ${sessionId}`, {
          sequenceNumber: 1,
        });
      });

      const statsBefore = accumulator.getStats();
      expect(statsBefore.activeAccumulators).toBe(3);

      accumulator.dispose();

      // After disposal, getting instance should return a new one
      MessageAccumulatorService.resetInstance();
      const newAccumulator = MessageAccumulatorService.getInstance();
      const statsAfter = newAccumulator.getStats();
      expect(statsAfter.activeAccumulators).toBe(0);
    });

    it('should remove all event listeners on dispose', () => {
      const listener = vi.fn();
      accumulator.on('chunk', listener);
      accumulator.on('complete', listener);
      accumulator.on('error', listener);

      // Verify listeners are registered
      accumulator.emit('chunk', {});
      expect(listener).toHaveBeenCalledOnce();

      // Get listener count before disposal
      const listenerCountBefore = accumulator.listenerCount('chunk');
      expect(listenerCountBefore).toBeGreaterThan(0);

      accumulator.dispose();

      // After disposal, no listeners should remain
      const listenerCountAfter = accumulator.listenerCount('chunk');
      expect(listenerCountAfter).toBe(0);

      // Should still be called only once (from before disposal)
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should prevent operations after disposal', () => {
      accumulator.dispose();

      // Attempting to use after disposal should throw an error
      expect(() => {
        accumulator.startAccumulation('test', {
          messageId: 'msg-1',
          role: 'assistant',
        });
      }).toThrow('MessageAccumulatorService has been disposed');
    });
  });
});
