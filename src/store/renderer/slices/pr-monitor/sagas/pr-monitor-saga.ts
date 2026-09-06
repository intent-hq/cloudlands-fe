import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import type { Task } from 'redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import {
  all,
  call,
  cancel,
  delay,
  put,
  spawn,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import { markWorkspaceSeed } from '../../../utils/switch-timing';
import {
  cancelPrMonitorRequested,
  flushPrMonitorRequested,
  prMonitorsSnapshotFailed,
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
  channel: EventChannel<MonitorChannelMessage>;
  task: Task;
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

function* reconcilePrMonitorSubscriptions(
  active: Map<string, SubscriptionEntry>,
  activeWorkspaceId: string | null,
): SagaGenerator<void> {
  for (const [workspaceId, entry] of active) {
    if (workspaceId === activeWorkspaceId) continue;
    active.delete(workspaceId);
    yield* cancel(entry.task);
  }

  if (!activeWorkspaceId || active.has(activeWorkspaceId)) return;
  try {
    markWorkspaceSeed(activeWorkspaceId, 'prSeedStarted');
    const channel = createMonitorChannel(activeWorkspaceId);
    const task = yield* spawn(forwardMonitorUpdates, activeWorkspaceId, channel);
    active.set(activeWorkspaceId, { channel, task });
  } catch (error) {
    logger.error('Failed to subscribe to prMonitor events', {
      workspaceId: activeWorkspaceId,
      error,
    });
  }
}

function* watchActiveWorkspace(active: Map<string, SubscriptionEntry>): SagaGenerator<void> {
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
      yield* call(reconcilePrMonitorSubscriptions, active, payload);
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
  try {
    yield* all([call(watchActiveWorkspace, active), call(watchFlush), call(watchCancel)]);
  } finally {
    for (const entry of active.values()) yield* cancel(entry.task);
    active.clear();
  }
}
