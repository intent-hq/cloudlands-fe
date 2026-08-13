/**
 * HUD takeover task-map layout — deterministic placement of task cells
 * around the spec cell at (0,0) on the mock's infinite canvas (180px 1:1
 * cells on a pitch that widens with edge-lane demand, 192px floor). Real
 * tasks carry no coordinates, so the FE lays them out as a left→right
 * layered dependency DAG rooted at the spec (`dependencyGraphLayout`), with
 * a fit scale for the manual zoom-to-fit action (`fitScale`). The same task
 * list always yields the same map on every HUD instance.
 */

/** Mock canvas metrics: cell size and default grid pitch (`renderVals` PITCH/CS). */
export const HUD_TAKEOVER_CELL_PX = 180;
export const HUD_TAKEOVER_PITCH_PX = 192;

/** Edge-lane metrics inside a gutter: px between lanes, margin at each side. */
export const HUD_TAKEOVER_LANE_PITCH_PX = 8;
export const HUD_TAKEOVER_LANE_MARGIN_PX = 4;

/** Gutter floor — the mock's 192 − 180, so an edge-free map keeps today's metrics. */
export const HUD_TAKEOVER_GUTTER_MIN_PX = HUD_TAKEOVER_PITCH_PX - HUD_TAKEOVER_CELL_PX;

/**
 * Uniform gutter width (px) between cells, sized so the busiest channel's
 * lanes fit with a margin on each side, floored at the mock's 12px. One
 * global width for the whole map (horizontal and vertical), driven by the
 * router's `maxLanes`.
 */
export function takeoverGutterPx(maxLanes: number): number {
  return Math.max(
    HUD_TAKEOVER_GUTTER_MIN_PX,
    maxLanes * HUD_TAKEOVER_LANE_PITCH_PX + 2 * HUD_TAKEOVER_LANE_MARGIN_PX,
  );
}

/** Grid pitch (px) for a global lane demand: cell size + uniform gutter. */
export function takeoverPitchPx(maxLanes: number): number {
  return HUD_TAKEOVER_CELL_PX + takeoverGutterPx(maxLanes);
}

/** Overlay frame sizing (mock `openOv`: min(1560, rw−120) × min(850, rh−120)). */
export const HUD_TAKEOVER_FRAME_MAX_W_PX = 1560;
export const HUD_TAKEOVER_FRAME_MAX_H_PX = 850;
export const HUD_TAKEOVER_FRAME_MARGIN_PX = 120;

/** The minimal DOMRect surface the FLIP math needs (testable without jsdom). */
export interface HudTakeoverRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** FLIP "from" transform: center offset + scale of the card vs. the frame. */
export interface HudTakeoverFrameFrom {
  x: number;
  y: number;
  sx: number;
  sy: number;
}

/**
 * Compute the frame's zoom-from transform out of the source card's rect
 * (mock `openOv` `from`): translate by the card-center offset from the shell
 * center, scale by card size over the frame's rendered size. Returns null on
 * degenerate rects (hidden/unlaid-out card) so callers fall back to the
 * plain centered open.
 */
export function takeoverFrameFrom(
  shell: HudTakeoverRect,
  card: HudTakeoverRect,
): HudTakeoverFrameFrom | null {
  if (shell.width <= 0 || shell.height <= 0 || card.width <= 0 || card.height <= 0) return null;
  const frameW = Math.min(HUD_TAKEOVER_FRAME_MAX_W_PX, shell.width - HUD_TAKEOVER_FRAME_MARGIN_PX);
  const frameH = Math.min(HUD_TAKEOVER_FRAME_MAX_H_PX, shell.height - HUD_TAKEOVER_FRAME_MARGIN_PX);
  if (frameW <= 0 || frameH <= 0) return null;
  return {
    x: card.left + card.width / 2 - shell.left - shell.width / 2,
    y: card.top + card.height / 2 - shell.top - shell.height / 2,
    sx: card.width / frameW,
    sy: card.height / frameH,
  };
}

export interface HudTakeoverCellCoord {
  x: number;
  y: number;
}

/** Node id for the virtual spec root in graph edges (the spec cell at (0,0)). */
export const HUD_TAKEOVER_SPEC_NODE_ID = 'spec';

/** Task input to the dependency-graph layout: id plus optional relation id lists. */
export interface HudTakeoverGraphTask {
  id: string;
  dependsOn?: readonly string[];
  conflictsWith?: readonly string[];
}

/**
 * Drawable edge: `dep` runs dep → dependent, `spec` runs the virtual spec
 * root → a task with truly empty `dependsOn`, `conflict` is an advisory
 * symmetric pair (emitted once per pair).
 */
export interface HudTakeoverGraphEdge {
  from: string;
  to: string;
  kind: 'dep' | 'spec' | 'conflict';
}

export interface HudTakeoverGraphLayout {
  /** Per-task lattice coords keyed by id, in input order (spec stays implicit at (0,0)). */
  coords: Map<string, HudTakeoverCellCoord>;
  edges: HudTakeoverGraphEdge[];
}

/**
 * Deterministic left→right layered-DAG layout on the lattice (the takeover
 * map's placement). Columns: the spec is a virtual root at x=0; a task with no
 * visible `dependsOn` sits at x=1, otherwise x = 1 + max(x of its deps)
 * (longest path). Rows within a column are ordered by the barycenter of the
 * dependencies' rows, tie-broken by input order. Weakly-connected components
 * (over dep edges, after dropping dangling references to ids not in the list)
 * are laid out independently: the spec-rooted component is centered on y=0
 * around the spec cell, islands stack below it with a one-cell gutter.
 * Dangling-only deps anchor an island root without a spec edge. Same input ⇒
 * same output on every HUD instance.
 */
export function dependencyGraphLayout(
  tasks: readonly HudTakeoverGraphTask[],
): HudTakeoverGraphLayout {
  const inputIndex = new Map<string, number>();
  tasks.forEach((task, i) => {
    if (!inputIndex.has(task.id)) inputIndex.set(task.id, i);
  });
  const unique = tasks.filter((task, i) => inputIndex.get(task.id) === i);

  const visibleDeps = new Map<string, string[]>();
  const specRooted = new Set<string>();
  for (const task of unique) {
    const raw = task.dependsOn ?? [];
    visibleDeps.set(
      task.id,
      [...new Set(raw)].filter((dep) => dep !== task.id && inputIndex.has(dep)),
    );
    if (raw.length === 0) specRooted.add(task.id);
  }

  // Column = longest dependency path from the roots. The daemon rejects
  // dependency cycles, but guard anyway: a back-edge to an in-progress node
  // is ignored for depth so the recursion always terminates.
  const column = new Map<string, number>();
  const visiting = new Set<string>();
  const columnOf = (id: string): number => {
    const memo = column.get(id);
    if (memo !== undefined) return memo;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let x = 1;
    for (const dep of visibleDeps.get(id) ?? []) x = Math.max(x, columnOf(dep) + 1);
    visiting.delete(id);
    column.set(id, x);
    return x;
  };
  for (const task of unique) columnOf(task.id);

  // Weakly-connected components via union-find over dep edges; spec-rooted
  // tasks join the virtual spec node's component.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const task of unique) {
    if (specRooted.has(task.id)) union(task.id, HUD_TAKEOVER_SPEC_NODE_ID);
    for (const dep of visibleDeps.get(task.id) ?? []) union(task.id, dep);
  }

  const componentsByRoot = new Map<string, string[]>();
  for (const task of unique) {
    const root = find(task.id);
    const members = componentsByRoot.get(root);
    if (members) members.push(task.id);
    else componentsByRoot.set(root, [task.id]);
  }
  const specRoot = find(HUD_TAKEOVER_SPEC_NODE_ID);
  const specMembers = componentsByRoot.get(specRoot) ?? [];
  const islands = [...componentsByRoot.entries()]
    .filter(([root]) => root !== specRoot)
    .map(([, members]) => members)
    .sort((a, b) => inputIndex.get(a[0])! - inputIndex.get(b[0])!);

  // Rows per component: columns left→right, each column's tasks sorted by
  // barycenter of their deps' rows (spec-rooted tasks average in the spec
  // row 0), tie-broken by input order, then centered on the column.
  const localY = new Map<string, number>();
  const layoutComponent = (members: string[]): { minY: number; maxY: number } => {
    const byColumn = new Map<number, string[]>();
    for (const id of members) {
      const x = column.get(id)!;
      const col = byColumn.get(x);
      if (col) col.push(id);
      else byColumn.set(x, [id]);
    }
    let minY = 0;
    let maxY = 0;
    for (const x of [...byColumn.keys()].sort((a, b) => a - b)) {
      const ids = byColumn.get(x)!;
      const ordered = ids
        .map((id) => {
          const rows = (visibleDeps.get(id) ?? [])
            .map((dep) => localY.get(dep))
            .filter((row): row is number => row !== undefined);
          if (specRooted.has(id)) rows.push(0);
          const barycenter = rows.length
            ? rows.reduce((sum, row) => sum + row, 0) / rows.length
            : 0;
          return { id, barycenter };
        })
        .sort(
          (a, b) => a.barycenter - b.barycenter || inputIndex.get(a.id)! - inputIndex.get(b.id)!,
        );
      ordered.forEach(({ id }, i) => {
        const y = i - Math.floor(ordered.length / 2);
        localY.set(id, y);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      });
    }
    return { minY, maxY };
  };

  const placed = new Map<string, HudTakeoverCellCoord>();
  const specExtent = layoutComponent(specMembers);
  for (const id of specMembers) placed.set(id, { x: column.get(id)!, y: localY.get(id)! });

  // Islands stack below the spec component with a one-cell gutter.
  let nextTop = specExtent.maxY + 2;
  for (const members of islands) {
    const { minY, maxY } = layoutComponent(members);
    const offset = nextTop - minY;
    for (const id of members) placed.set(id, { x: column.get(id)!, y: localY.get(id)! + offset });
    nextTop = maxY + offset + 2;
  }

  const coords = new Map<string, HudTakeoverCellCoord>();
  for (const task of unique) coords.set(task.id, placed.get(task.id)!);

  const edges: HudTakeoverGraphEdge[] = [];
  for (const task of unique) {
    if (specRooted.has(task.id))
      edges.push({ from: HUD_TAKEOVER_SPEC_NODE_ID, to: task.id, kind: 'spec' });
    for (const dep of visibleDeps.get(task.id) ?? [])
      edges.push({ from: dep, to: task.id, kind: 'dep' });
  }
  const seenConflicts = new Set<string>();
  for (const task of unique) {
    for (const other of task.conflictsWith ?? []) {
      if (other === task.id || !inputIndex.has(other)) continue;
      const key = [task.id, other].sort().join('\u0000');
      if (seenConflicts.has(key)) continue;
      seenConflicts.add(key);
      edges.push({ from: task.id, to: other, kind: 'conflict' });
    }
  }

  return { coords, edges };
}

/**
 * Whether a cell sits far enough from center that the map should pan to it
 * before the banner plays (mock: |x| >= 3 or |y| >= 2).
 */
export function cellNeedsPan(coord: HudTakeoverCellCoord): boolean {
  return Math.abs(coord.x) >= 3 || Math.abs(coord.y) >= 2;
}

/** Pointer travel (px) past which a press is a drag, not a click (mock wireDragScroll: 6). */
export const HUD_TAKEOVER_DRAG_THRESHOLD_PX = 6;

/** Camera-offset limits (px) for the map pan, one axis pair per dimension. */
export interface HudTakeoverPanBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Pan bounds in px: the camera center may travel across the rendered canvas
 * (occupied cells plus the dashed ring, `canvasBounds`) but no further — so
 * cells can never be dragged fully off-screen.
 */
export function takeoverPanBounds(
  coords: HudTakeoverCellCoord[],
  pitchPx: number = HUD_TAKEOVER_PITCH_PX,
): HudTakeoverPanBounds {
  const { minX, maxX, minY, maxY } = canvasBounds(coords);
  return {
    minX: minX * pitchPx,
    maxX: maxX * pitchPx,
    minY: minY * pitchPx,
    maxY: maxY * pitchPx,
  };
}

/** Clamp a camera offset (px) into the pan bounds. */
export function clampTakeoverPan(
  pan: { x: number; y: number },
  bounds: HudTakeoverPanBounds,
): { x: number; y: number } {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, pan.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, pan.y)),
  };
}

/** CSS left/top for a cell coord on the canvas (cell centered on the pitch). */
export function cellLeft(x: number, pitchPx: number = HUD_TAKEOVER_PITCH_PX): string {
  return `${x * pitchPx - HUD_TAKEOVER_CELL_PX / 2}px`;
}
export function cellTop(y: number, pitchPx: number = HUD_TAKEOVER_PITCH_PX): string {
  return `${y * pitchPx - HUD_TAKEOVER_CELL_PX / 2}px`;
}

/** Measured size (px) of the map viewport (`.ov-map-clip`). */
export interface HudTakeoverViewportSize {
  width: number;
  height: number;
}

/** Manual zoom range for the map scale; `fitScale` may shrink down to the minimum. */
export const HUD_TAKEOVER_ZOOM_MIN = 0.25;
export const HUD_TAKEOVER_ZOOM_MAX = 2;

/** Multiplicative step for the map's zoom in/out actions. */
export const HUD_TAKEOVER_ZOOM_STEP = 1.25;

/** Clamp a zoom scale into the manual range, rounded to 3 decimals for stable CSS. */
export function clampZoom(scale: number): number {
  const clamped = Math.min(HUD_TAKEOVER_ZOOM_MAX, Math.max(HUD_TAKEOVER_ZOOM_MIN, scale));
  return Math.round(clamped * 1000) / 1000;
}

/**
 * Half-extents (px) of the occupied cells (plus the implicit spec at (0,0))
 * from the canvas origin. The canvas renders centered on the viewport, so
 * the fit is symmetric about (0,0).
 */
function occupiedHalfExtents(
  coords: HudTakeoverCellCoord[],
  pitchPx: number,
): { halfW: number; halfH: number } {
  let ex = 0;
  let ey = 0;
  for (const { x, y } of coords) {
    ex = Math.max(ex, Math.abs(x));
    ey = Math.max(ey, Math.abs(y));
  }
  return {
    halfW: ex * pitchPx + HUD_TAKEOVER_CELL_PX / 2,
    halfH: ey * pitchPx + HUD_TAKEOVER_CELL_PX / 2,
  };
}

/**
 * Uniform zoom-to-fit scale for the map canvas (the manual `zoomFit`
 * target): shrinks (never enlarges) the origin-centered canvas until every
 * occupied cell fits the measured viewport, floored at
 * `HUD_TAKEOVER_ZOOM_MIN` — past the floor, panning covers the rest. An
 * unmeasured viewport (jsdom, pre-layout) keeps the 1:1 scale. Rounded to
 * 3 decimals for stable CSS output.
 */
export function fitScale(
  coords: HudTakeoverCellCoord[],
  viewport: HudTakeoverViewportSize,
  pitchPx: number = HUD_TAKEOVER_PITCH_PX,
): number {
  if (viewport.width <= 0 || viewport.height <= 0) return 1;
  const { halfW, halfH } = occupiedHalfExtents(coords, pitchPx);
  const s = Math.min(1, viewport.width / 2 / halfW, viewport.height / 2 / halfH);
  return Math.round(Math.max(HUD_TAKEOVER_ZOOM_MIN, s) * 1000) / 1000;
}

/**
 * Whether the whole occupied canvas is visible in the viewport at `scale`
 * (so no auto-pan to a far cell is needed). False when the viewport is
 * unmeasured — callers then fall back to the coordinate heuristics.
 */
export function takeoverGraphFits(
  coords: HudTakeoverCellCoord[],
  viewport: HudTakeoverViewportSize,
  scale: number,
  pitchPx: number = HUD_TAKEOVER_PITCH_PX,
): boolean {
  if (viewport.width <= 0 || viewport.height <= 0) return false;
  const { halfW, halfH } = occupiedHalfExtents(coords, pitchPx);
  return halfW * scale <= viewport.width / 2 + 0.5 && halfH * scale <= viewport.height / 2 + 0.5;
}

/**
 * Banner typewriter-wipe duration (s) — mirrors the `bannerin 1.1s` keyframe
 * in `HudTakeoverOverlay.svelte` (kept in sync like the blink constant).
 */
export const HUD_TAKEOVER_BANNER_IN_S = 1.1;

/**
 * Overflow auto-scroll speed (px/s) for a banner whose headline is wider
 * than its box: slow and constant, tuned to a comfortable read-along pace
 * (60–90 px/s band).
 */
export const HUD_TAKEOVER_BANNER_SCROLL_PX_PER_S = 75;

/** Hold (s) at EACH end of the overflow scroll so the head and tail of the line read. */
export const HUD_TAKEOVER_BANNER_SCROLL_HOLD_S = 0.6;

/**
 * Scroll animation duration (s) for a banner overflowing its box by the
 * measured `overflowPx`: constant readable speed plus the short hold at each
 * end. 0 when nothing overflows (<= 0), so no-scroll banners keep the exact
 * pre-scroll timeline. Pure and deterministic — the caller measures the DOM
 * and feeds the result to `bannerOutDelay` (and, via `extraDwellMs`, to
 * `tickTakeoverQueue`) so the dwell covers the whole scroll.
 */
export function bannerScrollDurationS(overflowPx: number): number {
  if (overflowPx <= 0) return 0;
  return overflowPx / HUD_TAKEOVER_BANNER_SCROLL_PX_PER_S + 2 * HUD_TAKEOVER_BANNER_SCROLL_HOLD_S;
}

/**
 * Banner phase timeline, relative to overlay mount (the `opening` phase
 * start; delays feed the CSS `--banner-in/out-delay` vars):
 *   - intro/spotlight: wipe-in choreography ends ~1.2s (= OPEN_MS); the
 *     dwell window then runs [1.2s, 1.2s + dwell + scroll] — a measured
 *     overflow scroll extends the queue dwell via `extraDwellMs`
 *     (additive after the dwell clamp, see `tickTakeoverQueue`).
 *   - unfold: starts at `bannerDelay` (mock 1.0s, or 3.5s when the map must
 *     pan to a far changed cell; +0.3s per stacked banner) and takes the
 *     1.1s typewriter wipe — fully unfolded at ~2.1s in the common no-pan
 *     case.
 *   - overflow scroll: when the headline is wider than its box, the
 *     unfolded headline marquees horizontally for `bannerScrollDurationS`
 *     (constant speed plus an end hold each side); 0s when nothing
 *     overflows.
 *   - unfolded hold: ~50% OF THE ENTRY'S DWELL — `bannerOutDelay` is
 *     dwell-proportional (in-delay + wipe + scroll + dwell/2), not the
 *     mock's fixed 5.2s/7.2s, so longer attention dwells hold the readable
 *     banner longer instead of only extending the map-only tail.
 *   - exit: 0.45s fade, then the map stays alone for the remaining
 *     ~dwell/2 − 1.35s until the close wipe at 1.2s + dwell + scroll.
 * Reduced motion renders banners with no animation at all (no unfold, no
 * fade) — these delays are motion-only.
 */
export function bannerDelay(needsPan: boolean, index: number): string {
  return ((needsPan ? 3.5 : 1.0) + index * 0.3).toFixed(1);
}

/**
 * Fade-out delay allocating ~half the entry's dwell to the fully-unfolded
 * banner (see the timeline above). Derived from the SAME in-delay shape, so
 * stacked banners stagger out as they staggered in and each holds exactly
 * dwell/2 — after its overflow scroll (`scrollS`, from
 * `bannerScrollDurationS`; 0 keeps the no-scroll delay byte-identical) has
 * fully played. When the 3.5s pan pre-roll eats most of a short routine
 * dwell the close wipe may still cut the fade off — pre-existing behavior,
 * unchanged.
 */
export function bannerOutDelay(
  needsPan: boolean,
  index: number,
  dwellMs: number,
  scrollS = 0,
): string {
  const inDelayS = (needsPan ? 3.5 : 1.0) + index * 0.3;
  return (inDelayS + HUD_TAKEOVER_BANNER_IN_S + scrollS + dwellMs / 2000).toFixed(2);
}

/**
 * Bounds of the rendered canvas: one dashed empty ring around the occupied
 * cells, never smaller than the mock's base viewport (x −2…2, y −1…1).
 */
export function canvasBounds(coords: HudTakeoverCellCoord[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = -2;
  let maxX = 2;
  let minY = -1;
  let maxY = 1;
  for (const { x, y } of coords) {
    minX = Math.min(minX, x - 1);
    maxX = Math.max(maxX, x + 1);
    minY = Math.min(minY, y - 1);
    maxY = Math.max(maxY, y + 1);
  }
  return { minX, maxX, minY, maxY };
}

/** Empty dashed cells filling the canvas ring around the occupied grid (+ spec at 0,0). */
export function emptyCellCoords(coords: HudTakeoverCellCoord[]): HudTakeoverCellCoord[] {
  const { minX, maxX, minY, maxY } = canvasBounds(coords);
  const occupied = new Set(coords.map(({ x, y }) => `${x},${y}`));
  occupied.add('0,0');
  const empties: HudTakeoverCellCoord[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!occupied.has(`${x},${y}`)) empties.push({ x, y });
    }
  }
  return empties;
}
