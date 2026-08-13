/**
 * Orthogonal edge router for the takeover task map — turns the abstract
 * graph edges (`dep` / `spec` / `conflict` from `dependencyGraphLayout`)
 * into Manhattan polyline routes in lattice space. Long runs travel through
 * gutter channels (the cell-free strips at half-integer lattice coords
 * between columns/rows); short exit/entry stubs and straight neighbor links
 * lie in border corridors (the integer row/column through the cell
 * centers). Every segment gets a lane index within its channel so no two
 * edges ever share a collinear span (90° crossings are fine); px conversion
 * later offsets segments off the channel centerline by lane. Pure and
 * deterministic: same layout ⇒ same routes on every HUD instance.
 */
import {
  HUD_TAKEOVER_CELL_PX,
  HUD_TAKEOVER_PITCH_PX,
  HUD_TAKEOVER_SPEC_NODE_ID,
  type HudTakeoverCellCoord,
  type HudTakeoverGraphEdge,
  type HudTakeoverGraphLayout,
} from './hud-takeover-layout';

/** Half a cell in lattice units — cell borders sit at center ± this. */
export const HUD_TAKEOVER_CELL_HALF_LATTICE = HUD_TAKEOVER_CELL_PX / 2 / HUD_TAKEOVER_PITCH_PX;

/** Polyline vertex in lattice units (cell centers at integers). */
export interface HudTakeoverRoutePoint {
  x: number;
  y: number;
}

/**
 * One orthogonal run between consecutive route points. `axis` is the travel
 * direction; `channel` is the fixed cross-axis lattice coord the run lies on
 * (half-integer = gutter channel, integer = border corridor on a cell side).
 * `lane` separates collinear edges sharing the channel: px conversion
 * offsets the run (and its endpoints) off the centerline by lane index.
 */
export interface HudTakeoverRouteSegment {
  axis: 'h' | 'v';
  channel: number;
  lane: number;
}

/** Routed edge: layout kind/endpoints preserved, id matches the edge layer. */
export interface HudTakeoverEdgeRoute {
  id: string;
  kind: HudTakeoverGraphEdge['kind'];
  from: string;
  to: string;
  /** Ordered polyline (≥2 points); `segments[i]` spans `points[i]`→`points[i+1]`. */
  points: HudTakeoverRoutePoint[];
  segments: HudTakeoverRouteSegment[];
}

export interface HudTakeoverEdgeRouting {
  routes: HudTakeoverEdgeRoute[];
  /** Max lane count over all channels — drives the global gutter width. */
  maxLanes: number;
}

const HALF = HUD_TAKEOVER_CELL_HALF_LATTICE;

/**
 * Left→right route: exit the source's right border, enter the target's left
 * border. Adjacent columns link directly (straight or one Z-bend through the
 * shared gutter); farther targets travel a vertical gutter, a horizontal
 * gutter beside the target row (above it when rows match, so intermediate
 * cells are never crossed), and the target's entry gutter.
 */
function routeLeftToRight(
  a: HudTakeoverCellCoord,
  b: HudTakeoverCellCoord,
): HudTakeoverRoutePoint[] {
  const exit = { x: a.x + HALF, y: a.y };
  const enter = { x: b.x - HALF, y: b.y };
  if (b.x === a.x + 1) {
    if (a.y === b.y) return [exit, enter];
    const gx = a.x + 0.5;
    return [exit, { x: gx, y: a.y }, { x: gx, y: b.y }, enter];
  }
  const gxA = a.x + 0.5;
  const gxB = b.x - 0.5;
  const gy = a.y === b.y ? a.y - 0.5 : b.y > a.y ? b.y - 0.5 : b.y + 0.5;
  return [
    exit,
    { x: gxA, y: a.y },
    { x: gxA, y: gy },
    { x: gxB, y: gy },
    { x: gxB, y: b.y },
    enter,
  ];
}

/**
 * Same-column top→bottom route (conflict pairs): exit the upper cell's
 * bottom border, enter the lower cell's top border. Adjacent rows link
 * straight; farther pairs detour through the right-hand vertical gutter so
 * intermediate cells are never crossed.
 */
function routeTopToBottom(
  a: HudTakeoverCellCoord,
  b: HudTakeoverCellCoord,
): HudTakeoverRoutePoint[] {
  const exit = { x: a.x, y: a.y + HALF };
  const enter = { x: b.x, y: b.y - HALF };
  if (b.y === a.y + 1) return [exit, enter];
  const gyA = a.y + 0.5;
  const gyB = b.y - 0.5;
  const gx = a.x + 0.5;
  return [
    exit,
    { x: a.x, y: gyA },
    { x: gx, y: gyA },
    { x: gx, y: gyB },
    { x: b.x, y: gyB },
    enter,
  ];
}

/** Route points for an edge, oriented from → to. Null on a degenerate pair. */
function routePoints(
  from: HudTakeoverCellCoord,
  to: HudTakeoverCellCoord,
): HudTakeoverRoutePoint[] | null {
  if (from.x === to.x && from.y === to.y) return null;
  if (from.x === to.x)
    return from.y < to.y ? routeTopToBottom(from, to) : routeTopToBottom(to, from).reverse();
  return from.x < to.x ? routeLeftToRight(from, to) : routeLeftToRight(to, from).reverse();
}

/**
 * Orthogonal routes for the layout's edges. Edges whose endpoints are
 * missing from the layout or degenerate (same cell) are dropped — parity
 * with `takeoverMapEdges`. Lane assignment is first-fit in edge order per
 * channel: a segment takes the lowest lane whose already-assigned spans it
 * does not touch or overlap, so fan-in/fan-out stubs spread across lanes
 * (= entry/exit ports) and parallel gutter runs never merge.
 */
export function takeoverEdgeRoutes(graph: HudTakeoverGraphLayout): HudTakeoverEdgeRouting {
  const coordOf = (id: string): HudTakeoverCellCoord | undefined =>
    id === HUD_TAKEOVER_SPEC_NODE_ID ? { x: 0, y: 0 } : graph.coords.get(id);
  const occupied = new Map<string, { lane: number; lo: number; hi: number }[]>();
  let maxLanes = 0;
  const routes: HudTakeoverEdgeRoute[] = [];
  for (const edge of graph.edges) {
    const from = coordOf(edge.from);
    const to = coordOf(edge.to);
    if (!from || !to) continue;
    const points = routePoints(from, to);
    if (!points) continue;
    const segments = points.slice(0, -1).map((p, i): HudTakeoverRouteSegment => {
      const q = points[i + 1];
      const axis = p.y === q.y ? 'h' : 'v';
      const channel = axis === 'h' ? p.y : p.x;
      const [lo, hi] =
        axis === 'h' ? [p.x, q.x].sort((m, n) => m - n) : [p.y, q.y].sort((m, n) => m - n);
      const key = `${axis}:${channel}`;
      const spans = occupied.get(key) ?? [];
      let lane = 0;
      while (spans.some((s) => s.lane === lane && s.lo <= hi && lo <= s.hi)) lane += 1;
      spans.push({ lane, lo, hi });
      occupied.set(key, spans);
      maxLanes = Math.max(maxLanes, lane + 1);
      return { axis, channel, lane };
    });
    routes.push({
      id: `${edge.from}\u0000${edge.to}\u0000${edge.kind}`,
      kind: edge.kind,
      from: edge.from,
      to: edge.to,
      points,
      segments,
    });
  }
  return { routes, maxLanes };
}
