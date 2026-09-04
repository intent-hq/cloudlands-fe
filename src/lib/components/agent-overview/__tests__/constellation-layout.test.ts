import { describe, expect, it } from 'vitest';
import { createConstellationLayout } from '../constellation-layout';
import type { AgentNode, GraphEdge, GraphNode, TaskNode } from '../types';

function task(id: string, state: TaskNode['state'] = 'not_started'): TaskNode {
  return {
    id,
    type: 'task',
    taskId: id,
    title: id,
    state,
    dependsOn: [],
    lastAction: 'create',
    lastActionTimestamp: '2026-01-01T00:00:00.000Z',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };
}

function agent(id: string, parentAgentId: string | null = null): AgentNode {
  return {
    id,
    type: 'agent',
    agentId: id,
    name: id,
    isCoordinator: parentAgentId === null,
    status: 'idle',
    parentAgentId,
    createdAt: '2026-01-01T00:00:00.000Z',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };
}

function edge(type: string, sourceId: string, targetId: string): GraphEdge {
  return {
    id: `${type}-${sourceId}-${targetId}`,
    type,
    sourceId,
    targetId,
    timestamp: '2026-01-01T00:00:00.000Z',
    isActive: false,
  } as GraphEdge;
}

function snapshot(layout: ReturnType<typeof createConstellationLayout>): GraphNode[] {
  let nodes: GraphNode[] = [];
  const dispose = layout.tick((nextNodes) => {
    nodes = nextNodes;
  });
  dispose();
  return nodes;
}

describe('constellation layout', () => {
  it('spawns a newly assigned agent beside its task anchor', () => {
    const layout = createConstellationLayout({ width: 800, height: 600, seed: 11 });
    layout.update(
      [agent('agent-1', 'coordinator'), task('task-1')],
      [edge('task-assignment', 'agent-1', 'task-1')],
    );
    layout.stop();
    const nodes = snapshot(layout);
    const assignedAgent = nodes.find((node) => node.id === 'agent-1')!;
    const taskPosition = nodes.find((node) => node.id === 'task-1')!;

    expect(
      Math.hypot(assignedAgent.x - taskPosition.x, assignedAgent.y - taskPosition.y),
    ).toBeLessThan(24);
  });

  it('preserves existing node identity, position, and velocity across updates', () => {
    const layout = createConstellationLayout({ width: 800, height: 600, seed: 5 });
    layout.update([task('task-1')], []);
    layout.stop();
    const original = snapshot(layout)[0];
    Object.assign(original, { x: 321, y: 222, vx: 4, vy: -3 });

    layout.update([task('task-1'), task('task-2')], []);
    layout.stop();
    const persisted = snapshot(layout).find((node) => node.id === 'task-1')!;

    expect(persisted).toBe(original);
    expect({ x: persisted.x, y: persisted.y, vx: persisted.vx, vy: persisted.vy }).toEqual({
      x: 321,
      y: 222,
      vx: 4,
      vy: -3,
    });
  });

  it('places task anchors in source order around the ring and pulls active work inward', () => {
    const layout = createConstellationLayout({ width: 800, height: 600, seed: 3 });
    layout.update([task('first'), task('second', 'in_progress'), task('third')], []);
    layout.stop();
    const byId = new Map(snapshot(layout).map((node) => [node.id, node]));
    const center = { x: 400, y: 300 };
    const radius = (id: string) => {
      const node = byId.get(id)!;
      return Math.hypot(node.x - center.x, node.y - center.y);
    };

    expect(byId.get('first')!.y).toBeLessThan(center.y);
    expect(byId.get('second')!.x).toBeGreaterThan(center.x);
    expect(byId.get('third')!.x).toBeLessThan(center.x);
    expect(radius('first')).toBeCloseTo(192, -1);
    expect(radius('third')).toBeCloseTo(192, -1);
    expect(radius('second')).toBeLessThan(radius('first') * 0.75);
  });

  it('pins and releases nodes with d3 fixed coordinates', () => {
    const layout = createConstellationLayout({ width: 800, height: 600 });
    layout.update([agent('coordinator')], []);
    layout.stop();

    layout.pin('coordinator', 120, 140);
    layout.stop();
    const pinned = snapshot(layout)[0];
    expect({ x: pinned.x, y: pinned.y, fx: pinned.fx, fy: pinned.fy }).toEqual({
      x: 120,
      y: 140,
      fx: 120,
      fy: 140,
    });

    layout.unpin('coordinator');
    layout.stop();
    expect({ fx: pinned.fx, fy: pinned.fy }).toEqual({ fx: null, fy: null });
  });
});
