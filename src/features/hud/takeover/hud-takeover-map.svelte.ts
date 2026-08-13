/**
 * Takeover map state (runes) — dependency-graph placement, drawable edges,
 * zoom-to-fit and the drag/auto-pan camera for the overlay's task map.
 * Owns the per-display viewport measurement (keyed by workspace like the
 * banner overflow measurement) and the fit scale derived from it; the drag
 * controller divides pointer deltas by that scale so panning stays 1:1 on
 * screen. Must be created during component init (uses $state/$derived and
 * an $effect-free measure() the component calls from its own $effect).
 */
import type { HudTakeoverTask } from '$store/renderer/slices/hud/hud-selectors';
import {
  cellNeedsPan,
  dependencyGraphLayout,
  emptyCellCoords,
  fitScale,
  takeoverGraphFits,
  takeoverPanBounds,
  type HudTakeoverCellCoord,
} from './hud-takeover-layout';
import { takeoverEdgeBoxPx, takeoverMapEdges, type HudTakeoverMapEdge } from './hud-takeover-edges';
import { createTakeoverMapDrag, type HudTakeoverMapDrag } from './hud-takeover-drag.svelte';

export interface HudTakeoverMapState {
  readonly cells: Array<{ task: HudTakeoverTask; coord: HudTakeoverCellCoord }>;
  readonly edges: HudTakeoverMapEdge[];
  readonly edgeBox: { left: number; top: number; width: number; height: number };
  readonly emptyCells: HudTakeoverCellCoord[];
  readonly scale: number;
  /** CSS transform for `.ov-map-pan`: pan (content px, scaled back) + fit scale. */
  readonly panTransform: string;
  /** Coord of `changedTaskId`, null when none/absent. */
  changedCoord(changedTaskId: string | null | undefined): HudTakeoverCellCoord | null;
  /** Auto-pan needed: far changed cell AND the fitted graph does not fully fit. */
  needsPan(changedTaskId: string | null | undefined): boolean;
  /** Measure the map viewport once per display key ('' resets; idle clears). */
  measure(displayKey: string, clip: HTMLElement | null): void;
  readonly drag: HudTakeoverMapDrag;
}

export function createTakeoverMapState(getTasks: () => HudTakeoverTask[]): HudTakeoverMapState {
  const graph = $derived(dependencyGraphLayout(getTasks()));
  const cells = $derived(
    getTasks().map((task) => ({ task, coord: graph.coords.get(task.id)! })),
  );
  const occupied = $derived(cells.map((cell) => cell.coord));
  const edges = $derived.by(() => {
    // Unmet emphasis is daemon-computed (`unmetDependsOn`, served verbatim)
    // but suppressed once the dependent itself is complete — a finished task
    // never renders an amber "waiting on" edge into it.
    const unmet = new Map(
      getTasks().map((task) => [
        task.id,
        new Set(task.status === 'complete' ? [] : (task.unmetDependsOn ?? [])),
      ]),
    );
    return takeoverMapEdges(graph, unmet);
  });

  const edgeBox = $derived(takeoverEdgeBoxPx(occupied));
  const emptyCells = $derived(emptyCellCoords(occupied));

  let viewport = $state({ width: 0, height: 0 });
  let measureKey = '';
  const scale = $derived(fitScale(occupied, viewport));

  const panBounds = $derived(takeoverPanBounds(occupied));
  const drag = createTakeoverMapDrag(
    () => panBounds,
    () => scale,
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
    get scale() {
      return scale;
    },
    get panTransform() {
      return scale === 1
        ? `translate(${-drag.pan.x}px, ${-drag.pan.y}px)`
        : `translate(${-drag.pan.x * scale}px, ${-drag.pan.y * scale}px) scale(${scale})`;
    },
    changedCoord,
    needsPan(changedTaskId) {
      const coord = changedCoord(changedTaskId);
      return (
        coord !== null && cellNeedsPan(coord) && !takeoverGraphFits(occupied, viewport, scale)
      );
    },
    measure(displayKey, clip) {
      if (!displayKey) {
        measureKey = '';
        if (viewport.width !== 0 || viewport.height !== 0) viewport = { width: 0, height: 0 };
        return;
      }
      if (displayKey === measureKey || !clip) return;
      measureKey = displayKey;
      viewport = { width: clip.clientWidth, height: clip.clientHeight };
    },
    get drag() {
      return drag;
    },
  };
}
