/**
 * Activity-cohort telemetry helpers: the UTC ISO-week and month keys behind
 * the `w`/`m` flags, the install-age bucket `a`, the first-seen resolution
 * behind `i`, and the new feed-URL parameters.
 */

import { describe, expect, it } from 'vitest';
import {
  buildTelemetryFeedUrl,
  installAgeBucket,
  isFirstCheckOfPeriod,
  resolveFirstSeen,
  utcIsoWeek,
  utcMonth,
} from './update-telemetry';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('utcIsoWeek', () => {
  it('starts the week on Monday (Sunday → Monday UTC rolls over)', () => {
    expect(utcIsoWeek(new Date('2026-10-25T23:59:59.999Z'))).toBe('2026-W43');
    expect(utcIsoWeek(new Date('2026-10-26T00:00:00.000Z'))).toBe('2026-W44');
  });

  it('uses UTC, not local time', () => {
    expect(utcIsoWeek(new Date('2026-10-26T00:30:00+02:00'))).toBe('2026-W43');
  });

  it('assigns the year boundary to the ISO week-numbering year', () => {
    // 2026-01-01 is a Thursday: week 1 of 2026 begins Monday 2025-12-29.
    expect(utcIsoWeek(new Date('2025-12-28T23:59:59Z'))).toBe('2025-W52');
    expect(utcIsoWeek(new Date('2025-12-29T00:00:00Z'))).toBe('2026-W01');
    expect(utcIsoWeek(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
    // 2027-01-01 is a Friday: it still belongs to 2026's last week (W53).
    expect(utcIsoWeek(new Date('2026-12-31T12:00:00Z'))).toBe('2026-W53');
    expect(utcIsoWeek(new Date('2027-01-03T23:59:59Z'))).toBe('2026-W53');
    expect(utcIsoWeek(new Date('2027-01-04T00:00:00Z'))).toBe('2027-W01');
  });
});

describe('utcMonth', () => {
  it('rolls over at the UTC month boundary', () => {
    expect(utcMonth(new Date('2026-10-31T23:59:59.999Z'))).toBe('2026-10');
    expect(utcMonth(new Date('2026-11-01T00:00:00.000Z'))).toBe('2026-11');
  });

  it('rolls over at the UTC year boundary', () => {
    expect(utcMonth(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
    expect(utcMonth(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01');
  });
});

describe('isFirstCheckOfPeriod', () => {
  it('is set when the stored period differs or is missing/malformed', () => {
    expect(isFirstCheckOfPeriod(undefined, '2026-W44')).toBe(true);
    expect(isFirstCheckOfPeriod(null, '2026-W44')).toBe(true);
    expect(isFirstCheckOfPeriod(42, '2026-10')).toBe(true);
    expect(isFirstCheckOfPeriod('2026-W43', '2026-W44')).toBe(true);
    expect(isFirstCheckOfPeriod('2026-10', '2026-10')).toBe(false);
  });
});

describe('installAgeBucket', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const daysAgo = (n: number) =>
    new Date(Date.parse('2026-10-22T00:00:00Z') - n * DAY_MS).toISOString().slice(0, 10);

  it.each([
    [0, '0d'],
    [1, '1-7d'],
    [7, '1-7d'],
    [8, '8-30d'],
    [30, '8-30d'],
    [31, '31-90d'],
    [90, '31-90d'],
    [91, '91-365d'],
    [365, '91-365d'],
    [366, '365d+'],
    [2000, '365d+'],
  ] as const)('%i days → %s', (days, bucket) => {
    expect(installAgeBucket(daysAgo(days), now)).toBe(bucket);
  });

  it('counts whole UTC days, not elapsed hours', () => {
    expect(installAgeBucket('2026-10-21', new Date('2026-10-22T00:00:01Z'))).toBe('1-7d');
    expect(installAgeBucket('2026-10-22', new Date('2026-10-22T23:59:59Z'))).toBe('0d');
  });

  it('is unknown without a first-seen day, for malformed days, and for a future day', () => {
    expect(installAgeBucket(null, now)).toBe('unknown');
    expect(installAgeBucket('not-a-day', now)).toBe('unknown');
    expect(installAgeBucket('2026-13-45', now)).toBe('unknown');
    expect(installAgeBucket('2026-10-23', now)).toBe('unknown');
  });
});

describe('resolveFirstSeen', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const processStartMs = now.getTime() - 30_000;
  const fresh = {
    storedDay: undefined,
    storedEstimated: undefined,
    hasPriorUpdateState: false,
    userDataCreatedAtMs: now.getTime() - 5_000,
    processStartMs,
    now,
  };

  it('keeps a stored first-seen day and its estimated flag', () => {
    expect(resolveFirstSeen({ ...fresh, storedDay: '2026-01-02', storedEstimated: false })).toEqual(
      { day: '2026-01-02', estimated: false, persist: false },
    );
    expect(resolveFirstSeen({ ...fresh, storedDay: '2025-05-05', storedEstimated: true })).toEqual({
      day: '2025-05-05',
      estimated: true,
      persist: false,
    });
  });

  it('treats a stored day with a missing estimated flag as estimated', () => {
    expect(resolveFirstSeen({ ...fresh, storedDay: '2026-01-02' }).estimated).toBe(true);
  });

  it('keeps a stored unknown estimate unknown instead of re-estimating', () => {
    expect(resolveFirstSeen({ ...fresh, storedEstimated: true })).toEqual({
      day: null,
      estimated: true,
      persist: false,
    });
  });

  it('records today as a genuine new install for a fresh userData with no prior prefs', () => {
    expect(resolveFirstSeen(fresh)).toEqual({ day: '2026-10-22', estimated: false, persist: true });
  });

  it('estimates from userData creation when prior update state exists', () => {
    const createdAt = Date.parse('2025-03-04T10:00:00Z');
    expect(
      resolveFirstSeen({ ...fresh, hasPriorUpdateState: true, userDataCreatedAtMs: createdAt }),
    ).toEqual({ day: '2025-03-04', estimated: true, persist: true });
  });

  it('estimates from userData creation when userData predates this process', () => {
    const createdAt = Date.parse('2026-10-20T10:00:00Z');
    expect(resolveFirstSeen({ ...fresh, userDataCreatedAtMs: createdAt })).toEqual({
      day: '2026-10-20',
      estimated: true,
      persist: true,
    });
  });

  it('is unknown (estimated) when userData has no usable timestamp', () => {
    expect(resolveFirstSeen({ ...fresh, userDataCreatedAtMs: null })).toEqual({
      day: null,
      estimated: true,
      persist: true,
    });
  });

  it('ignores a malformed stored day', () => {
    expect(resolveFirstSeen({ ...fresh, storedDay: 'garbage' })).toEqual({
      day: '2026-10-22',
      estimated: false,
      persist: true,
    });
  });
});

describe('buildTelemetryFeedUrl cohort parameters', () => {
  it('appends w, m, i and a after the existing parameters', () => {
    const url = new URL(
      buildTelemetryFeedUrl('https://updates.intentapp.dev/desktop', 'stable', {
        platform: 'darwin',
        arch: 'arm64',
        version: '2.230.0',
        source: 'dmg',
        trigger: 'startup',
        daily: true,
        weekly: true,
        monthly: false,
        install: true,
        age: '0d',
      }),
    );
    expect([...url.searchParams.entries()]).toEqual([
      ['p', 'darwin-arm64'],
      ['v', '2.230.0'],
      ['src', 'dmg'],
      ['k', 'startup'],
      ['d', '1'],
      ['w', '1'],
      ['m', '0'],
      ['i', '1'],
      ['a', '0d'],
    ]);
  });
});
