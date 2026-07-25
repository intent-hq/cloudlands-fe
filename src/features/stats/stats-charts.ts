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
import { formatTokens, totalTokens } from './stats-format';

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

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

/** Hour → "2pm"-style label for the peak-hour subtitle. */
export function hourAmPm(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export interface HourBar {
  heightPct: number;
  outPct: number;
  peak: boolean;
}

export interface HourCardModel {
  peakLabel: string;
  peakSub: string;
  grid: GridLine[];
  bars: HourBar[];
  axis: string[];
  workingHours: string;
  overnight: string;
}

/**
 * Derive the Tokens-by-Hour card from the 24 `byHourOfDay` cells. For
 * month/year the cells are local hours-of-day 0..23; in the 24h variant
 * (Spec D11 addendum) they are the trailing 24 hourly buckets in
 * chronological order, each labelled with its local hour. Working hours are
 * 09:00–18:00 local, overnight 00:00–06:00, both computed by local hour.
 */
export function hourCardModel(
  byHour: UsageHourStats[],
  variant: 'hour-of-day' | 'trailing-24h',
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

  return {
    peakLabel: peakIdx >= 0 ? `${pad2(cells[peakIdx].hour)}:00` : '—',
    peakSub:
      peakIdx >= 0
        ? `${formatTokens(totals[peakIdx])} tokens in the ${hourAmPm(cells[peakIdx].hour)} hour`
        : 'no activity in this period',
    grid: gridLines(max),
    bars,
    axis,
    workingHours: `09–18 · ${pct(inRange(9, 18))}%`,
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
      letter: MONTH_NAMES[i][0],
      active,
      best: i === bestIdx,
    };
  });

  const prev = bestIdx > 0 ? totals[bestIdx - 1] : 0;
  const hasDelta = bestIdx > 0 && prev > 0;

  return {
    heroLabel: elapsed === 12 ? 'FULL YEAR' : 'YEAR TO DATE',
    heroValue: formatTokens(sum),
    avgSub: `avg ${formatTokens(sum / elapsed)} / month`,
    grid: gridLines(max),
    bars,
    bestLabel: bestIdx >= 0 ? `${MONTH_NAMES[bestIdx]} · ${formatTokens(max)}` : '—',
    deltaLabel: hasDelta ? `VS ${MONTH_NAMES[bestIdx - 1].toUpperCase()}` : 'TREND',
    deltaValue: hasDelta ? `+${Math.round(((max - prev) / prev) * 100)}%` : '—',
  };
}
