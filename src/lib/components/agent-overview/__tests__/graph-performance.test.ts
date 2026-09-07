import { describe, expect, it } from 'vitest';
import { buildLargeGraph } from '../__fixtures__/agent-activity-graph.fixtures';
import { createGraphRenderIndexMemo } from '../graph-render-index';
import type { GraphEdge } from '../types';

describe('large graph render index', () => {
  it('aggregates edges once across position-only render lookups', () => {
    const graph = buildLargeGraph(Date.parse('2026-09-07T00:00:00.000Z'));
    const memo = createGraphRenderIndexMemo();
    let edgeIterations = 0;
    const edges = new Proxy(graph.edges, {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          edgeIterations += 1;
          return target[Symbol.iterator].bind(target);
        }
        return Reflect.get(target, property, receiver);
      },
    }) as GraphEdge[];

    const first = memo(graph.nodes, edges);
    for (let tick = 0; tick < 240; tick += 1) {
      const current = memo(graph.nodes, edges);
      for (const node of graph.nodes) {
        current.nodeActivityById.get(node.id);
        current.resourceAccessById.get(node.id);
      }
      expect(current).toBe(first);
    }

    expect(graph.nodes.length).toBeGreaterThanOrEqual(100);
    expect(edgeIterations).toBe(1);
    expect(first.nodeActivityById.size).toBe(graph.nodes.length);
    expect(first.resourceAccessById.size).toBe(24);
    expect(first.nodeActivityById.get('task:large-task-1')?.isActive).toBe(true);
  });
});
