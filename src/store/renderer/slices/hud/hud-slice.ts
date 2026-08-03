/**
 * Fleet HUD Slice
 *
 * State for the standalone Fleet HUD window: the live global event feed
 * (ring buffer, live-only — no backfill), per-workspace attention/displayStatus
 * overrides pushed by daemon events, the 24h usage rollup from `stats.getUsage`
 * (PROTOCOL §5.36). The subscription lifecycle and the event→feed mapping live
 * in `$features/hud/hud-subscription` / `hud-feed-mapper`; this slice only
 * folds the already-narrowed payloads. Daemon online/version/uptime come from
 * the daemon-health slice (10s poll), not from here — see `selectHudSystem`.
 *
 * Feed `text` values are composed from wire-provided identifiers (agent names,
 * statuses, task titles) — agent-generated/wire content, exempt from i18n.
 * The UI localizes row labels off `kind`.
 */

import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import type { WorkspaceDisplayStatus } from '$shared/types';
import {
  EMPTY_HUD_GRID_FILTER,
  isHudTrackedAttentionValue,
  type HudCardStateKey,
  type HudGridFilter,
} from './hud-types';

/** Mock-faithful color-class token for a feed row. */
export type HudFeedColorClass = 'ok' | 'info' | 'warn' | 'err' | 'accent' | 'idle';

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
  /**
   * Wire-derived detail text WITHOUT agent identity (error/status values;
   * i18n-exempt). Never a raw agent UUID — the selector joins the display
   * name from `agentName` / `agentSummary`.
   */
  text: string;
  /** Wire agent id for name resolution against agentSummary; never rendered. */
  agentId?: string;
  /** Wire agent display name when the event carried one (i18n-exempt). */
  agentName?: string;
  /**
   * Wire agent status for `agent:status-changed` rows (§6.5) — drives the
   * per-state chip label (AGENT RUNNING / IDLE / FAILED …); never rendered
   * raw.
   */
  agentStatus?: string;
  /**
   * Wire displayStatus for `workspace:displayStatus-changed` rows (§6.5) —
   * drives the localized card-state detail label and the card color token
   * on the row dot; never rendered raw.
   */
  displayStatus?: string;
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

/** One TOK/MIN chart sample (PROTOCOL §5.39 `RateSample`, counters summed). */
export interface HudRateHistorySample {
  /** UTC minute floor — wire ISO string, verbatim (`"2026-07-30T14:07:00Z"`). */
  bucketUtc: string;
  /** Sum of the four token counters in the minute bucket. */
  tokens: number;
}

export interface HudRateHistoryState {
  /** Trailing minute samples, chronological (oldest first), gap-free. */
  samples: HudRateHistorySample[];
  /** Epoch-ms when the service fetched the history (computed at the boundary). */
  fetchedAtMs: number;
}

/** Live attention flag for one workspace (`workspace:attention-changed`). */
export interface HudAttentionFlag {
  /**
   * Wire attention value — tracked values only (`isHudTrackedAttentionValue`):
   * the HUD attention allowlist plus the non-urgent `unread`; never "none".
   */
  attention: string;
  /** Event timestamp the flag was raised at — wire ISO string, verbatim. */
  raisedAtTs: string;
}

/** One 5s token bucket for the AGENT ACTIVITY · TOK/S chart. */
export interface HudRate5sBucket {
  /** Bucket start — epoch-ms floored to the 5s grid (computed at the boundary). */
  startMs: number;
  /** Tokens attributed to the bucket. */
  tokens: number;
}

export interface HudRate5sState {
  /** Sparse 5s buckets, chronological, capped at the trailing chart window. */
  buckets: HudRate5sBucket[];
  /** Whether the pre-open window was backfilled from `stats.getRateHistory`. */
  backfilled: boolean;
}

/**
 * Latest clarifying question an agent asked — captured from the
 * `agent:stream:end` `trailingBlocks` question resource (PROTOCOL §7.1,
 * `application/vnd.intent.question+json`). One per agent; a newer question
 * replaces the older one.
 */
export interface HudCapturedQuestion {
  workspaceId: string;
  agentId: string;
  /**
   * Assistant message id the §7.1 question blocks trailed (`agent:stream:end`
   * `messageId`; PROTOCOL §6.5). Keys the dismissal check: a question whose
   * id equals `metadata.dismissedQuestionsMessageId` is no longer pending.
   * Undefined when the event carried no messageId (question still pends).
   */
  messageId?: string;
  /** Question header (agent content; i18n-exempt). */
  header: string;
  /** Question text (agent content; i18n-exempt). */
  question: string;
  /** Event timestamp — wire ISO string, verbatim. */
  ts: string;
}

export interface HudState {
  /** Whether the HUD subscription is running (feed only accumulates then). */
  active: boolean;
  /** Live feed ring buffer, newest first, capped at HUD_FEED_LIMIT. */
  feed: HudFeedEntry[];
  /** Live attention flags from `workspace:attention-changed`; "none" clears. */
  attentionByWorkspaceId: Record<string, HudAttentionFlag>;
  /** Live overrides from `workspace:displayStatus-changed`. */
  displayStatusByWorkspaceId: Record<string, WorkspaceDisplayStatus>;
  usage: HudUsageState | null;
  usageError: string | null;
  /** Per-minute TOK/MIN history from `stats.getRateHistory` (PROTOCOL §5.39). */
  rateHistory: HudRateHistoryState | null;
  rateHistoryError: string | null;
  /** Live 5s token buckets for the AGENT ACTIVITY · TOK/S chart. */
  rate5s: HudRate5sState;
  /** Latest captured clarifying question per agent (§7.1 trailingBlocks). */
  questionsByAgentId: Record<string, HudCapturedQuestion>;
  /** Header FLEET OPS repo + status grid filter (shared with the center grid). */
  gridFilter: HudGridFilter;
  /**
   * Workspace a grid-card click asked the takeover overlay to open; null when
   * none is pending. `HudTakeoverOverlay` consumes the request (front-of-queue
   * manual open) and dispatches `hudTakeoverRequestCleared`.
   */
  takeoverRequestWorkspaceId: string | null;
}

export const HUD_FEED_LIMIT = 50;

/** Mock's TOK/S chart: 40 bars × 5s buckets = the trailing 200s window. */
export const HUD_RATE_5S_BUCKET_MS = 5_000;
export const HUD_RATE_5S_BAR_COUNT = 40;
export const HUD_RATE_5S_WINDOW_MS = HUD_RATE_5S_BUCKET_MS * HUD_RATE_5S_BAR_COUNT;

export const initialState: HudState = {
  active: false,
  feed: [],
  attentionByWorkspaceId: {},
  displayStatusByWorkspaceId: {},
  usage: null,
  usageError: null,
  rateHistory: null,
  rateHistoryError: null,
  rate5s: { buckets: [], backfilled: false },
  questionsByAgentId: {},
  gridFilter: EMPTY_HUD_GRID_FILTER,
  takeoverRequestWorkspaceId: null,
};

/** Floor an epoch-ms instant to its 5s bucket start. */
export function toRate5sBucketStart(atMs: number): number {
  return Math.floor(atMs / HUD_RATE_5S_BUCKET_MS) * HUD_RATE_5S_BUCKET_MS;
}

/** Drop buckets that left the trailing window relative to the newest one. */
function pruneRate5sBuckets(buckets: HudRate5sBucket[]): HudRate5sBucket[] {
  if (buckets.length === 0) return buckets;
  const newestStart = buckets[buckets.length - 1].startMs;
  const cutoff = newestStart - HUD_RATE_5S_WINDOW_MS + HUD_RATE_5S_BUCKET_MS;
  return buckets.filter((bucket) => bucket.startMs >= cutoff);
}

// ── Actions ──

export const hudActivated = createAction('hud/activated');
export const hudDeactivated = createAction('hud/deactivated');
export const hudFeedEntryReceived = createAction<[entry: HudFeedEntry]>('hud/feedEntryReceived');
export const hudAttentionChanged =
  createAction<[workspaceId: string, attention: string, raisedAtTs: string]>(
    'hud/attentionChanged',
  );
export const hudDisplayStatusChanged = createAction<
  [workspaceId: string, displayStatus: WorkspaceDisplayStatus]
>('hud/displayStatusChanged');
export const hudUsageLoaded = createAction<[usage: HudUsageState]>('hud/usageLoaded');
export const hudUsageFailed = createAction<[error: string]>('hud/usageFailed');
export const hudRateHistoryLoaded =
  createAction<[rateHistory: HudRateHistoryState]>('hud/rateHistoryLoaded');
export const hudRateHistoryFailed = createAction<[error: string]>('hud/rateHistoryFailed');
/** Grid-card click → ask the takeover overlay (Batch 3) to open a workspace. */
export const hudTakeoverRequested = createAction<[workspaceId: string]>('hud/takeoverRequested');
/** Clear the pending takeover request (overlay consumed or dismissed it). */
export const hudTakeoverRequestCleared = createAction('hud/takeoverRequestCleared');
/** Live token delta observed at `atMs` → accumulate into its 5s bucket. */
export const hudRate5sTokensObserved = createAction<[tokens: number, atMs: number]>(
  'hud/rate5sTokensObserved',
);
/**
 * One-shot pre-open backfill: per-minute `stats.getRateHistory` samples split
 * evenly across their twelve 5s slots so the chart is not empty on open.
 * `nowMs` anchors the window; live buckets already observed win over the
 * backfill values.
 */
export const hudRate5sBackfilled = createAction<
  [samples: Array<{ bucketUtc: string; tokens: number }>, nowMs: number]
>('hud/rate5sBackfilled');
/** A question block arrived on `agent:stream:end` trailingBlocks (§7.1). */
export const hudQuestionCaptured = createAction<[question: HudCapturedQuestion]>(
  'hud/questionCaptured',
);
/**
 * The agent started a new turn (`agent:status-changed` → a running status):
 * a question hold only breaks on a user-origin delivery (PROTOCOL §7.1 — any
 * later user message supersedes the questions), so the captured question is
 * answered/moot and must stop pending everywhere.
 */
export const hudQuestionSuperseded = createAction<[agentId: string]>('hud/questionSuperseded');
/** Header FLEET OPS repo pick (null = all workspaces). */
export const hudGridFilterRepoPicked = createAction<[repo: string | null]>(
  'hud/gridFilterRepoPicked',
);
/** Header status-menu toggle for one card state key. */
export const hudGridFilterStateToggled = createAction<[stateKey: HudCardStateKey]>(
  'hud/gridFilterStateToggled',
);
/** Header status-menu "All statuses" reset. */
export const hudGridFilterStatesCleared = createAction('hud/gridFilterStatesCleared');

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
  .with(hudAttentionChanged, (state, { payload: [workspaceId, attention, raisedAtTs] }) => {
    // The wire field is single-valued, so any untracked value ("none" —
    // e.g. from `workspace.markSeen`) means no flag is currently raised:
    // clear. Tracked values are the HUD attention allowlist plus the
    // non-urgent `unread` (renders the blue UNREAD card state, never a
    // call to action — urgent selectors gate on `isHudAttentionValue`).
    if (!isHudTrackedAttentionValue(attention)) {
      if (!(workspaceId in state.attentionByWorkspaceId)) return state;
      const next = { ...state.attentionByWorkspaceId };
      delete next[workspaceId];
      return { ...state, attentionByWorkspaceId: next };
    }
    // Re-raising the same value keeps the original raise time (elapsed timer
    // must not reset on duplicate deliveries).
    const existing = state.attentionByWorkspaceId[workspaceId];
    if (existing && existing.attention === attention) return state;
    return {
      ...state,
      attentionByWorkspaceId: {
        ...state.attentionByWorkspaceId,
        [workspaceId]: { attention, raisedAtTs },
      },
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
  .with(hudRateHistoryLoaded, (state, { payload: [rateHistory] }) => ({
    ...state,
    rateHistory,
    rateHistoryError: null,
  }))
  .with(hudRateHistoryFailed, (state, { payload: [error] }) => ({
    ...state,
    rateHistoryError: error,
  }))
  .with(hudTakeoverRequested, (state, { payload: [workspaceId] }) =>
    state.takeoverRequestWorkspaceId === workspaceId
      ? state
      : { ...state, takeoverRequestWorkspaceId: workspaceId },
  )
  .with(hudTakeoverRequestCleared, (state) =>
    state.takeoverRequestWorkspaceId === null
      ? state
      : { ...state, takeoverRequestWorkspaceId: null },
  )
  .with(hudRate5sTokensObserved, (state, { payload: [tokens, atMs] }) => {
    if (!state.active || !Number.isFinite(tokens) || tokens <= 0 || !Number.isFinite(atMs)) {
      return state;
    }
    const startMs = toRate5sBucketStart(atMs);
    const buckets = [...state.rate5s.buckets];
    const index = buckets.findIndex((bucket) => bucket.startMs === startMs);
    if (index >= 0) {
      buckets[index] = { startMs, tokens: buckets[index].tokens + tokens };
    } else {
      buckets.push({ startMs, tokens });
      buckets.sort((a, b) => a.startMs - b.startMs);
    }
    return { ...state, rate5s: { ...state.rate5s, buckets: pruneRate5sBuckets(buckets) } };
  })
  .with(hudRate5sBackfilled, (state, { payload: [samples, nowMs] }) => {
    // One-shot: live-observed buckets always win over the backfill split.
    if (!state.active || state.rate5s.backfilled) return state;
    const cutoff = toRate5sBucketStart(nowMs) - HUD_RATE_5S_WINDOW_MS + HUD_RATE_5S_BUCKET_MS;
    const byStart = new Map<number, HudRate5sBucket>(
      state.rate5s.buckets.map((bucket) => [bucket.startMs, bucket]),
    );
    const slotsPerMinute = 60_000 / HUD_RATE_5S_BUCKET_MS;
    for (const sample of samples) {
      const minuteMs = Date.parse(sample.bucketUtc);
      if (!Number.isFinite(minuteMs) || sample.tokens <= 0) continue;
      const perSlot = sample.tokens / slotsPerMinute;
      for (let slot = 0; slot < slotsPerMinute; slot++) {
        const startMs = minuteMs + slot * HUD_RATE_5S_BUCKET_MS;
        if (startMs < cutoff || startMs > nowMs || byStart.has(startMs)) continue;
        byStart.set(startMs, { startMs, tokens: perSlot });
      }
    }
    const buckets = [...byStart.values()].sort((a, b) => a.startMs - b.startMs);
    return { ...state, rate5s: { buckets: pruneRate5sBuckets(buckets), backfilled: true } };
  })
  .with(hudQuestionCaptured, (state, { payload: [question] }) => {
    if (!state.active) return state;
    return {
      ...state,
      questionsByAgentId: { ...state.questionsByAgentId, [question.agentId]: question },
    };
  })
  .with(hudQuestionSuperseded, (state, { payload: [agentId] }) => {
    if (!(agentId in state.questionsByAgentId)) return state;
    const next = { ...state.questionsByAgentId };
    delete next[agentId];
    return { ...state, questionsByAgentId: next };
  })
  .with(hudGridFilterRepoPicked, (state, { payload: [repo] }) =>
    state.gridFilter.repo === repo
      ? state
      : { ...state, gridFilter: { ...state.gridFilter, repo } },
  )
  .with(hudGridFilterStateToggled, (state, { payload: [stateKey] }) => ({
    ...state,
    gridFilter: {
      ...state.gridFilter,
      states: state.gridFilter.states.includes(stateKey)
        ? state.gridFilter.states.filter((existing) => existing !== stateKey)
        : [...state.gridFilter.states, stateKey],
    },
  }))
  .with(hudGridFilterStatesCleared, (state) =>
    state.gridFilter.states.length === 0
      ? state
      : { ...state, gridFilter: { ...state.gridFilter, states: [] } },
  );
