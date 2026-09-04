import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ListenerManager } from '../listener-manager';
import { EventEmitter } from '../../event-emitter';

describe('ListenerManager', () => {
  let manager: ListenerManager;

  beforeEach(() => {
    manager = new ListenerManager();
  });

  it('should add and remove DOM event listeners', () => {
    const target = new EventTarget();
    const handler = vi.fn();

    const cleanup = manager.addListener(target, 'click', handler);

    expect(manager.getListenerCount()).toBe(1);

    cleanup();

    expect(manager.getListenerCount()).toBe(0);
  });

  it('should add and remove EventEmitter listeners', () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();

    const cleanup = manager.addListener(emitter, 'test', handler);

    expect(manager.getListenerCount()).toBe(1);

    cleanup();

    expect(manager.getListenerCount()).toBe(0);
  });

  it('should add multiple listeners at once', () => {
    const emitter1 = new EventEmitter();
    const emitter2 = new EventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const cleanup = manager.addListeners([
      { target: emitter1, event: 'event1', handler: handler1 },
      { target: emitter2, event: 'event2', handler: handler2 },
    ]);

    expect(manager.getListenerCount()).toBe(2);

    cleanup();

    expect(manager.getListenerCount()).toBe(0);
  });

  it('should clean up all listeners', () => {
    const emitter1 = new EventEmitter();
    const emitter2 = new EventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    manager.addListener(emitter1, 'event1', handler1);
    manager.addListener(emitter2, 'event2', handler2);

    expect(manager.getListenerCount()).toBe(2);

    manager.cleanup();

    expect(manager.getListenerCount()).toBe(0);
  });

  it('should return cleanup function', () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();

    manager.addListener(emitter, 'test', handler);
    const cleanupFn = manager.getCleanupFunction();

    expect(manager.getListenerCount()).toBe(1);

    cleanupFn();

    expect(manager.getListenerCount()).toBe(0);
  });

  it('should handle errors during cleanup gracefully', () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();

    manager.addListener(emitter, 'test', handler);

    // This should not throw
    expect(() => manager.cleanup()).not.toThrow();
  });

  it('should track listener count correctly', () => {
    const emitter = new EventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    manager.addListener(emitter, 'event1', handler1);
    expect(manager.getListenerCount()).toBe(1);

    manager.addListener(emitter, 'event2', handler2);
    expect(manager.getListenerCount()).toBe(2);

    manager.addListener(emitter, 'event3', handler3);
    expect(manager.getListenerCount()).toBe(3);

    manager.cleanup();
    expect(manager.getListenerCount()).toBe(0);
  });
});
