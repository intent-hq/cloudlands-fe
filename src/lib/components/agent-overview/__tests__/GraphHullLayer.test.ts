import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GraphHullLayer from '../GraphHullLayer.svelte';
import { deriveTaskHullMemberships } from '../graph-helpers';
import type { AgentNode, GraphEdge, GraphNode, TaskNode } from '../types';

const timestamp = '2026-09-04T00:00:00.000Z';

function agent(id: string, status: AgentNode['status'] = 'idle'): AgentNode {
  return {
    id: `agent:${id}`,
    type: 'agent',
    agentId: id,
    name: `Agent ${id}`,
    isCoordinator: false,
    parentAgentId: 'parent',
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function useMotionPreference(reduced: boolean): void {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
}

describe('GraphHullLayer', () => {
  it('renders one hull per assigned task and none for an unassigned task', () => {
    const nodes = [task('one'), task('unassigned'), agent('one'), agent('two')];
    const { container } = render(GraphHullLayer, {
      props: {
        nodes,
        memberships: deriveTaskHullMemberships(nodes, [
          assignment('one', 'one'),
          assignment('two', 'one'),
        ]),
        positions: positions(nodes),
      },
    });

    const hulls = container.querySelectorAll('.task-hull');
    expect(hulls).toHaveLength(1);
    expect(hulls[0]?.getAttribute('data-task-id')).toBe('task:one');
    expect(container.querySelectorAll('.task-hull-softener')).toHaveLength(1);
    for (const fill of container.querySelectorAll('.task-hull-fill')) {
      expect(fill.getAttribute('fill')).toBe('var(--color-foreground)');
    }
    expect(container.querySelector('.task-hull-softener')?.hasAttribute('stroke')).toBe(false);
    expect(container.querySelector('.task-hull')?.getAttribute('stroke')).toBe('none');
  });

  it('renders an agent in every task group it is assigned to', () => {
    const nodes = [task('one'), task('two'), agent('shared')];
    const { container } = render(GraphHullLayer, {
      props: {
        nodes,
        memberships: deriveTaskHullMemberships(nodes, [
          assignment('shared', 'one'),
          assignment('shared', 'two'),
        ]),
        positions: positions(nodes),
      },
    });

    expect(container.querySelectorAll('.task-hull')).toHaveLength(2);
  });

  it('redraws counter-scaled envelopes and padding when zoom changes', async () => {
    useMotionPreference(true);
    const nodes = [task('one'), agent('one')];
    const memberships = deriveTaskHullMemberships(nodes, [assignment('one', 'one')]);
    const view = render(GraphHullLayer, {
      props: { nodes, memberships, positions: positions(nodes), zoomScale: 1 },
    });
    const pathAtOne = view.container.querySelector('.task-hull')?.getAttribute('d');

    await view.rerender({ nodes, memberships, positions: positions(nodes), zoomScale: 0.5 });
    await tick();

    expect(view.container.querySelector('.task-hull')?.getAttribute('d')).not.toBe(pathAtOne);
  });

  it('hides a group when an assigned member is not visible at the replay cursor', () => {
    const nodes = [task('one'), agent('visible')];
    const { container } = render(GraphHullLayer, {
      props: {
        nodes,
        memberships: deriveTaskHullMemberships(nodes, [
          assignment('visible', 'one'),
          assignment('hidden', 'one'),
        ]),
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
        memberships: deriveTaskHullMemberships(nodes, [
          assignment('one', 'one'),
          assignment('two', 'two'),
        ]),
        positions: positions(nodes),
        focusNodeId: 'task:one',
      },
    });

    expect(
      container.querySelector('[data-task-id="task:one"]')?.getAttribute('data-highlighted'),
    ).toBe('true');
    expect(container.querySelector('[data-task-id="task:one"]')?.getAttribute('stroke-width')).toBe(
      '0.75',
    );
    expect(
      container.querySelector('[data-task-id="task:one"]')?.getAttribute('vector-effect'),
    ).toBe('non-scaling-stroke');
    expect(container.querySelector('[data-task-id="task:two"]')?.getAttribute('data-dimmed')).toBe(
      'true',
    );
  });

  it('keeps both fills mounted together until the shared hull outro completes', async () => {
    useMotionPreference(false);
    vi.useFakeTimers();
    const nodes = [task('one'), agent('one')];
    const view = render(GraphHullLayer, {
      intro: false,
      props: {
        nodes,
        memberships: deriveTaskHullMemberships(nodes, [assignment('one', 'one')]),
        positions: positions(nodes),
      },
    });

    await view.rerender({ nodes, memberships: [], positions: positions(nodes) });
    const hull = view.container.querySelector('[data-task-id="task:one"]');
    expect(hull?.parentElement?.querySelectorAll('path')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(220);
    await tick();
    expect(view.container.querySelector('[data-task-id="task:one"]')).toBeNull();
  });

  it('morphs membership changes to settled geometry without scheduling settled frames', async () => {
    useMotionPreference(false);
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const pendingFrames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const id = nextFrame++;
        pendingFrames.set(id, callback);
        return id;
      });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(
      (id) => void pendingFrames.delete(id),
    );
    const initialNodes = [task('one'), agent('one')];
    const view = render(GraphHullLayer, {
      intro: false,
      props: {
        nodes: initialNodes,
        memberships: deriveTaskHullMemberships(initialNodes, [assignment('one', 'one')]),
        positions: positions(initialNodes),
      },
    });
    await tick();
    expect(requestFrame).not.toHaveBeenCalled();
    const initialPath = view.container
      .querySelector('[data-task-id="task:one"]')
      ?.getAttribute('d');

    const nextNodes = [task('one'), agent('one'), { ...agent('two'), x: 420, y: 180 }];
    await view.rerender({
      nodes: nextNodes,
      memberships: deriveTaskHullMemberships(nextNodes, [
        assignment('one', 'one'),
        assignment('two', 'one'),
      ]),
      positions: positions(nextNodes),
    });
    await tick();
    expect(pendingFrames.size).toBe(1);
    expect(view.container.querySelector('[data-task-id="task:one"]')?.getAttribute('d')).toBe(
      initialPath,
    );

    const callbacks = [...pendingFrames.values()];
    pendingFrames.clear();
    callbacks.forEach((callback) => callback(300));
    const settledPath = view.container
      .querySelector('[data-task-id="task:one"]')
      ?.getAttribute('d');
    expect(settledPath).not.toBe(initialPath);
    expect(pendingFrames.size).toBe(0);
  });

  it('snaps reshape geometry without scheduling frames under reduced motion', async () => {
    useMotionPreference(true);
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');
    const initialNodes = [task('one'), agent('one')];
    const view = render(GraphHullLayer, {
      intro: false,
      props: {
        nodes: initialNodes,
        memberships: deriveTaskHullMemberships(initialNodes, [assignment('one', 'one')]),
        positions: positions(initialNodes),
      },
    });
    await tick();
    const initialPath = view.container
      .querySelector('[data-task-id="task:one"]')
      ?.getAttribute('d');

    const nextNodes = [task('one'), agent('one'), { ...agent('two'), x: 420, y: 180 }];
    await view.rerender({
      nodes: nextNodes,
      memberships: deriveTaskHullMemberships(nextNodes, [
        assignment('one', 'one'),
        assignment('two', 'one'),
      ]),
      positions: positions(nextNodes),
    });
    await tick();

    expect(view.container.querySelector('[data-task-id="task:one"]')?.getAttribute('d')).not.toBe(
      initialPath,
    );
    expect(requestFrame).not.toHaveBeenCalled();
  });
});
