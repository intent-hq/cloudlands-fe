import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import GraphHullLayer from '../GraphHullLayer.svelte';
import type { AgentNode, GraphEdge, GraphNode, TaskNode } from '../types';

const timestamp = '2026-09-04T00:00:00.000Z';

function agent(id: string, status: AgentNode['status'] = 'idle'): AgentNode {
  return {
    id: `agent:${id}`,
    type: 'agent',
    agentId: id,
    name: `Agent ${id}`,
    isCoordinator: false,
    status,
    createdAt: timestamp,
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
  };
}

function task(id: string): TaskNode {
  return {
    id: `task:${id}`,
    type: 'task',
    taskId: id,
    title: `Task ${id}`,
    state: 'in_progress',
    dependsOn: [],
    x: 260,
    y: 100,
    vx: 0,
    vy: 0,
  };
}

function assignment(agentId: string, taskId: string): GraphEdge {
  return {
    id: `assignment:${agentId}:${taskId}`,
    type: 'task-assignment',
    sourceId: `agent:${agentId}`,
    targetId: `task:${taskId}`,
    agentId,
    taskId,
    timestamp,
    isActive: false,
  };
}

function positions(nodes: GraphNode[]): Map<string, { x: number; y: number }> {
  return new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
}

afterEach(cleanup);

describe('GraphHullLayer', () => {
  it('renders one hull per assigned task and none for an unassigned task', () => {
    const nodes = [task('one'), task('unassigned'), agent('one'), agent('two')];
    const { container } = render(GraphHullLayer, {
      props: {
        nodes,
        edges: [assignment('one', 'one'), assignment('two', 'one')],
        positions: positions(nodes),
      },
    });

    const hulls = container.querySelectorAll('.task-hull');
    expect(hulls).toHaveLength(1);
    expect(hulls[0]?.getAttribute('data-task-id')).toBe('task:one');
    expect(container.querySelectorAll('.task-hull-softener')).toHaveLength(1);
    for (const fill of container.querySelectorAll('.task-hull-fill')) {
      expect(fill.getAttribute('fill')).toBe('var(--color-foreground)');
      expect(fill.hasAttribute('stroke')).toBe(false);
    }
  });

  it('renders an agent in every task group it is assigned to', () => {
    const nodes = [task('one'), task('two'), agent('shared')];
    const { container } = render(GraphHullLayer, {
      props: {
        nodes,
        edges: [assignment('shared', 'one'), assignment('shared', 'two')],
        positions: positions(nodes),
      },
    });

    expect(container.querySelectorAll('.task-hull')).toHaveLength(2);
  });

  it('hides a group when an assigned member is not visible at the replay cursor', () => {
    const nodes = [task('one'), agent('visible')];
    const { container } = render(GraphHullLayer, {
      props: {
        nodes,
        edges: [assignment('visible', 'one'), assignment('hidden', 'one')],
        positions: positions(nodes),
      },
    });

    expect(container.querySelector('.task-hull')).toBeNull();
  });

  it('highlights containing groups and marks unrelated groups dimmed', () => {
    const nodes = [task('one'), task('two'), agent('one', 'responding'), agent('two')];
    const { container } = render(GraphHullLayer, {
      props: {
        nodes,
        edges: [assignment('one', 'one'), assignment('two', 'two')],
        positions: positions(nodes),
        focusNodeId: 'task:one',
      },
    });

    expect(
      container.querySelector('[data-task-id="task:one"]')?.getAttribute('data-highlighted'),
    ).toBe('true');
    expect(container.querySelector('[data-task-id="task:two"]')?.getAttribute('data-dimmed')).toBe(
      'true',
    );
  });
});
