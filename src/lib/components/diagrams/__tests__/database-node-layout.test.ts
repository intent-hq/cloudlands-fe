import { describe, expect, it } from 'vitest';

import { computeLayout } from '../layout-engine';

const view = { layout: { type: 'manual' as const } };

function nodeHeight(label: string, kind: string, width: number) {
  return computeLayout(
    { nodes: [{ id: 'node', label, kind }], edges: [] },
    view,
    'architecture',
    undefined,
    width,
  ).nodes[0].height;
}

describe('database node layout', () => {
  for (const width of [320, 960]) {
    it(`keeps one-line and two-line cylinders slightly taller at ${width}px`, () => {
      expect(nodeHeight('Persistent notes', 'db', width)).toBe(90);
      expect(nodeHeight('Persistent\nnotes', 'data_store', width)).toBe(90);
    });
  }

  it('keeps non-database nodes content hugging', () => {
    expect(nodeHeight('Intent daemon', 'service', 960)).toBeLessThan(50);
  });
});
