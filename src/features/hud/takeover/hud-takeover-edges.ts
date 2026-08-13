/**
 * Takeover map edge derivation — converts the router's lattice routes
 * (`takeoverEdgeRoutes`) into drawable px polylines for the SVG layer. Runs
 * travel through the gutters between cells; a segment's lane index becomes a
 * px offset off its channel centerline (lanes centered per channel), so
 * collinear edges never overlap. Dep edges split into met (`dep`) vs unmet
 * (`unmet`) off the daemon-computed `unmetDependsOn` lists (served verbatim,
 * PROTOCOL §5.4 — never re-derived client-side); spec and conflict edges
 * keep their layout kinds.
 */
import {
  canvasBounds,
  HUD_TAKEOVER_CELL_PX,
  HUD_TAKEOVER_LANE_PITCH_PX,
  HUD_TAKEOVER_PITCH_PX,
  type HudTakeoverCellCoord,
} from './hud-takeover-layout';
import type { HudTakeoverEdgeRouting, HudTakeoverRouteSegment } from './hud-takeover-routing';

/** Rendered edge kind: met dep / unmet dep / spec root / advisory conflict. */
export type HudTakeoverMapEdgeKind = 'dep' | 'unmet' | 'spec' | 'conflict';

/** One drawable edge: stable id, rendered kind, orthogonal px polyline (≥2 points). */
export interface HudTakeoverMapEdge {
  id: string;
  kind: HudTakeoverMapEdgeKind;
  points: Array<{ x: number; y: number }>;
}

/** Extra trim (px) past the target cell's border so the arrowhead sits clear of it. */
const HUD_TAKEOVER_EDGE_TARGET_GAP_PX = 2;

/**
 * Px polylines for the routed edges at the map's computed pitch.
 * `unmetByTaskId` maps a task id to the set of its unmet dependency ids; a
 * dep edge whose target lists the source as unmet renders as `unmet`.
 * Endpoints land on the cell borders (the target end pulled back a hair so
 * the arrowhead sits in the gutter); interior vertices come from each
 * segment's channel centerline plus its lane offset, lanes centered within
 * the channel. Coordinates round to 0.1px for stable, diff-friendly markup.
 */
export function takeoverMapEdges(
  routing: HudTakeoverEdgeRouting,
  unmetByTaskId: ReadonlyMap<string, ReadonlySet<string>>,
  pitchPx: number = HUD_TAKEOVER_PITCH_PX,
): HudTakeoverMapEdge[] {
  // Lane counts per channel so offsets center the used lanes on the gutter.
  const laneCounts = new Map<string, number>();
  for (const route of routing.routes) {
    for (const seg of route.segments) {
      const key = `${seg.axis}:${seg.channel}`;
      laneCounts.set(key, Math.max(laneCounts.get(key) ?? 0, seg.lane + 1));
    }
  }
  const crossPx = (seg: HudTakeoverRouteSegment): number => {
    const lanes = laneCounts.get(`${seg.axis}:${seg.channel}`)!;
    return seg.channel * pitchPx + (seg.lane - (lanes - 1) / 2) * HUD_TAKEOVER_LANE_PITCH_PX;
  };
  // Route endpoints sit on a cell border at center ± the 192px-lattice half
  // cell; re-anchor them to the true border at the computed pitch.
  const borderPx = (v: number): number => {
    const cell = Math.round(v);
    return cell * pitchPx + Math.sign(v - cell) * (HUD_TAKEOVER_CELL_PX / 2);
  };
  const round = (v: number) => Math.round(v * 10) / 10;

  const edges: HudTakeoverMapEdge[] = [];
  for (const route of routing.routes) {
    const segs = route.segments;
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    const points: Array<{ x: number; y: number }> = [];
    points.push(
      segs[0].axis === 'h'
        ? { x: borderPx(first.x), y: crossPx(segs[0]) }
        : { x: crossPx(segs[0]), y: borderPx(first.y) },
    );
    // Consecutive segments always alternate axes (router invariant), so each
    // interior vertex is the crossing of a horizontal and a vertical run.
    for (let i = 1; i < segs.length; i++) {
      const h = segs[i].axis === 'h' ? segs[i] : segs[i - 1];
      const v = segs[i].axis === 'v' ? segs[i] : segs[i - 1];
      points.push({ x: crossPx(v), y: crossPx(h) });
    }
    const lastSeg = segs[segs.length - 1];
    const prev = points[points.length - 1];
    if (lastSeg.axis === 'h') {
      const x = borderPx(last.x);
      points.push({ x: x - Math.sign(x - prev.x) * HUD_TAKEOVER_EDGE_TARGET_GAP_PX, y: prev.y });
    } else {
      const y = borderPx(last.y);
      points.push({ x: prev.x, y: y - Math.sign(y - prev.y) * HUD_TAKEOVER_EDGE_TARGET_GAP_PX });
    }
    const kind =
      route.kind === 'dep' && unmetByTaskId.get(route.to)?.has(route.from) ? 'unmet' : route.kind;
    edges.push({
      id: route.id,
      kind,
      points: points.map((p) => ({ x: round(p.x), y: round(p.y) })),
    });
  }
  return edges;
}

/** Px box of the whole canvas — the edge SVG spans it so lines never clip. */
export function takeoverEdgeBoxPx(
  coords: HudTakeoverCellCoord[],
  pitchPx: number = HUD_TAKEOVER_PITCH_PX,
): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const { minX, maxX, minY, maxY } = canvasBounds(coords);
  const half = HUD_TAKEOVER_CELL_PX / 2;
  return {
    left: minX * pitchPx - half,
    top: minY * pitchPx - half,
    width: (maxX - minX) * pitchPx + HUD_TAKEOVER_CELL_PX,
    height: (maxY - minY) * pitchPx + HUD_TAKEOVER_CELL_PX,
  };
}
