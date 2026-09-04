import { describe, expect, it } from 'vitest';
import {
  buildBusyGraph,
  buildConstellationGraph,
  buildEmptyGraph,
  buildReplayGraph,
  buildSingleAgentGraph,
} from './agent-activity-graph.fixtures';

const now = Date.parse('2026-09-04T02:00:00.000Z');

function countNodes(graph: ReturnType<typeof buildConstellationGraph>, type: string): number {
  return graph.nodes.filter((node) => node.type === type).length;
}

describe('agent activity graph preview fixtures', () => {
  it('builds the named constellation with task, resource, and agent relationship coverage', () => {
    const graph = buildConstellationGraph(now);

    expect(countNodes(graph, 'agent')).toBe(5);
    expect(countNodes(graph, 'task')).toBe(3);
    expect(countNodes(graph, 'file')).toBe(9);
    expect(countNodes(graph, 'note')).toBe(3);
    expect(graph.stats.tasks).toMatchObject({ in_progress: 1, complete: 1, not_started: 1 });
    expect(graph.edges.filter(({ type }) => type === 'message')).toHaveLength(2);
    expect(graph.edges.filter(({ type }) => type === 'waiting-on')).toHaveLength(1);
    expect(
      graph.edges.some(
        (edge) =>
          (edge.type === 'file-write' || edge.type === 'note-write') &&
          (edge.additions ?? 0) > 0 &&
          (edge.deletions ?? 0) > 0,
      ),
    ).toBe(true);
    expect(graph.edges.some(({ timestamp }) => now - Date.parse(timestamp) < 5_000)).toBe(true);
    expect(
      graph.nodes.some(
        (node) => node.type === 'file' && node.path.startsWith('/tmp/') && node.isExternal,
      ),
    ).toBe(true);
  });

  it('builds a busy state with eight agents, six tasks, and twenty-five resources', () => {
    const graph = buildBusyGraph(now);
    const statuses = new Set(
      graph.nodes.filter((node) => node.type === 'agent').map((node) => node.status),
    );

    expect(countNodes(graph, 'agent')).toBe(8);
    expect(countNodes(graph, 'task')).toBe(6);
    expect(countNodes(graph, 'file') + countNodes(graph, 'note')).toBe(25);
    expect(statuses).toEqual(new Set(['responding', 'waiting', 'idle', 'completed', 'failed']));
    expect(graph.edges.filter(({ isActive }) => isActive).length).toBeGreaterThan(5);
  });

  it('builds empty and single-agent edge cases without tasks', () => {
    const empty = buildEmptyGraph(now);
    const single = buildSingleAgentGraph(now);

    expect(empty.nodes).toEqual([]);
    expect(empty.edges).toEqual([]);
    expect(countNodes(single, 'agent')).toBe(1);
    expect(countNodes(single, 'task')).toBe(0);
    expect(countNodes(single, 'file')).toBe(3);
  });

  it('builds a ten-minute replay story that grows between start and finish', () => {
    const start = now - 10 * 60_000;
    const beginning = buildReplayGraph(now, start);
    const middle = buildReplayGraph(now, start + 5 * 60_000);
    const live = buildReplayGraph(now);

    expect(beginning.nodes.filter(({ type }) => type === 'agent')).toHaveLength(1);
    expect(middle.nodes.filter(({ type }) => type === 'agent')).toHaveLength(4);
    expect(middle.nodes.length).toBeLessThan(live.nodes.length);
    expect(live.eventTimes).toHaveLength(16);
    expect(Date.parse(live.maxTime) - Date.parse(live.minTime)).toBe(10 * 60_000);
    expect(
      live.nodes.some(
        (node) => node.type === 'file' && node.path.startsWith('/tmp/') && node.isExternal,
      ),
    ).toBe(true);
  });
});
