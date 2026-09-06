export const PANEL_TAB_CACHE_TTL_MS = 30_000;
export const BROWSER_TAB_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes for browser tabs
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
  const tabTypeMap = new Map(tabs.map((tab) => [tab.id, tab.type]));
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
    if (tabId !== activeTabId && !alwaysMountedIds.has(tabId)) {
      // Use longer TTL for browser tabs to avoid unnecessary reloads
      const tabType = tabTypeMap.get(tabId);
      const effectiveTtl = tabType === 'browser' ? BROWSER_TAB_CACHE_TTL_MS : ttlMs;
      if (now - timestamp >= effectiveTtl) {
        nextCache.delete(tabId);
      }
    }
  }

  const inactiveEntries = Array.from(nextCache.entries())
    .filter(([tabId]) => tabId !== activeTabId && !alwaysMountedIds.has(tabId))
    .sort(([aId, aTimestamp], [bId, bTimestamp]) => {
      const aIsBrowser = tabTypeMap.get(aId) === 'browser';
      const bIsBrowser = tabTypeMap.get(bId) === 'browser';
      if (aIsBrowser !== bIsBrowser) return aIsBrowser ? 1 : -1;
      return aTimestamp - bTimestamp;
    });

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
  const tabTypeMap = new Map(tabs.map((tab) => [tab.id, tab.type]));
  const alwaysMountedIds = new Set(tabs.filter(isAlwaysMountedTab).map((tab) => tab.id));
  let nextDelay: number | null = null;

  for (const [tabId, timestamp] of cache) {
    if (tabId === activeTabId || alwaysMountedIds.has(tabId)) continue;
    const tabType = tabTypeMap.get(tabId);
    const effectiveTtl = tabType === 'browser' ? BROWSER_TAB_CACHE_TTL_MS : ttlMs;
    const delay = Math.max(0, effectiveTtl - (now - timestamp));
    nextDelay = nextDelay === null ? delay : Math.min(nextDelay, delay);
  }

  return nextDelay;
}
