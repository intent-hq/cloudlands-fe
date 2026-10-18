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
  ScriptMonitorMutationResult,
  ScriptMonitorSummary,
  ActiveScriptMonitor,
} from './types';

type MonitorStatus = 'loading' | 'ready' | 'failed' | 'unsupported';
export interface ScriptMonitorSnapshot {
  monitors: ScriptMonitorSummary[];
  details?: Record<string, ActiveScriptMonitor | null>;
  nextCursor?: string;
  loadingMore?: boolean;
  scripts: ScriptWithState[];
  status: MonitorStatus;
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

/** Each lease reads one visible page. Event journals live only as long as their reads. */
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
  let pageRead: { epoch: number; journal: Map<string, ScriptMonitor | null> } | undefined;
  const retired = new Set<string>();
  const detailReads = new Map<string, { script?: ScriptWithState | null }>();
  const emit = () => {
    if (!disposed) handler(snapshot);
  };
  const current = (version: number) => !disposed && epoch === version && supported;
  const remove = (id: string) => {
    retired.add(id);
    if (retired.size > 1000) retired.delete(retired.values().next().value!);
    pageRead?.journal.set(id, null);
    detailReads.delete(id);
    const { [id]: _removed, ...details } = snapshot.details ?? {};
    const monitors = snapshot.monitors.filter((row) => row.monitorId !== id);
    const scriptIds = new Set(monitors.map((row) => row.scriptId));
    snapshot = {
      ...snapshot,
      monitors,
      details,
      scripts: snapshot.scripts.filter((row) => scriptIds.has(row.id)),
    };
  };
  const disable = () => {
    supported = false;
    detailReads.clear();
    if (subscriptionId) void backendUnsubscribe(subscriptionId, workspaceId);
    subscriptionId = undefined;
    snapshot = { monitors: [], scripts: [], status: 'unsupported' };
    emit();
  };
  const readPage = async (append = false) => {
    if (!supported || disposed || pageRead?.epoch === epoch) return;
    const cursor = append ? snapshot.nextCursor : undefined;
    if (append && !cursor) return;
    const read = { epoch, journal: new Map<string, ScriptMonitor | null>() };
    pageRead = read;
    snapshot = { ...snapshot, loadingMore: append };
    emit();
    try {
      const result = await backendRequest<{
        view: 'summary';
        monitors: ScriptMonitorSummary[];
        nextCursor?: string;
      }>('scriptMonitor.list', {
        workspaceId,
        view: 'summary',
        state: 'active',
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (!current(read.epoch)) return;
      if (result?.view !== 'summary' || !Array.isArray(result.monitors)) {
        connection.reject();
        return;
      }
      const rows = new Map((append ? snapshot.monitors : []).map((row) => [row.monitorId, row]));
      for (const row of result.monitors)
        if (
          row.workspaceId === workspaceId &&
          row.state === 'active' &&
          !retired.has(row.monitorId)
        )
          rows.set(row.monitorId, row);
      for (const [id, row] of read.journal) {
        if (!row || row.state !== 'active') rows.delete(id);
        else rows.set(id, row);
      }
      snapshot = {
        ...snapshot,
        monitors: [...rows.values()],
        nextCursor: result.nextCursor,
        status: 'ready',
        loadingMore: false,
      };
      emit();
    } catch (error) {
      if (!current(read.epoch)) return;
      if (isMonitorMethodMissing(error)) connection.reject();
      else {
        // A failed extra page keeps the loaded rows usable; Load more stays the retry.
        snapshot = append
          ? { ...snapshot, loadingMore: false }
          : { ...snapshot, status: 'failed', loadingMore: false };
        emit();
      }
    } finally {
      if (pageRead === read) pageRead = undefined;
    }
  };
  const register = async () => {
    const version = ++epoch;
    retired.clear();
    supported = false;
    detailReads.clear();
    if (subscriptionId) void backendUnsubscribe(subscriptionId, workspaceId);
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
      if (disposed || version !== epoch) return;
      // Capability-gated only: the protocol major moves for unrelated changes.
      if (connection.isRejected() || hello.server?.capabilities?.scriptMonitors !== 2) {
        disable();
        return;
      }
      supported = true;
      const result = await backendSubscribe({
        workspaceId,
        eventTypes: ['scriptMonitor:*', 'script:changed', 'script:removed'],
      });
      if (!current(version)) {
        if (result.subscriptionId) void backendUnsubscribe(result.subscriptionId, workspaceId);
        return;
      }
      subscriptionId = result.subscriptionId;
      await readPage();
    } catch (error) {
      if (disposed || version !== epoch) return;
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
        type?: string;
        data?: ScriptMonitorEvent & { scriptId?: string; script?: ScriptWithState };
      };
    };
    const event = params?.event;
    if (
      event?.workspaceId !== workspaceId ||
      (subscriptionId && params.subscriptionId && subscriptionId !== params.subscriptionId)
    )
      return;
    if (
      event.type?.startsWith('scriptMonitor:') &&
      event.data?.monitor.workspaceId === workspaceId
    ) {
      const row = event.data.monitor;
      if (row.state !== 'active') remove(row.monitorId);
      else if (!retired.has(row.monitorId)) {
        // Registration snapshots are active only; terminal events invalidate all pending replies.
        pageRead?.journal.set(row.monitorId, row);
        snapshot = {
          ...snapshot,
          monitors: [...snapshot.monitors.filter((item) => item.monitorId !== row.monitorId), row],
        };
      }
      emit();
    } else if (event.type === 'script:changed' || event.type === 'script:removed') {
      const id = event.data?.scriptId;
      if (!id) return;
      const script = event.data?.script;
      for (const row of snapshot.monitors) {
        const pending = detailReads.get(row.monitorId);
        if (row.scriptId === id && pending)
          pending.script = script && !script.archivedAt ? script : null;
      }
      snapshot = {
        ...snapshot,
        scripts: snapshot.scripts.flatMap((row) =>
          row.id !== id ? [row] : script && !script.archivedAt ? [script] : [],
        ),
      };
      emit();
    }
  });
  const offReconnect = connection.listen(disable, () => {
    if (!disposed) void register();
  });
  void register();
  return {
    loadMore: () => readPage(true),
    /**
     * Recover from a failed read: re-read the first page on a healthy subscription,
     * otherwise register again. A no-op unless the snapshot failed (intent-hq/intent#7206).
     */
    retry() {
      if (disposed || snapshot.status !== 'failed') return;
      if (supported && subscriptionId) void readPage();
      else void register();
    },
    async details(monitorId: string) {
      if (!supported || disposed || detailReads.has(monitorId)) return;
      const row = snapshot.monitors.find((item) => item.monitorId === monitorId);
      if (!row) return;
      const version = epoch;
      const token: { script?: ScriptWithState | null } = {};
      detailReads.set(monitorId, token);
      try {
        const [monitor, script] = await Promise.all([
          backendRequest<ActiveScriptMonitor>('scriptMonitor.get', { workspaceId, monitorId }),
          new LiveScriptsClient().get(workspaceId, row.scriptId),
        ]);
        if (
          !current(version) ||
          detailReads.get(monitorId) !== token ||
          !snapshot.monitors.some((item) => item.monitorId === monitorId)
        )
          return;
        if (monitor.state !== 'active') return;
        const latestScript = token.script === undefined ? script : token.script;
        snapshot = {
          ...snapshot,
          details: { ...snapshot.details, [monitorId]: monitor },
          scripts: [
            ...snapshot.scripts.filter((item) => item.id !== row.scriptId),
            ...(latestScript ? [latestScript] : []),
          ],
        };
        emit();
      } catch (error) {
        if (current(version) && isMonitorMethodMissing(error)) connection.reject();
        else if (current(version) && detailReads.get(monitorId) === token) {
          snapshot = { ...snapshot, details: { ...snapshot.details, [monitorId]: null } };
          emit();
        }
      } finally {
        if (detailReads.get(monitorId) === token) detailReads.delete(monitorId);
      }
    },
    async mutate(
      monitorId: string,
      cancelRun: boolean,
    ): Promise<ScriptMonitorMutationResult | undefined> {
      if (!supported || disposed || !snapshot.monitors.some((row) => row.monitorId === monitorId))
        return;
      const version = epoch;
      try {
        const result = await backendRequest<ScriptMonitorMutationResult>(
          cancelRun ? 'scriptMonitor.cancelRun' : 'scriptMonitor.cancel',
          { workspaceId, monitorId },
        );
        if (!current(version)) return;
        remove(result.monitorId);
        emit();
        return result;
      } catch (error) {
        if (current(version) && isMonitorMethodMissing(error)) connection.reject();
        throw error;
      }
    },
    dispose() {
      disposed = true;
      detailReads.clear();
      offNotification();
      offReconnect();
      if (!sharedConnection) connection.dispose();
      if (subscriptionId) void backendUnsubscribe(subscriptionId, workspaceId);
    },
  };
}
