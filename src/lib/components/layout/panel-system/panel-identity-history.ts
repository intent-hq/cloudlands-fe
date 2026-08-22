import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

export function getAdjacentPanelTabId(
  tabs: readonly PanelTab[],
  activeTabId: string | null,
  direction: -1 | 1,
): string | null {
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  if (activeIndex < 0) return null;
  return tabs[activeIndex + direction]?.id ?? null;
}

export function filterPanelTabs(
  tabs: readonly PanelTab[],
  query: string,
  getTitle: (tab: PanelTab) => string,
): PanelTab[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...tabs];
  return tabs.filter((tab) => {
    const haystack = `${getTitle(tab)} ${tab.type}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
