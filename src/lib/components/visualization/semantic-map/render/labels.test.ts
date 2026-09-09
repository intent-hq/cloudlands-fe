import { describe, expect, it } from 'vitest';
import manifestJson from '../fixtures/intent-manifest.json';
import type { Manifest, Route } from '../core/types';
import { computeBudget } from '../layout/budget';
import { placeRegions } from '../layout/place';
import { createSemanticMapScript, SCRIPT_AGENTS, SCRIPT_START } from '../semantic-map-script';
import { buildScene } from './scene';
import { boxesOverlap, labelEmphasis, layoutSceneLabels } from './labels';

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
    dark: false,
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
    heatByRegion: scene.heatByRegion,
  });
}

function expectCollisionFree(result: ReturnType<typeof layout>): void {
  for (let left = 0; left < result.boxes.length; left += 1) {
    for (let right = left + 1; right < result.boxes.length; right += 1) {
      expect(boxesOverlap(result.boxes[left], result.boxes[right])).toBe(false);
    }
  }
  expect(result.badges).toHaveLength(SCRIPT_AGENTS.length);
}

function hullContainsPoint(hull: [number, number][], x: number, y: number): boolean {
  let contained = false;
  for (let index = 0, previous = hull.length - 1; index < hull.length; previous = index++) {
    const [currentX, currentY] = hull[index];
    const [previousX, previousY] = hull[previous];
    if (
      currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX
    )
      contained = !contained;
  }
  return contained;
}

describe.each([
  [420, 620],
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
        const transitionCount = script.routes[SCRIPT_AGENTS[0].id].transitions.length;
        expect(first.edges.length).toBeLessThanOrEqual(transitionCount);
        expect(first.pips.map(({ text }) => text)).toEqual(
          Array.from({ length: transitionCount }, (_, index) => String(index + 1)),
        );
        if (width >= 640) {
          expect(first.edges).toHaveLength(transitionCount);
        }
      }
    },
  );
});

it('keeps every focus label collision-free at 320px', () => {
  expectCollisionFree(layout('focus', 320, 620));
});

it('places every badge before narrow viewport labels and never overlaps badges', () => {
  const result = layout('replay', 320, 620);
  expect(result.badges).toHaveLength(SCRIPT_AGENTS.length);
  expect(result.boxes.slice(0, result.badges.length).every(({ kind }) => kind === 'badge')).toBe(
    true,
  );
  for (let left = 0; left < result.badges.length; left += 1) {
    for (let right = left + 1; right < result.badges.length; right += 1) {
      expect(boxesOverlap(result.badges[left].box, result.badges[right].box)).toBe(false);
    }
  }
  expect(result.regions.length).toBeLessThanOrEqual(3);
});

it('contains every 420px label within its own hull', () => {
  const result = layout('replay', 420, 620);
  const geometry = placeRegions(manifest, computeBudget(manifest), { width: 420, height: 620 });
  const byId = new Map(geometry.map((region) => [region.id, region]));
  for (const label of result.regions) {
    const hull = byId.get(label.id)!.hull;
    const lines = label.lines ?? [label.text];
    for (const [index, line] of lines.entries()) {
      const halfWidth = Math.max(label.fontSize, line.length * label.fontSize * 0.56) / 2;
      const halfHeight = label.fontSize / 2;
      const y = label.y + (index - (lines.length - 1) / 2) * (label.fontSize + 3);
      expect(
        [
          [label.x - halfWidth, y - halfHeight],
          [label.x + halfWidth, y - halfHeight],
          [label.x + halfWidth, y + halfHeight],
          [label.x - halfWidth, y + halfHeight],
        ].every(([x, pointY]) => hullContainsPoint(hull, x, pointY)),
      ).toBe(true);
    }
  }
});

it('places every label when the split wide layout has room for them', () => {
  expect(new Set(layout('replay', 620, 620).regions.map(({ id }) => id))).toEqual(
    new Set(manifest.regions.map(({ id }) => id)),
  );
});

it('keeps non-focused region labels above the theme-independent readable opacity floor', () => {
  const result = layout('focus', 1440, 900);
  const selected = result.regions.find(({ id }) => id === 'renderer-ui')!;
  const context = result.regions.filter(({ id }) => id !== selected.id);

  expect(selected.opacity).toBe(1);
  expect(context.every(({ opacity }) => opacity >= 0.82)).toBe(true);
  expect(context.some(({ opacity }) => opacity < selected.opacity)).toBe(true);
});

it('bounds label emphasis while preserving the context floor', () => {
  const focusState = { maximumBudget: 0.7 };
  expect(labelEmphasis({ budget: 0.7 }, focusState)).toBe(1);
  expect(labelEmphasis({ budget: 0.02 }, focusState)).toBe(0.82);
  expect(labelEmphasis({ budget: -1 }, focusState)).toBe(0.82);
  expect(labelEmphasis({ budget: 2 }, focusState)).toBe(1);
});
