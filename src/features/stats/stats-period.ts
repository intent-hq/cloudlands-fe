/**
 * Pure period/dropdown state logic for the usage-stats overlay.
 *
 * Modes mirror the `stats.getUsage` wire contract: "24h" (rolling window, no
 * key, dropdown hidden — Spec D11), "month" ("YYYY-MM" key), "year" ("YYYY"
 * key). Dropdown options come exclusively from the daemon's
 * `availablePeriods`; the FE never fabricates periods.
 */
import type { UsageStatsPeriod } from '$lib/client/app-client';

export type StatsMode = UsageStatsPeriod;

/** Mode toggle order per Spec D11: 24H first. */
export const STATS_MODES: { mode: StatsMode; label: string }[] = [
  { mode: '24h', label: '24H' },
  { mode: 'month', label: 'Month' },
  { mode: 'year', label: 'Year' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "YYYY-MM" for the current local month. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** "YYYY" for the current local year. */
export function currentYearKey(now: Date = new Date()): string {
  return String(now.getFullYear());
}

/** Minutes east of UTC for the client's local timezone (Spec D8). */
export function localTzOffsetMinutes(now: Date = new Date()): number {
  // JS getTimezoneOffset() is minutes WEST of UTC; the wire wants east.
  return -now.getTimezoneOffset();
}

/** Full dropdown label for a period key ("2026-07" → "July 2026"). */
export function periodLabel(mode: StatsMode, key: string): string {
  if (mode !== 'month') return key;
  const month = Number(key.slice(5, 7));
  const name = MONTH_NAMES[month - 1];
  return name ? `${name} ${key.slice(0, 4)}` : key;
}

/** Card-corner short label ("2026-07" → "JUL 2026"; 24h → "LAST 24H"). */
export function shortLabel(mode: StatsMode, key: string): string {
  if (mode === '24h') return 'LAST 24H';
  if (mode !== 'month') return key;
  const name = periodLabel('month', key);
  return name === key ? key : `${name.slice(0, 3).toUpperCase()} ${key.slice(0, 4)}`;
}

/**
 * Dropdown option keys for a mode, newest first. Only periods the daemon
 * reported in `availablePeriods` are offered; 24h has no dropdown.
 */
export function periodOptions(
  mode: StatsMode,
  available: { months: string[]; years: string[] },
): string[] {
  if (mode === '24h') return [];
  const keys = mode === 'month' ? available.months : available.years;
  return [...keys].sort().reverse();
}

/**
 * The period key to select when entering `mode`: the current local
 * month/year when available, else the newest available period, else the
 * current period anyway (an empty dataset renders zeroed cards, not an
 * error). 24h needs no key.
 */
export function defaultPeriodKey(
  mode: StatsMode,
  available: { months: string[]; years: string[] },
  now: Date = new Date(),
): string | undefined {
  if (mode === '24h') return undefined;
  const current = mode === 'month' ? currentMonthKey(now) : currentYearKey(now);
  const options = periodOptions(mode, available);
  if (options.length === 0 || options.includes(current)) return current;
  return options[0];
}
