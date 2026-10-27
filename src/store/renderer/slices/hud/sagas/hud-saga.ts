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
  join,
  put,
  take,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';

import { dockPlacementSaga } from './dock-placement-saga';
import { dockMachineSaga } from './dock-machine-saga';
import { dockRecencySaga } from './dock-recency-saga';
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
  dockActivated,
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
  { kind: 'notification'; notification: BackendNotification } | { kind: 'reconnected' };
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
  lease: HudSubscriptionLease;
  hydratedAgentWorkspaceIds: Set<string>;
  pendingAgentHydrationByWorkspaceId: Map<string, Task>;
  pendingUnknownAgentReadByAgentId: Map<string, Task>;
  lastStatusUpdateTextByWorkspaceId: Map<string, string>;
  delegatedRowEmittedAgentIds: Set<string>;
}

function createHudTransportChannel(): EventChannel<HudTransportMessage> {
  return eventChannel<HudTransportMessage>((emit) => {
    const offNotification = onBackendNotification((notification) => {
      emit({ kind: 'notification', notification });
    });
    const offReconnect = onBackendReconnected(() => emit({ kind: 'reconnected' }));
    return () => {
      offNotification();
      offReconnect();
    };
  }, buffers.expanding<HudTransportMessage>());
}

async function subscribeHudLease(lease: HudSubscriptionLease): Promise<void> {
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
    if (lease.cancelled) {
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

function* loadUsage(): SagaGenerator<void> {
  try {
    const result = yield* call(
      backendRequest<{
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
      hudUsageLoaded({
        totals,
        runs: typeof result.runs === 'number' ? result.runs : 0,
        rateSamples,
        fetchedAtMs: Date.now(),
      }),
    );
  } catch (error) {
    yield* put(hudUsageFailed(error instanceof Error ? error.message : String(error)));
  }
}

function* loadRateHistory(): SagaGenerator<void> {
  try {
    const result = yield* call(
      backendRequest<{ samples?: Array<{ bucketUtc: string } & HudUsageTotals> }>,
      'stats.getRateHistory',
      { limit: HUD_RATE_HISTORY_LIMIT },
    );
    const samples = result?.samples;
    if (!Array.isArray(samples)) {
      throw new Error('stats.getRateHistory result is missing `samples` (PROTOCOL §5.39)');
    }
    const mapped: HudRateHistorySample[] = samples.map((sample) => ({ ...sample }));
    yield* put(hudRateHistoryLoaded({ samples: mapped, fetchedAtMs: Date.now() }));
  } catch (error) {
    yield* put(hudRateHistoryFailed(error instanceof Error ? error.message : String(error)));
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

function* readBusyAgentIds(): SagaGenerator<BusyAgentIdsByWorkspaceId> {
  const byWorkspaceId = new Map<string, Set<string>>();
  try {
    const result = yield* call(backendRequest<AgentListActiveResult>, 'agent.listActive', {});
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
    logger.warn('agent.listActive failed for HUD hydration; top-level rows only', { error });
  }
  return byWorkspaceId;
}

async function readHudAgent(agentId: string, workspaceId: string) {
  try {
    return await appClient.agents.get(agentId, workspaceId);
  } catch (error) {
    logger.debug('agent.get failed for busy/failed HUD agent; skipped', {
      workspaceId,
      agentId,
      error,
    });
    return null;
  }
}

function* hydrateHudWorkspaceAgents(
  workspaceId: string,
  busyTask: Task,
  failedSummaryIds: readonly string[],
): SagaGenerator<void> {
  try {
    const { agents: topLevel } = yield* call(
      { context: appClient.agents, fn: appClient.agents.listWithMeta },
      workspaceId,
      { scope: 'topLevel' as const },
    );
    const busy = (yield* join(busyTask)) as BusyAgentIdsByWorkspaceId;
    const listedIds = new Set(topLevel.map((agent) => String(agent.id)));
    const pointReadIds = [
      ...new Set([...(busy.get(workspaceId) ?? []), ...failedSummaryIds]),
    ].filter((agentId) => !listedIds.has(agentId));
    const pointReadRows = yield* all(
      pointReadIds.map((agentId) => call(readHudAgent, agentId, workspaceId)),
    );
    const listed = [...topLevel, ...pointReadRows.filter((row) => row !== null)];
    const agents = listed
      .filter((agent) => !agent.pendingDeleteAt && !isAgentDeletionPending(String(agent.id)))
      .map((agent) => ({ ...agent, messages: agent.messages ?? [] }));
    yield* put(setAgentsLoaded(workspaceId, true));
    if (agents.length === 0) return;
    yield* put(setAgents(workspaceId, agents));
    yield* put(bulkUpsertSessions(agents, { listProjection: true }));
    for (const agent of agents) yield* put(upsertSession(agent));
  } catch (error) {
    logger.warn('agent hydration failed for HUD workspace', { workspaceId, error });
  }
}

function* hydrateVisibleWorkspaceAgents(runtime: HudRuntime): SagaGenerator<void> {
  const workspaces = yield* selectHudWorkspaceEntities.effect();
  const pending: Array<{ workspaceId: string; failedSummaryIds: string[] }> = [];
  for (const workspace of workspaces) {
    if (
      workspace.status === WorkspaceStatus.Archived ||
      workspace.status === WorkspaceStatus.Deleted
    ) {
      continue;
    }
    const workspaceId = String(workspace.id);
    if (runtime.hydratedAgentWorkspaceIds.has(workspaceId)) continue;
    runtime.hydratedAgentWorkspaceIds.add(workspaceId);
    pending.push({ workspaceId, failedSummaryIds: failedSummaryAgentIds(workspace) });
  }
  if (pending.length === 0) return;

  const busyTask = yield* fork(readBusyAgentIds);
  const tasks: Task[] = [];
  for (const { workspaceId, failedSummaryIds } of pending) {
    yield* put(hydrateAgentsRequested(workspaceId));
    const task: Task = yield* fork(function* hydrateWorkspace() {
      try {
        yield* hydrateHudWorkspaceAgents(workspaceId, busyTask, failedSummaryIds);
      } finally {
        if (runtime.pendingAgentHydrationByWorkspaceId.get(workspaceId) === task) {
          runtime.pendingAgentHydrationByWorkspaceId.delete(workspaceId);
        }
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

function* hydrateUnknownAgent(runtime: HudRuntime, agentId: string): SagaGenerator<void> {
  const existing = runtime.pendingUnknownAgentReadByAgentId.get(agentId);
  if (existing) {
    yield* join(existing);
    return;
  }
  const task: Task = yield* fork(function* readUnknownAgent() {
    try {
      const agent = yield* call([appClient.agents, appClient.agents.get], agentId);
      if (!agent || agent.pendingDeleteAt || isAgentDeletionPending(agentId)) return;
      const session = { ...agent, messages: agent.messages ?? [] };
      yield* put(bulkUpsertSessions([session], { listProjection: true }));
      yield* put(upsertSession(session));
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
  const workspaceId = typeof event.workspaceId === 'string' ? event.workspaceId : '';
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  const type = event.type as string;
  if (type === 'agent:stream:end') {
    for (const question of extractQuestionsFromStreamEnd(event)) {
      yield* put(hudQuestionCaptured(question));
    }
  }
  if (type === 'workspace:attention-changed') {
    const attention = data.attention;
    if (workspaceId && typeof attention === 'string') {
      const raisedAtTs =
        typeof event.timestamp === 'string' && event.timestamp.length > 0
          ? event.timestamp
          : new Date().toISOString();
      yield* put(hudAttentionChanged(workspaceId, attention, raisedAtTs));
    }
  } else if (type === 'workspace:displayStatus-changed') {
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
      yield* hydrateUnknownAgent(runtime, agentId);
    }
  }
  yield* emitTakeoverForEvent(runtime, event);
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
  if (kind === 'subscribe') yield* call(subscribeHudLease, runtime.lease);
  else if (kind === 'usage') yield* loadUsage();
  else if (kind === 'rate-history') yield* loadRateHistory();
  else yield* hydrateVisibleWorkspaceAgents(runtime);
}

function* pollRateHistory(refreshes: Channel<HudRefreshKind>): SagaGenerator<never> {
  while (true) {
    yield* delay(HUD_RATE_HISTORY_POLL_MS);
    yield* put(refreshes, 'rate-history');
  }
}

function* watchWorkspaceChanges(refreshes: Channel<HudRefreshKind>): SagaGenerator<never> {
  const changes = yield* actionChannel(HUD_WORKSPACE_CHANGE_ACTIONS, buffers.sliding(1));
  try {
    while (true) {
      yield* take(changes);
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
  const transport = createHudTransportChannel();
  const refreshes = sagaChannel<HudRefreshKind>();
  const runtime: HudRuntime = {
    lease: { cancelled: false },
    hydratedAgentWorkspaceIds: new Set(),
    pendingAgentHydrationByWorkspaceId: new Map(),
    pendingUnknownAgentReadByAgentId: new Map(),
    lastStatusUpdateTextByWorkspaceId: new Map(),
    delegatedRowEmittedAgentIds: new Set(),
  };
  const refreshTask = yield* takeSingleFlightInContext(
    refreshes,
    (kind) => kind,
    refreshHudData,
    runtime,
  );
  const pollTask = yield* fork(pollRateHistory, refreshes);
  const workspaceTask = yield* fork(watchWorkspaceChanges, refreshes);
  const persistenceTask = yield* fork(hudGridFilterPersistenceSaga);

  try {
    yield* put(refreshes, 'subscribe');
    yield* put(refreshes, 'usage');
    yield* put(refreshes, 'rate-history');
    yield* put(refreshes, 'agents');

    while (true) {
      const message: HudTransportMessage = yield* take(transport);
      if (message === (END as unknown as HudTransportMessage)) return;
      if (message.kind === 'reconnected') {
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
      if (envelopeId !== undefined && envelopeId !== runtime.lease.subscriptionId) continue;
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

function* hudRouteLifetime(): SagaGenerator<void> {
  const lifetime = yield* fork(hudActiveLifetime);
  try {
    yield* take(hudDeactivated);
  } finally {
    yield* cancel(lifetime);
  }
}

function* dockRouteLifetime(): SagaGenerator<void> {
  const placement = yield* fork(dockPlacementSaga);
  const machine = yield* fork(dockMachineSaga);
  const recency = yield* fork(dockRecencySaga);
  try {
    yield* call(hudRouteLifetime);
  } finally {
    yield* cancel(recency);
    yield* cancel(placement);
    yield* cancel(machine);
  }
}

/** Each route activation has one owner; teardown cancels its attached work. */
export function* hudSaga(): SagaGenerator<void> {
  yield* all([
    takeLeading(hudActivated, hudRouteLifetime),
    takeLeading(dockActivated, dockRouteLifetime),
  ]);
}
