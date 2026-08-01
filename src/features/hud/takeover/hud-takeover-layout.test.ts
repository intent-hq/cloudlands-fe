import { describe, expect, it } from 'vitest';
import { canvasBounds, cellNeedsPan, spiralCoords } from './hud-takeover-layout';

describe('hud-takeover-layout', () => {
  it('places the first cells on the mock seed spiral', () => {
    expect(spiralCoords(3)).toEqual([
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
    ]);
  });

  it('is deterministic: same count, same coords', () => {
    expect(spiralCoords(20)).toEqual(spiralCoords(20));
  });

  it('never reuses a coordinate or the spec origin', () => {
    const coords = spiralCoords(60);
    const keys = coords.map((c) => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(60);
    expect(keys).not.toContain('0,0');
  });

  it('walks outward: later cells are never closer than 2 rings before them', () => {
    const coords = spiralCoords(60);
    const ring = (c: { x: number; y: number }) => Math.max(Math.abs(c.x), Math.abs(c.y));
    for (let i = 15; i < coords.length; i++) {
      expect(ring(coords[i])).toBeGreaterThanOrEqual(2);
    }
  });

  it('flags far cells for pan per the mock thresholds', () => {
    expect(cellNeedsPan({ x: 0, y: -1 })).toBe(false);
    expect(cellNeedsPan({ x: 2, y: 1 })).toBe(false);
    expect(cellNeedsPan({ x: 3, y: 0 })).toBe(true);
    expect(cellNeedsPan({ x: 0, y: 2 })).toBe(true);
    expect(cellNeedsPan({ x: -3, y: -2 })).toBe(true);
  });

  it('bounds include a dashed ring and never shrink below the base viewport', () => {
    expect(canvasBounds([])).toEqual({ minX: -2, maxX: 2, minY: -1, maxY: 1 });
    expect(canvasBounds([{ x: 3, y: 2 }])).toEqual({ minX: -2, maxX: 4, minY: -1, maxY: 3 });
  });
});
