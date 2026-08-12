/**
 * Shared state for panel drag-and-drop reordering.
 *
 * `dragover` events cannot read `dataTransfer` payloads (only types), so the
 * dragged panel id is mirrored here to let drop targets skip self-drops while
 * a panel drag is in flight.
 */

import type { PanelDragLayoutSnapshot } from '$store/renderer/slices/panel-layout/panel-layout-types';

/** Custom MIME type for dragging a whole panel (vs. a tab). */
export const PANEL_DRAG_MIME = 'application/x-panel-id';
const PANEL_DRAG_IMAGE_ATTRIBUTE = 'data-panel-drag-image';

export type PanelDragPlacement = 'before' | 'after' | 'above' | 'below';

const PANEL_STACK_ZONE_RATIO = 0.28;
const PLACEMENT_HYSTERESIS = 0.04;
const MIN_LAYOUT_EDGE_SIZE = 40;
const MAX_LAYOUT_EDGE_SIZE = 80;

export function getPanelDragPlacement(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  previous: PanelDragPlacement | null = null,
): PanelDragPlacement {
  const xRatio = Math.max(
    0,
    Math.min(1, rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5),
  );
  const yRatio = Math.max(
    0,
    Math.min(1, rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5),
  );
  if (previous === 'above' && yRatio <= PANEL_STACK_ZONE_RATIO + PLACEMENT_HYSTERESIS) {
    return 'above';
  }
  if (previous === 'below' && yRatio >= 1 - PANEL_STACK_ZONE_RATIO - PLACEMENT_HYSTERESIS) {
    return 'below';
  }
  if (yRatio < PANEL_STACK_ZONE_RATIO) return 'above';
  if (yRatio > 1 - PANEL_STACK_ZONE_RATIO) return 'below';

  if (previous === 'before' && xRatio <= 0.5 + PLACEMENT_HYSTERESIS) return 'before';
  if (previous === 'after' && xRatio >= 0.5 - PLACEMENT_HYSTERESIS) return 'after';
  return xRatio < 0.5 ? 'before' : 'after';
}

export function getPanelLayoutEdgePlacement(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): PanelDragPlacement | null {
  const horizontalBand = Math.min(
    MAX_LAYOUT_EDGE_SIZE,
    Math.max(MIN_LAYOUT_EDGE_SIZE, rect.width * 0.1),
  );
  const verticalBand = Math.min(
    MAX_LAYOUT_EDGE_SIZE,
    Math.max(MIN_LAYOUT_EDGE_SIZE, rect.height * 0.1),
  );
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const candidates: Array<[PanelDragPlacement, number]> = [];

  if (clientX <= rect.left + horizontalBand) {
    candidates.push(['before', Math.abs(clientX - rect.left) / horizontalBand]);
  }
  if (clientX >= right - horizontalBand) {
    candidates.push(['after', Math.abs(right - clientX) / horizontalBand]);
  }
  if (clientY <= rect.top + verticalBand) {
    candidates.push(['above', Math.abs(clientY - rect.top) / verticalBand]);
  }
  if (clientY >= bottom - verticalBand) {
    candidates.push(['below', Math.abs(bottom - clientY) / verticalBand]);
  }

  return (
    candidates.reduce<[PanelDragPlacement, number] | null>(
      (nearest, candidate) => (!nearest || candidate[1] < nearest[1] ? candidate : nearest),
      null,
    )?.[0] ?? null
  );
}

let draggedPanelId: string | null = null;
export type ActivePanelDragSnapshot = PanelDragLayoutSnapshot & { layoutId: string };
let panelDragSnapshot: ActivePanelDragSnapshot | null = null;

export function setDraggedPanelId(id: string | null): void {
  draggedPanelId = id;
  if (id === null) {
    panelDragSnapshot = null;
  }
}

export function setPanelDragSnapshot(layoutId: string, layout: PanelDragLayoutSnapshot): void {
  panelDragSnapshot = { layoutId, ...layout };
}

export function takePanelDragSnapshot(): ActivePanelDragSnapshot | null {
  const snapshot = panelDragSnapshot;
  panelDragSnapshot = null;
  return snapshot;
}

export function clearDraggedPanelState(): void {
  draggedPanelId = null;
  panelDragSnapshot = null;
  if (typeof document === 'undefined') return;
  document
    .querySelectorAll('.panel-drag-source')
    .forEach((element) => element.classList.remove('panel-drag-source'));
  document.querySelectorAll(`[${PANEL_DRAG_IMAGE_ATTRIBUTE}]`).forEach((element) => {
    element.remove();
  });
}

export function getDraggedPanelId(): string | null {
  return draggedPanelId;
}

export function createPanelDragImage(title: string): HTMLElement {
  const image = document.createElement('div');
  image.setAttribute(PANEL_DRAG_IMAGE_ATTRIBUTE, '');
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
