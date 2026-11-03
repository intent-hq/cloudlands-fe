import type { Locator } from '@playwright/test';
import { test, expect } from '../../test/ct-test';
import type { UsageStatsResult } from '$lib/client/app-client';
import TokensByHourCard from './TokensByHourCard.svelte';
import TokensByMonthCard from './TokensByMonthCard.svelte';

const empty = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
// Real-world Claude Code mix: cache reads are ~98% of the bar, output ~0.2%
// and thoughts ~0.001% — both used to render under 1px (regression).
const cacheHeavy = {
  inputTokens: 13_000_000,
  outputTokens: 15_000_000,
  cacheReadTokens: 6_750_000_000,
  cacheCreationTokens: 111_000_000,
  thoughtTokens: 60_000,
};
const data: UsageStatsResult = {
  totals: cacheHeavy,
  runs: 1,
  sessions: 1,
  longestRunMs: 0,
  linesAdded: 0,
  linesDeleted: 0,
  byModel: [],
  byProvider: [],
  availablePeriods: { months: [], years: [] },
  byHourOfDay: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    ...(hour === 7 ? cacheHeavy : empty),
  })),
  byMonth: Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    ...(i === 9 ? cacheHeavy : empty),
  })),
};

async function expectVisibleMix(card: Locator, busy: number, quiet: number) {
  const heights = await card
    .locator('.bar')
    .nth(busy)
    .evaluate((node) =>
      Object.fromEntries(
        ['.bar-thought', '.bar-out', '.bar-in', '.bar-cache'].map((sel) => [
          sel,
          node.querySelector(sel)!.getBoundingClientRect().height,
        ]),
      ),
    );
  for (const sel of ['.bar-thought', '.bar-out', '.bar-in']) {
    expect(heights[sel], `${sel} is visible`).toBeGreaterThanOrEqual(1.5);
  }
  // The floors must not misrepresent the mix: cache still dominates the bar.
  expect(heights['.bar-cache']).toBeGreaterThan(
    heights['.bar-thought'] + heights['.bar-out'] + heights['.bar-in'],
  );
  // A bar with no tokens stays empty: zero segments get no phantom floor.
  const emptyHeight = await card
    .locator('.bar')
    .nth(quiet)
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(emptyHeight).toBe(0);
}

test('by-hour keeps tiny input, output and thoughts segments visible', async ({ mount }) => {
  const card = await mount(TokensByHourCard, {
    props: { data, mode: 'month', label: 'NOV 2026' },
  });
  await expectVisibleMix(card, 7, 0);
});

test('by-month keeps tiny input, output and thoughts segments visible', async ({ mount }) => {
  const card = await mount(TokensByMonthCard, { props: { data, yearKey: '2025' } });
  await expectVisibleMix(card, 9, 0);
});
