import { expect, it } from 'vitest';
import { captureBands, nativeCamera } from './capture-plan';
it.each([1, 2])('keeps a far native target inside the same camera at scale%s', (scale) => {
  const source = { left: 12, top: 8, width: 40000, height: 120 };
  const label = { left: 37280, top: 40, width: 91, height: 15 };
  const camera = nativeCamera(source, label, scale);
  expect((label.left - source.left - camera.x) * scale).toBe(50);
  expect((label.left - source.left - camera.x + label.width) * scale).toBeLessThanOrEqual(256);
});
it('covers the viewport once with bounded adjacent capture bands', () => {
  const bands = captureBands(1);
  expect(bands.map((b) => b.clip.y)).toEqual([0, 64, 128, 192]);
  expect(bands.reduce((n, b) => n + b.clip.width * b.clip.height, 0)).toBe(256 * 256);
  expect(bands.every((b) => b.clip.width * b.clip.height * 4 <= 65536)).toBe(true);
});
it('rejects unproved scale and unbounded or nonfinite target geometry', () => {
  const source = { left: 0, top: 0, width: 900, height: 90 };
  const label = { left: 400, top: 30, width: 80, height: 20 };
  expect(() => nativeCamera(source, label, 3)).toThrow('Invalid');
  expect(() => nativeCamera(source, { ...label, width: 200 }, 2)).toThrow('does not fit');
  expect(() => nativeCamera(source, { ...label, left: NaN }, 1)).toThrow('Invalid');
  expect(() => captureBands(2)).toThrow('Invalid');
});
