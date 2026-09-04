import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
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

function agent(): AgentNode {
  return {
    id: 'agent:one',
    type: 'agent',
    agentId: 'one',
    name: 'Agent One',
    isCoordinator: true,
    status: 'idle',
    createdAt: timestamp,
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
  };
}

function task(): TaskNode {
  return {
    id: 'task:one',
    type: 'task',
    taskId: 'one',
    title: 'Task One',
    state: 'in_progress',
    dependsOn: [],
    x: 300,
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

afterEach(cleanup);

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
