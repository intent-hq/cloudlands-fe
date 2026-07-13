/**
 * Browser persistence service — restores the localStorage hydrate/persist for
 * recent URLs that the browser slice models (`hydrateBrowserState` doc says
 * "load from localStorage"; the loading saga was removed). With no handler,
 * recent URLs never loaded on boot or persisted on change.
 *
 * Like `unread-tracking-persistence-service`, this reconnects the path WITHOUT
 * re-adding a saga and WITHOUT changing any call site:
 *   - On creation it hydrates `recentUrls` from localStorage per workspace.
 *   - After any URL-mutating action it writes the current list back.
 *
 * Dependency-light per src/store AGENTS.md: imports only the safe-storage helper
 * and slice actions — no selectors and no store module (state is read through the
 * middleware `api.getState()`).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import type { StoreState } from "../types";
import type { RecentUrl } from "../slices/browser/browser-types";
import { BROWSER_STORAGE_KEY_PREFIX, MAX_RECENT_URLS } from "../slices/browser/browser-types";
import {
  hydrateBrowserState,
  addRecentUrl,
  removeRecentUrl,
  clearRecentUrls,
  initBrowserWorkspace,
} from "../slices/browser/browser-slice";

/** localStorage key for a workspace's recent URLs: `browser-recent-${workspaceId}` */
function storageKey(workspaceId: string): string {
  return `${BROWSER_STORAGE_KEY_PREFIX}${workspaceId}`;
}

/** Actions whose reducer can change `recentUrls` and therefore need a write-back. */
const PERSIST_ACTION_TYPES = new Set<string>([
  addRecentUrl.type,
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

/** Type guard for `RecentUrl` (runtime validation of localStorage payloads). */
function isRecentUrl(value: unknown): value is RecentUrl {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.url === "string" &&
    typeof obj.lastVisited === "string" &&
    (obj.title === undefined || typeof obj.title === "string") &&
    (obj.favicon === undefined || typeof obj.favicon === "string")
  );
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
