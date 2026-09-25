export const PANEL_TAB_CACHE_TTL_MS = 30_000;
export const MAX_CACHED_INACTIVE_TABS = 3;

export type PanelTabCacheTab = { id: string; type?: string; ownerAgentId?: string };

/**
 * Agent-owned browser tabs keep their webview mounted for the agent's
 * lifetime (monorepo#2857): always cached (even before first activation),
 * exempt from TTL eviction and from the inactive-tab cap.
 */
export function isAlwaysMountedTab(tab: PanelTabCacheTab): boolean {
  return (
    tab.type === 'browser' && typeof tab.ownerAgentId === 'string' && tab.ownerAgentId.length > 0
  );
}

export type PanelTabCacheOptions = {
  ttlMs?: number;
  maxInactiveTabs?: number;
};

export function initializePanelTabCache(
  panelActive: boolean,
  tabs: readonly PanelTabCacheTab[],
  activeTabId: string | null | undefined,
  now: number,
  options?: PanelTabCacheOptions,
): Map<string, number> {
  return panelActive ? updatePanelTabCache(new Map(), tabs, activeTabId, now, options) : new Map();
}

const DEFAULT_OPTIONS = {
  ttlMs: PANEL_TAB_CACHE_TTL_MS,
  maxInactiveTabs: MAX_CACHED_INACTIVE_TABS,
};

function resolveOptions(options: PanelTabCacheOptions = {}) {
  return { ...DEFAULT_OPTIONS, ...options };
}

export function arePanelTabCachesEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [tabId, timestamp] of a) {
    if (b.get(tabId) !== timestamp) return false;
  }
  return true;
}

export function updatePanelTabCache(
  currentCache: Map<string, number>,
  tabs: readonly PanelTabCacheTab[],
  activeTabId: string | null | undefined,
  now: number,
  options?: PanelTabCacheOptions,
): Map<string, number> {
  const { ttlMs, maxInactiveTabs } = resolveOptions(options);
  const existingTabIds = new Set(tabs.map((tab) => tab.id));
  const browserTabIds = new Set(tabs.filter((tab) => tab.type === 'browser').map((tab) => tab.id));
  const alwaysMountedIds = new Set(tabs.filter(isAlwaysMountedTab).map((tab) => tab.id));
  const nextCache = new Map<string, number>();

  for (const [tabId, timestamp] of currentCache) {
    if (existingTabIds.has(tabId)) {
      nextCache.set(tabId, timestamp);
    }
  }

  if (activeTabId && existingTabIds.has(activeTabId)) {
    nextCache.set(activeTabId, now);
  }

  // Owned browser tabs mount immediately (no first-activation requirement)
  // so their webview is alive for agent ops from restore on.
  for (const tabId of alwaysMountedIds) {
    if (!nextCache.has(tabId)) nextCache.set(tabId, now);
  }

  for (const [tabId, timestamp] of nextCache) {
    if (tabId !== activeTabId && !browserTabIds.has(tabId)) {
      if (now - timestamp >= ttlMs) {
        nextCache.delete(tabId);
      }
    }
  }

  // A mounted browser owns live page state that cannot be restored from its
  // URL. Keep it until closure, outside the disposable content cache's cap.
  const inactiveEntries = Array.from(nextCache.entries())
    .filter(([tabId]) => tabId !== activeTabId && !browserTabIds.has(tabId))
    .sort(([, aTimestamp], [, bTimestamp]) => aTimestamp - bTimestamp);

  while (inactiveEntries.length > maxInactiveTabs) {
    const oldest = inactiveEntries.shift();
    if (oldest) {
      nextCache.delete(oldest[0]);
    }
  }

  return nextCache;
}

export function getNextPanelTabCacheExpiryDelay(
  cache: Map<string, number>,
  activeTabId: string | null | undefined,
  now: number,
  ttlMs = PANEL_TAB_CACHE_TTL_MS,
  tabs: readonly PanelTabCacheTab[] = [],
): number | null {
  const browserTabIds = new Set(tabs.filter((tab) => tab.type === 'browser').map((tab) => tab.id));
  let nextDelay: number | null = null;

  for (const [tabId, timestamp] of cache) {
    if (tabId === activeTabId || browserTabIds.has(tabId)) continue;
    const delay = Math.max(0, ttlMs - (now - timestamp));
    nextDelay = nextDelay === null ? delay : Math.min(nextDelay, delay);
  }

  return nextDelay;
}
