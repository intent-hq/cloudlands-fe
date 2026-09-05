/**
 * Tests for WorkspaceCard idle activity behavior.
 *
 * Verifies that compact workspace rows use the shared workspace status
 * indicator without rendering local status dots or agent clusters.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Workspace } from '$shared/types';
import { PullRequestStatus, WorkspaceStatus } from '$shared/types';
import {
  createTestWorkspaceId,
  createTestAgentId,
} from '../../../../test/factories/workspace.factory';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';
import { workspaceHoverCardIntentSession } from '../utils/workspace-hover-card-intent';

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

// The hover card's own store wiring is irrelevant here; the hover-intent
// tests only assert when WorkspaceCard mounts it.
vi.mock('$lib/components/workspace/WorkspaceHoverCard.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
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
    displayStatus: 'idle',
    agentSummary: { agentIds: [], hasActiveAgents: false },
    ...overrides,
  } as Workspace;
}

function rect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('WorkspaceCard compact agent metadata', () => {
  beforeEach(() => workspaceHoverCardIntentSession.reset());

  it('uses the daemon display status without inferring state from activity', () => {
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
    expect(container.querySelectorAll('[data-workspace-status]')).toHaveLength(1);
    expect(container.querySelector('[data-workspace-status="idle"]')).toBeTruthy();
  });

  it('updates the same shared icon through unread, waiting, running, and blocked states', async () => {
    const workspace = makeWorkspace({ attention: 'unread', waiting: true });
    const { container, rerender } = render(WorkspaceCard, { props: { workspace } });
    const icon = container.querySelector('[data-workspace-status]');

    expect(icon?.getAttribute('data-workspace-status')).toBe('unread');
    expect(container.querySelectorAll('[data-workspace-status]')).toHaveLength(1);

    await rerender({ workspace: makeWorkspace({ waiting: true }) });
    expect(container.querySelector('[data-workspace-status]')).toBe(icon);
    expect(icon?.getAttribute('data-workspace-status')).toBe('waiting');

    await rerender({ workspace: makeWorkspace({ displayStatus: 'in_progress', waiting: true }) });
    expect(container.querySelector('[data-workspace-status]')).toBe(icon);
    expect(icon?.getAttribute('data-workspace-status')).toBe('in_progress');
    expect(icon?.getAttribute('data-workspace-status-icon')).toBeNull();

    await rerender({ workspace: makeWorkspace({ displayStatus: 'blocked', attention: 'unread' }) });
    expect(container.querySelector('[data-workspace-status]')).toBe(icon);
    expect(icon?.getAttribute('data-workspace-status')).toBe('blocked');
    expect(icon?.getAttribute('data-workspace-status-icon')).toBe('xmark');
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
    const trigger = getByRole('button', { name: 'Test Workspace', description: /Pinned/ });

    expect(titleGroup.contains(title)).toBe(true);
    expect(title.nextElementSibling).toBe(marker);
    expect(marker.getAttribute('aria-hidden')).toBe('true');
    expect(marker.classList.contains('opacity-0')).toBe(false);
    expect(getByRole('button', { name: 'Unpin' })).toBeTruthy();
    expect(container.querySelectorAll('[data-workspace-card-pin-indicator]')).toHaveLength(1);
    expect(trigger.getAttribute('aria-describedby')).toBe(
      `workspace-status-state-${workspace.id} workspace-pinned-state-${workspace.id}`,
    );

    await fireEvent.click(getByRole('button', { name: 'Unpin' }));
    expect(onTogglePin).toHaveBeenCalledOnce();

    await rerender({ workspace, isPinned: false, onTogglePin });
    expect(container.querySelector('[data-workspace-card-pin-indicator]')).toBeNull();
    expect(getByRole('button', { name: 'Test Workspace' }).getAttribute('aria-describedby')).toBe(
      `workspace-status-state-${workspace.id}`,
    );
    expect(getByRole('button', { name: 'Pin' })).toBeTruthy();
  });

  it('keeps dense pinned rows contained and replaces the passive marker with the action on hover/focus', () => {
    const workspace = makeWorkspace({
      title: 'A very long localized workspace title that must truncate before metadata',
      prStatus: PullRequestStatus.Open,
      prNumber: 42,
    });
    const { container, getByRole } = render(WorkspaceCard, {
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
    const prItem = container.querySelector('[data-workspace-card-pr-item]');

    expect(row.className).toContain('w-auto');
    expect(titleGroup.className).toContain('min-w-0');
    expect(titleGroup.className).toContain('flex-1');
    expect(title.className).toContain('truncate');
    expect(marker.className).toContain('shrink-0');
    expect(marker.className).toContain('group-hover:opacity-0');
    expect(actions.className).toContain('group-hover:opacity-100');
    expect(actions.className).toContain('group-focus-within:opacity-100');
    expect(prItem).toBeTruthy();
    expect(prItem?.querySelector('[data-workspace-card-pr-number]')).toBeNull();
    expect(prItem?.querySelector('svg')).toBeTruthy();
    expect(prItem?.getAttribute('aria-label')).toContain('#42');
    expect(container.querySelector('[data-workspace-card-time]')).toBeTruthy();
    expect(container.querySelector('[data-workspace-status]')?.contains(marker)).toBe(false);
    expect(trigger.className).not.toMatch(/focus-visible:ring-(?:1|2|4|8)|ring-inset|ring-offset/);
    expect(unpin.className).not.toMatch(/focus-visible:ring-(?:1|2|4|8)|ring-inset|ring-offset/);
    expect(trigger.className).toContain('focus-visible:bg-background/50');
  });

  it('retains one visible pin across current, highlighted, and unread row states', () => {
    const workspace = makeWorkspace({
      id: 'current-pinned' as Workspace['id'],
      attention: 'unread',
    });
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
    expect(container.querySelector('[data-workspace-status="unread"]')).toBeTruthy();
    expect(container.querySelector('[data-workspace-card-pin-indicator]')?.className).toContain(
      'opacity-0',
    );
    expect(container.querySelector('.wc-actions')?.className).toContain('opacity-100');
    expect(getByRole('button', { name: 'Unpin' })).toBeTruthy();
    pageState.url = new URL('http://localhost/');
  });

  it.each(['Enter', ' '])(
    'opens the All Workspaces overflow menu with %s without activating the row',
    async (key) => {
      const onClick = vi.fn();
      const onOpenInNewWindow = vi.fn();
      const { container } = render(WorkspaceCard, {
        props: { workspace: makeWorkspace(), onClick, onOpenInNewWindow },
      });
      const trigger = screen.getByRole('button', { name: 'Workspace actions' });

      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      trigger.focus();
      await fireEvent.keyDown(trigger, { key });
      const menu = await screen.findByRole('menu');

      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(container.contains(menu)).toBe(false);
      expect(onClick).not.toHaveBeenCalled();

      await fireEvent.keyDown(menu, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(document.activeElement).toBe(trigger);
    },
  );

  it('opens on pointer click and dismisses outside', async () => {
    const onClick = vi.fn();
    const onOpenInNewWindow = vi.fn();
    render(WorkspaceCard, {
      props: { workspace: makeWorkspace(), onClick, onOpenInNewWindow },
    });
    const trigger = screen.getByRole('button', { name: 'Workspace actions' });

    await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    await fireEvent.click(trigger, { detail: 1 });
    await screen.findByRole('menu');
    expect(onClick).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fireEvent.pointerDown(document.body, {
      button: 0,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('runs an overflow action once without activating the row', async () => {
    const onClick = vi.fn();
    const onOpenInNewWindow = vi.fn();
    render(WorkspaceCard, {
      props: { workspace: makeWorkspace(), onClick, onOpenInNewWindow },
    });
    const trigger = screen.getByRole('button', { name: 'Workspace actions' });

    await fireEvent.click(trigger);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in New Window' }));
    expect(onOpenInNewWindow).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps the right-click context menu working beside the overflow trigger', async () => {
    const { container } = render(WorkspaceCard, {
      props: { workspace: makeWorkspace(), onOpenInNewWindow: vi.fn() },
    });
    const row = container.querySelector<HTMLElement>('[data-workspace-card-row]')!;

    await fireEvent.contextMenu(row, { clientX: 20, clientY: 30 });

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Open in New Window' })).toBeTruthy();
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

describe('WorkspaceCard hover-intent delay', () => {
  const hoverCard = () => document.querySelector('[role="tooltip"]');

  beforeEach(() => workspaceHoverCardIntentSession.reset());

  it('affirms hover-card placement and dismissal in every required visual state', async () => {
    vi.useFakeTimers();
    const cardRect = rect(0, 0, 300, 120);
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getMockRect(this: HTMLElement) {
        return this.getAttribute('role') === 'tooltip' ? cardRect : rect(0, 0, 0, 0);
      });
    try {
      const observed = await exerciseVisualStates(async ({ width }) => {
        const view = render(WorkspaceCard, { props: { workspace: makeWorkspace() } });
        const row = view.container.querySelector<HTMLElement>('[data-workspace-card-row]')!;
        row.tabIndex = 0;
        row.getBoundingClientRect = vi.fn(() => rect(40, 16, 224, 28));
        return {
          ...view,
          target: row,
          assertCapability: async () => {
            await vi.advanceTimersByTimeAsync(250);
            await tick();
            await vi.advanceTimersByTimeAsync(16);
            const card = hoverCard() as HTMLElement | null;
            expect(card?.classList.contains('fixed')).toBe(true);
            const left = Number.parseFloat(card?.style.left ?? '');
            expect(left).toBeGreaterThanOrEqual(8);
            expect(left + cardRect.width).toBeLessThanOrEqual(width - 8);
            await fireEvent.mouseLeave(row);
            await fireEvent.focusOut(row, { relatedTarget: document.body });
            await tick();
            expect(hoverCard()).toBeNull();
          },
        };
      });
      expect(observed).toEqual(configuredVisualStates);
    } finally {
      rectSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('mounts the hover card only after the pointer rests on the row', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(WorkspaceCard, { props: { workspace: makeWorkspace() } });
      const row = container.querySelector<HTMLElement>('[data-workspace-card-row]')!;

      await fireEvent.mouseEnter(row);
      expect(hoverCard()).toBeNull();

      vi.advanceTimersByTime(399);
      await tick();
      expect(hoverCard()).toBeNull();

      vi.advanceTimersByTime(1);
      await tick();
      expect(hoverCard()).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never mounts the hover card when the pointer scrubs across the row', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(WorkspaceCard, { props: { workspace: makeWorkspace() } });
      const row = container.querySelector<HTMLElement>('[data-workspace-card-row]')!;

      await fireEvent.mouseEnter(row);
      vi.advanceTimersByTime(100);
      await fireEvent.mouseLeave(row);
      vi.advanceTimersByTime(1000);
      await tick();
      expect(hoverCard()).toBeNull();

      // Re-entering restarts the delay from zero.
      await fireEvent.mouseEnter(row);
      vi.advanceTimersByTime(399);
      await tick();
      expect(hoverCard()).toBeNull();
      vi.advanceTimersByTime(1);
      await tick();
      expect(hoverCard()).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending hover open when hover is suppressed', async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(WorkspaceCard, {
        props: { workspace: makeWorkspace(), suppressHover: false },
      });
      const row = container.querySelector<HTMLElement>('[data-workspace-card-row]')!;

      await fireEvent.mouseEnter(row);
      await rerender({ workspace: makeWorkspace(), suppressHover: true });
      vi.advanceTimersByTime(1000);
      await tick();
      expect(hoverCard()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the next row immediately during a session and resets after cooldown', async () => {
    vi.useFakeTimers();
    try {
      const first = render(WorkspaceCard, {
        props: { workspace: makeWorkspace({ title: 'First workspace' }) },
      });
      const second = render(WorkspaceCard, {
        props: { workspace: makeWorkspace({ title: 'Second workspace' }) },
      });
      const firstRow = first.container.querySelector<HTMLElement>('[data-workspace-card-row]')!;
      const secondRow = second.container.querySelector<HTMLElement>('[data-workspace-card-row]')!;

      await fireEvent.mouseEnter(firstRow);
      vi.advanceTimersByTime(400);
      await tick();
      expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);

      await fireEvent.mouseLeave(firstRow);
      await fireEvent.mouseEnter(secondRow);
      vi.advanceTimersByTime(0);
      await tick();
      expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);

      await fireEvent.mouseLeave(secondRow);
      vi.advanceTimersByTime(300);
      await fireEvent.mouseEnter(firstRow);
      vi.advanceTimersByTime(399);
      await tick();
      expect(hoverCard()).toBeNull();
      vi.advanceTimersByTime(1);
      await tick();
      expect(hoverCard()).toBeTruthy();

      await fireEvent.mouseLeave(firstRow);
      vi.advanceTimersByTime(300);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens immediately for keyboard focus and closes after focus leaves the row', async () => {
    const { container } = render(WorkspaceCard, { props: { workspace: makeWorkspace() } });
    const trigger = container.querySelector<HTMLElement>('[data-workspace-card-trigger]')!;

    await fireEvent.focusIn(trigger);
    await tick();
    expect(hoverCard()).toBeTruthy();
    expect(trigger.getAttribute('aria-describedby')).toContain(hoverCard()?.id);

    await fireEvent.focusOut(trigger, { relatedTarget: document.body });
    await tick();
    expect(hoverCard()).toBeNull();
  });

  it('clears a pending hover open when the row is destroyed', async () => {
    vi.useFakeTimers();
    try {
      const view = render(WorkspaceCard, { props: { workspace: makeWorkspace() } });
      const row = view.container.querySelector<HTMLElement>('[data-workspace-card-row]')!;
      const timerCountBeforeHover = vi.getTimerCount();
      await fireEvent.mouseEnter(row);
      expect(vi.getTimerCount()).toBe(timerCountBeforeHover + 1);

      view.unmount();
      expect(vi.getTimerCount()).toBeLessThanOrEqual(timerCountBeforeHover);
    } finally {
      vi.useRealTimers();
    }
  });
});
