import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { UsageStatsResult } from '$lib/client/app-client';
import { m } from '$shared/paraglide/messages.js';
import TokensByMonthCard from './TokensByMonthCard.svelte';

const empty = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

const data: UsageStatsResult = {
  totals: empty,
  runs: 1,
  sessions: 1,
  longestRunMs: 0,
  linesAdded: 0,
  linesDeleted: 0,
  byModel: [],
  byProvider: [],
  byHourOfDay: [],
  availablePeriods: { months: [], years: [] },
  // Past year, so every month is elapsed. Oct carries a cache-heavy mix.
  byMonth: Array.from({ length: 12 }, (_, i) =>
    i === 9
      ? {
          month: 10,
          inputTokens: 13_000_000,
          outputTokens: 15_000_000,
          cacheReadTokens: 6_750_000_000,
          cacheCreationTokens: 111_000_000,
          thoughtTokens: 60_000,
        }
      : { month: i + 1, ...empty },
  ),
};

afterEach(cleanup);

describe('TokensByMonthCard token mix legend', () => {
  it('adds a cache legend entry when cache tokens were reported (regression)', () => {
    const { container } = render(TokensByMonthCard, { data, yearKey: '2025' });
    expect(container.querySelector('.legend')?.textContent).toContain(
      m.stats_card_legendCache_label(),
    );
  });

  it('omits the cache legend entry when no elapsed month reported cache tokens', () => {
    const noCache = { ...data, byMonth: [{ month: 1, ...empty, inputTokens: 100 }] };
    const { container } = render(TokensByMonthCard, { data: noCache, yearKey: '2025' });
    expect(container.querySelector('.legend')?.textContent).not.toContain(
      m.stats_card_legendCache_label(),
    );
  });
});
