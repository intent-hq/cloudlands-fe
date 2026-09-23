/**
 * Wave 3 Performance Integration Tests
 *
 * Tests for the listener bookkeeping of the refactored agent system. The
 * guards are unit-growth bounds (emitter subscribe/unsubscribe calls and
 * listener counts), not wall-clock budgets, so they hold under CI load.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ListenerManager } from '../../../../shared/utils/listener-manager';
import { EventEmitter } from '../../../../shared/event-emitter';

describe('Wave 3 Performance Integration', () => {
  let listenerManager: ListenerManager;

  beforeEach(() => {
    listenerManager = new ListenerManager();
  });

  afterEach(() => {
    listenerManager.cleanup();
  });

  it('should subscribe many listeners once each and detach them all on cleanup', () => {
    const emitter = new EventEmitter();
    const on = vi.spyOn(emitter, 'on');
    const off = vi.spyOn(emitter, 'off');

    // Add 100 listeners
    for (let i = 0; i < 100; i++) {
      listenerManager.addListener(emitter, `event-${i}`, () => {});
    }

    expect(on).toHaveBeenCalledTimes(100); // One subscribe per listener, no retries
    expect(off).not.toHaveBeenCalled();
    expect(listenerManager.getListenerCount()).toBe(100);

    // Cleanup
    listenerManager.cleanup();

    expect(off).toHaveBeenCalledTimes(100); // One unsubscribe per listener
    expect(listenerManager.getListenerCount()).toBe(0);
    for (let i = 0; i < 100; i++) {
      expect(emitter.listenerCount(`event-${i}`)).toBe(0);
    }
  });

  it('should handle rapid listener add/remove cycles without leaking', () => {
    const emitter = new EventEmitter();
    const on = vi.spyOn(emitter, 'on');
    const off = vi.spyOn(emitter, 'off');

    // Rapid add/remove cycles
    for (let i = 0; i < 50; i++) {
      const cleanup = listenerManager.addListener(emitter, 'test', () => {});
      cleanup();
      expect(listenerManager.getListenerCount()).toBe(0);
    }

    expect(on).toHaveBeenCalledTimes(50);
    expect(off).toHaveBeenCalledTimes(50);
    expect(emitter.listenerCount('test')).toBe(0);
    expect(listenerManager.getListenerCount()).toBe(0);
  });

  it('should track one listener per emitter across many emitters', () => {
    const emitters = Array.from({ length: 10 }, () => new EventEmitter());

    emitters.forEach((emitter) => {
      listenerManager.addListener(emitter, 'test', () => {});
    });

    expect(listenerManager.getListenerCount()).toBe(10);
    for (const emitter of emitters) {
      expect(emitter.listenerCount('test')).toBe(1);
    }

    listenerManager.cleanup();

    expect(listenerManager.getListenerCount()).toBe(0);
    for (const emitter of emitters) {
      expect(emitter.listenerCount('test')).toBe(0);
    }
  });
});
