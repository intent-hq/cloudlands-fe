/**
 * Stats read service — companion to the `stats` slice that owns the
 * `stats.getUsage` round-trip for the usage-stats overlay.
 *
 * The overlay dispatches `loadUsageStatsRequested(mode, key, tzOffsetMinutes)`
 * when it opens or the user switches mode/period. This middleware observes
 * that action and, fire-and-forget, calls the AppClient stats seam. The
 * response (success or failure) is dispatched back as `usageStatsLoaded` /
 * `usageStatsFailed` carrying the same mode/key so the reducer can discard
 * stale replies.
 *
 * Keeping the wire call here — not in the Svelte component — satisfies the
 * `intent/no-component-async-data-fetch` ESLint rule and matches the
 * "service middleware" pattern used by `directory-picker-read-service` and
 * `git-read-service`. READ-ONLY: this module never invokes a mutation.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import type { UsageStatsPeriod } from "$lib/client/app-client";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { createLogger } from "$lib/utils/client-logger";
import {
  loadUsageStatsRequested,
  usageStatsFailed,
  usageStatsLoaded,
} from "$store/renderer/slices/stats/stats-slice";

const logger = createLogger("StatsReadService");

async function fetchUsageStats(
  mode: UsageStatsPeriod,
  key: string | null,
  tzOffsetMinutes: number,
): Promise<void> {
  try {
    const data = await appClient.stats.getUsage(
      mode,
      mode === "24h" ? undefined : (key ?? undefined),
      tzOffsetMinutes,
    );
    appStore.dispatch(usageStatsLoaded(mode, key, data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load usage stats";
    logger.warn("stats.getUsage failed", { mode, key, error });
    appStore.dispatch(usageStatsFailed(mode, key, message));
  }
}

/** Middleware servicing `loadUsageStatsRequested` via `stats.getUsage`. */
export function createStatsReadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === loadUsageStatsRequested.type) {
      const [mode, key, tzOffsetMinutes] = (
        action as ReturnType<typeof loadUsageStatsRequested>
      ).payload;
      void fetchUsageStats(mode, key, tzOffsetMinutes);
    }
    return result;
  };
}
