/**
 * Orthogonal edge router for the takeover task map — turns the abstract
 * graph edges (`dep` / `spec` / `conflict` from `dependencyGraphLayout`)
 * into Manhattan polyline routes in lattice space. Long runs travel through
 * gutter channels (the cell-free strips at half-integer lattice coords
 * between columns/rows); short exit/entry stubs and aligned links whose
 * intermediate cells are all empty run straight in border corridors (the
 * integer row/column through the cell centers) — the gutter detour is only
 * taken when an occupied cell blocks the direct path. Every segment gets a
 * lane index within its channel; edges in the
 * same bundle (same `kind` + same `from`) may share a lane over overlapping
 * spans so a fan-out renders as one trunk that branches, while edges of
 * different bundles never overlap or touch on the same lane (90° crossings
 * are fine). Lane choice is sticky per bundle: once a bundle lands on a lane
 * in a channel, its later segments there prefer that lane over lower free
 * ones, so one blocked member cannot split the trunk into parallel lines.
 * Px conversion later offsets segments off the channel centerline by lane.
 * Pure and deterministic: same layout ⇒ same routes on every HUD instance.
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
interface HudTakeoverRoutePoint {
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
  /**
   * Max lane count over the gutter (half-integer) channels — drives the
   * global gutter width. Border-corridor (integer) channels are excluded:
   * corridor lanes spread along the cell border, not across the gutter, so
   * port fan-in/fan-out stubs never inflate the gutter width.
   */
  maxLanes: number;
}

const HALF = HUD_TAKEOVER_CELL_HALF_LATTICE;

/** Occupancy predicate over lattice cells (integer coords). */
type HudTakeoverCellOccupied = (x: number, y: number) => boolean;

/** True when every cell strictly between the bounds along one axis is free. */
function corridorClear(
  from: number,
  to: number,
  cellAt: (i: number) => [number, number],
  isOccupied: HudTakeoverCellOccupied,
): boolean {
  for (let i = from + 1; i < to; i++) {
    if (isOccupied(...cellAt(i))) return false;
  }
  return true;
}

/**
 * Left→right route: exit the source's right border, enter the target's left
 * border. Adjacent columns link directly (straight or one Z-bend through the
 * shared gutter), and same-row targets whose intermediate cells are all
 * empty link straight along the row corridor; otherwise the route travels a
 * vertical gutter, a horizontal gutter beside the target row (above it when
 * rows match, so occupied cells are never crossed), and the target's entry
 * gutter.
 */
function routeLeftToRight(
  a: HudTakeoverCellCoord,
  b: HudTakeoverCellCoord,
  isOccupied: HudTakeoverCellOccupied,
): HudTakeoverRoutePoint[] {
  const exit = { x: a.x + HALF, y: a.y };
  const enter = { x: b.x - HALF, y: b.y };
  if (b.x === a.x + 1) {
    if (a.y === b.y) return [exit, enter];
    const gx = a.x + 0.5;
    return [exit, { x: gx, y: a.y }, { x: gx, y: b.y }, enter];
  }
  if (a.y === b.y && corridorClear(a.x, b.x, (x) => [x, a.y], isOccupied)) {
    return [exit, enter];
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
 * bottom border, enter the lower cell's top border. Adjacent rows and pairs
 * whose intermediate cells are all empty link straight along the column
 * corridor; other pairs detour through the right-hand vertical gutter so
 * occupied cells are never crossed.
 */
function routeTopToBottom(
  a: HudTakeoverCellCoord,
  b: HudTakeoverCellCoord,
  isOccupied: HudTakeoverCellOccupied,
): HudTakeoverRoutePoint[] {
  const exit = { x: a.x, y: a.y + HALF };
  const enter = { x: b.x, y: b.y - HALF };
  if (b.y === a.y + 1) return [exit, enter];
  if (corridorClear(a.y, b.y, (y) => [a.x, y], isOccupied)) return [exit, enter];
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
  isOccupied: HudTakeoverCellOccupied,
): HudTakeoverRoutePoint[] | null {
  if (from.x === to.x && from.y === to.y) return null;
  if (from.x === to.x)
    return from.y < to.y
      ? routeTopToBottom(from, to, isOccupied)
      : routeTopToBottom(to, from, isOccupied).reverse();
  return from.x < to.x
    ? routeLeftToRight(from, to, isOccupied)
    : routeLeftToRight(to, from, isOccupied).reverse();
}

/**
 * Orthogonal routes for the layout's edges. Edges whose endpoints are
 * missing from the layout or degenerate (same cell) are dropped — parity
 * with `takeoverMapEdges`. Lane assignment is first-fit in edge order per
 * channel, bundling edges of the same `kind` + `from`: a segment takes the
 * lowest lane where every already-assigned span it would overlap or touch
 * belongs to its own bundle, so a fan-out's exit stubs and common gutter
 * runs share one trunk lane and branch where routes diverge, while spans
 * from other bundles block the lane and never merge with it.
 *
 * Lanes are sticky per bundle: the first lane a bundle lands on in a channel
 * is memoized, and its later segments there try the sticky lane FIRST — even
 * when a lower lane is free — so a cross-bundle span that bumps one member
 * off lane 0 cannot split the trunk into parallel same-colored lines. When a
 * cross-bundle span blocks the sticky lane over a segment's own range, that
 * segment alone falls back to normal first-fit; the fallback lane does not
 * overwrite the memo, so the rest of the bundle keeps converging on the
 * sticky lane.
 */
export function takeoverEdgeRoutes(graph: HudTakeoverGraphLayout): HudTakeoverEdgeRouting {
  const coordOf = (id: string): HudTakeoverCellCoord | undefined =>
    id === HUD_TAKEOVER_SPEC_NODE_ID ? { x: 0, y: 0 } : graph.coords.get(id);
  const occupiedCells = new Set<string>(['0,0']);
  for (const coord of graph.coords.values()) occupiedCells.add(`${coord.x},${coord.y}`);
  const isOccupied: HudTakeoverCellOccupied = (x, y) => occupiedCells.has(`${x},${y}`);
  const occupied = new Map<string, { lane: number; lo: number; hi: number; bundle: string }[]>();
  /** First lane each bundle landed on per channel, keyed `bundle\u0000axis:channel`. */
  const stickyLanes = new Map<string, number>();
  let maxLanes = 0;
  const routes: HudTakeoverEdgeRoute[] = [];
  for (const edge of graph.edges) {
    const from = coordOf(edge.from);
    const to = coordOf(edge.to);
    if (!from || !to) continue;
    const points = routePoints(from, to, isOccupied);
    if (!points) continue;
    const bundle = `${edge.kind}\u0000${edge.from}`;
    const segments = points.slice(0, -1).map((p, i): HudTakeoverRouteSegment => {
      const q = points[i + 1];
      const axis = p.y === q.y ? 'h' : 'v';
      const channel = axis === 'h' ? p.y : p.x;
      const [lo, hi] =
        axis === 'h' ? [p.x, q.x].sort((m, n) => m - n) : [p.y, q.y].sort((m, n) => m - n);
      const key = `${axis}:${channel}`;
      const spans = occupied.get(key) ?? [];
      const blocked = (candidate: number): boolean =>
        spans.some((s) => s.lane === candidate && s.bundle !== bundle && s.lo <= hi && lo <= s.hi);
      const stickyKey = `${bundle}\u0000${key}`;
      const stickyLane = stickyLanes.get(stickyKey);
      let lane: number;
      if (stickyLane !== undefined && !blocked(stickyLane)) {
        lane = stickyLane;
      } else {
        lane = 0;
        while (blocked(lane)) lane += 1;
        if (stickyLane === undefined) stickyLanes.set(stickyKey, lane);
      }
      spans.push({ lane, lo, hi, bundle });
      occupied.set(key, spans);
      // Only gutter (half-integer) channels drive maxLanes — corridor lanes
      // spread along the cell border and need no gutter room.
      if (channel % 1 !== 0) maxLanes = Math.max(maxLanes, lane + 1);
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
