/**
 * Browser persistence service — restores the localStorage hydrate/persist for
 * recent URLs that the browser slice models (`hydrateBrowserState` doc says
 * "load from localStorage"; the loading saga was removed). With no handler,
 * recent URLs never loaded on boot or persisted on change.
 *
 * Like `tab-state-persistence-service`, this reconnects the path WITHOUT
 * re-adding a saga and WITHOUT changing any call site:
 *   - Hydrates `recentUrls` from localStorage when `initBrowserWorkspace` is
 *     dispatched (typically on workspace mount).
 *   - After any URL-mutating action (`addRecentUrl`, `updateUrlMetadata`,
 *     `removeRecentUrl`, `clearRecentUrls`) it writes the current list back.
 *
 * Dependency-light per src/store AGENTS.md: imports only the safe-storage helper
 * and slice actions — no selectors and no store module (state is read through the
 * middleware `api.getState()`).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import type { StoreState } from "../types";
import type { RecentUrl } from "../slices/browser/browser-types";
import { MAX_RECENT_URLS } from "../slices/browser/browser-types";
import { storageKey, isRecentUrl } from "../slices/browser/browser-storage-utils";
import {
  hydrateBrowserState,
  addRecentUrl,
  updateUrlMetadata,
  removeRecentUrl,
  clearRecentUrls,
  initBrowserWorkspace,
} from "../slices/browser/browser-slice";

/** Actions whose reducer can change `recentUrls` and therefore need a write-back. */
const PERSIST_ACTION_TYPES = new Set<string>([
  addRecentUrl.type,
  updateUrlMetadata.type,
  removeRecentUrl.type,
  clearRecentUrls.type,
]);

/** Load recent URLs from localStorage, capped at MAX_RECENT_URLS. */
function loadStoredRecentUrls(workspaceId: string): RecentUrl[] {
  const stored = safeLocalStorage.getJSON<unknown>(storageKey(workspaceId));
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((item): item is RecentUrl => isRecentUrl(item))
    .slice(0, MAX_RECENT_URLS);
}

/** Persist recent URLs to localStorage for a workspace. */
function persistRecentUrls(state: StoreState, workspaceId: string): void {
  const wsState = state.browser.byWorkspaceId[workspaceId];
  if (!wsState) return;
  safeLocalStorage.setJSON(storageKey(workspaceId), wsState.recentUrls);
}

/**
 * Middleware giving the browser persistence triggers real handlers again.
 * Hydration runs on `initBrowserWorkspace` (dispatched when a workspace mounts);
 * persistence runs after each mutating action passes the reducer.
 */
export function createBrowserPersistenceMiddleware(): StoreMiddleware {
  return (api) => (next) => (action) => {
    const result = next(action);
    if (action && typeof action === "object") {
      const actionType = (action as { type?: unknown }).type;

      // Hydrate on workspace init
      if (actionType === initBrowserWorkspace.type) {
        const payload = Array.isArray((action as { payload?: unknown }).payload)
          ? ((action as { payload?: unknown }).payload as unknown[])
          : undefined;
        const workspaceId = typeof payload?.[0] === "string" ? payload[0] : undefined;
        if (workspaceId) {
          const recentUrls = loadStoredRecentUrls(workspaceId);
          api.dispatch(hydrateBrowserState(workspaceId, recentUrls));
        }
      }

      // Persist after mutations
      if (typeof actionType === "string" && PERSIST_ACTION_TYPES.has(actionType)) {
        const payload = Array.isArray((action as { payload?: unknown }).payload)
          ? ((action as { payload?: unknown }).payload as unknown[])
          : undefined;
        const workspaceId = typeof payload?.[0] === "string" ? payload[0] : undefined;
        if (workspaceId) {
          persistRecentUrls(api.getState() as StoreState, workspaceId);
        }
      }
    }
    return result;
  };
}
