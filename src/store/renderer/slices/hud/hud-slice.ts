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
import type { Workspace, WorkspaceDisplayStatus } from '$shared/types';
import { replaceWorkspaceList, setWorkspaceEntity } from '../workspace/workspace-slice';
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
  /**
   * Ids whose live override one entity delivery has already contradicted.
   * Second-delivery guard for the override retirement — see
   * `reconcileDisplayStatusOverride`.
   */
  displayStatusOverridesContradicted: Record<string, true>;
  usage: HudUsageState | null;
  usageError: string | null;
  /** Per-minute TOK/MIN history from `stats.getRateHistory` (PROTOCOL §5.39). */
  rateHistory: HudRateHistoryState | null;
  rateHistoryError: string | null;
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

export const initialState: HudState = {
  active: false,
  feed: [],
  attentionByWorkspaceId: {},
  displayStatusByWorkspaceId: {},
  displayStatusOverridesContradicted: {},
  usage: null,
  usageError: null,
  rateHistory: null,
  rateHistoryError: null,
  questionsByAgentId: {},
  gridFilter: EMPTY_HUD_GRID_FILTER,
  takeoverRequestWorkspaceId: null,
};

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
/** A question block arrived on `agent:stream:end` trailingBlocks (§7.1). */
export const hudQuestionCaptured = createAction<[question: HudCapturedQuestion]>(
  'hud/questionCaptured',
);
/**
 * The workspace left the daemon's `needs_attention` displayStatus rollup: a
 * pending question always holds that rollup up, so leaving it means every
 * captured question in the workspace was answered or dismissed daemon-side.
 */
export const hudQuestionsResolvedForWorkspace = createAction<[workspaceId: string]>(
  'hud/questionsResolvedForWorkspace',
);
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

/**
 * Reconcile live `displayStatus` overrides against entities that just arrived
 * carrying a BE value.
 *
 * The override bridges the gap between a `workspace:displayStatus-changed`
 * event and the entity catching up, but nothing retired it, so a dropped
 * event left a stale override winning forever. Retirement cannot simply be
 * "an entity carries a value" though: neither delivery order nor entity
 * freshness is guaranteed. The daemon derives `displayStatus` at serve time
 * (PROTOCOL §5.1), so a `workspace.list` issued BEFORE the event can resolve
 * after it and carry the older value — clearing on that response would
 * reintroduce the very staleness the override exists to cover.
 *
 * Two-strike rule: the FIRST entity delivery that disagrees with an override
 * is assumed to be that in-flight response and only marks the override
 * contradicted; a SECOND disagreeing delivery retires it (an in-flight
 * response cannot predate the event twice, so by then the entity is the
 * fresher value). An entity that AGREES with the override retires it
 * immediately — the entity has caught up and the override is redundant — and
 * also clears the contradicted mark, since agreement proves the store is
 * current as of the override.
 */
function reconcileDisplayStatusOverride(state: HudState, workspaces: readonly Workspace[]) {
  let overrides = state.displayStatusByWorkspaceId;
  let contradicted = state.displayStatusOverridesContradicted;
  let changed = false;

  for (const workspace of workspaces) {
    const id = String(workspace.id);
    const override = overrides[id];
    // An entity without a value carries nothing fresher — leave it alone.
    if (override === undefined || workspace.displayStatus === undefined) continue;

    const retire = workspace.displayStatus === override || contradicted[id] === true;
    if (!retire) {
      if (!changed) {
        overrides = { ...overrides };
        contradicted = { ...contradicted };
        changed = true;
      }
      contradicted[id] = true;
      continue;
    }
    if (!changed) {
      overrides = { ...overrides };
      contradicted = { ...contradicted };
      changed = true;
    }
    delete overrides[id];
    delete contradicted[id];
  }

  if (!changed) return state;
  return {
    ...state,
    displayStatusByWorkspaceId: overrides,
    displayStatusOverridesContradicted: contradicted,
  };
}

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
  .with(hudDisplayStatusChanged, (state, { payload: [workspaceId, displayStatus] }) => {
    // A newer event restarts the two-strike count: entity deliveries that
    // contradicted the PREVIOUS override say nothing about this one.
    const contradicted = { ...state.displayStatusOverridesContradicted };
    delete contradicted[workspaceId];
    return {
      ...state,
      displayStatusByWorkspaceId: {
        ...state.displayStatusByWorkspaceId,
        [workspaceId]: displayStatus,
      },
      displayStatusOverridesContradicted: contradicted,
    };
  })
  // Entity deliveries reconcile the override (see `reconcileDisplayStatusOverride`).
  .with(setWorkspaceEntity, (state, { payload: [workspace] }) =>
    reconcileDisplayStatusOverride(state, [workspace]),
  )
  .with(replaceWorkspaceList, (state, { payload: [workspaces] }) =>
    reconcileDisplayStatusOverride(state, workspaces),
  )
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
  .with(hudQuestionCaptured, (state, { payload: [question] }) => {
    if (!state.active) return state;
    return {
      ...state,
      questionsByAgentId: { ...state.questionsByAgentId, [question.agentId]: question },
    };
  })
  .with(hudQuestionsResolvedForWorkspace, (state, { payload: [workspaceId] }) => {
    const entries = Object.entries(state.questionsByAgentId);
    const kept = entries.filter(([, question]) => question.workspaceId !== workspaceId);
    if (kept.length === entries.length) return state;
    return { ...state, questionsByAgentId: Object.fromEntries(kept) };
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
