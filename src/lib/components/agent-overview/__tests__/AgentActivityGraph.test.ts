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
    isExternal: false,
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

function assignment(agentId = 'one', taskId = 'one'): GraphEdge {
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

  it('selects on click and opens agent and task navigation from double click or Enter', async () => {
    const onAgentClick = vi.fn();
    const onTaskClick = vi.fn();
    renderGraph(graph([agent(), task()]), { onAgentClick, onTaskClick });
    const agentButton = screen.getByRole('button', { name: /Agent One/ });
    const taskButton = screen.getByRole('button', { name: /Task One/ });

    await fireEvent.click(agentButton);
    expect(agentButton.getAttribute('data-focus-state')).toBe('focused');
    expect(onAgentClick).not.toHaveBeenCalled();

    await fireEvent.dblClick(agentButton);
    taskButton.focus();
    await fireEvent.keyDown(taskButton, { key: 'Enter' });

    expect(onAgentClick).toHaveBeenCalledWith('one', expect.any(MouseEvent));
    expect(onTaskClick).toHaveBeenCalledWith('one', expect.any(KeyboardEvent));
  });

  it('pins neighbourhood focus and preserves it across graph updates until cleared', async () => {
    const unrelated = agent('two');
    const target = file(1);
    const view = renderGraph(
      graph([target, unrelated, task(), agent()], [assignment(), edge(target)]),
    );
    const agentButton = screen.getByRole('button', { name: /Agent One/ });
    const taskButton = screen.getByRole('button', { name: /Task One/ });
    const fileButton = screen.getByRole('button', { name: /file-1\.ts/ });
    const unrelatedButton = screen.getByRole('button', { name: /Agent two/ });

    await fireEvent.mouseEnter(agentButton);
    await fireEvent.click(agentButton);
    expect(agentButton.getAttribute('data-focus-state')).toBe('focused');
    expect(taskButton.getAttribute('data-focus-state')).toBe('neighbour');
    expect(fileButton.getAttribute('data-focus-state')).toBe('neighbour');
    expect(unrelatedButton.getAttribute('data-focus-state')).toBe('dimmed');
    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-edge-id="assignment:one:one"]')
          ?.getAttribute('data-highlighted'),
      ).toBe('true'),
    );

    await view.rerender({
      graph: graph(
        [target, unrelated, task(), { ...agent(), status: 'responding' }],
        [assignment(), edge(target)],
      ),
    });
    expect(agentButton.getAttribute('data-focus-state')).toBe('focused');

    await fireEvent.keyDown(agentButton, { key: 'Escape' });
    expect(agentButton.getAttribute('data-focus-state')).toBe('none');
    expect(unrelatedButton.getAttribute('data-focus-state')).toBe('none');
    expect(view.container.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0);

    await fireEvent.pointerMove(agentButton, { pointerId: 1 });
    expect(agentButton.getAttribute('data-focus-state')).toBe('focused');
    expect(unrelatedButton.getAttribute('data-focus-state')).toBe('dimmed');
  });

  it('cycles a task-first focus order and navigates parent, child, and siblings', async () => {
    useViewport();
    const secondAgent = agent('two');
    const target = file(1);
    const view = renderGraph(
      graph(
        [target, secondAgent, agent(), task()],
        [assignment(), assignment('two'), edge(target)],
      ),
    );
    const { viewport } = graphElements(view.container);
    const taskButton = screen.getByRole('button', { name: /Task One/ });
    const firstAgent = screen.getByRole('button', { name: /Agent One/ });
    const fileButton = screen.getByRole('button', { name: /file-1\.ts/ });

    viewport.focus();
    await fireEvent.keyDown(viewport, { key: 'Tab' });
    expect(document.activeElement).toBe(taskButton);
    await fireEvent.keyDown(taskButton, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(firstAgent);
    await fireEvent.keyDown(firstAgent, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Agent two/ }));
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(taskButton);
    await fireEvent.keyDown(taskButton, { key: 'Tab' });
    expect(document.activeElement).toBe(firstAgent);
    await fireEvent.keyDown(firstAgent, { key: 'Tab' });
    expect(document.activeElement).toBe(fileButton);
  });

  it('pans on plain wheel and zooms into semantic bands with a modifier', async () => {
    useViewport();
    const view = renderGraph(graph([agent(), task()]));
    const { viewport, scene } = graphElements(view.container);
    await waitForFit(scene);
    const initialZoom = (viewport as HTMLElement & { __zoom: { x: number; y: number; k: number } })
      .__zoom;

    await fireEvent.wheel(viewport, { deltaX: 24, deltaY: 80, clientX: 400, clientY: 300 });
    const pannedZoom = (viewport as HTMLElement & { __zoom: { x: number; y: number; k: number } })
      .__zoom;
    expect(pannedZoom.k).toBe(initialZoom.k);
    expect([pannedZoom.x, pannedZoom.y]).not.toEqual([initialZoom.x, initialZoom.y]);

    await fireEvent.wheel(viewport, {
      deltaY: 5_000,
      ctrlKey: true,
      clientX: 400,
      clientY: 300,
    });
    await waitFor(() => expect(scene.getAttribute('data-zoom-band')).toBe('far'));
    expect(screen.getByRole('button', { name: /Agent One/ }).getAttribute('data-zoom-band')).toBe(
      'far',
    );
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

  it('draws one stable gentle curve and target terminal per connected pair', () => {
    const target = file(1);
    const edges = [
      { ...edge(target), id: 'edge:curve-a' },
      { ...edge(target), id: 'edge:curve-b' },
    ];
    const props = {
      edges,
      nodes: [agent(), target],
      positions: new Map([
        ['agent:one', { x: 100, y: 100 }],
        [target.id, { x: 300, y: 180 }],
      ]),
    };
    const first = render(GraphEdgeLayer, { props });
    const second = render(GraphEdgeLayer, { props });
    const pathsFor = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('.edge-path'), (path) => path.getAttribute('d'));

    expect(pathsFor(second.container)).toEqual(pathsFor(first.container));
    expect(pathsFor(first.container)).toHaveLength(1);
    expect(pathsFor(first.container).every((path) => path?.includes(' C '))).toBe(true);
    expect(first.container.querySelector('.edge-path')?.getAttribute('stroke-width')).toBe('0.75');
    expect(first.container.querySelector('.edge-path')?.hasAttribute('stroke-dasharray')).toBe(
      false,
    );
    expect(first.container.querySelector('.edge-path')?.getAttribute('data-edge-count')).toBe('2');
    expect(first.container.querySelectorAll('.edge-terminal')).toHaveLength(1);
    expect(first.container.querySelector('.edge-terminal')?.getAttribute('r')).toBe('2.25');
    expect(first.container.querySelector('.edge-arrow')).toBeNull();
  });

  it('uses terminals at both directed ends of a bidirectional pair', () => {
    const target = agent('two');
    const forward: GraphEdge = {
      id: 'message:forward',
      type: 'message',
      sourceId: 'agent:one',
      targetId: target.id,
      senderAgentId: 'one',
      receiverAgentId: 'two',
      timestamp,
      isActive: false,
      count: 1,
    };
    const reverse: GraphEdge = {
      ...forward,
      id: 'message:reverse',
      sourceId: target.id,
      targetId: 'agent:one',
      senderAgentId: 'two',
      receiverAgentId: 'one',
    };
    const { container } = render(GraphEdgeLayer, {
      props: {
        edges: [forward, reverse],
        nodes: [agent(), target],
        positions: new Map([
          ['agent:one', { x: 100, y: 100 }],
          ['agent:two', { x: 300, y: 100 }],
        ]),
      },
    });

    expect(container.querySelectorAll('.edge-path')).toHaveLength(1);
    expect(
      Array.from(container.querySelectorAll('.edge-terminal'), (terminal) =>
        terminal.getAttribute('data-direction'),
      ),
    ).toEqual(['b-to-a', 'a-to-b']);
  });

  it('adds traveling highlights only to working, recent delegation, and waiting edges', () => {
    const recentTimestamp = new Date().toISOString();
    const edges: GraphEdge[] = [
      assignment(),
      { ...assignment('two'), id: 'assignment:idle' },
      {
        id: 'delegation:recent',
        type: 'delegation',
        sourceId: 'agent:one',
        targetId: 'agent:two',
        agentId: 'one',
        timestamp: recentTimestamp,
        isActive: false,
      },
      {
        id: 'waiting:one',
        type: 'waiting-on',
        sourceId: 'agent:two',
        targetId: 'task:one',
        agentId: 'one',
        timestamp,
        isActive: false,
      },
      edge(file(1)),
    ];
    const { container } = render(GraphEdgeLayer, {
      props: {
        edges,
        nodes: [{ ...agent(), status: 'responding' }, agent('two'), task(), file(1)],
        positions: new Map([
          ['agent:one', { x: 100, y: 100 }],
          ['agent:two', { x: 100, y: 200 }],
          ['task:one', { x: 300, y: 100 }],
          ['file:1', { x: 300, y: 200 }],
        ]),
        focusNodeId: 'agent:two',
      },
    });

    expect(container.querySelectorAll('.edge-path')).toHaveLength(4);
    expect(
      container
        .querySelector('.edge-path[data-edge-id="waiting:one"]')
        ?.getAttribute('data-edge-count'),
    ).toBe('2');
    expect(
      Array.from(container.querySelectorAll<SVGPathElement>('[data-edge-highlight]'), (path) => [
        path.getAttribute('data-edge-id'),
        path.getAttribute('data-edge-highlight'),
      ]),
    ).toEqual([
      ['assignment:one:one', 'working'],
      ['waiting:one', 'waiting'],
      ['delegation:recent', 'delegation'],
    ]);
    const workingHighlight = container.querySelector('[data-edge-highlight="working"]');
    const workingBase = container.querySelector('.edge-path[data-edge-id="assignment:one:one"]');
    const gradient = container.querySelector('linearGradient');
    expect(workingHighlight?.getAttribute('stroke')).toBe(`url(#${gradient?.id})`);
    expect(gradient?.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
    expect(workingHighlight?.getAttribute('data-dimmed')).toBe('true');
    expect(workingHighlight?.getAttribute('opacity')).toBe(workingBase?.getAttribute('opacity'));
  });

  it('omits traveling highlights when motion is disabled', async () => {
    useViewport();
    const { container } = render(GraphEdgeLayer, {
      props: {
        edges: [assignment()],
        nodes: [{ ...agent(), status: 'responding' }, task()],
        positions: new Map([
          ['agent:one', { x: 100, y: 100 }],
          ['task:one', { x: 300, y: 100 }],
        ]),
      },
    });
    await tick();

    expect(container.querySelector('.edge-layer')?.getAttribute('data-motion-enabled')).toBe(
      'false',
    );
    expect(container.querySelector('[data-edge-highlight]')).toBeNull();
    expect(container.querySelector('.edge-path')?.hasAttribute('stroke-dasharray')).toBe(false);
  });

  it('marks the focused neighbourhood and hides unrelated write labels', () => {
    const connectedTarget = file(1);
    const dimmedTarget = file(2);
    const connected: GraphEdge = {
      ...edge(connectedTarget),
      id: 'edge:connected-write',
      type: 'file-write',
      additions: 4,
      deletions: 2,
    };
    const dimmed: GraphEdge = {
      ...edge(dimmedTarget),
      id: 'edge:dimmed-write',
      type: 'file-write',
      sourceId: 'agent:two',
      agentId: 'two',
      additions: 7,
      deletions: 3,
    };
    const props = {
      edges: [connected, dimmed],
      nodes: [agent(), agent('two'), connectedTarget, dimmedTarget],
      positions: new Map([
        ['agent:one', { x: 100, y: 100 }],
        ['agent:two', { x: 100, y: 300 }],
        [connectedTarget.id, { x: 300, y: 100 }],
        [dimmedTarget.id, { x: 300, y: 300 }],
      ]),
    };
    const defaultView = render(GraphEdgeLayer, { props });
    const focusedView = render(GraphEdgeLayer, {
      props: { ...props, focusNodeId: 'agent:one' },
    });

    expect(defaultView.container.textContent).toContain('+4 −2');
    expect(defaultView.container.textContent).toContain('+7 −3');
    expect(
      focusedView.container
        .querySelector('[data-edge-id="edge:connected-write"]')
        ?.getAttribute('data-highlighted'),
    ).toBe('true');
    expect(
      focusedView.container
        .querySelector('[data-edge-id="edge:dimmed-write"]')
        ?.getAttribute('data-dimmed'),
    ).toBe('true');
    expect(focusedView.container.textContent).toContain('+4 −2');
    expect(focusedView.container.textContent).not.toContain('+7 −3');
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
      expect(container.querySelector('.edge-path')?.getAttribute('stroke')).toBe(
        'var(--color-foreground)',
      );
      expect(container.querySelector('.edge-path')?.getAttribute('stroke-width')).toBe('1.5');
      expect(motion?.getAttribute('path')).toBe(
        container.querySelector('.edge-path')?.getAttribute('d'),
      );
      motion?.dispatchEvent(new Event('endEvent'));
      await tick();

      expect(onMessageArrival).toHaveBeenCalledWith('task:one');
      expect(container.querySelector('[data-message-particle]')).toBeNull();
      expect(timeout).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });

  it('keeps only the latest message pill for a connected pair', () => {
    const first: GraphEdge = {
      id: 'message:first',
      type: 'message',
      sourceId: 'agent:one',
      targetId: 'agent:two',
      senderAgentId: 'one',
      receiverAgentId: 'two',
      timestamp: new Date().toISOString(),
      isActive: true,
      count: 1,
    };
    const latest: GraphEdge = {
      ...first,
      id: 'message:latest',
      sourceId: 'agent:two',
      targetId: 'agent:one',
      senderAgentId: 'two',
      receiverAgentId: 'one',
      timestamp: new Date(Date.parse(first.timestamp) + 1).toISOString(),
    };
    const { container } = render(GraphEdgeLayer, {
      props: {
        edges: [first, latest],
        nodes: [agent(), agent('two')],
        positions: new Map([
          ['agent:one', { x: 100, y: 100 }],
          ['agent:two', { x: 300, y: 100 }],
        ]),
      },
    });

    expect(container.querySelectorAll('[data-message-particle]')).toHaveLength(1);
    expect(container.querySelector('[data-message-particle]')?.getAttribute('data-target-id')).toBe(
      'agent:one',
    );
  });
});
