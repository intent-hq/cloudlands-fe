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
