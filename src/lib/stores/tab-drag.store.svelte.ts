/**
 * Global tab drag state store
 *
 * Tracks whether a tab is currently being dragged across panels.
 * Used to:
 * 1. Disable pointer events on panel content during drag
 * 2. Reset drop zone states when drag ends without a drop
 * 3. Show drop overlay at layout root level (to avoid overflow clipping)
 */

export type HandleDropZoneType = 'row-above' | 'row-below' | 'column-left' | 'column-right';

export interface HandleDropInfo {
  /** Bounding rect of the handle element */
  handleRect: DOMRect;
  /** Bounding rect of the parent container (for full-width/height overlays) */
  containerRect: DOMRect;
  /** Type of drop zone */
  zoneType: HandleDropZoneType;
  /** Label to show */
  label: string;
}

class TabDragStore {
  private _isDragging = $state(false);
  private _activeHandleDrop = $state<HandleDropInfo | null>(null);

  get isDragging() {
    return this._isDragging;
  }

  get activeHandleDrop() {
    return this._activeHandleDrop;
  }

  startDrag() {
    this._isDragging = true;
  }

  endDrag() {
    this._isDragging = false;
    this._activeHandleDrop = null;
  }

  setActiveHandleDrop(info: HandleDropInfo | null) {
    this._activeHandleDrop = info;
  }
}

export const tabDragStore = new TabDragStore();
