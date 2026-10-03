import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { LiveScriptsClient } from '$lib/client/live/live-scripts-client';
import type { ScriptWithState } from '$features/scripts/types';
import type {
  ScriptMonitor,
  ScriptMonitorEvent,
  ScriptMonitorEventType,
  ScriptMonitorMutationResult,
} from './types';

type MonitorStatus = 'loading' | 'ready' | 'failed' | 'unsupported';
export interface ScriptMonitorSnapshot {
  monitors: ScriptMonitor[];
  scripts: ScriptWithState[];
  status: MonitorStatus;
}

/** Terminal snapshots are immutable. Late registration/list replies cannot revive them. */
function mergeScriptMonitor(rows: ScriptMonitor[], incoming: ScriptMonitor): ScriptMonitor[] {
  const previous = rows.find((row) => row.monitorId === incoming.monitorId);
  if (previous && previous.state !== 'active') return rows;
  return [...rows.filter((row) => row.monitorId !== incoming.monitorId), incoming];
}

function isMonitorMethodMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { rpcCode?: number }).rpcCode === -32601;
}

/** Shared by all workspace leases: a missing method disables the whole connection until reconnect. */
export function createScriptMonitorConnection() {
  let rejected = false;
  const disabled = new Set<() => void>();
  const reconnected = new Set<() => void>();
  const off = onBackendReconnected(() => {
    rejected = false;
    for (const handler of reconnected) handler();
  });
  return {
    isRejected: () => rejected,
    reject: () => {
      rejected = true;
      for (const handler of disabled) handler();
    },
    listen(onDisabled: () => void, onReconnected: () => void) {
      disabled.add(onDisabled);
      reconnected.add(onReconnected);
      return () => {
        disabled.delete(onDisabled);
        reconnected.delete(onReconnected);
      };
    },
    dispose: off,
  };
}

/** A subscription owns its connection capability and rejects stale operations after reconnect. */
export function subscribeScriptMonitors(
  workspaceId: string,
  handler: (snapshot: ScriptMonitorSnapshot) => void,
  sharedConnection?: ReturnType<typeof createScriptMonitorConnection>,
) {
  const connection = sharedConnection ?? createScriptMonitorConnection();
  let disposed = false;
  let epoch = 0;
  let subscriptionId: string | undefined;
  let supported = false;
  let snapshot: ScriptMonitorSnapshot = { monitors: [], scripts: [], status: 'loading' };
  let inFlight = false;
  let queued = false;
  let journal = new Map<string, ScriptMonitor>();
  const emit = () => {
    if (!disposed) handler(snapshot);
  };
  const current = (version: number) => !disposed && epoch === version;
  const disable = () => {
    supported = false;
    if (subscriptionId) void backendUnsubscribe(subscriptionId, workspaceId);
    subscriptionId = undefined;
    snapshot = { monitors: [], scripts: [], status: 'unsupported' };
    emit();
  };
  const refetch = async () => {
    if (disposed || !supported) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    const version = epoch;
    const changes = new Map<string, ScriptMonitor>();
    journal = changes;
    try {
      const [result, scripts] = await Promise.all([
        backendRequest<{ monitors: ScriptMonitor[] }>('scriptMonitor.list', { workspaceId }),
        new LiveScriptsClient().list(workspaceId, { archive: 'all' }),
      ]);
      if (!current(version) || !supported) return;
      let rows = result.monitors.filter((row) => row.workspaceId === workspaceId);
      for (const row of changes.values()) rows = mergeScriptMonitor(rows, row);
      // Retain known terminal decisions even if an older server snapshot races this read.
      for (const row of snapshot.monitors)
        if (row.state !== 'active' && rows.some((item) => item.monitorId === row.monitorId)) {
          rows = rows.map((item) => (item.monitorId === row.monitorId ? row : item));
        }
      snapshot = { monitors: rows, scripts, status: 'ready' };
      emit();
    } catch (error) {
      if (!current(version)) return;
      if (isMonitorMethodMissing(error)) connection.reject();
      else {
        snapshot = { ...snapshot, status: 'failed' };
        emit();
      }
    } finally {
      inFlight = false;
      if (queued) {
        queued = false;
        void refetch();
      }
    }
  };
  const register = async () => {
    const version = ++epoch;
    supported = false;
    subscriptionId = undefined;
    snapshot = { monitors: [], scripts: [], status: 'loading' };
    emit();
    if (connection.isRejected()) {
      disable();
      return;
    }
    try {
      const hello = await backendRequest<{
        server?: { capabilities?: { scriptMonitors?: number } };
      }>('client.hello', {});
      if (!current(version)) return;
      if (connection.isRejected()) {
        disable();
        return;
      }
      if (hello.server?.capabilities?.scriptMonitors !== 1) {
        disable();
        return;
      }
      supported = true;
      const result = await backendSubscribe({
        workspaceId,
        eventTypes: ['scriptMonitor:*', 'script:state', 'script:changed'],
      });
      if (!current(version) || !supported) {
        if (result.subscriptionId) void backendUnsubscribe(result.subscriptionId, workspaceId);
        return;
      }
      subscriptionId = result.subscriptionId;
      // Subscribe first: every event after the snapshot boundary is now observed.
      void refetch();
    } catch (error) {
      if (!current(version)) return;
      if (isMonitorMethodMissing(error)) connection.reject();
      else {
        snapshot = { ...snapshot, status: 'failed' };
        emit();
      }
    }
  };
  const offNotification = onBackendNotification((notification) => {
    if (disposed || !supported || notification.method !== 'events.event') return;
    const params = notification.params as {
      subscriptionId?: string;
      event?: {
        workspaceId?: string;
        type?: ScriptMonitorEventType | 'script:state' | 'script:changed';
        data?: ScriptMonitorEvent;
      };
    };
    const event = params?.event;
    if (
      event?.workspaceId !== workspaceId ||
      (subscriptionId && params.subscriptionId && subscriptionId !== params.subscriptionId)
    )
      return;
    if (
      event?.type?.startsWith('scriptMonitor:') &&
      event.data?.monitor?.workspaceId === workspaceId
    ) {
      const row = event.data.monitor;
      journal.set(row.monitorId, row);
      snapshot = { ...snapshot, monitors: mergeScriptMonitor(snapshot.monitors, row) };
      emit();
    } else if (event?.type?.startsWith('script:')) {
      void refetch();
    }
  });
  const offReconnect = connection.listen(disable, () => {
    if (!disposed) void register();
  });
  void register();
  return {
    async mutate(
      monitorId: string,
      cancelRun: boolean,
    ): Promise<ScriptMonitorMutationResult | undefined> {
      if (!supported || disposed) return;
      const row = snapshot.monitors.find((item) => item.monitorId === monitorId);
      if (!row || row.state !== 'active') return;
      const version = epoch;
      try {
        const result = await backendRequest<ScriptMonitorMutationResult>(
          cancelRun ? 'scriptMonitor.cancelRun' : 'scriptMonitor.cancel',
          { workspaceId, monitorId },
        );
        if (!current(version)) return;
        journal.set(result.monitor.monitorId, result.monitor);
        snapshot = { ...snapshot, monitors: mergeScriptMonitor(snapshot.monitors, result.monitor) };
        emit();
        return result;
      } catch (error) {
        if (current(version) && isMonitorMethodMissing(error)) connection.reject();
        throw error;
      }
    },
    dispose() {
      disposed = true;
      offNotification();
      offReconnect();
      if (!sharedConnection) connection.dispose();
      if (subscriptionId) void backendUnsubscribe(subscriptionId, workspaceId);
    },
  };
}
