/** Shared state and geometry for pane drag-and-drop. */

/** Custom MIME type shared by visible pane headers and the legacy tab strip. */
export const PANE_DRAG_MIME = 'application/x-panel-tab';
const PANE_DRAG_IMAGE_ATTRIBUTE = 'data-pane-drag-image';

export type PaneDropZone = 'left' | 'center' | 'right';
export type PanelDragPlacement = 'before' | 'after' | 'above' | 'below';
export interface PaneInsertionTarget {
  index: number;
  left: number;
  width: number;
}
export type PaneDropPlacement =
  | { kind: 'edge'; position: 'before' | 'after' }
  | { kind: 'panel'; targetPanelId: string; zone: PaneDropZone };
export type PaneInsertionPlacement =
  | Extract<PaneDropPlacement, { kind: 'edge' }>
  | (Extract<PaneDropPlacement, { kind: 'panel' }> & { zone: 'left' });
export interface DraggedPane {
  tabId: string;
  panelId: string;
}

const PANE_SIDE_ZONE_RATIO = 0.2;
const PLACEMENT_HYSTERESIS = 0.03;
const PANE_INSERTION_GUTTER_SIZE = 40;

export function getPaneInsertionTargets(
  layoutRect: Pick<DOMRect, 'left' | 'width'>,
  panelRects: readonly Pick<DOMRect, 'left' | 'width'>[],
  canCreateColumn = true,
): PaneInsertionTarget[] {
  if (!canCreateColumn || layoutRect.width <= 0 || panelRects.length === 0) return [];

  const panelEdges = panelRects.map((rect) => ({ left: rect.left, right: rect.left + rect.width }));
  const firstEdge = panelEdges[0];
  const lastEdge = panelEdges.at(-1);
  if (!firstEdge || !lastEdge) return [];
  const boundaries = [
    firstEdge.left,
    ...panelEdges.slice(1).map((edge, index) => (panelEdges[index].right + edge.left) / 2),
    lastEdge.right,
  ].map((position) =>
    Math.max(layoutRect.left, Math.min(layoutRect.left + layoutRect.width, position)),
  );
  const minimumSpacing = boundaries
    .slice(1)
    .reduce(
      (minimum, position, index) => Math.min(minimum, position - boundaries[index]),
      Infinity,
    );
  const width = Math.min(
    PANE_INSERTION_GUTTER_SIZE,
    layoutRect.width,
    Number.isFinite(minimumSpacing) ? Math.max(1, minimumSpacing / 2) : layoutRect.width,
  );
  const maximumLeft = Math.max(0, layoutRect.width - width);

  return boundaries.map((position, index) => ({
    index,
    left: Math.max(0, Math.min(maximumLeft, position - layoutRect.left - width / 2)),
    width,
  }));
}

export function getPaneInsertionTargetAtX(
  clientX: number,
  layoutRect: Pick<DOMRect, 'left'>,
  targets: readonly PaneInsertionTarget[],
): PaneInsertionTarget | null {
  const x = clientX - layoutRect.left;
  return targets.find((target) => x >= target.left && x <= target.left + target.width) ?? null;
}

export function getPaneInsertionPlacement(
  targetIndex: number,
  panelIds: readonly string[],
): PaneInsertionPlacement | null {
  if (targetIndex === 0) return { kind: 'edge', position: 'before' };
  if (targetIndex === panelIds.length) return { kind: 'edge', position: 'after' };
  const targetPanelId = panelIds[targetIndex];
  return targetPanelId ? { kind: 'panel', targetPanelId, zone: 'left' } : null;
}

export function getPaneInsertionPlacementAtX(
  clientX: number,
  layoutRect: Pick<DOMRect, 'left'>,
  targets: readonly PaneInsertionTarget[],
  panelIds: readonly string[],
): PaneInsertionPlacement | null {
  const target = getPaneInsertionTargetAtX(clientX, layoutRect, targets);
  return target ? getPaneInsertionPlacement(target.index, panelIds) : null;
}

export function getPaneColumnDropZone(
  clientX: number,
  rect: Pick<DOMRect, 'left' | 'width'>,
  canCreateColumn = true,
  previous: PaneDropZone | null = null,
): PaneDropZone {
  if (!canCreateColumn) return 'center';
  const xRatio = Math.max(
    0,
    Math.min(1, rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5),
  );
  if (previous === 'left' && xRatio <= PANE_SIDE_ZONE_RATIO + PLACEMENT_HYSTERESIS) {
    return 'left';
  }
  if (previous === 'right' && xRatio >= 1 - PANE_SIDE_ZONE_RATIO - PLACEMENT_HYSTERESIS) {
    return 'right';
  }
  if (
    previous === 'center' &&
    xRatio >= PANE_SIDE_ZONE_RATIO - PLACEMENT_HYSTERESIS &&
    xRatio <= 1 - PANE_SIDE_ZONE_RATIO + PLACEMENT_HYSTERESIS
  ) {
    return 'center';
  }
  if (xRatio < PANE_SIDE_ZONE_RATIO) return 'left';
  if (xRatio > 1 - PANE_SIDE_ZONE_RATIO) return 'right';
  return 'center';
}

let draggedPane: DraggedPane | null = null;

export function setDraggedPane(pane: DraggedPane | null): void {
  draggedPane = pane;
}

export function clearDraggedPaneState(): void {
  draggedPane = null;
  if (typeof document === 'undefined') return;
  document.querySelectorAll(`[${PANE_DRAG_IMAGE_ATTRIBUTE}]`).forEach((element) => {
    element.remove();
  });
}

export function getDraggedPane(): DraggedPane | null {
  return draggedPane;
}

export function createPaneDragImage(title: string): HTMLElement {
  const image = document.createElement('div');
  image.setAttribute(PANE_DRAG_IMAGE_ATTRIBUTE, '');
  image.textContent = title;
  Object.assign(image.style, {
    position: 'fixed',
    left: '-10000px',
    top: '-10000px',
    width: '220px',
    height: '32px',
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--card)',
    color: 'var(--card-foreground)',
    boxShadow: 'var(--elevation-raised)',
    font: '500 12px/1 system-ui, sans-serif',
    pointerEvents: 'none',
  });
  document.body.append(image);
  return image;
}
