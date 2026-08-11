import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryMonitor } from '../memory-monitor';

const MB = 1024 * 1024;

function memoryUsage(heapUsedMB: number): NodeJS.MemoryUsage {
  return {
    rss: heapUsedMB * MB,
    heapTotal: heapUsedMB * MB,
    heapUsed: heapUsedMB * MB,
    external: 0,
    arrayBuffers: 0,
  };
}

describe('main-process MemoryMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps rapid startup growth diagnostic while heap usage is below threshold', () => {
    const usage = vi
      .spyOn(process, 'memoryUsage')
      .mockReturnValueOnce(memoryUsage(40))
      .mockReturnValue(memoryUsage(100));
    const monitor = new MemoryMonitor();
    const levels: string[] = [];
    monitor.onPressure((level) => levels.push(level));

    monitor.start();
    vi.advanceTimersByTime(30_000);
    monitor.stop();

    expect(usage).toHaveBeenCalledTimes(2);
    expect(levels).toEqual(['normal', 'normal']);
  });

  it('still reports pressure when absolute heap usage exceeds the warning threshold', () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue(memoryUsage(600));
    const monitor = new MemoryMonitor();
    const levels: string[] = [];
    monitor.onPressure((level) => levels.push(level));

    monitor.start();
    monitor.stop();

    expect(levels).toEqual(['warning']);
  });
});
