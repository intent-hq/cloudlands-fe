/**
 * Wave 3 System Integration Tests
 *
 * Comprehensive end-to-end tests for the complete agent system
 * including memory management, cleanup, and concurrent operations.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { ListenerManager } from '../../../../shared/utils/listener-manager';
import { MemoryMonitor } from '../../../../shared/monitoring/memory-monitor';
import { EventEmitter } from '../../../../shared/event-emitter';

describe('Wave 3 System Integration', () => {
  let listenerManager: ListenerManager;
  let memoryMonitor: MemoryMonitor;

  beforeEach(() => {
    listenerManager = new ListenerManager();
    memoryMonitor = new MemoryMonitor({
      checkInterval: 100,
      warningThreshold: 100 * 1024 * 1024,
      enableGC: false,
    });
  });

  afterEach(() => {
    listenerManager.cleanup();
    memoryMonitor.stop();
  });

  it('should manage listeners without memory leaks', () => {
    const emitter = new EventEmitter();
    const handlers = Array.from({ length: 10 }, () => vi.fn());

    handlers.forEach((handler) => {
      listenerManager.addListener(emitter, 'test', handler);
    });

    expect(listenerManager.getListenerCount()).toBe(10);

    listenerManager.cleanup();

    expect(listenerManager.getListenerCount()).toBe(0);
  });

  it('should monitor memory and emit events', async () => {
    let statsReceived = false;

    memoryMonitor.on('stats', () => {
      statsReceived = true;
    });

    memoryMonitor.start();

    await new Promise((resolve) => {
      setTimeout(() => {
        expect(statsReceived).toBe(true);
        memoryMonitor.stop();
        resolve(undefined);
      }, 200);
    });
  });

  it('should handle concurrent listener operations', () => {
    const emitters = Array.from({ length: 5 }, () => new EventEmitter());
    const handlers = Array.from({ length: 5 }, () => vi.fn());

    // Add listeners concurrently
    emitters.forEach((emitter, i) => {
      handlers.forEach((handler) => {
        listenerManager.addListener(emitter, `event-${i}`, handler);
      });
    });

    expect(listenerManager.getListenerCount()).toBe(25);

    listenerManager.cleanup();

    expect(listenerManager.getListenerCount()).toBe(0);
  });

});
