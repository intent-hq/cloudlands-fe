import { describe, expect, it } from 'vitest';
import type { UsageModelStats } from '$lib/client/app-client';
import {
  formatDuration,
  formatInt,
  formatShare,
  formatTokens,
  rankModels,
  totalTokens,
} from './stats-format';

function model(name: string, tokens: Partial<UsageModelStats> = {}): UsageModelStats {
  return {
    model: name,
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...tokens,
  };
}

describe('totalTokens', () => {
  it('sums all 4 counters (Spec D6)', () => {
    expect(
      totalTokens({
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
      }),
    ).toBe(10);
  });
});

describe('formatTokens', () => {
  it('matches the design fmt() for billions', () => {
    expect(formatTokens(12_340_000_000)).toBe('12.3B');
    expect(formatTokens(2_410_000_000)).toBe('2.41B');
    expect(formatTokens(1_000_000_000)).toBe('1.00B');
  });

  it('matches the design fmt() for millions (integer M)', () => {
    expect(formatTokens(241_000_000)).toBe('241M');
    expect(formatTokens(50_000_000)).toBe('50M');
    expect(formatTokens(1_499_999)).toBe('1M');
  });

  it('rounds just-below-a-unit values up into the next unit', () => {
    expect(formatTokens(999_999_999)).toBe('1.00B');
    expect(formatTokens(999_999)).toBe('1M');
  });

  it('extends below 1M with K and raw counts', () => {
    expect(formatTokens(499_400)).toBe('499K');
    expect(formatTokens(12_300)).toBe('12K');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1)).toBe('1');
  });

  it('is zero-safe (no NaN, no "0M")', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(Number.NaN)).toBe('0');
    expect(formatTokens(-5)).toBe('0');
  });
});

describe('formatDuration', () => {
  it('renders h/m with padded minutes like the design', () => {
    expect(formatDuration(2 * 3_600_000 + 14 * 60_000)).toBe('2h 14m');
    expect(formatDuration(2 * 3_600_000 + 3 * 60_000)).toBe('2h 03m');
  });

  it('renders bare minutes under an hour', () => {
    expect(formatDuration(42 * 60_000)).toBe('42m');
    expect(formatDuration(30_000)).toBe('1m');
  });

  it('is zero-safe', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(Number.NaN)).toBe('0m');
  });
});

describe('formatInt', () => {
  it('groups thousands en-US', () => {
    expect(formatInt(48_213)).toBe('48,213');
    expect(formatInt(312)).toBe('312');
    expect(formatInt(0)).toBe('0');
    expect(formatInt(Number.NaN)).toBe('0');
  });
});

describe('formatShare', () => {
  it('rounds a fraction to a whole percent', () => {
    expect(formatShare(0.614)).toBe('61%');
    expect(formatShare(0.04)).toBe('4%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(Number.NaN)).toBe('0%');
  });
});

describe('rankModels', () => {
  it('ranks by summed total tokens desc and caps at 4', () => {
    const ranked = rankModels([
      model('a', { inputTokens: 100 }),
      model('b', { outputTokens: 500 }),
      model('c', { cacheReadTokens: 300 }),
      model('d', { cacheCreationTokens: 50 }),
      model('e', { inputTokens: 40 }),
    ]);
    expect(ranked.map((m) => m.model)).toEqual(['b', 'c', 'a', 'd']);
    expect(ranked.map((m) => m.tokens)).toEqual([500, 300, 100, 50]);
  });

  it('computes shares against the grand total across ALL models', () => {
    const ranked = rankModels([
      model('a', { inputTokens: 600 }),
      model('b', { inputTokens: 300 }),
      model('c', { inputTokens: 50 }),
      model('d', { inputTokens: 30 }),
      model('e', { inputTokens: 20 }),
    ]);
    expect(ranked).toHaveLength(4);
    expect(ranked[0].share).toBeCloseTo(0.6);
    expect(ranked.reduce((acc, m) => acc + m.share, 0)).toBeLessThan(1);
  });

  it('degrades gracefully below 4 models and drops zero-token rows', () => {
    const ranked = rankModels([model('a', { inputTokens: 10 }), model('zero')]);
    expect(ranked.map((m) => m.model)).toEqual(['a']);
    expect(ranked[0].share).toBe(1);
  });

  it('returns empty (not NaN shares) for a zero-data period', () => {
    expect(rankModels([])).toEqual([]);
    expect(rankModels([model('a')])).toEqual([]);
  });

  it('carries runs through for the MOST USED callout', () => {
    const ranked = rankModels([model('a', { inputTokens: 10, runs: 7 })]);
    expect(ranked[0].runs).toBe(7);
  });
});
