import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentNode, FileNode, NoteNode, TaskNode } from '../types';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('../../chat/__tests__/mocks/MockAvatarWithState.svelte')).default,
}));

import AgentOrbNode from '../nodes/AgentOrbNode.svelte';
import ResourceNode from '../nodes/ResourceNode.svelte';
import TaskAnchorNode from '../nodes/TaskAnchorNode.svelte';

const timestamp = '2026-09-04T00:00:00.000Z';
const physics = { x: 0, y: 0, vx: 0, vy: 0 } as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function useReducedMotion(): void {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
}

describe('TaskAnchorNode', () => {
  it('exposes task state and forwards activation', async () => {
    const onclick = vi.fn();
    const node: TaskNode = {
      ...physics,
      id: 'task:ship',
      type: 'task',
      taskId: 'ship',
      title: 'Ship activity graph',
      state: 'review_required',
      dependsOn: [],
    };
    render(TaskAnchorNode, {
      props: {
        node,
        focusState: 'focused',
        isActive: true,
        agentCount: 2,
        tabindex: -1,
        onclick,
      },
    });

    const button = screen.getByRole('button', { name: 'Ship activity graph' });
    expect(button.getAttribute('data-task-state')).toBe('review_required');
    expect(button.getAttribute('data-focus-state')).toBe('focused');
    expect(button.querySelector('.node-meta')?.textContent).toContain('2 agents');
    expect(button.tabIndex).toBe(-1);
    await fireEvent.click(button);
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('keeps a status mark in the far band and restores the title when focused', async () => {
    const node: TaskNode = {
      ...physics,
      id: 'task:ship',
      type: 'task',
      taskId: 'ship',
      title: 'Ship activity graph',
      state: 'in_progress',
      dependsOn: [],
    };
    const view = render(TaskAnchorNode, { props: { node, zoomBand: 'far' } });
    const button = screen.getByRole('button', { name: node.title });

    expect(button.title).toBe(node.title);
    expect(button.querySelector('.task-status-dot')).toBeTruthy();
    expect(screen.queryByText(node.title)).toBeNull();

    await view.rerender({ node, zoomBand: 'far', focusState: 'focused' });
    expect(screen.getByText(node.title)).toBeTruthy();
    expect(button.querySelector('.task-status-dot')).toBeNull();
  });
});

describe('AgentOrbNode', () => {
  it('includes the normalized specialist in its accessible name and forwards activation', async () => {
    const onclick = vi.fn();
    const name = 'Perform comprehensive constellation verification';
    const node: AgentNode = {
      ...physics,
      id: 'agent:builder',
      type: 'agent',
      agentId: 'builder',
      name,
      specialist: 'frontend-engineer',
      isCoordinator: false,
      status: 'waiting',
      createdAt: timestamp,
    };
    render(AgentOrbNode, { props: { node, isActive: true, onclick } });

    const button = screen.getByRole('button', { name: `${name} · frontend engineer` });
    expect(button.title).toBe(`${name} · frontend engineer`);
    expect(button.getAttribute('data-agent-status')).toBe('waiting');
    expect(screen.getByTestId('mock-avatar-with-state').getAttribute('data-agent-id')).toBe(
      'builder',
    );
    await fireEvent.click(button);
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('keeps its counter-scaled name rendered outside the full zoom band', () => {
    const node: AgentNode = {
      ...physics,
      id: 'agent:builder',
      type: 'agent',
      agentId: 'builder',
      name: 'Graph builder',
      isCoordinator: false,
      status: 'idle',
      createdAt: timestamp,
    };
    render(AgentOrbNode, { props: { node, zoomBand: 'mid' } });

    const label = screen.getByText(node.name);
    expect(getComputedStyle(label).opacity).not.toBe('0');
  });

  it('shows specialist and activity metadata when focused', () => {
    const node: AgentNode = {
      ...physics,
      id: 'agent:builder',
      type: 'agent',
      agentId: 'builder',
      name: 'Graph builder',
      specialist: 'frontend-engineer',
      isCoordinator: false,
      status: 'responding',
      createdAt: timestamp,
    };
    const { container } = render(AgentOrbNode, {
      props: { node, focusState: 'focused', isActive: true, lastActivityAt: timestamp },
    });

    expect(container.querySelector('.specialist-caption')?.textContent).toContain(
      'frontend engineer',
    );
    expect(container.querySelector('.node-meta')?.textContent).toContain(
      'frontend engineer · responding',
    );
    expect(container.querySelector('.agent-avatar-wrapper')?.getAttribute('style')).toContain(
      'animation-delay',
    );
  });

  it('keeps working and waiting distinguishable when motion is reduced', () => {
    useReducedMotion();
    const working = render(AgentOrbNode, {
      props: {
        node: { ...agentNode('working'), status: 'responding' },
        isActive: true,
      },
    });
    const waiting = render(AgentOrbNode, {
      props: { node: { ...agentNode('waiting'), status: 'waiting' } },
    });

    const workingRing = working.container.querySelector<HTMLElement>('.agent-avatar-wrapper')!;
    const waitingRing = waiting.container.querySelector<HTMLElement>('.agent-avatar-wrapper')!;
    expect(
      working.container.querySelector('[data-graph-node]')?.getAttribute('data-motion-enabled'),
    ).toBe('false');
    expect(workingRing.getAttribute('data-static-ring')).toBe('working');
    expect(waitingRing.getAttribute('data-static-ring')).toBe('waiting');
  });
});

describe('ResourceNode', () => {
  it('identifies external writes accessibly and forwards activation', async () => {
    const onclick = vi.fn();
    const node: FileNode = {
      ...physics,
      id: 'file:/tmp/capture.jpg',
      type: 'file',
      path: '/tmp/capture.jpg',
      fileName: 'capture.jpg',
      isExternal: true,
      lastAction: 'write',
      lastActionTimestamp: timestamp,
    };
    render(ResourceNode, {
      props: { node, access: 'write', additions: 4, deletions: 2, onclick },
    });

    const button = screen.getByRole('button', { name: /capture\.jpg.*\/tmp\/capture\.jpg/i });
    expect(button.getAttribute('data-external')).toBe('true');
    expect(button.getAttribute('data-access')).toBe('write');
    expect(button.title).toBe('/tmp/capture.jpg');
    await fireEvent.click(button);
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('renders note reads as ordinary named resources', () => {
    const node: NoteNode = {
      ...physics,
      id: 'note:spec',
      type: 'note',
      noteId: 'spec',
      title: 'Implementation spec',
      lastAction: 'read',
      lastActionTimestamp: timestamp,
    };
    render(ResourceNode, { props: { node, access: 'read' } });

    const button = screen.getByRole('button', { name: 'Implementation spec' });
    expect(button.getAttribute('data-external')).toBe('false');
    expect(button.getAttribute('data-access')).toBe('read');
  });

  it('uses a fixed screen-space dot in mid zoom and restores the label when focused', async () => {
    const node: NoteNode = {
      ...physics,
      id: 'note:spec',
      type: 'note',
      noteId: 'spec',
      title: 'Implementation spec',
      lastAction: 'read',
      lastActionTimestamp: timestamp,
    };
    const view = render(ResourceNode, { props: { node, access: 'read', zoomBand: 'mid' } });
    const button = screen.getByRole('button', { name: node.title });

    expect(button.querySelector('.resource-dot')).toBeTruthy();
    expect(screen.queryByText(node.title)).toBeNull();

    await view.rerender({ node, access: 'read', zoomBand: 'mid', focusState: 'focused' });
    expect(screen.getByText(node.title)).toBeTruthy();
    expect(button.querySelector('.resource-dot')).toBeNull();
  });

  it('does not compound resource cooldown and neighbourhood dimming below 0.4', () => {
    const node: NoteNode = {
      ...physics,
      id: 'note:spec',
      type: 'note',
      noteId: 'spec',
      title: 'Implementation spec',
      lastAction: 'read',
      lastActionTimestamp: timestamp,
    };
    render(ResourceNode, { props: { node, access: 'read', focusState: 'dimmed' } });

    expect(screen.getByRole('button', { name: node.title }).style.opacity).toBe('0.4');
  });
});

function agentNode(id: string): AgentNode {
  return {
    ...physics,
    id: `agent:${id}`,
    type: 'agent',
    agentId: id,
    name: id,
    isCoordinator: false,
    status: 'idle',
    createdAt: timestamp,
  };
}
