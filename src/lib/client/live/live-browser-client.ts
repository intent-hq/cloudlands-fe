/**
 * Live browser domain backed by FE-local localStorage persistence.
 *
 * Recent URLs are **explicitly FE-only state** (IMPLEMENTATION_SPEC §9 Group C)
 * — do NOT add a daemon RPC. The domain owns `recentUrls(workspaceId)`, which
 * reads the per-workspace list from localStorage (keyed per workspace; capped
 * at `MAX_RECENT_URLS`), and `subscribe()`, which emits once, consistent with
 * other live clients.
 *
 * The browser slice already models this (`hydrateBrowserState` doc says "load
 * from localStorage"; the loading saga was removed). This restores that
 * round-trip.
 *
 * Persistence is handled by the browser persistence middleware, which observes
 * `addRecentUrl`/`updateUrlMetadata`/`removeRecentUrl`/`clearRecentUrls` reducer
 * updates and writes back to localStorage after the reducer runs.
 */
import type {
  AppClient,
  BrowserClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import { MAX_RECENT_URLS } from "$store/renderer/slices/browser/browser-types";
import type { RecentUrl } from "$store/renderer/slices/browser/browser-types";
import { storageKey, isRecentUrl } from "$store/renderer/slices/browser/browser-storage-utils";
import { safeLocalStorage } from "$lib/utils/safe-storage";

/** Load recent URLs from localStorage, capped at MAX_RECENT_URLS. */
function loadRecentUrls(workspaceId: string): RecentUrl[] {
  const stored = safeLocalStorage.getJSON<unknown>(storageKey(workspaceId));
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((item): item is RecentUrl => isRecentUrl(item))
    .slice(0, MAX_RECENT_URLS);
}

export class LiveBrowserClient implements BrowserClient {
  async recentUrls(workspaceId: string): Promise<RecentUrl[]> {
    return loadRecentUrls(workspaceId);
  }

  subscribe(handler: SubscriptionHandler<RecentUrl[]>): Unsubscribe {
    // Emit once with an empty list (workspace-agnostic default). The
    // workspace-scoped hydration happens via the boot-hydration middleware or
    // the `initBrowserWorkspace` trigger, which reads localStorage and
    // dispatches `hydrateBrowserState`.
    handler([]);
    return () => {};
  }
}

// Tied to AppClient["browser"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient["browser"] | undefined = undefined as
  | LiveBrowserClient
  | undefined;
void _interfaceCheck;
