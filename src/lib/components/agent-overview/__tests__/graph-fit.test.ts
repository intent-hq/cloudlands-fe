import { describe, expect, it } from 'vitest';
import { GRAPH_FIT_PADDING } from '../constants';
import { anchorFitBounds, containedFitScale } from '../graph-fit';
import type { AgentNode } from '../types';

describe('graph fit', () => {
  it('contains fixed scene bounds with constant screen padding', () => {
    const bounds = { width: 1_500, height: 900 };
    const available = { width: 1_000, height: 600 };
    const scale = containedFitScale(bounds, available.width, available.height, 2.5);

    expect(scale).toBeLessThan(0.7);
    expect(bounds.width * scale + GRAPH_FIT_PADDING * 2).toBeLessThanOrEqual(available.width);
    expect(bounds.height * scale + GRAPH_FIT_PADDING * 2).toBeLessThanOrEqual(available.height);
  });

  it('derives bounds from anchors instead of stale node coordinates or current zoom', () => {
    const node = {
      id: 'agent:one',
      type: 'agent',
      agentId: 'one',
      name: 'Agent One',
      isCoordinator: true,
      status: 'idle',
      createdAt: '2026-01-01T00:00:00.000Z',
      x: -9_000,
      y: -9_000,
      vx: 0,
      vy: 0,
    } satisfies AgentNode;
    const anchors = new Map([[node.id, { x: 320, y: 240 }]]);

    const beforeZoom = anchorFitBounds([node], anchors, 0.7);
    const afterZoom = anchorFitBounds([{ ...node, x: 12_000, y: 12_000 }], anchors, 0.7);

    expect(afterZoom).toEqual(beforeZoom);
    expect(beforeZoom.width * 0.7).toBeCloseTo(128);
  });
});
