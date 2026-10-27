/**
 * Agent trace loader.
 *
 * While an agent overview is open for a workspace (reference counted by
 * `agentTraceOpened` / `agentTraceClosed`), this saga:
 *
 * 1. Holds a workspace-scoped `events.subscribe` lease for the trace event
 *    types (§6) and forwards its events in batches.
 * 2. Pages `event.query` history (§5.10): turn rows and failures on open; tool
 *    calls and usage snapshots back to the window the view requests.
 * 3. On reconnect, subscribes again and reloads the history it had.
 *
 * A failed history page or subscription marks the load failed; the records
 * already read stay, and a retry starts over.
 *
 * Paging walks newest → oldest and resumes from its `nextToken`, so widening
 * the window never downloads the newer pages twice.
 */
import { END, buffers, channel as createChannel, type Channel } from 'redux-saga';
import { call, delay, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { EventQueryPage } from '$lib/client/app-client';
import {
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
  type BackendNotification,
} from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import type { WorkspaceEvent } from '$features/events/types';
import type { TraceRecord } from '$features/agent-trace/trace-types';
import { TRACE_EVENT_TYPES, toTraceRecord } from '$features/agent-trace/utils/trace-records';
import {
  agentTraceCleared,
  agentTraceClosed,
  agentTraceDetailRequested,
  agentTraceLoadFinished,
  agentTraceLoadStarted,
  agentTraceOpened,
  agentTraceRecordsReceived,
  agentTraceRetryRequested,
} from '../agent-trace-slice';

const logger = createLogger('AgentTraceSaga');

const TURN_PAGE_LIMIT = 200;
/** Small pages keep rows under the §5.10 response budget (no trimming). */
const TOOL_PAGE_LIMIT = 100;
const USAGE_PAGE_LIMIT = 25;
/** Turn rows are small and never swept; read a week of them. */
const TURN_LOOKBACK_MINUTES = 7 * 24 * 60;
const TURN_PAGE_CAP = 10;
const FAILURE_PAGE_CAP = 2;
/** Tool calls live 6 h, usage snapshots 72 h (PROTOCOL §5.10). */
const TOOL_LOOKBACK_MINUTES = 6 * 60;
const USAGE_LOOKBACK_MINUTES = 72 * 60;
const DETAIL_PAGE_CAP = 40;
/** A failed detail read resumes after 2 s, 4 s, then 6 s. */
const DETAIL_RETRY_LIMIT = 3;
const DETAIL_RETRY_MS = 2_000;
const LIVE_FLUSH_MS = 250;

type DetailKind = 'tool' | 'usage';

interface Cursor {
  eventType: string;
  minutesAgo: number;
  limit: number;
  nextToken: string | null;
  /** Oldest event time read so far (epoch ms). */
  oldest: number;
  exhausted: boolean;
  pages: number;
}

interface SubscriptionLease {
  subscriptionId?: string;
  cancelled: boolean;
}

interface ActiveTrace {
  count: number;
  generation: number;
  lease?: SubscriptionLease;
  cursors: Record<DetailKind, Cursor>;
  /** Widest window the view asked for (epoch ms). */
  requestedFrom: number | null;
  loadingDetail: boolean;
  pendingDetail: boolean;
  /** Identity of the running detail load; a newer generation replaces it. */
  detailRun?: object;
  buffer: TraceRecord[];
  flushScheduled: boolean;
}

type TransportMessage =
  { kind: 'notification'; notification: BackendNotification } | { kind: 'reconnected' };

function newCursors(): Record<DetailKind, Cursor> {
  const cursor = (eventType: string, minutesAgo: number, limit: number): Cursor => ({
    eventType,
    minutesAgo,
    limit,
    nextToken: null,
    oldest: Infinity,
    exhausted: false,
    pages: 0,
  });
  return {
    tool: cursor('agent:tool:call', TOOL_LOOKBACK_MINUTES, TOOL_PAGE_LIMIT),
    usage: cursor('workspace:tokenUsage-changed', USAGE_LOOKBACK_MINUTES, USAGE_PAGE_LIMIT),
  };
}

function toRecords(events: readonly WorkspaceEvent[]): TraceRecord[] {
  const records: TraceRecord[] = [];
  for (const event of events) {
    const record = toTraceRecord(event);
    if (record) records.push(record);
  }
  return records;
}

function queryPage(
  workspaceId: string,
  eventType: string,
  minutesAgo: number,
  limit: number,
  nextToken: string | null,
): Promise<EventQueryPage> {
  return appClient.events.queryPage(workspaceId, {
    eventType,
    minutesAgo,
    limit,
    ...(nextToken ? { nextToken } : {}),
  });
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

async function releaseSubscription(workspaceId: string, subscriptionId: string): Promise<void> {
  try {
    await backendUnsubscribe(subscriptionId, workspaceId);
  } catch (error) {
    logger.warn('events.unsubscribe (trace) failed', { workspaceId, error });
  }
}

/** Takes the lease's daemon subscription; `false` when none could be taken. */
async function subscribeWorkspace(workspaceId: string, lease: SubscriptionLease): Promise<boolean> {
  let subscriptionId: string | undefined;
  try {
    const result = await backendSubscribe<{ subscriptionId?: string }>({
      eventTypes: [...TRACE_EVENT_TYPES],
      workspaceId,
    });
    subscriptionId =
      typeof result?.subscriptionId === 'string' && result.subscriptionId.length > 0
        ? result.subscriptionId
        : undefined;
  } catch (error) {
    if (!lease.cancelled) logger.warn('events.subscribe (trace) failed', { workspaceId, error });
    return false;
  }
  if (lease.cancelled) {
    if (subscriptionId) await releaseSubscription(workspaceId, subscriptionId);
    return true;
  }
  if (!subscriptionId) {
    logger.warn('events.subscribe (trace) returned no subscription id', { workspaceId });
    return false;
  }
  lease.subscriptionId = subscriptionId;
  return true;
}

async function unsubscribeWorkspace(workspaceId: string, lease: SubscriptionLease): Promise<void> {
  lease.cancelled = true;
  const subscriptionId = lease.subscriptionId;
  lease.subscriptionId = undefined;
  if (subscriptionId) await releaseSubscription(workspaceId, subscriptionId);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function isCurrent(
  active: Map<string, ActiveTrace>,
  workspaceId: string,
  entry: ActiveTrace,
  generation: number,
) {
  return active.get(workspaceId) === entry && entry.generation === generation;
}

/** `subscribed`: without a lease the timeline cannot stay current, so the load fails. */
function* loadTurns(
  active: Map<string, ActiveTrace>,
  workspaceId: string,
  entry: ActiveTrace,
  subscribed: boolean,
): SagaGenerator<void> {
  const generation = entry.generation;
  yield* put(agentTraceLoadStarted(workspaceId));
  let ok = subscribed;
  for (const [eventType, cap] of [
    ['agent:last-message', TURN_PAGE_CAP],
    ['agent:failed', FAILURE_PAGE_CAP],
  ] as const) {
    let nextToken: string | null = null;
    for (let page = 0; page < cap; page += 1) {
      try {
        const result: EventQueryPage = yield* call(
          queryPage,
          workspaceId,
          eventType,
          TURN_LOOKBACK_MINUTES,
          TURN_PAGE_LIMIT,
          nextToken,
        );
        if (!isCurrent(active, workspaceId, entry, generation)) return;
        const records = toRecords(result.items ?? []);
        if (records.length > 0) yield* put(agentTraceRecordsReceived(workspaceId, records));
        nextToken = result.nextToken ?? null;
        if (!nextToken) break;
      } catch (error) {
        logger.warn('event.query (trace turns) failed', { workspaceId, eventType, error });
        ok = false;
        break;
      }
    }
  }
  if (isCurrent(active, workspaceId, entry, generation)) {
    yield* put(agentTraceLoadFinished(workspaceId, ok));
  }
}

/** Page one detail cursor until it reaches `from`, its history ends, or the cap. */
function* advanceCursor(
  workspaceId: string,
  cursor: Cursor,
  from: number,
  isLive: () => boolean,
): SagaGenerator<boolean> {
  while (!cursor.exhausted && cursor.oldest > from && cursor.pages < DETAIL_PAGE_CAP) {
    const result: EventQueryPage = yield* call(
      queryPage,
      workspaceId,
      cursor.eventType,
      cursor.minutesAgo,
      cursor.limit,
      cursor.nextToken,
    );
    if (!isLive()) return false;
    cursor.pages += 1;
    const items = result.items ?? [];
    for (const item of items) {
      const ts = Date.parse(item.timestamp);
      if (Number.isFinite(ts) && ts < cursor.oldest) cursor.oldest = ts;
    }
    const records = toRecords(items);
    if (records.length > 0) yield* put(agentTraceRecordsReceived(workspaceId, records));
    cursor.nextToken = result.nextToken ?? null;
    if (!cursor.nextToken || items.length === 0) cursor.exhausted = true;
  }
  return true;
}

function* loadDetail(
  active: Map<string, ActiveTrace>,
  workspaceId: string,
  entry: ActiveTrace,
): SagaGenerator<void> {
  if (entry.loadingDetail) {
    entry.pendingDetail = true;
    return;
  }
  entry.loadingDetail = true;
  const run = {};
  entry.detailRun = run;
  const generation = entry.generation;
  const isLive = () => isCurrent(active, workspaceId, entry, generation);
  let retries = 0;
  try {
    do {
      entry.pendingDetail = false;
      const from = entry.requestedFrom;
      if (from === null) break;
      let ok = true;
      for (const kind of ['tool', 'usage'] as const) {
        try {
          if (!(yield* call(advanceCursor, workspaceId, entry.cursors[kind], from, isLive))) return;
        } catch (error) {
          logger.warn('event.query (trace detail) failed', { workspaceId, kind, error });
          ok = false;
        }
      }
      if (!isLive()) return;
      if (ok) retries = 0;
      else if (retries < DETAIL_RETRY_LIMIT) {
        // A repeated request for the same window is ignored, so resume the
        // failed cursor here after a pause instead of leaving its calls out.
        retries += 1;
        yield* delay(DETAIL_RETRY_MS * retries);
        if (!isLive()) return;
        entry.pendingDetail = true;
      }
    } while (entry.pendingDetail && isLive());
  } finally {
    if (entry.detailRun === run) {
      entry.loadingDetail = false;
      entry.detailRun = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function openTransport(
  runtime: { unsubscribe?: () => void },
  events: Channel<TransportMessage>,
): void {
  if (runtime.unsubscribe) return;
  const offNotification = onBackendNotification((notification) => {
    events.put({ kind: 'notification', notification });
  });
  const offReconnect = onBackendReconnected(() => events.put({ kind: 'reconnected' }));
  runtime.unsubscribe = () => {
    offNotification();
    offReconnect();
    runtime.unsubscribe = undefined;
  };
}

function* startWorkspace(
  active: Map<string, ActiveTrace>,
  workspaceId: string,
  entry: ActiveTrace,
): SagaGenerator<void> {
  entry.generation += 1;
  if (entry.lease) entry.lease.cancelled = true;
  const lease: SubscriptionLease = { cancelled: false };
  entry.lease = lease;
  entry.cursors = newCursors();
  entry.loadingDetail = false;
  entry.pendingDetail = false;
  entry.detailRun = undefined;
  // Subscribe first so no event falls between the history read and the lease.
  const subscribed = yield* call(subscribeWorkspace, workspaceId, lease);
  if (active.get(workspaceId) !== entry || entry.lease !== lease) return;
  yield* fork(loadTurns, active, workspaceId, entry, subscribed);
  if (entry.requestedFrom !== null) yield* fork(loadDetail, active, workspaceId, entry);
}

function* handleOpened(
  active: Map<string, ActiveTrace>,
  runtime: { unsubscribe?: () => void },
  events: Channel<TransportMessage>,
  action: ReturnType<typeof agentTraceOpened>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const current = active.get(workspaceId);
  if (current) {
    current.count += 1;
    return;
  }
  openTransport(runtime, events);
  const entry: ActiveTrace = {
    count: 1,
    generation: 0,
    cursors: newCursors(),
    requestedFrom: null,
    loadingDetail: false,
    pendingDetail: false,
    buffer: [],
    flushScheduled: false,
  };
  active.set(workspaceId, entry);
  yield* call(startWorkspace, active, workspaceId, entry);
}

function* closeWorkspace(
  active: Map<string, ActiveTrace>,
  runtime: { unsubscribe?: () => void },
  workspaceId: string,
): SagaGenerator<void> {
  const entry = active.get(workspaceId);
  if (!entry) return;
  active.delete(workspaceId);
  entry.generation += 1;
  if (active.size === 0) runtime.unsubscribe?.();
  yield* put(agentTraceCleared(workspaceId));
  if (entry.lease) yield* call(unsubscribeWorkspace, workspaceId, entry.lease);
}

function* handleClosed(
  active: Map<string, ActiveTrace>,
  runtime: { unsubscribe?: () => void },
  action: ReturnType<typeof agentTraceClosed>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const entry = active.get(workspaceId);
  if (entry && --entry.count <= 0) yield* closeWorkspace(active, runtime, workspaceId);
}

function* handleDetailRequested(
  active: Map<string, ActiveTrace>,
  action: ReturnType<typeof agentTraceDetailRequested>,
): SagaGenerator<void> {
  const [workspaceId, from] = action.payload;
  const entry = active.get(workspaceId);
  if (!entry || !Number.isFinite(from)) return;
  if (entry.requestedFrom !== null && entry.requestedFrom <= from) return;
  entry.requestedFrom = from;
  yield* call(loadDetail, active, workspaceId, entry);
}

function* handleRetry(
  active: Map<string, ActiveTrace>,
  action: ReturnType<typeof agentTraceRetryRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const entry = active.get(workspaceId);
  if (!entry) return;
  // Unlike a reconnect, the connection is still up: release the old lease's
  // daemon subscription instead of leaving it streaming to nobody.
  if (entry.lease) yield* fork(unsubscribeWorkspace, workspaceId, entry.lease);
  yield* call(startWorkspace, active, workspaceId, entry);
}

function* flushLater(
  active: Map<string, ActiveTrace>,
  workspaceId: string,
  entry: ActiveTrace,
): SagaGenerator<void> {
  yield* delay(LIVE_FLUSH_MS);
  entry.flushScheduled = false;
  const records = entry.buffer;
  entry.buffer = [];
  // The last panel may have closed meanwhile; its cleared state stays cleared.
  if (records.length > 0 && active.get(workspaceId) === entry) {
    yield* put(agentTraceRecordsReceived(workspaceId, records));
  }
}

interface TraceEventNotification {
  subscriptionId?: string;
  event?: WorkspaceEvent;
}

function* handleNotification(
  active: Map<string, ActiveTrace>,
  notification: BackendNotification,
): SagaGenerator<void> {
  if (notification.method !== 'events.event') return;
  const params = notification.params as TraceEventNotification | undefined;
  const event = params?.event;
  if (!event?.workspaceId) return;
  const entry = active.get(event.workspaceId);
  const subscriptionId = entry?.lease?.subscriptionId;
  // Our own lease only: the global firehose delivers the same events too.
  if (!entry || !subscriptionId || params?.subscriptionId !== subscriptionId) return;
  const record = toTraceRecord(event);
  if (!record) return;
  entry.buffer.push(record);
  if (!entry.flushScheduled) {
    entry.flushScheduled = true;
    yield* fork(flushLater, active, event.workspaceId, entry);
  }
}

export function* agentTraceSaga(): SagaGenerator<void> {
  const active = new Map<string, ActiveTrace>();
  const runtime: { unsubscribe?: () => void } = {};
  const events = createChannel(buffers.expanding<TransportMessage>());
  yield* takeEvery(agentTraceOpened, handleOpened, active, runtime, events);
  yield* takeEvery(agentTraceClosed, handleClosed, active, runtime);
  yield* takeEvery(agentTraceDetailRequested, handleDetailRequested, active);
  yield* takeEvery(agentTraceRetryRequested, handleRetry, active);
  try {
    while (true) {
      const message: TransportMessage = yield* take(events);
      if (message === (END as unknown as TransportMessage)) return;
      if (message.kind === 'reconnected') {
        for (const [workspaceId, entry] of active) {
          yield* fork(startWorkspace, active, workspaceId, entry);
        }
      } else {
        yield* handleNotification(active, message.notification);
      }
    }
  } finally {
    events.close();
    for (const workspaceId of [...active.keys()]) {
      yield* closeWorkspace(active, runtime, workspaceId);
    }
    runtime.unsubscribe?.();
  }
}
