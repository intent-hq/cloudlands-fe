import { END, buffers, channel, eventChannel, type Channel, type EventChannel } from 'redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  actionChannel,
  call,
  delay,
  fork,
  put,
  race,
  take,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';

import type { WorkspaceEvent } from '$features/events/types';
import {
  HUD_AGENT_DELEGATED_FEED_KIND,
  HUD_FEED_EVENT_TYPES,
  mapEventToFeedEntry,
} from '$features/hud/hud-feed-mapper';
import {
  HUD_GRID_FILTER_STORAGE_KEY,
  sanitizePersistedHudGridFilter,
} from '$features/hud/hud-grid-filter-persistence';
import { extractQuestionsFromStreamEnd } from '$features/hud/hud-question-capture';
import { emitTakeoverTrigger } from '$features/hud/takeover/hud-takeover-bus';
import type { HudTakeoverTrigger } from '$features/hud/takeover/hud-takeover-queue';
import {
  HUD_TAKEOVER_EVENT_TYPES,
  mapEventToTakeoverTrigger,
} from '$features/hud/takeover/hud-takeover-triggers';
import type { BackendNotification } from '$lib/client/live/backend-transport';
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { isWorkspaceDisplayStatus, WorkspaceStatus } from '$shared/types';
import { takeEveryFromListenSync } from '../../../utils/ipc-channel';
import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import { getLocalStorageJSON, setLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import { hydrateAgentsRequested } from '../../workspace-agents/workspace-agents-slice';
import {
  hudActivated,
  hudAttentionChanged,
  hudDeactivated,
  hudDisplayStatusChanged,
  hudFeedEntryReceived,
  hudFullScreenChanged,
  hudFullScreenRequested,
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
  selectHudAgentDisplayName,
  selectHudConnectionsReady,
  selectHudGridFilter,
  selectHudWorkspaceCollection,
} from '../hud-selectors';
import { toHudAgentStateBucket } from '../hud-types';

const logger = createLogger('HudSaga');
export const HUD_REPLACE_GROUP = 'hud-feed';
export const HUD_SUBSCRIBE_EVENT_TYPES = [
  ...new Set<string>([...HUD_FEED_EVENT_TYPES, ...HUD_TAKEOVER_EVENT_TYPES]),
];
export const HUD_RATE_HISTORY_POLL_MS = 15_000;
export const HUD_RATE_HISTORY_LIMIT = 40;
const QUESTION_HOLD_DISPLAY_STATUSES = new Set(['failed', 'blocked', 'needs_attention']);

type HudChannelMessage =
  { kind: 'notification'; notification: BackendNotification } | { kind: 'reconnected' };
type RefreshSignal = true;
type SubscriptionLease = { subscriptionId?: string; cancelled: boolean };
type FullScreenResult = { success: boolean; fullScreen: boolean };

async function getFullScreen(): Promise<FullScreenResult> {
  return invoke<FullScreenResult>(IPC_CHANNELS.WINDOW.GET_FULL_SCREEN, {});
}

async function setFullScreen(fullScreen: boolean): Promise<FullScreenResult> {
  return invoke<FullScreenResult>(IPC_CHANNELS.WINDOW.SET_FULL_SCREEN, { fullScreen });
}

function* syncFullScreenState(): SagaGenerator<void> {
  try {
    const result = yield* call(getFullScreen);
    if (result.success) yield* put(hudFullScreenChanged(result.fullScreen));
  } catch {
    // Window chrome synchronization is best-effort.
  }
}

function* setFullScreenWorker(
  action: ReturnType<typeof hudFullScreenRequested>,
): SagaGenerator<void> {
  try {
    const result = yield* call(setFullScreen, action.payload[0]);
    if (result.success) yield* put(hudFullScreenChanged(result.fullScreen));
  } catch {
    // The event channel or a later request will reconcile the state.
  }
}

export function* hudFullScreenSaga(): SagaGenerator<void> {
  yield* takeEveryFromListenSync<boolean>('window:fullscreen', function* (fullScreen) {
    yield* put(hudFullScreenChanged(fullScreen));
  });
  yield* fork(syncFullScreenState);
  yield* takeLatest(hudFullScreenRequested, setFullScreenWorker);
}

function createHudChannel(): EventChannel<HudChannelMessage> {
  return eventChannel<HudChannelMessage>((emit) => {
    const offNotification = onBackendNotification((notification) =>
      emit({ kind: 'notification', notification }),
    );
    const offReconnect = onBackendReconnected(() => emit({ kind: 'reconnected' }));
    return () => {
      offNotification();
      offReconnect();
    };
  }, buffers.expanding<HudChannelMessage>());
}

async function subscribeHud(lease: SubscriptionLease): Promise<void> {
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
    if (lease.cancelled) await backendUnsubscribe(subscriptionId);
    else lease.subscriptionId = subscriptionId;
  } catch (error) {
    logger.error('HUD events.subscribe failed', error);
  }
}

async function unsubscribeHud(lease: SubscriptionLease): Promise<void> {
  lease.cancelled = true;
  const subscriptionId = lease.subscriptionId;
  lease.subscriptionId = undefined;
  if (!subscriptionId) return;
  try {
    await backendUnsubscribe(subscriptionId);
  } catch (error) {
    logger.warn('events.unsubscribe failed during HUD cleanup', error);
  }
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
    if (!result?.totals || !Array.isArray(result.byHourOfDay)) {
      throw new Error('stats.getUsage result is missing required totals/byHourOfDay');
    }
    const rateSamples: HudRateSample[] = result.byHourOfDay.map((bucket) => ({
      hour: bucket.hour,
      tokens: sumTotals(bucket),
    }));
    yield* put(
      hudUsageLoaded({
        totals: result.totals,
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
      backendRequest<{ samples?: HudRateHistorySample[] }>,
      'stats.getRateHistory',
      { limit: HUD_RATE_HISTORY_LIMIT },
    );
    if (!Array.isArray(result?.samples)) {
      throw new Error('stats.getRateHistory result is missing samples');
    }
    yield* put(hudRateHistoryLoaded({ samples: result.samples, fetchedAtMs: Date.now() }));
  } catch (error) {
    yield* put(hudRateHistoryFailed(error instanceof Error ? error.message : String(error)));
  }
}

function* refreshWorker(signals: Channel<RefreshSignal>, worker: () => Generator) {
  while (true) {
    yield* take(signals);
    yield* call(worker);
  }
}

function* rateHistoryTicker(signals: Channel<RefreshSignal>) {
  while (true) {
    signals.put(true);
    yield* delay(HUD_RATE_HISTORY_POLL_MS);
  }
}

function* hydrateVisibleWorkspaceAgents(hydrated: Set<string>): SagaGenerator<void> {
  const collection = yield* selectHudWorkspaceCollection.effect();
  for (const workspace of getItems(collection)) {
    if (
      typeof workspace.displayStatus === 'string' &&
      !QUESTION_HOLD_DISPLAY_STATUSES.has(workspace.displayStatus)
    ) {
      yield* put(hudQuestionsResolvedForWorkspace(String(workspace.id)));
    }
    if (
      workspace.status === WorkspaceStatus.Archived ||
      workspace.status === WorkspaceStatus.Deleted
    )
      continue;
    const workspaceId = String(workspace.id);
    if (hydrated.has(workspaceId)) continue;
    hydrated.add(workspaceId);
    yield* put(hydrateAgentsRequested(workspaceId));
  }
}

function* workspaceHydrationWorker(hydrated: Set<string>): SagaGenerator<void> {
  yield* hydrateVisibleWorkspaceAgents(hydrated);
  yield* takeLatestFromSelector(
    selectHudWorkspaceCollection,
    function* (_: SelectorChannelPayload<ReturnType<typeof selectHudWorkspaceCollection.select>>) {
      yield* hydrateVisibleWorkspaceAgents(hydrated);
    },
  );
}

/** Exported for focused persistence tests; production starts it under the HUD lifetime. */
export function* gridFilterPersistenceWorker(): SagaGenerator<void> {
  if (!(yield* selectHudConnectionsReady.effect())) {
    yield* take(connectionsListReceived);
  }
  const backendId = yield* selectActiveBackendId();
  const key = namespaceBackendKey(HUD_GRID_FILTER_STORAGE_KEY, backendId);
  const persisted = yield* getLocalStorageJSON<unknown>(key);
  yield* put(hudGridFilterHydrated(sanitizePersistedHudGridFilter(persisted)));
  const changes = yield* actionChannel([
    hudGridFilterRepoPicked,
    hudGridFilterStateToggled,
    hudGridFilterStatesCleared,
  ]);
  try {
    while (true) {
      yield* take(changes);
      if ((yield* selectActiveBackendId()) !== backendId) continue;
      yield* setLocalStorageJSON(key, yield* selectHudGridFilter.effect());
    }
  } finally {
    changes.close();
  }
}

function extractEvent(params: unknown): WorkspaceEvent | null {
  if (!params || typeof params !== 'object') return null;
  const wrapped = (params as { event?: unknown }).event;
  return (wrapped && typeof wrapped === 'object' ? wrapped : params) as WorkspaceEvent;
}

function extractSubscriptionId(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const id = (params as { subscriptionId?: unknown }).subscriptionId;
  return typeof id === 'string' ? id : undefined;
}

function* activeHudWorker(): SagaGenerator<void> {
  const events = createHudChannel();
  const usageSignals = channel<RefreshSignal>(buffers.sliding(1));
  const rateSignals = channel<RefreshSignal>(buffers.sliding(1));
  const lease: SubscriptionLease = { cancelled: false };
  const hydrated = new Set<string>();
  const delegated = new Set<string>();
  const lastStatus = new Map<string, string>();
  try {
    yield* fork(hudFullScreenSaga);
    yield* fork(refreshWorker, usageSignals, loadUsage);
    yield* fork(refreshWorker, rateSignals, loadRateHistory);
    yield* fork(rateHistoryTicker, rateSignals);
    yield* fork(workspaceHydrationWorker, hydrated);
    yield* fork(gridFilterPersistenceWorker);
    usageSignals.put(true);
    yield* call(subscribeHud, lease);
    while (true) {
      const message = yield* take(events);
      if (message === (END as unknown as HudChannelMessage)) break;
      if (message.kind === 'reconnected') {
        hydrated.clear();
        usageSignals.put(true);
        rateSignals.put(true);
        yield* fork(hydrateVisibleWorkspaceAgents, hydrated);
        yield* call(subscribeHud, lease);
        continue;
      }
      const { notification } = message;
      if (notification.method !== 'events.event') continue;
      const envelopeId = extractSubscriptionId(notification.params);
      if (envelopeId !== undefined && envelopeId !== lease.subscriptionId) continue;
      const event = extractEvent(notification.params);
      if (event) yield* handleEvent(event, delegated, lastStatus);
    }
  } finally {
    events.close();
    usageSignals.close();
    rateSignals.close();
    yield* call(unsubscribeHud, lease);
  }
}

function* handleEvent(
  event: WorkspaceEvent,
  delegated: Set<string>,
  lastStatus: Map<string, string>,
): SagaGenerator<void> {
  const workspaceId = typeof event.workspaceId === 'string' ? event.workspaceId : '';
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  const type = event.type as string;
  if (type === 'agent:stream:end') {
    for (const question of extractQuestionsFromStreamEnd(event))
      yield* put(hudQuestionCaptured(question));
  }
  if (type === 'workspace:attention-changed' && workspaceId && typeof data.attention === 'string') {
    const raisedAt =
      typeof event.timestamp === 'string' && event.timestamp
        ? event.timestamp
        : new Date().toISOString();
    yield* put(hudAttentionChanged(workspaceId, data.attention, raisedAt));
  } else if (
    type === 'workspace:displayStatus-changed' &&
    workspaceId &&
    isWorkspaceDisplayStatus(data.displayStatus)
  ) {
    yield* put(hudDisplayStatusChanged(workspaceId, data.displayStatus));
    if (!QUESTION_HOLD_DISPLAY_STATUSES.has(data.displayStatus)) {
      yield* put(hudQuestionsResolvedForWorkspace(workspaceId));
    }
  }
  let entry = mapEventToFeedEntry(event);
  if (
    entry?.kind === 'agent:status-changed' &&
    entry.agentId &&
    toHudAgentStateBucket(entry.agentStatus ?? '') === 'running' &&
    !delegated.has(entry.agentId)
  ) {
    delegated.add(entry.agentId);
    entry = { ...entry, kind: HUD_AGENT_DELEGATED_FEED_KIND } as HudFeedEntry;
  }
  if (entry) yield* put(hudFeedEntryReceived(entry));
  const eventAgentId = typeof data.agentId === 'string' ? data.agentId : undefined;
  const eventAgentName = eventAgentId
    ? yield* selectHudAgentDisplayName.effect(eventAgentId)
    : undefined;
  const trigger = mapEventToTakeoverTrigger(event, (agentId) =>
    agentId === eventAgentId ? eventAgentName : undefined,
  );
  if (!trigger || isDuplicateStatusUpdate(trigger, lastStatus)) return;
  yield* call(emitTakeoverTrigger, trigger);
}

function isDuplicateStatusUpdate(trigger: HudTakeoverTrigger, seen: Map<string, string>): boolean {
  if (trigger.kind !== 'status_update') return false;
  const previous = seen.get(trigger.workspaceId);
  seen.set(trigger.workspaceId, trigger.detail);
  return previous === trigger.detail;
}

function* hudActivationWorker(): SagaGenerator<void> {
  yield* race({ active: call(activeHudWorker), deactivated: take(hudDeactivated) });
}

export function* hudSaga(): SagaGenerator<void> {
  yield* takeLatest(hudActivated, hudActivationWorker);
}
