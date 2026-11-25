import { describe, expect, it } from 'vitest';
import type { UsageDayStats, UsageStatsResult } from '$lib/client/app-client';
import {
  codeModel,
  hasActivityCounters,
  heroFontSize,
  streakModel,
  teamModel,
  toolsModel,
  trackedSinceNote,
} from './stats-activity';
import { withoutCachedTokens } from './stats-format';

const zeroCell = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

function usage(overrides: Partial<UsageStatsResult> = {}): UsageStatsResult {
  return {
    totals: zeroCell,
    runs: 0,
    sessions: 0,
    longestRunMs: 0,
    linesAdded: 0,
    linesDeleted: 0,
    toolCalls: 0,
    toolCallsFailed: 0,
    totalRunMs: 0,
    subAgentSessions: 0,
    byDay: [],
    activityTrackedSince: null,
    byModel: [],
    byProvider: [],
    byHourOfDay: [],
    byMonth: [],
    availablePeriods: { months: [], years: [] },
    ...overrides,
  };
}

/** A daemon from before the activity counters: the fields are absent. */
function olderDaemon(): UsageStatsResult {
  const data = usage({ runs: 4, sessions: 2, linesAdded: 30 });
  delete data.toolCalls;
  delete data.toolCallsFailed;
  delete data.totalRunMs;
  delete data.subAgentSessions;
  delete data.byDay;
  delete data.activityTrackedSince;
  return data;
}

function day(date: string, tokens: number, runs = 0): UsageDayStats {
  return { date, runs, ...zeroCell, inputTokens: tokens };
}

const at = (iso: string) => new Date(`${iso}T15:00:00`);

describe('codeModel', () => {
  it('goes negative when deletions exceed additions', () => {
    const model = codeModel(usage({ linesAdded: 120, linesDeleted: 400 }));
    expect(model.net).toBe(-280);
    expect(model.touched).toBe(520);
    expect(model.pages).toBe(2);
    expect(model.addedShare).toBeCloseTo(120 / 520);
  });

  it('zeroes without NaN when nothing changed or nothing loaded', () => {
    for (const data of [usage(), null]) {
      expect(codeModel(data)).toEqual({
        added: 0,
        deleted: 0,
        net: 0,
        touched: 0,
        pages: 0,
        addedShare: 0,
      });
    }
  });
});

describe('toolsModel', () => {
  it('has no success rate or per-run value without calls or runs', () => {
    expect(toolsModel(usage())).toMatchObject({ total: 0, successRate: null, perRun: null });
    expect(toolsModel(null)).toMatchObject({ total: 0, successRate: null, perRun: null });
  });

  it('derives success rate and calls per run', () => {
    const model = toolsModel(usage({ toolCalls: 40, toolCallsFailed: 4, runs: 8 }));
    expect(model).toMatchObject({ succeeded: 36, failed: 4, perRun: 5 });
    expect(model.successRate).toBeCloseTo(0.9);
  });

  it('treats an older daemon as unknown, not as real zeroes', () => {
    expect(hasActivityCounters(olderDaemon())).toBe(false);
    expect(hasActivityCounters(usage())).toBe(true);
    expect(hasActivityCounters(null)).toBe(true);
    expect(toolsModel(olderDaemon())).toMatchObject({ total: 0, perRun: null });
  });
});

describe('teamModel', () => {
  it('splits top-level and sub-agents and averages completed turns', () => {
    const model = teamModel(
      usage({ sessions: 10, subAgentSessions: 7, runs: 4, totalRunMs: 120_000 }),
    );
    expect(model).toMatchObject({ topLevel: 3, subAgents: 7, avgTurnMs: 30_000 });
    expect(model.subShare).toBeCloseTo(0.7);
  });

  it('keeps an older daemon zeroed but still shows real sessions', () => {
    expect(teamModel(olderDaemon())).toMatchObject({
      agents: 2,
      subAgents: 0,
      agentMs: 0,
      avgTurnMs: null,
    });
  });
});

describe('trackedSinceNote', () => {
  const now = at('2026-11-20');
  it('shows only when the period starts before tracking began', () => {
    const data = usage({ activityTrackedSince: '2026-11-10' });
    expect(trackedSinceNote(data, 'month', '2026-11', now)?.getDate()).toBe(10);
    expect(trackedSinceNote(data, 'year', '2026', now)).not.toBeNull();
    expect(trackedSinceNote(data, '24h', null, now)).toBeNull();
    expect(
      trackedSinceNote(usage({ activityTrackedSince: '2026-11-01' }), 'month', '2026-11', now),
    ).toBeNull();
    expect(trackedSinceNote(usage(), 'month', '2026-11', now)).toBeNull();
  });
});

describe('streakModel', () => {
  it('counts the longest streak with gaps and the current streak ending today', () => {
    const data = usage({
      byDay: [
        day('2026-11-02', 10),
        day('2026-11-03', 10),
        day('2026-11-04', 10),
        day('2026-11-06', 0, 1),
        day('2026-11-18', 5),
        day('2026-11-19', 50),
        day('2026-11-20', 1),
      ],
    });
    const model = streakModel(data, 'month', '2026-11', at('2026-11-20'));
    expect(model.activeDays).toBe(7);
    expect(model.elapsedDays).toBe(20);
    expect(model.longestStreak).toBe(3);
    expect(model.currentStreak).toBe(3);
    expect(model.busiest).toEqual({ date: '2026-11-19', tokens: 50 });
  });

  it('keeps the current streak alive when today has no activity yet', () => {
    const data = usage({ byDay: [day('2026-11-18', 5), day('2026-11-19', 5)] });
    expect(streakModel(data, 'month', '2026-11', at('2026-11-20')).currentStreak).toBe(2);
    expect(streakModel(data, 'month', '2026-11', at('2026-11-21')).currentStreak).toBe(0);
  });

  it('runs a streak across a month boundary in year mode', () => {
    const data = usage({
      byDay: ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'].map((d) => day(d, 1)),
    });
    const model = streakModel(data, 'year', '2026', at('2026-02-02'));
    expect(model.longestStreak).toBe(4);
    expect(model.currentStreak).toBe(4);
  });

  it('has no current streak for a past period and ignores days not active', () => {
    const data = usage({ byDay: [day('2026-10-05', 0), day('2026-10-06', 3)] });
    const model = streakModel(data, 'month', '2026-10', at('2026-11-20'));
    expect(model.currentStreak).toBeNull();
    expect(model.activeDays).toBe(1);
    expect(model.elapsedDays).toBe(31);
  });

  it('lays out a Sunday-first month and a 12 x 31 year', () => {
    // November 2026 starts on a Sunday and has 30 days → 5 weeks.
    const month = streakModel(usage(), 'month', '2026-11', at('2026-11-20'));
    expect(month.rows).toHaveLength(5);
    expect(month.rows[0][0].date).toBe('2026-11-01');
    expect(month.rows[4].filter((c) => c.date === null)).toHaveLength(5);
    expect(month.rows[3][6].future).toBe(true);
    const year = streakModel(usage(), 'year', '2026', at('2026-11-20'));
    expect(year.rows).toHaveLength(12);
    expect(year.rows.every((row) => row.length === 31)).toBe(true);
    expect(year.rows[1].filter((c) => c.date !== null)).toHaveLength(28);
  });

  it('shades by token volume and zeroes with no data', () => {
    const data = usage({ byDay: [day('2026-11-02', 100), day('2026-11-03', 10, 2)] });
    const cells = streakModel(data, 'month', '2026-11', at('2026-11-20')).rows.flat();
    expect(cells.find((c) => c.date === '2026-11-02')?.level).toBe(4);
    expect(cells.find((c) => c.date === '2026-11-03')?.level).toBe(1);
    const empty = streakModel(null, 'month', '2026-11', at('2026-11-20'));
    expect(empty).toMatchObject({
      activeDays: 0,
      longestStreak: 0,
      currentStreak: 0,
      busiest: null,
    });
  });

  it('drops cache tokens from the shading when cached tokens are hidden', () => {
    const data = usage({
      byDay: [{ ...day('2026-11-02', 0), cacheReadTokens: 900, runs: 0 }],
    });
    expect(streakModel(data, 'month', '2026-11', at('2026-11-20')).activeDays).toBe(1);
    expect(
      streakModel(withoutCachedTokens(data), 'month', '2026-11', at('2026-11-20')).activeDays,
    ).toBe(0);
  });
});

describe('heroFontSize', () => {
  it('steps down so huge numbers fit the card', () => {
    expect(heroFontSize('1,234')).toBe(53);
    expect(heroFontSize('12,345,678')).toBe(40);
    expect(heroFontSize('+1,234,567,890')).toBe(32);
  });
});
