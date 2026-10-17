import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { all, call, delay, getContext, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

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
} from '$features/pr-monitor/pr-monitor-service';

const logger = createLogger('PrMonitorSaga');

type SubscriptionEntry = { count: number; dispose?: () => void };
const SUBSCRIPTION_RECONCILIATION_DELAY_MS = 100;

function* acquireSubscription(
  active: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof prMonitorsSubscribeRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  const entry = active.get(workspaceId) ?? { count: 0 };
  entry.count += 1;
  active.set(workspaceId, entry);
  if (entry.dispose) return;
  try {
    markWorkspaceSeed(workspaceId, 'prSeedStarted');
    const reduxStore = yield* getContext<{
      dispatch(
        action: ReturnType<typeof prMonitorsUpdated> | ReturnType<typeof prMonitorsSnapshotFailed>,
      ): unknown;
    }>('reduxStore');
    const subscription = subscribePrMonitors(
      workspaceId,
      (rows) => {
        if (active.get(workspaceId) === entry)
          reduxStore.dispatch(prMonitorsUpdated(workspaceId, rows));
      },
      () => {
        if (active.get(workspaceId) === entry)
          reduxStore.dispatch(prMonitorsSnapshotFailed(workspaceId));
      },
    );
    entry.dispose = subscription.dispose;
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
  entry.dispose?.();
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
      entry.dispose?.();
    }
    active.clear();
  }
}
