import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import {
  call,
  delay,
  fork,
  put,
  select,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import {
  subscribeScriptMonitors,
  createScriptMonitorConnection,
  type ScriptMonitorSnapshot,
} from '$features/script-monitor/script-monitor-service';
import { openMonitoredScript } from '$features/script-monitor/open-monitored-script';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import {
  scriptMonitorActionRequested,
  scriptMonitorsActiveWorkspaceChanged,
  scriptMonitorsLoadMoreRequested,
  scriptMonitorsRetryRequested,
  scriptMonitorDetailsRequested,
  scriptMonitorOperationUpdated,
  scriptMonitorsSubscribeRequested,
  scriptMonitorsUnsubscribeRequested,
  scriptMonitorsUpdated,
} from '../script-monitor-slice';
import { selectScriptMonitors } from '../script-monitor-selectors';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';

type Lease = {
  count: number;
  service: ReturnType<typeof subscribeScriptMonitors>;
  channel: EventChannel<ScriptMonitorSnapshot>;
  snapshot?: ScriptMonitorSnapshot;
};
const SUBSCRIPTION_RECONCILIATION_DELAY_MS = 100;

/**
 * Selected-tab preload, mirroring the PR-monitor and hook sagas: the selected
 * workspace holds a lease before its chat footer mounts, so script rows are
 * read alongside the transcript instead of after the card appears.
 */
function* watchActiveWorkspace(): SagaGenerator<void> {
  let lastChangeAt = 0;
  yield* takeLatestFromSelector(
    selectCurrentWorkspaceTabId,
    function* ({ payload }: SelectorChannelPayload<string | null>): SagaGenerator<void> {
      // Leading edge is immediate; only a change inside the previous change's
      // window is trailing-debounced (takeLatest cancels the superseded run).
      const sinceLastChange = Date.now() - lastChangeAt;
      lastChangeAt = Date.now();
      if (sinceLastChange < SUBSCRIPTION_RECONCILIATION_DELAY_MS) {
        yield* delay(SUBSCRIPTION_RECONCILIATION_DELAY_MS);
      }
      // Hand off one intent; the lease swap itself is not cancellable.
      yield* put(scriptMonitorsActiveWorkspaceChanged(payload));
    },
  );
}

export function* scriptMonitorSaga(): SagaGenerator<void> {
  const connection = createScriptMonitorConnection();
  const leases = new Map<string, Lease>();
  let leasedWorkspaceId: string | null = null;
  try {
    function* acquire(workspaceId: string): SagaGenerator<void> {
      const previous = leases.get(workspaceId);
      if (previous) {
        previous.count++;
        return;
      }
      // Warm reopen: start from the last fresh rows so the footer renders with
      // the transcript; the service's first page replaces them.
      const saved = yield* select(selectScriptMonitors.select, workspaceId);
      const retained = saved.status === 'ready' ? saved : undefined;
      let service!: Lease['service'];
      const channel = eventChannel<ScriptMonitorSnapshot>((emit) => {
        service = subscribeScriptMonitors(workspaceId, emit, connection, retained);
        return () => service.dispose();
      }, buffers.expanding());
      const lease: Lease = { count: 1, service, channel };
      leases.set(workspaceId, lease);
      yield* fork(function* (): SagaGenerator<void> {
        try {
          while (true) {
            const snapshot = yield* take(channel);
            if (leases.get(workspaceId) !== lease) return;
            lease.snapshot = snapshot;
            yield* put(scriptMonitorsUpdated(workspaceId, snapshot));
          }
        } finally {
          channel.close();
        }
      });
    }
    function release(workspaceId: string): void {
      const lease = leases.get(workspaceId);
      if (lease && --lease.count === 0) {
        leases.delete(workspaceId);
        lease.channel.close();
      }
    }
    // Register lease consumers before the selector's initial preload can fire.
    yield* takeEvery(scriptMonitorsSubscribeRequested, function* ({ payload: [workspaceId] }) {
      yield* acquire(workspaceId);
    });
    yield* takeEvery(scriptMonitorsUnsubscribeRequested, ({ payload: [workspaceId] }) =>
      release(workspaceId),
    );
    yield* takeEvery(
      scriptMonitorsActiveWorkspaceChanged,
      function* ({ payload: [workspaceId] }): SagaGenerator<void> {
        if (workspaceId === leasedWorkspaceId) return;
        const previous = leasedWorkspaceId;
        leasedWorkspaceId = workspaceId;
        if (workspaceId) yield* acquire(workspaceId);
        if (previous) release(previous);
      },
    );
    yield* takeEvery(
      scriptMonitorsLoadMoreRequested,
      function* ({ payload: [workspaceId] }): SagaGenerator<void> {
        const service = leases.get(workspaceId)?.service;
        if (service) yield* call([service, service.loadMore]);
      },
    );
    yield* takeEvery(
      scriptMonitorsRetryRequested,
      function* ({ payload: [workspaceId] }): SagaGenerator<void> {
        const service = leases.get(workspaceId)?.service;
        if (service) yield* call([service, service.retry]);
      },
    );
    yield* takeEvery(
      scriptMonitorDetailsRequested,
      function* ({ payload: [workspaceId, monitorId] }): SagaGenerator<void> {
        const service = leases.get(workspaceId)?.service;
        if (service) yield* call([service, service.details], monitorId);
      },
    );
    yield* takeEvery(
      scriptMonitorActionRequested,
      function* ({ payload: [workspaceId, monitorId, action] }): SagaGenerator<void> {
        const lease = leases.get(workspaceId);
        if (!lease || lease.snapshot?.status !== 'ready') return;
        const state = yield* select(selectScriptMonitors.select, workspaceId);
        if (state.operations[monitorId]?.pending) return;
        const row = state.monitors.find((item) => item.monitorId === monitorId);
        if (!row) return;
        if (action === 'pane' || action === 'bottom') {
          yield* call(openMonitoredScript, workspaceId, row.scriptId, row.scriptName, action);
          return;
        }
        if (row.state !== 'active') return;
        yield* put(scriptMonitorOperationUpdated(workspaceId, monitorId, { pending: true }));
        try {
          const result = yield* call(
            [lease.service, lease.service.mutate],
            monitorId,
            action === 'cancelRun',
          );
          if (leases.get(workspaceId) !== lease || !result) return;
          const message =
            action === 'cancelRun'
              ? result.runStopped
                ? m.chat_scriptMonitor_stopped_description()
                : m.chat_scriptMonitor_unchanged_description()
              : m.chat_scriptMonitor_unmonitored_description();
          yield* put(scriptMonitorOperationUpdated(workspaceId, monitorId, { pending: false }));
          yield* call(notify.info, message);
        } catch {
          if (leases.get(workspaceId) === lease)
            yield* put(
              scriptMonitorOperationUpdated(workspaceId, monitorId, {
                pending: false,
                error: true,
                message: m.chat_scriptMonitor_action_error(),
              }),
            );
        }
      },
    );
    yield* fork(watchActiveWorkspace);
    // Keep the subscription owner alive until root-saga cancellation.
    yield* take(() => false);
  } finally {
    for (const lease of leases.values()) lease.channel.close();
    leases.clear();
    connection.dispose();
  }
}
