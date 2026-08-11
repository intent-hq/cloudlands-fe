/**
 * Tests for WorkspaceCard idle activity behavior.
 *
 * Verifies that compact workspace rows communicate activity through the
 * phase indicator without rendering a noisy inline agent avatar/count cluster.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import {
  createTestWorkspaceId,
  createTestAgentId,
} from '../../../../test/factories/workspace.factory';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const state = {};

  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });

  const selector = <T>(getter: (state: any, ...args: any[]) => T) =>
    Object.assign((...args: any[]) => readable(getter(state, ...args)), {
      select: (s: any, ...a: any[]) => getter(s ?? state, ...a),
    });

  return { dispatch, state, readable, selector };
});

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/') } }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.state,
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTasksLoading: mocks.selector(() => false),
  selectWorkspaceTaskProgress: mocks.selector(() => ({ total: 0, completed: 0 })),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-slice', () => ({
  ensureWorkspaceTasksLoaded: vi.fn((id) => ({
    type: 'workspace-tasks/ensureLoaded',
    payload: id,
  })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActivePullRequest: mocks.selector(() => null),
}));

import WorkspaceCard from '../WorkspaceCard.svelte';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: createTestWorkspaceId(),
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activity: 'idle',
    agentSummary: { agentIds: [], hasActiveAgents: false },
    ...overrides,
  } as Workspace;
}

describe('WorkspaceCard compact agent metadata', () => {
  it('does not render inline agent metadata when workspace.activity === "agent_running"', () => {
    const wsId = createTestWorkspaceId();
    const agentId = createTestAgentId();
    const workspace = makeWorkspace({
      id: wsId,
      activity: 'agent_running',
      agentSummary: { agentIds: [agentId], hasActiveAgents: true },
    });

    const { container } = render(WorkspaceCard, {
      props: { workspace, streamingAgentIds: [agentId], isRunning: true },
    });

    expect(container.querySelector('[data-workspace-card-agents]')).toBeNull();
    expect(container.querySelector('[data-testid="mock-avatar"]')).toBeNull();
  });

  it('uses the workspace unread marker without rendering inline agent metadata', () => {
    const wsId = createTestWorkspaceId();
    const agentId = createTestAgentId();
    const workspace = makeWorkspace({
      id: wsId,
      activity: 'idle',
      agentSummary: { agentIds: [agentId], hasActiveAgents: false },
    });

    const { container } = render(WorkspaceCard, {
      props: {
        workspace,
        streamingAgentIds: [],
        isRunning: false,
        isUnread: true,
      },
    });

    expect(container.querySelector('.bg-info')).toBeTruthy();
    expect(container.querySelector('[data-workspace-card-agents]')).toBeNull();
    expect(container.querySelector('[data-testid="mock-avatar"]')).toBeNull();
  });

  it('uses the canonical compact row hierarchy and inset styling', () => {
    const { container } = render(WorkspaceCard, { props: { workspace: makeWorkspace() } });
    const row = container.querySelector('[data-workspace-card-row]');
    const title = container.querySelector('[data-workspace-card-title]');
    const time = container.querySelector('[data-workspace-card-time] span');

    expect(row?.className).toContain('mx-1');
    expect(row?.className).toContain('rounded-md');
    expect(row?.className).toContain('py-2');
    expect(row?.className).toContain('font-normal');
    expect(row?.className).toContain('hover:bg-background/40');
    expect(title?.className).toContain('type-body');
    expect(title?.className).toContain('font-normal!');
    expect(time?.className).toContain('type-caption');
    expect(time?.className).toContain('tabular-nums');
  });

  it('uses sibling named controls and reveals canonical-size actions to keyboard focus', async () => {
    const onClick = vi.fn();
    const onTogglePin = vi.fn();
    const onMarkAsRead = vi.fn();
    const { container, getByRole } = render(WorkspaceCard, {
      props: {
        workspace: makeWorkspace(),
        isUnread: true,
        onClick,
        onTogglePin,
        onMarkAsRead,
      },
    });

    const workspaceButton = getByRole('button', { name: 'Test Workspace' });
    const pinButton = getByRole('button', { name: 'Pin' });
    const markAsReadButton = getByRole('button', { name: 'Mark as read' });
    const actions = container.querySelector('[class*="wc-actions"]');

    expect(workspaceButton.contains(pinButton)).toBe(false);
    expect(workspaceButton.contains(markAsReadButton)).toBe(false);
    expect(pinButton.className).toContain('size-7');
    expect(markAsReadButton.className).toContain('size-7');
    expect(actions?.className).toContain('focus-within:opacity-100');

    pinButton.focus();
    expect(document.activeElement).toBe(pinButton);
    await fireEvent.click(pinButton);
    expect(onTogglePin).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();

    await fireEvent.click(workspaceButton);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('omits busy agent counts from the compact row', () => {
    const workspace = makeWorkspace({ activity: 'agent_running' });
    const streamingAgentIds = Array.from({ length: 5 }, () => createTestAgentId());
    const { container } = render(WorkspaceCard, {
      props: { workspace, streamingAgentIds, isRunning: true },
    });
    expect(container.querySelector('[data-workspace-card-agents]')).toBeNull();
    expect(container.querySelector('[data-testid="mock-avatar"]')).toBeNull();
    expect(container.textContent).not.toContain('+4');
  });
});
