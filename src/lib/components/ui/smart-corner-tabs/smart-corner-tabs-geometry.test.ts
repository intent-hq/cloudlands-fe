import { describe, expect, it } from 'vitest';
import {
  clampSurfaceGeometry,
  interpolateSurfaceGeometry,
  makeSurfacePath,
  type SurfaceGeometry,
} from './smart-corner-tabs-geometry';

const baseGeometry: SurfaceGeometry = {
  width: 640,
  height: 420,
  x: 180,
  tabWidth: 136,
  topY: 0,
  panelY: 48,
  radius: 20,
  outerRadius: 20,
};

describe('smart corner tab surface geometry', () => {
  it('keeps the active tab joins inside the surface bounds', () => {
    const geometry = clampSurfaceGeometry({
      ...baseGeometry,
      x: -40,
      tabWidth: 620,
      radius: 80,
      panelY: 20,
    });

    expect(geometry.x - geometry.radius).toBeGreaterThanOrEqual(0);
    expect(geometry.x + geometry.tabWidth + geometry.radius).toBeLessThanOrEqual(geometry.width);
    expect(geometry.radius).toBeLessThanOrEqual((geometry.panelY - geometry.topY) / 2);
  });

  it('uses a stable command topology for every active tab width', () => {
    const first = makeSurfacePath(baseGeometry);
    const second = makeSurfacePath({ ...baseGeometry, x: 420, tabWidth: 92 });

    expect(first.match(/C/g)?.length).toBe(4);
    expect(second.match(/C/g)?.length).toBe(4);
    expect(first.match(/H/g)?.length).toBe(4);
    expect(second.match(/H/g)?.length).toBe(4);
    expect(first.match(/Q/g)?.length).toBe(2);
    expect(second.match(/Q/g)?.length).toBe(2);
    expect(first.endsWith(' Z')).toBe(true);
    expect(second.endsWith(' Z')).toBe(true);
  });

  it('retargets from the rendered geometry through interpolation', () => {
    const target = { ...baseGeometry, x: 412, tabWidth: 208 };
    const current = interpolateSurfaceGeometry(baseGeometry, target, 0.5);

    expect(current.x).toBe(296);
    expect(current.tabWidth).toBe(172);
    expect(interpolateSurfaceGeometry(baseGeometry, target, 2)).toEqual(
      clampSurfaceGeometry(target),
    );
  });
});
