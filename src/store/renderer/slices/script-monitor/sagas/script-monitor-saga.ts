import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, fork, put, select, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
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
  scriptMonitorOperationUpdated,
  scriptMonitorsSubscribeRequested,
  scriptMonitorsUnsubscribeRequested,
  scriptMonitorsUpdated,
} from '../script-monitor-slice';
import { selectScriptMonitors } from '../script-monitor-selectors';

type Lease = {
  count: number;
  service: ReturnType<typeof subscribeScriptMonitors>;
  channel: EventChannel<ScriptMonitorSnapshot>;
  snapshot?: ScriptMonitorSnapshot;
};
export function* scriptMonitorSaga(): SagaGenerator<void> {
  const connection = createScriptMonitorConnection();
  const leases = new Map<string, Lease>();
  try {
    yield* takeEvery(
      scriptMonitorsSubscribeRequested,
      function* ({ payload: [workspaceId] }): SagaGenerator<void> {
        const previous = leases.get(workspaceId);
        if (previous) {
          previous.count++;
          return;
        }
        let service!: Lease['service'];
        const channel = eventChannel<ScriptMonitorSnapshot>((emit) => {
          service = subscribeScriptMonitors(workspaceId, emit, connection);
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
      },
    );
    yield* takeEvery(
      scriptMonitorsUnsubscribeRequested,
      function* ({ payload: [workspaceId] }): SagaGenerator<void> {
        const lease = leases.get(workspaceId);
        if (lease && --lease.count === 0) {
          leases.delete(workspaceId);
          lease.channel.close();
        }
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
          const script = state.scripts.find((item) => item.id === row.scriptId);
          if (script) yield* call(openMonitoredScript, workspaceId, script.id, script.name, action);
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
              : result.monitor.state === 'cancelled'
                ? m.chat_scriptMonitor_unmonitored_description()
                : m.chat_scriptMonitor_unchanged_description();
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
    // Keep the subscription owner alive until root-saga cancellation.
    yield* take(() => false);
  } finally {
    for (const lease of leases.values()) lease.channel.close();
    leases.clear();
    connection.dispose();
  }
}
