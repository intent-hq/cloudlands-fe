/**
 * TokRatePanel tests — the chart drops the "PK" peak label and the "−40M"
 * window-start footer, renders the "1 MIN BUCKETS" window label, and adds an
 * x-axis of on-the-hour LOCAL-time ticks plus a right-edge label at the newest
 * bucket's local time. Labels are computed from the same Date logic the
 * component uses, so the assertions are timezone-independent.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import {
  hudActivated,
  hudRateHistoryLoaded,
  type HudRateHistoryState,
} from '$store/renderer/slices/hud/hud-slice';

import TokRatePanel from './TokRatePanel.svelte';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local "HH:00" hour-boundary label the component renders for a bucket. */
function hourLabel(bucketUtc: string): string {
  return `${pad2(new Date(bucketUtc).getHours())}:00`;
}

/** Local "HH:MM" right-edge label the component renders for the newest bucket. */
function nowLabel(bucketUtc: string): string {
  const date = new Date(bucketUtc);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function history(buckets: string[]): HudRateHistoryState {
  return {
    samples: buckets.map((bucketUtc) => ({ bucketUtc, tokens: 60 })),
    fetchedAtMs: 1,
  };
}

function panel(): HTMLElement {
  return screen.getByTestId('hud-tokrate-panel');
}

function tickTexts(): string[] {
  return Array.from(panel().querySelectorAll('.hud-tokrate-tick')).map(
    (el) => el.textContent?.trim() ?? '',
  );
}

describe('TokRatePanel', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(hudActivated());
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('preserves the data-testid hook', () => {
    render(TokRatePanel);
    expect(screen.queryByTestId('hud-tokrate-panel')).not.toBeNull();
  });

  it('renders the 1 MIN BUCKETS window label and drops the PK / −40M labels', () => {
    render(TokRatePanel);
    appStore.dispatch(
      hudRateHistoryLoaded(history(['2026-07-30T14:58:00Z', '2026-07-30T14:59:00Z'])),
    );
    flushSync();
    expect(panel().querySelector('.hud-tokrate-window')?.textContent).toBe('1 MIN BUCKETS');
    expect(panel().querySelector('.hud-tokrate-peak')).toBeNull();
    expect(panel().textContent).not.toContain('PK');
    expect(panel().textContent).not.toContain('−40M');
  });

  it('renders an on-the-hour tick plus a right-edge now label in local time', () => {
    render(TokRatePanel);
    const buckets = [
      '2026-07-30T14:58:00Z',
      '2026-07-30T14:59:00Z',
      '2026-07-30T15:00:00Z',
      '2026-07-30T15:01:00Z',
      '2026-07-30T15:02:00Z',
    ];
    appStore.dispatch(hudRateHistoryLoaded(history(buckets)));
    flushSync();
    const texts = tickTexts();
    // One hour-boundary tick (15:00 bucket) + the right-edge newest label.
    expect(texts).toContain(hourLabel('2026-07-30T15:00:00Z'));
    expect(texts).toContain(nowLabel('2026-07-30T15:02:00Z'));
    const rightEdge = panel().querySelector('.hud-tokrate-tick.right-edge') as HTMLElement;
    expect(rightEdge.textContent?.trim()).toBe(nowLabel('2026-07-30T15:02:00Z'));
  });

  it('shows only the right-edge label when no bucket falls on the hour', () => {
    render(TokRatePanel);
    appStore.dispatch(
      hudRateHistoryLoaded(
        history(['2026-07-30T14:58:00Z', '2026-07-30T14:59:00Z', '2026-07-30T15:01:00Z']),
      ),
    );
    flushSync();
    expect(tickTexts()).toEqual([nowLabel('2026-07-30T15:01:00Z')]);
  });

  it('does not duplicate the hour tick when the newest bucket is on the hour', () => {
    render(TokRatePanel);
    const buckets = ['2026-07-30T14:58:00Z', '2026-07-30T14:59:00Z', '2026-07-30T15:00:00Z'];
    appStore.dispatch(hudRateHistoryLoaded(history(buckets)));
    flushSync();
    // The newest bucket's hour tick is dropped; only the right-edge label shows.
    expect(tickTexts()).toEqual([nowLabel('2026-07-30T15:00:00Z')]);
    expect(panel().querySelectorAll('.hud-tokrate-tick.right-edge')).toHaveLength(1);
  });

  it('renders no ticks before any samples arrive', () => {
    render(TokRatePanel);
    flushSync();
    expect(panel().querySelectorAll('.hud-tokrate-tick')).toHaveLength(0);
  });
});
