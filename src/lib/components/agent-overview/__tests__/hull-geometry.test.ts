import { polygonContains } from 'd3';
import { describe, expect, it } from 'vitest';
import {
  HULL_FILL_OPACITIES,
  HULL_PADDING,
  TWO_MEMBER_HULL_PADDING,
  interpolateHullMembers,
  paddedHull,
  smoothClosedHullPath,
  taskHullPadding,
  type HullMember,
} from '../hull-geometry';

function paddedMemberPoints(member: HullMember, padding = HULL_PADDING): [number, number][] {
  const radius = member.radius + padding;
  return Array.from({ length: 32 }, (_, index) => {
    const angle = (index / 32) * Math.PI * 2;
    return [member.x + Math.cos(angle) * radius, member.y + Math.sin(angle) * radius];
  });
}

describe('task hull geometry', () => {
  it('keeps working, idle, focused, and dimmed fills perceptibly distinct', () => {
    expect(HULL_FILL_OPACITIES).toEqual({
      dimmed: 0.012,
      focusedWorking: 0.12,
      focusedIdle: 0.06,
      working: 0.09,
      idle: 0.035,
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
    const padding = taskHullPadding(members.length, 25);
    const hull = paddedHull(members, padding);

    expect(padding).toBe(TWO_MEMBER_HULL_PADDING);
    expect(hull).not.toBeNull();
    for (const point of members.flatMap((member) => paddedMemberPoints(member, padding))) {
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

  it('grows joining members from and shrinks leaving members toward the task anchor', () => {
    const anchor = { x: 0, y: 0 };
    const task = { id: 'task', ...anchor, radius: 10 };
    const leaving = { id: 'leaving', x: 20, y: 0, radius: 4 };
    const joining = { id: 'joining', x: 40, y: 0, radius: 8 };

    const start = interpolateHullMembers([task, leaving], [task, joining], anchor, 0);
    const midpoint = interpolateHullMembers([task, leaving], [task, joining], anchor, 0.5);
    const end = interpolateHullMembers([task, leaving], [task, joining], anchor, 1);

    expect(start.find((member) => member.id === 'joining')).toMatchObject({ x: 0, radius: 0 });
    expect(midpoint.find((member) => member.id === 'joining')).toMatchObject({ x: 20, radius: 4 });
    expect(midpoint.find((member) => member.id === 'leaving')).toMatchObject({ x: 10, radius: 2 });
    expect(end).toEqual([task, joining]);
  });
});
