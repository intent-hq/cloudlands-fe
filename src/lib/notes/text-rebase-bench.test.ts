// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  benchShape,
  DEFAULT_REPEATS,
  DIFF_STEP_MS,
  installClock,
  median,
  parseRepeats,
  selectShapes,
  timeMapping,
  type BenchSubject,
  type InstalledClock,
  type OffsetMapperFactory,
} from './text-rebase-bench';

const subject: BenchSubject = { name: 'tiny', plain: 'plain text', markdown: '*plain* text' };

/** A mapper factory that records its inputs and the offsets it was asked to map. */
function recordingFactory() {
  const calls: Array<[string, string]> = [];
  const mapped: Array<['aToB' | 'bToA', number]> = [];
  const factory: OffsetMapperFactory = (a, b) => {
    calls.push([a, b]);
    return {
      aToB: (offset) => (mapped.push(['aToB', offset]), offset),
      bToA: (offset) => (mapped.push(['bToA', offset]), offset),
    };
  };
  return { factory, calls, mapped };
}

/** A clock whose `now()` reads follow `ticks` and whose `deadlineHit()` follows `hits`, one per measurement. */
function scriptedClock(ticks: number[], hits: Array<boolean | null> = []): InstalledClock {
  let read = 0;
  let measurement = -1;
  return {
    mode: 'natural',
    now: () => ticks[read++],
    reset: () => void (measurement += 1),
    deadlineHit: () => hits[measurement] ?? false,
    restore: () => {},
  };
}

describe('median', () => {
  it('takes the middle of an odd count and the mean of the two middles of an even count', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });
  it('rejects no values', () => {
    expect(() => median([])).toThrow(/no values/);
  });
});

describe('parseRepeats', () => {
  it('defaults when unset or blank and reads a positive integer', () => {
    expect(parseRepeats(undefined)).toBe(DEFAULT_REPEATS);
    expect(parseRepeats(' ')).toBe(DEFAULT_REPEATS);
    expect(parseRepeats('3')).toBe(3);
  });
  it('rejects zero, fractions and words', () => {
    for (const raw of ['0', '-1', '1.5', 'five'])
      expect(() => parseRepeats(raw)).toThrow(/positive integer/);
  });
});

describe('selectShapes', () => {
  const names = ['a', 'b', 'c'] as const;
  it('keeps every name in order when unset', () => {
    expect(selectShapes(undefined, names)).toEqual(['a', 'b', 'c']);
    expect(selectShapes('', names)).toEqual(['a', 'b', 'c']);
  });
  it('narrows to the listed names in catalogue order, trimming spaces', () => {
    expect(selectShapes('c, a', names)).toEqual(['a', 'c']);
  });
  it('names an unknown shape', () => {
    expect(() => selectShapes('a,zz', names)).toThrow(/zz/);
  });
});

describe('installClock', () => {
  const realPerformanceNow = performance.now;
  const realDateNow = Date.now;
  afterEach(() => {
    expect(performance.now).toBe(realPerformanceNow);
    expect(Date.now).toBe(realDateNow);
  });

  it('unbounded: freezes performance.now, steps Date.now, keeps the real clock for timing', () => {
    const clock = installClock('unbounded');
    try {
      expect(performance.now()).toBe(0);
      expect(performance.now()).toBe(0);
      expect(Date.now()).toBe(0);
      expect(Date.now()).toBeCloseTo(DIFF_STEP_MS);
      expect(clock.deadlineHit()).toBeNull();
      const before = clock.now();
      const spin = realDateNow() + 2;
      while (realDateNow() < spin) {
        /* burn 2 ms */
      }
      expect(clock.now()).toBeGreaterThan(before);
    } finally {
      clock.restore();
    }
  });

  it('natural: passes reads through and marks the deadline once a read is a budget past the first', () => {
    const clock = installClock('natural', 1);
    try {
      const first = performance.now();
      expect(first).toBeGreaterThan(0);
      expect(clock.deadlineHit()).toBe(false);
      const spin = realDateNow() + 3;
      while (realDateNow() < spin) {
        /* burn 3 ms */
      }
      expect(performance.now()).toBeGreaterThan(first);
      expect(clock.deadlineHit()).toBe(true);
      clock.reset();
      expect(clock.deadlineHit()).toBe(false);
      performance.now();
      expect(clock.deadlineHit()).toBe(false);
    } finally {
      clock.restore();
    }
  });
});

describe('timeMapping', () => {
  it('builds the mapper once and maps the midpoint each way, timing on the clock given', () => {
    const { factory, calls, mapped } = recordingFactory();
    const clock = scriptedClock([10, 17.5], [true]);
    expect(timeMapping(factory, subject, clock)).toEqual({ ms: 7.5, deadlineHit: true });
    expect(calls).toEqual([[subject.plain, subject.markdown]]);
    expect(mapped).toEqual([
      ['aToB', 5],
      ['bToA', 6],
    ]);
  });
});

describe('benchShape', () => {
  it('evicts the memo, times one cold call and the median of the repeats', () => {
    const { factory, calls } = recordingFactory();
    // Measurements: cold 4 ms, then 9, 1 and 5 ms.
    const clock = scriptedClock([0, 4, 10, 19, 20, 21, 30, 35], [false, true, false, true]);
    const [cold, cached] = benchShape(factory, subject, clock, 3);
    expect(calls).toHaveLength(5);
    expect(calls[0]).not.toEqual([subject.plain, subject.markdown]);
    expect(calls.slice(1)).toEqual(Array(4).fill([subject.plain, subject.markdown]));
    expect(cold).toEqual({
      shape: 'tiny',
      clock: 'natural',
      phase: 'cold',
      ms: 4,
      deadlineHit: false,
    });
    expect(cached).toEqual({
      shape: 'tiny',
      clock: 'natural',
      phase: 'cached',
      ms: 5,
      deadlineHit: true,
    });
  });

  it('reads the cached deadline off either middle sample of an even count', () => {
    const { factory } = recordingFactory();
    // Measurements: cold 1 ms, then 1, 2, 3 and 4 ms; the 2 ms sample hit the deadline.
    const clock = scriptedClock(
      [0, 1, 2, 3, 4, 6, 7, 10, 11, 15],
      [false, false, true, false, false],
    );
    const [, cached] = benchShape(factory, subject, clock, 4);
    expect(cached.ms).toBe(2.5);
    expect(cached.deadlineHit).toBe(true);
  });

  it('reports no deadline under the unbounded clock and rejects a repeat count below one', () => {
    const { factory } = recordingFactory();
    const clock = {
      ...scriptedClock([0, 1, 2, 3]),
      mode: 'unbounded' as const,
      deadlineHit: () => null,
    };
    const [cold, cached] = benchShape(factory, subject, clock, 1);
    expect([cold.clock, cold.deadlineHit, cached.deadlineHit]).toEqual(['unbounded', null, null]);
    expect(() => benchShape(factory, subject, clock, 0)).toThrow(/repeats/);
  });
});
