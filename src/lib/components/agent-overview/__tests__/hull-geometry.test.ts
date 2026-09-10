import { polygonContains } from 'd3';
import { describe, expect, it } from 'vitest';
import {
  buildBusyGraph,
  buildConstellationGraph,
} from '../__fixtures__/agent-activity-graph.fixtures';
import { createConstellationLayout } from '../constellation-layout';
import { GRAPH_NODE_DIMENSIONS } from '../constants';
import { deriveTaskHullMemberships } from '../graph-helpers';
import {
  HULL_FILL_OPACITIES,
  HULL_PADDING,
  TWO_MEMBER_HULL_PADDING,
  interpolateHullMembers,
  organicHull,
  paddedHull,
  smoothClosedHullPath,
  taskHullPadding,
  type HullMember,
} from '../hull-geometry';

function paddedMemberPoints(member: HullMember, padding = HULL_PADDING): [number, number][] {
  const centerX = member.x + member.offsetX;
  const centerY = member.y + member.offsetY;
  const halfWidth = member.width / 2;
  const halfHeight = member.height / 2;
  return [
    [centerX - halfWidth - padding, centerY - halfHeight],
    [centerX + halfWidth + padding, centerY - halfHeight],
    [centerX + halfWidth, centerY + halfHeight + padding],
    [centerX - halfWidth, centerY + halfHeight + padding],
    [centerX - halfWidth, centerY - halfHeight],
    [centerX + halfWidth, centerY - halfHeight],
    [centerX + halfWidth, centerY + halfHeight],
    [centerX - halfWidth, centerY + halfHeight],
  ];
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

  it('encloses the padded extents of every member with one connected ring', () => {
    const members = [
      { x: 40, y: 80, width: 60, height: 30, offsetX: 0, offsetY: 8 },
      { x: 180, y: 40, width: 120, height: 40, offsetX: -4, offsetY: 0 },
      { x: 130, y: 170, width: 50, height: 90, offsetX: 6, offsetY: -3 },
    ];
    const hull = organicHull(members);

    expect(hull).not.toBeNull();
    for (const point of members.flatMap(paddedMemberPoints)) {
      expect(polygonContains(hull!, point)).toBe(true);
    }
  });

  it('follows an L-shaped cluster instead of filling its convex gap', () => {
    const members = [
      { x: 0, y: 0, width: 48, height: 32, offsetX: 0, offsetY: 0 },
      { x: 140, y: 0, width: 48, height: 32, offsetX: 0, offsetY: 0 },
      { x: 0, y: 140, width: 48, height: 32, offsetX: 0, offsetY: 0 },
    ];
    const hull = organicHull(members);

    expect(hull).not.toBeNull();
    expect(polygonContains(hull!, [105, 105])).toBe(false);
    expect(smoothClosedHullPath(hull)?.match(/M/g)).toHaveLength(1);
  });

  it.each([
    ['constellation', buildConstellationGraph],
    ['busy', buildBusyGraph],
  ] as const)('emits exactly one smooth ring for every %s task hull', (_name, buildGraph) => {
    const graph = buildGraph(Date.parse('2026-09-04T02:00:00.000Z'));
    const layout = createConstellationLayout({ width: 1092, height: 720, seed: 7 });
    let settledNodes = graph.nodes;
    const stopTick = layout.tick((nodes) => (settledNodes = nodes));
    layout.update(graph.nodes, graph.edges);
    layout.settle();
    stopTick();
    layout.stop();
    const nodeById = new Map(settledNodes.map((node) => [node.id, node]));
    const memberships = deriveTaskHullMemberships(settledNodes, graph.edges);

    expect(memberships.length).toBeGreaterThan(0);
    for (const group of memberships) {
      const members = group.memberIds.map((id) => {
        const node = nodeById.get(id)!;
        return { ...node, ...GRAPH_NODE_DIMENSIONS[node.type], offsetX: 0, offsetY: 0 };
      });
      const path = smoothClosedHullPath(organicHull(members));
      expect(path?.match(/M/g), group.taskId).toHaveLength(1);
      expect(path?.match(/Z/g), group.taskId).toHaveLength(1);
    }
  });

  it('creates a rounded rectangle for one member', () => {
    const member = { x: 100, y: 120, width: 80, height: 40, offsetX: 5, offsetY: 10 };
    const hull = paddedHull([member]);

    expect(hull).toHaveLength(20);
    for (const point of paddedMemberPoints(member)) {
      expect(polygonContains(hull!, point)).toBe(true);
    }
    expect(smoothClosedHullPath(hull)).toMatch(/^M.*Z$/);
  });

  it('creates a rounded capsule fallback for two members', () => {
    const members = [
      { x: 60, y: 90, width: 56, height: 40, offsetX: 0, offsetY: 4 },
      { x: 180, y: 90, width: 72, height: 52, offsetX: -3, offsetY: 0 },
    ];
    const padding = taskHullPadding(members.length, 25);
    const hull = paddedHull(members, padding);

    expect(padding).toBe(TWO_MEMBER_HULL_PADDING);
    expect(hull).not.toBeNull();
    for (const point of members.flatMap((member) => paddedMemberPoints(member, padding))) {
      expect(polygonContains(hull!, point)).toBe(true);
    }
  });

  it.each([0.6, 1])('encloses a centered 176x48 task box at zoom %s', (zoomScale) => {
    const task = { x: 100, y: 120, width: 176, height: 48, offsetX: 0, offsetY: 0 };
    const agent = { x: 300, y: 120, width: 112, height: 102, offsetX: 0, offsetY: 0 };
    const hull = organicHull([task, agent], HULL_PADDING / zoomScale);

    expect(hull).not.toBeNull();
    for (const point of paddedMemberPoints(task, 0)) {
      expect(polygonContains(hull!, point)).toBe(true);
    }
  });

  it('smooths outlines with continuous curves instead of straight segments', () => {
    const path = smoothClosedHullPath([
      [0, 0],
      [80, 0],
      [80, 80],
      [0, 80],
    ]);

    expect(path).toMatch(/^M/);
    expect(path).toContain('C');
    expect(path).not.toContain('L');
    expect(path).toMatch(/Z$/);
  });

  it('grows joining members from and shrinks leaving members toward the task anchor', () => {
    const anchor = { x: 0, y: 0 };
    const task = {
      id: 'task',
      ...anchor,
      width: 20,
      height: 12,
      offsetX: 0,
      offsetY: 2,
    };
    const leaving = {
      id: 'leaving',
      x: 20,
      y: 0,
      width: 8,
      height: 6,
      offsetX: -2,
      offsetY: 0,
    };
    const joining = {
      id: 'joining',
      x: 40,
      y: 0,
      width: 16,
      height: 10,
      offsetX: 2,
      offsetY: 4,
    };

    const start = interpolateHullMembers([task, leaving], [task, joining], anchor, 0);
    const midpoint = interpolateHullMembers([task, leaving], [task, joining], anchor, 0.5);
    const end = interpolateHullMembers([task, leaving], [task, joining], anchor, 1);

    expect(start.find((member) => member.id === 'joining')).toMatchObject({ x: 0, width: 0 });
    expect(midpoint.find((member) => member.id === 'joining')).toMatchObject({
      x: 20,
      width: 8,
      height: 5,
      offsetX: 1,
      offsetY: 2,
    });
    expect(midpoint.find((member) => member.id === 'leaving')).toMatchObject({
      x: 10,
      width: 4,
      height: 3,
      offsetX: -1,
    });
    expect(end).toEqual([task, joining]);
  });
});
