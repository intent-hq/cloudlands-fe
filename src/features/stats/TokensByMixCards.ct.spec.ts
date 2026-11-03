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
  // Visible means it covers at least one device pixel on this screen.
  const devicePixel = await card.evaluate(() => 1 / window.devicePixelRatio);
  for (const sel of ['.bar-thought', '.bar-out', '.bar-in']) {
    expect(heights[sel], `${sel} is visible`).toBeGreaterThanOrEqual(devicePixel);
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

test('by-hour still highlights the peak bar when no cache was reported', async ({ mount }) => {
  // A provider without cache counters: the peak (10h) must stay distinguishable
  // from its neighbour (9h) even though no cache segment exists.
  const noCache: UsageStatsResult = {
    ...data,
    byHourOfDay: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      ...empty,
      inputTokens: hour === 10 ? 900 : hour === 9 ? 600 : 0,
      outputTokens: hour === 10 ? 100 : hour === 9 ? 100 : 0,
    })),
  };
  const card = await mount(TokensByHourCard, {
    props: { data: noCache, mode: 'month', label: 'NOV 2026' },
  });
  const baseColor = (index: number) =>
    card
      .locator('.bar')
      .nth(index)
      .evaluate((node) => {
        // The colour the user actually sees: the bar's tallest segment.
        const segments = Array.from(node.children);
        const tallest = segments.reduce((a, b) =>
          b.getBoundingClientRect().height > a.getBoundingClientRect().height ? b : a,
        );
        return getComputedStyle(tallest).backgroundColor;
      });
  expect(await baseColor(10)).not.toBe(await baseColor(9));
});

// Mixes where a non-cache counter dominates: the base segment (the one that
// fills the bar) must keep its own floor, or a reported category vanishes
// while its legend entry still shows (review on cloudlands-fe#4113).
const dominatedMixes = {
  'input-dominated with a tiny cache': {
    counters: {
      ...empty,
      inputTokens: 100_000_000,
      outputTokens: 1,
      thoughtTokens: 1,
      cacheReadTokens: 1,
    },
    reported: ['.bar-thought', '.bar-out', '.bar-in', '.bar-cache'],
  },
  'output-dominated without cache': {
    counters: { ...empty, inputTokens: 1, outputTokens: 100_000_000 },
    reported: ['.bar-out', '.bar-in'],
  },
} as const;

async function expectReportedVisible(card: Locator, index: number, reported: readonly string[]) {
  const devicePixel = await card.evaluate(() => 1 / window.devicePixelRatio);
  const heights = await card
    .locator('.bar')
    .nth(index)
    .evaluate(
      (node, selectors) =>
        selectors.map((sel) => [sel, node.querySelector(sel)?.getBoundingClientRect().height ?? 0]),
      [...reported],
    );
  for (const [sel, height] of heights) {
    expect(height as number, `${sel} is visible`).toBeGreaterThanOrEqual(devicePixel);
  }
}

for (const [name, mix] of Object.entries(dominatedMixes)) {
  const mixData: UsageStatsResult = {
    ...data,
    byHourOfDay: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      ...(hour === 7 ? mix.counters : empty),
    })),
    byMonth: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      ...(i === 9 ? mix.counters : empty),
    })),
  };

  test(`by-hour shows every reported category when ${name}`, async ({ mount }) => {
    const card = await mount(TokensByHourCard, {
      props: { data: mixData, mode: 'month', label: 'NOV 2026' },
    });
    await expectReportedVisible(card, 7, mix.reported);
  });

  test(`by-month shows every reported category when ${name}`, async ({ mount }) => {
    const card = await mount(TokensByMonthCard, { props: { data: mixData, yearKey: '2025' } });
    await expectReportedVisible(card, 9, mix.reported);
  });
}
