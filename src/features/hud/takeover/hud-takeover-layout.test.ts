import { describe, expect, it } from 'vitest';
import {
  canvasBounds,
  cellNeedsPan,
  clampTakeoverPan,
  emptyCellCoords,
  HUD_TAKEOVER_PITCH_PX,
  spiralCoords,
  takeoverFrameFrom,
  takeoverPanBounds,
} from './hud-takeover-layout';

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

  it('empty cells fill the canvas minus the occupied coords and the spec origin', () => {
    const empties = emptyCellCoords([{ x: 1, y: 0 }]);
    const keys = new Set(empties.map((c) => `${c.x},${c.y}`));
    // Base viewport 5×3 minus spec (0,0) and the one task cell.
    expect(empties).toHaveLength(13);
    expect(keys.has('0,0')).toBe(false);
    expect(keys.has('1,0')).toBe(false);
    expect(keys.has('-2,-1')).toBe(true);
    expect(keys.has('2,1')).toBe(true);
  });

  describe('drag-to-pan bounds', () => {
    it('converts the canvas bounds to px camera limits', () => {
      expect(takeoverPanBounds([])).toEqual({
        minX: -2 * HUD_TAKEOVER_PITCH_PX,
        maxX: 2 * HUD_TAKEOVER_PITCH_PX,
        minY: -1 * HUD_TAKEOVER_PITCH_PX,
        maxY: 1 * HUD_TAKEOVER_PITCH_PX,
      });
      expect(takeoverPanBounds([{ x: 4, y: -3 }])).toEqual({
        minX: -2 * HUD_TAKEOVER_PITCH_PX,
        maxX: 5 * HUD_TAKEOVER_PITCH_PX,
        minY: -4 * HUD_TAKEOVER_PITCH_PX,
        maxY: 1 * HUD_TAKEOVER_PITCH_PX,
      });
    });

    it('clamps a camera offset into the bounds (cells never fully off-screen)', () => {
      const bounds = takeoverPanBounds([]);
      expect(clampTakeoverPan({ x: 0, y: 0 }, bounds)).toEqual({ x: 0, y: 0 });
      expect(clampTakeoverPan({ x: 10_000, y: -10_000 }, bounds)).toEqual({
        x: bounds.maxX,
        y: bounds.minY,
      });
      expect(clampTakeoverPan({ x: -300, y: 150 }, bounds)).toEqual({ x: -300, y: 150 });
    });
  });

  describe('takeoverFrameFrom (FLIP zoom-from transform)', () => {
    const shell = { left: 0, top: 0, width: 1600, height: 900 };

    it('computes the card-center offset from the shell center and card/frame scale', () => {
      // Frame renders at min(1560, 1600-120)=1480 × min(850, 900-120)=780.
      const card = { left: 100, top: 200, width: 296, height: 296 };
      const from = takeoverFrameFrom(shell, card);
      expect(from).not.toBeNull();
      expect(from!.x).toBeCloseTo(100 + 148 - 800); // card center X − shell center X
      expect(from!.y).toBeCloseTo(200 + 148 - 450);
      expect(from!.sx).toBeCloseTo(296 / 1480);
      expect(from!.sy).toBeCloseTo(296 / 780);
    });

    it('accounts for a shell not anchored at the viewport origin', () => {
      const offsetShell = { left: 50, top: 30, width: 1600, height: 900 };
      const card = { left: 850, top: 480, width: 200, height: 200 };
      const from = takeoverFrameFrom(offsetShell, card);
      expect(from!.x).toBeCloseTo(850 + 100 - 50 - 800);
      expect(from!.y).toBeCloseTo(480 + 100 - 30 - 450);
    });

    it('returns null on degenerate rects (hidden card / unlaid-out shell)', () => {
      expect(takeoverFrameFrom(shell, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
      expect(
        takeoverFrameFrom({ left: 0, top: 0, width: 0, height: 0 }, { left: 0, top: 0, width: 10, height: 10 }),
      ).toBeNull();
      // Shell smaller than the frame margin → no usable frame box.
      expect(
        takeoverFrameFrom(
          { left: 0, top: 0, width: 100, height: 100 },
          { left: 0, top: 0, width: 50, height: 50 },
        ),
      ).toBeNull();
    });
  });
});
