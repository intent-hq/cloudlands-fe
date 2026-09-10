import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
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
import { markWorkspaceSeed } from '../../../utils/switch-timing';
import {
  cancelPrMonitorRequested,
  flushPrMonitorRequested,
  prMonitorsActiveWorkspaceChanged,
  prMonitorsSnapshotFailed,
  prMonitorsSubscribeRequested,
  prMonitorsUnsubscribeRequested,
  prMonitorsUpdated,
} from '../pr-monitor-slice';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import {
  cancelPrMonitor,
  flushPrMonitor,
  subscribePrMonitors,
  type PrMonitorRow,
} from '$features/pr-monitor/pr-monitor-service';

const logger = createLogger('PrMonitorSaga');

type MonitorChannelMessage = { kind: 'rows'; monitors: PrMonitorRow[] } | { kind: 'failed' };

type SubscriptionEntry = {
  count: number;
  task?: Task;
};

const SUBSCRIPTION_RECONCILIATION_DELAY_MS = 100;

function createMonitorChannel(workspaceId: string): EventChannel<MonitorChannelMessage> {
  return eventChannel<MonitorChannelMessage>((emit) => {
    const subscription = subscribePrMonitors(
      workspaceId,
      (monitors) => emit({ kind: 'rows', monitors }),
      () => emit({ kind: 'failed' }),
    );
    return () => subscription.dispose();
  }, buffers.expanding<MonitorChannelMessage>());
}

function* forwardMonitorUpdates(
  workspaceId: string,
  channel: EventChannel<MonitorChannelMessage>,
): SagaGenerator<void> {
  try {
    while (true) {
      const message: MonitorChannelMessage = yield* take(channel);
      if (message === (END as unknown as MonitorChannelMessage)) return;
      if (message.kind === 'rows') {
        yield* put(prMonitorsUpdated(workspaceId, message.monitors));
      } else {
        yield* put(prMonitorsSnapshotFailed(workspaceId));
      }
    }
  } finally {
    channel.close();
  }
}

function* acquireSubscription(
  active: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof prMonitorsSubscribeRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  const entry = active.get(workspaceId) ?? { count: 0 };
  entry.count += 1;
  active.set(workspaceId, entry);
  if (entry.task) return;
  try {
    markWorkspaceSeed(workspaceId, 'prSeedStarted');
    const channel = createMonitorChannel(workspaceId);
    entry.task = yield* fork(forwardMonitorUpdates, workspaceId, channel);
  } catch (error) {
    logger.error('Failed to subscribe to prMonitor events', {
      workspaceId,
      error,
    });
    yield* put(prMonitorsSnapshotFailed(workspaceId));
  }
}

function* releaseSubscription(
  active: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof prMonitorsUnsubscribeRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const entry = active.get(workspaceId);
  if (!entry || --entry.count > 0) return;
  active.delete(workspaceId);
  if (entry.task) yield* cancel(entry.task);
}

function* watchActiveWorkspace(): SagaGenerator<void> {
  let lastChangeAt = 0;
  yield* takeLatestFromSelector(
    selectCurrentWorkspaceTabId,
    function* ({ payload }: SelectorChannelPayload<string | null>): SagaGenerator<void> {
      // Leading edge is immediate: only a change arriving within the window
      // of the previous one is trailing-debounced (takeLatest cancels the
      // superseded run), so rapid tab flapping still coalesces.
      const sinceLastChange = Date.now() - lastChangeAt;
      lastChangeAt = Date.now();
      if (sinceLastChange < SUBSCRIPTION_RECONCILIATION_DELAY_MS) {
        yield* delay(SUBSCRIPTION_RECONCILIATION_DELAY_MS);
      }
      // Hand off one intent. The selector worker is cancellable (including
      // reentrant notifications from its own dispatch); lease swaps are not.
      yield* put(prMonitorsActiveWorkspaceChanged(payload));
    },
  );
}

export function* flushPrMonitorWorker(
  action: ReturnType<typeof flushPrMonitorRequested>,
): SagaGenerator<void> {
  const [workspaceId, monitorId, check] = action.payload;
  try {
    yield* call(flushPrMonitor, workspaceId, monitorId, check);
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
  let leasedWorkspaceId: string | null = null;
  try {
    // Register consumers before the selector's initial preload can acquire a lease.
    // Card leases cover Chief/side-panel chats without changing tab selection.
    yield* takeEvery(prMonitorsSubscribeRequested, acquireSubscription, active);
    yield* takeEvery(prMonitorsUnsubscribeRequested, releaseSubscription, active);
    yield* takeEvery(prMonitorsActiveWorkspaceChanged, function* ({ payload: [workspaceId] }) {
      if (workspaceId === leasedWorkspaceId) return;
      const previous = leasedWorkspaceId;
      leasedWorkspaceId = workspaceId;
      if (workspaceId)
        yield* acquireSubscription(active, prMonitorsSubscribeRequested(workspaceId));
      if (previous) yield* releaseSubscription(active, prMonitorsUnsubscribeRequested(previous));
    });
    yield* all([call(watchActiveWorkspace), call(watchFlush), call(watchCancel)]);
  } finally {
    for (const entry of active.values()) {
      if (entry.task) yield* cancel(entry.task);
    }
    active.clear();
  }
}
