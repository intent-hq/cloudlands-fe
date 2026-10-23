import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_REFERENCE_NOW, catalogNow, catalogStopwatch } from './catalog-clock';

afterEach(() => {
  vi.useRealTimers();
});

describe('catalog clock', () => {
  // Fixtures and components must read the same clock: a fixture stamped from a fixed instant
  // while the component ticks against the real clock drifts by the host date instead.
  it.each([CATALOG_REFERENCE_NOW, '2030-03-15T12:00:05.000Z'])(
    'follows the system clock, so a suite that pins Date to %s pins catalog "now" too',
    (hostDate) => {
      vi.setSystemTime(new Date(hostDate));
      expect(catalogNow()).toBe(Date.parse(hostDate));
      expect(catalogNow()).toBe(Date.now());
    },
  );

  it('measures elapsed time from when the stopwatch starts', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const elapsed = catalogStopwatch();
    vi.advanceTimersByTime(250);
    expect(elapsed()).toBe(250);
  });
});
