import { describe, expect, it, vi } from 'vitest';
import {
  GRAPH_FIT_PADDING,
  GRAPH_NODE_DIMENSIONS,
  GRAPH_NODE_GAPS,
  GRAPH_ZOOM_EXTENT,
} from '../constants';
import {
  createConstellationLayout,
  MIN_COMPACT_NODE_GAP,
  SMALL_GRAPH_FIT_SCALE,
} from '../constellation-layout';
import {
  buildBusyGraph,
  buildConstellationGraph,
  buildLargeGraph,
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

  it('spawns a newly assigned agent outside and 18 degrees off its task axis', () => {
    const layout = createConstellationLayout({ width: 800, height: 600, seed: 11 });
    layout.update(
      [agent('agent-1', 'coordinator'), task('task-1')],
      [edge('task-assignment', 'agent-1', 'task-1')],
    );
    layout.stop();
    const nodes = snapshot(layout);
    const assignedAgent = nodes.find((node) => node.id === 'agent-1')!;
    const taskPosition = nodes.find((node) => node.id === 'task-1')!;
    const hubAngle = Math.atan2(taskPosition.y - 300, taskPosition.x - 400);
    const agentAngle = Math.atan2(
      assignedAgent.y - taskPosition.y,
      assignedAgent.x - taskPosition.x,
    );

    expect(
      Math.hypot(assignedAgent.x - taskPosition.x, assignedAgent.y - taskPosition.y),
    ).toBeGreaterThanOrEqual(nodeRadius('task') + nodeRadius('agent') + GRAPH_NODE_GAPS.taskAgent);
    expect(agentAngle - hubAngle).toBeCloseTo(Math.PI / 10, 8);
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

  it('places task anchors in source order around the panel-shaped ellipse', () => {
    const layout = createConstellationLayout({ width: 800, height: 600, seed: 3 });
    layout.update([task('first'), task('second', 'in_progress'), task('third')], []);
    layout.stop();
    const byId = new Map(snapshot(layout).map((node) => [node.id, node]));
    const center = { x: 400, y: 300 };
    const radiusX = 800 * 0.36;
    const radiusY = Math.max(600 * 0.32, radiusX * 0.7);

    expect(byId.get('first')!.y).toBeLessThan(center.y);
    expect(byId.get('second')!.x).toBeGreaterThan(center.x);
    expect(byId.get('third')!.x).toBeLessThan(center.x);
    expect(byId.get('first')).toMatchObject({ x: center.x, y: center.y - radiusY });
    expect(byId.get('second')!.x).toBeCloseTo(center.x + Math.cos(Math.PI / 6) * radiusX, 8);
    expect(byId.get('second')!.y).toBeCloseTo(center.y + Math.sin(Math.PI / 6) * radiusY, 8);
  });

  it('preserves the single-ring layout through eight tasks', () => {
    const layout = createConstellationLayout({ width: 800, height: 600 });
    const tasks = Array.from({ length: 8 }, (_, index) => task(`task-${index + 1}`));
    layout.update(tasks, []);
    layout.stop();
    const nodes = snapshot(layout);
    const radiusX = 800 * 0.36;
    const radiusY = Math.max(600 * 0.32, radiusX * 0.7);

    nodes.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / tasks.length) * Math.PI * 2;
      expect(node.x).toBeCloseTo(400 + Math.cos(angle) * radiusX, 8);
      expect(node.y).toBeCloseTo(300 + Math.sin(angle) * radiusY, 8);
    });
  });

  it('bounds and separates 66 task anchors', () => {
    const layout = createConstellationLayout({ width: 1280, height: 800 });
    const tasks = Array.from({ length: 66 }, (_, index) => task(`task-${index + 1}`));
    layout.update(tasks, []);
    layout.stop();
    const nodes = snapshot(layout);
    const center = { x: 640, y: 400 };
    const clusterSpacing = nodeRadius('task') * 2 + nodeRadius('agent') + GRAPH_NODE_GAPS.taskAgent;
    const horizontalExtent = Math.max(...nodes.map((node) => Math.abs(node.x - center.x)));
    const verticalExtent = Math.max(...nodes.map((node) => Math.abs(node.y - center.y)));

    expect(horizontalExtent).toBeGreaterThan(verticalExtent);
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        expect(
          Math.hypot(nodes[left].x - nodes[right].x, nodes[left].y - nodes[right].y),
        ).toBeGreaterThanOrEqual(clusterSpacing * 0.9);
      }
    }
  });

  it('keeps existing ring slots stable when one bare task is added', () => {
    const firstLayout = createConstellationLayout({ width: 1280, height: 800 });
    const nextLayout = createConstellationLayout({ width: 1280, height: 800 });
    const tasks = Array.from({ length: 66 }, (_, index) => task(`task-${index + 1}`));
    firstLayout.update(tasks, []);
    nextLayout.update([...tasks, task('task-67')], []);
    firstLayout.stop();
    nextLayout.stop();
    const nextById = new Map(snapshot(nextLayout).map((node) => [node.id, node]));

    for (const node of snapshot(firstLayout)) {
      expect(nextById.get(node.id)?.x).toBeCloseTo(node.x, 8);
      expect(nextById.get(node.id)?.y).toBeCloseTo(node.y, 8);
    }
  });

  it('fits the populated 66-task fixture at or above the minimum zoom', () => {
    const graph = buildLargeGraph(Date.parse('2026-09-04T00:00:00.000Z'));
    const layout = createConstellationLayout({ width: 1280, height: 800, seed: 7 });
    layout.update(graph.nodes, graph.edges);
    layout.settle();
    const bounds = layout.fitBounds();
    const scale = Math.min(
      1280 / (bounds.width + GRAPH_FIT_PADDING * 2),
      800 / (bounds.height + GRAPH_FIT_PADDING * 2),
    );

    expect(scale).toBeGreaterThanOrEqual(GRAPH_ZOOM_EXTENT[0]);
  });

  for (const [name, buildGraph] of [
    ['constellation', buildConstellationGraph],
    ['busy', buildBusyGraph],
    ['large', buildLargeGraph],
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

    expect(layout.fitBounds(SMALL_GRAPH_FIT_SCALE).width).toBeCloseTo(128 / SMALL_GRAPH_FIT_SCALE);
    expect(layout.fitBounds(SMALL_GRAPH_FIT_SCALE).height).toBeCloseTo(84 / SMALL_GRAPH_FIT_SCALE);
  });

  for (const [name, buildGraph] of [
    ['constellation', buildConstellationGraph],
    ['busy', buildBusyGraph],
  ] as const) {
    it(`compacts the ${name} fixture into the 1092x720 fit target at 0.7`, () => {
      const graph = buildGraph(Date.parse('2026-09-04T00:00:00.000Z'));
      const available = { width: 1092 - 24 - 24, height: 720 - 56 - 72 };
      const fitTarget = {
        width: (available.width - GRAPH_FIT_PADDING * 2) / SMALL_GRAPH_FIT_SCALE,
        height: (available.height - GRAPH_FIT_PADDING * 2) / SMALL_GRAPH_FIT_SCALE,
      };
      const layout = createConstellationLayout({
        width: 1092,
        height: 720,
        fitTarget,
        seed: 7,
      });
      layout.update(graph.nodes, graph.edges);
      layout.settle();
      const bounds = layout.fitBounds(SMALL_GRAPH_FIT_SCALE);
      const { nodes } = settledSnapshot(layout);

      expect(bounds.width).toBeLessThanOrEqual(fitTarget.width);
      expect(bounds.height).toBeLessThanOrEqual(fitTarget.height);
      expect(bounds.width * SMALL_GRAPH_FIT_SCALE + GRAPH_FIT_PADDING * 2).toBeGreaterThanOrEqual(
        available.width * 0.6,
      );
      expect(bounds.height * SMALL_GRAPH_FIT_SCALE + GRAPH_FIT_PADDING * 2).toBeGreaterThanOrEqual(
        available.height * 0.6,
      );
      const labelEnvelope = {
        agent: { width: 128 / SMALL_GRAPH_FIT_SCALE, height: 30 / SMALL_GRAPH_FIT_SCALE, y: 20 },
        task: { width: 176, height: 56, y: 4 },
        file: { width: 112 / SMALL_GRAPH_FIT_SCALE, height: 30 / SMALL_GRAPH_FIT_SCALE, y: 31 },
        note: { width: 112 / SMALL_GRAPH_FIT_SCALE, height: 30 / SMALL_GRAPH_FIT_SCALE, y: 31 },
      };
      for (let left = 0; left < nodes.length; left += 1) {
        for (let right = left + 1; right < nodes.length; right += 1) {
          const leftSize = labelEnvelope[nodes[left].type];
          const rightSize = labelEnvelope[nodes[right].type];
          const separatedX =
            Math.abs(nodes[left].x - nodes[right].x) * SMALL_GRAPH_FIT_SCALE >=
            ((leftSize.width + rightSize.width) / 2) * SMALL_GRAPH_FIT_SCALE + MIN_COMPACT_NODE_GAP;
          const separatedY =
            Math.abs(nodes[left].y + leftSize.y - nodes[right].y - rightSize.y) *
              SMALL_GRAPH_FIT_SCALE >=
            ((leftSize.height + rightSize.height) / 2) * SMALL_GRAPH_FIT_SCALE +
              MIN_COMPACT_NODE_GAP;
          expect(separatedX || separatedY, `${nodes[left].id} overlaps ${nodes[right].id}`).toBe(
            true,
          );
        }
      }
      layout.stop();
    });
  }

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
