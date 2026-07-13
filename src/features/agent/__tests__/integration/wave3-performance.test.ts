/**
 * Wave 3 Performance Integration Tests
 *
 * Tests for performance characteristics and memory efficiency
 * of the refactored agent system.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { ListenerManager } from '../../../../shared/utils/listener-manager';
import { MemoryMonitor } from '../../../../shared/monitoring/memory-monitor';
import { EventEmitter } from '../../../../shared/event-emitter';

describe('Wave 3 Performance Integration', () => {
  let listenerManager: ListenerManager;
  let memoryMonitor: MemoryMonitor;

  beforeEach(() => {
    listenerManager = new ListenerManager();
    memoryMonitor = new MemoryMonitor({
      checkInterval: 100,
      warningThreshold: 500 * 1024 * 1024,
      enableGC: false,
    });
  });

  afterEach(() => {
    listenerManager.cleanup();
    memoryMonitor.stop();
  });

  it('should manage many listeners efficiently', () => {
    const emitter = new EventEmitter();
    const startTime = Date.now();

    // Add 100 listeners
    for (let i = 0; i < 100; i++) {
      listenerManager.addListener(emitter, `event-${i}`, () => {});
    }

    const addTime = Date.now() - startTime;
    expect(addTime).toBeLessThan(500); // Should add 100 listeners in < 500ms

    // Cleanup
    const cleanupStart = Date.now();
    listenerManager.cleanup();
    const cleanupTime = Date.now() - cleanupStart;

    expect(cleanupTime).toBeLessThan(100); // Should cleanup in < 100ms
    expect(listenerManager.getListenerCount()).toBe(0);
  });

  it('should track memory stats efficiently', async () => {
    const stats: any[] = [];

    memoryMonitor.on('stats', (stat: any) => {
      stats.push(stat);
    });

    memoryMonitor.start();

    await new Promise((resolve) => {
      setTimeout(() => {
        expect(stats.length).toBeGreaterThan(0);

        const history = memoryMonitor.getHistory();
        expect(history.length).toBeGreaterThan(0);

        const avg = memoryMonitor.getAverageUsage();
        expect(avg).toBeGreaterThan(0);

        memoryMonitor.stop();
        resolve(undefined);
      }, 300);
    });
  });

  it('should handle rapid listener add/remove cycles', () => {
    const emitter = new EventEmitter();
    const startTime = Date.now();

    // Rapid add/remove cycles
    for (let i = 0; i < 50; i++) {
      const cleanup = listenerManager.addListener(emitter, 'test', () => {});
      cleanup();
    }

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(500); // Should complete in < 500ms
    expect(listenerManager.getListenerCount()).toBe(0);
  });

  it('should maintain performance with concurrent listener operations', () => {
    const emitters = Array.from({ length: 10 }, () => new EventEmitter());

    const startTime = Date.now();

    // Concurrent listener operations
    emitters.forEach((emitter) => {
      listenerManager.addListener(emitter, 'test', () => {});
    });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(500); // All operations in < 500ms
    expect(listenerManager.getListenerCount()).toBe(10);
  });
});
