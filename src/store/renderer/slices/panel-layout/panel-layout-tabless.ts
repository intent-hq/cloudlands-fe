import type { PanelLayoutNode, PanelState, WorkspacePanelLayout } from './panel-layout-types';
import {
  DEFAULT_PANEL_WIDTH,
  getAcceptedIndependentPanelResizeWidth,
  getAutomaticPanelCanvasWidth,
  getPanelDefaultWidth,
  PANEL_SPLIT_GUTTER_WIDTH,
  type PanelCanvasSizing,
  type PanelDefaultWidthTier,
} from '../../../../shared/panel-layout-sizing';
import { getPanelDefaultWidthTier } from '../../../../shared/panel-default-width-tiers';

type LayoutShape = Pick<
  WorkspacePanelLayout,
  'root' | 'panels' | 'focusedPanelId' | 'canvasWidth' | 'canvasWidthSource'
>;

export function getPanelOrder(node: PanelLayoutNode): string[] {
  if (node.type === 'panel') return [node.panelId];
  return node.children.flatMap(getPanelOrder);
}

export function countHorizontalPanelColumns(node: PanelLayoutNode): number {
  if (node.type === 'panel') return 1;
  const childCounts = node.children.map(countHorizontalPanelColumns);
  return node.direction === 'horizontal'
    ? childCounts.reduce((sum, count) => sum + count, 0)
    : Math.max(...childCounts, 0);
}

/** Return declared width tiers for each horizontal column in layout order. */
export function getHorizontalPanelColumnDefaultWidthTiers(
  node: PanelLayoutNode,
  panels: Record<string, PanelState>,
): PanelDefaultWidthTier[] {
  if (node.type === 'panel') {
    const panel = panels[node.panelId];
    const activeTab = panel?.tabs.find((tab) => tab.id === panel.activeTabId) ?? panel?.tabs[0];
    return [activeTab ? getPanelDefaultWidthTier(activeTab.type) : 'narrow'];
  }
  const childTiers = node.children.map((child) =>
    getHorizontalPanelColumnDefaultWidthTiers(child, panels),
  );
  if (node.direction === 'horizontal') return childTiers.flat();
  return [
    childTiers
      .flat()
      .reduce<PanelDefaultWidthTier>(
        (widest, tier) =>
          getPanelDefaultWidth(tier) > getPanelDefaultWidth(widest) ? tier : widest,
        'narrow',
      ),
  ];
}

/** Return resolved intrinsic widths for each horizontal column in layout order. */
export function getHorizontalPanelColumnDefaultWidths(
  node: PanelLayoutNode,
  panels: Record<string, PanelState>,
  viewportWidth = 0,
): number[] {
  return getHorizontalPanelColumnDefaultWidthTiers(node, panels).map((tier) =>
    getPanelDefaultWidth(tier, viewportWidth),
  );
}

export function getAutomaticPanelLayoutCanvasWidth(
  root: PanelLayoutNode,
  panels: Record<string, PanelState>,
  sizing: PanelCanvasSizing,
  viewportWidth = 0,
): number {
  return getAutomaticPanelCanvasWidth(
    getHorizontalPanelColumnDefaultWidths(root, panels, viewportWidth),
    sizing,
    viewportWidth,
  );
}

/**
 * Return the index of the root-level horizontal child that contains `panelId`,
 * or `-1` if not found. Treats a bare panel root as index `0` when it matches.
 * A vertical root has no horizontal children — returns `-1`.
 */
export function findRootHorizontalPanelIndex(node: PanelLayoutNode, panelId: string): number {
  if (node.type === 'panel') return node.panelId === panelId ? 0 : -1;
  if (node.direction !== 'horizontal') return -1;
  return node.children.findIndex((child) => getPanelOrder(child).includes(panelId));
}

const MIN_RIGHT_EDGE_SHARE = 10;

export function resizePanelTreeRightEdge(
  node: PanelLayoutNode,
  previousWidth: number,
  nextWidth: number,
): PanelLayoutNode {
  return resizePanelTreeAtHorizontalIndex(node, previousWidth, nextWidth, -1);
}

/**
 * Grow (or shrink) a specific horizontal panel by the pixel delta implied by
 * `nextWidth - previousWidth`, preserving every other horizontal sibling's
 * pixel width. When `panelIndex` is `-1` the last child absorbs the delta —
 * i.e. the workspace right-edge behaviour.
 *
 * `panelIndex` targets the direct horizontal child of `node`. Nested vertical
 * splits recurse untouched; nested horizontal splits inside the growing panel
 * recurse via `resizePanelTreeRightEdge` so their internal proportions scale
 * consistently.
 */
export function resizePanelTreeAtHorizontalIndex(
  node: PanelLayoutNode,
  previousWidth: number,
  nextWidth: number,
  panelIndex: number,
): PanelLayoutNode {
  if (
    node.type === 'panel' ||
    previousWidth <= 0 ||
    nextWidth <= 0 ||
    !Number.isFinite(previousWidth) ||
    !Number.isFinite(nextWidth)
  ) {
    return node;
  }

  if (node.direction === 'vertical') {
    return {
      ...node,
      children: node.children.map((child) =>
        resizePanelTreeAtHorizontalIndex(child, previousWidth, nextWidth, panelIndex),
      ),
    };
  }

  const sizes = normalizeSizes(node.sizes, node.children.length);
  const lastIndex = node.children.length - 1;
  if (lastIndex < 0) return node;
  if (lastIndex === 0) {
    return {
      ...node,
      children: [
        resizePanelTreeAtHorizontalIndex(node.children[0], previousWidth, nextWidth, panelIndex),
      ],
      sizes: [100],
    };
  }

  const targetIndex =
    panelIndex < 0 || panelIndex > lastIndex ? lastIndex : Math.max(0, panelIndex);

  const previousTargetWidth = (previousWidth * sizes[targetIndex]) / 100;
  const desiredTargetShare =
    ((previousTargetWidth + (nextWidth - previousWidth)) / nextWidth) * 100;
  const minimumShare = Math.min(MIN_RIGHT_EDGE_SHARE, 100 / node.children.length);
  const maximumShare = 100 - minimumShare * lastIndex;
  const nextTargetShare = Math.max(minimumShare, Math.min(maximumShare, desiredTargetShare));
  const previousLeadingShare = 100 - sizes[targetIndex];
  const nextLeadingShare = 100 - nextTargetShare;
  const nextSizes = sizes.map((size, index) =>
    index === targetIndex
      ? nextTargetShare
      : previousLeadingShare > 0
        ? (size / previousLeadingShare) * nextLeadingShare
        : nextLeadingShare / lastIndex,
  );
  const nextTargetWidth = (nextWidth * nextTargetShare) / 100;
  const children = [...node.children];
  children[targetIndex] = resizePanelTreeRightEdge(
    children[targetIndex],
    previousTargetWidth,
    nextTargetWidth,
  );

  return { ...node, children, sizes: nextSizes };
}

export function resizeRootHorizontalPanel(
  node: PanelLayoutNode,
  previousWidth: number,
  requestedNextWidth: number,
  panelIndex: number,
  previousPanelWidths?: readonly number[],
): { node: PanelLayoutNode; nextWidth: number } {
  if (
    node.type !== 'split' ||
    node.direction !== 'horizontal' ||
    previousWidth <= 0 ||
    requestedNextWidth <= 0 ||
    !Number.isFinite(previousWidth) ||
    !Number.isFinite(requestedNextWidth) ||
    !Number.isFinite(panelIndex)
  ) {
    return { node, nextWidth: previousWidth };
  }

  const sizes = normalizeSizes(node.sizes, node.children.length);
  const lastIndex = node.children.length - 1;
  if (lastIndex < 1) return { node, nextWidth: previousWidth };
  const targetIndex =
    panelIndex < 0 || panelIndex > lastIndex ? lastIndex : Math.max(0, panelIndex);
  const hasRenderedWidths =
    previousPanelWidths?.length === node.children.length &&
    previousPanelWidths.every((width) => Number.isFinite(width) && width > 0);
  const renderedWidths = hasRenderedWidths
    ? [...previousPanelWidths!]
    : sizes.map((size) => (previousWidth * size) / 100);
  const previousTargetWidth = renderedWidths[targetIndex];
  const nextWidth = getAcceptedIndependentPanelResizeWidth(
    previousWidth,
    previousTargetWidth,
    requestedNextWidth,
  );
  if (!hasRenderedWidths) {
    return {
      node: resizePanelTreeAtHorizontalIndex(node, previousWidth, nextWidth, targetIndex),
      nextWidth,
    };
  }

  const nextTargetWidth = previousTargetWidth + nextWidth - previousWidth;
  renderedWidths[targetIndex] = nextTargetWidth;
  const children = [...node.children];
  children[targetIndex] = resizePanelTreeRightEdge(
    children[targetIndex],
    previousTargetWidth,
    nextTargetWidth,
  );
  return {
    node: {
      ...node,
      children,
      sizes: renderedWidths.map((width) => (width / nextWidth) * 100),
    },
    nextWidth,
  };
}

function createHorizontalRoot(panelIds: string[]): PanelLayoutNode {
  if (panelIds.length === 1) return { type: 'panel', panelId: panelIds[0] };
  const size = 100 / panelIds.length;
  return {
    type: 'split',
    direction: 'horizontal',
    children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
    sizes: panelIds.map(() => size),
  };
}

export function insertHorizontalPanelInLayout(
  root: PanelLayoutNode,
  panelId: string,
  afterPanelId: string,
  existingCanvasWidth: number | null | undefined = getAutomaticPanelCanvasWidth(
    countHorizontalPanelColumns(root),
    'content',
  ),
  requestedPanelWidth: number = DEFAULT_PANEL_WIDTH,
): PanelLayoutNode | null {
  const panelNode: PanelLayoutNode = { type: 'panel', panelId };
  const safeCanvasWidth =
    typeof existingCanvasWidth === 'number' &&
    Number.isFinite(existingCanvasWidth) &&
    existingCanvasWidth > 0
      ? existingCanvasWidth
      : getAutomaticPanelCanvasWidth(countHorizontalPanelColumns(root), 'content');
  const panelWidth =
    Number.isFinite(requestedPanelWidth) && requestedPanelWidth > 0
      ? requestedPanelWidth
      : DEFAULT_PANEL_WIDTH;
  const existingGapWidth =
    PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, countHorizontalPanelColumns(root) - 1);
  const existingPanelWidth = Math.max(1, safeCanvasWidth - existingGapWidth);
  const newColumnSize = (panelWidth / (existingPanelWidth + panelWidth)) * 100;

  if (root.type !== 'split' || root.direction !== 'horizontal') {
    return {
      type: 'split',
      direction: 'horizontal',
      children: [root, panelNode],
      sizes: [100 - newColumnSize, newColumnSize],
    };
  }

  const targetColumnIndex = root.children.findIndex((child) =>
    getPanelOrder(child).includes(afterPanelId),
  );
  if (targetColumnIndex < 0) return null;

  const children = [...root.children];
  children.splice(targetColumnIndex + 1, 0, panelNode);
  const sizes = normalizeSizes(root.sizes, root.children.length).map(
    (size) => size * (1 - newColumnSize / 100),
  );
  sizes.splice(targetColumnIndex + 1, 0, newColumnSize);
  return { ...root, children, sizes };
}

export function appendHorizontalPanelToLayout(
  root: PanelLayoutNode,
  panelId: string,
  existingCanvasWidth?: number | null,
  panelWidth?: number,
): PanelLayoutNode {
  const rightmostPanelId = getPanelOrder(root).at(-1);
  if (!rightmostPanelId) return root;
  return (
    insertHorizontalPanelInLayout(
      root,
      panelId,
      rightmostPanelId,
      existingCanvasWidth,
      panelWidth,
    ) ?? root
  );
}

export function removePanelPreservingHorizontalWidths(
  node: PanelLayoutNode,
  panelId: string,
): { node: PanelLayoutNode | null; remainingWidthRatio: number; removed: boolean } {
  if (node.type === 'panel') {
    return node.panelId === panelId
      ? { node: null, remainingWidthRatio: 0, removed: true }
      : { node, remainingWidthRatio: 1, removed: false };
  }

  const results = node.children.map((child) =>
    removePanelPreservingHorizontalWidths(child, panelId),
  );
  if (!results.some((result) => result.removed)) {
    return { node, remainingWidthRatio: 1, removed: false };
  }

  const kept = results
    .map((result, index) => ({ ...result, index }))
    .filter((result) => result.node !== null);
  if (kept.length === 0) return { node: null, remainingWidthRatio: 0, removed: true };

  if (node.direction === 'vertical') {
    const remainingWidthRatio = Math.max(...kept.map((result) => result.remainingWidthRatio));
    if (kept.length === 1) {
      return { node: kept[0].node, remainingWidthRatio, removed: true };
    }
    return {
      node: {
        ...node,
        children: kept.map((result) => result.node as PanelLayoutNode),
        sizes: normalizeSizes(
          kept.map((result) => node.sizes[result.index]),
          kept.length,
        ),
      },
      remainingWidthRatio,
      removed: true,
    };
  }

  const sizes = normalizeSizes(node.sizes, node.children.length);
  const retainedShares = kept.map(
    (result) => (sizes[result.index] / 100) * result.remainingWidthRatio,
  );
  const remainingWidthRatio = retainedShares.reduce((sum, share) => sum + share, 0);
  if (kept.length === 1) {
    return { node: kept[0].node, remainingWidthRatio, removed: true };
  }
  return {
    node: {
      ...node,
      children: kept.map((result) => result.node as PanelLayoutNode),
      sizes: retainedShares.map((share) => (share / remainingWidthRatio) * 100),
    },
    remainingWidthRatio,
    removed: true,
  };
}

export type PanelMovePosition = 'before' | 'after' | 'above' | 'below';

function normalizeSizes(sizes: number[], count: number): number[] {
  if (count === 0) return [];
  const valid = sizes.length === count && sizes.every((size) => Number.isFinite(size) && size > 0);
  if (!valid) return Array.from({ length: count }, () => 100 / count);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return sizes.map((size) => (size / total) * 100);
}

function removePanelNode(
  node: PanelLayoutNode,
  panelId: string,
): { node: PanelLayoutNode | null; removed: boolean } {
  if (node.type === 'panel') {
    return node.panelId === panelId ? { node: null, removed: true } : { node, removed: false };
  }

  const children: PanelLayoutNode[] = [];
  const sizes: number[] = [];
  let removed = false;
  node.children.forEach((child, index) => {
    const result = removePanelNode(child, panelId);
    removed ||= result.removed;
    if (result.node) {
      children.push(result.node);
      sizes.push(node.sizes[index] ?? 100 / node.children.length);
    }
  });
  if (!removed) return { node, removed: false };
  if (children.length === 0) return { node: null, removed: true };
  if (children.length === 1) return { node: children[0], removed: true };
  return {
    node: { ...node, children, sizes: normalizeSizes(sizes, children.length) },
    removed: true,
  };
}

/**
 * Remove tabs persisted under the wrong workspace layout. Tabs without an
 * explicit workspace owner are global layout content and remain untouched.
 */
export function removeForeignWorkspaceTabs(layout: LayoutShape, workspaceId: string): LayoutShape {
  const panels: Record<string, PanelState> = {};
  const panelIdsToRemove: string[] = [];

  for (const [panelId, panel] of Object.entries(layout.panels)) {
    const tabs = panel.tabs.filter((tab) => !tab.workspaceId || tab.workspaceId === workspaceId);
    if (panel.tabs.length > 0 && tabs.length === 0) {
      panelIdsToRemove.push(panelId);
      continue;
    }
    panels[panelId] = {
      ...panel,
      tabs,
      activeTabId:
        panel.activeTabId && tabs.some((tab) => tab.id === panel.activeTabId)
          ? panel.activeTabId
          : (tabs[0]?.id ?? null),
    };
  }

  let root: PanelLayoutNode | null = layout.root;
  for (const panelId of panelIdsToRemove) {
    if (!root) break;
    root = removePanelNode(root, panelId).node;
  }

  if (!root) {
    const fallbackPanelId = Object.keys(panels)[0] ?? 'default';
    panels[fallbackPanelId] ??= { id: fallbackPanelId, tabs: [], activeTabId: null };
    root = { type: 'panel', panelId: fallbackPanelId };
  }

  const panelOrder = getPanelOrder(root);
  return {
    root,
    panels,
    canvasWidth: layout.canvasWidth ?? null,
    canvasWidthSource: layout.canvasWidthSource ?? null,
    focusedPanelId:
      layout.focusedPanelId && panels[layout.focusedPanelId]
        ? layout.focusedPanelId
        : (panelOrder[0] ?? null),
  };
}

function insertPanelNode(
  node: PanelLayoutNode,
  panelId: string,
  targetPanelId: string,
  position: PanelMovePosition,
  useDefaultHorizontalSize = false,
): { node: PanelLayoutNode; inserted: boolean } {
  const direction = position === 'above' || position === 'below' ? 'vertical' : 'horizontal';
  const insertBefore = position === 'before' || position === 'above';
  const source: PanelLayoutNode = { type: 'panel', panelId };

  if (node.type === 'panel') {
    if (node.panelId !== targetPanelId) return { node, inserted: false };
    return {
      node: {
        type: 'split',
        direction,
        children: insertBefore ? [source, node] : [node, source],
        sizes: [50, 50],
      },
      inserted: true,
    };
  }

  const targetIndex = node.children.findIndex(
    (child) => child.type === 'panel' && child.panelId === targetPanelId,
  );
  if (targetIndex >= 0 && node.direction === direction) {
    const children = [...node.children];
    let sizes = normalizeSizes(node.sizes, children.length);
    const insertIndex = insertBefore ? targetIndex : targetIndex + 1;
    children.splice(insertIndex, 0, source);
    if (direction === 'horizontal' && useDefaultHorizontalSize) {
      const newColumnSize = 100 / (countHorizontalPanelColumns(node) + 1);
      const existingScale = 1 - newColumnSize / 100;
      sizes = sizes.map((size) => size * existingScale);
      sizes.splice(insertIndex, 0, newColumnSize);
    } else {
      const targetSize = sizes[targetIndex] ?? 100 / children.length;
      sizes[targetIndex] = targetSize / 2;
      sizes.splice(insertIndex, 0, targetSize / 2);
    }
    return {
      node: { ...node, children, sizes: normalizeSizes(sizes, children.length) },
      inserted: true,
    };
  }

  for (let index = 0; index < node.children.length; index += 1) {
    const result = insertPanelNode(
      node.children[index],
      panelId,
      targetPanelId,
      position,
      useDefaultHorizontalSize,
    );
    if (!result.inserted) continue;
    const children = [...node.children];
    children[index] = result.node;
    return { node: { ...node, children }, inserted: true };
  }
  return { node, inserted: false };
}

function isAlreadyPlaced(
  node: PanelLayoutNode,
  panelId: string,
  targetPanelId: string,
  position: PanelMovePosition,
): boolean {
  if (node.type === 'panel') return false;
  const direction = position === 'above' || position === 'below' ? 'vertical' : 'horizontal';
  if (node.direction === direction) {
    const sourceIndex = node.children.findIndex(
      (child) => child.type === 'panel' && child.panelId === panelId,
    );
    const targetIndex = node.children.findIndex(
      (child) => child.type === 'panel' && child.panelId === targetPanelId,
    );
    const expectedOffset = position === 'before' || position === 'above' ? -1 : 1;
    if (sourceIndex === targetIndex + expectedOffset) return true;
  }
  return node.children.some((child) => isAlreadyPlaced(child, panelId, targetPanelId, position));
}

function reorderSiblingPanels(
  node: PanelLayoutNode,
  panelId: string,
  targetPanelId: string,
  position: PanelMovePosition,
): PanelLayoutNode | null {
  if (node.type === 'panel') return null;
  const direction = position === 'above' || position === 'below' ? 'vertical' : 'horizontal';
  if (node.direction === direction) {
    const sourceIndex = node.children.findIndex(
      (child) => child.type === 'panel' && child.panelId === panelId,
    );
    const initialTargetIndex = node.children.findIndex(
      (child) => child.type === 'panel' && child.panelId === targetPanelId,
    );
    if (sourceIndex >= 0 && initialTargetIndex >= 0) {
      const children = [...node.children];
      const [source] = children.splice(sourceIndex, 1);
      const targetIndex = children.findIndex(
        (child) => child.type === 'panel' && child.panelId === targetPanelId,
      );
      const insertBefore = position === 'before' || position === 'above';
      const insertIndex = insertBefore ? targetIndex : targetIndex + 1;
      children.splice(insertIndex, 0, source);
      return { ...node, children };
    }
  }
  for (let index = 0; index < node.children.length; index += 1) {
    const reordered = reorderSiblingPanels(node.children[index], panelId, targetPanelId, position);
    if (!reordered) continue;
    const children = [...node.children];
    children[index] = reordered;
    return { ...node, children };
  }
  return null;
}

export function movePanelInLayout(
  root: PanelLayoutNode,
  panelId: string,
  targetPanelId: string,
  position: PanelMovePosition,
): PanelLayoutNode | null {
  if (panelId === targetPanelId || isAlreadyPlaced(root, panelId, targetPanelId, position)) {
    return null;
  }
  const reordered = reorderSiblingPanels(root, panelId, targetPanelId, position);
  if (reordered) return reordered;
  const removed = removePanelNode(root, panelId);
  if (!removed.removed || !removed.node) return null;
  const inserted = insertPanelNode(removed.node, panelId, targetPanelId, position, true);
  return inserted.inserted ? inserted.node : null;
}

export function movePanelToRootEdgeInLayout(
  root: PanelLayoutNode,
  panelId: string,
  position: PanelMovePosition,
): PanelLayoutNode | null {
  const direction = position === 'above' || position === 'below' ? 'vertical' : 'horizontal';
  const insertBefore = position === 'before' || position === 'above';

  if (root.type === 'split' && root.direction === direction) {
    const sourceIndex = root.children.findIndex(
      (child) => child.type === 'panel' && child.panelId === panelId,
    );
    if (sourceIndex >= 0) {
      const destinationIndex = insertBefore ? 0 : root.children.length - 1;
      if (sourceIndex === destinationIndex) return null;
      const children = [...root.children];
      const sizes = normalizeSizes(root.sizes, root.children.length);
      const [source] = children.splice(sourceIndex, 1);
      const [sourceSize] = sizes.splice(sourceIndex, 1);
      children.splice(insertBefore ? 0 : children.length, 0, source);
      sizes.splice(insertBefore ? 0 : sizes.length, 0, sourceSize);
      return { ...root, children, sizes };
    }
  }

  const removed = removePanelNode(root, panelId);
  if (!removed.removed || !removed.node) return null;
  const source: PanelLayoutNode = { type: 'panel', panelId };

  if (removed.node.type === 'split' && removed.node.direction === direction) {
    const children = [...removed.node.children];
    const nextItemCount =
      direction === 'horizontal'
        ? countHorizontalPanelColumns(removed.node) + 1
        : children.length + 1;
    const newItemSize = 100 / nextItemCount;
    const sizes = normalizeSizes(removed.node.sizes, children.length).map(
      (size) => size * (1 - newItemSize / 100),
    );
    children.splice(insertBefore ? 0 : children.length, 0, source);
    sizes.splice(insertBefore ? 0 : sizes.length, 0, newItemSize);
    return { ...removed.node, children, sizes: normalizeSizes(sizes, children.length) };
  }

  return {
    type: 'split',
    direction,
    children: insertBefore ? [source, removed.node] : [removed.node, source],
    sizes: [50, 50],
  };
}

function uniquePanelId(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

export function normalizeTablessPanelLayout(layout: LayoutShape): LayoutShape {
  const usedIds = new Set<string>();
  const panels: Record<string, PanelState> = {};
  let focusedPanelId: string | null = null;

  function normalizePanel(sourceId: string): PanelLayoutNode | null {
    const panel = layout.panels[sourceId];
    if (!panel) return null;
    const tabs = panel.tabs.length > 0 ? panel.tabs : [null];
    const panelIds: string[] = [];
    for (const [index, tab] of tabs.entries()) {
      const panelId = uniquePanelId(
        index === 0 || !tab ? sourceId : `${sourceId}--${tab.id}`,
        usedIds,
      );
      panels[panelId] = {
        id: panelId,
        tabs: tab ? [tab] : [],
        activeTabId: tab?.id ?? null,
        ...(panel.pristine !== undefined ? { pristine: panel.pristine && !tab } : {}),
        ...(panel.pinned !== undefined ? { pinned: panel.pinned } : {}),
      };
      panelIds.push(panelId);
      if (
        sourceId === layout.focusedPanelId &&
        (tab?.id === panel.activeTabId || (!focusedPanelId && index === 0))
      ) {
        focusedPanelId = panelId;
      }
    }
    return createHorizontalRoot(panelIds);
  }

  function normalizeNode(node: PanelLayoutNode): PanelLayoutNode | null {
    if (node.type === 'panel') return normalizePanel(node.panelId);
    const children: PanelLayoutNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child, index) => {
      const normalized = normalizeNode(child);
      if (!normalized) return;
      children.push(normalized);
      sizes.push(node.sizes[index] ?? 100 / node.children.length);
    });
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { ...node, children, sizes: normalizeSizes(sizes, children.length) };
  }

  let root = normalizeNode(layout.root);
  const rootedIds = new Set(getPanelOrder(layout.root));
  const remainingNodes = Object.keys(layout.panels)
    .filter((panelId) => !rootedIds.has(panelId))
    .map(normalizePanel)
    .filter((node): node is PanelLayoutNode => node !== null);

  if (!root) {
    const fallbackId = 'panel-empty';
    panels[fallbackId] = { id: fallbackId, tabs: [], activeTabId: null };
    root = { type: 'panel', panelId: fallbackId };
  }
  if (remainingNodes.length > 0) {
    const children = [root, ...remainingNodes];
    root = {
      type: 'split',
      direction: 'horizontal',
      children,
      sizes: normalizeSizes([], children.length),
    };
  }

  return {
    root,
    panels,
    canvasWidth: layout.canvasWidth ?? null,
    canvasWidthSource: layout.canvasWidthSource ?? null,
    focusedPanelId: focusedPanelId ?? getPanelOrder(root)[0],
  };
}

export function insertHorizontalPanel(
  layout: LayoutShape,
  panel: PanelState,
  afterPanelId: string,
): LayoutShape {
  const normalized = normalizeTablessPanelLayout(layout);
  const panelNode: PanelLayoutNode = { type: 'panel', panelId: panel.id };
  const root = normalized.root;

  if (root.type !== 'split' || root.direction !== 'horizontal') {
    return {
      ...normalized,
      root: {
        type: 'split',
        direction: 'horizontal',
        children: [root, panelNode],
        sizes: [50, 50],
      },
      panels: { ...normalized.panels, [panel.id]: panel },
      focusedPanelId: panel.id,
    };
  }

  const targetColumnIndex = root.children.findIndex((child) =>
    getPanelOrder(child).includes(afterPanelId),
  );
  const insertIndex = targetColumnIndex >= 0 ? targetColumnIndex + 1 : root.children.length;
  const newColumnSize = 100 / (root.children.length + 1);
  const existingSizes = normalizeSizes(root.sizes, root.children.length).map(
    (size) => size * (1 - newColumnSize / 100),
  );
  const children = [...root.children];
  const sizes = [...existingSizes];
  children.splice(insertIndex, 0, panelNode);
  sizes.splice(insertIndex, 0, newColumnSize);

  return {
    ...normalized,
    root: { ...root, children, sizes },
    panels: { ...normalized.panels, [panel.id]: panel },
    focusedPanelId: panel.id,
  };
}

export function appendHorizontalColumn(layout: LayoutShape, panel: PanelState): LayoutShape {
  const normalized = normalizeTablessPanelLayout(layout);
  const panelNode: PanelLayoutNode = { type: 'panel', panelId: panel.id };
  const root = normalized.root;

  if (root.type !== 'split' || root.direction !== 'horizontal') {
    return {
      ...normalized,
      root: {
        type: 'split',
        direction: 'horizontal',
        children: [root, panelNode],
        sizes: [50, 50],
      },
      panels: { ...normalized.panels, [panel.id]: panel },
      focusedPanelId: panel.id,
    };
  }

  const newColumnSize = 100 / (root.children.length + 1);
  const existingSizes = normalizeSizes(root.sizes, root.children.length).map(
    (size) => size * (1 - newColumnSize / 100),
  );
  return {
    ...normalized,
    root: {
      ...root,
      children: [...root.children, panelNode],
      sizes: [...existingSizes, newColumnSize],
    },
    panels: { ...normalized.panels, [panel.id]: panel },
    focusedPanelId: panel.id,
  };
}
