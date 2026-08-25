import { migratePanelCanvasWidth } from './panel-layout-width-provenance';
import { panelTabsAreEquivalent } from './panel-tab-identity';
import {
  MIN_PANEL_CANVAS_WIDTH,
  MIN_PANEL_SIZE_PERCENT,
  PANEL_SPLIT_GUTTER_WIDTH,
} from '../../../../shared/panel-layout-sizing';
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

function hasUsableGeometry(node: PanelLayoutNode, availableWidth: number | null): boolean {
  if (!hasValidGeometry(node)) return false;
  if (node.type === 'panel') return true;
  if (availableWidth === null || node.direction === 'vertical') {
    return (
      node.sizes.every((size) => size >= MIN_PANEL_SIZE_PERCENT) &&
      node.children.every((child) => hasUsableGeometry(child, availableWidth))
    );
  }

  const contentWidth = Math.max(
    0,
    availableWidth - PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, node.children.length - 1),
  );
  const sizeTotal = node.sizes.reduce((sum, size) => sum + size, 0);
  const childWidths = node.sizes.map((size) => (size / sizeTotal) * contentWidth);
  return (
    childWidths.every((width) => width >= MIN_PANEL_CANVAS_WIDTH) &&
    node.children.every((child, index) => hasUsableGeometry(child, childWidths[index]))
  );
}

function explicitCanvasWidth(layout: WorkspacePanelLayout): number | null {
  return layout.canvasWidthSource === 'explicit' &&
    typeof layout.canvasWidth === 'number' &&
    Number.isFinite(layout.canvasWidth) &&
    layout.canvasWidth > 0
    ? layout.canvasWidth
    : null;
}

function cleanPanel(
  panel: PanelState,
  workspaceId: string,
  dedupeEquivalent: boolean,
): PanelState | null {
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
    if (
      tabs.some(
        (existing) =>
          existing.id === tab.id || (dedupeEquivalent && panelTabsAreEquivalent(existing, tab)),
      )
    ) {
      continue;
    }
    tabs.push(tab);
  }
  const activeTabId = tabs.some((tab) => tab.id === panel.activeTabId)
    ? panel.activeTabId
    : (tabs[0]?.id ?? null);
  const validTabIds = new Set(tabs.map((tab) => tab.id));
  const attentionTabIds = Array.isArray(panel.attentionTabIds)
    ? [...new Set(panel.attentionTabIds)].filter(
        (tabId) => validTabIds.has(tabId) && tabId !== activeTabId,
      )
    : undefined;
  const { pinned: _pinned, ...clean } = panel as PanelState & { pinned?: unknown };
  return {
    ...clean,
    tabs,
    activeTabId,
    ...(attentionTabIds === undefined ? {} : { attentionTabIds }),
  };
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

function createPristinePanelId(usedIds: Set<string>): string {
  let suffix = 1;
  let panelId = 'panel-migrated-empty';
  while (usedIds.has(panelId)) {
    suffix += 1;
    panelId = `panel-migrated-empty-${suffix}`;
  }
  usedIds.add(panelId);
  return panelId;
}

function isCurrentFixedLayout(
  layout: WorkspacePanelLayout,
  orderedIds: string[],
): layout is WorkspacePanelLayout & { columnCount: PanelColumnCount } {
  if (
    layout.version !== PANEL_LAYOUT_PERSISTENCE_VERSION ||
    !isPanelColumnCount(layout.columnCount) ||
    orderedIds.length !== layout.columnCount ||
    !hasUsableGeometry(layout.root, explicitCanvasWidth(layout))
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
  const dedupeEquivalent = layout.version !== PANEL_LAYOUT_PERSISTENCE_VERSION;
  const persistedColumnCount =
    layout.version === PANEL_LAYOUT_PERSISTENCE_VERSION && isPanelColumnCount(layout.columnCount)
      ? layout.columnCount
      : null;
  const collectedRootIds: string[] = [];
  collectLeafIds(layout.root, collectedRootIds);
  const uniqueRootIds = [...new Set(collectedRootIds)];
  const rootedIdSet = new Set(uniqueRootIds);
  const orderedIds = [
    ...uniqueRootIds,
    ...Object.keys(layout.panels).filter((id) => !rootedIdSet.has(id)),
  ];
  const cleanedPanels = new Map<string, PanelState>();
  for (const panelId of orderedIds) {
    const panel = layout.panels[panelId];
    if (!panel || panel.id !== panelId || !Array.isArray(panel.tabs)) continue;
    const cleaned = cleanPanel(panel, workspaceId, dedupeEquivalent);
    if (cleaned) cleanedPanels.set(panelId, cleaned);
  }

  const rootedIds = uniqueRootIds.filter((panelId) => cleanedPanels.has(panelId));
  const orphanIds = Object.keys(layout.panels).filter(
    (panelId) => !rootedIdSet.has(panelId) && cleanedPanels.has(panelId),
  );
  if (orphanIds.length === 0 && isCurrentFixedLayout(layout, rootedIds)) {
    const width = migratePanelCanvasWidth(layout.canvasWidth, layout.canvasWidthSource);
    const panels = Object.fromEntries(
      rootedIds.flatMap((id) => {
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
          : rootedIds[0],
      columnCount: layout.columnCount,
      ...width,
      ...sharedFields(layout),
    };
  }

  const targetCount =
    persistedColumnCount ??
    (Math.min(
      LEGACY_VISIBLE_COLUMN_LIMIT,
      Math.max(1, rootedIds.length || orphanIds.length),
    ) as PanelColumnCount);
  const visibleIds = rootedIds.slice(0, targetCount);
  const visibleOrphanCount = Math.min(targetCount - visibleIds.length, orphanIds.length);
  visibleIds.push(...orphanIds.slice(0, visibleOrphanCount));
  const usedIds = new Set(Object.keys(layout.panels));
  while (visibleIds.length < targetCount) {
    const panelId = createPristinePanelId(usedIds);
    visibleIds.push(panelId);
    cleanedPanels.set(panelId, {
      id: panelId,
      tabs: [],
      activeTabId: null,
      pristine: true,
    });
  }
  const visiblePanels = Object.fromEntries(
    visibleIds.flatMap((id) => {
      const panel = cleanedPanels.get(id);
      return panel ? [[id, panel]] : [];
    }),
  );
  const rightmostId = visibleIds[visibleIds.length - 1];
  const rightmost = visiblePanels[rightmostId];
  const tabs = [...rightmost.tabs];
  const attentionTabIds = new Set(rightmost.attentionTabIds ?? []);
  let hasAttentionMetadata = rightmost.attentionTabIds !== undefined;
  const overflowIds = [...rootedIds.slice(targetCount), ...orphanIds.slice(visibleOrphanCount)];
  const hasOverflow = overflowIds.length > 0;
  const visibleTabs = Object.values(visiblePanels).flatMap((panel) => panel.tabs);
  let overflowActiveTabId: string | null = null;
  for (const panelId of overflowIds) {
    const panel = cleanedPanels.get(panelId);
    if (!panel) continue;
    for (const tab of panel.tabs) {
      if (
        visibleTabs.some(
          (existing) =>
            existing.id === tab.id || (dedupeEquivalent && panelTabsAreEquivalent(existing, tab)),
        )
      ) {
        continue;
      }
      tabs.push(tab);
      visibleTabs.push(tab);
    }
    if (panel.attentionTabIds !== undefined) hasAttentionMetadata = true;
    for (const tabId of panel.attentionTabIds ?? []) attentionTabIds.add(tabId);
    if (panelId === layout.focusedPanelId) overflowActiveTabId = panel.activeTabId;
  }
  const activeTabId =
    overflowActiveTabId && tabs.some((tab) => tab.id === overflowActiveTabId)
      ? overflowActiveTabId
      : rightmost.activeTabId;
  const mergedTabIds = new Set(tabs.map((tab) => tab.id));
  visiblePanels[rightmostId] = {
    ...rightmost,
    tabs,
    activeTabId,
    ...(hasAttentionMetadata
      ? {
          attentionTabIds: [...attentionTabIds].filter(
            (tabId) => mergedTabIds.has(tabId) && tabId !== activeTabId,
          ),
        }
      : {}),
    pristine: hasOverflow && tabs.length > 0 ? false : rightmost.pristine,
  };
  const width = hasUsableGeometry(layout.root, explicitCanvasWidth(layout))
    ? migratePanelCanvasWidth(layout.canvasWidth, layout.canvasWidthSource)
    : { canvasWidth: null, canvasWidthSource: null };
  return {
    version: PANEL_LAYOUT_PERSISTENCE_VERSION,
    root: fixedColumnRoot(visibleIds),
    panels: visiblePanels,
    focusedPanelId: visibleIds.includes(layout.focusedPanelId ?? '')
      ? layout.focusedPanelId
      : rightmostId,
    columnCount: visibleIds.length as PanelColumnCount,
    ...width,
    ...sharedFields(layout),
  };
}
