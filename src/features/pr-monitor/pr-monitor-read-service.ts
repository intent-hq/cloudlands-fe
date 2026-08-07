/**
 * PR-monitor read service — companion to the `prMonitor` slice that owns the
 * `prMonitor:*` live subscription (PROTOCOL §6.9 / §6.5) for the
 * `MonitoredPrsRow` chip row and the PR-list/card surfaces.
 *
 * Consumers dispatch `prMonitorsSubscribeRequested(workspaceId)` on mount
 * and `prMonitorsUnsubscribeRequested(workspaceId)` on teardown. This
 * middleware refcounts subscribers per workspace: the first subscriber opens
 * `subscribePrMonitors` (events.subscribe + `prMonitor.list` seed + event
 * folds) and every emission is dispatched back as `prMonitorsUpdated`; the
 * last unsubscribe disposes the transport subscription and clears the slice.
 * The `flushPrMonitorRequested` / `cancelPrMonitorRequested` triggers
 * forward to `prMonitor.flush` / `prMonitor.cancel` fire-and-forget — the
 * daemon's `prMonitor:*` events converge the list, so no success action is
 * needed.
 *
 * Keeping the wire calls here — not in the Svelte components — satisfies the
 * `intent/no-component-async-data-fetch` ESLint rule and matches the
 * "service middleware" pattern used by `background-hooks-read-service`.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { store as appStore } from "$store/renderer/store";
import { createLogger } from "$lib/utils/client-logger";
import {
  cancelPrMonitorRequested,
  flushPrMonitorRequested,
  prMonitorsCleared,
  prMonitorsSubscribeRequested,
  prMonitorsUnsubscribeRequested,
  prMonitorsUpdated,
} from "$store/renderer/slices/pr-monitor/pr-monitor-slice";
import {
  cancelPrMonitor,
  flushPrMonitor,
  subscribePrMonitors,
  type PrMonitorsSubscription,
} from "./pr-monitor-service";

const logger = createLogger("PrMonitorReadService");

/** First payload element, treated as a workspace ID string. */
function workspaceIdOf(action: { payload?: unknown }): string | null {
  if (!Array.isArray(action.payload)) return null;
  const raw = action.payload[0];
  return typeof raw === "string" && raw ? raw : null;
}

/** `[workspaceId, monitorId]` tuple payload, or null when malformed. */
function monitorRefOf(action: { payload?: unknown }): [string, string] | null {
  if (!Array.isArray(action.payload)) return null;
  const [workspaceId, monitorId] = action.payload;
  if (typeof workspaceId !== "string" || typeof monitorId !== "string") return null;
  return [workspaceId, monitorId];
}

/**
 * Middleware servicing the pr-monitor triggers. Fire-and-forget — dispatch
 * stays synchronous; the slice converges via `prMonitorsUpdated`.
 */
export function createPrMonitorMiddleware(): StoreMiddleware {
  /** Live subscriptions refcounted per workspace. */
  const active = new Map<string, { count: number; subscription: PrMonitorsSubscription }>();

  return () => (next) => (action) => {
    const result = next(action);
    if (!action) return result;

    if (action.type === prMonitorsSubscribeRequested.type) {
      const workspaceId = workspaceIdOf(action);
      if (workspaceId) {
        const entry = active.get(workspaceId);
        if (entry) {
          entry.count += 1;
        } else {
          const subscription = subscribePrMonitors(workspaceId, (monitors) => {
            appStore.dispatch(prMonitorsUpdated(workspaceId, monitors));
          });
          active.set(workspaceId, { count: 1, subscription });
        }
      }
    } else if (action.type === prMonitorsUnsubscribeRequested.type) {
      const workspaceId = workspaceIdOf(action);
      if (workspaceId) {
        const entry = active.get(workspaceId);
        if (entry) {
          entry.count -= 1;
          if (entry.count <= 0) {
            active.delete(workspaceId);
            entry.subscription.dispose();
            appStore.dispatch(prMonitorsCleared(workspaceId));
          }
        }
      }
    } else if (action.type === flushPrMonitorRequested.type) {
      const ref = monitorRefOf(action);
      if (ref) {
        const [workspaceId, monitorId] = ref;
        void flushPrMonitor(workspaceId, monitorId).catch((error) => {
          logger.error("prMonitor.flush failed", { workspaceId, monitorId, error });
        });
      }
    } else if (action.type === cancelPrMonitorRequested.type) {
      const ref = monitorRefOf(action);
      if (ref) {
        const [workspaceId, monitorId] = ref;
        void cancelPrMonitor(workspaceId, monitorId).catch((error) => {
          logger.error("prMonitor.cancel failed", { workspaceId, monitorId, error });
        });
      }
    }

    return result;
  };
}
