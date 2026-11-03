import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { UsageStatsResult } from '$lib/client/app-client';
import { m } from '$shared/paraglide/messages.js';
import TokensByHourCard from './TokensByHourCard.svelte';

const data: UsageStatsResult = {
  totals: { inputTokens: 200, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  runs: 2,
  sessions: 1,
  longestRunMs: 0,
  linesAdded: 0,
  linesDeleted: 0,
  byModel: [],
  byProvider: [],
  byMonth: [],
  availablePeriods: { months: [], years: [] },
  byHourOfDay: [9, 18].map((hour) => ({
    hour,
    inputTokens: 100,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  })),
};

afterEach(cleanup);

function control(bound: 'start' | 'end', increase: boolean) {
  return screen.getByRole<HTMLButtonElement>('button', {
    name: `${increase ? 'Increase' : 'Decrease'} working hours ${bound}`,
  });
}

describe('working-hours stepper', () => {
  it.each(['month', '24h'] as const)(
    'updates the percentage for the selected inclusive-start/exclusive-end window in %s',
    async (mode) => {
      const { container } = render(TokensByHourCard, { data, mode, label: 'SEP 2026' });
      expect(container.textContent).toContain('50%');
      await fireEvent.click(control('start', true));
      expect(container.querySelector('.stat-value')?.textContent).toContain('0%');
      await fireEvent.click(control('end', true));
      expect(container.querySelector('.stat-value')?.textContent).toContain('50%');
      await fireEvent.click(control('start', false));
      expect(container.querySelector('.stat-value')?.textContent).toContain('100%');
    },
  );

  it('disables controls at midnight, 24:00, and a one-hour window', async () => {
    render(TokensByHourCard, { data, mode: 'month', label: 'SEP 2026' });
    for (let i = 0; i < 9; i++) await fireEvent.click(control('start', false));
    expect(control('start', false).disabled).toBe(true);
    for (let i = 0; i < 6; i++) await fireEvent.click(control('end', true));
    expect(control('end', true).disabled).toBe(true);
    for (let i = 0; i < 23; i++) await fireEvent.click(control('start', true));
    expect(control('start', true).disabled).toBe(true);
    expect(control('end', false).disabled).toBe(true);
    await fireEvent.click(control('start', false));
    expect(control('start', true).disabled).toBe(false);
    expect(control('end', false).disabled).toBe(false);
  });

  it('resets the local window when the card is reopened', async () => {
    const first = render(TokensByHourCard, { data, mode: 'month', label: 'SEP 2026' });
    await fireEvent.click(control('start', true));
    first.unmount();
    const second = render(TokensByHourCard, { data, mode: 'month', label: 'SEP 2026' });
    expect(second.container.querySelector('.wh-bound')?.textContent).toContain('09');
    expect(second.container.querySelector('.stat-value')?.textContent).toContain('50%');
  });
});

describe('token mix legend', () => {
  // Real-world mix: cache reads are ~98% of the bar (regression — the cache
  // hid inside the "input" segment; segment visibility is covered by the CT spec).
  const cacheHeavy: UsageStatsResult = {
    ...data,
    byHourOfDay: [
      {
        hour: 7,
        inputTokens: 13_000_000,
        outputTokens: 15_000_000,
        cacheReadTokens: 6_750_000_000,
        cacheCreationTokens: 111_000_000,
        thoughtTokens: 60_000,
      },
    ],
  };

  it('adds a cache legend entry when cache tokens were reported (regression)', () => {
    const { container } = render(TokensByHourCard, {
      data: cacheHeavy,
      mode: 'month',
      label: 'NOV 2026',
    });
    expect(container.querySelector('.legend')?.textContent).toContain(
      m.stats_card_legendCache_label(),
    );
  });

  it('omits the cache legend entry when no hour reported cache tokens', () => {
    const { container } = render(TokensByHourCard, { data, mode: 'month', label: 'SEP 2026' });
    expect(container.querySelector('.legend')?.textContent).not.toContain(
      m.stats_card_legendCache_label(),
    );
  });
});
