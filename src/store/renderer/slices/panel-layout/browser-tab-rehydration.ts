/**
 * Restart rehydration helpers for browser tabs (intent-hq/monorepo#2789).
 *
 * A browser tab opened through the loopback/tunnel rewrite persists its
 * pre-rewrite URL in `PanelTab.browserRequestedUrl`. These pure helpers back
 * the two halves of keeping that field useful:
 *
 * - `rebaseRequestedUrlForNavigation` keeps the requested URL in step with
 *   in-tab navigations (same forward, new path) and drops it when the tab
 *   leaves the rewritten origin entirely.
 * - `collectRehydratableBrowserTabs` finds the restored tabs whose URL must
 *   be re-resolved (rewrite → probe → tunnel) for the new session.
 *
 * Pure and dependency-light on purpose: the reducer and the restore saga
 * both import from here.
 */

import type { PanelState, WorkspacePanelLayout } from './panel-layout-types';

/**
 * Derive the requested URL to keep after a webview navigation (the "auto"
 * mode of `updateTabBrowserUrl`). A navigation that stays on the tab's
 * current origin (the same rewritten/tunneled endpoint) rebases the
 * requested URL's path/query/hash onto the navigated ones, so a restore
 * lands where the user actually was. Leaving the origin clears the
 * requested URL: the tab no longer shows rewritten content, so persisting
 * the navigated URL as-is is the truthful restore target.
 *
 * Returns the requested URL to keep, or `undefined` to clear it. Never
 * throws: unparseable URLs clear the field.
 */
export function rebaseRequestedUrlForNavigation(
  previousUrl: string | undefined,
  navigatedUrl: string,
  requestedUrl: string | undefined,
): string | undefined {
  if (!requestedUrl || !previousUrl) return undefined;
  let previous: URL;
  let navigated: URL;
  let requested: URL;
  try {
    previous = new URL(previousUrl);
    navigated = new URL(navigatedUrl);
    requested = new URL(requestedUrl);
  } catch {
    return undefined;
  }
  if (previous.origin !== navigated.origin) return undefined;
  requested.pathname = navigated.pathname;
  requested.search = navigated.search;
  requested.hash = navigated.hash;
  return requested.toString();
}

/** One restored browser tab whose URL must be re-resolved for this session. */
export interface RehydratableBrowserTab {
  tabId: string;
  /** Pre-rewrite URL to re-run the rewrite on. */
  requestedUrl: string;
  /** Persisted final URL (last session's rewrite result). */
  storedUrl: string;
}

/**
 * Collect the browser tabs in a restored layout that carry a persisted
 * requested URL. Tabs without one (legacy layouts, never-rewritten URLs)
 * restore exactly as before and are never returned.
 */
export function collectRehydratableBrowserTabs(
  layout: Pick<WorkspacePanelLayout, 'panels'>,
): RehydratableBrowserTab[] {
  const out: RehydratableBrowserTab[] = [];
  for (const panel of Object.values(layout.panels) as PanelState[]) {
    for (const tab of panel.tabs) {
      if (tab.type !== 'browser' || !tab.browserRequestedUrl || !tab.browserUrl) continue;
      out.push({
        tabId: tab.id,
        requestedUrl: tab.browserRequestedUrl,
        storedUrl: tab.browserUrl,
      });
    }
  }
  return out;
}
