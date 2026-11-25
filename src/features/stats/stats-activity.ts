/**
 * Pure models for the activity cards (Code Written, Tool Calls, Agent Team,
 * Activity Streak). Every helper accepts `null` (not loaded yet) and returns
 * a zeroed model, never NaN or Infinity.
 *
 * The activity fields are optional on the wire (PROTOCOL §5.36): an older
 * daemon omits them, which the cards show as "needs a newer version" rather
 * than as real zeroes. `activityTrackedSince` marks periods that began before
 * the daemon started recording them.
 */
import type { UsageDayStats, UsageStatsResult } from '$lib/client/app-client';
import type { StatsMode } from './stats-period';
import { totalTokens } from './stats-format';

/** Lines per printed page for the Code Written card's fun stat. */
const LINES_PER_PAGE = 50;

export interface CodeModel {
  added: number;
  deleted: number;
  /** `added - deleted`; negative when the agents removed more than they wrote. */
  net: number;
  touched: number;
  /** Printed pages of the lines added. */
  pages: number;
  /** Share of `touched` that is additions (0..1); 0 when nothing changed. */
  addedShare: number;
}

export function codeModel(data: UsageStatsResult | null): CodeModel {
  const added = data?.linesAdded ?? 0;
  const deleted = data?.linesDeleted ?? 0;
  const touched = added + deleted;
  return {
    added,
    deleted,
    net: added - deleted,
    touched,
    pages: Math.round(added / LINES_PER_PAGE),
    addedShare: touched > 0 ? added / touched : 0,
  };
}

/** True when the daemon sent the activity counters (it is new enough). */
export function hasActivityCounters(data: UsageStatsResult | null): boolean {
  return data === null || data.toolCalls !== undefined;
}

export interface ToolsModel {
  total: number;
  failed: number;
  succeeded: number;
  /** `succeeded / total`, or null when there were no calls. */
  successRate: number | null;
  /** Tool calls per completed run, or null when there were no runs. */
  perRun: number | null;
}

export function toolsModel(data: UsageStatsResult | null): ToolsModel {
  const total = data?.toolCalls ?? 0;
  const failed = Math.min(data?.toolCallsFailed ?? 0, total);
  const runs = data?.runs ?? 0;
  return {
    total,
    failed,
    succeeded: total - failed,
    successRate: total > 0 ? (total - failed) / total : null,
    perRun: runs > 0 && data?.toolCalls !== undefined ? total / runs : null,
  };
}

export interface TeamModel {
  agents: number;
  topLevel: number;
  subAgents: number;
  /** Share of agents that are sub-agents (0..1); 0 with no agents. */
  subShare: number;
  agentMs: number;
  /** Average completed-turn length, or null when there were no runs. */
  avgTurnMs: number | null;
  longestRunMs: number;
}

export function teamModel(data: UsageStatsResult | null): TeamModel {
  const agents = data?.sessions ?? 0;
  const subAgents = Math.min(data?.subAgentSessions ?? 0, agents);
  const runs = data?.runs ?? 0;
  const agentMs = data?.totalRunMs ?? 0;
  return {
    agents,
    topLevel: agents - subAgents,
    subAgents,
    subShare: agents > 0 ? subAgents / agents : 0,
    agentMs,
    avgTurnMs: runs > 0 && data?.totalRunMs !== undefined ? agentMs / runs : null,
    longestRunMs: data?.longestRunMs ?? 0,
  };
}

/** "YYYY-MM-DD" for a local date. */
function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local Date for a "YYYY-MM-DD" key (noon avoids DST edge cases). */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** First local day of the selected period, as "YYYY-MM-DD". */
function periodStartKey(mode: StatsMode, periodKey: string | null, now: Date): string {
  if (mode === '24h') return dateKey(new Date(now.getTime() - 24 * 3_600_000));
  if (mode === 'month') return `${(periodKey ?? dateKey(now)).slice(0, 7)}-01`;
  return `${(periodKey ?? dateKey(now)).slice(0, 4)}-01-01`;
}

/**
 * The tracked-since date to show on the activity cards, or null when the
 * whole period was tracked (or the daemon sent no date).
 */
export function trackedSinceNote(
  data: UsageStatsResult | null,
  mode: StatsMode,
  periodKey: string | null,
  now: Date = new Date(),
): Date | null {
  const since = data?.activityTrackedSince;
  if (!since) return null;
  return periodStartKey(mode, periodKey, now) < since ? parseDateKey(since) : null;
}

/** A day counts as active when any run completed or any tokens were recorded. */
function isActiveDay(day: UsageDayStats): boolean {
  return day.runs > 0 || totalTokens(day) > 0;
}

interface HeatCell {
  /** "YYYY-MM-DD", or null for a padding cell outside the month. */
  date: string | null;
  tokens: number;
  active: boolean;
  /** Shade 0 (none) to 4 (busiest). */
  level: 0 | 1 | 2 | 3 | 4;
  /** After today: drawn empty, never counted. */
  future: boolean;
}

export interface StreakModel {
  /** Month: weeks of 7 cells (Sunday first). Year: 12 rows of 31 cells. */
  rows: HeatCell[][];
  activeDays: number;
  /** Days in the period up to today. */
  elapsedDays: number;
  longestStreak: number;
  /** Null when the period does not include today. */
  currentStreak: number | null;
  busiest: { date: string; tokens: number } | null;
}

function level(tokens: number, active: boolean, max: number): HeatCell['level'] {
  if (!active) return 0;
  if (max <= 0 || tokens <= 0) return 1;
  return Math.min(4, Math.max(1, Math.ceil((tokens / max) * 4))) as HeatCell['level'];
}

/**
 * Calendar and streak math for the Activity Streak card. Streaks are counted
 * inside the selected period only. The current streak ends today, or
 * yesterday when today has no activity yet, so a streak is not "broken"
 * before the day is over.
 */
export function streakModel(
  data: UsageStatsResult | null,
  mode: 'month' | 'year',
  periodKey: string | null,
  now: Date = new Date(),
  activitySource: UsageStatsResult | null = data,
): StreakModel {
  const year = Number((periodKey ?? '').slice(0, 4)) || now.getFullYear();
  const month = mode === 'month' ? Number((periodKey ?? '').slice(5, 7)) || 1 : 1;
  const first = new Date(year, month - 1, 1, 12);
  const last = mode === 'month' ? new Date(year, month, 0, 12) : new Date(year, 11, 31, 12);
  const today = dateKey(now);

  const days = new Map<string, UsageDayStats>();
  for (const day of data?.byDay ?? []) days.set(day.date, day);
  // Activity comes from the unfiltered result, so hiding cached tokens only
  // changes the shading, never which days count.
  const activeDates = new Set(
    (activitySource?.byDay ?? []).filter(isActiveDay).map((day) => day.date),
  );
  const max = Math.max(0, ...[...days.values()].map((d) => totalTokens(d)));

  const cellFor = (date: Date): HeatCell => {
    const key = dateKey(date);
    const day = days.get(key);
    const tokens = day ? totalTokens(day) : 0;
    const active = activeDates.has(key);
    return { date: key, tokens, active, level: level(tokens, active, max), future: key > today };
  };

  // Walk the period once for the streak stats.
  let activeDays = 0;
  let elapsedDays = 0;
  let longest = 0;
  let run = 0;
  let busiest: StreakModel['busiest'] = null;
  for (let date = first; dateKey(date) <= dateKey(last); date = addDays(date, 1)) {
    const cell = cellFor(date);
    if (cell.future) break;
    elapsedDays += 1;
    if (cell.active) {
      activeDays += 1;
      run += 1;
      longest = Math.max(longest, run);
      if (!busiest || cell.tokens > busiest.tokens)
        busiest = { date: cell.date!, tokens: cell.tokens };
    } else {
      run = 0;
    }
  }

  let currentStreak: number | null = null;
  if (today >= dateKey(first) && today <= dateKey(last)) {
    let cursor = parseDateKey(today)!;
    if (!cellFor(cursor).active) cursor = addDays(cursor, -1);
    currentStreak = 0;
    while (dateKey(cursor) >= dateKey(first) && cellFor(cursor).active) {
      currentStreak += 1;
      cursor = addDays(cursor, -1);
    }
  }

  const blank: HeatCell = { date: null, tokens: 0, active: false, level: 0, future: false };
  const rows: HeatCell[][] = [];
  if (mode === 'month') {
    const cells: HeatCell[] = Array.from({ length: first.getDay() }, () => blank);
    for (let date = first; dateKey(date) <= dateKey(last); date = addDays(date, 1)) {
      cells.push(cellFor(date));
    }
    while (cells.length % 7 !== 0) cells.push(blank);
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  } else {
    for (let m = 0; m < 12; m += 1) {
      const length = new Date(year, m + 1, 0).getDate();
      rows.push(
        Array.from({ length: 31 }, (_, d) =>
          d < length ? cellFor(new Date(year, m, d + 1, 12)) : blank,
        ),
      );
    }
  }

  return { rows, activeDays, elapsedDays, longestStreak: longest, currentStreak, busiest };
}

/**
 * Hero font size that keeps a long number inside the 312px content width of
 * a card (the mono face is about 0.6em per character).
 */
export function heroFontSize(text: string): number {
  if (text.length <= 8) return 53;
  if (text.length <= 11) return 40;
  return 32;
}

/** Grid value font size that keeps long numbers inside a half-width cell. */
export function statFontSize(text: string): number {
  if (text.length <= 9) return 23;
  if (text.length <= 12) return 18;
  return 15;
}
