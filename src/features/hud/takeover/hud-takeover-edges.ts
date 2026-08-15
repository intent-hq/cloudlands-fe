/**
 * Takeover map edge derivation — converts the router's lattice routes
 * (`takeoverEdgeRoutes`) into drawable px polylines for the SVG layer. Runs
 * travel through the gutters between cells; a segment's lane index becomes a
 * px offset off its channel centerline (lanes centered per channel), so
 * collinear edges never overlap. Every dep edge (met or unmet alike) takes
 * its SOURCE task's palette color — a stable rotating assignment by layout
 * input order — and dims once its destination task is underway or finished;
 * spec and conflict edges keep their layout kinds and muted/destructive
 * styling.
 */
import {
  canvasBounds,
  HUD_TAKEOVER_CELL_PX,
  HUD_TAKEOVER_LANE_PITCH_PX,
  HUD_TAKEOVER_PITCH_PX,
  type HudTakeoverCellCoord,
} from './hud-takeover-layout';
import type { HudTakeoverEdgeRouting, HudTakeoverRouteSegment } from './hud-takeover-routing';

/** Rendered edge kind: dependency / spec root / advisory conflict. */
export type HudTakeoverMapEdgeKind = 'dep' | 'spec' | 'conflict';

/**
 * Per-source edge palette — 10 distinct hues tuned to read against the HUD's
 * dark map background (mid-60s lightness like the dark-theme accent tokens:
 * success 145 58% 55%, warning 42 91% 63%, info 260 80% 72%). Ordered so
 * neighboring assignments contrast; pure red stays reserved for conflicts.
 */
export const HUD_TAKEOVER_EDGE_PALETTE: readonly string[] = [
  'hsl(205 85% 64%)', // sky
  'hsl(145 58% 55%)', // green
  'hsl(42 91% 63%)', // amber
  'hsl(260 80% 72%)', // violet
  'hsl(180 65% 52%)', // teal
  'hsl(320 70% 68%)', // magenta
  'hsl(90 55% 58%)', // lime
  'hsl(25 88% 62%)', // orange
  'hsl(228 90% 74%)', // indigo
  'hsl(350 75% 70%)', // rose
];

/** Palette slot for a task's stable index in layout input order (rotates past 10). */
export function takeoverEdgeColorIndex(orderIndex: number): number {
  const n = HUD_TAKEOVER_EDGE_PALETTE.length;
  return ((orderIndex % n) + n) % n;
}

/** Stroke/arrow color for ready-to-start dep edges (the palette's success green). */
export const HUD_TAKEOVER_EDGE_READY_COLOR = HUD_TAKEOVER_EDGE_PALETTE[1];

/**
 * Task inputs the edge layer needs, in layout input order: id + wire status,
 * plus the dependency fields (served verbatim off the wire, §5.4) that drive
 * the ready-state pulse.
 */
export interface HudTakeoverEdgeTask {
  id: string;
  status: string;
  /** Task-note ids this task depends on; omitted when empty. */
  dependsOn?: readonly string[];
  /** Daemon-computed `dependsOn` ids not yet complete; omitted when empty. */
  unmetDependsOn?: readonly string[];
}

/**
 * Destination statuses that dim an incoming dep edge — the dependent is
 * underway or finished, so the edge is consumed; edges into a task that has
 * not started yet stay full-strength.
 */
const CONSUMED_DEST_STATUSES: ReadonlySet<string> = new Set([
  'in_progress',
  'review_required',
  'complete',
  'cancelled',
]);

/** Live-attention pulse on an edge: red conflict / green ready / none. */
export type HudTakeoverEdgePulse = 'conflict' | 'ready' | null;

/** Endpoint statuses that resolve a conflict — the task can no longer conflict. */
const RESOLVED_CONFLICT_STATUSES: ReadonlySet<string> = new Set(['complete', 'cancelled']);

/**
 * Pulse state for one edge (pure edge → visual-state mapping):
 * - `conflict` edges pulse red while the conflict is live — NEITHER endpoint
 *   task is complete nor cancelled; once either endpoint completes or is
 *   cancelled, the pulse stops (the edge then renders static and muted via
 *   `dimmed`).
 * - `dep` edges pulse green when their DESTINATION task is ready to start:
 *   non-empty `dependsOn`, empty/absent `unmetDependsOn`, and status
 *   `not_started`. Any other status never pulses green; dependency-free
 *   tasks have no dep edges, so they never pulse.
 * - `spec` edges never pulse.
 */
export function takeoverEdgePulse(
  kind: HudTakeoverMapEdgeKind,
  from: HudTakeoverEdgeTask | undefined,
  to: HudTakeoverEdgeTask | undefined,
): HudTakeoverEdgePulse {
  if (kind === 'conflict') {
    const resolved = (task: HudTakeoverEdgeTask | undefined) =>
      task !== undefined && RESOLVED_CONFLICT_STATUSES.has(task.status);
    return resolved(from) || resolved(to) ? null : 'conflict';
  }
  if (kind !== 'dep' || !to) return null;
  const ready =
    to.status === 'not_started' &&
    (to.dependsOn?.length ?? 0) > 0 &&
    (to.unmetDependsOn?.length ?? 0) === 0;
  return ready ? 'ready' : null;
}

/** One drawable edge: stable id, rendered kind, orthogonal px polyline (≥2 points). */
export interface HudTakeoverMapEdge {
  id: string;
  kind: HudTakeoverMapEdgeKind;
  /** Source endpoint id (a task id, or the spec node id on spec edges). */
  from: string;
  /** Destination task id. */
  to: string;
  points: Array<{ x: number; y: number }>;
  /** Source task's palette slot (dep edges only; null for spec/conflict). */
  colorIndex: number | null;
  /**
   * Renders at reduced opacity: a dep edge whose destination is
   * underway/finished, or a conflict edge whose conflict is resolved
   * (either endpoint complete or cancelled).
   */
  dimmed: boolean;
  /** Pulse treatment (see `takeoverEdgePulse`). */
  pulse: HudTakeoverEdgePulse;
}

/**
 * True when the edge touches the hovered task — either endpoint id matches
 * (incoming and outgoing alike, dep/spec/conflict alike). Drives the hover
 * highlight: touching edges render full-strength with a thicker stroke.
 * A null hover matches nothing.
 */
export function takeoverEdgeTouchesTask(
  edge: Pick<HudTakeoverMapEdge, 'from' | 'to'>,
  taskId: string | null,
): boolean {
  return taskId !== null && (edge.from === taskId || edge.to === taskId);
}

/** Extra trim (px) past the target cell's border so the arrowhead sits clear of it. */
const HUD_TAKEOVER_EDGE_TARGET_GAP_PX = 2;

/** Corner radius (px) for the rounded bends in the rendered edge paths. */
export const HUD_TAKEOVER_EDGE_CORNER_PX = 2.5;

/**
 * SVG path `d` for an orthogonal polyline: `M`/`L` runs with each interior
 * bend rounded by a small quadratic corner (radius clamped to half the
 * shorter adjacent run so short jogs never overshoot). Coordinates round to
 * 0.1px like the polyline points for stable markup.
 */
export function takeoverEdgePathD(
  points: ReadonlyArray<{ x: number; y: number }>,
  cornerPx: number = HUD_TAKEOVER_EDGE_CORNER_PX,
): string {
  if (points.length < 2) return '';
  const fmt = (v: number) => `${Math.round(v * 10) / 10}`;
  const pt = (p: { x: number; y: number }) => `${fmt(p.x)} ${fmt(p.y)}`;
  let d = `M${pt(points[0])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const p = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
    const outLen = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(cornerPx, inLen / 2, outLen / 2);
    if (r <= 0) {
      d += `L${pt(p)}`;
      continue;
    }
    const entry = { x: p.x - ((p.x - prev.x) / inLen) * r, y: p.y - ((p.y - prev.y) / inLen) * r };
    const exit = { x: p.x + ((next.x - p.x) / outLen) * r, y: p.y + ((next.y - p.y) / outLen) * r };
    d += `L${pt(entry)}Q${pt(p)} ${pt(exit)}`;
  }
  return `${d}L${pt(points[points.length - 1])}`;
}

/**
 * Px polylines for the routed edges at the map's computed pitch.
 * `tasks` is the layout input order (id + status): a dep edge takes its
 * SOURCE task's palette slot (input index mod palette size, stable across
 * re-renders) and dims when its destination task's status says the edge is
 * consumed (underway or finished). Endpoints land on the cell borders (the
 * target end pulled back a hair so the arrowhead sits in the gutter);
 * interior vertices come from each segment's channel centerline plus its
 * lane offset, lanes centered within the channel. Coordinates round to
 * 0.1px for stable, diff-friendly markup.
 */
export function takeoverMapEdges(
  routing: HudTakeoverEdgeRouting,
  tasks: readonly HudTakeoverEdgeTask[],
  pitchPx: number = HUD_TAKEOVER_PITCH_PX,
): HudTakeoverMapEdge[] {
  const orderIndex = new Map<string, number>();
  const taskById = new Map<string, HudTakeoverEdgeTask>();
  tasks.forEach((task, i) => {
    if (!orderIndex.has(task.id)) {
      orderIndex.set(task.id, i);
      taskById.set(task.id, task);
    }
  });
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
    const sourceIndex = route.kind === 'dep' ? orderIndex.get(route.from) : undefined;
    const fromTask = taskById.get(route.from);
    const toTask = taskById.get(route.to);
    const pulse = takeoverEdgePulse(route.kind, fromTask, toTask);
    edges.push({
      id: route.id,
      kind: route.kind,
      from: route.from,
      to: route.to,
      points: points.map((p) => ({ x: round(p.x), y: round(p.y) })),
      colorIndex: sourceIndex !== undefined ? takeoverEdgeColorIndex(sourceIndex) : null,
      dimmed:
        route.kind === 'dep'
          ? toTask !== undefined && CONSUMED_DEST_STATUSES.has(toTask.status)
          : route.kind === 'conflict' && pulse === null,
      pulse,
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
