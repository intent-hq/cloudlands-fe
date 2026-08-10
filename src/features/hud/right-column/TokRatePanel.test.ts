/**
 * TokRatePanel tests — the chart drops the "PK" peak label and the "−40M"
 * window-start footer, renders the "1 MIN BUCKETS" window label, and adds an
 * x-axis of on-the-hour LOCAL-time ticks plus a right-edge label at the newest
 * bucket's local time. Labels are computed from the same Date logic the
 * component uses, so the assertions are timezone-independent. Each bar stacks
 * the §5.39 per-kind counters (in / out / thoughts / cached = read + creation)
 * with a legend, and zero-count kinds render no segment.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import {
  hudActivated,
  hudRateHistoryLoaded,
  type HudRateHistoryState,
  type HudUsageTotals,
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
    samples: buckets.map((bucketUtc) => ({
      bucketUtc,
      inputTokens: 60,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })),
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

  describe('stacked per-kind segments', () => {
    /** One bucket carrying the given §5.39 counters. */
    function bucket(counters: Partial<HudUsageTotals>): HudRateHistoryState {
      return {
        samples: [
          {
            bucketUtc: '2026-07-30T14:59:00Z',
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            ...counters,
          },
        ],
        fetchedAtMs: 1,
      };
    }

    function segments(): Array<{ kind: string; grow: string }> {
      return Array.from(panel().querySelectorAll('.hud-tokrate-segment')).map((el) => ({
        kind: (el as HTMLElement).dataset.segment ?? '',
        grow: (el as HTMLElement).style.flexGrow,
      }));
    }

    it('stacks in / out / thoughts / cached sized by their token counts', () => {
      render(TokRatePanel);
      appStore.dispatch(
        hudRateHistoryLoaded(
          bucket({
            inputTokens: 100,
            outputTokens: 40,
            thoughtTokens: 30,
            cacheReadTokens: 20,
            cacheCreationTokens: 5,
          }),
        ),
      );
      flushSync();
      // cached folds cacheRead + cacheCreation into one segment (20 + 5).
      expect(segments()).toEqual([
        { kind: 'in', grow: '100' },
        { kind: 'out', grow: '40' },
        { kind: 'thoughts', grow: '30' },
        { kind: 'cached', grow: '25' },
      ]);
    });

    it('drops zero-count kinds — an absent thoughtTokens renders no segment', () => {
      render(TokRatePanel);
      appStore.dispatch(hudRateHistoryLoaded(bucket({ inputTokens: 100, outputTokens: 40 })));
      flushSync();
      expect(segments().map((segment) => segment.kind)).toEqual(['in', 'out']);
    });

    it('renders the four-kind legend once the panel mounts', () => {
      render(TokRatePanel);
      flushSync();
      const labels = Array.from(
        screen.getByTestId('hud-tokrate-legend').querySelectorAll('.hud-tokrate-legend-item'),
      ).map((el) => el.textContent?.trim());
      expect(labels).toEqual(['IN', 'OUT', 'THOUGHTS', 'CACHED']);
    });

    it('normalizes bar height on the summed bucket total, thoughts included', () => {
      render(TokRatePanel);
      appStore.dispatch(
        hudRateHistoryLoaded({
          samples: [
            {
              bucketUtc: '2026-07-30T14:58:00Z',
              inputTokens: 50,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
            },
            {
              bucketUtc: '2026-07-30T14:59:00Z',
              inputTokens: 50,
              outputTokens: 25,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              thoughtTokens: 25,
            },
          ],
          fetchedAtMs: 1,
        }),
      );
      flushSync();
      const heights = Array.from(panel().querySelectorAll('.hud-tokrate-bar')).map(
        (el) => (el as HTMLElement).style.height,
      );
      // Max total is 100 (50 + 25 + 25), so the 50-token bucket is half height.
      expect(heights).toEqual(['50%', '100%']);
    });
  });
});
