import { describe, expect, it } from 'vitest';
import { jumpToMinimapPoint, resolveMinimapRect } from './minimap';

describe('semantic map minimap', () => {
  const viewport = { width: 960, height: 620 };

  it('only appears for a navigated, non-compact viewport', () => {
    expect(resolveMinimapRect(viewport, { x: 0, y: 0, scale: 1 })).toBeNull();
    expect(resolveMinimapRect({ width: 767, height: 620 }, { x: 20, y: 0, scale: 1 })).toBeNull();
    expect(resolveMinimapRect({ width: 960, height: 239 }, { x: 20, y: 0, scale: 1 })).toBeNull();
    expect(resolveMinimapRect(viewport, { x: 20, y: 0, scale: 1 })).toEqual({
      x: 784,
      y: 504,
      width: 160,
      height: 100,
    });
    expect(resolveMinimapRect(viewport, { x: 0, y: 0, scale: 1.5 })).not.toBeNull();
  });

  it('moves away from the focused hull and hides when no corner is clear', () => {
    const transform = { x: 0, y: 0, scale: 1.2 };
    expect(
      resolveMinimapRect(viewport, transform, [
        [700, 400],
        [800, 400],
        [800, 520],
        [700, 520],
      ]),
    ).toMatchObject({ x: 16, y: 504 });
    expect(
      resolveMinimapRect(viewport, transform, [
        [0, 0],
        [800, 0],
        [800, 517],
        [0, 517],
      ]),
    ).toBeNull();
  });

  it('centres the clicked minimap location without changing zoom', () => {
    const transform = { x: -120, y: -80, scale: 2 };
    const minimap = { x: 784, y: 504, width: 160, height: 100 };
    expect(
      jumpToMinimapPoint(viewport, transform, minimap, { x: minimap.x + 40, y: minimap.y + 75 }),
    ).toEqual({ x: 0, y: -620, scale: 2 });
  });
});
