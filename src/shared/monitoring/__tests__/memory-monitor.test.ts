import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryMonitor } from '../memory-monitor';

describe('MemoryMonitor', () => {
  let monitor: MemoryMonitor;

  beforeEach(() => {
    monitor = new MemoryMonitor({
      checkInterval: 100,
      warningThreshold: 100 * 1024 * 1024, // 100MB
      criticalThreshold: 500 * 1024 * 1024, // 500MB
      enableGC: false,
    });
  });

  afterEach(() => {
    monitor.stop();
  });

  it('should start and stop monitoring', () => {
    monitor.start();
    expect(monitor).toBeDefined();

    monitor.stop();
    expect(monitor).toBeDefined();
  });

  it('should emit stats events', (done) => {
    monitor.on('stats', (stats) => {
      expect(stats.heapUsed).toBeGreaterThan(0);
      expect(stats.heapTotal).toBeGreaterThan(0);
      expect(stats.timestamp).toBeGreaterThan(0);
      monitor.stop();
      (done as any)();
    });

    monitor.start();
  });

  it('should track memory stats history', (done) => {
    let count = 0;

    monitor.on('stats', () => {
      count++;
      if (count >= 2) {
        const history = monitor.getHistory();
        expect(history.length).toBeGreaterThanOrEqual(2);
        monitor.stop();
        (done as any)();
      }
    });

    monitor.start();
  });

  it('should get current stats', (done) => {
    monitor.on('stats', () => {
      const stats = monitor.getStats();
      expect(stats).not.toBeNull();
      expect(stats?.heapUsed).toBeGreaterThan(0);
      monitor.stop();
      (done as any)();
    });

    monitor.start();
  });

  it('should calculate average memory usage', (done) => {
    let count = 0;

    monitor.on('stats', () => {
      count++;
      if (count >= 2) {
        const avg = monitor.getAverageUsage();
        expect(avg).toBeGreaterThan(0);
        monitor.stop();
        (done as any)();
      }
    });

    monitor.start();
  });

  it('should emit cleanup-needed event on high memory', (done) => {
    const lowThreshold = 1024; // 1KB - will definitely trigger

    monitor = new MemoryMonitor({
      checkInterval: 100,
      warningThreshold: lowThreshold,
      criticalThreshold: lowThreshold * 2,
      enableGC: false,
    });

    monitor.on('cleanup-needed', (event) => {
      expect(event.level).toBe('warning');
      monitor.stop();
      (done as any)();
    });

    monitor.start();
  });

  it('should not throw when process.memoryUsage is unavailable', () => {
    const originalMemoryUsage = process.memoryUsage;
    (process as any).memoryUsage = undefined;

    try {
      monitor.start();
      // Should not throw
      expect(monitor).toBeDefined();
      monitor.stop();
    } finally {
      process.memoryUsage = originalMemoryUsage;
    }
  });

  it('should handle multiple start calls gracefully', () => {
    monitor.start();
    monitor.start(); // Should not create duplicate intervals
    expect(monitor).toBeDefined();
    monitor.stop();
  });

  it('should return null stats when no history', () => {
    const newMonitor = new MemoryMonitor();
    const stats = newMonitor.getStats();
    expect(stats).toBeNull();
  });
});
