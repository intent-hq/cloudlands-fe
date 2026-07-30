/**
 * HUD subscription lifecycle — the start/stop API the /hud route calls.
 *
 * `startHudSubscription()`:
 *  - dispatches `hudActivated` (feed is live-only: activation resets state);
 *  - issues a GLOBAL `events.subscribe` (no `workspaceId` → all workspaces,
 *    PROTOCOL §6.1) with `replaceGroup: "hud-feed"` so a remount can never
 *    leak a second subscription on the same connection;
 *  - listens for `events.event` notifications, gates them on our own
 *    `subscriptionId` (§6.3 fan-out dedupe, mirroring the daemon-events
 *    bridge), maps them through `mapEventToFeedEntry`, and folds the
 *    attention/displayStatus families into their live override maps;
 *  - fetches the 24h `stats.getUsage` rollup (§5.36) and `system.status`
 *    (§5.7) once, and re-issues subscribe + refetches after a backend
 *    reconnect (RESUB-1).
 *
 * The disposer unsubscribes best-effort, removes both listeners, and
 * dispatches `hudDeactivated` (clearing the feed — no persistence).
 */
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import { isWorkspaceDisplayStatus } from '$shared/types';
import {
  hudActivated,
  hudAttentionChanged,
  hudDeactivated,
  hudDisplayStatusChanged,
  hudFeedEntryReceived,
  hudSystemStatusReceived,
  hudUsageFailed,
  hudUsageLoaded,
  type HudRateSample,
  type HudUsageTotals,
} from '$store/renderer/slices/hud/hud-slice';
import type { WorkspaceEvent } from '$features/events/types';
import { createLogger } from '$lib/utils/client-logger';
import { HUD_FEED_EVENT_TYPES, mapEventToFeedEntry } from './hud-feed-mapper';

const logger = createLogger('HudSubscription');

/** §6.1 replaceGroup key — one HUD subscription per connection, ever. */
export const HUD_REPLACE_GROUP = 'hud-feed';

function sumTotals(totals: HudUsageTotals): number {
  return (
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens
  );
}

/** Fetch the 24h usage rollup (§5.36) and fold it into the slice. */
async function loadUsage(): Promise<void> {
  try {
    const result = await backendRequest<{
      totals?: HudUsageTotals;
      runs?: number;
      byHourOfDay?: Array<{ hour: number } & HudUsageTotals>;
    }>('stats.getUsage', {
      period: '24h',
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    const totals = result?.totals;
    const byHourOfDay = result?.byHourOfDay;
    if (!totals || !Array.isArray(byHourOfDay)) {
      throw new Error(
        'stats.getUsage result is missing required `totals`/`byHourOfDay` (PROTOCOL §5.36)',
      );
    }
    const rateSamples: HudRateSample[] = byHourOfDay.map((bucket) => ({
      hour: bucket.hour,
      tokens: sumTotals(bucket),
    }));
    appStore.dispatch(
      hudUsageLoaded({
        totals,
        runs: typeof result.runs === 'number' ? result.runs : 0,
        rateSamples,
        fetchedAtMs: Date.now(),
      }),
    );
  } catch (error) {
    appStore.dispatch(hudUsageFailed(error instanceof Error ? error.message : String(error)));
  }
}

/** Fetch `system.status` (§5.7) and fold the online/uptime snapshot. */
async function loadSystemStatus(): Promise<void> {
  try {
    const result = await backendRequest<{ uptimeSeconds?: number; version?: string }>(
      'system.status',
    );
    appStore.dispatch(
      hudSystemStatusReceived({
        online: true,
        uptimeSeconds: typeof result?.uptimeSeconds === 'number' ? result.uptimeSeconds : null,
        version: typeof result?.version === 'string' ? result.version : null,
        fetchedAtMs: Date.now(),
      }),
    );
  } catch {
    appStore.dispatch(
      hudSystemStatusReceived({
        online: false,
        uptimeSeconds: null,
        version: null,
        fetchedAtMs: Date.now(),
      }),
    );
  }
}

function handleEvent(event: WorkspaceEvent): void {
  const workspaceId = typeof event.workspaceId === 'string' ? event.workspaceId : '';
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  const type = event.type as string;
  if (type === 'workspace:attention-changed') {
    const attention = data.attention;
    if (workspaceId && typeof attention === 'string') {
      appStore.dispatch(hudAttentionChanged(workspaceId, attention));
    }
  } else if (type === 'workspace:displayStatus-changed') {
    const displayStatus = data.displayStatus;
    if (workspaceId && isWorkspaceDisplayStatus(displayStatus)) {
      appStore.dispatch(hudDisplayStatusChanged(workspaceId, displayStatus));
    }
  }
  const entry = mapEventToFeedEntry(event);
  if (entry) appStore.dispatch(hudFeedEntryReceived(entry));
}

function extractEvent(params: unknown): WorkspaceEvent | null {
  if (!params || typeof params !== 'object') return null;
  const wrapped = (params as { event?: unknown }).event;
  if (wrapped && typeof wrapped === 'object') return wrapped as WorkspaceEvent;
  return params as WorkspaceEvent;
}

function extractSubscriptionId(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const id = (params as { subscriptionId?: unknown }).subscriptionId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Start the HUD data layer. Returns a disposer; call it on route unmount.
 * Idempotence is the caller's concern — the §6.1 `replaceGroup` guarantees
 * the daemon holds at most one HUD subscription per connection regardless.
 */
export function startHudSubscription(): () => void {
  let disposed = false;
  let subscriptionId: string | undefined;

  appStore.dispatch(hudActivated());

  async function subscribe(): Promise<void> {
    // Drop the stale id first so the scope gate cannot match a foreign
    // subscription that reuses it during the resubscribe window.
    subscriptionId = undefined;
    try {
      const result = await backendSubscribe<{ subscriptionId?: string }>({
        eventTypes: [...HUD_FEED_EVENT_TYPES],
        replaceGroup: HUD_REPLACE_GROUP,
      });
      if (disposed) {
        if (typeof result?.subscriptionId === 'string') {
          void backendUnsubscribe(result.subscriptionId).catch(() => {});
        }
        return;
      }
      if (typeof result?.subscriptionId === 'string' && result.subscriptionId.length > 0) {
        subscriptionId = result.subscriptionId;
      } else {
        logger.warn('events.subscribe returned no subscriptionId', result);
      }
    } catch (error) {
      logger.error('HUD events.subscribe failed', error);
    }
  }

  const removeNotificationListener = onBackendNotification((notification) => {
    if (notification.method !== 'events.event') return;
    // §6.3 fan-out dedupe: one notification per matching subscription — drop
    // copies tagged with a foreign id; accept legacy/flat envelopes (no id).
    const envelopeId = extractSubscriptionId(notification.params);
    if (envelopeId !== undefined && envelopeId !== subscriptionId) return;
    const event = extractEvent(notification.params);
    if (event) handleEvent(event);
  });

  // RESUB-1: the daemon's subscription registry is empty after a restart —
  // replay the subscribe and refresh the coarse rollups.
  const removeReconnectListener = onBackendReconnected(() => {
    void subscribe();
    void loadUsage();
    void loadSystemStatus();
  });

  void subscribe();
  void loadUsage();
  void loadSystemStatus();

  return () => {
    if (disposed) return;
    disposed = true;
    removeNotificationListener();
    removeReconnectListener();
    if (subscriptionId) {
      void backendUnsubscribe(subscriptionId).catch(() => {});
      subscriptionId = undefined;
    }
    appStore.dispatch(hudDeactivated());
  };
}
