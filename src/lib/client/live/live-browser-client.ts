/**
 * Live browser domain backed by FE-local localStorage persistence.
 *
 * Recent URLs are **explicitly FE-only state** (a deliberate carve-out from
 * the daemon-owned persistence model)
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
 *
 * The daemon tab registry (REV-2 `browser.listTabs` / `upsertTab` /
 * `removeTab` / `syncTabs` / `navigateTab` / `closeTab`) is daemon-owned and
 * goes over the wire: the host-only methods identify the reporting host by
 * the connection's hello'd `clientId`, so no client id travels as a param.
 */
import type { AppClient, BrowserClient, SubscriptionHandler, Unsubscribe } from '../app-client';
import { MAX_RECENT_URLS } from '$store/renderer/slices/browser/browser-types';
import type { RecentUrl } from '$store/renderer/slices/browser/browser-types';
import { storageKey, isRecentUrl } from '$store/renderer/slices/browser/browser-storage-utils';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import {
  isBrowserActionEnvelope,
  isBrowserTab,
  isBrowserTabListing,
  isOkResult,
  type BrowserActionEnvelope,
  type BrowserTab,
  type BrowserTabInput,
  type BrowserTabListing,
} from '$shared/types/browser-clients';
import { backendRequest } from './backend-transport';

/** Load recent URLs from localStorage, capped at MAX_RECENT_URLS. */
function loadRecentUrls(workspaceId: string): RecentUrl[] {
  const stored = safeLocalStorage.getJSON<unknown>(storageKey(workspaceId));
  if (!Array.isArray(stored)) return [];
  return stored.filter((item): item is RecentUrl => isRecentUrl(item)).slice(0, MAX_RECENT_URLS);
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

  async listTabs(workspaceId: string): Promise<BrowserTabListing[]> {
    const result = await backendRequest<{ tabs?: unknown }>('browser.listTabs', { workspaceId });
    if (!Array.isArray(result?.tabs) || !result.tabs.every(isBrowserTabListing)) {
      throw new Error('Invalid browser.listTabs response shape');
    }
    return result.tabs;
  }

  async upsertTab(
    workspaceId: string,
    tab: Omit<BrowserTabInput, 'workspaceId'>,
  ): Promise<BrowserTab> {
    const result = await backendRequest<{ tab?: unknown }>('browser.upsertTab', {
      workspaceId,
      tab,
    });
    if (!isBrowserTab(result?.tab)) {
      throw new Error('Invalid browser.upsertTab response shape');
    }
    return result.tab;
  }

  async removeTab(tabId: string): Promise<{ ok: true }> {
    const result = await backendRequest<unknown>('browser.removeTab', { tabId });
    if (!isOkResult(result)) {
      throw new Error('Invalid browser.removeTab response shape');
    }
    return result;
  }

  async syncTabs(tabs: BrowserTabInput[]): Promise<{ drop: string[] }> {
    const result = await backendRequest<{ drop?: unknown }>('browser.syncTabs', { tabs });
    if (!Array.isArray(result?.drop) || !result.drop.every((id) => typeof id === 'string')) {
      throw new Error('Invalid browser.syncTabs response shape');
    }
    return { drop: result.drop };
  }

  async navigateTab(tabId: string, url: string): Promise<BrowserActionEnvelope> {
    const result = await backendRequest<unknown>('browser.navigateTab', { tabId, url });
    if (!isBrowserActionEnvelope(result)) {
      throw new Error('Invalid browser.navigateTab response shape');
    }
    return result;
  }

  async closeTab(tabId: string, options?: { force?: boolean }): Promise<{ ok: true }> {
    const result = await backendRequest<unknown>('browser.closeTab', {
      tabId,
      ...(options?.force === undefined ? {} : { force: options.force }),
    });
    if (!isOkResult(result)) {
      throw new Error('Invalid browser.closeTab response shape');
    }
    return result;
  }
}

// Tied to AppClient["browser"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient['browser'] | undefined = undefined as
  LiveBrowserClient | undefined;
void _interfaceCheck;
