import { describe, expect, it, beforeAll } from 'vitest';
import { createFormatters, loadDateFnsLocale } from './formatters';

const NOW = new Date('2025-12-13T10:00:00Z');
const en = createFormatters(() => 'en');
const de = createFormatters(() => 'de');

describe('formatNumber / formatInteger', () => {
  it('groups with the en locale', () => {
    expect(en.formatNumber(1234567.89)).toBe('1,234,567.89');
    expect(en.formatInteger(1234567)).toBe('1,234,567');
  });

  it('groups with the de locale', () => {
    expect(de.formatNumber(1234567.89)).toBe('1.234.567,89');
    expect(de.formatInteger(1234567)).toBe('1.234.567');
  });

  it('is NaN-safe for integers', () => {
    expect(en.formatInteger(Number.NaN)).toBe('0');
  });
});

describe('formatCompactNumber', () => {
  it('keeps the one-decimal default and supports whole-number output', () => {
    expect(en.formatCompactNumber(1_234)).toBe('1.2K');
    expect(en.formatCompactNumber(1_234, { maximumFractionDigits: 0 })).toBe('1K');
    expect(en.formatCompactNumber(9_264_137, { maximumFractionDigits: 0 })).toBe('9M');
  });

  it('promotes rounded whole values at compact-unit boundaries', () => {
    expect(en.formatCompactNumber(999_499, { maximumFractionDigits: 0 })).toBe('999K');
    expect(en.formatCompactNumber(999_500, { maximumFractionDigits: 0 })).toBe('1M');
    expect(en.formatCompactNumber(999_499_999, { maximumFractionDigits: 0 })).toBe('999M');
    expect(en.formatCompactNumber(999_500_000, { maximumFractionDigits: 0 })).toBe('1B');
  });

  it('uses locale compact units and decimal separators', () => {
    expect(de.formatCompactNumber(9_264_137)).toBe('9,3 Mio.');
    expect(de.formatCompactNumber(9_264_137, { maximumFractionDigits: 0 })).toBe('9 Mio.');
  });
});

describe('formatCurrency', () => {
  it('formats an ISO 4217 amount for the locale', () => {
    expect(en.formatCurrency(1.5, 'USD')).toBe('$1.50');
    expect(en.formatCurrency(1234.5, 'USD')).toBe('$1,234.50');
  });

  it('keeps up to 4 fraction digits for sub-unit amounts', () => {
    expect(en.formatCurrency(0.0123, 'USD')).toBe('$0.0123');
    expect(en.formatCurrency(0, 'USD')).toBe('$0.00');
  });

  it('follows the locale currency conventions', () => {
    expect(de.formatCurrency(1234.5, 'EUR')).toContain('1.234,50');
  });

  it('supports locale-aware whole-number currency output', () => {
    expect(en.formatCurrency(1.5, 'USD', { fractionDigits: 0 })).toBe('$2');
    expect(en.formatCurrency(0.4, 'USD', { fractionDigits: 0 })).toBe('$0');
    expect(de.formatCurrency(1234.5, 'EUR', { fractionDigits: 0 })).toBe('1.235 €');
    expect(en.formatCurrency(2.4, 'CREDITS', { fractionDigits: 0 })).toBe('2 CREDITS');
  });

  it('honours zero-decimal currency conventions for whole amounts', () => {
    expect(en.formatCurrency(100, 'JPY')).toBe('¥100');
    expect(en.formatCurrency(0, 'JPY')).toBe('¥0');
  });

  it('falls back to a number plus the code for an unknown currency', () => {
    expect(en.formatCurrency(2, 'CREDITS')).toBe('2.00 CREDITS');
  });

  it('returns empty string for invalid amounts', () => {
    expect(en.formatCurrency(Number.NaN, 'USD')).toBe('');
  });
});

describe('formatBytesBinary', () => {
  it('formats binary base-1024 sizes with 3 significant digits', () => {
    expect(en.formatBytesBinary(0)).toBe('0B');
    expect(en.formatBytesBinary(512)).toBe('512B');
    expect(en.formatBytesBinary(1024)).toBe('1Ki');
    expect(en.formatBytesBinary(1536)).toBe('1.5Ki');
    expect(en.formatBytesBinary(1_048_576)).toBe('1Mi');
    expect(en.formatBytesBinary(2_330_000_000)).toBe('2.17Gi');
    expect(en.formatBytesBinary(5_500_000_000_000)).toBe('5Ti');
  });

  it('caps at Ti for very large values (3072 Ti → 3 significant digits, no grouping)', () => {
    expect(en.formatBytesBinary(2 ** 50 * 3)).toBe('3070Ti');
  });

  it('uses the locale decimal separator', () => {
    expect(de.formatBytesBinary(2_330_000_000)).toBe('2,17Gi');
  });

  it('returns empty string for invalid input', () => {
    expect(en.formatBytesBinary(Number.NaN)).toBe('');
    expect(en.formatBytesBinary(-1)).toBe('');
    expect(en.formatBytesBinary(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('formatRelativeTime', () => {
  it('formats en long style across units', () => {
    expect(en.formatRelativeTime(new Date(NOW.getTime() - 5_000), { now: NOW })).toBe('now');
    expect(en.formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000), { now: NOW })).toBe(
      '5 minutes ago',
    );
    expect(en.formatRelativeTime(new Date(NOW.getTime() - 3 * 3_600_000), { now: NOW })).toBe(
      '3 hours ago',
    );
    expect(en.formatRelativeTime(new Date(NOW.getTime() - 86_400_000), { now: NOW })).toBe(
      'yesterday',
    );
    expect(en.formatRelativeTime(new Date(NOW.getTime() - 14 * 86_400_000), { now: NOW })).toBe(
      '2 weeks ago',
    );
  });

  it('formats en narrow style', () => {
    expect(
      en.formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000), { style: 'narrow', now: NOW }),
    ).toBe('5m ago');
  });

  it('formats future dates', () => {
    expect(en.formatRelativeTime(new Date(NOW.getTime() + 2 * 86_400_000), { now: NOW })).toBe(
      'in 2 days',
    );
  });

  it('formats the de locale', () => {
    expect(de.formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000), { now: NOW })).toBe(
      'vor 5 Minuten',
    );
    expect(de.formatRelativeTime(new Date(NOW.getTime() - 86_400_000), { now: NOW })).toBe(
      'gestern',
    );
  });

  it('returns empty string for invalid input', () => {
    expect(en.formatRelativeTime('not a date')).toBe('');
  });
});

describe('formatCompactRelativeTime', () => {
  it('formats unit-only compact ages', () => {
    expect(en.formatCompactRelativeTime(new Date(NOW.getTime() - 30_000), { now: NOW })).toBe(
      'now',
    );
    expect(en.formatCompactRelativeTime(new Date(NOW.getTime() - 5 * 60_000), { now: NOW })).toBe(
      '5m',
    );
    expect(
      en.formatCompactRelativeTime(new Date(NOW.getTime() - 3 * 3_600_000), { now: NOW }),
    ).toBe('3h');
    expect(
      en.formatCompactRelativeTime(new Date(NOW.getTime() - 2 * 86_400_000), { now: NOW }),
    ).toBe('2d');
    expect(
      en.formatCompactRelativeTime(new Date(NOW.getTime() - 14 * 86_400_000), { now: NOW }),
    ).toBe('2w');
  });

  it('falls back to a short date beyond ~a month', () => {
    const old = new Date('2025-01-05T10:00:00Z');
    expect(en.formatCompactRelativeTime(old, { now: NOW })).toBe('Jan 5');
  });
});

describe('formatCompactDuration', () => {
  it('formats sub-minute durations in seconds', () => {
    expect(en.formatCompactDuration(0)).toBe('0s');
    expect(en.formatCompactDuration(42_000)).toBe('42s');
  });

  it('formats minutes, omitting a zero seconds part', () => {
    expect(en.formatCompactDuration(12 * 60_000)).toBe('12m');
    expect(en.formatCompactDuration(12 * 60_000 + 30_000)).toBe('12m 30s');
  });

  it('formats hours with minutes, truncating smaller remainders', () => {
    expect(en.formatCompactDuration(3_600_000)).toBe('1h');
    expect(en.formatCompactDuration(3_600_000 + 5 * 60_000)).toBe('1h 5m');
    expect(en.formatCompactDuration(3_600_000 + 5 * 60_000 + 30_000)).toBe('1h 5m');
    // A zero adjacent unit is omitted even when a smaller remainder exists
    expect(en.formatCompactDuration(3_600_000 + 30_000)).toBe('1h');
    expect(en.formatCompactDuration(86_400_000 + 23 * 3_600_000 + 59 * 60_000)).toBe('1d 23h');
  });

  it('formats days with hours, dropping smaller units', () => {
    expect(en.formatCompactDuration(2 * 86_400_000)).toBe('2d');
    expect(en.formatCompactDuration(2 * 86_400_000 + 3 * 3_600_000)).toBe('2d 3h');
  });

  it('rounds to the nearest second and carries into minutes', () => {
    expect(en.formatCompactDuration(59_600)).toBe('1m');
  });

  it('clamps negative durations to zero', () => {
    expect(en.formatCompactDuration(-5_000)).toBe('0s');
  });

  it('returns empty string for invalid input', () => {
    expect(en.formatCompactDuration(Number.NaN)).toBe('');
  });

  it('uses localized narrow units', () => {
    expect(de.formatCompactDuration(5 * 60_000)).toBe('5 Min.');
  });
});

describe('absolute date/time formatting', () => {
  const date = new Date('2024-01-15T14:30:00');

  it('formats en dates and times', () => {
    expect(en.formatDate(date)).toBe('Jan 15, 2024');
    expect(en.formatDateTime(date)).toBe('Jan 15, 2024, 2:30 PM');
    expect(en.formatTime(date)).toBe('2:30 PM');
    expect(en.formatWeekday(date)).toBe('Monday');
  });

  it('formats de dates and times', () => {
    expect(de.formatDate(date)).toBe('15.01.2024');
    expect(de.formatTime(date)).toBe('14:30');
    expect(de.formatWeekday(date)).toBe('Montag');
  });

  it('adds the year to short dates only when it differs', () => {
    expect(en.formatShortDate(new Date('2025-01-05T10:00:00Z'), { now: NOW })).toBe('Jan 5');
    expect(en.formatShortDate(new Date('2023-01-05T10:00:00Z'), { now: NOW })).toBe('Jan 5, 2023');
  });

  it('returns empty string for invalid input', () => {
    expect(en.formatDate('nope')).toBe('');
    expect(en.formatTime('nope')).toBe('');
  });
});

describe('formatDaySeparator', () => {
  it('labels today/yesterday/weekday/full date in en', () => {
    expect(en.formatDaySeparator(NOW, { now: NOW })).toBe('Today');
    expect(en.formatDaySeparator(new Date(NOW.getTime() - 86_400_000), { now: NOW })).toBe(
      'Yesterday',
    );
    expect(en.formatDaySeparator(new Date(NOW.getTime() - 3 * 86_400_000), { now: NOW })).toBe(
      'Wednesday',
    );
  });

  it('labels today/yesterday in de', () => {
    expect(de.formatDaySeparator(NOW, { now: NOW })).toBe('Heute');
    expect(de.formatDaySeparator(new Date(NOW.getTime() - 86_400_000), { now: NOW })).toBe(
      'Gestern',
    );
  });
});

describe('formatDistanceToNow (date-fns) with loaded locale', () => {
  beforeAll(async () => {
    await loadDateFnsLocale('de');
  });

  it('formats with the de date-fns locale', () => {
    const result = de.formatDistanceToNow(new Date(Date.now() - 3 * 86_400_000));
    expect(result).toBe('vor 3 Tagen');
  });
});
