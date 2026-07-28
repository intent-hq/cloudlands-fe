/**
 * Pure chart math for the Tokens-by-Hour and Tokens-by-Month stat cards.
 *
 * Ports the design's `grids()` gridline helper (Agent Stats Share design)
 * and derives the histogram bar geometry + hero stats from real
 * `stats.getUsage` cells. Cache counters fold into the "input" bar segment;
 * the 4 separate counters live on the passport card (Spec D6, assumption in
 * the workspace spec). Token formatting comes from `stats-format.ts`.
 */
import type { UsageHourStats, UsageMonthStats } from '$lib/client/app-client';
import { formatDatePattern } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import { formatTokens, totalTokens } from './stats-format';

/** Abbreviated month name ("Jan") for a 0-based month index, in the active locale. */
function monthName(index: number): string {
  return formatDatePattern(new Date(2026, index, 1), 'MMM');
}

export interface GridLine {
  label: string;
  bottomPct: number;
}

/**
 * Gridline step selection (design `grids()`): candidate steps are
 * 1 / 2 / 2.5 / 5 × 10^k; pick the largest step whose double still fits under
 * `max`, then emit the two lines (label + bottom offset %). The 2.5 base is
 * only offered from 25M upward, where `formatTokens` renders it exactly
 * ("250M", "2.50B" — never a lossy "3M"). Lines that would land above the
 * chart top and zero/empty charts yield fewer (or no) lines — never NaN.
 */
export function gridLines(max: number): GridLine[] {
  if (!Number.isFinite(max) || max <= 0) return [];
  let step = 1;
  for (let k = 0; k <= 13; k++) {
    for (const base of [1, 2, 2.5, 5]) {
      const c = base * 10 ** k;
      if (base === 2.5 && c < 2.5e7) continue;
      if (2 * c <= max) step = c;
    }
  }
  return [step, 2 * step]
    .map((v) => ({ label: formatTokens(v), bottomPct: +((v / max) * 100).toFixed(1) }))
    .filter((l) => l.bottomPct <= 100);
}

/** Hour → "2pm"-style label for the peak-hour subtitle, in the active locale. */
export function hourAmPm(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return formatDatePattern(new Date(2026, 0, 1, h), 'haaa');
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export interface HourBar {
  heightPct: number;
  outPct: number;
  peak: boolean;
}

/** Inclusive-start / exclusive-end local-hour window, e.g. 9→18 = 09:00–18:00. */
export interface HourWindow {
  start: number;
  end: number;
}

/** Default WORKING HOURS window: 09:00–18:00 local (Spec D15). */
export const DEFAULT_WORKING_HOURS: HourWindow = { start: 9, end: 18 };

/**
 * Step one bound of a working-hours window by `delta` hours, clamped so the
 * window stays valid: start ∈ [0, end-1], end ∈ [start+1, 24] (Spec D15).
 */
export function stepHourWindow(
  window: HourWindow,
  bound: 'start' | 'end',
  delta: number,
): HourWindow {
  if (bound === 'start') {
    return { ...window, start: Math.max(0, Math.min(window.end - 1, window.start + delta)) };
  }
  return { ...window, end: Math.max(window.start + 1, Math.min(24, window.end + delta)) };
}

export interface HourCardModel {
  peakLabel: string;
  peakSub: string;
  grid: GridLine[];
  bars: HourBar[];
  axis: string[];
  workingHours: string;
  workingHoursPct: number;
  overnight: string;
}

/**
 * Derive the Tokens-by-Hour card from the 24 `byHourOfDay` cells. For
 * month/year the cells are local hours-of-day 0..23; in the 24h variant
 * (Spec D11 addendum) they are the trailing 24 hourly buckets in
 * chronological order, each labelled with its local hour. Working hours
 * cover the `workingWindow` local hours (default 09:00–18:00, adjustable in
 * the card per Spec D15), overnight 00:00–06:00, both computed by local hour.
 */
export function hourCardModel(
  byHour: UsageHourStats[],
  variant: 'hour-of-day' | 'trailing-24h',
  workingWindow: HourWindow = DEFAULT_WORKING_HOURS,
): HourCardModel {
  const cells: UsageHourStats[] = Array.from({ length: 24 }, (_, i) => {
    return (
      byHour[i] ?? {
        hour: i,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }
    );
  });
  const totals = cells.map(totalTokens);
  const grand = totals.reduce((a, b) => a + b, 0);
  const max = Math.max(...totals);
  let peakIdx = -1;
  if (grand > 0) peakIdx = totals.indexOf(max);

  const bars: HourBar[] = cells.map((c, i) => ({
    heightPct: max > 0 ? +((totals[i] / max) * 100).toFixed(1) : 0,
    outPct: totals[i] > 0 ? +((c.outputTokens / totals[i]) * 100).toFixed(1) : 0,
    peak: i === peakIdx,
  }));

  const inRange = (lo: number, hi: number) =>
    cells.reduce((sum, c, i) => (c.hour >= lo && c.hour < hi ? sum + totals[i] : sum), 0);
  const pct = (part: number) => (grand > 0 ? Math.round((part / grand) * 100) : 0);

  const axis = [0, 6, 12, 18, 23].map((i) => pad2(variant === 'trailing-24h' ? cells[i].hour : i));

  const workingHoursPct = pct(inRange(workingWindow.start, workingWindow.end));

  return {
    peakLabel: peakIdx >= 0 ? `${pad2(cells[peakIdx].hour)}:00` : '—',
    peakSub:
      peakIdx >= 0
        ? m.stats_hourCard_peakSub_label({
            tokens: formatTokens(totals[peakIdx]),
            hour: hourAmPm(cells[peakIdx].hour),
          })
        : m.stats_hourCard_noActivity_label(),
    grid: gridLines(max),
    bars,
    axis,
    workingHours: `${pad2(workingWindow.start)}–${pad2(workingWindow.end)} · ${workingHoursPct}%`,
    workingHoursPct,
    overnight: `${pct(inRange(0, 6))}%`,
  };
}

export interface MonthBar {
  heightPct: number;
  outPct: number;
  letter: string;
  /** Month is inside the elapsed part of the year (real bar vs grey stub). */
  active: boolean;
  best: boolean;
}

export interface MonthCardModel {
  heroLabel: string;
  heroValue: string;
  avgSub: string;
  grid: GridLine[];
  bars: MonthBar[];
  bestLabel: string;
  deltaLabel: string;
  deltaValue: string;
}

/**
 * Derive the Tokens-by-Month card from the 12 `byMonth` cells of the selected
 * local year. `monthsElapsed` is how many months of that year have passed
 * (12 for past years, current month number for the current year): it drives
 * the FULL YEAR vs YEAR TO DATE hero label, the avg/month divisor, and which
 * months render as real bars vs future-month stubs (design's `has` flag).
 * Delta compares the best month against its predecessor and is "—" when not
 * applicable (best month is January, predecessor empty, or no data at all).
 */
export function monthCardModel(byMonth: UsageMonthStats[], monthsElapsed: number): MonthCardModel {
  const elapsed = Math.min(12, Math.max(1, Math.round(monthsElapsed)));
  const cells: UsageMonthStats[] = Array.from({ length: 12 }, (_, i) => {
    return (
      byMonth[i] ?? {
        month: i + 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }
    );
  });
  const totals = cells.map(totalTokens);
  const sum = totals.reduce((a, b) => a + b, 0);
  const max = Math.max(...totals);
  const bestIdx = sum > 0 ? totals.indexOf(max) : -1;

  const bars: MonthBar[] = cells.map((c, i) => {
    const active = i < elapsed;
    return {
      heightPct: active ? (max > 0 ? +((totals[i] / max) * 100).toFixed(1) : 0) : 2,
      outPct: active && totals[i] > 0 ? +((c.outputTokens / totals[i]) * 100).toFixed(1) : 0,
      letter: monthName(i)[0],
      active,
      best: i === bestIdx,
    };
  });

  const prev = bestIdx > 0 ? totals[bestIdx - 1] : 0;
  const hasDelta = bestIdx > 0 && prev > 0;

  return {
    heroLabel: elapsed === 12 ? m.stats_monthCard_fullYear_label() : m.stats_monthCard_yearToDate_label(),
    heroValue: formatTokens(sum),
    avgSub: m.stats_monthCard_avgSub_label({ amount: formatTokens(sum / elapsed) }),
    grid: gridLines(max),
    bars,
    bestLabel:
      bestIdx >= 0
        ? m.stats_monthCard_bestMonthValue_label({
            month: monthName(bestIdx),
            tokens: formatTokens(max),
          })
        : '—',
    deltaLabel: hasDelta
      ? m.stats_monthCard_deltaVs_label({ month: monthName(bestIdx - 1).toUpperCase() })
      : m.stats_monthCard_trend_label(),
    deltaValue: hasDelta ? `+${Math.round(((max - prev) / prev) * 100)}%` : '—',
  };
}
