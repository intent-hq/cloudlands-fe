import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentNode, FileNode, GraphEdge, GraphState, TaskNode } from '../types';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('../../chat/__tests__/mocks/MockAvatarWithState.svelte')).default,
}));

import AgentActivityGraph from '../AgentActivityGraph.svelte';
import GraphEdgeLayer from '../GraphEdgeLayer.svelte';

const timestamp = '2026-09-04T00:00:00.000Z';

function agent(id = 'one', x = 100): AgentNode {
  return {
    id: `agent:${id}`,
    type: 'agent',
    agentId: id,
    name: `Agent ${id === 'one' ? 'One' : id}`,
    isCoordinator: true,
    status: 'idle',
    createdAt: timestamp,
    x,
    y: 100,
    vx: 0,
    vy: 0,
  };
}

function task(id = 'one', x = 300): TaskNode {
  return {
    id: `task:${id}`,
    type: 'task',
    taskId: id,
    title: `Task ${id === 'one' ? 'One' : id}`,
    state: 'in_progress',
    dependsOn: [],
    x,
    y: 100,
    vx: 0,
    vy: 0,
  };
}

function file(index: number): FileNode {
  return {
    id: `file:${index}`,
    type: 'file',
    path: `src/file-${index}.ts`,
    fileName: `file-${index}.ts`,
    lastAction: 'read',
    lastActionTimestamp: new Date(Date.parse(timestamp) + index).toISOString(),
    x: 100 + index * 20,
    y: 250,
    vx: 0,
    vy: 0,
  };
}

function edge(target: FileNode): GraphEdge {
  return {
    id: `edge:${target.id}`,
    type: 'file-read',
    sourceId: 'agent:one',
    targetId: target.id,
    agentId: 'one',
    filePath: target.path,
    timestamp: target.lastActionTimestamp,
    isActive: false,
    count: 1,
  };
}

function graph(nodes: GraphState['nodes'] = [], edges: GraphEdge[] = []): GraphState {
  return {
    nodes,
    edges,
    stats: {
      agents: { active: 0, total: nodes.filter((node) => node.type === 'agent').length },
      tasks: {
        not_started: 0,
        waiting: 0,
        discussion_needed: 0,
        blocked: 0,
        in_progress: 0,
        review_required: 0,
        complete: 0,
        cancelled: 0,
      },
      files: nodes.filter((node) => node.type === 'file').length,
      notes: 0,
    },
    currentTime: timestamp,
    isLive: true,
    minTime: timestamp,
    maxTime: timestamp,
  };
}

function renderGraph(value: GraphState, overrides: Record<string, unknown> = {}) {
  return render(AgentActivityGraph, {
    props: {
      graph: value,
      layers: { files: true, notes: true, messages: true },
      onAgentClick: vi.fn(),
      onTaskClick: vi.fn(),
      onNoteClick: vi.fn(),
      onFileClick: vi.fn(),
      ...overrides,
    },
  });
}

function useViewport(reducedMotion = true): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: reducedMotion && query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList,
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
}

function graphElements(container: HTMLElement): { viewport: HTMLElement; scene: HTMLElement } {
  const viewport = container.querySelector<HTMLElement>('[data-agent-activity-graph]');
  const scene = container.querySelector<HTMLElement>('.graph-scene');
  if (!viewport || !scene) throw new Error('graph viewport did not mount');
  return { viewport, scene };
}

async function waitForFit(scene: HTMLElement): Promise<void> {
  await waitFor(() => expect(scene.style.transform).not.toBe(''));
}

function graphFitTransitionIds(viewport: HTMLElement): string[] {
  const transitions = (
    viewport as HTMLElement & { __transition?: Record<string, { name?: string }> }
  ).__transition;
  return Object.entries(transitions ?? {})
    .filter(([, transition]) => transition.name === 'graph-fit')
    .map(([id]) => id);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentActivityGraph', () => {
  it('renders the empty state when there are no task or agent anchors', () => {
    renderGraph(graph());
    expect(screen.getByText('No agents yet')).toBeTruthy();
  });

  it('dispatches task and agent navigation from accessible node buttons', async () => {
    const onAgentClick = vi.fn();
    const onTaskClick = vi.fn();
    renderGraph(graph([agent(), task()]), { onAgentClick, onTaskClick });

    await fireEvent.click(screen.getByRole('button', { name: /Agent One/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Task One/ }));

    expect(onAgentClick).toHaveBeenCalledWith('one', expect.any(MouseEvent));
    expect(onTaskClick).toHaveBeenCalledWith('one', expect.any(MouseEvent));
  });

  it('caps resources per agent and expands the remainder', async () => {
    const files = Array.from({ length: 7 }, (_, index) => file(index + 1));
    renderGraph(graph([agent(), ...files], files.map(edge)));

    expect(screen.queryByRole('button', { name: /file-1\.ts/ })).toBeNull();
    expect(screen.getByRole('button', { name: /file-7\.ts/ })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    expect(screen.getByRole('button', { name: /file-1\.ts/ })).toBeTruthy();
  });

  it('fits again whenever the visible node set changes', async () => {
    useViewport();
    const view = renderGraph(graph([agent()]));
    const { viewport, scene } = graphElements(view.container);
    await waitForFit(scene);

    await fireEvent.wheel(viewport, { deltaY: 400, clientX: 400, clientY: 300 });
    const manualTransform = scene.style.transform;

    await view.rerender({ graph: graph([agent(), task()]) });
    await waitFor(() => expect(scene.style.transform).not.toBe(manualTransform));
  });

  it('does not fit again for a position-only update with the same node ids', async () => {
    useViewport();
    const view = renderGraph(graph([agent()]));
    const { viewport, scene } = graphElements(view.container);
    await waitForFit(scene);

    await fireEvent.wheel(viewport, { deltaY: 400, clientX: 400, clientY: 300 });
    const manualTransform = scene.style.transform;

    await view.rerender({ graph: graph([agent('one', 700)]) });
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(scene.style.transform).toBe(manualTransform);
  });

  it('keeps a manual zoom until an equal-sized node-id change requests a new fit', async () => {
    useViewport();
    const view = renderGraph(graph([agent()]));
    const { viewport, scene } = graphElements(view.container);
    await waitForFit(scene);

    await fireEvent.wheel(viewport, { deltaY: 400, clientX: 400, clientY: 300 });
    const manualTransform = scene.style.transform;
    expect(manualTransform).not.toBe('');

    await view.rerender({ graph: graph([agent('two', 650)]) });
    await waitFor(() => expect(scene.style.transform).not.toBe(manualTransform));
  });

  it('coalesces rapid node-set fits behind the active normal-motion transition', async () => {
    useViewport(false);
    const view = renderGraph(graph([agent()]));
    const { viewport } = graphElements(view.container);
    await waitFor(() => expect(graphFitTransitionIds(viewport)).toHaveLength(1));
    const [initialTransitionId] = graphFitTransitionIds(viewport);

    await view.rerender({ graph: graph([agent(), task()]) });
    await view.rerender({ graph: graph([agent(), task(), agent('two')]) });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(graphFitTransitionIds(viewport)).toEqual([initialTransitionId]);
  });

  it('completes message particles from native animation events without timers', async () => {
    const message: GraphEdge = {
      id: 'message:one',
      type: 'message',
      sourceId: 'agent:one',
      targetId: 'task:one',
      agentId: 'one',
      timestamp,
      isActive: true,
      count: 1,
    };
    const onMessageArrival = vi.fn();
    const timeout = vi.spyOn(globalThis, ['set', 'Timeout'].join('') as never);

    try {
      const { container } = render(GraphEdgeLayer, {
        props: {
          edges: [message],
          nodes: [agent(), task()],
          positions: new Map([
            ['agent:one', { x: 100, y: 100 }],
            ['task:one', { x: 300, y: 100 }],
          ]),
          onMessageArrival,
        },
      });

      expect(timeout).not.toHaveBeenCalled();
      const motion = container.querySelector('animateMotion');
      expect(motion).toBeTruthy();
      motion?.dispatchEvent(new Event('endEvent'));
      await tick();

      expect(onMessageArrival).toHaveBeenCalledWith('task:one');
      expect(container.querySelector('[data-message-particle]')).toBeNull();
      expect(timeout).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });
});
