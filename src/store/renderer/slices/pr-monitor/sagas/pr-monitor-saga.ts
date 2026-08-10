import { END, buffers, channel, eventChannel, type Channel, type EventChannel } from 'redux-saga';
import type { Task } from 'redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import {
  all,
  call,
  cancel,
  delay,
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
  prMonitorsUpdated,
  type PrMonitorState,
} from '../pr-monitor-slice';
import { selectPrMonitorSubscriptionDemand } from '../pr-monitor-selectors';
import {
  cancelPrMonitor,
  flushPrMonitor,
  subscribePrMonitors,
  type PrMonitorRow,
} from '$features/pr-monitor/pr-monitor-service';

const logger = createLogger('PrMonitorSaga');

type SubscriptionEntry = {
  channel: EventChannel<PrMonitorRow[]>;
  task: Task;
};

type SubscriptionDemand = PrMonitorState['subscriptionDemandByWorkspaceId'];

const SUBSCRIPTION_RECONCILIATION_DELAY_MS = 100;

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

function* reconcilePrMonitorSubscriptions(
  active: Map<string, SubscriptionEntry>,
  demand: SubscriptionDemand,
): SagaGenerator<void> {
  for (const [workspaceId, entry] of active) {
    if ((demand[workspaceId] ?? 0) > 0) continue;
    active.delete(workspaceId);
    yield* cancel(entry.task);
    yield* put(prMonitorsCleared(workspaceId));
  }

  for (const [workspaceId, count] of Object.entries(demand)) {
    if (count <= 0 || active.has(workspaceId)) continue;
    try {
      const channel = createMonitorChannel(workspaceId);
      const task = yield* fork(forwardMonitorUpdates, workspaceId, channel);
      active.set(workspaceId, { channel, task });
    } catch (error) {
      logger.error('Failed to subscribe to prMonitor events', { workspaceId, error });
    }
  }
}

function* watchSubscriptionDemand(
  reconciliationChannel: Channel<SubscriptionDemand>,
): SagaGenerator<void> {
  yield* takeLatestFromSelector(
    selectPrMonitorSubscriptionDemand,
    function* ({ payload }: SelectorChannelPayload<SubscriptionDemand>) {
      yield* delay(SUBSCRIPTION_RECONCILIATION_DELAY_MS);
      yield* put(reconciliationChannel, payload);
    },
  );
}

function* manageSubscriptions(
  active: Map<string, SubscriptionEntry>,
  reconciliationChannel: Channel<SubscriptionDemand>,
): SagaGenerator<void> {
  while (true) {
    const demand = yield* take(reconciliationChannel);
    yield* reconcilePrMonitorSubscriptions(active, demand);
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
  const reconciliationChannel = channel<SubscriptionDemand>(buffers.sliding(1));
  try {
    yield* all([
      call(watchSubscriptionDemand, reconciliationChannel),
      call(manageSubscriptions, active, reconciliationChannel),
      call(watchFlush),
      call(watchCancel),
    ]);
  } finally {
    reconciliationChannel.close();
    for (const entry of active.values()) yield* cancel(entry.task);
    active.clear();
  }
}
