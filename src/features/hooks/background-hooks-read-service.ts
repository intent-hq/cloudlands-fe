/**
 * Background-hooks read service — companion to the `backgroundHooks` slice
 * that owns the `hook:*` live subscription (PROTOCOL §5.40 / §6.5) for the
 * `BackgroundHooksRow` chip row.
 *
 * The row dispatches `backgroundHooksSubscribeRequested(workspaceId)` on
 * mount and `backgroundHooksUnsubscribeRequested(workspaceId)` on teardown.
 * This middleware refcounts subscribers per workspace: the first subscriber
 * opens `subscribeBackgroundHooks` (events.subscribe + `hook.list` seed +
 * event folds) and every emission is dispatched back as
 * `backgroundHooksUpdated`; the last unsubscribe disposes the transport
 * subscription and clears the slice. The `runBackgroundHookRequested` /
 * `cancelBackgroundHookRequested` triggers forward to `hook.runNow` /
 * `hook.cancel` fire-and-forget — the daemon's `hook:*` events converge the
 * list, so no success action is needed. `backgroundHooksRefetchRequested`
 * routes to the live subscription's `refetch` (an on-demand `hook.list`
 * re-seed) so consumers can refresh fields events never carry, e.g.
 * `lastLogs` (§5.40).
 *
 * Keeping the wire calls here — not in the Svelte component — satisfies the
 * `intent/no-component-async-data-fetch` ESLint rule and matches the
 * "service middleware" pattern used by `stats-read-service` and
 * `directory-picker-read-service`.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { store as appStore } from "$store/renderer/store";
import { createLogger } from "$lib/utils/client-logger";
import {
  backgroundHooksCleared,
  backgroundHooksRefetchRequested,
  backgroundHooksSubscribeRequested,
  backgroundHooksUnsubscribeRequested,
  backgroundHooksUpdated,
  cancelBackgroundHookRequested,
  runBackgroundHookRequested,
} from "$store/renderer/slices/background-hooks/background-hooks-slice";
import {
  cancelHook,
  runHookNow,
  subscribeBackgroundHooks,
  type BackgroundHooksSubscription,
} from "./background-hooks-service";

const logger = createLogger("BackgroundHooksReadService");

/** First payload element, treated as a workspace ID string. */
function workspaceIdOf(action: { payload?: unknown }): string | null {
  if (!Array.isArray(action.payload)) return null;
  const raw = action.payload[0];
  return typeof raw === "string" && raw ? raw : null;
}

/** `[workspaceId, hookId]` tuple payload, or null when malformed. */
function hookRefOf(action: { payload?: unknown }): [string, string] | null {
  if (!Array.isArray(action.payload)) return null;
  const [workspaceId, hookId] = action.payload;
  if (typeof workspaceId !== "string" || typeof hookId !== "string") return null;
  return [workspaceId, hookId];
}

/**
 * Middleware servicing the background-hooks triggers. Fire-and-forget —
 * dispatch stays synchronous; the slice converges via `backgroundHooksUpdated`.
 */
export function createBackgroundHooksMiddleware(): StoreMiddleware {
  /** Live subscriptions refcounted per workspace. */
  const active = new Map<string, { count: number; subscription: BackgroundHooksSubscription }>();

  return () => (next) => (action) => {
    const result = next(action);
    if (!action) return result;

    if (action.type === backgroundHooksSubscribeRequested.type) {
      const workspaceId = workspaceIdOf(action);
      if (workspaceId) {
        const entry = active.get(workspaceId);
        if (entry) {
          entry.count += 1;
        } else {
          const subscription = subscribeBackgroundHooks(workspaceId, (hooks) => {
            appStore.dispatch(backgroundHooksUpdated(workspaceId, hooks));
          });
          active.set(workspaceId, { count: 1, subscription });
        }
      }
    } else if (action.type === backgroundHooksUnsubscribeRequested.type) {
      const workspaceId = workspaceIdOf(action);
      if (workspaceId) {
        const entry = active.get(workspaceId);
        if (entry) {
          entry.count -= 1;
          if (entry.count <= 0) {
            active.delete(workspaceId);
            entry.subscription.dispose();
            appStore.dispatch(backgroundHooksCleared(workspaceId));
          }
        }
      }
    } else if (action.type === backgroundHooksRefetchRequested.type) {
      const workspaceId = workspaceIdOf(action);
      if (workspaceId) active.get(workspaceId)?.subscription.refetch();
    } else if (action.type === runBackgroundHookRequested.type) {
      const ref = hookRefOf(action);
      if (ref) {
        const [workspaceId, hookId] = ref;
        void runHookNow(workspaceId, hookId).catch((error) => {
          logger.error("hook.runNow failed", { workspaceId, hookId, error });
        });
      }
    } else if (action.type === cancelBackgroundHookRequested.type) {
      const ref = hookRefOf(action);
      if (ref) {
        const [workspaceId, hookId] = ref;
        void cancelHook(workspaceId, hookId).catch((error) => {
          logger.error("hook.cancel failed", { workspaceId, hookId, error });
        });
      }
    }

    return result;
  };
}
