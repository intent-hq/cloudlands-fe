// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isPaintProbe, type Pixel } from './aurora-panel-pixels';

describe('Aurora paint probe classification', () => {
  it.each<{ name: string; pixel: Pixel }>([
    { name: 'opaque magenta', pixel: [255, 0, 255, 255] },
    { name: 'magenta under the dark horizontal scroll fade', pixel: [187, 12, 187, 255] },
    { name: 'partially covered magenta', pixel: [140, 20, 140, 255] },
  ])('recognizes $name', ({ pixel }) => {
    expect(isPaintProbe(pixel)).toBe(true);
  });

  it.each<{ name: string; pixel: Pixel }>([
    { name: 'dark corner background', pixel: [36, 36, 36, 255] },
    { name: 'light corner background', pixel: [240, 240, 240, 255] },
    { name: 'white', pixel: [255, 255, 255, 255] },
    { name: 'black', pixel: [0, 0, 0, 255] },
    { name: 'red without blue', pixel: [255, 0, 0, 255] },
    { name: 'blue without red', pixel: [0, 0, 255, 255] },
    { name: 'weak magenta tint', pixel: [180, 140, 180, 255] },
  ])('rejects $name', ({ pixel }) => {
    expect(isPaintProbe(pixel)).toBe(false);
  });
});
