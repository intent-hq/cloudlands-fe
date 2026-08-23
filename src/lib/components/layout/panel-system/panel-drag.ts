/** Shared state and geometry for pane drag-and-drop. */

/** Custom MIME type shared by visible pane headers and the legacy tab strip. */
export const PANE_DRAG_MIME = 'application/x-panel-tab';
const PANE_DRAG_IMAGE_ATTRIBUTE = 'data-pane-drag-image';

export type PaneDropZone = 'left' | 'center' | 'right';
export type PaneLayoutEdgePlacement = 'before' | 'after';
export type PanelDragPlacement = 'before' | 'after' | 'above' | 'below';
export interface DraggedPane {
  tabId: string;
  panelId: string;
}

const PANE_SIDE_ZONE_RATIO = 0.2;
const PLACEMENT_HYSTERESIS = 0.03;
const MIN_LAYOUT_EDGE_SIZE = 40;
const MAX_LAYOUT_EDGE_SIZE = 80;

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

export function getPaneLayoutEdgePlacement(
  clientX: number,
  rect: Pick<DOMRect, 'left' | 'width'>,
  canCreateColumn = true,
): PaneLayoutEdgePlacement | null {
  if (!canCreateColumn) return null;
  const horizontalBand = Math.min(
    MAX_LAYOUT_EDGE_SIZE,
    Math.max(MIN_LAYOUT_EDGE_SIZE, rect.width * 0.1),
  );
  const right = rect.left + rect.width;
  if (clientX <= rect.left + horizontalBand) return 'before';
  if (clientX >= right - horizontalBand) return 'after';
  return null;
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
