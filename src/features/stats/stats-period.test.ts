/**
 * Unit tests for the usage-stats overlay period/dropdown state logic.
 */
import { describe, expect, it } from 'vitest';
import {
  STATS_MODES,
  currentMonthKey,
  currentYearKey,
  defaultPeriodKey,
  localTzOffsetMinutes,
  periodLabel,
  periodOptions,
  shortLabel,
} from './stats-period';

const JULY = new Date(2026, 6, 25, 12, 0, 0);

describe('STATS_MODES', () => {
  it('orders the mode toggle 24H · Month · Year (Spec D11)', () => {
    expect(STATS_MODES.map((m) => m.mode)).toEqual(['24h', 'month', 'year']);
    expect(STATS_MODES.map((m) => m.label)).toEqual(['24H', 'Month', 'Year']);
  });
});

describe('current period keys', () => {
  it('formats the current local month as YYYY-MM (zero-padded)', () => {
    expect(currentMonthKey(JULY)).toBe('2026-07');
    expect(currentMonthKey(new Date(2026, 10, 1))).toBe('2026-11');
  });

  it('formats the current local year as YYYY', () => {
    expect(currentYearKey(JULY)).toBe('2026');
  });

  it('reports the tz offset as minutes EAST of UTC (negated JS offset)', () => {
    expect(localTzOffsetMinutes(JULY)).toBe(-JULY.getTimezoneOffset());
  });
});

describe('periodLabel / shortLabel', () => {
  it('renders month keys as full month-name labels', () => {
    expect(periodLabel('month', '2026-07')).toBe('July 2026');
    expect(periodLabel('month', '2026-01')).toBe('January 2026');
  });

  it('renders year keys verbatim', () => {
    expect(periodLabel('year', '2026')).toBe('2026');
  });

  it('falls back to the raw key for unparseable month keys', () => {
    expect(periodLabel('month', 'garbage')).toBe('garbage');
  });

  it('renders card short labels (MON YYYY / YYYY / LAST 24H)', () => {
    expect(shortLabel('month', '2026-07')).toBe('JUL 2026');
    expect(shortLabel('year', '2026')).toBe('2026');
    expect(shortLabel('24h', '')).toBe('LAST 24H');
  });
});

describe('periodOptions', () => {
  const available = {
    months: ['2026-03', '2026-07', '2026-05'],
    years: ['2025', '2026'],
  };

  it('offers only daemon-reported months, newest first', () => {
    expect(periodOptions('month', available)).toEqual(['2026-07', '2026-05', '2026-03']);
  });

  it('offers only daemon-reported years, newest first', () => {
    expect(periodOptions('year', available)).toEqual(['2026', '2025']);
  });

  it('has no dropdown options in 24h mode (Spec D11)', () => {
    expect(periodOptions('24h', available)).toEqual([]);
  });

  it('does not mutate the daemon-provided arrays', () => {
    periodOptions('month', available);
    expect(available.months).toEqual(['2026-03', '2026-07', '2026-05']);
  });
});

describe('defaultPeriodKey', () => {
  it('defaults to the current local month when it has data', () => {
    const available = { months: ['2026-06', '2026-07'], years: ['2026'] };
    expect(defaultPeriodKey('month', available, JULY)).toBe('2026-07');
  });

  it('falls back to the newest available month when the current one has no data', () => {
    const available = { months: ['2026-04', '2026-05'], years: ['2026'] };
    expect(defaultPeriodKey('month', available, JULY)).toBe('2026-05');
  });

  it('uses the current period when nothing is available (renders zeroed cards)', () => {
    const available = { months: [], years: [] };
    expect(defaultPeriodKey('month', available, JULY)).toBe('2026-07');
    expect(defaultPeriodKey('year', available, JULY)).toBe('2026');
  });

  it('defaults to the current year when it has data', () => {
    const available = { months: [], years: ['2025', '2026'] };
    expect(defaultPeriodKey('year', available, JULY)).toBe('2026');
  });

  it('needs no key in 24h mode', () => {
    const available = { months: ['2026-07'], years: ['2026'] };
    expect(defaultPeriodKey('24h', available, JULY)).toBeUndefined();
  });
});
