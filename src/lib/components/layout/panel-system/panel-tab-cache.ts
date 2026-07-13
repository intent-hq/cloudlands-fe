export const PANEL_TAB_CACHE_TTL_MS = 30_000;
export const MAX_CACHED_INACTIVE_TABS = 3;

export type PanelTabCacheTab = { id: string };

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
  const nextCache = new Map<string, number>();

  for (const [tabId, timestamp] of currentCache) {
    if (existingTabIds.has(tabId)) {
      nextCache.set(tabId, timestamp);
    }
  }

  if (activeTabId && existingTabIds.has(activeTabId)) {
    nextCache.set(activeTabId, now);
  }

  for (const [tabId, timestamp] of nextCache) {
    if (tabId !== activeTabId && now - timestamp >= ttlMs) {
      nextCache.delete(tabId);
    }
  }

  const inactiveEntries = Array.from(nextCache.entries())
    .filter(([tabId]) => tabId !== activeTabId)
    .sort((a, b) => a[1] - b[1]);

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
): number | null {
  let nextDelay: number | null = null;

  for (const [tabId, timestamp] of cache) {
    if (tabId === activeTabId) continue;
    const delay = Math.max(0, ttlMs - (now - timestamp));
    nextDelay = nextDelay === null ? delay : Math.min(nextDelay, delay);
  }

  return nextDelay;
}