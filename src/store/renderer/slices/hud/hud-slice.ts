/**
 * Fleet HUD Slice
 *
 * State for the standalone Fleet HUD window: the live global event feed
 * (ring buffer, live-only — no backfill), per-workspace attention/displayStatus
 * overrides pushed by daemon events, the 24h usage rollup from `stats.getUsage`
 * (PROTOCOL §5.36), and the daemon online/uptime snapshot from `system.status`
 * (PROTOCOL §5.7). The subscription lifecycle and the event→feed mapping live
 * in `$features/hud/hud-subscription` / `hud-feed-mapper`; this slice only
 * folds the already-narrowed payloads.
 *
 * Feed `text` values are composed from wire-provided identifiers (agent names,
 * statuses, task titles) — agent-generated/wire content, exempt from i18n.
 * The UI localizes row labels off `kind`.
 */

import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import type { WorkspaceDisplayStatus } from "$shared/types";

/** Mock-faithful color-class token for a feed row. */
export type HudFeedColorClass = "ok" | "info" | "warn" | "err" | "accent";

export interface HudFeedEntry {
  /** Daemon event id (dedupe key across overlapping deliveries). */
  id: string;
  /** Event timestamp — wire ISO string, verbatim. */
  ts: string;
  /** Color-class token for the row (mock's state palette). */
  colorClass: HudFeedColorClass;
  /** Source workspace id; the UI resolves the display title. */
  source: string;
  /** Wire event type that produced this entry (drives the localized label). */
  kind: string;
  /** Wire-derived detail text (identifiers/status values; i18n-exempt). */
  text: string;
}

/** The four consumption counters (PROTOCOL §5.36 `UsageTotals`). */
export interface HudUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** One TOK/MIN chart sample — a trailing 24h hourly bucket. */
export interface HudRateSample {
  /** Local-time hour label (0–23) from `byHourOfDay`. */
  hour: number;
  /** Sum of the four token counters in the bucket. */
  tokens: number;
}

export interface HudUsageState {
  totals: HudUsageTotals;
  /** Completed prompt turns in the period. */
  runs: number;
  /** 24 trailing hourly buckets, chronological (oldest first). */
  rateSamples: HudRateSample[];
  /** Epoch-ms when the service fetched the rollup (computed at the boundary). */
  fetchedAtMs: number;
}

export interface HudSystemState {
  /** Whether the last `system.status` round-trip succeeded. */
  online: boolean;
  /** Daemon uptime at fetch time; null when unknown. */
  uptimeSeconds: number | null;
  /** Daemon version string; null when unknown. */
  version: string | null;
  /** Epoch-ms when the service fetched the status; null before first fetch. */
  fetchedAtMs: number | null;
}

export interface HudState {
  /** Whether the HUD subscription is running (feed only accumulates then). */
  active: boolean;
  /** Live feed ring buffer, newest first, capped at HUD_FEED_LIMIT. */
  feed: HudFeedEntry[];
  /** Live attention flags from `workspace:attention-changed`; "none" clears. */
  attentionByWorkspaceId: Record<string, string>;
  /** Live overrides from `workspace:displayStatus-changed`. */
  displayStatusByWorkspaceId: Record<string, WorkspaceDisplayStatus>;
  usage: HudUsageState | null;
  usageError: string | null;
  system: HudSystemState;
}

export const HUD_FEED_LIMIT = 50;

export const initialState: HudState = {
  active: false,
  feed: [],
  attentionByWorkspaceId: {},
  displayStatusByWorkspaceId: {},
  usage: null,
  usageError: null,
  system: { online: false, uptimeSeconds: null, version: null, fetchedAtMs: null },
};

// ── Actions ──

export const hudActivated = createAction("hud/activated");
export const hudDeactivated = createAction("hud/deactivated");
export const hudFeedEntryReceived = createAction<[entry: HudFeedEntry]>("hud/feedEntryReceived");
export const hudAttentionChanged = createAction<[workspaceId: string, attention: string]>(
  "hud/attentionChanged",
);
export const hudDisplayStatusChanged = createAction<
  [workspaceId: string, displayStatus: WorkspaceDisplayStatus]
>("hud/displayStatusChanged");
export const hudUsageLoaded = createAction<[usage: HudUsageState]>("hud/usageLoaded");
export const hudUsageFailed = createAction<[error: string]>("hud/usageFailed");
export const hudSystemStatusReceived = createAction<[system: HudSystemState]>(
  "hud/systemStatusReceived",
);

// ── Reducer ──

export const hudReducer = createReducer<HudState>(initialState)
  // Activation resets to a clean slate — the feed is live-only (no backfill).
  .with(hudActivated, () => ({ ...initialState, active: true }))
  .with(hudDeactivated, () => initialState)
  .with(hudFeedEntryReceived, (state, { payload: [entry] }) => {
    if (!state.active) return state;
    if (state.feed.some((existing) => existing.id === entry.id)) return state;
    return { ...state, feed: [entry, ...state.feed].slice(0, HUD_FEED_LIMIT) };
  })
  .with(hudAttentionChanged, (state, { payload: [workspaceId, attention] }) => {
    if (attention === "none") {
      if (!(workspaceId in state.attentionByWorkspaceId)) return state;
      const next = { ...state.attentionByWorkspaceId };
      delete next[workspaceId];
      return { ...state, attentionByWorkspaceId: next };
    }
    return {
      ...state,
      attentionByWorkspaceId: { ...state.attentionByWorkspaceId, [workspaceId]: attention },
    };
  })
  .with(hudDisplayStatusChanged, (state, { payload: [workspaceId, displayStatus] }) => ({
    ...state,
    displayStatusByWorkspaceId: {
      ...state.displayStatusByWorkspaceId,
      [workspaceId]: displayStatus,
    },
  }))
  .with(hudUsageLoaded, (state, { payload: [usage] }) => ({ ...state, usage, usageError: null }))
  .with(hudUsageFailed, (state, { payload: [error] }) => ({ ...state, usageError: error }))
  .with(hudSystemStatusReceived, (state, { payload: [system] }) => ({ ...state, system }));
