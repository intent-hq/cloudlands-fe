/**
 * Pure sector math for the joystick radial menu. The joystick streams a
 * normalized polar sample `{a, d}`: `a` is the angular position wrapping
 * 0.0–1.0 and `d` the deflection from center 0.0–1.0. The device sends no
 * sector — the host divides the circle into `sectorCount` equal slices.
 */

/** Wrap an angle into [0, 1). Handles negatives and values >= 1. */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const wrapped = angle % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

/** Clamp a deflection into [0, 1]. */
export function clampDistance(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return distance > 1 ? 1 : distance;
}

/**
 * Map a normalized angle to a 0-based sector index.
 *
 * @param angle Normalized angular position (any finite number; wrapped).
 * @param sectorCount Number of equal radial sectors (>= 1).
 * @param sectorOffset Rotation offset in turns subtracted before slicing, so
 *   callers can calibrate which physical direction sector 0 starts at.
 */
export function angleToSector(angle: number, sectorCount: number, sectorOffset = 0): number {
  if (!Number.isInteger(sectorCount) || sectorCount < 1) {
    throw new RangeError(`sectorCount must be a positive integer, got ${sectorCount}`);
  }
  const normalized = normalizeAngle(angle - sectorOffset);
  // The epsilon counters float error from the offset subtraction (e.g.
  // 0.35 - 0.1 = 0.24999999999999997) so exact-boundary samples land in the
  // intended sector; it is far below the stream's precision. A result of
  // sectorCount means the angle was within epsilon of a full turn — wrap to 0.
  const sector = Math.floor(normalized * sectorCount + 1e-9);
  return sector >= sectorCount ? 0 : sector;
}

/**
 * Convert a device joystick angle to a screen turn measured clockwise from
 * 12 o'clock.
 *
 * The device's `a = 0` points right (3 o'clock) and increases clockwise on
 * screen — the vendor app plots the stick at `(cos 2πa, sin 2πa)` in y-down
 * screen coordinates. Screen turns share the direction but start at the top,
 * so the conversion is a quarter-turn rotation (no mirroring).
 */
export function deviceAngleToScreenTurn(angle: number): number {
  return normalizeAngle(angle + 0.25);
}
