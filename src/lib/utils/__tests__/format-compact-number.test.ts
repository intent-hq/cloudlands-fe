import { describe, expect, it } from 'vitest';
import { formatCompactNumber } from '../format-compact-number';

describe('formatCompactNumber', () => {
  it('returns small numbers unchanged', () => {
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(7)).toBe('7');
    expect(formatCompactNumber(999)).toBe('999');
  });

  it('formats thousands with a K suffix', () => {
    expect(formatCompactNumber(1234)).toBe('1.2K');
    expect(formatCompactNumber(98000)).toBe('98K');
    expect(formatCompactNumber(1000)).toBe('1K');
  });

  it('formats millions with an M suffix', () => {
    expect(formatCompactNumber(9264137)).toBe('9.3M');
    expect(formatCompactNumber(1_000_000)).toBe('1M');
  });

  it('formats billions with a B suffix', () => {
    expect(formatCompactNumber(2_500_000_000)).toBe('2.5B');
  });

  it('promotes to the larger unit when rounding carries over (no "1000K"/"1000M")', () => {
    // (v / 1000).toFixed(1) rounds up to "1000.0" from 999_950 onward.
    expect(formatCompactNumber(999_949)).toBe('999.9K');
    expect(formatCompactNumber(999_950)).toBe('1M');
    expect(formatCompactNumber(999_999)).toBe('1M');
    // Same carry at the M → B boundary.
    expect(formatCompactNumber(999_949_999)).toBe('999.9M');
    expect(formatCompactNumber(999_950_000)).toBe('1B');
    expect(formatCompactNumber(999_999_999)).toBe('1B');
  });

  it('preserves the sign when promotion applies', () => {
    expect(formatCompactNumber(-999_949)).toBe('-999.9K');
    expect(formatCompactNumber(-999_950)).toBe('-1M');
    expect(formatCompactNumber(-999_950_000)).toBe('-1B');
  });

  it('rounds fractional small numbers', () => {
    expect(formatCompactNumber(12.6)).toBe('13');
  });

  it('preserves the sign of negative numbers', () => {
    expect(formatCompactNumber(-1234)).toBe('-1.2K');
    expect(formatCompactNumber(-5)).toBe('-5');
  });

  it('formats non-finite values as "0"', () => {
    expect(formatCompactNumber(Number.NaN)).toBe('0');
    expect(formatCompactNumber(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

