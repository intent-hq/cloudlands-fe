/**
 * Tests for WorkspaceCard idle activity behavior.
 *
 * Verifies that compact workspace rows communicate activity through the
 * phase indicator without rendering a noisy inline agent avatar/count cluster.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type { Workspace } from '$shared/types';
import { PullRequestStatus, WorkspaceStatus } from '$shared/types';
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
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/') }));

vi.mock('$app/state', () => ({ page: pageState }));

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

  it('renders a static muted waiting dot that loses to running and unread', () => {
    const workspace = makeWorkspace();
    const waitingDotSelector = '[class*="bg-muted-foreground/60"]';

    const waiting = render(WorkspaceCard, {
      props: { workspace, isWaiting: true },
    });
    const waitingDot = waiting.container.querySelector(waitingDotSelector);
    expect(waitingDot).toBeTruthy();
    expect(waitingDot?.className).not.toContain('animate-pulse');
    expect(waiting.container.querySelector('.bg-success')).toBeNull();
    expect(waiting.container.querySelector('.bg-info')).toBeNull();
    waiting.unmount();

    const running = render(WorkspaceCard, {
      props: { workspace, isWaiting: true, isRunning: true },
    });
    expect(running.container.querySelector('.bg-success')).toBeTruthy();
    expect(running.container.querySelector(waitingDotSelector)).toBeNull();
    running.unmount();

    const unread = render(WorkspaceCard, {
      props: { workspace, isWaiting: true, isUnread: true },
    });
    expect(unread.container.querySelector('.bg-info')).toBeTruthy();
    expect(unread.container.querySelector(waitingDotSelector)).toBeNull();
    unread.unmount();
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

  it('presents pinned state persistently beside the title without creating another action', async () => {
    const onTogglePin = vi.fn();
    const workspace = makeWorkspace();
    const { container, getByRole, rerender } = render(WorkspaceCard, {
      props: { workspace, isPinned: true, onTogglePin },
    });

    const title = container.querySelector('[data-workspace-card-title]')!;
    const titleGroup = container.querySelector('[data-workspace-card-title-group]')!;
    const marker = container.querySelector('[data-workspace-card-pin-indicator]')!;
    const trigger = getByRole('button', { name: 'Test Workspace', description: 'Pinned' });

    expect(titleGroup.contains(title)).toBe(true);
    expect(title.nextElementSibling).toBe(marker);
    expect(marker.getAttribute('aria-hidden')).toBe('true');
    expect(marker.classList.contains('opacity-0')).toBe(false);
    expect(getByRole('button', { name: 'Unpin' })).toBeTruthy();
    expect(container.querySelectorAll('[data-workspace-card-pin-indicator]')).toHaveLength(1);
    expect(trigger.getAttribute('aria-describedby')).toBe(`workspace-pinned-state-${workspace.id}`);

    await fireEvent.click(getByRole('button', { name: 'Unpin' }));
    expect(onTogglePin).toHaveBeenCalledOnce();

    await rerender({ workspace, isPinned: false, onTogglePin });
    expect(container.querySelector('[data-workspace-card-pin-indicator]')).toBeNull();
    expect(getByRole('button', { name: 'Test Workspace' }).hasAttribute('aria-describedby')).toBe(
      false,
    );
    expect(getByRole('button', { name: 'Pin' })).toBeTruthy();
  });

  it('keeps dense pinned rows contained and replaces the passive marker with the action on hover/focus', () => {
    const workspace = makeWorkspace({
      title: 'A very long localized workspace title that must truncate before metadata',
      prStatus: PullRequestStatus.Open,
      prNumber: 42,
    });
    const { container, getByRole, getByText } = render(WorkspaceCard, {
      props: {
        workspace,
        isPinned: true,
        isRunning: true,
        selected: true,
        trailingLabel: 'Archived',
        onTogglePin: vi.fn(),
      },
    });

    const row = container.querySelector('[data-workspace-card-row]')!;
    const titleGroup = container.querySelector('[data-workspace-card-title-group]')!;
    const title = container.querySelector('[data-workspace-card-title]')!;
    const marker = container.querySelector('[data-workspace-card-pin-indicator]')!;
    const actions = container.querySelector('.wc-actions')!;
    const trigger = getByRole('button', { name: workspace.title });
    const unpin = getByRole('button', { name: 'Unpin' });

    expect(row.className).toContain('w-auto');
    expect(titleGroup.className).toContain('min-w-0');
    expect(titleGroup.className).toContain('flex-1');
    expect(title.className).toContain('truncate');
    expect(marker.className).toContain('shrink-0');
    expect(marker.className).toContain('group-hover:opacity-0');
    expect(actions.className).toContain('group-hover:opacity-100');
    expect(actions.className).toContain('group-focus-within:opacity-100');
    expect(getByText('PR #42')).toBeTruthy();
    expect(container.querySelector('[data-workspace-card-time]')).toBeTruthy();
    expect(container.querySelector('.bg-success')?.contains(marker)).toBe(false);
    expect(trigger.className).not.toMatch(/focus-visible:ring-(?:1|2|4|8)|ring-inset|ring-offset/);
    expect(unpin.className).not.toMatch(/focus-visible:ring-(?:1|2|4|8)|ring-inset|ring-offset/);
    expect(trigger.className).toContain('focus-visible:bg-background/50');
  });

  it('retains one visible pin across current, highlighted, and unread row states', () => {
    const workspace = makeWorkspace({ id: 'current-pinned' as Workspace['id'] });
    pageState.url = new URL('http://localhost/workspace/current-pinned');
    const { container, getByRole } = render(WorkspaceCard, {
      props: {
        workspace,
        isPinned: true,
        isUnread: true,
        highlighted: true,
        onTogglePin: vi.fn(),
      },
    });

    expect(container.querySelector('[data-workspace-card-row]')?.className).toContain(
      'bg-background/60',
    );
    expect(container.querySelector('.bg-info')).toBeTruthy();
    expect(container.querySelector('[data-workspace-card-pin-indicator]')?.className).toContain(
      'opacity-0',
    );
    expect(container.querySelector('.wc-actions')?.className).toContain('opacity-100');
    expect(getByRole('button', { name: 'Unpin' })).toBeTruthy();
    pageState.url = new URL('http://localhost/');
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
