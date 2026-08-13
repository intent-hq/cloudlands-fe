/**
 * Takeover map state (runes) — dependency-graph placement, drawable edges,
 * manual zoom and the drag/auto-pan camera for the overlay's task map.
 * Every display renders 1:1 by default; zoom is manual (in/out steps,
 * reset, zoom-to-fit against the measured viewport) and resets to 1 per
 * display. Owns the per-display viewport measurement (the overlay keys it
 * by workspace + display counter so back-to-back displays of the same
 * workspace still re-measure); the drag controller divides
 * pointer deltas by the current zoom so panning stays 1:1 on screen. Must
 * be created during component init (uses $state/$derived and an
 * $effect-free measure() the component calls from its own $effect).
 */
import type { HudTakeoverTask } from '$store/renderer/slices/hud/hud-selectors';
import {
  cellNeedsPan,
  clampZoom,
  dependencyGraphLayout,
  emptyCellCoords,
  fitScale,
  HUD_TAKEOVER_ZOOM_MAX,
  HUD_TAKEOVER_ZOOM_MIN,
  HUD_TAKEOVER_ZOOM_STEP,
  takeoverGraphFits,
  takeoverPanBounds,
  takeoverPitchPx,
  type HudTakeoverCellCoord,
} from './hud-takeover-layout';
import { takeoverEdgeRoutes } from './hud-takeover-routing';
import { takeoverEdgeBoxPx, takeoverMapEdges, type HudTakeoverMapEdge } from './hud-takeover-edges';
import { createTakeoverMapDrag, type HudTakeoverMapDrag } from './hud-takeover-drag.svelte';

export interface HudTakeoverMapState {
  readonly cells: Array<{ task: HudTakeoverTask; coord: HudTakeoverCellCoord }>;
  readonly edges: HudTakeoverMapEdge[];
  readonly edgeBox: { left: number; top: number; width: number; height: number };
  readonly emptyCells: HudTakeoverCellCoord[];
  /** Grid pitch (px) — cell size + the gutter sized for the busiest channel. */
  readonly pitch: number;
  /** Current manual zoom scale (1 by default for every display). */
  readonly scale: number;
  /** False at the zoom range limits so buttons can disable. */
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  /** Multiplicative zoom step up/down, clamped to the zoom range. */
  zoomIn(): void;
  zoomOut(): void;
  /** Back to 1:1. */
  zoomReset(): void;
  /** Fit the occupied cells to the measured viewport (clamped, never above 1). */
  zoomFit(): void;
  /** CSS transform for `.ov-map-pan`: pan (content px, scaled back) + current zoom. */
  readonly panTransform: string;
  /** Coord of `changedTaskId`, null when none/absent. */
  changedCoord(changedTaskId: string | null | undefined): HudTakeoverCellCoord | null;
  /**
   * Auto-pan needed: far changed cell AND the graph does not fit at the
   * display's 1:1 open zoom. A once-per-display decision — deliberately
   * independent of the live zoom, so manual zoom interaction never
   * re-triggers or cancels the auto-pan (or flips banner timing) mid-display.
   */
  needsPan(changedTaskId: string | null | undefined): boolean;
  /** Measure the map viewport once per display key ('' resets; idle clears). */
  measure(displayKey: string, clip: HTMLElement | null): void;
  readonly drag: HudTakeoverMapDrag;
}

export function createTakeoverMapState(getTasks: () => HudTakeoverTask[]): HudTakeoverMapState {
  const graph = $derived(dependencyGraphLayout(getTasks()));
  const cells = $derived(getTasks().map((task) => ({ task, coord: graph.coords.get(task.id)! })));
  const occupied = $derived(cells.map((cell) => cell.coord));
  const routing = $derived(takeoverEdgeRoutes(graph));
  const pitch = $derived(takeoverPitchPx(routing.maxLanes));
  // Task input order drives the per-source palette rotation; statuses drive
  // the consumed-edge dimming (destination underway/finished) and the pulse
  // treatments (live conflicts, ready-to-start dependents).
  const edges = $derived(takeoverMapEdges(routing, getTasks(), pitch));

  const edgeBox = $derived(takeoverEdgeBoxPx(occupied, pitch));
  const emptyCells = $derived(emptyCellCoords(occupied));

  let viewport = $state({ width: 0, height: 0 });
  let measureKey = '';
  // Manual zoom: 1:1 by default, stepped/reset/fitted by the zoom actions;
  // measure() resets it so each display opens at 100%.
  let zoom = $state(1);

  const panBounds = $derived(takeoverPanBounds(occupied, pitch));
  const drag = createTakeoverMapDrag(
    () => panBounds,
    () => zoom,
    () => pitch,
  );

  const changedCoord = (changedTaskId: string | null | undefined): HudTakeoverCellCoord | null => {
    if (!changedTaskId) return null;
    return cells.find((cell) => cell.task.id === changedTaskId)?.coord ?? null;
  };

  return {
    get cells() {
      return cells;
    },
    get edges() {
      return edges;
    },
    get edgeBox() {
      return edgeBox;
    },
    get emptyCells() {
      return emptyCells;
    },
    get pitch() {
      return pitch;
    },
    get scale() {
      return zoom;
    },
    get canZoomIn() {
      return zoom < HUD_TAKEOVER_ZOOM_MAX;
    },
    get canZoomOut() {
      return zoom > HUD_TAKEOVER_ZOOM_MIN;
    },
    zoomIn() {
      zoom = clampZoom(zoom * HUD_TAKEOVER_ZOOM_STEP);
    },
    zoomOut() {
      zoom = clampZoom(zoom / HUD_TAKEOVER_ZOOM_STEP);
    },
    zoomReset() {
      zoom = 1;
    },
    zoomFit() {
      zoom = fitScale(occupied, viewport, pitch);
    },
    get panTransform() {
      return zoom === 1
        ? `translate(${-drag.pan.x}px, ${-drag.pan.y}px)`
        : `translate(${-drag.pan.x * zoom}px, ${-drag.pan.y * zoom}px) scale(${zoom})`;
    },
    changedCoord,
    needsPan(changedTaskId) {
      const coord = changedCoord(changedTaskId);
      // Evaluated at the constant 1:1 open zoom (measure() resets zoom to 1
      // per display), never the live zoom: the decision is latched for the
      // display, so manual zoom can't reset the pan or re-schedule the glide.
      return (
        coord !== null && cellNeedsPan(coord) && !takeoverGraphFits(occupied, viewport, 1, pitch)
      );
    },
    measure(displayKey, clip) {
      if (!displayKey) {
        measureKey = '';
        if (zoom !== 1) zoom = 1;
        if (viewport.width !== 0 || viewport.height !== 0) viewport = { width: 0, height: 0 };
        return;
      }
      if (displayKey === measureKey || !clip) return;
      measureKey = displayKey;
      zoom = 1;
      viewport = { width: clip.clientWidth, height: clip.clientHeight };
    },
    get drag() {
      return drag;
    },
  };
}
