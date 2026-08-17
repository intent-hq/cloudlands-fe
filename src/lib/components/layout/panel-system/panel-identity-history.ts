import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

export const PANEL_IDENTITY_SEARCH_THRESHOLD = 6;

export function getDistinctPanelIdentityValue(
  value: string | null | undefined,
  comparedValues: readonly (string | null | undefined)[],
): string | null {
  const trimmedValue = value?.trim();
  if (!trimmedValue) return null;

  const normalizedValue = trimmedValue.toLocaleLowerCase();
  return comparedValues.some(
    (comparedValue) => comparedValue?.trim().toLocaleLowerCase() === normalizedValue,
  )
    ? null
    : trimmedValue;
}

export function getPanelIdentityContext(title: string, context: string | null): string | null {
  const trimmedContext = context?.trim();
  if (!trimmedContext) return null;

  const normalizedTitle = title.trim().toLocaleLowerCase();
  if (trimmedContext.toLocaleLowerCase() === normalizedTitle) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmedContext)) return trimmedContext;

  const normalizedPath = trimmedContext.replaceAll('\\', '/');
  const lastSlash = normalizedPath.lastIndexOf('/');
  const basename = normalizedPath.slice(lastSlash + 1);
  if (basename.toLocaleLowerCase() !== normalizedTitle) return trimmedContext;

  const directory = normalizedPath.slice(0, lastSlash);
  return directory && directory !== '.' ? directory : null;
}

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
