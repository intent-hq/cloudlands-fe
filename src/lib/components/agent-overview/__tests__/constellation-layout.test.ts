import { describe, expect, it, vi } from 'vitest';
import { GRAPH_NODE_DIMENSIONS, GRAPH_NODE_GAPS } from '../constants';
import { createConstellationLayout } from '../constellation-layout';
import {
  buildBusyGraph,
  buildConstellationGraph,
} from '../__fixtures__/agent-activity-graph.fixtures';
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

function alpha(layout: ReturnType<typeof createConstellationLayout>): number {
  let value = Number.NaN;
  const dispose = layout.tick((_nodes, nextAlpha) => {
    value = nextAlpha;
  });
  dispose();
  return value;
}

function positions(
  layout: ReturnType<typeof createConstellationLayout>,
): [string, number, number][] {
  return snapshot(layout).map((node) => [node.id, node.x, node.y]);
}

function snapshot(layout: ReturnType<typeof createConstellationLayout>): GraphNode[] {
  let nodes: GraphNode[] = [];
  const dispose = layout.tick((nextNodes) => {
    nodes = nextNodes;
  });
  dispose();
  return nodes;
}

function settledSnapshot(layout: ReturnType<typeof createConstellationLayout>): {
  nodes: GraphNode[];
  alpha: number;
} {
  let nodes: GraphNode[] = [];
  let alpha = 1;
  const dispose = layout.tick((nextNodes, nextAlpha) => {
    nodes = nextNodes;
    alpha = nextAlpha;
  });
  layout.settle();
  dispose();
  return { nodes, alpha };
}

function nodeRadius(type: GraphNode['type']): number {
  const { width, height } = GRAPH_NODE_DIMENSIONS[type];
  return Math.hypot(width, height) / 2;
}

function overlaps(a: GraphNode, b: GraphNode): boolean {
  const aSize = GRAPH_NODE_DIMENSIONS[a.type];
  const bSize = GRAPH_NODE_DIMENSIONS[b.type];
  return (
    Math.abs(a.x - b.x) < (aSize.width + bSize.width) / 2 &&
    Math.abs(a.y - b.y) < (aSize.height + bSize.height) / 2
  );
}

describe('constellation layout', () => {
  it('leaves positions, alpha, and tick callbacks untouched for presentation-only updates', () => {
    vi.useFakeTimers();
    const layout = createConstellationLayout({ width: 800, height: 600, seed: 5 });
    const nodes = [agent('coordinator'), task('task-1')];
    layout.update(nodes, []);
    layout.settle();
    const beforePositions = positions(layout);
    const beforeAlpha = alpha(layout);
    const onTick = vi.fn();
    const dispose = layout.tick(onTick);
    onTick.mockClear();

    layout.update(
      [
        {
          ...nodes[0],
          name: 'Streaming coordinator',
          status: 'responding',
          lastResponse: 'Working',
          activeToolName: 'workspace_api',
          activeToolInput: { code: 'return true' },
          waitingForAgentIds: ['agent-2'],
        } as AgentNode,
        {
          ...nodes[1],
          title: 'Renamed task',
          state: 'in_progress',
          lastActionTimestamp: '2026-01-01T00:00:01.000Z',
        } as TaskNode,
      ],
      [],
    );
    vi.advanceTimersByTime(100);
    layout.stop();

    expect(positions(layout)).toEqual(beforePositions);
    expect(alpha(layout)).toBe(beforeAlpha);
    expect(onTick).not.toHaveBeenCalled();
    dispose();
    vi.useRealTimers();
  });

  it('reheats when a node is added', () => {
    const layout = createConstellationLayout({ width: 800, height: 600 });
    const firstTask = task('task-1');
    layout.update([firstTask], []);
    layout.settle();
    const existing = snapshot(layout)[0];

    layout.update([{ ...firstTask, title: 'Fresh title' }, task('task-2')], []);
    layout.stop();

    expect(alpha(layout)).toBe(0.65);
    expect(snapshot(layout)[0]).toBe(existing);
    expect((snapshot(layout)[0] as TaskNode).title).toBe('Fresh title');
  });

  it('reheats when an edge is added', () => {
    const layout = createConstellationLayout({ width: 800, height: 600 });
    const nodes = [agent('agent-1'), task('task-1')];
    layout.update(nodes, []);
    layout.settle();

    layout.update(nodes, [edge('task-assignment', 'agent-1', 'task-1')]);
    layout.stop();

    expect(alpha(layout)).toBe(0.65);
  });

  it('refreshes count-based link strength without reheating', () => {
    const graph = buildConstellationGraph(Date.parse('2026-09-04T00:00:00.000Z'));
    const resourceEdge = graph.edges.find(
      ({ type }) => type.startsWith('file-') || type.startsWith('note-'),
    )!;
    const layout = createConstellationLayout({ width: 800, height: 600 });
    layout.update(graph.nodes, graph.edges);
    layout.settle();
    const beforeAlpha = alpha(layout);
    const beforePositions = positions(layout);
    const onTick = vi.fn();
    const dispose = layout.tick(onTick);
    onTick.mockClear();

    layout.update(
      graph.nodes,
      graph.edges.map((graphEdge) =>
        graphEdge.id === resourceEdge.id ? { ...graphEdge, count: 64 } : graphEdge,
      ),
    );
    layout.stop();

    expect(alpha(layout)).toBe(beforeAlpha);
    expect(alpha(layout)).toBeLessThanOrEqual(0.1);
    expect(positions(layout)).toEqual(beforePositions);
    expect(onTick).not.toHaveBeenCalled();
    dispose();
  });

  it('spawns a newly assigned agent outside its task anchor', () => {
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
    ).toBeGreaterThanOrEqual(nodeRadius('task') + nodeRadius('agent') + GRAPH_NODE_GAPS.taskAgent);
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

  it('places task anchors in source order around a consistently spaced ring', () => {
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
    expect(radius('second')).toBeCloseTo(radius('first'), 5);
  });

  for (const [name, buildGraph] of [
    ['constellation', buildConstellationGraph],
    ['busy', buildBusyGraph],
  ] as const) {
    it(`settles the ${name} fixture without overlaps and keeps related nodes apart`, () => {
      const graph = buildGraph(Date.parse('2026-09-04T00:00:00.000Z'));
      const layout = createConstellationLayout({ width: 1162, height: 766, seed: 7 });
      layout.update(graph.nodes, graph.edges);
      const { nodes, alpha } = settledSnapshot(layout);
      const byId = new Map(nodes.map((node) => [node.id, node]));

      expect(alpha).toBeLessThan(0.01);
      for (let left = 0; left < nodes.length; left += 1) {
        for (let right = left + 1; right < nodes.length; right += 1) {
          expect(
            overlaps(nodes[left], nodes[right]),
            `${nodes[left].id} overlaps ${nodes[right].id}`,
          ).toBe(false);
        }
      }

      for (const edge of graph.edges.filter(({ type }) => type === 'task-assignment')) {
        const agentNode = byId.get(edge.sourceId)!;
        const taskNode = byId.get(edge.targetId)!;
        expect(
          Math.hypot(agentNode.x - taskNode.x, agentNode.y - taskNode.y),
        ).toBeGreaterThanOrEqual(
          nodeRadius('task') + nodeRadius('agent') + GRAPH_NODE_GAPS.taskAgent,
        );
      }
      for (const edge of graph.edges.filter(
        ({ type }) => type.startsWith('file-') || type.startsWith('note-'),
      )) {
        const agentNode = byId.get(edge.sourceId)!;
        const resourceNode = byId.get(edge.targetId)!;
        expect(
          Math.hypot(agentNode.x - resourceNode.x, agentNode.y - resourceNode.y),
        ).toBeGreaterThanOrEqual(
          nodeRadius('agent') + nodeRadius(resourceNode.type) + GRAPH_NODE_GAPS.agentResource,
        );
      }
    });
  }

  it('includes full node rectangles in fit bounds', () => {
    const layout = createConstellationLayout({ width: 800, height: 600 });
    layout.update([agent('coordinator')], []);
    layout.stop();

    expect(layout.fitBounds()).toMatchObject({
      width: GRAPH_NODE_DIMENSIONS.agent.width,
      height: GRAPH_NODE_DIMENSIONS.agent.height,
    });
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
