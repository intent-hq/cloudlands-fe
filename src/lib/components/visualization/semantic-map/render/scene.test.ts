import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => vi.useRealTimers());

describe('semantic map render scene', () => {
  const activities: MapActivity[] = [
    {
      id: 'activity-1',
      agentId: 'a',
      regionId: 'one',
      kind: 'read',
      ts: '2026-09-06T10:01:00.000Z',
    },
    {
      id: 'activity-2',
      agentId: 'a',
      regionId: 'one',
      kind: 'edit',
      ts: '2026-09-06T10:02:00.000Z',
    },
    {
      id: 'activity-3',
      agentId: 'b',
      regionId: 'two',
      kind: 'edit',
      ts: '2026-09-06T10:03:00.000Z',
    },
    {
      id: 'activity-4',
      agentId: 'a',
      regionId: 'one',
      kind: 'edit',
      ts: '2026-09-06T10:11:00.000Z',
    },
  ];

  it('treats absent and empty filters as showing every activity in the window', () => {
    expect(filterActivities(activities, {}, window)).toEqual(activities.slice(0, 3));
    expect(filterActivities(activities, { agentIds: [], kinds: [] }, window)).toEqual(
      activities.slice(0, 3),
    );
  });

  it('supports single and multi-value agent and kind filters', () => {
    expect(filterActivities(activities, { agentIds: ['a'], kinds: ['edit'] }, window)).toEqual([
      activities[1],
    ]);
    expect(
      filterActivities(activities, { agentIds: ['a', 'b'], kinds: ['read', 'edit'] }, window),
    ).toEqual(activities.slice(0, 3));
  });

  it('ages current live activity against now instead of the unbounded window end', () => {
    const now = new Date('2026-09-07T05:00:00.000Z');
    const currentActivities: MapActivity[] = ['read', 'edit', 'tool'].map((kind, index) => ({
      id: `current-${kind}`,
      agentId: 'a',
      regionId: 'one',
      kind: kind as MapActivity['kind'],
      ts: new Date(now.getTime() - (2 - index) * 100).toISOString(),
    }));
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const scene = buildScene({
      activities: currentActivities,
      filters: {},
      timeWindow: {
        start: '1970-01-01T00:00:00.000Z',
        end: '9999-12-31T23:59:59.999Z',
      },
      geometry,
      neutral: '#neutral',
      fileLabel: (count) => `${count}`,
    });

    expect(scene.marks.map(({ kind }) => kind)).toEqual(['read', 'edit']);
    expect(scene.badges).toHaveLength(1);
    expect(scene.badges[0].toolAgeMs).toBe(0);
    expect(scene.hasMotion).toBe(true);
  });

  it('keeps only each agent latest tool or thinking badge state inside the time window', () => {
    const cueActivities: MapActivity[] = [
      { id: 'old-tool', agentId: 'outside', kind: 'tool', ts: '2026-09-06T09:59:59.000Z' },
      { id: 'thinking', agentId: 'thinking', kind: 'thinking', ts: '2026-09-06T10:09:58.000Z' },
      { id: 'tool', agentId: 'tool', kind: 'tool', ts: '2026-09-06T10:09:59.000Z' },
      { id: 'superseded-tool', agentId: 'editing', kind: 'tool', ts: '2026-09-06T10:09:58.000Z' },
      {
        id: 'latest-edit',
        agentId: 'editing',
        regionId: 'one',
        kind: 'edit',
        ts: '2026-09-06T10:09:59.000Z',
      },
    ];
    const scene = buildScene({
      activities: cueActivities,
      filters: {},
      timeWindow: window,
      geometry,
      neutral: '#neutral',
      fileLabel: (count) => `${count}`,
    });

    expect(scene.badges.find(({ id }) => id === 'thinking')).toMatchObject({ thinking: true });
    expect(scene.badges.find(({ id }) => id === 'tool')?.toolAgeMs).toBe(1_000);
    const editingBadge = scene.badges.find(({ id }) => id === 'editing');
    expect(editingBadge).toMatchObject({ thinking: false });
    expect(editingBadge).not.toHaveProperty('toolAgeMs');
    expect(scene.badges.some(({ id }) => id === 'outside')).toBe(false);
  });

  it('fans collocated badges and uses at most eight agent hues', () => {
    const activities: MapActivity[] = Array.from({ length: 9 }, (_, index) => ({
      id: `activity-${index}`,
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
      {
        id: 'activity-1',
        agentId: 'a',
        regionId: 'one',
        kind: 'edit',
        ts: '2026-09-06T10:09:59.000Z',
      },
      {
        id: 'activity-2',
        agentId: 'a',
        regionId: 'two',
        kind: 'move',
        ts: '2026-09-06T10:10:00.000Z',
      },
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
