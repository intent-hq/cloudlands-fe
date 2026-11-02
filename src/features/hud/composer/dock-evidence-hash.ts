/**
 * Perceptual screen-change detection for annotate sessions: a 16×16 difference
 * hash over luminance. When the screen under a session changes by more than
 * the threshold, the next mark starts a new session image (numbering continues).
 */

const DOCK_HASH_SIZE = 16;
/** Hamming distance above which the screen is treated as changed. */
const DOCK_SCREEN_CHANGE_DISTANCE = 12;

export interface DockPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Mean luminance of one box-sampled cell of an RGBA buffer. */
function cellLuma(pixels: DockPixels, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  let count = 0;
  for (let y = Math.floor(y0); y < Math.max(Math.floor(y0) + 1, Math.ceil(y1)); y += 1) {
    for (let x = Math.floor(x0); x < Math.max(Math.floor(x0) + 1, Math.ceil(x1)); x += 1) {
      const i = (Math.min(pixels.height - 1, y) * pixels.width + Math.min(pixels.width - 1, x)) * 4;
      sum += 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2];
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

/** 256-bit difference hash as 64 hex characters; empty for an unusable buffer. */
export function differenceHash(pixels: DockPixels): string {
  const { width, height } = pixels;
  if (width < 1 || height < 1 || pixels.data.length < width * height * 4) return '';
  const columns = DOCK_HASH_SIZE + 1;
  const cellW = width / columns;
  const cellH = height / DOCK_HASH_SIZE;
  let hex = '';
  let nibble = 0;
  let bits = 0;
  for (let row = 0; row < DOCK_HASH_SIZE; row += 1) {
    let previous = cellLuma(pixels, 0, row * cellH, cellW, (row + 1) * cellH);
    for (let column = 1; column < columns; column += 1) {
      const current = cellLuma(
        pixels,
        column * cellW,
        row * cellH,
        (column + 1) * cellW,
        (row + 1) * cellH,
      );
      nibble = (nibble << 1) | (current > previous ? 1 : 0);
      previous = current;
      bits += 1;
      if (bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

/** Hamming distance between two equal-length hex hashes; Infinity when not comparable. */
export function hashDistance(a: string, b: string): number {
  if (!a || a.length !== b.length || !/^[0-9a-f]+$/.test(a + b)) return Infinity;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    let diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (diff) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}

/** A missing or incomparable previous hash never forces a new image. */
export function dockScreenChanged(previous: string | undefined, next: string | undefined): boolean {
  if (!previous || !next) return false;
  const distance = hashDistance(previous, next);
  return Number.isFinite(distance) && distance > DOCK_SCREEN_CHANGE_DISTANCE;
}
