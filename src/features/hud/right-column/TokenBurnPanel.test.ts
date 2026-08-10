/**
 * TokenBurnPanel tests — the 24h total sums EVERY §5.36 counter (input,
 * output, thoughts, cache read + creation), sits on its own line above a
 * label/rate row (so "TOK · 24H" never wraps), the "…/min" readout is the
 * last-5-minute average from the hud slice, and the trend arrow renders ▲ for
 * up / ▼ for down / nothing (neutral) on the first load and when flat.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import {
  hudActivated,
  hudRateHistoryLoaded,
  hudUsageLoaded,
  type HudRateHistoryState,
  type HudUsageState,
  type HudUsageTotals,
} from '$store/renderer/slices/hud/hud-slice';

import TokenBurnPanel from './TokenBurnPanel.svelte';

/** A §5.36 rollup whose totals carry only the given counters. */
function usage(counters: Partial<HudUsageTotals>): HudUsageState {
  return {
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      ...counters,
    },
    runs: 0,
    rateSamples: [],
    fetchedAtMs: 1,
  };
}

/** Minute buckets whose per-kind counters sum to each given total. */
function history(tokens: number[]): HudRateHistoryState {
  return {
    samples: tokens.map((value, index) => ({
      bucketUtc: `2026-07-30T14:${String(index).padStart(2, '0')}:00Z`,
      inputTokens: value,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })),
    fetchedAtMs: 1,
  };
}

function panel(): HTMLElement {
  return screen.getByTestId('hud-token-burn-panel');
}

describe('TokenBurnPanel', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(hudActivated());
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('preserves the data-testid hook', () => {
    render(TokenBurnPanel);
    expect(screen.queryByTestId('hud-token-burn-panel')).not.toBeNull();
  });

  it('labels the total as TOK · 24H (never the old SESSION wording)', () => {
    render(TokenBurnPanel);
    appStore.dispatch(hudUsageLoaded(usage({ inputTokens: 12345 })));
    flushSync();
    const key = panel().querySelector('.hud-burn-key') as HTMLElement;
    expect(key.textContent).toBe('TOK · 24H');
    expect(panel().textContent).not.toContain('SESSION');
  });

  it('sums every counter into the 24h total — thoughts and cache included', () => {
    render(TokenBurnPanel);
    appStore.dispatch(
      hudUsageLoaded(
        usage({
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 30,
          cacheCreationTokens: 4,
          thoughtTokens: 100,
        }),
      ),
    );
    flushSync();
    expect(panel().querySelector('.hud-burn-total')?.textContent?.trim()).toBe('1,334');
  });

  it('omits thoughts from the total when the daemon did not report them (§5.23)', () => {
    render(TokenBurnPanel);
    appStore.dispatch(hudUsageLoaded(usage({ inputTokens: 1000, outputTokens: 200 })));
    flushSync();
    expect(panel().querySelector('.hud-burn-total')?.textContent?.trim()).toBe('1,200');
  });

  it('keeps the total on its own line above the label/rate row', () => {
    render(TokenBurnPanel);
    appStore.dispatch(hudUsageLoaded(usage({ inputTokens: 12345 })));
    flushSync();
    const total = panel().querySelector('.hud-burn-total') as HTMLElement;
    const meta = panel().querySelector('.hud-burn-meta') as HTMLElement;
    expect(total).not.toBeNull();
    expect(meta).not.toBeNull();
    // The total is a sibling of the label/rate row, not inside it.
    expect(meta.contains(total)).toBe(false);
    expect(meta.querySelector('.hud-burn-key')).not.toBeNull();
    expect(meta.querySelector('.hud-burn-rate')).not.toBeNull();
  });

  it('shows the last-5-minute average as the /min readout', () => {
    render(TokenBurnPanel);
    // (100+200+300+400+500)/5 = 300.
    appStore.dispatch(hudRateHistoryLoaded(history([100, 200, 300, 400, 500])));
    flushSync();
    expect(panel().querySelector('.hud-burn-rate')?.textContent?.trim()).toBe('300/min');
  });

  it('renders neutral with no arrow on the first load', () => {
    render(TokenBurnPanel);
    appStore.dispatch(hudRateHistoryLoaded(history([100, 100, 100, 100, 100])));
    flushSync();
    const rate = panel().querySelector('.hud-burn-rate') as HTMLElement;
    expect(rate.classList.contains('up')).toBe(false);
    expect(rate.classList.contains('down')).toBe(false);
    expect(panel().querySelector('[data-testid="hud-burn-arrow"]')).toBeNull();
  });

  it('renders the ▲ up arrow (with the up class) when the average rises', () => {
    render(TokenBurnPanel);
    appStore.dispatch(hudRateHistoryLoaded(history([100, 100, 100, 100, 100])));
    appStore.dispatch(hudRateHistoryLoaded(history([100, 100, 100, 100, 600])));
    flushSync();
    const rate = panel().querySelector('.hud-burn-rate') as HTMLElement;
    const arrow = panel().querySelector('[data-testid="hud-burn-arrow"]') as HTMLElement;
    expect(rate.classList.contains('up')).toBe(true);
    expect(arrow?.textContent).toBe('▲');
  });

  it('renders the ▼ down arrow (with the down class) when the average falls', () => {
    render(TokenBurnPanel);
    appStore.dispatch(hudRateHistoryLoaded(history([500, 500, 500, 500, 500])));
    appStore.dispatch(hudRateHistoryLoaded(history([100, 100, 100, 100, 100])));
    flushSync();
    const rate = panel().querySelector('.hud-burn-rate') as HTMLElement;
    const arrow = panel().querySelector('[data-testid="hud-burn-arrow"]') as HTMLElement;
    expect(rate.classList.contains('down')).toBe(true);
    expect(arrow?.textContent).toBe('▼');
  });

  it('drops the arrow again when the average goes flat', () => {
    render(TokenBurnPanel);
    appStore.dispatch(hudRateHistoryLoaded(history([100, 100, 100, 100, 100])));
    appStore.dispatch(hudRateHistoryLoaded(history([600, 600, 600, 600, 600])));
    appStore.dispatch(hudRateHistoryLoaded(history([600, 600, 600, 600, 600])));
    flushSync();
    const rate = panel().querySelector('.hud-burn-rate') as HTMLElement;
    expect(rate.classList.contains('up')).toBe(false);
    expect(rate.classList.contains('down')).toBe(false);
    expect(panel().querySelector('[data-testid="hud-burn-arrow"]')).toBeNull();
  });
});
