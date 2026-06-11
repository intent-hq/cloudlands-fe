import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  })),
}));

const { PerformanceMonitor } = await import('../performance-monitor');

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('cancels pending memory and DOM monitoring timers on stop', () => {
    let nextRafId = 0;
    const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = ++nextRafId;
      rafTimers.set(id, setTimeout(() => callback(performance.now()), 16));
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      const timer = rafTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        rafTimers.delete(id);
      }
    });

    const monitor = new PerformanceMonitor();
    monitor.start();
    vi.advanceTimersByTime(16);

    monitor.stop();

    expect(vi.getTimerCount()).toBe(0);
  });
});