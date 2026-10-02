import { expect, it } from 'vitest';
import type { ComputedLayout } from '../types';
import { equalComputedLayout } from '../equal-computed-layout';

function layout(): ComputedLayout {
  return {
    nodes: [{ id: 'a', label: 'Input', x: 0, y: 0, width: 100, height: 40 }],
    edges: [
      {
        id: 'ab',
        from: 'a',
        to: 'b',
        path: 'M0 0L100 0',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
    ],
    groups: [{ id: 'all', label: 'All', nodeIds: ['a'], x: 0, y: 0, width: 120, height: 60 }],
    bounds: { minX: 0, minY: 0, maxX: 120, maxY: 60, width: 120, height: 60 },
  };
}

it('recognizes newly allocated but equal geometry without requiring object identity', () => {
  expect(equalComputedLayout(layout(), layout())).toBe(true);
  expect(equalComputedLayout(null, layout())).toBe(false);
});

it.each([
  [
    'node identity',
    (x: ComputedLayout) => {
      x.nodes[0].id = 'replacement';
    },
  ],
  [
    'node label',
    (x: ComputedLayout) => {
      x.nodes[0].label = 'Changed';
    },
  ],
  [
    'node width',
    (x: ComputedLayout) => {
      x.nodes[0].width = 200;
    },
  ],
  [
    'node style',
    (x: ComputedLayout) => {
      x.nodes[0].semanticStyle = 'warning';
    },
  ],
  [
    'binding',
    (x: ComputedLayout) => {
      x.nodes[0].binding = { type: 'file', target: 'new.ts' };
    },
  ],
  [
    'edge path',
    (x: ComputedLayout) => {
      x.edges[0].path = 'M0 0L200 0';
    },
  ],
  [
    'edge point',
    (x: ComputedLayout) => {
      x.edges[0].points![1].x = 200;
    },
  ],
  [
    'edge animation',
    (x: ComputedLayout) => {
      x.edges[0].animated = true;
    },
  ],
  [
    'group members',
    (x: ComputedLayout) => {
      x.groups![0].nodeIds = ['b'];
    },
  ],
  [
    'group label',
    (x: ComputedLayout) => {
      x.groups![0].label = 'Changed';
    },
  ],
  [
    'bounds',
    (x: ComputedLayout) => {
      x.bounds.maxY = 80;
    },
  ],
  [
    'removed nodes',
    (x: ComputedLayout) => {
      x.nodes = [];
    },
  ],
  [
    'removed groups',
    (x: ComputedLayout) => {
      delete x.groups;
    },
  ],
] as const)('publishes changed %s', (_, change) => {
  const previous = layout();
  const next = layout();
  change(next);
  expect(equalComputedLayout(previous, next)).toBe(false);
});

it('does not serialize or conflate arbitrary model metadata', () => {
  const metadata: Record<string, unknown> = { value: 1n, callback: () => undefined };
  metadata.self = metadata;
  const previous = layout();
  const next = layout();
  previous.nodes[0].metadata = metadata;
  next.nodes[0].metadata = metadata;
  expect(equalComputedLayout(previous, next)).toBe(false);
  next.nodes[0].metadata = { ...metadata };
  expect(equalComputedLayout(previous, next)).toBe(false);
});

it('compares additional fields conservatively and distinguishes NaN from null', () => {
  const previous = layout();
  const next = layout();
  Object.assign(previous.nodes[0], { extra: NaN });
  Object.assign(next.nodes[0], { extra: null });
  expect(equalComputedLayout(previous, next)).toBe(false);
  Reflect.set(next.nodes[0], 'extra', NaN);
  expect(equalComputedLayout(previous, next)).toBe(true);
});

it('compares freshly measured node sizes including authored size changes', () => {
  const previous = layout();
  const next = layout();
  previous.nodes[0].size = { width: 100, height: 40 };
  next.nodes[0].size = { width: 100, height: 40 };
  expect(equalComputedLayout(previous, next)).toBe(true);
  next.nodes[0].size.height = 50;
  expect(equalComputedLayout(previous, next)).toBe(false);
  delete next.nodes[0].size;
  expect(equalComputedLayout(previous, next)).toBe(false);
});

it.each(['binding', 'metadata', 'futureField'])(
  'publishes shared mutable %s values conservatively',
  (key) => {
    const previous = layout();
    const next = layout();
    const value = { target: 'old.ts' };
    Reflect.set(previous.nodes[0], key, value);
    Reflect.set(next.nodes[0], key, value);
    value.target = 'new.ts';
    expect(equalComputedLayout(previous, next)).toBe(false);
  },
);
