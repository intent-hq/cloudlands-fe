import { trackRuntimeRead } from '$features/events/runtime-read-lane';
import {
  isRecoverySessionRetired,
  rendererEventRecovery,
  type RendererRecoveryScope,
  type RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
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
  const key = 'script-monitors:' + JSON.stringify([workspaceId]);
  let adopted = false;
  let recoveryScope: RendererRecoveryScope | undefined;
  let recovery: RendererRecoveryHandle | undefined;
  let controller: AbortController | undefined;
  let loadedPages = 1;
  const selectedDetails = new Set<string>();
  const request = <T>(method: string, params?: unknown): Promise<T> => {
    const scope = recoveryScope;
    const invoke = () =>
      scope ? scope.request<T>(method, params) : backendRequest<T>(method, params);
    if (!['scriptMonitor.list', 'scriptMonitor.get', 'script.get'].includes(method))
      return invoke();
    const token = rendererEventRecovery.capture(key);
    return trackRuntimeRead(
      key,
      () => {
        if (disposed || recoveryScope !== scope || !token.commit(() => {}))
          throw new Error('Script monitor read superseded');
        return invoke();
      },
      method === 'scriptMonitor.list',
    );
  };
  let disposed = false;
  let epoch = 0;
  let subscriptionId: string | undefined;
  /** The recovery scope that made `subscriptionId`; undefined for a direct backend lease. */
  let subscriptionScope: RendererRecoveryScope | undefined;
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
  /** Release through whichever owner made the lease, so a recovery coordinator never keeps it. */
  const releaseSubscription = () => {
    if (!subscriptionId) return;
    if (subscriptionScope) void subscriptionScope.unsubscribe(subscriptionId);
    else void backendUnsubscribe(subscriptionId, workspaceId);
    subscriptionId = undefined;
    subscriptionScope = undefined;
  };
  const disable = () => {
    supported = false;
    detailReads.clear();
    releaseSubscription();
    snapshot = { monitors: [], scripts: [], status: 'unsupported' };
    emit();
  };
  const readPage = async (append = false) => {
    if (!supported || disposed || pageRead?.epoch === epoch) return;
    if (recovery?.status.stale) {
      recovery.refresh();
      return;
    }
    const token = rendererEventRecovery.capture(key);
    const cursor = append ? snapshot.nextCursor : undefined;
    if (append && !cursor) return;
    const read = { epoch, journal: new Map<string, ScriptMonitor | null>() };
    pageRead = read;
    snapshot = { ...snapshot, loadingMore: append };
    emit();
    try {
      const result = await request<{
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
      const committed = token.commit(() => {
        if (append) loadedPages++;
        else loadedPages = 1;
        snapshot = {
          ...snapshot,
          monitors: [...rows.values()],
          nextCursor: result.nextCursor,
          status: 'ready',
          loadingMore: false,
        };
        emit();
      });
      if (!committed && current(read.epoch) && !recovery?.status.stale)
        queueMicrotask(() => {
          void readPage();
        });
    } catch (error) {
      if (!current(read.epoch) || !token.isCurrent() || recovery?.status.stale) return;
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
    selectedDetails.clear();
    loadedPages = 1;
    releaseSubscription();
    snapshot = { monitors: [], scripts: [], status: 'loading' };
    emit();
    if (connection.isRejected()) {
      disable();
      return;
    }
    try {
      const hello = await request<{
        server?: { capabilities?: { scriptMonitors?: number } };
      }>('client.hello', {});
      if (disposed || version !== epoch) return;
      // Capability-gated only: the protocol major moves for unrelated changes.
      if (connection.isRejected() || hello.server?.capabilities?.scriptMonitors !== 2) {
        disable();
        return;
      }
      supported = true;
      const params = {
        workspaceId,
        eventTypes: ['scriptMonitor:*', 'script:changed', 'script:removed'],
      };
      const scope = recoveryScope;
      const result = scope
        ? {
            subscriptionId: (
              await scope.subscribe(params, { recover: true, signal: controller?.signal })
            )?.id,
          }
        : await backendSubscribe(params);
      if (!current(version)) {
        if (result.subscriptionId)
          void (scope
            ? scope.unsubscribe(result.subscriptionId)
            : backendUnsubscribe(result.subscriptionId, workspaceId));
        return;
      }
      subscriptionId = result.subscriptionId;
      subscriptionScope = scope;
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
  const receive = (notification: import('$shared/event-recovery/session').RecoveryNotification) => {
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
  };
  const offNotification = onBackendNotification((notification) => {
    if (!adopted) receive(notification);
  });
  const offReconnect = connection.listen(disable, () => {
    if (!disposed && !adopted) void register();
  });
  const offRecovery = rendererEventRecovery.onSession((scope) => {
    adopted = true;
    recoveryScope = scope;
    controller = new AbortController();
    const abort = controller;
    const owner = scope.registerResource({
      key,
      workspaceId,
      eventTypes: ['scriptMonitor:*', 'script:changed', 'script:removed'],
      isCurrent: () => !disposed && recoveryScope === scope,
      read: (reader) =>
        trackRuntimeRead(key, async () => {
          const monitors: ScriptMonitorSummary[] = [];
          let nextCursor: string | undefined;
          for (let page = 0; page < loadedPages; page++) {
            const result = await reader.request<{
              view: string;
              monitors: ScriptMonitorSummary[];
              nextCursor?: string;
            }>('scriptMonitor.list', {
              workspaceId,
              state: 'active',
              view: 'summary',
              limit: 100,
              ...(nextCursor ? { cursor: nextCursor } : {}),
            });
            if (result.view !== 'summary' || !Array.isArray(result.monitors))
              throw new Error('Invalid script monitor summary');
            monitors.push(
              ...result.monitors.filter(
                (row) => row.workspaceId === workspaceId && row.state === 'active',
              ),
            );
            nextCursor = result.nextCursor;
            if (!nextCursor) break;
          }
          const details: Record<string, ActiveScriptMonitor | null> = {};
          const scripts: ScriptWithState[] = [];
          for (const row of monitors) {
            if (!selectedDetails.has(row.monitorId)) continue;
            const monitor = await reader.request<ActiveScriptMonitor>('scriptMonitor.get', {
              workspaceId,
              monitorId: row.monitorId,
            });
            const script = await reader.request<ScriptWithState>('script.get', {
              workspaceId,
              scriptId: row.scriptId,
            });
            if (monitor.state === 'active') details[row.monitorId] = monitor;
            if (!script.archivedAt && !scripts.some((item) => item.id === script.id))
              scripts.push(script);
          }
          return {
            monitors,
            details,
            scripts,
            nextCursor,
            status: 'ready' as const,
            loadingMore: false,
          };
        }),
      apply: (value) => {
        retired.clear();
        snapshot = value;
        emit();
      },
      invalidate: () => {
        retired.clear();
        pageRead?.journal.clear();
      },
      retire: (error) => {
        epoch++;
        supported = false;
        detailReads.clear();
        retired.clear();
        selectedDetails.clear();
        // An ended session is not a failure: the next session re-registers, so the chat
        // card stays quiet. Lost authority does not resume on its own, so it is 'failed'
        // and the card offers Retry instead of silently dropping the rows (intent-hq/intent#7206).
        snapshot = {
          monitors: [],
          scripts: [],
          status: isRecoverySessionRetired(error) ? 'loading' : 'failed',
        };
        emit();
      },
      onEvent: (notification) => receive(notification),
    });
    recovery = owner;
    void register();
    return () => {
      abort.abort();
      owner.dispose();
      if (subscriptionId) void scope.unsubscribe(subscriptionId);
      subscriptionId = undefined;
      subscriptionScope = undefined;
      if (recovery === owner) {
        recovery = undefined;
        recoveryScope = undefined;
      }
    };
  });
  if (!adopted) void register();
  return {
    loadMore: () => readPage(true),
    /**
     * Recover from a failed read: re-read the first page on a healthy subscription,
     * otherwise register again. A no-op unless the snapshot failed.
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
      selectedDetails.add(monitorId);
      if (recovery?.status.stale) {
        recovery.refresh();
        return;
      }
      const lifetime = rendererEventRecovery.capture(key);
      const version = epoch;
      const token: { script?: ScriptWithState | null } = {};
      detailReads.set(monitorId, token);
      try {
        const [monitor, script] = await Promise.all([
          request<ActiveScriptMonitor>('scriptMonitor.get', { workspaceId, monitorId }),
          recoveryScope
            ? request<ScriptWithState>('script.get', { workspaceId, scriptId: row.scriptId })
            : new LiveScriptsClient().get(workspaceId, row.scriptId),
        ]);
        if (
          !current(version) ||
          detailReads.get(monitorId) !== token ||
          !snapshot.monitors.some((item) => item.monitorId === monitorId)
        )
          return;
        if (monitor.state !== 'active') return;
        const latestScript = token.script === undefined ? script : token.script;
        lifetime.commit(() => {
          snapshot = {
            ...snapshot,
            details: { ...snapshot.details, [monitorId]: monitor },
            scripts: [
              ...snapshot.scripts.filter((item) => item.id !== row.scriptId),
              ...(latestScript ? [latestScript] : []),
            ],
          };
          emit();
        });
      } catch (error) {
        if (!lifetime.isCurrent() || recovery?.status.stale) return;
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
      const lifetime = rendererEventRecovery.capture(key);
      try {
        const result = await request<ScriptMonitorMutationResult>(
          cancelRun ? 'scriptMonitor.cancelRun' : 'scriptMonitor.cancel',
          { workspaceId, monitorId },
        );
        if (!current(version)) return;
        if (
          !lifetime.commit(() => {
            remove(result.monitorId);
            emit();
          })
        )
          recovery?.refresh();
        return result;
      } catch (error) {
        if (current(version) && isMonitorMethodMissing(error)) connection.reject();
        throw error;
      }
    },
    dispose() {
      disposed = true;
      offRecovery();
      detailReads.clear();
      offNotification();
      offReconnect();
      if (!sharedConnection) connection.dispose();
      if (subscriptionId) void backendUnsubscribe(subscriptionId, workspaceId);
    },
  };
}
