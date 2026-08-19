import { migratePanelCanvasWidth } from './panel-layout-width-provenance';
import { panelTabsAreEquivalent } from './panel-tab-identity';
import {
  PANEL_LAYOUT_PERSISTENCE_VERSION,
  isPanelColumnCount,
  type PanelColumnCount,
  type PanelLayoutNode,
  type PanelState,
  type PanelTab,
  type WorkspacePanelLayout,
} from './panel-layout-types';

const LEGACY_VISIBLE_COLUMN_LIMIT = 3;

function collectLeafIds(node: unknown, result: string[]): void {
  if (!node || typeof node !== 'object') return;
  const candidate = node as Partial<PanelLayoutNode>;
  if (candidate.type === 'panel') {
    if (typeof candidate.panelId === 'string' && candidate.panelId) result.push(candidate.panelId);
    return;
  }
  if (candidate.type !== 'split' || !Array.isArray(candidate.children)) return;
  for (const child of candidate.children) collectLeafIds(child, result);
}

function hasValidGeometry(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const candidate = node as Partial<PanelLayoutNode>;
  if (candidate.type === 'panel') return typeof candidate.panelId === 'string';
  if (
    candidate.type !== 'split' ||
    (candidate.direction !== 'horizontal' && candidate.direction !== 'vertical') ||
    !Array.isArray(candidate.children) ||
    candidate.children.length === 0 ||
    !Array.isArray(candidate.sizes) ||
    candidate.sizes.length !== candidate.children.length ||
    candidate.sizes.some((size) => typeof size !== 'number' || !Number.isFinite(size) || size <= 0)
  ) {
    return false;
  }
  return candidate.children.every(hasValidGeometry);
}

function cleanPanel(panel: PanelState, workspaceId: string): PanelState | null {
  const validTabs = panel.tabs.filter(
    (tab): tab is PanelTab =>
      !!tab &&
      typeof tab === 'object' &&
      typeof tab.id === 'string' &&
      (!tab.workspaceId || tab.workspaceId === workspaceId),
  );
  if (panel.tabs.length > 0 && validTabs.length === 0) return null;
  const tabs: PanelTab[] = [];
  for (const tab of validTabs) {
    if (tabs.some((existing) => existing.id === tab.id || panelTabsAreEquivalent(existing, tab))) {
      continue;
    }
    tabs.push(tab);
  }
  const activeTabId = tabs.some((tab) => tab.id === panel.activeTabId)
    ? panel.activeTabId
    : (tabs[0]?.id ?? null);
  const { pinned: _pinned, ...clean } = panel as PanelState & { pinned?: unknown };
  return { ...clean, tabs, activeTabId };
}

function fixedColumnRoot(panelIds: string[]): PanelLayoutNode {
  if (panelIds.length === 1) return { type: 'panel', panelId: panelIds[0] };
  return {
    type: 'split',
    direction: 'horizontal',
    children: panelIds.map((panelId) => ({ type: 'panel', panelId })),
    sizes: panelIds.map(() => 100 / panelIds.length),
  };
}

function isCurrentFixedLayout(
  layout: WorkspacePanelLayout,
  orderedIds: string[],
): layout is WorkspacePanelLayout & { columnCount: PanelColumnCount } {
  if (
    layout.version !== PANEL_LAYOUT_PERSISTENCE_VERSION ||
    !isPanelColumnCount(layout.columnCount) ||
    orderedIds.length !== layout.columnCount ||
    !hasValidGeometry(layout.root)
  ) {
    return false;
  }
  if (orderedIds.length === 1) return layout.root.type === 'panel';
  return (
    layout.root.type === 'split' &&
    layout.root.direction === 'horizontal' &&
    layout.root.children.every((child) => child.type === 'panel')
  );
}

function sharedFields(layout: WorkspacePanelLayout) {
  return {
    ...(layout.hiddenTabs !== undefined ? { hiddenTabs: layout.hiddenTabs } : {}),
    ...(layout.deferSpecTab !== undefined ? { deferSpecTab: layout.deferSpecTab } : {}),
    ...(layout.newWorkspaceLifecycle !== undefined
      ? { newWorkspaceLifecycle: layout.newWorkspaceLifecycle }
      : {}),
  };
}

export function migratePanelLayoutForWorkspace(
  workspaceId: string,
  layout: WorkspacePanelLayout,
): WorkspacePanelLayout {
  const rootedIds: string[] = [];
  collectLeafIds(layout.root, rootedIds);
  const orderedIds = [...new Set([...rootedIds, ...Object.keys(layout.panels)])];
  const cleanedPanels = new Map<string, PanelState>();
  for (const panelId of orderedIds) {
    const panel = layout.panels[panelId];
    if (!panel || panel.id !== panelId || !Array.isArray(panel.tabs)) continue;
    const cleaned = cleanPanel(panel, workspaceId);
    if (cleaned) cleanedPanels.set(panelId, cleaned);
  }

  const availableIds = orderedIds.filter((panelId) => cleanedPanels.has(panelId));
  if (isCurrentFixedLayout(layout, availableIds)) {
    const width = migratePanelCanvasWidth(layout.canvasWidth, layout.canvasWidthSource);
    const panels = Object.fromEntries(
      availableIds.flatMap((id) => {
        const panel = cleanedPanels.get(id);
        return panel ? [[id, panel]] : [];
      }),
    );
    return {
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      root: layout.root,
      panels,
      focusedPanelId:
        layout.focusedPanelId && cleanedPanels.has(layout.focusedPanelId)
          ? layout.focusedPanelId
          : availableIds[0],
      columnCount: layout.columnCount,
      ...width,
      ...sharedFields(layout),
    };
  }

  if (availableIds.length === 0) {
    const panelId = 'panel-empty';
    return {
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      root: { type: 'panel', panelId },
      panels: { [panelId]: { id: panelId, tabs: [], activeTabId: null } },
      focusedPanelId: panelId,
      columnCount: 1,
      canvasWidth: null,
      canvasWidthSource: null,
      ...sharedFields(layout),
    };
  }

  const columnCount = Math.min(
    LEGACY_VISIBLE_COLUMN_LIMIT,
    availableIds.length,
  ) as PanelColumnCount;
  const visibleIds = availableIds.slice(0, columnCount);
  const visiblePanels = Object.fromEntries(
    visibleIds.flatMap((id) => {
      const panel = cleanedPanels.get(id);
      return panel ? [[id, panel]] : [];
    }),
  );
  const rightmostId = visibleIds.at(-1);
  if (!rightmostId) {
    const panelId = 'panel-empty';
    return {
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      root: { type: 'panel', panelId },
      panels: { [panelId]: { id: panelId, tabs: [], activeTabId: null } },
      focusedPanelId: panelId,
      columnCount: 1,
      canvasWidth: null,
      canvasWidthSource: null,
      ...sharedFields(layout),
    };
  }
  const rightmost = visiblePanels[rightmostId];
  const tabs = [...rightmost.tabs];
  const hasOverflow = availableIds.length > columnCount;
  const visibleTabs = Object.values(visiblePanels).flatMap((panel) => panel.tabs);
  let overflowActiveTabId: string | null = null;
  for (const panelId of availableIds.slice(columnCount)) {
    const panel = cleanedPanels.get(panelId);
    if (!panel) continue;
    for (const tab of panel.tabs) {
      if (
        visibleTabs.some(
          (existing) => existing.id === tab.id || panelTabsAreEquivalent(existing, tab),
        )
      ) {
        continue;
      }
      tabs.push(tab);
      visibleTabs.push(tab);
    }
    if (panelId === layout.focusedPanelId) overflowActiveTabId = panel.activeTabId;
  }
  visiblePanels[rightmostId] = {
    ...rightmost,
    tabs,
    activeTabId:
      overflowActiveTabId && tabs.some((tab) => tab.id === overflowActiveTabId)
        ? overflowActiveTabId
        : rightmost.activeTabId,
    pristine: hasOverflow && tabs.length > 0 ? false : rightmost.pristine,
  };
  const width = hasValidGeometry(layout.root)
    ? migratePanelCanvasWidth(layout.canvasWidth, layout.canvasWidthSource)
    : { canvasWidth: null, canvasWidthSource: null };
  return {
    version: PANEL_LAYOUT_PERSISTENCE_VERSION,
    root: fixedColumnRoot(visibleIds),
    panels: visiblePanels,
    focusedPanelId: visibleIds.includes(layout.focusedPanelId ?? '')
      ? layout.focusedPanelId
      : rightmostId,
    columnCount,
    ...width,
    ...sharedFields(layout),
  };
}
