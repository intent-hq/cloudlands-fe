/**
 * Usage Stats Slice
 *
 * State for the full-screen usage-stats overlay: the selected mode/period
 * and the latest `stats.getUsage` result. The fetch itself lives in the
 * stats read-service middleware (`$features/stats/stats-read-service`);
 * `loadUsageStatsRequested` is the trigger, `usageStatsLoaded` /
 * `usageStatsFailed` are the responses. Responses carry the requested
 * mode/key so the reducer can discard stale replies after rapid switching.
 */

import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import type { UsageStatsPeriod, UsageStatsResult } from "$lib/client/app-client";

export type StatsState = {
  /** Selected mode ("24h" / "month" / "year"). */
  mode: UsageStatsPeriod;
  /** Selected period key ("YYYY-MM" / "YYYY"); null in 24h mode. */
  periodKey: string | null;
  /** Whether a `stats.getUsage` fetch is in flight. */
  loading: boolean;
  /** Last fetch error message, or null. */
  error: string | null;
  /** Latest daemon result for the selected period, or null before load. */
  data: UsageStatsResult | null;
};

export const initialState: StatsState = {
  mode: "month",
  periodKey: null,
  loading: false,
  error: null,
  data: null,
};

// ── Actions ──

/** Select a period and fetch it (middleware performs the wire call). */
export const loadUsageStatsRequested = createAction<[
  mode: UsageStatsPeriod,
  key: string | null,
  tzOffsetMinutes: number,
]>("stats/loadUsageStatsRequested");

export const usageStatsLoaded = createAction<[
  mode: UsageStatsPeriod,
  key: string | null,
  data: UsageStatsResult,
]>("stats/usageStatsLoaded");

export const usageStatsFailed = createAction<[
  mode: UsageStatsPeriod,
  key: string | null,
  error: string,
]>("stats/usageStatsFailed");

// ── Reducer ──

export const statsReducer = createReducer<StatsState>(initialState)
  .with(loadUsageStatsRequested, (state, { payload: [mode, key] }) => ({
    ...state,
    mode,
    periodKey: key,
    loading: true,
    error: null,
  }))
  .with(usageStatsLoaded, (state, { payload: [mode, key, data] }) => {
    // Discard stale replies from an older selection.
    if (mode !== state.mode || key !== state.periodKey) return state;
    return { ...state, loading: false, error: null, data };
  })
  .with(usageStatsFailed, (state, { payload: [mode, key, error] }) => {
    if (mode !== state.mode || key !== state.periodKey) return state;
    return { ...state, loading: false, error };
  });
