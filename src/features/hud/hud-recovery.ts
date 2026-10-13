import {
  rendererEventRecovery,
  type RendererRecoveryScope,
  type RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
import { acquireAgentMetadataDemand } from '$features/agent/agent-metadata-recovery';
import { trackRuntimeRead } from '$features/events/runtime-read-lane';
import { type BackendNotification } from '$lib/client/live/backend-transport';
import { selectHudWorkspaceEntities } from '$store/renderer/slices/hud/hud-selectors';
import {
  hudRecoveryReset,
  hudAttentionChanged,
  hudDisplayStatusChanged,
  hudQuestionsResolvedForWorkspace,
  hudWorkspaceStateCleared,
  hudUsageLoaded,
  hudRateHistoryLoaded,
  type HudUsageTotals,
} from '$store/renderer/slices/hud/hud-slice';
import { WorkspaceStatus, isWorkspaceDisplayStatus } from '$shared/types';
import type { StoreState } from '$store/renderer/types';

interface HudStore {
  getState(): StoreState;
  dispatch(action: { type: string }): unknown;
}
export type HudRecoveryMessage =
  | { kind: 'session'; isCurrent(): boolean }
  | { kind: 'notification'; notification: BackendNotification; isCurrent(): boolean }
  | { kind: 'refresh-stats'; isCurrent(): boolean };

/** Registry ownership bound to the root HUD saga; scheduling and cancellation stay in the saga. */
export function installHudRecovery(
  store: HudStore,
  config: { eventTypes: string[]; replaceGroup: string; rateLimit: number },
  notify: (message: HudRecoveryMessage) => void,
) {
  let disposed = false,
    generation = 0,
    adopted = false;
  let scope: RendererRecoveryScope | undefined;
  let subscriptionId: string | undefined;
  let stats: RendererRecoveryHandle | undefined;
  let reconcile = () => {};
  let retiredWorkspaces = new Set<string>();
  const capture = () => {
    const version = generation;
    return () => !disposed && generation === version;
  };
  const visibleIds = () =>
    selectHudWorkspaceEntities
      .select(store.getState())
      .filter(
        (row) => row.status !== WorkspaceStatus.Archived && row.status !== WorkspaceStatus.Deleted,
      )
      .map((row) => String(row.id));
  const off = rendererEventRecovery.onSession((session) => {
    adopted = true;
    scope = session;
    generation++;
    const live = capture();
    const abort = new AbortController();
    const workspaces = new Map<string, RendererRecoveryHandle>();
    const demands = new Map<string, () => void>();
    retiredWorkspaces = new Set();
    subscriptionId = undefined;
    const owner = session.registerResource({
      key: 'hud-stats',
      workspaceId: null,
      eventTypes: config.eventTypes,
      isCurrent: live,
      onEvent: () => notify({ kind: 'refresh-stats', isCurrent: live }),
      read: (reader) =>
        trackRuntimeRead('hud-stats', async () => ({
          usage: await reader.request<{
            totals: HudUsageTotals;
            runs?: number;
            byHourOfDay: Array<{ hour: number } & HudUsageTotals>;
          }>('stats.getUsage', { period: '24h', tzOffsetMinutes: -new Date().getTimezoneOffset() }),
          rates: await reader.request<{ samples: Array<{ bucketUtc: string } & HudUsageTotals> }>(
            'stats.getRateHistory',
            { limit: config.rateLimit },
          ),
        })),
      apply: ({ usage, rates }) => {
        if (!usage?.totals || !Array.isArray(usage.byHourOfDay) || !Array.isArray(rates?.samples))
          throw new Error('Invalid HUD recovery snapshot');
        store.dispatch(
          hudUsageLoaded({
            totals: usage.totals,
            runs: usage.runs ?? 0,
            rateSamples: usage.byHourOfDay.map((b) => ({
              hour: b.hour,
              tokens:
                b.inputTokens +
                b.outputTokens +
                b.cacheReadTokens +
                b.cacheCreationTokens +
                (b.thoughtTokens ?? 0),
            })),
            fetchedAtMs: Date.now(),
          }),
        );
        store.dispatch(
          hudRateHistoryLoaded({
            samples: rates.samples.map((row) => ({ ...row })),
            fetchedAtMs: Date.now(),
          }),
        );
      },
      invalidate: () => {},
      retire: () => {
        generation++;
        store.dispatch(hudRecoveryReset());
      },
    });
    stats = owner;
    reconcile = () => {
      if (!live()) return;
      const ids = new Set(visibleIds());
      for (const [id, resource] of workspaces)
        if (!ids.has(id)) {
          resource.dispose();
          demands.get(id)?.();
          demands.delete(id);
          workspaces.delete(id);
          store.dispatch(hudWorkspaceStateCleared(id));
        }
      for (const id of ids)
        if (!workspaces.has(id) && !retiredWorkspaces.has(id)) {
          demands.set(id, acquireAgentMetadataDemand(id, { hud: true }));
          workspaces.set(
            id,
            session.registerResource({
              key: 'hud:' + JSON.stringify([id]),
              workspaceId: id,
              eventTypes: [
                'workspace:attention-changed',
                'workspace:displayStatus-changed',
                'workspace:updated',
              ],
              isCurrent: () => live() && visibleIds().includes(id),
              read: async (reader) => {
                const result = await reader.request<Record<string, unknown>>('workspace.get', {
                  workspaceId: id,
                });
                return (result.workspace ?? result) as {
                  attention?: string;
                  displayStatus?: unknown;
                  updatedAt?: string;
                };
              },
              apply: (value) => {
                store.dispatch(hudWorkspaceStateCleared(id));
                store.dispatch(
                  hudAttentionChanged(
                    id,
                    value.attention ?? 'none',
                    value.updatedAt ?? new Date().toISOString(),
                  ),
                );
                if (isWorkspaceDisplayStatus(value.displayStatus))
                  store.dispatch(hudDisplayStatusChanged(id, value.displayStatus));
                if (
                  typeof value.displayStatus === 'string' &&
                  !['failed', 'blocked', 'needs_attention'].includes(value.displayStatus)
                )
                  store.dispatch(hudQuestionsResolvedForWorkspace(id));
              },
              invalidate: () => {},
              retire: () => {
                retiredWorkspaces.add(id);
                demands.get(id)?.();
                demands.delete(id);
                store.dispatch(hudQuestionsResolvedForWorkspace(id));
                store.dispatch(hudWorkspaceStateCleared(id));
              },
              onEvent: (notification) => {
                const event = (
                  notification.params as {
                    event?: {
                      type?: string;
                      timestamp?: string;
                      data?: { attention?: string; displayStatus?: unknown };
                    };
                  }
                )?.event;
                if (
                  event?.type === 'workspace:attention-changed' &&
                  typeof event.data?.attention === 'string'
                )
                  store.dispatch(
                    hudAttentionChanged(
                      id,
                      event.data.attention,
                      event.timestamp ?? new Date().toISOString(),
                    ),
                  );
                if (
                  event?.type === 'workspace:displayStatus-changed' &&
                  isWorkspaceDisplayStatus(event.data?.displayStatus)
                ) {
                  store.dispatch(hudDisplayStatusChanged(id, event.data.displayStatus));
                  if (!['failed', 'blocked', 'needs_attention'].includes(event.data.displayStatus))
                    store.dispatch(hudQuestionsResolvedForWorkspace(id));
                }
              },
            }),
          );
        }
    };
    reconcile();
    const offTransient = session.onNotification((notification) => {
      const params = notification.params as {
        subscriptionId?: string;
        event?: { workspaceId?: string };
      };
      if (
        live() &&
        subscriptionId &&
        notification.method === 'events.event' &&
        params?.subscriptionId === subscriptionId &&
        !retiredWorkspaces.has(String(params.event?.workspaceId))
      )
        notify({ kind: 'notification', notification, isCurrent: live });
    });
    void session
      .subscribe(
        { eventTypes: config.eventTypes, replaceGroup: config.replaceGroup },
        { recover: true, signal: abort.signal },
      )
      .then((lease) => {
        if (!live()) return;
        subscriptionId = lease?.id;
        notify({ kind: 'session', isCurrent: live });
      })
      .catch(() => {});
    return () => {
      abort.abort();
      offTransient();
      owner.dispose();
      if (stats === owner) stats = undefined;
      for (const resource of workspaces.values()) resource.dispose();
      for (const release of demands.values()) release();
      if (subscriptionId) void session.unsubscribe(subscriptionId);
      subscriptionId = undefined;
      if (scope === session) scope = undefined;
      reconcile = () => {};
    };
  });
  return {
    get scope() {
      return scope;
    },
    get adopted() {
      return adopted;
    },
    get statsStale() {
      return stats?.status.stale ?? false;
    },
    capture,
    reconcile: () => reconcile(),
    reconnect: () => {
      if (!adopted) generation++;
    },
    dispose: () => {
      disposed = true;
      generation++;
      off();
    },
  };
}
