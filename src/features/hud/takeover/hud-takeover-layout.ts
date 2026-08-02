/**
 * HUD takeover task-map layout — deterministic placement of task cells
 * around the spec cell at (0,0) on the mock's infinite canvas (180px 1:1
 * cells on a 192px pitch). Real tasks carry no coordinates, so the FE
 * assigns them by task order along a fixed spiral (mock `synthDef` coords):
 * ring 1 first (top, right, left, diagonals, bottom…), then outward. The
 * same task list always yields the same map on every HUD instance.
 */

/** Mock canvas metrics: cell size and grid pitch (`renderVals` PITCH/CS). */
export const HUD_TAKEOVER_CELL_PX = 180;
export const HUD_TAKEOVER_PITCH_PX = 192;

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

/** Preferred near-spiral order (mock `synthDef` coords), then ring walks. */
const SEED_COORDS: HudTakeoverCellCoord[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 1, y: -1 },
  { x: -1, y: -1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: 2, y: 0 },
  { x: 2, y: -1 },
  { x: 2, y: 1 },
  { x: 0, y: -2 },
  { x: 1, y: -2 },
  { x: -1, y: -2 },
];

/**
 * Coordinates for `count` task cells in placement order. Beyond the seeded
 * 14, walks square rings outward (ring r = Chebyshev distance r), top-left
 * to bottom-right, skipping already-seeded coords — still fully
 * deterministic.
 */
export function spiralCoords(count: number): HudTakeoverCellCoord[] {
  const coords = SEED_COORDS.slice(0, count);
  if (coords.length >= count) return coords;
  const used = new Set(SEED_COORDS.map((c) => `${c.x},${c.y}`));
  used.add('0,0');
  for (let ring = 2; coords.length < count; ring++) {
    for (let y = -ring; y <= ring && coords.length < count; y++) {
      for (let x = -ring; x <= ring && coords.length < count; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue;
        const key = `${x},${y}`;
        if (used.has(key)) continue;
        used.add(key);
        coords.push({ x, y });
      }
    }
  }
  return coords;
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
export function takeoverPanBounds(coords: HudTakeoverCellCoord[]): HudTakeoverPanBounds {
  const { minX, maxX, minY, maxY } = canvasBounds(coords);
  return {
    minX: minX * HUD_TAKEOVER_PITCH_PX,
    maxX: maxX * HUD_TAKEOVER_PITCH_PX,
    minY: minY * HUD_TAKEOVER_PITCH_PX,
    maxY: maxY * HUD_TAKEOVER_PITCH_PX,
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
export function cellLeft(x: number): string {
  return `${x * HUD_TAKEOVER_PITCH_PX - HUD_TAKEOVER_CELL_PX / 2}px`;
}
export function cellTop(y: number): string {
  return `${y * HUD_TAKEOVER_PITCH_PX - HUD_TAKEOVER_CELL_PX / 2}px`;
}

/** Banner delay per mock: 3.5s when panning, 1.0s otherwise, +0.3s each. */
export function bannerDelay(needsPan: boolean, index: number): string {
  return ((needsPan ? 3.5 : 1.0) + index * 0.3).toFixed(1);
}

/** Banner fade-out delay per mock: 7.2s when panning, 5.2s otherwise, +0.15s each. */
export function bannerOutDelay(needsPan: boolean, index: number): string {
  return ((needsPan ? 7.2 : 5.2) + index * 0.15).toFixed(2);
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
