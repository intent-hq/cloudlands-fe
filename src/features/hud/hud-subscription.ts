/**
 * HUD subscription lifecycle — the start/stop API the /hud route calls.
 *
 * `startHudSubscription()`:
 *  - dispatches `hudActivated` (feed is live-only: activation resets state);
 *  - issues a GLOBAL `events.subscribe` (no `workspaceId` → all workspaces,
 *    PROTOCOL §6.1) with `replaceGroup: "hud-feed"` so a remount can never
 *    leak a second subscription on the same connection;
 *  - listens for `events.event` notifications, gates them on our own
 *    `subscriptionId` (§6.3 fan-out dedupe, mirroring the daemon-events
 *    bridge), maps them through `mapEventToFeedEntry`, and folds the
 *    attention/displayStatus families into their live override maps;
 *  - hydrates the agent list (`agent.list`, §5.5) for EVERY HUD-visible
 *    workspace exactly once via `hydrateAgentsRequested` — the AgentLite
 *    projection carries the persisted `lastAgentResponse` that feeds the
 *    per-agent activity line on the cards, and without this only sessions
 *    hydrated in THIS window (or touched by a live status event) have one.
 *    The lifecycle-read-service coalesces per workspace and the requests run
 *    in parallel; freshness comes from the daemon-events-bridge, which
 *    re-dispatches the same action on `agent:status-changed`/`agent:idle`
 *    (no polling here);
 *  - fetches the 24h `stats.getUsage` rollup (§5.36) once, polls the
 *    per-minute `stats.getRateHistory` (§5.39) every
 *    HUD_RATE_HISTORY_POLL_MS for the TOK/MIN chart, and re-issues subscribe
 *    + refetches (including re-hydrating all agent lists) after a backend
 *    reconnect (RESUB-1). The daemon ONLINE/version/uptime signal is NOT
 *    fetched here: `selectHudSystem` reads the daemon-health slice, which the
 *    daemon-health middleware keeps fresh with its own 10s `system.status`
 *    poll in every renderer.
 *
 * The disposer unsubscribes best-effort, removes both listeners, stops the
 * rate-history poll, and dispatches `hudDeactivated` (clearing the feed — no
 * persistence).
 */
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import { getItems } from '$lib/store-shim/utils/collections/collection-utils';
import {
  isWorkspaceDisplayStatus,
  WorkspaceStatus,
  type WorkspaceDisplayStatus,
} from '$shared/types';
import { hydrateAgentsRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  hudActivated,
  hudAttentionChanged,
  hudDeactivated,
  hudDisplayStatusChanged,
  hudFeedEntryReceived,
  hudQuestionCaptured,
  hudQuestionsResolvedForWorkspace,
  hudRateHistoryFailed,
  hudRateHistoryLoaded,
  hudUsageFailed,
  hudUsageLoaded,
  sumHudUsageTotals,
  type HudFeedEntry,
  type HudRateHistorySample,
  type HudRateSample,
  type HudUsageTotals,
} from '$store/renderer/slices/hud/hud-slice';
import type { WorkspaceEvent } from '$features/events/types';
import { toHudAgentStateBucket } from '$store/renderer/slices/hud/hud-types';
import { createLogger } from '$lib/utils/client-logger';
import {
  HUD_AGENT_DELEGATED_FEED_KIND,
  HUD_FEED_EVENT_TYPES,
  mapEventToFeedEntry,
} from './hud-feed-mapper';
import { extractQuestionsFromStreamEnd } from './hud-question-capture';
import { emitTakeoverTrigger } from './takeover/hud-takeover-bus';
import type { HudTakeoverTrigger } from './takeover/hud-takeover-queue';
import {
  HUD_TAKEOVER_EVENT_TYPES,
  mapEventToTakeoverTrigger,
} from './takeover/hud-takeover-triggers';

const logger = createLogger('HudSubscription');

/** §6.1 replaceGroup key — one HUD subscription per connection, ever. */
export const HUD_REPLACE_GROUP = 'hud-feed';

/**
 * Event types the HUD subscription requests: the feed families plus the
 * takeover-only families (`agent:stream:end`, whose §7.1 question
 * trailingBlocks drive the question takeover and the attention-row question
 * capture, and `workspace:updated`, whose statusMessage delta drives the
 * STATUS UPDATE takeover — neither renders in the feed).
 */
export const HUD_SUBSCRIBE_EVENT_TYPES = [
  ...new Set<string>([...HUD_FEED_EVENT_TYPES, ...HUD_TAKEOVER_EVENT_TYPES]),
];

/** TOK/MIN chart poll cadence — new minute buckets land at most once a minute. */
export const HUD_RATE_HISTORY_POLL_MS = 15_000;

/** Trailing minute samples for the TOK/MIN chart (mock renders 40 bars). */
export const HUD_RATE_HISTORY_LIMIT = 40;

/** Fetch the 24h usage rollup (§5.36) and fold it into the slice. */
async function loadUsage(): Promise<void> {
  try {
    const result = await backendRequest<{
      totals?: HudUsageTotals;
      runs?: number;
      byHourOfDay?: Array<{ hour: number } & HudUsageTotals>;
    }>('stats.getUsage', {
      period: '24h',
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    const totals = result?.totals;
    const byHourOfDay = result?.byHourOfDay;
    if (!totals || !Array.isArray(byHourOfDay)) {
      throw new Error(
        'stats.getUsage result is missing required `totals`/`byHourOfDay` (PROTOCOL §5.36)',
      );
    }
    const rateSamples: HudRateSample[] = byHourOfDay.map((bucket) => ({
      hour: bucket.hour,
      tokens: sumHudUsageTotals(bucket),
    }));
    appStore.dispatch(
      hudUsageLoaded({
        totals,
        runs: typeof result.runs === 'number' ? result.runs : 0,
        rateSamples,
        fetchedAtMs: Date.now(),
      }),
    );
  } catch (error) {
    appStore.dispatch(hudUsageFailed(error instanceof Error ? error.message : String(error)));
  }
}

/** Fetch the per-minute rate history (§5.39) and fold it into the slice. */
async function loadRateHistory(): Promise<void> {
  try {
    const result = await backendRequest<{
      samples?: Array<{ bucketUtc: string } & HudUsageTotals>;
    }>('stats.getRateHistory', { limit: HUD_RATE_HISTORY_LIMIT });
    const samples = result?.samples;
    if (!Array.isArray(samples)) {
      throw new Error('stats.getRateHistory result is missing `samples` (PROTOCOL §5.39)');
    }
    // Counters are kept per-kind for the stacked chart segments; §5.39 samples
    // are dense (thoughtTokens is always present), but a pre-#976 daemon omits
    // it — the field then stays absent rather than being healed to 0.
    const mapped: HudRateHistorySample[] = samples.map((sample) => ({
      bucketUtc: sample.bucketUtc,
      inputTokens: sample.inputTokens,
      outputTokens: sample.outputTokens,
      cacheReadTokens: sample.cacheReadTokens,
      cacheCreationTokens: sample.cacheCreationTokens,
      ...(sample.thoughtTokens === undefined ? {} : { thoughtTokens: sample.thoughtTokens }),
    }));
    appStore.dispatch(hudRateHistoryLoaded({ samples: mapped, fetchedAtMs: Date.now() }));
  } catch (error) {
    appStore.dispatch(hudRateHistoryFailed(error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Workspaces whose agent list this HUD session already requested — one
 * `agent.list` hydration per workspace per session (no polling). Cleared on
 * `startHudSubscription()` and on reconnect so a daemon restart re-converges.
 * Ongoing freshness is event-driven: the daemon-events-bridge re-dispatches
 * `hydrateAgentsRequested` on `agent:status-changed`/`agent:idle`.
 */
const hydratedAgentWorkspaceIds = new Set<string>();

/**
 * Request the agent list for every HUD-visible (non-archived, non-deleted)
 * workspace not yet hydrated this session. The AgentLite projection (§5.5)
 * carries the persisted `lastAgentResponse`, which `bulkUpsertSessions`
 * folds into the session slice — that is what the card rows render as the
 * per-agent activity line. Dispatches fan out in parallel; the
 * lifecycle-read-service coalesces concurrent fetches per workspace.
 */
function hydrateVisibleWorkspaceAgents(): void {
  const workspaces = appStore.state.workspace?.workspaces;
  for (const workspace of workspaces ? getItems(workspaces) : []) {
    if (
      workspace.status === WorkspaceStatus.Archived ||
      workspace.status === WorkspaceStatus.Deleted
    ) {
      continue;
    }
    const workspaceId = String(workspace.id);
    if (hydratedAgentWorkspaceIds.has(workspaceId)) continue;
    hydratedAgentWorkspaceIds.add(workspaceId);
    appStore.dispatch(hydrateAgentsRequested(workspaceId));
  }
}

/**
 * Last STATUS UPDATE takeover text per workspace — dedupes no-op
 * `workspace:updated` statusMessage re-emits (the same text never re-takes
 * over the screen). Cleared on every `startHudSubscription()`.
 */
const lastStatusUpdateTextByWorkspaceId = new Map<string, string>();

/**
 * Agent ids whose first running transition this HUD session already emitted
 * its one AGENT DELEGATED feed row. Raw `agent:created` never renders (feed
 * noise before the agent has done anything) — the delegation row lands when
 * the agent FIRST starts work, and later running transitions keep the normal
 * AGENT RUNNING chip. Cleared on `startHudSubscription()` (pre-subscription
 * starts are simply missed, same as every other feed row); deliberately NOT
 * cleared on reconnect — a known agent must not re-announce as delegated.
 */
const delegatedRowEmittedAgentIds = new Set<string>();

/**
 * First running `agent:status-changed` per agent id → the one AGENT
 * DELEGATED row (kind rewritten to the synthetic feed kind); every later
 * running transition passes through unchanged.
 */
function withFirstStartRewrite(entry: HudFeedEntry): HudFeedEntry {
  if (entry.kind !== 'agent:status-changed' || !entry.agentId) return entry;
  if (toHudAgentStateBucket(entry.agentStatus ?? '') !== 'running') return entry;
  if (delegatedRowEmittedAgentIds.has(entry.agentId)) return entry;
  delegatedRowEmittedAgentIds.add(entry.agentId);
  return { ...entry, kind: HUD_AGENT_DELEGATED_FEED_KIND };
}

/**
 * displayStatus values whose arrival releases a workspace's captured questions
 * (see the dispatch site below). An ALLOWLIST, not `!== 'needs_attention'`,
 * because the rollup is precedence-ordered and a HIGHER-ranked signal masks a
 * still-pending question rather than resolving it: intentd#945 extends the
 * rollup with `failed`/`blocked`, which outrank `needs_attention`, so another
 * agent failing or raising a blocker mid-question would transition the
 * workspace and wrongly clear the capture. Only statuses that rank BELOW
 * `needs_attention` imply the hold is genuinely gone. Unknown/future wire
 * values never reach here (`isWorkspaceDisplayStatus` rejects them) and, being
 * absent from this set, would not release either.
 *
 * Residual (either way): the rollup is workspace-scoped, so an answered
 * question whose workspace still holds attention for an unrelated agent stays
 * captured until the workspace clears. Per-agent release arrives with the
 * daemon's persisted pending-questions marker (the intentd counterpart of this
 * change), which the HUD will read off session metadata exactly like it
 * already reads `dismissedQuestionsMessageId`.
 */
const QUESTION_RELEASING_DISPLAY_STATUSES: ReadonlySet<WorkspaceDisplayStatus> = new Set([
  'not_started',
  'in_progress',
  'idle',
  'complete',
  'pr_ready',
  'pr_open',
  'pr_merged',
]);

/**
 * Set on reconnect and consumed by the first refetched workspace list —
 * see `sweepQuestionReleaseAgainstWorkspaces`.
 */
let questionReleaseSweepArmed = false;

/**
 * Reconnect fallback for the release signal. The live
 * `workspace:displayStatus-changed` event is the ONLY release trigger, so a
 * transition missed during an outage would leave a captured question pending
 * forever. RESUB-1 refetches the workspace list, whose entries carry the
 * BE-owned `displayStatus` — replay the same allowlist decision against it.
 * Workspaces whose refetched status is absent or non-releasing are left
 * untouched (never a speculative clear).
 */
function sweepQuestionReleaseAgainstWorkspaces(): void {
  const workspaces = appStore.state.workspace?.workspaces;
  for (const workspace of workspaces ? getItems(workspaces) : []) {
    const displayStatus = (workspace as { displayStatus?: unknown }).displayStatus;
    if (!isWorkspaceDisplayStatus(displayStatus)) continue;
    if (!QUESTION_RELEASING_DISPLAY_STATUSES.has(displayStatus)) continue;
    appStore.dispatch(hudQuestionsResolvedForWorkspace(String(workspace.id)));
  }
}

/** Whether a status_update trigger repeats the workspace's last shown text. */
function isDuplicateStatusUpdate(trigger: HudTakeoverTrigger): boolean {
  if (trigger.kind !== 'status_update') return false;
  const previous = lastStatusUpdateTextByWorkspaceId.get(trigger.workspaceId);
  lastStatusUpdateTextByWorkspaceId.set(trigger.workspaceId, trigger.detail);
  return previous === trigger.detail;
}

function handleEvent(event: WorkspaceEvent): void {
  const workspaceId = typeof event.workspaceId === 'string' ? event.workspaceId : '';
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  const type = event.type as string;
  if (type === 'agent:stream:end') {
    // §7.1 question capture — the takeover trigger for the same event still
    // fans out below.
    for (const question of extractQuestionsFromStreamEnd(event)) {
      appStore.dispatch(hudQuestionCaptured(question));
    }
  }
  if (type === 'workspace:attention-changed') {
    const attention = data.attention;
    if (workspaceId && typeof attention === 'string') {
      // Raise time = the event's wire timestamp (drives the elapsed timer);
      // fall back to the arrival clock for envelopes missing one.
      const raisedAtTs =
        typeof event.timestamp === 'string' && event.timestamp.length > 0
          ? event.timestamp
          : new Date().toISOString();
      appStore.dispatch(hudAttentionChanged(workspaceId, attention, raisedAtTs));
    }
  } else if (type === 'workspace:displayStatus-changed') {
    const displayStatus = data.displayStatus;
    if (workspaceId && isWorkspaceDisplayStatus(displayStatus)) {
      appStore.dispatch(hudDisplayStatusChanged(workspaceId, displayStatus));
      // Question release (spec §Decisions): pendingness is persistent — a
      // plain user message and the turn it starts no longer supersede a
      // captured question, so the ONLY release signal the HUD sees is the
      // daemon's rollup. A pending question always holds `needs_attention`
      // up, so landing on a status that ranks BELOW it means the questions
      // were answered or dismissed.
      if (QUESTION_RELEASING_DISPLAY_STATUSES.has(displayStatus)) {
        appStore.dispatch(hudQuestionsResolvedForWorkspace(workspaceId));
      }
    }
  }
  const entry = mapEventToFeedEntry(event);
  if (entry) appStore.dispatch(hudFeedEntryReceived(withFirstStartRewrite(entry)));
  // Notable events also fan out to the takeover overlay's queue (the bus is
  // a no-op until the overlay registers its listener). The name resolver
  // backfills agent display names off the live session slice so a banner
  // never renders a raw agent UUID.
  const trigger = mapEventToTakeoverTrigger(event, resolveAgentDisplayName);
  if (trigger && !isDuplicateStatusUpdate(trigger)) emitTakeoverTrigger(trigger);
}

/**
 * One-time agent-name read off `appStore.state` (no selector imports): the
 * live session slice first, then the workspace entities' `agentSummary`
 * agents (the HUD renders all workspaces, most without hydrated sessions).
 */
function resolveAgentDisplayName(agentId: string): string | undefined {
  const state = appStore.state as {
    agentSessions?: { byAgentId?: Record<string, { name?: unknown }> };
  };
  const sessionName = state.agentSessions?.byAgentId?.[agentId]?.name;
  if (typeof sessionName === 'string' && sessionName.length > 0) return sessionName;
  const workspaces = appStore.state.workspace?.workspaces;
  for (const workspace of workspaces ? getItems(workspaces) : []) {
    const summary = (workspace as { agentSummary?: { agents?: unknown } }).agentSummary;
    if (!summary || !Array.isArray(summary.agents)) continue;
    for (const agent of summary.agents) {
      const candidate = agent as { id?: unknown; name?: unknown };
      if (candidate?.id === agentId && typeof candidate.name === 'string' && candidate.name) {
        return candidate.name;
      }
    }
  }
  return undefined;
}

function extractEvent(params: unknown): WorkspaceEvent | null {
  if (!params || typeof params !== 'object') return null;
  const wrapped = (params as { event?: unknown }).event;
  if (wrapped && typeof wrapped === 'object') return wrapped as WorkspaceEvent;
  return params as WorkspaceEvent;
}

function extractSubscriptionId(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const id = (params as { subscriptionId?: unknown }).subscriptionId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Start the HUD data layer. Returns a disposer; call it on route unmount.
 * Idempotence is the caller's concern — the §6.1 `replaceGroup` guarantees
 * the daemon holds at most one HUD subscription per connection regardless.
 */
export function startHudSubscription(): () => void {
  let disposed = false;
  let subscriptionId: string | undefined;

  lastStatusUpdateTextByWorkspaceId.clear();
  delegatedRowEmittedAgentIds.clear();
  hydratedAgentWorkspaceIds.clear();
  questionReleaseSweepArmed = false;
  appStore.dispatch(hudActivated());

  async function subscribe(): Promise<void> {
    // Drop the stale id first so the scope gate cannot match a foreign
    // subscription that reuses it during the resubscribe window.
    subscriptionId = undefined;
    try {
      const result = await backendSubscribe<{ subscriptionId?: string }>({
        eventTypes: [...HUD_SUBSCRIBE_EVENT_TYPES],
        replaceGroup: HUD_REPLACE_GROUP,
      });
      if (disposed) {
        if (typeof result?.subscriptionId === 'string') {
          void backendUnsubscribe(result.subscriptionId).catch(() => {});
        }
        return;
      }
      if (typeof result?.subscriptionId === 'string' && result.subscriptionId.length > 0) {
        subscriptionId = result.subscriptionId;
      } else {
        logger.warn('events.subscribe returned no subscriptionId', result);
      }
    } catch (error) {
      logger.error('HUD events.subscribe failed', error);
    }
  }

  const removeNotificationListener = onBackendNotification((notification) => {
    if (notification.method !== 'events.event') return;
    // §6.3 fan-out dedupe: one notification per matching subscription — drop
    // copies tagged with a foreign id; accept legacy/flat envelopes (no id).
    const envelopeId = extractSubscriptionId(notification.params);
    if (envelopeId !== undefined && envelopeId !== subscriptionId) return;
    const event = extractEvent(notification.params);
    if (event) handleEvent(event);
  });

  // RESUB-1: the daemon's subscription registry is empty after a restart —
  // replay the subscribe and refresh the coarse rollups plus every visible
  // workspace's agent list (events missed during the outage may have changed
  // `lastAgentResponse`/status).
  const removeReconnectListener = onBackendReconnected(() => {
    void subscribe();
    void loadUsage();
    void loadRateHistory();
    hydratedAgentWorkspaceIds.clear();
    hydrateVisibleWorkspaceAgents();
    // A `workspace:displayStatus-changed` that landed during the outage is
    // simply gone, and the release is only ever driven by that live event —
    // so a question answered while disconnected would stay captured forever.
    // Arm a one-shot sweep against the REFETCHED workspace list instead of
    // reading now (the store still holds the pre-outage snapshot at this
    // point); the store listener below runs it when the list reference moves.
    questionReleaseSweepArmed = true;
  });

  void subscribe();
  void loadUsage();
  void loadRateHistory();
  hydrateVisibleWorkspaceAgents();

  // The workspace list hydrates asynchronously (and can grow later) — re-run
  // the once-per-workspace hydration pass whenever the list reference moves.
  // The Set guard makes the pass idempotent (never a re-fetch), and the
  // microtask defers the dispatch out of the store's notification loop.
  let lastWorkspaces = appStore.state.workspace?.workspaces;
  const removeStoreListener = appStore.getReadableState().subscribe((state) => {
    const workspaces = state.workspace?.workspaces;
    if (workspaces === lastWorkspaces) return;
    lastWorkspaces = workspaces;
    queueMicrotask(() => {
      if (disposed) return;
      hydrateVisibleWorkspaceAgents();
      if (questionReleaseSweepArmed) {
        questionReleaseSweepArmed = false;
        sweepQuestionReleaseAgainstWorkspaces();
      }
    });
  });

  // TOK/MIN chart poll — minute buckets only move once a minute, but a short
  // cadence keeps the newest bucket's in-progress accumulation fresh.
  const rateHistoryTimer = setInterval(() => {
    void loadRateHistory();
  }, HUD_RATE_HISTORY_POLL_MS);

  return () => {
    if (disposed) return;
    disposed = true;
    clearInterval(rateHistoryTimer);
    removeNotificationListener();
    removeReconnectListener();
    removeStoreListener();
    if (subscriptionId) {
      void backendUnsubscribe(subscriptionId).catch(() => {});
      subscriptionId = undefined;
    }
    appStore.dispatch(hudDeactivated());
  };
}
