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

afterEach(cleanup);

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
      props: { node, focusState: 'focused', isActive: true, tabindex: -1, onclick },
    });

    const button = screen.getByRole('button', { name: 'Ship activity graph' });
    expect(button.getAttribute('data-task-state')).toBe('review_required');
    expect(button.getAttribute('data-focus-state')).toBe('focused');
    expect(button.tabIndex).toBe(-1);
    await fireEvent.click(button);
    expect(onclick).toHaveBeenCalledOnce();
  });
});

describe('AgentOrbNode', () => {
  it('includes the normalized specialist in its accessible name and forwards activation', async () => {
    const onclick = vi.fn();
    const node: AgentNode = {
      ...physics,
      id: 'agent:builder',
      type: 'agent',
      agentId: 'builder',
      name: 'Builder',
      specialist: 'frontend-engineer',
      isCoordinator: false,
      status: 'waiting',
      createdAt: timestamp,
    };
    render(AgentOrbNode, { props: { node, isActive: true, onclick } });

    const button = screen.getByRole('button', { name: 'Builder · frontend engineer' });
    expect(button.getAttribute('data-agent-status')).toBe('waiting');
    expect(screen.getByTestId('mock-avatar-with-state').getAttribute('data-agent-id')).toBe(
      'builder',
    );
    await fireEvent.click(button);
    expect(onclick).toHaveBeenCalledOnce();
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
});
