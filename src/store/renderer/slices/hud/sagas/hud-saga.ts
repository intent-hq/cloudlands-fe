import { installHudRecovery, type HudRecoveryMessage } from '$features/hud/hud-recovery';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { captureRuntimeReadAuthority } from '$features/events/runtime-read-authority';
import { runtimeReadDrained, trackRuntimeRead } from '$features/events/runtime-read-lane';
import { trackAgentMetadataRead } from '$features/agent/agent-metadata-recovery';
import { getPhysicalRequestCompletion } from '$shared/event-recovery/session';
import { withRecoveryLifetime } from '$store/renderer/middlewares/event-recovery';
import { normalizeAgent } from '$lib/client/live/live-agents-client';
import type { StoreState } from '$store/renderer/types';
import {
  END,
  buffers,
  channel as sagaChannel,
  eventChannel,
  type Channel,
  type EventChannel,
  type Task,
} from 'redux-saga';
import {
  actionChannel,
  all,
  call,
  cancel,
  delay,
  fork,
  getContext,
  join,
  put,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';

import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { getLocalStorageJSON, setLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import { appClient } from '$lib/client';
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
  type BackendNotification,
} from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import type { WorkspaceEvent } from '$features/events/types';
import {
  HUD_AGENT_DELEGATED_FEED_KIND,
  HUD_FEED_EVENT_TYPES,
  mapEventToFeedEntry,
} from '$features/hud/hud-feed-mapper';
import { extractQuestionsFromStreamEnd } from '$features/hud/hud-question-capture';
import { emitTakeoverTrigger } from '$features/hud/takeover/hud-takeover-bus';
import type { HudTakeoverTrigger } from '$features/hud/takeover/hud-takeover-queue';
import {
  HUD_TAKEOVER_EVENT_TYPES,
  mapEventToTakeoverTrigger,
} from '$features/hud/takeover/hud-takeover-triggers';
import { isWorkspaceDisplayStatus, WorkspaceStatus, type Workspace } from '$shared/types';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { bulkUpsertSessions, upsertSession } from '../../agent-session/agent-session-slice';
import { selectConnectionsLoaded } from '../../connections/connections-selectors';
import { connectionsListReceived } from '../../connections/connections-slice';
import { workspaceDeleted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  beginWorkspaceTitleMutation,
  bulkUpdateWorkspaceEntities,
  completeWorkspaceTitleMutation,
  failWorkspaceTitleMutation,
  removeWorkspaceEntity,
  replaceWorkspaceList,
  resetWorkspaceState,
  setWorkspaceEntity,
} from '../../workspace/workspace-slice';
import {
  hydrateAgentsRequested,
  setAgents,
  setAgentsLoaded,
} from '../../workspace-agents/workspace-agents-slice';
import { selectHudGridFilter, selectHudWorkspaceEntities } from '../hud-selectors';
import {
  hudActivated,
  hudAttentionChanged,
  hudDeactivated,
  hudDisplayStatusChanged,
  hudFeedEntryReceived,
  hudGridFilterHydrated,
  hudGridFilterRepoPicked,
  hudGridFilterStateToggled,
  hudGridFilterStatesCleared,
  hudQuestionCaptured,
  hudQuestionsResolvedForWorkspace,
  hudRateHistoryFailed,
  hudRateHistoryLoaded,
  hudUsageFailed,
  hudUsageLoaded,
  type HudFeedEntry,
  type HudRateHistorySample,
  type HudRateSample,
  type HudUsageTotals,
} from '../hud-slice';
import {
  EMPTY_HUD_GRID_FILTER,
  HUD_CARD_STATE_KEYS,
  toHudAgentStateBucket,
  type HudCardStateKey,
  type HudGridFilter,
} from '../hud-types';

const logger = createLogger('HudSaga');

/** §6.1 replaceGroup key — one HUD subscription per connection, ever. */
export const HUD_REPLACE_GROUP = 'hud-feed';

/** Feed families plus takeover-only families required by the HUD lifetime. */
export const HUD_SUBSCRIBE_EVENT_TYPES = [
  ...new Set<string>([...HUD_FEED_EVENT_TYPES, ...HUD_TAKEOVER_EVENT_TYPES]),
];

export const HUD_RATE_HISTORY_POLL_MS = 15_000;
export const HUD_RATE_HISTORY_LIMIT = 40;
export const HUD_FAILED_SUMMARY_ROW_READ_CAP = 8;
export const HUD_GRID_FILTER_STORAGE_KEY = 'hudGridFilter';

const QUESTION_HOLD_DISPLAY_STATUSES = new Set(['failed', 'blocked', 'needs_attention']);
const HUD_WORKSPACE_CHANGE_ACTIONS = [
  replaceWorkspaceList,
  setWorkspaceEntity,
  bulkUpdateWorkspaceEntities,
  beginWorkspaceTitleMutation,
  completeWorkspaceTitleMutation,
  failWorkspaceTitleMutation,
  removeWorkspaceEntity,
  workspaceDeleted,
  resetWorkspaceState,
];
const HUD_GRID_FILTER_CHANGE_ACTIONS = [
  hudGridFilterRepoPicked,
  hudGridFilterStateToggled,
  hudGridFilterStatesCleared,
];

type HudTransportMessage =
  | HudRecoveryMessage
  | { kind: 'notification'; notification: BackendNotification; isCurrent?: () => boolean }
  | { kind: 'reconnected' };
type HudRefreshKind = 'subscribe' | 'usage' | 'rate-history' | 'agents';
type BusyAgentIdsByWorkspaceId = ReadonlyMap<string, ReadonlySet<string>>;

interface AgentListActiveResult {
  streams?: Array<{ agentId?: string; workspaceId?: string }>;
}

interface HudSubscriptionLease {
  subscriptionId?: string;
  cancelled: boolean;
}

interface HudRuntime {
  recovery: ReturnType<typeof installHudRecovery>;
  refreshes: Channel<HudRefreshKind>;
  pendingStats: Set<HudRefreshKind>;
  queuedStats: Set<HudRefreshKind>;
  lease: HudSubscriptionLease;
  hydratedAgentWorkspaceIds: Set<string>;
  pendingAgentHydrationByWorkspaceId: Map<string, Task>;
  pendingUnknownAgentReadByAgentId: Map<string, Task>;
  lastStatusUpdateTextByWorkspaceId: Map<string, string>;
  delegatedRowEmittedAgentIds: Set<string>;
}

function createHudTransportChannel(
  runtime: HudRuntime,
  store: { getState(): StoreState; dispatch(action: { type: string }): unknown },
): EventChannel<HudTransportMessage> {
  return eventChannel<HudTransportMessage>((emit) => {
    runtime.recovery = installHudRecovery(
      store,
      {
        eventTypes: HUD_SUBSCRIBE_EVENT_TYPES,
        replaceGroup: HUD_REPLACE_GROUP,
        rateLimit: HUD_RATE_HISTORY_LIMIT,
      },
      emit,
    );
    const offNotification = onBackendNotification((notification) => {
      if (!runtime.recovery.adopted)
        emit({ kind: 'notification', notification, isCurrent: runtime.recovery.capture() });
    });
    const offReconnect = onBackendReconnected(() => {
      if (!runtime.recovery.adopted) emit({ kind: 'reconnected' });
    });
    return () => {
      runtime.recovery.dispose();
      offNotification();
      offReconnect();
    };
  }, buffers.expanding<HudTransportMessage>());
}

async function subscribeHudLease(runtime: HudRuntime): Promise<void> {
  if (runtime.recovery.adopted) return;
  const lease = runtime.lease;
  const live = runtime.recovery.capture();
  lease.subscriptionId = undefined;
  try {
    const result = await backendSubscribe<{ subscriptionId?: string }>({
      eventTypes: [...HUD_SUBSCRIBE_EVENT_TYPES],
      replaceGroup: HUD_REPLACE_GROUP,
    });
    const subscriptionId = result?.subscriptionId;
    if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
      logger.warn('events.subscribe returned no subscriptionId', result);
      return;
    }
    if (lease.cancelled || !live()) {
      await backendUnsubscribe(subscriptionId).catch(() => {});
      return;
    }
    lease.subscriptionId = subscriptionId;
  } catch (error) {
    logger.error('HUD events.subscribe failed', error);
  }
}

async function unsubscribeHudLease(lease: HudSubscriptionLease): Promise<void> {
  lease.cancelled = true;
  const subscriptionId = lease.subscriptionId;
  lease.subscriptionId = undefined;
  if (!subscriptionId) return;
  await backendUnsubscribe(subscriptionId).catch(() => {});
}

function sumTotals(totals: HudUsageTotals): number {
  return (
    totals.inputTokens +
    totals.outputTokens +
    totals.cacheReadTokens +
    totals.cacheCreationTokens +
    (totals.thoughtTokens ?? 0)
  );
}

function* loadUsage(runtime: HudRuntime): SagaGenerator<void> {
  const token = rendererEventRecovery.capture('hud-stats');
  const live = runtime.recovery.capture();
  const scope = runtime.recovery.scope;
  const request: typeof backendRequest = (method, params) =>
    trackRuntimeRead('hud-stats', () => {
      if (!live() || !token.commit(() => {})) throw new Error('HUD read superseded');
      return (scope?.request ?? backendRequest)(method, params);
    });
  try {
    const result = yield* call(
      request<{
        totals?: HudUsageTotals;
        runs?: number;
        byHourOfDay?: Array<{ hour: number } & HudUsageTotals>;
      }>,
      'stats.getUsage',
      {
        period: '24h',
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      },
    );
    if (!live()) return;
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
    yield* put(
      withRecoveryLifetime(
        hudUsageLoaded({
          totals,
          runs: typeof result.runs === 'number' ? result.runs : 0,
          rateSamples,
          fetchedAtMs: Date.now(),
        }),
        token,
      ),
    );
  } catch (error) {
    if (live())
      yield* put(
        withRecoveryLifetime(
          hudUsageFailed(error instanceof Error ? error.message : String(error)),
          token,
        ),
      );
  }
}

function* loadRateHistory(runtime: HudRuntime): SagaGenerator<void> {
  const token = rendererEventRecovery.capture('hud-stats');
  const live = runtime.recovery.capture();
  const scope = runtime.recovery.scope;
  const request: typeof backendRequest = (method, params) =>
    trackRuntimeRead('hud-stats', () => {
      if (!live() || !token.commit(() => {})) throw new Error('HUD read superseded');
      return (scope?.request ?? backendRequest)(method, params);
    });
  try {
    const result = yield* call(
      request<{ samples?: Array<{ bucketUtc: string } & HudUsageTotals> }>,
      'stats.getRateHistory',
      { limit: HUD_RATE_HISTORY_LIMIT },
    );
    if (!live()) return;
    const samples = result?.samples;
    if (!Array.isArray(samples)) {
      throw new Error('stats.getRateHistory result is missing `samples` (PROTOCOL §5.39)');
    }
    const mapped: HudRateHistorySample[] = samples.map((sample) => ({ ...sample }));
    yield* put(
      withRecoveryLifetime(
        hudRateHistoryLoaded({ samples: mapped, fetchedAtMs: Date.now() }),
        token,
      ),
    );
  } catch (error) {
    if (live())
      yield* put(
        withRecoveryLifetime(
          hudRateHistoryFailed(error instanceof Error ? error.message : String(error)),
          token,
        ),
      );
  }
}

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

async function readBusyAgentIds(
  runtime: HudRuntime,
  authorities: ReturnType<typeof captureRuntimeReadAuthority>[],
): Promise<BusyAgentIdsByWorkspaceId> {
  const byWorkspaceId = new Map<string, Set<string>>();
  try {
    const result = await (runtime.recovery.scope?.request ?? backendRequest)<AgentListActiveResult>(
      'agent.listActive',
      {},
    );
    for (const stream of result?.streams ?? []) {
      if (typeof stream.agentId !== 'string' || typeof stream.workspaceId !== 'string') continue;
      const ids = byWorkspaceId.get(stream.workspaceId) ?? new Set<string>();
      ids.add(stream.agentId);
      byWorkspaceId.set(stream.workspaceId, ids);
    }
  } catch (error) {
    authorities.forEach((owner) => owner.failed(error));
    const outcome = await getPhysicalRequestCompletion(error);
    if (outcome) authorities.forEach((owner) => owner.completed(outcome));
    logger.warn('agent.listActive failed for HUD hydration; top-level rows only', { error });
  }
  return byWorkspaceId;
}

async function readHudAgent(runtime: HudRuntime, agentId: string, workspaceId: string) {
  const scope = runtime.recovery.scope;
  if (!scope) return appClient.agents.get(agentId, workspaceId || undefined);
  const result = await scope.request<{ agent?: unknown } | unknown>('agent.get', {
    agentId,
    ...(workspaceId ? { workspaceId } : {}),
  });
  const raw = result && typeof result === 'object' && 'agent' in result ? result.agent : result;
  return raw && typeof raw === 'object' ? normalizeAgent(raw as Record<string, unknown>) : null;
}

function* hydrateHudWorkspaceAgents(
  runtime: HudRuntime,
  workspaceId: string,
  readBusy: () => Promise<BusyAgentIdsByWorkspaceId>,
  failedSummaryIds: readonly string[],
  enter: () => Promise<void>,
): SagaGenerator<void> {
  const key = 'agents:' + JSON.stringify([workspaceId]);
  const token = rendererEventRecovery.capture(key),
    live = runtime.recovery.capture();
  const authority = captureRuntimeReadAuthority(key),
    listAuthority = captureRuntimeReadAuthority(key, true);
  const scope = runtime.recovery.scope;
  try {
    const agents = yield* call(() =>
      trackAgentMetadataRead(workspaceId, async () => {
        const physical: Promise<void>[] = [];
        const tracked = <T>(read: Promise<T>, observer = authority): Promise<T> => {
          const observed = read.catch((error: unknown) => {
            observer.failed(error);
            throw error;
          });
          physical.push(runtimeReadDrained(observed, observer.completed));
          return observed;
        };
        try {
          await enter();
          if (!live() || !token.commit(() => {})) return [];
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
            listAuthority,
          );
          const [{ agents: topLevel }, busyByWorkspace] = await Promise.all([list, busy]);
          if (!live() || !token.commit(() => {})) return [];
          const listedIds = new Set(topLevel.map((agent) => String(agent.id)));
          const ids = [
            ...new Set([...(busyByWorkspace.get(workspaceId) ?? []), ...failedSummaryIds]),
          ].filter((id) => !listedIds.has(id));
          const points = await Promise.all(
            ids.map(async (id) => {
              if (!live() || !token.commit(() => {})) return null;
              try {
                return await tracked(readHudAgent(runtime, id, workspaceId));
              } catch (error) {
                logger.debug('HUD point read failed', { workspaceId, id, error });
                return null;
              }
            }),
          );
          return [...topLevel, ...points.filter((row) => row !== null)]
            .filter((agent) => !agent.pendingDeleteAt && !isAgentDeletionPending(String(agent.id)))
            .map((agent) => ({ ...agent, messages: agent.messages ?? [] }));
        } finally {
          await Promise.all(physical);
        }
      }),
    );
    if (!live()) return;
    yield* put(withRecoveryLifetime(setAgentsLoaded(workspaceId, true), token));
    if (!agents.length) return;
    yield* put(withRecoveryLifetime(setAgents(workspaceId, agents), token));
    yield* put(withRecoveryLifetime(bulkUpsertSessions(agents, { listProjection: true }), token));
    for (const agent of agents) yield* put(withRecoveryLifetime(upsertSession(agent), token));
  } catch (error) {
    logger.warn('agent hydration failed for HUD workspace', { workspaceId, error });
  }
}

function* hydrateVisibleWorkspaceAgents(runtime: HudRuntime): SagaGenerator<void> {
  runtime.recovery.reconcile();
  const workspaces = yield* selectHudWorkspaceEntities.effect();
  const pending: Array<{ workspaceId: string; failedSummaryIds: string[] }> = [];
  for (const workspace of workspaces) {
    if (
      workspace.status === WorkspaceStatus.Archived ||
      workspace.status === WorkspaceStatus.Deleted
    )
      continue;
    const workspaceId = String(workspace.id);
    if (runtime.hydratedAgentWorkspaceIds.has(workspaceId)) continue;
    runtime.hydratedAgentWorkspaceIds.add(workspaceId);
    pending.push({ workspaceId, failedSummaryIds: failedSummaryAgentIds(workspace) });
  }
  if (!pending.length) return;
  const authorities = pending.map(({ workspaceId }) =>
    captureRuntimeReadAuthority('agents:' + JSON.stringify([workspaceId])),
  );
  let busy: Promise<BusyAgentIdsByWorkspaceId> | undefined;
  const readBusy = () => (busy ??= readBusyAgentIds(runtime, authorities));
  let admitted = 0,
    start!: () => void;
  const ready = new Promise<void>((resolve) => {
    start = resolve;
  });
  const enter = () => {
    if (++admitted === pending.length) start();
    return ready;
  };
  const tasks: Task[] = [];
  for (const { workspaceId, failedSummaryIds } of pending) {
    yield* put(hydrateAgentsRequested(workspaceId));
    const task: Task = yield* fork(function* () {
      try {
        yield* hydrateHudWorkspaceAgents(runtime, workspaceId, readBusy, failedSummaryIds, enter);
      } finally {
        if (runtime.pendingAgentHydrationByWorkspaceId.get(workspaceId) === task)
          runtime.pendingAgentHydrationByWorkspaceId.delete(workspaceId);
      }
    });
    runtime.pendingAgentHydrationByWorkspaceId.set(workspaceId, task);
    tasks.push(task);
  }
  yield* all(tasks.map((task) => join(task)));
}

function withFirstStartRewrite(runtime: HudRuntime, entry: HudFeedEntry): HudFeedEntry {
  if (entry.kind !== 'agent:status-changed' || !entry.agentId) return entry;
  if (toHudAgentStateBucket(entry.agentStatus ?? '') !== 'running') return entry;
  if (runtime.delegatedRowEmittedAgentIds.has(entry.agentId)) return entry;
  runtime.delegatedRowEmittedAgentIds.add(entry.agentId);
  return { ...entry, kind: HUD_AGENT_DELEGATED_FEED_KIND };
}

function isDuplicateStatusUpdate(runtime: HudRuntime, trigger: HudTakeoverTrigger): boolean {
  if (trigger.kind !== 'status_update') return false;
  const previous = runtime.lastStatusUpdateTextByWorkspaceId.get(trigger.workspaceId);
  runtime.lastStatusUpdateTextByWorkspaceId.set(trigger.workspaceId, trigger.detail);
  return previous === trigger.detail;
}

function* resolveQuestionsForDisplayStatus(
  workspaceId: string,
  displayStatus: string,
): SagaGenerator<void> {
  if (!QUESTION_HOLD_DISPLAY_STATUSES.has(displayStatus)) {
    yield* put(hudQuestionsResolvedForWorkspace(workspaceId));
  }
}

function resolveAgentDisplayName(
  agentId: string,
  session: { id?: unknown; name?: unknown } | undefined,
  workspaces: readonly Workspace[],
): string | undefined {
  if (session?.id === agentId && typeof session.name === 'string' && session.name.length > 0) {
    return session.name;
  }
  for (const workspace of workspaces) {
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

function* hydrateUnknownAgent(
  runtime: HudRuntime,
  agentId: string,
  workspaceId: string,
): SagaGenerator<void> {
  const existing = runtime.pendingUnknownAgentReadByAgentId.get(agentId);
  if (existing) {
    yield* join(existing);
    return;
  }
  const token = rendererEventRecovery.capture('agents:' + JSON.stringify([workspaceId]));
  const live = runtime.recovery.capture();
  const task: Task = yield* fork(function* readUnknownAgent() {
    try {
      const agent = yield* call(() =>
        trackAgentMetadataRead(workspaceId, () => {
          if (!live() || !token.commit(() => {})) return Promise.resolve(null);
          return readHudAgent(runtime, agentId, workspaceId);
        }),
      );
      if (!live() || !agent || agent.pendingDeleteAt || isAgentDeletionPending(agentId)) return;
      const session = { ...agent, messages: agent.messages ?? [] };
      yield* put(
        withRecoveryLifetime(bulkUpsertSessions([session], { listProjection: true }), token),
      );
      yield* put(withRecoveryLifetime(upsertSession(session), token));
    } catch (error) {
      logger.debug('agent.get failed for unknown HUD agent; gated as unmuted', {
        agentId,
        error,
      });
    } finally {
      if (runtime.pendingUnknownAgentReadByAgentId.get(agentId) === task) {
        runtime.pendingUnknownAgentReadByAgentId.delete(agentId);
      }
    }
  });
  runtime.pendingUnknownAgentReadByAgentId.set(agentId, task);
  yield* join(task);
}

function* emitTakeoverForEvent(runtime: HudRuntime, event: WorkspaceEvent): SagaGenerator<void> {
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  const agentId = typeof data.agentId === 'string' ? data.agentId : undefined;
  const session = agentId ? yield* selectAgentSession.effect(agentId) : undefined;
  const workspaces = yield* selectHudWorkspaceEntities.effect();
  const trigger = mapEventToTakeoverTrigger(
    event,
    (id) => resolveAgentDisplayName(id, session, workspaces),
    (id) => id === agentId && session?.notificationsMuted === true,
  );
  if (trigger && !isDuplicateStatusUpdate(runtime, trigger)) {
    yield* call(emitTakeoverTrigger, trigger);
  }
}

function* handleEvent(runtime: HudRuntime, event: WorkspaceEvent): SagaGenerator<void> {
  const live = runtime.recovery.capture();
  const project = !runtime.recovery.adopted;
  const workspaceId = typeof event.workspaceId === 'string' ? event.workspaceId : '';
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  const type = event.type as string;
  if (type === 'agent:stream:end') {
    for (const question of extractQuestionsFromStreamEnd(event)) {
      yield* put(hudQuestionCaptured(question));
    }
  }
  if (project && type === 'workspace:attention-changed') {
    const attention = data.attention;
    if (workspaceId && typeof attention === 'string') {
      const raisedAtTs =
        typeof event.timestamp === 'string' && event.timestamp.length > 0
          ? event.timestamp
          : new Date().toISOString();
      yield* put(hudAttentionChanged(workspaceId, attention, raisedAtTs));
    }
  } else if (project && type === 'workspace:displayStatus-changed') {
    const displayStatus = data.displayStatus;
    if (workspaceId && isWorkspaceDisplayStatus(displayStatus)) {
      yield* put(hudDisplayStatusChanged(workspaceId, displayStatus));
      yield* resolveQuestionsForDisplayStatus(workspaceId, displayStatus);
    }
  }

  const entry = mapEventToFeedEntry(event);
  if (entry) yield* put(hudFeedEntryReceived(withFirstStartRewrite(runtime, entry)));

  const agentId = typeof data.agentId === 'string' ? data.agentId : undefined;
  if (
    agentId &&
    HUD_TAKEOVER_EVENT_TYPES.includes(type) &&
    (yield* selectAgentSession.effect(agentId)) === undefined &&
    mapEventToTakeoverTrigger(event, undefined, () => false) !== null
  ) {
    const pendingHydration = workspaceId
      ? runtime.pendingAgentHydrationByWorkspaceId.get(workspaceId)
      : undefined;
    if (pendingHydration) yield* join(pendingHydration);
    if ((yield* selectAgentSession.effect(agentId)) === undefined) {
      yield* hydrateUnknownAgent(runtime, agentId, workspaceId);
    }
  }
  if (live()) yield* emitTakeoverForEvent(runtime, event);
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

export function sanitizePersistedHudGridFilter(value: unknown): HudGridFilter {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_HUD_GRID_FILTER;
  }
  const { repo, states } = value as { repo?: unknown; states?: unknown };
  if ((repo !== null && typeof repo !== 'string') || !Array.isArray(states)) {
    return EMPTY_HUD_GRID_FILTER;
  }
  const known = states.filter((key): key is HudCardStateKey =>
    (HUD_CARD_STATE_KEYS as readonly string[]).includes(key as string),
  );
  return {
    repo: typeof repo === 'string' && repo.length > 0 ? repo : null,
    states: [...new Set(known)],
  };
}

function* hudGridFilterPersistenceSaga(): SagaGenerator<void> {
  if (!(yield* selectConnectionsLoaded.effect())) {
    yield* take(connectionsListReceived);
  }
  const backendId = yield* selectActiveBackendId();
  const storageKey = namespaceBackendKey(HUD_GRID_FILTER_STORAGE_KEY, backendId);
  const persisted = yield* call(getLocalStorageJSON<unknown>, storageKey);
  yield* put(hudGridFilterHydrated(sanitizePersistedHudGridFilter(persisted)));

  while (true) {
    yield* take(HUD_GRID_FILTER_CHANGE_ACTIONS);
    if ((yield* selectActiveBackendId()) !== backendId) continue;
    const filter = yield* selectHudGridFilter.effect();
    yield* call(setLocalStorageJSON, storageKey, filter);
  }
}

function* refreshHudData(runtime: HudRuntime, kind: HudRefreshKind): SagaGenerator<void> {
  if (kind === 'subscribe') {
    yield* call(subscribeHudLease, runtime);
    return;
  }
  if (kind === 'agents') {
    yield* hydrateVisibleWorkspaceAgents(runtime);
    return;
  }
  if (runtime.recovery.statsStale) return;
  runtime.pendingStats.add(kind);
  try {
    if (kind === 'usage') yield* loadUsage(runtime);
    else yield* loadRateHistory(runtime);
  } finally {
    runtime.pendingStats.delete(kind);
    if (runtime.queuedStats.delete(kind)) runtime.refreshes.put(kind);
  }
}

function* pollRateHistory(refreshes: Channel<HudRefreshKind>): SagaGenerator<never> {
  while (true) {
    yield* delay(HUD_RATE_HISTORY_POLL_MS);
    yield* put(refreshes, 'rate-history');
  }
}

function* watchWorkspaceChanges(
  runtime: HudRuntime,
  refreshes: Channel<HudRefreshKind>,
): SagaGenerator<never> {
  const changes = yield* actionChannel(HUD_WORKSPACE_CHANGE_ACTIONS, buffers.sliding(1));
  try {
    while (true) {
      yield* take(changes);
      runtime.recovery.reconcile();
      const workspaces = yield* selectHudWorkspaceEntities.effect();
      for (const workspace of workspaces) {
        if (typeof workspace.displayStatus === 'string') {
          yield* resolveQuestionsForDisplayStatus(String(workspace.id), workspace.displayStatus);
        }
      }
      yield* put(refreshes, 'agents');
    }
  } finally {
    changes.close();
  }
}

function* hudActiveLifetime(): SagaGenerator<void> {
  const reduxStore = yield* getContext<{
    getState(): StoreState;
    dispatch(action: { type: string }): unknown;
  }>('reduxStore');
  const refreshes = sagaChannel<HudRefreshKind>();
  const runtime: HudRuntime = {
    recovery: undefined as unknown as ReturnType<typeof installHudRecovery>,
    refreshes,
    pendingStats: new Set(),
    queuedStats: new Set(),
    lease: { cancelled: false },
    hydratedAgentWorkspaceIds: new Set(),
    pendingAgentHydrationByWorkspaceId: new Map(),
    pendingUnknownAgentReadByAgentId: new Map(),
    lastStatusUpdateTextByWorkspaceId: new Map(),
    delegatedRowEmittedAgentIds: new Set(),
  };
  const transport = createHudTransportChannel(runtime, reduxStore);
  let refreshTask = yield* takeSingleFlightInContext(
    refreshes,
    (kind) => kind,
    refreshHudData,
    runtime,
  );
  const pollTask = yield* fork(pollRateHistory, refreshes);
  const workspaceTask = yield* fork(watchWorkspaceChanges, runtime, refreshes);
  const persistenceTask = yield* fork(hudGridFilterPersistenceSaga);

  try {
    if (!runtime.recovery.adopted) {
      yield* put(refreshes, 'subscribe');
      yield* put(refreshes, 'usage');
      yield* put(refreshes, 'rate-history');
      yield* put(refreshes, 'agents');
    }

    while (true) {
      const message: HudTransportMessage = yield* take(transport);
      if (message === (END as unknown as HudTransportMessage)) return;
      if ('isCurrent' in message && message.isCurrent && !message.isCurrent()) continue;
      if (message.kind === 'refresh-stats') {
        for (const kind of runtime.pendingStats) runtime.queuedStats.add(kind);
        continue;
      }
      if (message.kind === 'session') {
        // Cancel scheduling from the previous authority. Its physical reads remain
        // accounted for by their lanes, while a new transport can read independently.
        yield* cancel(refreshTask);
        runtime.pendingStats.clear();
        runtime.queuedStats.clear();
        refreshTask = yield* takeSingleFlightInContext(
          refreshes,
          (kind) => kind,
          refreshHudData,
          runtime,
        );
        if (runtime.lease.subscriptionId)
          void backendUnsubscribe(runtime.lease.subscriptionId).catch(() => {});
        runtime.lease.subscriptionId = undefined;
        runtime.hydratedAgentWorkspaceIds.clear();
        runtime.pendingAgentHydrationByWorkspaceId.clear();
        runtime.pendingUnknownAgentReadByAgentId.clear();
        yield* put(refreshes, 'usage');
        yield* put(refreshes, 'rate-history');
        yield* put(refreshes, 'agents');
        continue;
      }
      if (message.kind === 'reconnected') {
        runtime.recovery.reconnect();
        runtime.lease.subscriptionId = undefined;
        runtime.hydratedAgentWorkspaceIds.clear();
        yield* put(refreshes, 'subscribe');
        yield* put(refreshes, 'usage');
        yield* put(refreshes, 'rate-history');
        yield* put(refreshes, 'agents');
        continue;
      }
      if (message.notification.method !== 'events.event') continue;
      const envelopeId = extractSubscriptionId(message.notification.params);
      if (
        !runtime.recovery.adopted &&
        envelopeId !== undefined &&
        envelopeId !== runtime.lease.subscriptionId
      )
        continue;
      const event = extractEvent(message.notification.params);
      if (event) yield* fork(handleEvent, runtime, event);
    }
  } finally {
    transport.close();
    yield* cancel(refreshTask);
    yield* cancel(pollTask);
    yield* cancel(workspaceTask);
    yield* cancel(persistenceTask);
    refreshes.close();
    yield* call(unsubscribeHudLease, runtime.lease);
  }
}

/** Root-owned HUD lifetime. The route only dispatches activation intent. */
export function* hudSaga(): SagaGenerator<never> {
  while (true) {
    yield* take(hudActivated);
    const lifetime = yield* fork(hudActiveLifetime);
    yield* take(hudDeactivated);
    yield* cancel(lifetime);
  }
}
