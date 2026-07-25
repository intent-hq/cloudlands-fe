import { describe, expect, it } from "vitest";
import type { UsageStatsResult } from "$lib/client/app-client";
import {
  initialState,
  loadUsageStatsRequested,
  statsReducer,
  usageStatsFailed,
  usageStatsLoaded,
} from "./stats-slice";

const RESULT: UsageStatsResult = {
  totals: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
  runs: 5,
  sessions: 6,
  longestRunMs: 7,
  linesAdded: 8,
  linesDeleted: 9,
  byModel: [],
  byHourOfDay: [],
  byMonth: [],
  availablePeriods: { months: ["2026-07"], years: ["2026"] },
};

describe("statsReducer", () => {
  it("starts closed on the current month with no data", () => {
    expect(initialState).toEqual({
      mode: "month",
      periodKey: null,
      loading: false,
      error: null,
      data: null,
    });
  });

  it("records the selected mode/period and enters loading on request", () => {
    const next = statsReducer(
      initialState,
      loadUsageStatsRequested("month", "2026-07", -420)
    );

    expect(next.mode).toBe("month");
    expect(next.periodKey).toBe("2026-07");
    expect(next.loading).toBe(true);
    expect(next.error).toBeNull();
  });

  it("stores the daemon result for the matching selection", () => {
    const requested = statsReducer(
      initialState,
      loadUsageStatsRequested("month", "2026-07", 0)
    );
    const loaded = statsReducer(requested, usageStatsLoaded("month", "2026-07", RESULT));

    expect(loaded.loading).toBe(false);
    expect(loaded.data).toEqual(RESULT);
  });

  it("discards stale replies after the selection changed", () => {
    const requested = statsReducer(
      initialState,
      loadUsageStatsRequested("year", "2026", 0)
    );
    const stale = statsReducer(requested, usageStatsLoaded("month", "2026-06", RESULT));

    expect(stale).toBe(requested);
    expect(stale.loading).toBe(true);
    expect(stale.data).toBeNull();
  });

  it("supports the 24h mode with a null period key", () => {
    const requested = statsReducer(initialState, loadUsageStatsRequested("24h", null, 60));
    const loaded = statsReducer(requested, usageStatsLoaded("24h", null, RESULT));

    expect(requested.mode).toBe("24h");
    expect(requested.periodKey).toBeNull();
    expect(loaded.data).toEqual(RESULT);
  });

  it("surfaces fetch failures for the matching selection", () => {
    const requested = statsReducer(
      initialState,
      loadUsageStatsRequested("month", "2026-07", 0)
    );
    const failed = statsReducer(
      requested,
      usageStatsFailed("month", "2026-07", "uds boom")
    );

    expect(failed.loading).toBe(false);
    expect(failed.error).toBe("uds boom");
  });

  it("ignores failures from a stale selection", () => {
    const requested = statsReducer(
      initialState,
      loadUsageStatsRequested("month", "2026-07", 0)
    );
    const stale = statsReducer(requested, usageStatsFailed("year", "2026", "old"));

    expect(stale).toBe(requested);
    expect(stale.error).toBeNull();
  });
});
