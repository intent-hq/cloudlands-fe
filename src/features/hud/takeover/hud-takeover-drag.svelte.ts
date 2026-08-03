/**
 * Takeover map drag (runes) — mouse drag-to-pan on the overlay's task map,
 * mirroring the mock's grid drag-scroll (`wireDragScroll`): pointer capture,
 * a 6px movement threshold separating click from drag (a real drag never
 * fires the click under the pointer — capture-phase suppression), live
 * clamping to the rendered canvas bounds, and grab→grabbing cursor state.
 * Also owns the auto-pan to a far changed cell (mock `_panT`); starting a
 * manual drag cancels/overrides any pending or applied auto-pan.
 * Must be created during component init.
 */
import {
  clampTakeoverPan,
  HUD_TAKEOVER_DRAG_THRESHOLD_PX,
  HUD_TAKEOVER_PITCH_PX,
  type HudTakeoverCellCoord,
  type HudTakeoverPanBounds,
} from './hud-takeover-layout';

export interface HudTakeoverMapDrag {
  /** Camera offset in px; the canvas renders at translate(-x, -y). */
  readonly pan: { x: number; y: number };
  readonly dragging: boolean;
  /** True only while an auto-pan drives the offset (CSS glide transition). */
  readonly animate: boolean;
  /**
   * Sync the auto-pan with the active takeover: recenters on a new
   * workspace/changed-cell pair, then schedules the glide onto a far cell
   * after `delayMs` (0 = immediate). Keyed — repeat calls for the same pair
   * are no-ops so reactive re-runs never clobber a manual drag.
   */
  syncAutoPan(workspaceId: string, coord: HudTakeoverCellCoord | null, delayMs: number): void;
  /** Recenter and cancel any pending auto-pan or in-flight drag. */
  reset(): void;
  /** Svelte attachment wiring pointer + click-suppression listeners to the map. */
  attach(node: HTMLElement): () => void;
  destroy(): void;
}

export function createTakeoverMapDrag(
  getBounds: () => HudTakeoverPanBounds,
): HudTakeoverMapDrag {
  let pan = $state({ x: 0, y: 0 });
  let dragging = $state(false);
  let animate = $state(false);
  let autoPanTimer: ReturnType<typeof setTimeout> | undefined;
  let autoPanKey = '';
  let down: { x: number; y: number; panX: number; panY: number } | null = null;
  let moved = false;
  let suppressClick = false;

  function beginDrag(e: PointerEvent, node: HTMLElement) {
    if (e.button !== 0) return;
    clearTimeout(autoPanTimer);
    down = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    moved = false;
    node.setPointerCapture?.(e.pointerId);
  }

  function moveDrag(e: PointerEvent) {
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (Math.abs(dx) > HUD_TAKEOVER_DRAG_THRESHOLD_PX || Math.abs(dy) > HUD_TAKEOVER_DRAG_THRESHOLD_PX) {
      moved = true;
      dragging = true;
      animate = false;
    }
    if (moved) pan = clampTakeoverPan({ x: down.panX - dx, y: down.panY - dy }, getBounds());
  }

  function endDrag(e: PointerEvent, node: HTMLElement) {
    if (!down) return;
    node.releasePointerCapture?.(e.pointerId);
    down = null;
    dragging = false;
    if (moved) suppressClick = true;
    moved = false;
  }

  /** A real drag must not activate the element under the pointer (mock). */
  function captureClick(e: MouseEvent) {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  }

  return {
    get pan() {
      return pan;
    },
    get dragging() {
      return dragging;
    },
    get animate() {
      return animate;
    },
    syncAutoPan(workspaceId, coord, delayMs) {
      const key = `${workspaceId}|${coord ? `${coord.x},${coord.y}` : ''}`;
      if (key === autoPanKey) return;
      autoPanKey = key;
      this.reset();
      if (!workspaceId || !coord) return;
      const apply = () => {
        animate = true;
        pan = clampTakeoverPan(
          { x: coord.x * HUD_TAKEOVER_PITCH_PX, y: coord.y * HUD_TAKEOVER_PITCH_PX },
          getBounds(),
        );
      };
      if (delayMs <= 0) apply();
      else autoPanTimer = setTimeout(apply, delayMs);
    },
    reset() {
      clearTimeout(autoPanTimer);
      down = null;
      moved = false;
      suppressClick = false;
      dragging = false;
      animate = false;
      pan = { x: 0, y: 0 };
    },
    attach(node) {
      const onDown = (e: PointerEvent) => beginDrag(e, node);
      const onMove = (e: PointerEvent) => moveDrag(e);
      const onUp = (e: PointerEvent) => endDrag(e, node);
      node.addEventListener('pointerdown', onDown);
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
      node.addEventListener('pointercancel', onUp);
      node.addEventListener('click', captureClick, true);
      return () => {
        node.removeEventListener('pointerdown', onDown);
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
        node.removeEventListener('pointercancel', onUp);
        node.removeEventListener('click', captureClick, true);
      };
    },
    destroy() {
      clearTimeout(autoPanTimer);
    },
  };
}
