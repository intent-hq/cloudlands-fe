/**
 * Git read service — the sanctioned post-saga git-status read mechanism.
 *
 * The ~13 prod dispatch sites of `loadGitStatus` lost their handler when the
 * saga runtime was removed, leaving the display stale after manual refresh or
 * external git changes. This restores the read path WITHOUT re-adding a saga and
 * WITHOUT changing any call site: `createGitReadMiddleware()` observes every
 * dispatched action and, on `loadGitStatus`, runs `refreshGitStatus(wsId)` —
 * which fetches `appClient.git.status` and dispatches `setGitStatus`.
 *
 * READ-ONLY: this module never invokes a git mutation (no stage/commit/push).
 *
 * Refreshes are coalesced per workspace via an in-flight map so rapid dispatches
 * (and the git-subscribe event refresh in `git-status-subscription.ts`) collapse
 * into a single `git.status` fetch — no thrash, and because `setGitStatus`
 * replaces the workspace status wholesale it never double-applies alongside the
 * git-write-service self-reconcile.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam, the
 * configured store, the git slice actions, and the logger (NOT git selectors —
 * importing them would evaluate `store.createSelector` while the store module is
 * still mid-initialization through the middleware chain).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { loadGitStatus, setGitStatus } from "$store/renderer/slices/git/git-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("GitReadService");

/** In-flight refreshes keyed by workspace id; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Refetch git status from the seam and converge the store to it. Errors are
 * swallowed (logged only) so a failed read leaves the prior status intact rather
 * than clearing the display. Concurrent calls for the same workspace share one
 * fetch.
 */
export async function refreshGitStatus(workspaceId: string): Promise<void> {
  const pending = inFlight.get(workspaceId);
  if (pending) return pending;

  const run = (async () => {
    try {
      const status = await appClient.git.status(workspaceId);
      if (status) appStore.dispatch(setGitStatus(workspaceId, status));
    } catch (error) {
      logger.error("Failed to load git status", error);
    } finally {
      inFlight.delete(workspaceId);
    }
  })();

  inFlight.set(workspaceId, run);
  return run;
}

/**
 * Middleware that gives `loadGitStatus` a real handler: after the action passes
 * through the reducer, it kicks off a (deduped) status refresh for the target
 * workspace. Fire-and-forget — dispatch stays synchronous and never throws.
 */
export function createGitReadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === loadGitStatus.type) {
      const wsId = Array.isArray(action.payload) ? action.payload[0] : undefined;
      if (typeof wsId === "string" && wsId.length > 0) {
        void refreshGitStatus(wsId);
      }
    }
    return result;
  };
}
