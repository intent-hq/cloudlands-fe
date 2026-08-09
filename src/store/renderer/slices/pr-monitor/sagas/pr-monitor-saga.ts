import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import type { Task } from 'redux-saga';
import {
  all,
  call,
  cancel,
  fork,
  put,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import {
  cancelPrMonitorRequested,
  flushPrMonitorRequested,
  prMonitorsCleared,
  prMonitorsSubscribeRequested,
  prMonitorsUnsubscribeRequested,
  prMonitorsUpdated,
} from '../pr-monitor-slice';
import {
  cancelPrMonitor,
  flushPrMonitor,
  subscribePrMonitors,
  type PrMonitorRow,
} from '$features/pr-monitor/pr-monitor-service';

const logger = createLogger('PrMonitorSaga');

type SubscriptionEntry = {
  count: number;
  channel: EventChannel<PrMonitorRow[]>;
  task: Task;
};

function createMonitorChannel(workspaceId: string): EventChannel<PrMonitorRow[]> {
  return eventChannel<PrMonitorRow[]>((emit) => {
    const subscription = subscribePrMonitors(workspaceId, emit);
    return () => subscription.dispose();
  }, buffers.expanding<PrMonitorRow[]>());
}

function* forwardMonitorUpdates(
  workspaceId: string,
  channel: EventChannel<PrMonitorRow[]>,
): SagaGenerator<void> {
  try {
    while (true) {
      const monitors: PrMonitorRow[] = yield* take(channel);
      if (monitors === (END as unknown as PrMonitorRow[])) return;
      yield* put(prMonitorsUpdated(workspaceId, monitors));
    }
  } finally {
    channel.close();
  }
}

function* watchSubscribe(active: Map<string, SubscriptionEntry>): SagaGenerator<void> {
  while (true) {
    const action = yield* take(prMonitorsSubscribeRequested);
    const [workspaceId] = action.payload;
    if (!workspaceId) continue;

    const existing = active.get(workspaceId);
    if (existing) {
      existing.count += 1;
      continue;
    }

    try {
      const channel = createMonitorChannel(workspaceId);
      const task = yield* fork(forwardMonitorUpdates, workspaceId, channel);
      active.set(workspaceId, { count: 1, channel, task });
    } catch (error) {
      logger.error('Failed to subscribe to prMonitor events', { workspaceId, error });
    }
  }
}

function* watchUnsubscribe(active: Map<string, SubscriptionEntry>): SagaGenerator<void> {
  while (true) {
    const action = yield* take(prMonitorsUnsubscribeRequested);
    const [workspaceId] = action.payload;
    if (!workspaceId) continue;

    const entry = active.get(workspaceId);
    if (!entry) continue;
    entry.count -= 1;
    if (entry.count > 0) continue;

    active.delete(workspaceId);
    yield* cancel(entry.task);
    yield* put(prMonitorsCleared(workspaceId));
  }
}

export function* flushPrMonitorWorker(
  action: ReturnType<typeof flushPrMonitorRequested>,
): SagaGenerator<void> {
  const [workspaceId, monitorId] = action.payload;
  try {
    yield* call(flushPrMonitor, workspaceId, monitorId);
  } catch (error) {
    logger.error('prMonitor.flush failed', { workspaceId, monitorId, error });
  }
}

export function* cancelPrMonitorWorker(
  action: ReturnType<typeof cancelPrMonitorRequested>,
): SagaGenerator<void> {
  const [workspaceId, monitorId] = action.payload;
  try {
    yield* call(cancelPrMonitor, workspaceId, monitorId);
  } catch (error) {
    logger.error('prMonitor.cancel failed', { workspaceId, monitorId, error });
  }
}

function* watchFlush(): SagaGenerator<void> {
  yield* takeEvery(flushPrMonitorRequested, flushPrMonitorWorker);
}

function* watchCancel(): SagaGenerator<void> {
  yield* takeEvery(cancelPrMonitorRequested, cancelPrMonitorWorker);
}

export function* prMonitorSaga(): SagaGenerator<void> {
  const active = new Map<string, SubscriptionEntry>();
  try {
    yield* all([
      call(watchSubscribe, active),
      call(watchUnsubscribe, active),
      call(watchFlush),
      call(watchCancel),
    ]);
  } finally {
    for (const entry of active.values()) yield* cancel(entry.task);
    active.clear();
  }
}
