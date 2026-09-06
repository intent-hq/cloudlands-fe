import { describe, expect, it } from 'vitest';
import manifestJson from '../fixtures/intent-manifest.json';
import type { Manifest, Route } from '../core/types';
import { computeBudget } from '../layout/budget';
import { placeRegions } from '../layout/place';
import { createSemanticMapScript, SCRIPT_AGENTS, SCRIPT_START } from '../semantic-map-script';
import { buildScene } from './scene';
import { boxesOverlap, layoutSceneLabels } from './labels';

const manifest = manifestJson as Manifest;
const script = createSemanticMapScript();
const labels = new Map(manifest.regions.map(({ id, label }) => [id, label]));

function layout(state: 'route' | 'focus' | 'replay', width: number, height: number) {
  const minute = state === 'replay' ? 14 : 20;
  const end = new Date(Date.parse(SCRIPT_START) + minute * 60_000).toISOString();
  const route: Route | undefined =
    state === 'route' ? script.routes[SCRIPT_AGENTS[0].id] : undefined;
  const budget = computeBudget(manifest, {
    route,
    regionIds: state === 'focus' ? ['renderer-ui'] : undefined,
  });
  const geometry = placeRegions(manifest, budget, { width, height });
  const activities = script.activities.filter(({ ts }) => ts <= end);
  const scene = buildScene({
    activities,
    filters: {},
    timeWindow: { start: SCRIPT_START, end },
    geometry,
    route,
    neutral: '#777',
    fileLabel: (count) => `${count} files`,
  });
  return layoutSceneLabels({
    regions: geometry,
    regionLabels: labels,
    edges: scene.edges,
    badges: scene.badges,
    width,
    height,
  });
}

function expectCollisionFree(result: ReturnType<typeof layout>): void {
  for (let left = 0; left < result.boxes.length; left += 1) {
    for (let right = left + 1; right < result.boxes.length; right += 1) {
      expect(boxesOverlap(result.boxes[left], result.boxes[right])).toBe(false);
    }
  }
  expect(result.regions).toHaveLength(manifest.regions.length);
  expect(result.badges).toHaveLength(SCRIPT_AGENTS.length);
}

describe.each([
  [960, 620],
  [1440, 900],
])('semantic map label collision pass at %ipx', (width, height) => {
  it.each(['route', 'focus', 'replay'] as const)(
    'keeps the %s frame collision-free and stable',
    (state) => {
      const first = layout(state, width, height);
      expectCollisionFree(first);
      expect(layout(state, width, height)).toEqual(first);
      if (state === 'route') {
        expect(first.edges).toHaveLength(script.routes[SCRIPT_AGENTS[0].id].transitions.length);
        expect(first.counts).toHaveLength(script.routes[SCRIPT_AGENTS[0].id].transitions.length);
      }
    },
  );
});
