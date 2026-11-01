/**
 * Time axis and value formatting for the trace waterfall.
 */
import {
  formatCompactDuration,
  formatCompactNumber,
  formatCurrency,
  formatDaySeparator,
  formatNumber,
  formatShortDate,
} from '$lib/i18n/format';
import type { TraceUsage } from '../trace-types';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NICE_STEPS_MS = [
  SECOND,
  2 * SECOND,
  5 * SECOND,
  10 * SECOND,
  15 * SECOND,
  20 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  20 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
];

/** Room after the last bar for its label. */
const HEADROOM = 1.18;

/** Each squeezed idle gap is at most this wide… */
const GAP_PX = 28;
/** …and all gaps together take at most this share of the timeline. */
const MAX_GAP_SHARE = 0.3;

/** A nice step so `durationMs` (plus label room) spans at most `maxTicks` intervals. */
function niceAxis(durationMs: number, maxTicks: number): { stepMs: number; domainMs: number } {
  const target = Math.max(SECOND, durationMs * HEADROOM);
  const intervals = Math.max(2, Math.floor(maxTicks));
  const stepMs =
    NICE_STEPS_MS.find((step) => Math.ceil(target / step) <= intervals) ??
    Math.ceil(target / intervals / DAY) * DAY;
  return { stepMs, domainMs: Math.max(stepMs, Math.ceil(target / stepMs) * stepMs) };
}

interface TraceTick {
  /** Axis position, 0–100. */
  position: number;
  /** Active time since the start of the view. */
  offsetMs: number;
}

interface TraceGap {
  /** Axis positions, 0–100. */
  from: number;
  to: number;
  idleMs: number;
}

export interface TraceTimeMap {
  /** Axis position (0–100) of an absolute time; before or after the view it falls outside. */
  at: (ms: number) => number;
  ticks: TraceTick[];
  gaps: TraceGap[];
  /** Active time per pixel of the timeline. */
  msPerPx: number;
}

/**
 * The axis for bursts of activity seen through the window `from`–`to`. Active
 * time is linear; each idle gap between bursts shrinks to a small fixed width,
 * so one timeline can hold a whole day.
 */
export function traceTimeMap(
  windows: readonly { start: number; end: number }[],
  from: number,
  to: number,
  widthPx: number,
  maxTicks: number,
): TraceTimeMap {
  const visible = windows
    .map((window) => ({ start: Math.max(window.start, from), end: Math.min(window.end, to) }))
    .filter((window) => window.end > window.start);
  if (visible.length === 0) visible.push({ start: from, end: Math.max(to, from + 1) });

  const width = Math.max(1, widthPx);
  const gapCount = visible.length - 1;
  const gapPx = gapCount > 0 ? Math.min(GAP_PX, (width * MAX_GAP_SHARE) / gapCount) : 0;
  const activeMs = visible.reduce((sum, window) => sum + window.end - window.start, 0);
  const { stepMs, domainMs } = niceAxis(activeMs, maxTicks);
  const pxPerMs = (width - gapCount * gapPx) / domainMs;

  // Left edge (px) and active time before each window.
  const lefts: number[] = [];
  const before: number[] = [];
  let x = 0;
  let active = 0;
  for (const window of visible) {
    lefts.push(x);
    before.push(active);
    x += (window.end - window.start) * pxPerMs + gapPx;
    active += window.end - window.start;
  }
  const percent = (px: number) => (px / width) * 100;
  const last = visible.length - 1;

  const at = (ms: number): number => {
    if (ms <= visible[0].start) return percent((ms - visible[0].start) * pxPerMs);
    for (let index = 0; index <= last; index += 1) {
      const window = visible[index];
      if (ms > window.end) continue;
      if (ms >= window.start) return percent(lefts[index] + (ms - window.start) * pxPerMs);
      // Idle time before this window spreads across the squeezed gap.
      const previous = visible[index - 1];
      const gapLeft = lefts[index - 1] + (previous.end - previous.start) * pxPerMs;
      const share = (ms - previous.end) / Math.max(1, window.start - previous.end);
      return percent(gapLeft + share * gapPx);
    }
    return percent(lefts[last] + (ms - visible[last].start) * pxPerMs);
  };

  const ticks: TraceTick[] = [];
  for (let offset = 0; offset < domainMs; offset += stepMs) {
    let index = 0;
    while (index < last && before[index + 1] <= offset) index += 1;
    ticks.push({
      position: percent(lefts[index] + (offset - before[index]) * pxPerMs),
      offsetMs: offset,
    });
  }

  const gaps: TraceGap[] = [];
  for (let index = 0; index < gapCount; index += 1) {
    const window = visible[index];
    const left = lefts[index] + (window.end - window.start) * pxPerMs;
    gaps.push({
      from: percent(left),
      to: percent(left + gapPx),
      idleMs: visible[index + 1].start - window.end,
    });
  }
  return { at, ticks, gaps, msPerPx: 1 / pxPerMs };
}

/** `760ms`, `6.9s`, `44s`, `1m 22s`, `2h 5m`. */
export function formatTraceDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs)) return '';
  const ms = Math.max(0, durationMs);
  if (ms < SECOND) {
    return formatNumber(Math.round(ms), {
      style: 'unit',
      unit: 'millisecond',
      unitDisplay: 'narrow',
    });
  }
  if (ms < 10 * SECOND) {
    return formatNumber(Math.floor(ms / 100) / 10, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'narrow',
      maximumFractionDigits: 1,
    });
  }
  return formatCompactDuration(ms);
}

/** `Today`, `Yesterday`, a weekday within the last week, then a short date (`Sep 2`). */
export function formatTraceDay(ms: number, now: number): string {
  const nowDate = new Date(now);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  return ms > weekAgo.getTime()
    ? formatDaySeparator(ms, { now: nowDate })
    : formatShortDate(ms, { now: nowDate });
}

/** Axis tick label: `0s`, `15s`, `1m`, `1m 30s`. */
export function formatTraceTick(offsetMs: number): string {
  return formatCompactDuration(offsetMs);
}

export function totalTokens(usage: TraceUsage | undefined): number {
  return usage ? usage.tokensIn + usage.tokensOut : 0;
}

export function formatTraceTokens(tokens: number): string {
  return formatCompactNumber(tokens);
}

/** `$0.12`; sub-cent amounts keep their significant digits (`$0.004`). */
export function formatCostAmount(amount: number, currency: string): string {
  return amount >= 0.01
    ? formatCurrency(amount, currency, { fractionDigits: 2 })
    : formatCurrency(amount, currency);
}

export function formatTraceCost(usage: TraceUsage | undefined): string | undefined {
  if (!usage?.cost || usage.cost.amount <= 0) return undefined;
  return formatCostAmount(usage.cost.amount, usage.cost.currency);
}
