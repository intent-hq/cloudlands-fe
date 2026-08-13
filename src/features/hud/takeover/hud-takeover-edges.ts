/**
 * Takeover map edge derivation — turns the dependency-graph layout's
 * abstract edges into drawable px lines for the SVG layer. Dep edges split
 * into met (`dep`) vs unmet (`unmet`) off the daemon-computed
 * `unmetDependsOn` lists (served verbatim, PROTOCOL §5.4 — never re-derived
 * client-side); spec and conflict edges keep their layout kinds.
 */
import {
  canvasBounds,
  edgeLinePx,
  HUD_TAKEOVER_CELL_PX,
  HUD_TAKEOVER_PITCH_PX,
  HUD_TAKEOVER_SPEC_NODE_ID,
  type HudTakeoverCellCoord,
  type HudTakeoverGraphLayout,
} from './hud-takeover-layout';

/** Rendered edge kind: met dep / unmet dep / spec root / advisory conflict. */
export type HudTakeoverMapEdgeKind = 'dep' | 'unmet' | 'spec' | 'conflict';

/** One drawable edge: stable id, rendered kind, trimmed px endpoints. */
export interface HudTakeoverMapEdge {
  id: string;
  kind: HudTakeoverMapEdgeKind;
  line: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * Drawable px edges for the graph layout. `unmetByTaskId` maps a task id to
 * the set of its unmet dependency ids; a dep edge whose target lists the
 * source as unmet renders as `unmet`. Edges whose endpoints are missing
 * from the layout or degenerate (same cell) are dropped.
 */
export function takeoverMapEdges(
  graph: HudTakeoverGraphLayout,
  unmetByTaskId: ReadonlyMap<string, ReadonlySet<string>>,
): HudTakeoverMapEdge[] {
  const coordOf = (id: string): HudTakeoverCellCoord | undefined =>
    id === HUD_TAKEOVER_SPEC_NODE_ID ? { x: 0, y: 0 } : graph.coords.get(id);
  const edges: HudTakeoverMapEdge[] = [];
  for (const edge of graph.edges) {
    const from = coordOf(edge.from);
    const to = coordOf(edge.to);
    if (!from || !to) continue;
    const line = edgeLinePx(from, to);
    if (!line) continue;
    const kind =
      edge.kind === 'dep' && unmetByTaskId.get(edge.to)?.has(edge.from) ? 'unmet' : edge.kind;
    edges.push({ id: `${edge.from}\u0000${edge.to}\u0000${edge.kind}`, kind, line });
  }
  return edges;
}

/** Px box of the whole canvas — the edge SVG spans it so lines never clip. */
export function takeoverEdgeBoxPx(coords: HudTakeoverCellCoord[]): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const { minX, maxX, minY, maxY } = canvasBounds(coords);
  const half = HUD_TAKEOVER_CELL_PX / 2;
  return {
    left: minX * HUD_TAKEOVER_PITCH_PX - half,
    top: minY * HUD_TAKEOVER_PITCH_PX - half,
    width: (maxX - minX) * HUD_TAKEOVER_PITCH_PX + HUD_TAKEOVER_CELL_PX,
    height: (maxY - minY) * HUD_TAKEOVER_PITCH_PX + HUD_TAKEOVER_CELL_PX,
  };
}
