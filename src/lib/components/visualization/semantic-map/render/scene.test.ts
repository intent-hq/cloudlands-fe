import { describe, expect, it } from 'vitest';
import type { MapActivity } from '../core/types';
import type { RegionGeometry } from '../layout/place';
import { buildRouteEdges, buildScene, filterActivities, hitRouteEdge } from './scene';

const geometry: RegionGeometry[] = [
  {
    id: 'one',
    x: 100,
    y: 100,
    radius: 50,
    budget: 0.5,
    hull: [
      [50, 50],
      [150, 50],
      [150, 150],
      [50, 150],
    ],
  },
  {
    id: 'two',
    x: 300,
    y: 100,
    radius: 50,
    budget: 0.5,
    hull: [
      [250, 50],
      [350, 50],
      [350, 150],
      [250, 150],
    ],
  },
];

const window = {
  start: '2026-09-06T10:00:00.000Z',
  end: '2026-09-06T10:10:00.000Z',
};

describe('semantic map render scene', () => {
  it('filters the daemon activity stream by time, agent and kind', () => {
    const activities: MapActivity[] = [
      { agentId: 'a', regionId: 'one', kind: 'read', ts: '2026-09-06T10:01:00.000Z' },
      { agentId: 'a', regionId: 'one', kind: 'edit', ts: '2026-09-06T10:02:00.000Z' },
      { agentId: 'b', regionId: 'two', kind: 'edit', ts: '2026-09-06T10:03:00.000Z' },
      { agentId: 'a', regionId: 'one', kind: 'edit', ts: '2026-09-06T10:11:00.000Z' },
    ];

    expect(filterActivities(activities, { agentIds: ['a'], kinds: ['edit'] }, window)).toEqual([
      activities[1],
    ]);
  });

  it('fans collocated badges and uses at most eight agent hues', () => {
    const activities: MapActivity[] = Array.from({ length: 9 }, (_, index) => ({
      agentId: `agent-${index}`,
      agentName: `Agent ${index}`,
      regionId: 'one',
      kind: 'edit',
      ts: `2026-09-06T10:0${index}:00.000Z`,
    }));
    const scene = buildScene({
      activities,
      filters: {},
      timeWindow: window,
      geometry,
      neutral: '#neutral',
      fileLabel: (count) => `${count}`,
    });

    expect(new Set(scene.badges.slice(0, 8).map(({ color }) => color)).size).toBe(8);
    expect(scene.badges[8].color).toBe('#neutral');
    expect(new Set(scene.badges.map(({ x, y }) => `${x}:${y}`)).size).toBe(9);
  });

  it('infers move travel from the agent previous region', () => {
    const activities: MapActivity[] = [
      { agentId: 'a', regionId: 'one', kind: 'edit', ts: '2026-09-06T10:09:59.000Z' },
      { agentId: 'a', regionId: 'two', kind: 'move', ts: '2026-09-06T10:10:00.000Z' },
    ];
    const scene = buildScene({
      activities,
      filters: {},
      timeWindow: window,
      geometry,
      neutral: '#neutral',
      fileLabel: (count) => `${count}`,
    });

    expect(scene.marks.find(({ kind }) => kind === 'move')).toMatchObject({
      fromX: 100,
      fromY: 100,
    });
  });

  it('renders declared and factual route labels with evidence hit targets', () => {
    const edges = buildRouteEdges(
      {
        visits: ['one', 'two'],
        transitions: [
          { from: 'one', to: 'two', count: 3, evidence: ['a.ts', 'b.ts'], label: 'Declared' },
          { from: 'two', to: 'one', count: 1, evidence: ['c.ts'] },
        ],
      },
      geometry,
      (count) => `${count} files`,
    );

    expect(edges.map(({ label }) => label)).toEqual(['Declared', '1 files']);
    expect(edges[0].evidence).toEqual(['a.ts', 'b.ts']);
    expect(hitRouteEdge(edges[0], 200, 112, 8)).toBe(true);
    expect(hitRouteEdge(edges[0], 200, 180, 8)).toBe(false);
  });
});
