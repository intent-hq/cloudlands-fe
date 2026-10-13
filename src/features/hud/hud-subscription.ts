import { runtimeReadDrained, trackRuntimeRead } from '$features/events/runtime-read-lane';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import {
  acquireAgentMetadataDemand,
  trackAgentMetadataRead,
} from '$features/agent/agent-metadata-recovery';
import {
  rendererEventRecovery,
  type RendererRecoveryScope,
  type RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
import { normalizeAgent } from '$lib/client/live/live-agents-client';
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
 *  - hydrates the agents of EVERY HUD-visible workspace exactly once via
 *    `hydrateAgentsRequested` — the AgentLite projection carries the
 *    persisted `lastAgentResponse` that feeds the per-agent activity line on
 *    the cards, and without this only sessions hydrated in THIS window (or
 *    touched by a live status event) have one. The read is BOUNDED
 *    (intent-hq/intent#5531): the `scope: "topLevel"` `agent.list` bin plus
 *    the workspace's currently busy agents from one shared `agent.listActive`
 *    read plus the summary's capped failed rows, each fetched with
 *    `agent.get` — never the unscoped all-rows list.
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
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { isWorkspaceDisplayStatus, WorkspaceStatus } from '$shared/types';
import {
  hydrateAgentsRequested,
  setAgents,
  setAgentsLoaded,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  bulkUpsertSessions,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import {
  hudActivated,
  hudAttentionChanged,
  hudDeactivated,
  hudDisplayStatusChanged,
  hudFeedEntryReceived,
  hudQuestionCaptured,
  hudRateHistoryFailed,
  hudRateHistoryLoaded,
  hudUsageFailed,
  hudUsageLoaded,
  hudQuestionsResolvedForWorkspace,
  hudWorkspaceStateCleared,
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
import { startHudGridFilterPersistence } from './hud-grid-filter-persistence';
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

function sumTotals(totals: HudUsageTotals): number {
  return (
    totals.inputTokens +
    totals.outputTokens +
    totals.cacheReadTokens +
    totals.cacheCreationTokens +
    (totals.thoughtTokens ?? 0)
  );
}

const QUESTION_HOLD_DISPLAY_STATUSES = new Set(['failed', 'blocked', 'needs_attention']);

function resolveQuestionsForDisplayStatus(workspaceId: string, displayStatus: string): void {
  if (!QUESTION_HOLD_DISPLAY_STATUSES.has(displayStatus)) {
    appStore.dispatch(hudQuestionsResolvedForWorkspace(workspaceId));
  }
}

type UsageResult = {
  totals?: HudUsageTotals;
  runs?: number;
  byHourOfDay?: Array<{ hour: number } & HudUsageTotals>;
};
function applyUsage(result: UsageResult): void {
  const totals = result?.totals;
  const byHourOfDay = result?.byHourOfDay;
  if (!totals || !Array.isArray(byHourOfDay)) {
    throw new Error(
      'stats.getUsage result is missing required `totals`/`byHourOfDay` (PROTOCOL §5.36)',
    );
  }
  const rateSamples: HudRateSample[] = byHourOfDay.map((bucket) => ({
    hour: bucket.hour,
    tokens: sumTotals(bucket),
  }));
  appStore.dispatch(
    hudUsageLoaded({
      totals,
      runs: typeof result.runs === 'number' ? result.runs : 0,
      rateSamples,
      fetchedAtMs: Date.now(),
    }),
  );
}

/** Fetch the 24h usage rollup (§5.36) and fold it into the slice. */
async function loadUsage(isLive: () => boolean, scope?: RendererRecoveryScope): Promise<void> {
  const token = rendererEventRecovery.capture('hud-stats');
  const request: typeof backendRequest = (method, params) =>
    trackRuntimeRead('hud-stats', () => {
      if (!isLive() || !token.commit(() => {})) throw new Error('HUD stats read superseded');
      return (scope?.request ?? backendRequest)(method, params);
    });
  try {
    const result = await request<{
      totals?: HudUsageTotals;
      runs?: number;
      byHourOfDay?: Array<{ hour: number } & HudUsageTotals>;
    }>('stats.getUsage', {
      period: '24h',
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    if (!isLive()) return;
    token.commit(() => {
      applyUsage(result);
    });
  } catch (error) {
    if (!isLive()) return;
    token.commit(() => {
      appStore.dispatch(hudUsageFailed(error instanceof Error ? error.message : String(error)));
    });
  }
}

type RateHistoryResult = { samples?: Array<{ bucketUtc: string } & HudUsageTotals> };
function applyRateHistory(result: RateHistoryResult): void {
  const samples = result?.samples;
  if (!Array.isArray(samples)) {
    throw new Error('stats.getRateHistory result is missing `samples` (PROTOCOL §5.39)');
  }
  const mapped: HudRateHistorySample[] = samples.map((sample) => ({ ...sample }));
  appStore.dispatch(hudRateHistoryLoaded({ samples: mapped, fetchedAtMs: Date.now() }));
}

/** Fetch the per-minute rate history (§5.39) and fold it into the slice. */
async function loadRateHistory(
  isLive: () => boolean,
  scope?: RendererRecoveryScope,
): Promise<void> {
  const token = rendererEventRecovery.capture('hud-stats');
  const request: typeof backendRequest = (method, params) =>
    trackRuntimeRead('hud-stats', () => {
      if (!isLive() || !token.commit(() => {})) throw new Error('HUD stats read superseded');
      return (scope?.request ?? backendRequest)(method, params);
    });
  try {
    const result = await request<{
      samples?: Array<{ bucketUtc: string } & HudUsageTotals>;
    }>('stats.getRateHistory', { limit: HUD_RATE_HISTORY_LIMIT });
    if (!isLive()) return;
    token.commit(() => {
      applyRateHistory(result);
    });
  } catch (error) {
    if (!isLive()) return;
    token.commit(() => {
      appStore.dispatch(
        hudRateHistoryFailed(error instanceof Error ? error.message : String(error)),
      );
    });
  }
}

/**
 * Workspaces whose agents this HUD session already requested — one bounded
 * hydration per workspace per session (no polling). Cleared on
 * `startHudSubscription()` and on reconnect so a daemon restart re-converges.
 * Ongoing freshness is event-driven: the daemon-events-bridge re-dispatches
 * `hydrateAgentsRequested` on `agent:status-changed`/`agent:idle`.
 */
const hydratedAgentWorkspaceIds = new Set<string>();

/**
 * In-flight agent hydration per workspace. `subscribe()` and the hydration
 * pass start concurrently, so an agent-family event can arrive before its
 * (possibly muted) session is in the slice — `handleEvent` parks the takeover
 * check of such an unknown agent on this promise and re-runs the mute gate
 * once the rows have landed. Entries drop as each hydration settles.
 */
const pendingAgentHydrationByWorkspaceId = new Map<string, Promise<void>>();

/** `agent.listActive` result subset (PROTOCOL §5.5). */
interface AgentListActiveResult {
  streams?: Array<{ agentId?: string; workspaceId?: string }>;
}

/** Busy agent ids per workspace — one `agent.listActive` read per hydration pass. */
type BusyAgentIdsByWorkspaceId = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Hydrate the agents of every HUD-visible (non-archived, non-deleted)
 * workspace not yet hydrated this session. The AgentLite projection (§5.5)
 * carries the persisted `lastAgentResponse`, which `bulkUpsertSessions`
 * folds into the session slice — that is what the card rows render as the
 * per-agent activity line. Dispatches fan out in parallel; the
 * lifecycle-read-service coalesces concurrent fetches per workspace.
 *
 * The daemon-global busy set is read ONCE per pass and shared by every
 * workspace hydrated in it (intent-hq/intent#5531): a per-workspace
 * `agent.listActive` would re-multiply the request count by the workspace
 * count the scoped list read just removed.
 */
function hydrateVisibleWorkspaceAgents(isLive: () => boolean, scope?: RendererRecoveryScope): void {
  if (!isLive()) return;
  const workspaces = appStore.state.workspace?.workspaces;
  const pending: Array<{ workspaceId: string; failedSummaryIds: string[] }> = [];
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
    pending.push({ workspaceId, failedSummaryIds: failedSummaryAgentIds(workspace) });
  }
  if (pending.length === 0) return;
  let busyAgentIds: Promise<BusyAgentIdsByWorkspaceId> | undefined;
  const readBusy = () => (busyAgentIds ??= readBusyAgentIds(scope));
  let admitted = 0;
  let start!: () => void;
  const ready = new Promise<void>((resolve) => {
    start = resolve;
  });
  const enter = () => {
    if (++admitted === pending.length) start();
    return ready;
  };
  for (const { workspaceId, failedSummaryIds } of pending) {
    appStore.dispatch(hydrateAgentsRequested(workspaceId));
    const hydration = hydrateHudWorkspaceAgents(
      workspaceId,
      readBusy,
      failedSummaryIds,
      isLive,
      scope,
      enter,
    ).finally(() => {
      if (pendingAgentHydrationByWorkspaceId.get(workspaceId) === hydration) {
        pendingAgentHydrationByWorkspaceId.delete(workspaceId);
      }
    });
    pendingAgentHydrationByWorkspaceId.set(workspaceId, hydration);
  }
}

/**
 * One `agent.listActive` (§5.5, daemon-global mid-turn busy set) grouped by
 * workspace. A failed read yields an empty map — the pass still hydrates the
 * top-level rows; only the busy non-top-level rows are missed until the next
 * event-driven hydration.
 */
async function readBusyAgentIds(scope?: RendererRecoveryScope): Promise<BusyAgentIdsByWorkspaceId> {
  const request = scope?.request ?? backendRequest;
  const byWorkspaceId = new Map<string, Set<string>>();
  try {
    const result = await request<AgentListActiveResult>('agent.listActive', {});
    for (const stream of result?.streams ?? []) {
      if (typeof stream?.agentId !== 'string' || typeof stream.workspaceId !== 'string') continue;
      let ids = byWorkspaceId.get(stream.workspaceId);
      if (!ids) {
        ids = new Set<string>();
        byWorkspaceId.set(stream.workspaceId, ids);
      }
      ids.add(stream.agentId);
    }
  } catch (error) {
    if (error instanceof RecoveryRequestTimeoutError) await error.drained;
    logger.warn('agent.listActive failed for HUD hydration; top-level rows only', { error });
  }
  return byWorkspaceId;
}

/**
 * Cap on the summary's failed rows point-read per workspace by
 * `hydrateHudWorkspaceAgents`. The §5.1 `agentSummary` is deliberately
 * uncapped (459 rows on the intent-hq/intent#5531 workspace), so the failed
 * subset is bounded here too — newest failures first, since those are the
 * rows the card renders and the failed snippet reads.
 */
export const HUD_FAILED_SUMMARY_ROW_READ_CAP = 8;

/**
 * Failed rows of a workspace's §5.1 `agentSummary` (`status` error/failed —
 * the only session-detail-bearing rows the summary can identify: it carries
 * neither the attention-request trio nor `notificationsMuted`), newest
 * `lastActivity` first, capped at `HUD_FAILED_SUMMARY_ROW_READ_CAP`. A failed
 * delegated child is neither top-level nor busy, so without this read its
 * card row has no `stopReason` / activity line and its mute state is unknown
 * to the failed-snippet gate.
 */
function failedSummaryAgentIds(workspace: { agentSummary?: unknown }): string[] {
  const summary = workspace.agentSummary as { agents?: unknown } | undefined;
  if (!summary || !Array.isArray(summary.agents)) return [];
  const failed: Array<{ id: string; lastActivityMs: number }> = [];
  for (const agent of summary.agents) {
    const row = agent as { id?: unknown; status?: unknown; lastActivity?: unknown };
    if (typeof row?.id !== 'string' || typeof row.status !== 'string') continue;
    if (toHudAgentStateBucket(row.status) !== 'failed') continue;
    if (isAgentDeletionPending(row.id)) continue;
    const ms = typeof row.lastActivity === 'string' ? Date.parse(row.lastActivity) : NaN;
    failed.push({ id: row.id, lastActivityMs: Number.isFinite(ms) ? ms : -Infinity });
  }
  return failed
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
    .slice(0, HUD_FAILED_SUMMARY_ROW_READ_CAP)
    .map((row) => row.id);
}

/**
 * Bounded per-workspace hydration (intent-hq/intent#5531): the HUD needs the
 * top-level agents (the `scope: "topLevel"` bin the sidebar's default read
 * uses too) plus whichever background/delegated agents are currently mid-turn
 * — idle child rows are not needed for the card activity line — plus the
 * summary's (capped) failed rows, whose `stopReason` / `notificationsMuted`
 * the card's failed row and snippet read. The rows absent from the top-level
 * bin are point-read with `agent.get`, bounded by the workspace's busy count
 * plus the failed cap rather than its session count; a single failed point
 * read is skipped, never failing the workspace's hydration.
 */
async function hydrateHudWorkspaceAgents(
  workspaceId: string,
  readBusy: () => Promise<BusyAgentIdsByWorkspaceId>,
  failedSummaryIds: readonly string[],
  isLive: () => boolean,
  scope: RendererRecoveryScope | undefined,
  enter: () => Promise<void>,
): Promise<void> {
  const token = rendererEventRecovery.capture('agents:' + JSON.stringify([workspaceId]));
  return trackAgentMetadataRead(workspaceId, async () => {
    const physical: Promise<void>[] = [];
    const tracked = <T>(read: Promise<T>): Promise<T> => {
      physical.push(runtimeReadDrained(read));
      return read;
    };
    try {
      // Reserve every workspace before starting the one shared busy lookup.
      await enter();
      if (!isLive() || !token.commit(() => {})) return;
      const busy = tracked(readBusy());
      const list = tracked(
        scope
          ? scope
              .request<{ agents: Record<string, unknown>[] }>('agent.list', {
                workspaceId,
                scope: 'topLevel',
              })
              .then((result) => ({ agents: result.agents.map(normalizeAgent) }))
          : appClient.agents.listWithMeta(workspaceId, { scope: 'topLevel' }),
      );
      const [{ agents: topLevel }, busyByWorkspaceId] = await Promise.all([list, busy]);
      if (!isLive() || !token.commit(() => {})) return;
      const listedIds = new Set(topLevel.map((agent) => String(agent.id)));
      const pointReadIds = [
        ...new Set([...(busyByWorkspaceId.get(workspaceId) ?? []), ...failedSummaryIds]),
      ].filter((agentId) => !listedIds.has(agentId));
      const pointReadRows = await Promise.all(
        pointReadIds.map(async (agentId) => {
          try {
            return await tracked(
              readHudAgent(
                agentId,
                workspaceId,
                scope,
                () => isLive() && token.commit(() => {}),
                true,
              ),
            );
          } catch (error) {
            logger.debug('agent.get failed for busy/failed HUD agent; skipped', {
              workspaceId,
              agentId,
              error,
            });
            return null;
          }
        }),
      );
      if (!isLive()) return;
      const listed = [...topLevel, ...pointReadRows.filter((row) => row !== null)];
      const agents = listed
        .filter((agent) => !agent.pendingDeleteAt && !isAgentDeletionPending(String(agent.id)))
        .map((agent) => ({ ...agent, messages: agent.messages ?? [] }));
      token.commit(() => {
        appStore.dispatch(setAgentsLoaded(workspaceId, true));
        if (agents.length === 0) return;
        appStore.dispatch(setAgents(workspaceId, agents));
        appStore.dispatch(bulkUpsertSessions(agents, { listProjection: true }));
        for (const agent of agents) appStore.dispatch(upsertSession(agent));
      });
    } catch (error) {
      logger.warn('agent hydration failed for HUD workspace', { workspaceId, error });
    } finally {
      // Promise.all can fail before siblings complete; retain their physical slots.
      await Promise.all(physical);
    }
  });
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

/** Whether a status_update trigger repeats the workspace's last shown text. */
function isDuplicateStatusUpdate(trigger: HudTakeoverTrigger): boolean {
  if (trigger.kind !== 'status_update') return false;
  const previous = lastStatusUpdateTextByWorkspaceId.get(trigger.workspaceId);
  lastStatusUpdateTextByWorkspaceId.set(trigger.workspaceId, trigger.detail);
  return previous === trigger.detail;
}

function handleEvent(
  event: WorkspaceEvent,
  isLive: () => boolean = () => true,
  scope?: RendererRecoveryScope,
  project = true,
): void {
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
  if (project && type === 'workspace:attention-changed') {
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
  } else if (project && type === 'workspace:displayStatus-changed') {
    const displayStatus = data.displayStatus;
    if (workspaceId && isWorkspaceDisplayStatus(displayStatus)) {
      appStore.dispatch(hudDisplayStatusChanged(workspaceId, displayStatus));
      resolveQuestionsForDisplayStatus(workspaceId, displayStatus);
    }
  }
  const entry = mapEventToFeedEntry(event);
  if (entry) appStore.dispatch(hudFeedEntryReceived(withFirstStartRewrite(entry)));
  // Notable events also fan out to the takeover overlay's queue (the bus is
  // a no-op until the overlay registers its listener). The name resolver
  // backfills agent display names off the live session slice so a banner
  // never renders a raw agent UUID; the mute resolver keeps muted agents
  // (§5.5 `notificationsMuted`) from opening a takeover. An agent-family
  // event whose agent is not yet in the session slice while its workspace's
  // agent hydration is still in flight waits for that hydration before
  // the mute gate runs — otherwise a muted agent's `agent:started` /
  // `agent:failed` / `agent:stream:end` (no payload stamp) racing the list
  // would take over the screen.
  // An agent still unknown after that (an idle delegated/background agent
  // — outside the bounded topLevel + busy hydration, intent-hq/intent#5531)
  // is point-read with one coalesced `agent.get` before the gate runs, so
  // its mute state is never assumed from a missing session.
  const emitTrigger = () => {
    if (!isLive()) return;
    const trigger = mapEventToTakeoverTrigger(event, resolveAgentDisplayName, isAgentMuted);
    if (trigger && !isDuplicateStatusUpdate(trigger)) emitTakeoverTrigger(trigger);
  };
  const agentId = typeof data.agentId === 'string' ? data.agentId : undefined;
  if (
    agentId &&
    HUD_TAKEOVER_EVENT_TYPES.includes(type) &&
    readAgentSession(agentId) === undefined &&
    mapEventToTakeoverTrigger(event, undefined, () => false) !== null
  ) {
    const pendingHydration = workspaceId
      ? pendingAgentHydrationByWorkspaceId.get(workspaceId)
      : undefined;
    void (pendingHydration ?? Promise.resolve()).then(() => {
      if (!isLive()) return;
      if (readAgentSession(agentId) !== undefined) {
        emitTrigger();
        return;
      }
      return hydrateUnknownAgent(agentId, workspaceId, isLive, scope).then(emitTrigger);
    });
    return;
  }
  emitTrigger();
}

function readAgentSession(agentId: string): { notificationsMuted?: unknown } | undefined {
  const state = appStore.state as {
    agentSessions?: { byAgentId?: Record<string, { notificationsMuted?: unknown }> };
  };
  return state.agentSessions?.byAgentId?.[agentId];
}

/**
 * In-flight `agent.get` point reads for agents absent from the session slice,
 * keyed by agent id — an unknown agent's event burst (`agent:started`, then
 * `agent:stream:end` / `agent:failed`) coalesces into ONE read. Cleared on
 * `startHudSubscription()`.
 */
const pendingUnknownAgentReadByAgentId = new Map<string, Promise<void>>();

/**
 * Land an unknown agent's session in the store via `agent.get` (§5.5) so the
 * mute gate reads its `notificationsMuted`; bounded by the number of distinct
 * unknown agents that emit takeover events, never by the session count. A
 * failed or not-found read leaves the agent unknown — it then gates as
 * unmuted, the pre-existing behavior for a session the store never saw.
 */
async function readHudAgent(
  agentId: string,
  workspaceId: string,
  scope?: RendererRecoveryScope,
  isLive: () => boolean = () => true,
  insideMetadataOperation = false,
) {
  const token = rendererEventRecovery.capture('agents:' + JSON.stringify([workspaceId]));
  const read = async () => {
    if (!isLive() || !token.commit(() => {})) return null;
    if (!scope) return appClient.agents.get(agentId, workspaceId || undefined);
    const result = await scope.request<{ agent?: unknown } | unknown>('agent.get', {
      agentId,
      ...(workspaceId ? { workspaceId } : {}),
    });
    const raw = result && typeof result === 'object' && 'agent' in result ? result.agent : result;
    return raw && typeof raw === 'object' ? normalizeAgent(raw as Record<string, unknown>) : null;
  };
  return insideMetadataOperation ? read() : trackAgentMetadataRead(workspaceId, read);
}

function hydrateUnknownAgent(
  agentId: string,
  workspaceId: string,
  isLive: () => boolean,
  scope?: RendererRecoveryScope,
): Promise<void> {
  const token = rendererEventRecovery.capture('agents:' + JSON.stringify([workspaceId]));
  const pending = pendingUnknownAgentReadByAgentId.get(agentId);
  if (pending) return pending;
  const read = readHudAgent(agentId, workspaceId, scope, () => isLive() && token.commit(() => {}))
    .then((agent) => {
      if (!isLive() || !agent || agent.pendingDeleteAt || isAgentDeletionPending(agentId)) return;
      const session = { ...agent, messages: agent.messages ?? [] };
      token.commit(() => {
        appStore.dispatch(bulkUpsertSessions([session], { listProjection: true }));
        appStore.dispatch(upsertSession(session));
      });
    })
    .catch((error: unknown) => {
      logger.debug('agent.get failed for unknown HUD agent; gated as unmuted', {
        workspaceId,
        agentId,
        error,
      });
    })
    .finally(() => {
      if (pendingUnknownAgentReadByAgentId.get(agentId) === read) {
        pendingUnknownAgentReadByAgentId.delete(agentId);
      }
    });
  pendingUnknownAgentReadByAgentId.set(agentId, read);
  return read;
}

/**
 * One-time mute read off `appStore.state` (no selector imports): the hydrated
 * session's `notificationsMuted` (§5.5 AgentLite, hydrated per HUD-visible
 * workspace by `hydrateVisibleWorkspaceAgents`, or point-read by
 * `hydrateUnknownAgent`); unknown agents are unmuted.
 */
function isAgentMuted(agentId: string): boolean {
  return readAgentSession(agentId)?.notificationsMuted === true;
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
  let generation = 0;
  let adopted = false;
  let recoveryScope: RendererRecoveryScope | undefined;
  let reconcileRecoveryWorkspaces = () => {};
  let statsOwner: RendererRecoveryHandle | undefined;
  const pendingStats = new Map<string, Promise<void>>();
  const queuedStats = new Set<string>();
  const refreshStats = (kind: 'usage' | 'rates') => {
    if (disposed || pendingStats.has(kind) || statsOwner?.status.stale) return;
    const pending = (kind === 'usage' ? loadUsage : loadRateHistory)(
      capture(),
      recoveryScope,
    ).finally(() => {
      if (pendingStats.get(kind) === pending) {
        pendingStats.delete(kind);
        if (queuedStats.delete(kind)) refreshStats(kind);
      }
    });
    pendingStats.set(kind, pending);
  };
  const capture = () => {
    const version = generation;
    return () => !disposed && generation === version;
  };
  let subscriptionId: string | undefined;

  lastStatusUpdateTextByWorkspaceId.clear();
  delegatedRowEmittedAgentIds.clear();
  hydratedAgentWorkspaceIds.clear();
  pendingAgentHydrationByWorkspaceId.clear();
  pendingUnknownAgentReadByAgentId.clear();
  appStore.dispatch(hudActivated());

  // Per-backend grid-filter restore + persist-on-change (thin localStorage
  // layer under the slice; stopped before hudDeactivated resets the filter).
  const stopGridFilterPersistence = startHudGridFilterPersistence();

  async function subscribe(): Promise<void> {
    const isLive = capture();
    // Drop the stale id first so the scope gate cannot match a foreign
    // subscription that reuses it during the resubscribe window.
    subscriptionId = undefined;
    try {
      const result = await backendSubscribe<{ subscriptionId?: string }>({
        eventTypes: [...HUD_SUBSCRIBE_EVENT_TYPES],
        replaceGroup: HUD_REPLACE_GROUP,
      });
      if (!isLive()) {
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
    if (adopted || notification.method !== 'events.event') return;
    // §6.3 fan-out dedupe: one notification per matching subscription — drop
    // copies tagged with a foreign id; accept legacy/flat envelopes (no id).
    const envelopeId = extractSubscriptionId(notification.params);
    if (envelopeId !== undefined && envelopeId !== subscriptionId) return;
    const event = extractEvent(notification.params);
    if (event) handleEvent(event, capture());
  });

  // RESUB-1: the daemon's subscription registry is empty after a restart —
  // replay the subscribe and refresh the coarse rollups plus every visible
  // workspace's agent list (events missed during the outage may have changed
  // `lastAgentResponse`/status).
  const removeReconnectListener = onBackendReconnected(() => {
    if (adopted) return;
    generation++;
    pendingAgentHydrationByWorkspaceId.clear();
    pendingUnknownAgentReadByAgentId.clear();
    void subscribe();
    refreshStats('usage');
    refreshStats('rates');
    hydratedAgentWorkspaceIds.clear();
    hydrateVisibleWorkspaceAgents(capture(), recoveryScope);
  });

  const offRecovery = rendererEventRecovery.onSession((scope) => {
    adopted = true;
    recoveryScope = scope;
    generation++;
    const live = capture();
    pendingStats.clear();
    queuedStats.clear();
    appStore.dispatch(hudActivated());
    hydratedAgentWorkspaceIds.clear();
    pendingAgentHydrationByWorkspaceId.clear();
    pendingUnknownAgentReadByAgentId.clear();
    const abort = new AbortController();
    if (subscriptionId) void backendUnsubscribe(subscriptionId).catch(() => {});
    subscriptionId = undefined;
    const workspaces = new Map<string, RendererRecoveryHandle>();
    const retiredWorkspaces = new Set<string>();
    const agentDemands = new Map<string, () => void>();
    const visibleIds = () =>
      (appStore.state.workspace?.workspaces ? getItems(appStore.state.workspace.workspaces) : [])
        .filter(
          (row) =>
            row.status !== WorkspaceStatus.Archived && row.status !== WorkspaceStatus.Deleted,
        )
        .map((row) => String(row.id));
    const stats = scope.registerResource({
      key: 'hud-stats',
      workspaceId: null,
      eventTypes: HUD_SUBSCRIBE_EVENT_TYPES,
      isCurrent: live,
      onEvent: () => {
        // Accepted events expire ordinary read receipts too. Coalesce a fresh
        // seed after any held reads settle without entering recovery mode.
        for (const kind of pendingStats.keys()) queuedStats.add(kind);
      },
      read: (reader) =>
        trackRuntimeRead('hud-stats', async () => {
          return {
            usage: await reader.request<UsageResult>('stats.getUsage', {
              period: '24h',
              tzOffsetMinutes: -new Date().getTimezoneOffset(),
            }),
            rates: await reader.request<RateHistoryResult>('stats.getRateHistory', {
              limit: HUD_RATE_HISTORY_LIMIT,
            }),
          };
        }),
      apply: (value) => {
        applyUsage(value.usage);
        applyRateHistory(value.rates);
      },
      invalidate: () => {},
      retire: () => {
        generation++;
        appStore.dispatch(hudDeactivated());
      },
    });
    statsOwner = stats;
    const reconcile = () => {
      const ids = new Set(visibleIds());
      for (const [id, owner] of workspaces)
        if (!ids.has(id)) {
          owner.dispose();
          agentDemands.get(id)?.();
          agentDemands.delete(id);
          workspaces.delete(id);
          appStore.dispatch(hudWorkspaceStateCleared(id));
        }
      for (const id of ids)
        if (!workspaces.has(id)) {
          agentDemands.set(id, acquireAgentMetadataDemand(id, { hud: true }));
          const owner = scope.registerResource({
            key: 'hud:' + JSON.stringify([id]),
            workspaceId: id,
            eventTypes: [
              'workspace:attention-changed',
              'workspace:displayStatus-changed',
              'workspace:updated',
            ],
            isCurrent: () => live() && visibleIds().includes(id),
            read: async (reader) => {
              const result = await reader.request<Record<string, unknown>>('workspace.get', {
                workspaceId: id,
              });
              return (result.workspace ?? result) as {
                attention?: string;
                displayStatus?: unknown;
                updatedAt?: string;
              };
            },
            apply: (value) => {
              appStore.dispatch(hudWorkspaceStateCleared(id));
              appStore.dispatch(
                hudAttentionChanged(
                  id,
                  value.attention ?? 'none',
                  value.updatedAt ?? new Date().toISOString(),
                ),
              );
              if (isWorkspaceDisplayStatus(value.displayStatus))
                appStore.dispatch(hudDisplayStatusChanged(id, value.displayStatus));
              if (typeof value.displayStatus === 'string')
                resolveQuestionsForDisplayStatus(id, value.displayStatus);
            },
            invalidate: () => {},
            retire: () => {
              retiredWorkspaces.add(id);
              agentDemands.get(id)?.();
              agentDemands.delete(id);
              appStore.dispatch(hudQuestionsResolvedForWorkspace(id));
              appStore.dispatch(hudWorkspaceStateCleared(id));
            },
            onEvent: (notification) => {
              const event = extractEvent(notification.params);
              if (!event) return;
              const type: string = event.type;
              const data = event.data as { attention?: string; displayStatus?: unknown };
              if (type === 'workspace:attention-changed' && typeof data?.attention === 'string')
                appStore.dispatch(
                  hudAttentionChanged(
                    id,
                    data.attention,
                    event.timestamp ?? new Date().toISOString(),
                  ),
                );
              if (
                type === 'workspace:displayStatus-changed' &&
                isWorkspaceDisplayStatus(data?.displayStatus)
              ) {
                appStore.dispatch(hudDisplayStatusChanged(id, data.displayStatus));
                resolveQuestionsForDisplayStatus(id, data.displayStatus);
              }
            },
          });
          workspaces.set(id, owner);
        }
    };
    reconcileRecoveryWorkspaces = reconcile;
    reconcile();
    const offTransient = scope.onNotification((notification) => {
      if (
        !live() ||
        notification.method !== 'events.event' ||
        !subscriptionId ||
        extractSubscriptionId(notification.params) !== subscriptionId
      )
        return;
      const event = extractEvent(notification.params);
      if (event && !retiredWorkspaces.has(String(event.workspaceId)))
        handleEvent(event, live, scope, false);
    });
    void scope
      .subscribe(
        { eventTypes: [...HUD_SUBSCRIBE_EVENT_TYPES], replaceGroup: HUD_REPLACE_GROUP },
        { recover: true, signal: abort.signal },
      )
      .then((lease) => {
        if (!live()) return;
        subscriptionId = lease?.id;
        refreshStats('usage');
        refreshStats('rates');
        hydrateVisibleWorkspaceAgents(live, scope);
      })
      .catch((error) => logger.warn('HUD recovery subscription failed', { error }));
    return () => {
      abort.abort();
      offTransient();
      stats.dispose();
      if (statsOwner === stats) statsOwner = undefined;
      for (const owner of workspaces.values()) owner.dispose();
      workspaces.clear();
      for (const release of agentDemands.values()) release();
      agentDemands.clear();
      if (subscriptionId) void scope.unsubscribe(subscriptionId);
      subscriptionId = undefined;
      if (recoveryScope === scope) recoveryScope = undefined;
      reconcileRecoveryWorkspaces = () => {};
    };
  });

  if (!adopted) {
    void subscribe();
    refreshStats('usage');
    refreshStats('rates');
    hydrateVisibleWorkspaceAgents(capture());
  }

  // The workspace list hydrates asynchronously (and can grow later) — re-run
  // the once-per-workspace hydration pass whenever the list reference moves.
  // The Set guard makes the pass idempotent (never a re-fetch), and the
  // microtask defers the dispatch out of the store's notification loop.
  let lastWorkspaces = appStore.state.workspace?.workspaces;
  const removeStoreListener = appStore.getReadableState().subscribe((state) => {
    const workspaces = state.workspace?.workspaces;
    if (workspaces === lastWorkspaces) return;
    lastWorkspaces = workspaces;
    reconcileRecoveryWorkspaces();
    for (const workspace of workspaces ? getItems(workspaces) : []) {
      if (typeof workspace.displayStatus === 'string') {
        resolveQuestionsForDisplayStatus(String(workspace.id), workspace.displayStatus);
      }
    }
    queueMicrotask(() => {
      if (!disposed) hydrateVisibleWorkspaceAgents(capture(), recoveryScope);
    });
  });

  // TOK/MIN chart poll — minute buckets only move once a minute, but a short
  // cadence keeps the newest bucket's in-progress accumulation fresh.
  const rateHistoryTimer = setInterval(() => {
    refreshStats('rates');
  }, HUD_RATE_HISTORY_POLL_MS);

  return () => {
    if (disposed) return;
    disposed = true;
    offRecovery();
    clearInterval(rateHistoryTimer);
    removeNotificationListener();
    removeReconnectListener();
    removeStoreListener();
    stopGridFilterPersistence();
    if (subscriptionId) {
      void backendUnsubscribe(subscriptionId).catch(() => {});
      subscriptionId = undefined;
    }
    appStore.dispatch(hudDeactivated());
  };
}
