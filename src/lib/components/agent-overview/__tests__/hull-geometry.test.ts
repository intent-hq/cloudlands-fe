import { polygonContains } from 'd3';
import { describe, expect, it } from 'vitest';
import {
  HULL_FILL_OPACITIES,
  HULL_PADDING,
  paddedHull,
  smoothClosedHullPath,
  type HullMember,
} from '../hull-geometry';

function paddedMemberPoints(member: HullMember): [number, number][] {
  const radius = member.radius + HULL_PADDING;
  return Array.from({ length: 32 }, (_, index) => {
    const angle = (index / 32) * Math.PI * 2;
    return [member.x + Math.cos(angle) * radius, member.y + Math.sin(angle) * radius];
  });
}

describe('task hull geometry', () => {
  it('keeps both stacked fills at the quiet half-opacity levels', () => {
    expect(HULL_FILL_OPACITIES).toEqual({
      dimmed: 0.006,
      focusedWorking: 0.05,
      focusedIdle: 0.0375,
      working: 0.04,
      idle: 0.0275,
      softenerRatio: 0.34,
    });
  });

  it('encloses the padded extents of every member', () => {
    const members = [
      { x: 40, y: 80, radius: 22 },
      { x: 180, y: 40, radius: 30 },
      { x: 130, y: 170, radius: 26 },
    ];
    const hull = paddedHull(members);

    expect(hull).not.toBeNull();
    for (const point of members.flatMap(paddedMemberPoints)) {
      expect(polygonContains(hull!, point)).toBe(true);
    }
  });

  it('creates a circular fallback for one member', () => {
    const hull = paddedHull([{ x: 100, y: 120, radius: 30 }]);

    expect(hull).toHaveLength(16);
    expect(polygonContains(hull!, [100, 120])).toBe(true);
    expect(smoothClosedHullPath(hull)).toMatch(/^M.*Z$/);
  });

  it('creates a rounded capsule fallback for two members', () => {
    const members = [
      { x: 60, y: 90, radius: 20 },
      { x: 180, y: 90, radius: 28 },
    ];
    const hull = paddedHull(members);

    expect(hull).not.toBeNull();
    for (const point of members.flatMap(paddedMemberPoints)) {
      expect(polygonContains(hull!, point)).toBe(true);
    }
  });

  it('smooths polygons into a closed path', () => {
    const path = smoothClosedHullPath([
      [0, 0],
      [80, 0],
      [80, 80],
      [0, 80],
    ]);

    expect(path).toMatch(/^M/);
    expect(path).toMatch(/Z$/);
  });
});
