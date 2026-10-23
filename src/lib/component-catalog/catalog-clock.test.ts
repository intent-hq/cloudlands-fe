import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_REFERENCE_NOW, catalogNow, catalogStopwatch, catalogTime } from './catalog-clock';

afterEach(() => {
  vi.useRealTimers();
});

describe('catalog clock', () => {
  it('derives fixed timestamps from the reference instant', () => {
    expect(catalogTime()).toBe(CATALOG_REFERENCE_NOW);
    expect(catalogTime(-18_000)).toBe('2026-09-01T11:59:42.000Z');
  });

  it.each(['2026-09-01T12:00:05.000Z', '2030-03-15T12:00:00.000Z'])(
    'keeps catalog "now" at the reference instant when the host date is %s',
    (hostDate) => {
      vi.setSystemTime(new Date(hostDate));
      expect(catalogNow()).toBe(Date.parse(CATALOG_REFERENCE_NOW));
    },
  );

  it('measures elapsed time from when the stopwatch starts', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const elapsed = catalogStopwatch();
    vi.advanceTimersByTime(250);
    expect(elapsed()).toBe(250);
  });
});
