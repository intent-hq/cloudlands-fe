/** @vitest-environment jsdom */
import { m } from '$shared/paraglide/messages.js';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceTabStatus } from '$store/renderer/slices/hud/hud-types';
import { WORKSPACE_TAB_MOVED_EVENT } from '$features/workspace/utils/workspace-tab-move-event';
import { workspaceHoverCardIntentSession } from '$lib/components/workspace/utils/workspace-hover-card-intent';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  goto: vi.fn(() => Promise.resolve()),
  nextCurrentId: 'ws-2' as string | null,
  tabOrder: ['ws-1', 'ws-2', 'ws-3'] as string[],
  loadedWorkspaceIds: new Set<string>(),
  tabStatuses: {} as Record<string, WorkspaceTabStatus>,
}));

const readable = <T>(value: T) => ({
  subscribe(run: (value: T) => void) {
    run(value);
    return () => {};
  },
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    get state() {
      return { tabState: { currentTabId: mocks.nextCurrentId } };
    },
  },
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectCurrentWorkspaceTabId: Object.assign(() => readable('ws-1'), {
    select: () => mocks.nextCurrentId,
  }),
  selectWorkspaceTabOrder: () => readable(mocks.tabOrder),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: () =>
    readable(
      [
        {
          id: 'ws-1',
          title: 'Alpha',
          branch: 'feature/alpha',
          repositoryName: 'intent',
          statusMessage: 'Polishing the workspace navigation experience.',
          activity: 'agent_running',
          displayStatus: 'in_progress',
        },
        {
          id: 'ws-2',
          title: 'Beta',
          branch: 'main',
          repositoryName: 'intent',
          displayStatus: 'idle',
        },
        {
          id: 'ws-3',
          title: 'Gamma',
          branch: 'release',
          repositoryName: 'intent',
          displayStatus: 'blocked',
          status: 'Archived',
        },
      ].filter((workspace) => mocks.loadedWorkspaceIds.has(workspace.id)),
    ),
}));
vi.mock('$store/renderer/slices/hud/hud-selectors', () => ({
  selectWorkspaceTabStatuses: () => readable(mocks.tabStatuses),
}));
vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTasksByWorkspaceId: () =>
    readable({
      'ws-1': {
        stats: { total: 5, completed: 2, inProgress: 1 },
      },
    }),
}));
vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-slice', () => ({
  ensureWorkspaceTasksLoaded: (workspaceId: string) => ({
    type: 'workspaceTasks/ensureWorkspaceTasksLoaded',
    payload: [workspaceId],
  }),
}));
vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    startPolling: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn((workspaceId: string) =>
      workspaceId === 'ws-1' ? ['agent-1', 'agent-2'] : [],
    ),
  },
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('../workspace/__tests__/mocks/MockAgentAvatar.svelte')).default,
}));
vi.mock('$lib/components/workspace/WorkspaceHoverCard.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockWorkspaceHoverCard.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip', async () => ({
  TooltipRich: (await import('./__tests__/mocks/MockWorkspaceTooltipRich.svelte')).default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import WorkspaceTabStrip from './WorkspaceTabStrip.svelte';

function makeRect(left: number, top = 20, width = 160, height = 32): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function setTabGeometry() {
  for (const [id, left] of [
    ['ws-1', 0],
    ['ws-2', 162],
    ['ws-3', 324],
  ] as const) {
    const tab = document.querySelector<HTMLElement>(`[data-workspace-tab="${id}"]`)!;
    tab.getBoundingClientRect = () => makeRect(left);
  }
}

function makePointerEvent(type: string, clientX: number, clientY = 20, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
    isPrimary: { value: true },
    pointerId: { value: pointerId },
  });
  return event;
}

function tabButton(source: HTMLElement) {
  return source.querySelector<HTMLElement>('[role="tab"]')!;
}

async function enterTabTooltip(tooltipRoot: HTMLElement) {
  await fireEvent.mouseEnter(tooltipRoot.closest<HTMLElement>('[data-workspace-tab]')!);
  await fireEvent.mouseEnter(tooltipRoot);
}

async function leaveTabTooltip(tooltipRoot: HTMLElement) {
  await fireEvent.mouseLeave(tooltipRoot);
  await fireEvent.mouseLeave(tooltipRoot.closest<HTMLElement>('[data-workspace-tab]')!);
}

function renderedTabOrder() {
  return Array.from(document.querySelectorAll('[data-workspace-tab-motion]')).map((tab) =>
    tab.getAttribute('data-workspace-tab-motion'),
  );
}

describe('WorkspaceTabStrip', () => {
  beforeEach(() => {
    workspaceHoverCardIntentSession.reset();
    mocks.dispatch.mockClear();
    mocks.goto.mockClear();
    mocks.nextCurrentId = 'ws-2';
    mocks.tabOrder = ['ws-1', 'ws-2', 'ws-3'];
    mocks.dispatch.mockImplementation((action: { type?: string; payload?: unknown[] }) => {
      if (action.type === 'tabState/openWorkspaceTab') {
        const workspaceId = String(action.payload?.[0] ?? '');
        if (!mocks.tabOrder.includes(workspaceId)) mocks.tabOrder.push(workspaceId);
        mocks.nextCurrentId = workspaceId;
        return;
      }
      if (action.type !== 'tabState/closeWorkspaceTab') return;
      const workspaceId = String(action.payload?.[0] ?? '');
      const closedIndex = mocks.tabOrder.indexOf(workspaceId);
      if (closedIndex < 0) return;
      mocks.tabOrder = mocks.tabOrder.filter((id) => id !== workspaceId);
      if (mocks.nextCurrentId === workspaceId) {
        mocks.nextCurrentId =
          mocks.tabOrder[Math.min(closedIndex, mocks.tabOrder.length - 1)] ?? null;
      }
    });
    mocks.loadedWorkspaceIds.clear();
    mocks.loadedWorkspaceIds.add('ws-1');
    mocks.loadedWorkspaceIds.add('ws-2');
    mocks.loadedWorkspaceIds.add('ws-3');
    mocks.tabStatuses = {
      'ws-1': {
        agentCount: 1,
        categories: [{ category: 'running', count: 1, agentNames: ['Coordinator'] }],
        visibleCategories: [{ category: 'running', count: 1, agentNames: ['Coordinator'] }],
        hiddenCategoryCount: 0,
      },
    };
    let animationFrameTime = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrameTime += 16;
      callback(animationFrameTime);
      return 0;
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  it('scrolls only on the horizontal axis', () => {
    const { container } = render(WorkspaceTabStrip);
    const scroller = container.querySelector('[data-workspace-tab-scroller]')!;

    expect(scroller.className).toContain('overflow-x-auto');
    expect(scroller.className).toContain('overflow-y-hidden');
    expect(scroller.className).toContain('scrollbar-none');
  });

  it('affirms tab status and full-surface activation in every required visual state', async () => {
    const observed = await exerciseVisualStates(() => {
      const view = render(WorkspaceTabStrip);
      const target = view.getByRole('tab', { name: /Alpha/ });
      return {
        ...view,
        target,
        assertCapability: () => {
          expect(target.querySelector('[data-workspace-status="in_progress"]')).toBeTruthy();
          expect(target.className).toContain('h-full w-full');
          expect(target.querySelector('[data-workspace-tab-close-space]')).toBeTruthy();
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('renders persisted inactive tabs while their workspace metadata loads', () => {
    mocks.loadedWorkspaceIds.clear();
    mocks.loadedWorkspaceIds.add('ws-1');

    render(WorkspaceTabStrip);

    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Loading workspace ws-2' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Loading workspace ws-3' })).toBeTruthy();
    expect(document.querySelectorAll('[data-workspace-tab-loading="true"]')).toHaveLength(2);
  });

  it('uses one full-rectangle tab target for hydrated and loading workspaces', () => {
    mocks.loadedWorkspaceIds.delete('ws-3');

    render(WorkspaceTabStrip);

    const hydrated = screen.getByRole('tab', { name: /Alpha/ });
    const loading = screen.getByRole('tab', { name: 'Loading workspace ws-3' });
    const hydratedSurface = document.querySelector('[data-workspace-tab="ws-1"]')!;
    const loadingSurface = document.querySelector('[data-workspace-tab="ws-3"]')!;

    expect(hydratedSurface.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(loadingSurface.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(hydrated.className).toContain('h-full w-full');
    expect(loading.className).toContain('absolute -inset-px');
    expect(hydrated.closest('[data-testid="workspace-tab-tooltip-root"]')?.className).toContain(
      'absolute -inset-px',
    );
    expect(hydrated.querySelector('[data-workspace-status="in_progress"]')).toBeTruthy();
    expect(hydrated.querySelector('[data-workspace-tab-title]')?.textContent).toBe('Alpha');
  });

  it('activates exactly once from the title, status icon, padding, trailing background, and loading surface', async () => {
    mocks.loadedWorkspaceIds.delete('ws-3');
    render(WorkspaceTabStrip);

    const alpha = screen.getByRole('tab', { name: /Alpha/ });
    const statusIcon = alpha.querySelector('[data-workspace-status="in_progress"]')!;
    const title = alpha.querySelector('[data-workspace-tab-title]')!;
    const loading = screen.getByRole('tab', { name: 'Loading workspace ws-3' });
    const targets: Array<[Element, string, number]> = [
      [title, 'ws-1', 60],
      [statusIcon, 'ws-1', 14],
      [alpha, 'ws-1', 2],
      [alpha, 'ws-1', 150],
      [loading, 'ws-3', 2],
    ];

    for (const [target, workspaceId, clientX] of targets) {
      mocks.dispatch.mockClear();
      mocks.goto.mockClear();
      await fireEvent.click(target, { button: 0, clientX });
      expect(mocks.dispatch).toHaveBeenCalledTimes(1);
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'tabState/openWorkspaceTab',
        payload: [workspaceId],
      });
      expect(mocks.goto).toHaveBeenCalledTimes(1);
      expect(mocks.goto).toHaveBeenCalledWith(`/workspace/${workspaceId}`);
    }
  });

  it('right-aligns intrinsic statuses before a stable close reservation', () => {
    render(WorkspaceTabStrip);
    const tab = screen.getByRole('tab', { name: /Alpha/ });
    const cluster = tab.querySelector('[data-workspace-tab-status-cluster]')!;
    const controls = tab.querySelector('[data-workspace-tab-controls]')!;
    const closeSpace = tab.querySelector('[data-workspace-tab-close-space]')!;
    const title = tab.querySelector('[data-workspace-tab-title]')!;

    expect(tab.className).toContain('pl-3 pr-1');
    expect(tab.className).not.toContain('pr-8');
    expect(cluster.className).toContain('max-w-14');
    expect(cluster.className).toContain('justify-end');
    expect(cluster.className).not.toMatch(/(?:^|\s)w-14(?:\s|$)/);
    expect(controls.className).toContain('ml-auto');
    expect(controls.lastElementChild).toBe(closeSpace);
    expect(closeSpace.className).toContain('size-5');
    expect(title.className).toContain('min-w-0');
    expect(title.className).toContain('flex-1');
    expect(title.nextElementSibling).toBe(controls);
    expect(cluster.parentElement).toBe(controls);
  });

  it.each([
    ['active', 'ws-1'],
    ['inactive', 'ws-2'],
  ] as const)('uses a solid 8px in-progress dot in the %s tab', (_state, activeWorkspaceId) => {
    render(WorkspaceTabStrip, { props: { activeWorkspaceId } });
    const tab = screen.getByRole('tab', { name: /Alpha/ });
    const indicator = tab.querySelector<HTMLElement>('[data-workspace-status="in_progress"]');
    const dot = indicator?.querySelector('[data-workspace-status-dot]');

    expect(indicator?.getAttribute('style')).toContain('width: 14px; height: 14px');
    expect(indicator?.getAttribute('aria-hidden')).toBe('true');
    expect(dot?.classList.contains('workspace-status-dot')).toBe(true);
    expect(tab.getAttribute('aria-label')).toBe('Alpha. RUNNING: 1 (Coordinator)');
  });

  it('dims archived workspace tab titles in current and non-current states', () => {
    const { unmount } = render(WorkspaceTabStrip, { props: { activeWorkspaceId: 'ws-1' } });
    const archivedTitle = screen
      .getByRole('tab', { name: /Gamma/ })
      .querySelector('[data-workspace-tab-title]')!;
    const activeTitle = screen
      .getByRole('tab', { name: /Alpha/ })
      .querySelector('[data-workspace-tab-title]')!;
    expect(archivedTitle.className).toContain('opacity-60');
    expect(activeTitle.className).not.toContain('opacity-60');
    unmount();

    render(WorkspaceTabStrip, { props: { activeWorkspaceId: 'ws-3' } });
    const currentArchived = screen.getByRole('tab', { name: /Gamma/ });
    expect(currentArchived.getAttribute('aria-selected')).toBe('true');
    expect(currentArchived.querySelector('[data-workspace-tab-title]')?.className).toContain(
      'opacity-60',
    );
  });

  it('keeps one shared status icon and the trailing close reservation without agent detail', () => {
    mocks.tabStatuses = {};
    render(WorkspaceTabStrip);
    for (const tab of screen.getAllByRole('tab')) {
      const controls = tab.querySelector('[data-workspace-tab-controls]');
      if (!controls) continue;
      expect(controls.querySelectorAll('[data-workspace-status]')).toHaveLength(1);
      expect(controls.children).toHaveLength(2);
      expect(controls.lastElementChild?.hasAttribute('data-workspace-tab-close-space')).toBe(true);
    }
  });

  it('renders the shared workspace state while announcing detailed agent statuses', () => {
    mocks.tabStatuses = {
      'ws-1': {
        agentCount: 2,
        categories: [
          { category: 'question', count: 1, agentNames: ['Coordinator'] },
          { category: 'unread', count: 1, agentNames: ['Builder'] },
          { category: 'running', count: 1, agentNames: ['Builder'] },
        ],
        visibleCategories: [
          { category: 'question', count: 1, agentNames: ['Coordinator'] },
          { category: 'unread', count: 1, agentNames: ['Builder'] },
        ],
        hiddenCategoryCount: 1,
      },
    };

    render(WorkspaceTabStrip);

    const tab = screen.getByRole('tab', {
      name: 'Alpha. QUESTION: 1 (Coordinator) · UNREAD: 1 (Builder) · RUNNING: 1 (Builder)',
    });
    const statuses = tab.querySelectorAll('[data-workspace-status]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].getAttribute('data-workspace-status')).toBe('in_progress');
    expect(statuses[0].getAttribute('data-workspace-status-icon')).toBeNull();
    expect(statuses[0].className).toContain('workspace-status-color-active');
    expect(tab.querySelector('[data-workspace-tab-status-overflow]')).toBeNull();
  });

  it('keeps persisted tabs opaque and stationary during initial hydration', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/components/layout/WorkspaceTabStrip.svelte'),
      'utf8',
    );

    expect(source).not.toContain('in:fly');
    expect(source).not.toContain('out:fly');
    expect(source).toContain('animate:flip');
    expect(source).toContain('<WorkspaceHoverCard {workspace} activeAgentIds={runningAgentIds} />');
    expect(source).not.toContain('ensureWorkspaceTasksLoaded');
    expect(source).not.toContain('data-workspace-tab-progress');
  });

  it('keeps the final active-tab surface while workspace metadata loads', () => {
    mocks.loadedWorkspaceIds.clear();
    mocks.loadedWorkspaceIds.add('ws-2');
    mocks.loadedWorkspaceIds.add('ws-3');

    render(WorkspaceTabStrip);

    const loadingTab = document.querySelector('[data-workspace-tab="ws-1"]')!;
    const placeholder = loadingTab.querySelector('[class~="bg-sidebar-foreground/10"]')!;
    expect(loadingTab.classList).toContain('rounded-t-md');
    expect(loadingTab.classList).toContain('border-border');
    expect(loadingTab.classList).toContain('border-b-0');
    expect(loadingTab.classList).toContain('bg-sidebar');
    expect(loadingTab.classList).toContain('shadow-none');
    expect(loadingTab.classList).not.toContain('shadow-xs');
    expect(loadingTab.classList).not.toContain('backdrop-blur-xl');
    expect(placeholder.classList).toContain('bg-sidebar-foreground/10');
  });

  it('renders accessible tabs with delayed shared workspace hover cards', async () => {
    vi.useFakeTimers();
    const view = render(WorkspaceTabStrip);

    try {
      const tablist = screen.getByRole('tablist', {
        name: m.layout_workspaceTabStrip_openSpaces_ariaLabel(),
      });
      expect(getComputedStyle(tablist).paddingLeft).toBe('16px');
      expect(getComputedStyle(tablist).marginLeft).toBe('8px');
      expect(tablist.className).toContain('pr-3');
      expect(tablist.className).not.toContain('-ml-1');
      expect(tablist.className).not.toContain('-ml-3');
      expect(tablist.className).toContain('-mr-2.5');
      expect(screen.getAllByRole('tab')).toHaveLength(3);
      const alpha = screen.getByRole('tab', { name: /Alpha/ });
      expect(alpha.getAttribute('aria-selected')).toBe('true');
      expect(document.querySelector('[data-tooltip-delay="400"]')).toBeTruthy();
      const tooltipRoot = alpha.closest<HTMLElement>('[data-testid="workspace-tab-tooltip-root"]')!;
      expect(tooltipRoot.getAttribute('data-tooltip-disable-hoverable-content')).toBe('true');
      await enterTabTooltip(tooltipRoot);
      vi.advanceTimersByTime(399);
      await tick();
      expect(screen.queryByTestId('workspace-tab-preview')).toBeNull();
      vi.advanceTimersByTime(1);
      await tick();
      const alphaHover = document.querySelector('[data-workspace-tab-hover-content="ws-1"]')!;
      expect(alphaHover.querySelector('[data-workspace-hover-card]')).toBeTruthy();
      expect(alphaHover.querySelector('[data-workspace-hover-card-title]')?.textContent).toBe(
        'Alpha',
      );
      expect(alphaHover.querySelector('[data-workspace-hover-card-status]')?.textContent).toBe(
        'Polishing the workspace navigation experience.',
      );
      expect(alphaHover.querySelector('[data-workspace-hover-card-progress]')).toBeTruthy();
      expect(alphaHover.querySelector('[data-workspace-hover-card-agents]')?.textContent).toBe(
        'agent-1,agent-2',
      );
      expect(document.querySelector('[data-workspace-tab-progress]')).toBeNull();
      expect(document.querySelector('[data-workspace-tab-description]')).toBeNull();
      expect(
        document
          .querySelector('[data-tooltip-content-class]')
          ?.getAttribute('data-tooltip-content-class'),
      ).toContain('bg-transparent');
      expect(screen.queryByText('feature/alpha')).toBeNull();
      expect(screen.queryByText('Ctrl Tab')).toBeNull();

      await leaveTabTooltip(tooltipRoot);
      vi.advanceTimersByTime(300);
      await tick();
      expect(screen.queryByTestId('workspace-tab-preview')).toBeNull();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('cancels and restarts the full hover delay when the pointer switches tabs', async () => {
    vi.useFakeTimers();
    const view = render(WorkspaceTabStrip);
    try {
      const alphaRoot = screen
        .getByRole('tab', { name: /Alpha/ })
        .closest<HTMLElement>('[data-testid="workspace-tab-tooltip-root"]')!;
      const betaRoot = screen
        .getByRole('tab', { name: /Beta/ })
        .closest<HTMLElement>('[data-testid="workspace-tab-tooltip-root"]')!;

      await enterTabTooltip(alphaRoot);
      vi.advanceTimersByTime(200);
      await leaveTabTooltip(alphaRoot);
      await enterTabTooltip(betaRoot);
      vi.advanceTimersByTime(399);
      await tick();
      expect(screen.queryByTestId('workspace-tab-preview')).toBeNull();

      vi.advanceTimersByTime(1);
      await tick();
      expect(document.querySelector('[data-workspace-tab-hover-content="ws-1"]')).toBeNull();
      expect(document.querySelector('[data-workspace-tab-hover-content="ws-2"]')).toBeTruthy();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('opens the next tab immediately during a hover session', async () => {
    vi.useFakeTimers();
    const view = render(WorkspaceTabStrip);
    try {
      const alphaRoot = screen
        .getByRole('tab', { name: /Alpha/ })
        .closest<HTMLElement>('[data-testid="workspace-tab-tooltip-root"]')!;
      const betaRoot = screen
        .getByRole('tab', { name: /Beta/ })
        .closest<HTMLElement>('[data-testid="workspace-tab-tooltip-root"]')!;

      await enterTabTooltip(alphaRoot);
      vi.advanceTimersByTime(400);
      await tick();
      expect(document.querySelector('[data-workspace-tab-hover-content="ws-1"]')).toBeTruthy();

      await leaveTabTooltip(alphaRoot);
      await enterTabTooltip(betaRoot);
      vi.advanceTimersByTime(0);
      await tick();
      expect(document.querySelector('[data-workspace-tab-hover-content="ws-2"]')).toBeTruthy();

      await leaveTabTooltip(betaRoot);
      vi.advanceTimersByTime(300);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('opens tab hover content immediately on keyboard focus', async () => {
    render(WorkspaceTabStrip);
    const alpha = screen.getByRole('tab', { name: /Alpha/ });

    await fireEvent.focusIn(alpha);
    await tick();

    expect(document.querySelector('[data-workspace-tab-hover-content="ws-1"]')).toBeTruthy();
  });

  it('keeps the initial pointer delay after a keyboard-focus open', async () => {
    vi.useFakeTimers();
    const view = render(WorkspaceTabStrip);
    try {
      const alpha = screen.getByRole('tab', { name: /Alpha/ });
      const betaRoot = screen
        .getByRole('tab', { name: /Beta/ })
        .closest<HTMLElement>('[data-testid="workspace-tab-tooltip-root"]')!;

      await fireEvent.focusIn(alpha);
      await tick();
      expect(document.querySelector('[data-workspace-tab-hover-content="ws-1"]')).toBeTruthy();

      await fireEvent.focusOut(alpha, { relatedTarget: document.body });
      await tick();
      expect(document.querySelector('[data-workspace-tab-hover-content="ws-1"]')).toBeNull();

      await enterTabTooltip(betaRoot);
      vi.advanceTimersByTime(399);
      await tick();
      expect(document.querySelector('[data-workspace-tab-hover-content="ws-2"]')).toBeNull();

      vi.advanceTimersByTime(1);
      await tick();
      expect(document.querySelector('[data-workspace-tab-hover-content="ws-2"]')).toBeTruthy();

      await leaveTabTooltip(betaRoot);
      vi.advanceTimersByTime(300);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('does not start a hover session when focus opens the tab under the pointer', async () => {
    vi.useFakeTimers();
    const view = render(WorkspaceTabStrip);
    try {
      const alphaRoot = screen
        .getByRole('tab', { name: /Alpha/ })
        .closest<HTMLElement>('[data-testid="workspace-tab-tooltip-root"]')!;
      const beta = screen.getByRole('tab', { name: /Beta/ });
      const betaRoot = beta.closest<HTMLElement>('[data-testid="workspace-tab-tooltip-root"]')!;

      await enterTabTooltip(betaRoot);
      await fireEvent.focusIn(beta);
      await tick();
      expect(document.querySelector('[data-workspace-tab-hover-content="ws-2"]')).toBeTruthy();

      await fireEvent.focusOut(beta, { relatedTarget: document.body });
      await leaveTabTooltip(betaRoot);
      await enterTabTooltip(alphaRoot);
      vi.advanceTimersByTime(399);
      await tick();
      expect(document.querySelector('[data-workspace-tab-hover-content="ws-1"]')).toBeNull();

      vi.advanceTimersByTime(1);
      await tick();
      expect(document.querySelector('[data-workspace-tab-hover-content="ws-1"]')).toBeTruthy();

      await leaveTabTooltip(alphaRoot);
      vi.advanceTimersByTime(300);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('clears a pending tab hover open when the strip is destroyed', async () => {
    vi.useFakeTimers();
    try {
      const view = render(WorkspaceTabStrip);
      const alphaRoot = screen
        .getByRole('tab', { name: /Alpha/ })
        .closest<HTMLElement>('[data-testid="workspace-tab-tooltip-root"]')!;
      const timerCountBeforeHover = vi.getTimerCount();
      await enterTabTooltip(alphaRoot);
      expect(vi.getTimerCount()).toBe(timerCountBeforeHover + 1);

      view.unmount();
      expect(vi.getTimerCount()).toBeLessThanOrEqual(timerCountBeforeHover);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps every flare mounted and synchronizes its visibility across switching', async () => {
    mocks.loadedWorkspaceIds.delete('ws-3');
    const { rerender } = render(WorkspaceTabStrip, {
      props: { activeWorkspaceId: 'ws-1' },
    });

    const flareOpacity = (tab: Element) =>
      Array.from(
        tab.querySelectorAll<SVGElement>(
          '[data-workspace-tab-leading-flare], [data-workspace-tab-trailing-flare]',
        ),
      ).map((flare) => getComputedStyle(flare).opacity);

    const tablist = screen.getByRole('tablist', {
      name: m.layout_workspaceTabStrip_openSpaces_ariaLabel(),
    });
    const firstTab = document.querySelector('[data-workspace-tab="ws-1"]')!;
    expect(getComputedStyle(tablist).paddingLeft).toBe('16px');
    expect(getComputedStyle(tablist).marginLeft).toBe('8px');
    expect(tablist.className).not.toContain('-ml-1');
    expect(tablist.className).not.toContain('-ml-3');
    expect(firstTab.hasAttribute('data-workspace-tab-leading-shape')).toBe(false);
    expect(firstTab.classList).toContain('rounded-t-md');
    expect(flareOpacity(firstTab)).toEqual(['1', '1']);
    expect(flareOpacity(document.querySelector('[data-workspace-tab="ws-2"]')!)).toEqual([
      '0',
      '0',
    ]);
    expect(flareOpacity(document.querySelector('[data-workspace-tab="ws-3"]')!)).toEqual([
      '0',
      '0',
    ]);

    await rerender({ activeWorkspaceId: 'ws-2' });
    const secondTab = document.querySelector('[data-workspace-tab="ws-2"]')!;
    expect(firstTab.hasAttribute('data-workspace-tab-leading-shape')).toBe(false);
    expect(secondTab.hasAttribute('data-workspace-tab-leading-shape')).toBe(false);
    expect(secondTab.classList).toContain('rounded-t-md');
    expect(flareOpacity(firstTab)).toEqual(['0', '0']);
    expect(flareOpacity(secondTab)).toEqual(['1', '1']);

    await rerender({ activeWorkspaceId: 'ws-3' });
    const loadingTab = document.querySelector('[data-workspace-tab="ws-3"]')!;
    expect(flareOpacity(secondTab)).toEqual(['0', '0']);
    expect(flareOpacity(loadingTab)).toEqual(['1', '1']);

    await rerender({ activeWorkspaceId: 'ws-1' });
    expect(firstTab.classList).toContain('rounded-t-md');
    expect(flareOpacity(firstTab)).toEqual(['1', '1']);
    expect(flareOpacity(loadingTab)).toEqual(['0', '0']);
  });

  it('refreshes the active-tab border bounds when title-bar positioning changes', async () => {
    const onActiveTabBoundsChange = vi.fn();
    const { container, rerender } = render(WorkspaceTabStrip, {
      props: { activeWorkspaceId: 'ws-1', onActiveTabBoundsChange },
    });
    container.classList.add('window-title-bar');
    const strip = screen.getByRole('tablist', {
      name: m.layout_workspaceTabStrip_openSpaces_ariaLabel(),
    });
    const activeTab = document.querySelector<HTMLElement>('[data-workspace-tab="ws-1"]')!;
    strip.getBoundingClientRect = () => makeRect(0, 20, 500);
    activeTab.getBoundingClientRect = () => makeRect(100);
    onActiveTabBoundsChange.mockClear();

    await rerender({
      activeWorkspaceId: 'ws-1',
      onActiveTabBoundsChange,
      horizontalPositionTrackingKey: 288,
    });

    expect(onActiveTabBoundsChange).toHaveBeenCalledWith({
      left: 100,
      width: 160,
      fadeRight: { start: 476, end: 500 },
    });
  });

  it('changes the observable leading inset while preserving flare clearance', async () => {
    const { rerender } = render(WorkspaceTabStrip, { props: { leadingInsetPx: 15 } });
    const tablist = screen.getByRole('tablist', {
      name: m.layout_workspaceTabStrip_openSpaces_ariaLabel(),
    });

    expect(getComputedStyle(tablist).paddingLeft).toBe('6px');
    expect(getComputedStyle(tablist).transitionDuration).toBe('200ms');

    await rerender({ leadingInsetPx: 28 });
    expect(getComputedStyle(tablist).paddingLeft).toBe('16px');

    await rerender({ leadingInsetPx: 4 });
    expect(getComputedStyle(tablist).paddingLeft).toBe('6px');
  });

  it('keeps the close control outside the hover trigger and isolated from navigation', async () => {
    render(WorkspaceTabStrip);
    const close = screen.getByRole('button', { name: 'Close Beta' });
    expect(close.closest('[data-tooltip-delay]')).toBeNull();

    await fireEvent.click(close);

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/closeWorkspaceTab',
      payload: ['ws-2', expect.any(Number)],
    });
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('isolates loading-tab Close from activation and closes exactly once', async () => {
    mocks.loadedWorkspaceIds.delete('ws-3');
    render(WorkspaceTabStrip);
    const loadingSurface = document.querySelector('[data-workspace-tab="ws-3"]')!;
    const close = screen.getByRole('button', { name: 'Close ws-3' });

    expect(close.parentElement).toBe(loadingSurface);
    expect(close.className).toContain('absolute right-1 z-10');
    await fireEvent.click(close);

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/closeWorkspaceTab',
      payload: ['ws-3', expect.any(Number)],
    });
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('opens context actions for hydrated and loading workspace tabs', async () => {
    mocks.loadedWorkspaceIds.delete('ws-3');
    render(WorkspaceTabStrip);

    await fireEvent.contextMenu(screen.getByRole('tab', { name: /Beta/ }));
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Close all others' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Close tabs to the right' })).toBeTruthy();

    await fireEvent.mouseDown(document.body);
    await fireEvent.contextMenu(screen.getByRole('tab', { name: 'Loading workspace ws-3' }));
    expect(
      (screen.getByRole('menuitem', { name: 'Close tabs to the right' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('closes other workspace tabs in order and focuses the context target', async () => {
    render(WorkspaceTabStrip);
    await fireEvent.contextMenu(screen.getByRole('tab', { name: /Beta/ }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Close all others' }));

    expect(mocks.dispatch.mock.calls).toEqual([
      [{ type: 'tabState/openWorkspaceTab', payload: ['ws-2'] }],
      [{ type: 'tabState/closeWorkspaceTab', payload: ['ws-1', expect.any(Number)] }],
      [{ type: 'tabState/closeWorkspaceTab', payload: ['ws-3', expect.any(Number)] }],
    ]);
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-2');
  });

  it('closes only tabs to the right and routes to the surviving current tab', async () => {
    render(WorkspaceTabStrip);
    await fireEvent.contextMenu(screen.getByRole('tab', { name: /Alpha/ }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Close tabs to the right' }));

    expect(mocks.dispatch.mock.calls).toEqual([
      [{ type: 'tabState/closeWorkspaceTab', payload: ['ws-2', expect.any(Number)] }],
      [{ type: 'tabState/closeWorkspaceTab', payload: ['ws-3', expect.any(Number)] }],
    ]);
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1');
  });

  it('keeps open workspace tabs visually inactive outside a workspace route', () => {
    render(WorkspaceTabStrip, { props: { activeWorkspaceId: null } });

    expect(
      screen.getAllByRole('tab').every((tab) => tab.getAttribute('aria-selected') === 'false'),
    ).toBe(true);
    expect(
      Array.from(document.querySelectorAll('[data-workspace-tab]')).every(
        (tab) => tab.getAttribute('data-active') === 'false',
      ),
    ).toBe(true);
  });

  it('swaps the launcher-side negative margin for spacing only while tabs overflow', async () => {
    const resizeCallbacks: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );

    render(WorkspaceTabStrip);
    const strip = screen.getByRole('tablist', {
      name: m.layout_workspaceTabStrip_openSpaces_ariaLabel(),
    });
    expect(strip.className).toContain('-mr-2.5');
    expect(strip.className).not.toMatch(/(?:^|\s)mr-1(?:\s|$)/);

    Object.defineProperty(strip, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(strip, 'clientWidth', { value: 300, configurable: true });
    resizeCallbacks.forEach((callback) => callback());
    await waitFor(() => expect(strip.className).toMatch(/(?:^|\s)mr-1(?:\s|$)/));
    expect(strip.className).not.toContain('-mr-2.5');

    Object.defineProperty(strip, 'clientWidth', { value: 600, configurable: true });
    resizeCallbacks.forEach((callback) => callback());
    await waitFor(() => expect(strip.className).toContain('-mr-2.5'));
    expect(strip.className).not.toMatch(/(?:^|\s)mr-1(?:\s|$)/);
  });

  it('scrolls a newly active final tab fully inside the strip', async () => {
    const { rerender } = render(WorkspaceTabStrip, { props: { activeWorkspaceId: 'ws-1' } });
    const strip = screen.getByRole('tablist', {
      name: m.layout_workspaceTabStrip_openSpaces_ariaLabel(),
    });
    const finalTab = document.querySelector<HTMLElement>('[data-workspace-tab="ws-3"]')!;
    Object.defineProperty(strip, 'scrollLeft', { value: 0, writable: true });
    strip.getBoundingClientRect = () => ({ left: 100, right: 400, width: 300 }) as DOMRect;
    finalTab.getBoundingClientRect = () => ({ left: 350, right: 420, width: 70 }) as DOMRect;

    await rerender({ activeWorkspaceId: 'ws-3' });

    expect(strip.scrollLeft).toBe(22);
  });

  it('does not clamp scrollLeft back to the active tab on user scroll', async () => {
    const onActiveTabBoundsChange = vi.fn();
    const { container } = render(WorkspaceTabStrip, {
      props: { activeWorkspaceId: 'ws-1', onActiveTabBoundsChange },
    });
    container.classList.add('window-title-bar');
    const strip = screen.getByRole('tablist', {
      name: m.layout_workspaceTabStrip_openSpaces_ariaLabel(),
    });
    const activeTab = document.querySelector<HTMLElement>('[data-workspace-tab="ws-1"]')!;
    Object.defineProperty(strip, 'scrollLeft', { value: 120, writable: true });
    strip.getBoundingClientRect = () => ({ left: 100, right: 400, width: 300 }) as DOMRect;
    // Active tab scrolled out past the strip's left edge by the user.
    activeTab.getBoundingClientRect = () => ({ left: 20, right: 90, width: 70 }) as DOMRect;
    onActiveTabBoundsChange.mockClear();

    await fireEvent.scroll(strip);

    expect(strip.scrollLeft).toBe(120);
    expect(onActiveTabBoundsChange).toHaveBeenCalledWith(null);
  });

  it('uses arrow keys to activate adjacent tabs and Delete to close the focused tab', async () => {
    render(WorkspaceTabStrip);
    const alpha = screen.getByRole('tab', { name: /Alpha/ });
    const beta = screen.getByRole('tab', { name: /Beta/ });
    const gamma = screen.getByRole('tab', { name: /Gamma/ });

    expect(alpha.tabIndex).toBe(0);
    expect(beta.tabIndex).toBe(-1);
    expect(gamma.tabIndex).toBe(-1);

    await fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-2'],
    });
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-2');

    mocks.dispatch.mockClear();
    mocks.goto.mockClear();
    await fireEvent.keyDown(alpha, { key: 'End' });
    expect(document.activeElement).toBe(gamma);
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-3');

    mocks.dispatch.mockClear();
    mocks.goto.mockClear();
    await fireEvent.keyDown(gamma, { key: 'Home' });
    expect(document.activeElement).toBe(alpha);
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1');

    await fireEvent.keyDown(alpha, { key: 'Delete' });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/closeWorkspaceTab',
      payload: ['ws-1', expect.any(Number)],
    });
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-2');
  });

  it('supports keyboard reordering in both directions without moving past endpoints', async () => {
    render(WorkspaceTabStrip);
    const alpha = screen.getByRole('tab', { name: /Alpha/ });
    const gamma = screen.getByRole('tab', { name: /Gamma/ });

    await fireEvent.keyDown(alpha, { key: 'ArrowLeft', altKey: true, shiftKey: true });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tabState/moveWorkspace' }),
    );

    await fireEvent.keyDown(alpha, { key: 'ArrowRight', altKey: true, shiftKey: true });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/moveWorkspace',
      payload: ['ws-1', 'ws-2', 'after'],
    });
    expect(document.activeElement).toBe(alpha);

    mocks.dispatch.mockClear();
    await fireEvent.keyDown(gamma, { key: 'ArrowLeft', altKey: true, shiftKey: true });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/moveWorkspace',
      payload: ['ws-3', 'ws-2', 'before'],
    });
    expect(document.activeElement).toBe(gamma);

    mocks.dispatch.mockClear();
    await fireEvent.keyDown(gamma, { key: 'ArrowRight', altKey: true, shiftKey: true });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tabState/moveWorkspace' }),
    );
  });

  it('announces, focuses, and reveals a workspace tab moved by a global shortcut', async () => {
    render(WorkspaceTabStrip);
    const beta = screen.getByRole('tab', { name: /Beta/ });
    beta.scrollIntoView = vi.fn();

    window.dispatchEvent(
      new CustomEvent(WORKSPACE_TAB_MOVED_EVENT, {
        detail: { workspaceId: 'ws-2', position: 1 },
      }),
    );

    await waitFor(() => expect(document.activeElement).toBe(beta));
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
      m.layout_workspaceTabStrip_reorderAnnouncement({ name: 'Beta', position: 1 }),
    );
    expect(beta.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('tracks every horizontal pointer move and keeps activation unchanged', async () => {
    render(WorkspaceTabStrip);
    setTabGeometry();
    mocks.dispatch.mockClear();
    const source = document.querySelector<HTMLElement>('[data-workspace-tab="ws-1"]')!;
    const tab = tabButton(source);
    const strip = screen.getByRole('tablist', {
      name: m.layout_workspaceTabStrip_openSpaces_ariaLabel(),
    });

    expect(tab.className).toContain('cursor-pointer');
    expect(source.className).toContain('cursor-pointer');
    expect(source.querySelector<HTMLElement>('[data-workspace-tab-close]')!.className).toContain(
      'cursor-pointer',
    );

    await fireEvent(tab, makePointerEvent('pointerdown', 80));
    expect(tab.className).not.toContain('cursor-grabbing');
    await fireEvent(tab, makePointerEvent('pointermove', 82));
    expect(source.className).not.toContain('fixed');
    expect(strip.className).not.toContain('cursor-grabbing');
    await fireEvent(tab, makePointerEvent('pointermove', 88));
    expect(source.className).toContain('fixed');
    expect(source.className).toContain('border-b-0');
    expect(source.className).toContain('shadow-none');
    expect(source.className).not.toContain('shadow-lg');
    expect(strip.className).toContain('cursor-grabbing');
    expect(source.style.left).toBe('8px');
    expect(source.style.top).toBe('18px');
    const reservedSlot = document.querySelector<HTMLElement>(
      '[data-workspace-tab-placeholder="ws-1"]',
    );
    expect(reservedSlot).toBeTruthy();
    expect(reservedSlot!.className).toContain('invisible');
    expect(reservedSlot!.className).not.toMatch(/border|bg-|outline/);

    await fireEvent(tab, makePointerEvent('pointermove', 120, -900));
    expect(source.style.left).toBe('40px');
    expect(source.style.top).toBe('18px');

    await fireEvent(tab, makePointerEvent('pointermove', 250, 900));

    expect(source.style.left).toBe('170px');
    expect(source.style.top).toBe('18px');
    expect(renderedTabOrder()).toEqual(['ws-2', 'ws-1', 'ws-3']);
    expect(
      document
        .querySelector('[data-workspace-tab-placeholder="ws-1"]')
        ?.parentElement?.getAttribute('data-workspace-tab-motion'),
    ).toBe('ws-1');
    expect(document.querySelector('[data-workspace-stack-preview]')).toBeNull();
    expect(
      mocks.dispatch.mock.calls.some(([action]) => action.type === 'tabState/moveWorkspace'),
    ).toBe(false);
    expect(
      mocks.dispatch.mock.calls.some(([action]) => action.type === 'tabState/openWorkspaceTab'),
    ).toBe(false);
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens a tab once when pointer movement stays below the drag threshold', async () => {
    render(WorkspaceTabStrip);
    setTabGeometry();
    mocks.dispatch.mockClear();
    const source = document.querySelector<HTMLElement>('[data-workspace-tab="ws-1"]')!;

    await fireEvent(tabButton(source), makePointerEvent('pointerdown', 80));
    await fireEvent(tabButton(source), makePointerEvent('pointermove', 82));
    await fireEvent(tabButton(source), makePointerEvent('pointerup', 82));

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-1'],
    });
    expect(mocks.goto).toHaveBeenCalledOnce();
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1');
  });

  it.each([
    ['pending press', 244],
    ['active drag', 430],
  ])('suppresses the browser click after Escape cancels a %s', async (_state, releaseX) => {
    render(WorkspaceTabStrip);
    setTabGeometry();
    const source = document.querySelector<HTMLElement>('[data-workspace-tab="ws-2"]')!;
    const tab = tabButton(source);

    await fireEvent(tab, makePointerEvent('pointerdown', 242));
    if (releaseX > 244) await fireEvent(tab, makePointerEvent('pointermove', releaseX));
    mocks.dispatch.mockClear();
    await fireEvent.keyDown(window, { key: 'Escape' });
    await fireEvent(tab, makePointerEvent('pointerup', releaseX));
    await fireEvent.click(tab, { detail: 1 });

    expect(renderedTabOrder()).toEqual(['ws-1', 'ws-2', 'ws-3']);
    expect(document.querySelector('[data-workspace-tab-placeholder]')).toBeNull();
    expect(
      screen.getByRole('tablist', { name: m.layout_workspaceTabStrip_openSpaces_ariaLabel() })
        .className,
    ).not.toContain('cursor-grabbing');
    expect(
      mocks.dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) =>
          ['tabState/openWorkspaceTab', 'tabState/moveWorkspace'].includes(action.type),
        ),
    ).toEqual([]);
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true');
    expect(tab.getAttribute('aria-selected')).toBe('false');
  });

  it('uses the pointer-down grab offset after crossing the movement threshold', async () => {
    render(WorkspaceTabStrip);
    setTabGeometry();
    const source = document.querySelector<HTMLElement>('[data-workspace-tab="ws-1"]')!;

    await fireEvent(tabButton(source), makePointerEvent('pointerdown', 30));
    await fireEvent(tabButton(source), makePointerEvent('pointermove', 100));
    expect(source.style.left).toBe('70px');
  });

  it('auto-scrolls an overflowing strip at both pointer edges without persisting', async () => {
    render(WorkspaceTabStrip);
    setTabGeometry();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const runFrames = (count: number) => {
      for (let index = 0; index < count; index += 1) frames.shift()?.(0);
    };
    const strip = screen.getByRole('tablist', {
      name: m.layout_workspaceTabStrip_openSpaces_ariaLabel(),
    });
    const source = document.querySelector<HTMLElement>('[data-workspace-tab="ws-2"]')!;
    Object.defineProperties(strip, {
      scrollLeft: { value: 100, writable: true },
      scrollWidth: { value: 800 },
      clientWidth: { value: 300 },
    });
    strip.getBoundingClientRect = () => makeRect(0, 0, 300);

    await fireEvent(tabButton(source), makePointerEvent('pointerdown', 242));
    mocks.dispatch.mockClear();
    await fireEvent(tabButton(source), makePointerEvent('pointermove', 295));
    runFrames(4);
    const rightEdgeScroll = strip.scrollLeft;
    expect(rightEdgeScroll).toBeGreaterThan(100);

    await fireEvent(tabButton(source), makePointerEvent('pointermove', 5));
    runFrames(3);
    expect(strip.scrollLeft).toBeLessThan(rightEdgeScroll);
    expect(
      mocks.dispatch.mock.calls.some(([action]) => action.type === 'tabState/moveWorkspace'),
    ).toBe(false);
  });

  it('persists only the released order and leaves the dropped tab at that slot', async () => {
    render(WorkspaceTabStrip);
    setTabGeometry();
    const source = document.querySelector<HTMLElement>('[data-workspace-tab="ws-1"]')!;

    await fireEvent(tabButton(source), makePointerEvent('pointerdown', 80));
    mocks.dispatch.mockClear();
    await fireEvent(tabButton(source), makePointerEvent('pointermove', 430));
    await fireEvent(tabButton(source), makePointerEvent('pointerup', 430));

    expect(mocks.dispatch).not.toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: expect.any(Array),
    });
    expect(mocks.goto).not.toHaveBeenCalled();
    const moveActions = mocks.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === 'tabState/moveWorkspace');
    expect(moveActions).toEqual([
      {
        type: 'tabState/moveWorkspace',
        payload: ['ws-1', 'ws-3', 'after'],
      },
    ]);
    expect(screen.getByText('Moved Alpha to position 3')).toBeTruthy();
    expect(renderedTabOrder()).toEqual(['ws-2', 'ws-3', 'ws-1']);
    expect(source.className).not.toContain('fixed');
    expect(source.className).toContain('border-b-0');
    expect(source.className).toContain('shadow-none');
    expect(source.className).not.toContain('shadow-lg');
    expect(source.className).not.toContain(
      'transition-[background-color,border-color,box-shadow,opacity,transform]',
    );
    expect(source.style.left).toBe('');
    expect(document.querySelector('[data-workspace-tab-placeholder]')).toBeNull();
    expect(
      screen.getByRole('tablist', { name: m.layout_workspaceTabStrip_openSpaces_ariaLabel() })
        .className,
    ).not.toContain('cursor-grabbing');
  });

  it('moves the final tab to the first endpoint with one persisted action', async () => {
    render(WorkspaceTabStrip);
    setTabGeometry();
    const source = document.querySelector<HTMLElement>('[data-workspace-tab="ws-3"]')!;

    await fireEvent(tabButton(source), makePointerEvent('pointerdown', 404));
    mocks.dispatch.mockClear();
    await fireEvent(tabButton(source), makePointerEvent('pointermove', -20));
    expect(renderedTabOrder()).toEqual(['ws-3', 'ws-1', 'ws-2']);

    await fireEvent(tabButton(source), makePointerEvent('pointerup', -20));

    expect(
      mocks.dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'tabState/moveWorkspace'),
    ).toEqual([
      {
        type: 'tabState/moveWorkspace',
        payload: ['ws-3', 'ws-1', 'before'],
      },
    ]);
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('restores the original order without persistence when the drag is cancelled', async () => {
    render(WorkspaceTabStrip);
    setTabGeometry();
    const source = document.querySelector<HTMLElement>('[data-workspace-tab="ws-1"]')!;

    await fireEvent(tabButton(source), makePointerEvent('pointerdown', 80));
    mocks.dispatch.mockClear();
    await fireEvent(tabButton(source), makePointerEvent('pointermove', 430));
    expect(renderedTabOrder()).toEqual(['ws-2', 'ws-3', 'ws-1']);

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(renderedTabOrder()).toEqual(['ws-1', 'ws-2', 'ws-3']);
    expect(document.querySelector('[data-workspace-tab-placeholder]')).toBeNull();
    expect(source.className).toContain('border-b-0');
    expect(source.className).toContain('shadow-none');
    expect(source.className).not.toContain('shadow-lg');
    expect(
      screen.getByRole('tablist', { name: m.layout_workspaceTabStrip_openSpaces_ariaLabel() })
        .className,
    ).not.toContain('cursor-grabbing');
    expect(
      mocks.dispatch.mock.calls.some(([action]) => action.type === 'tabState/moveWorkspace'),
    ).toBe(false);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'tabState/endDrag', payload: [] });
  });

  it('keeps keyboard focus perceivable without a perimeter outline, ring, or focus-only shadow', () => {
    mocks.loadedWorkspaceIds.delete('ws-3');
    render(WorkspaceTabStrip);

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('outline-none');
      expect(tab.className).not.toMatch(/focus-visible:(?:ring|outline|shadow)/);
    }
    expect(
      screen.getByRole('tab', { name: /Alpha/ }).querySelector('[data-workspace-tab-title]'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('tab', { name: 'Loading workspace ws-3' })
        .hasAttribute('data-workspace-tab-loading-target'),
    ).toBe(true);
    expect(
      screen
        .getByRole('tab', { name: 'Loading workspace ws-3' })
        .querySelector('[data-workspace-tab-loading-indicator]'),
    ).toBeTruthy();
    for (const close of screen.getAllByRole('button', { name: /Close/ })) {
      expect(close.hasAttribute('data-workspace-tab-close')).toBe(true);
      expect(close.className).not.toMatch(/focus-visible:(?:ring|outline|shadow)/);
    }
  });

  it('does not expose stacked drop states at any vertical pointer position', async () => {
    render(WorkspaceTabStrip);
    setTabGeometry();
    const source = document.querySelector<HTMLElement>('[data-workspace-tab="ws-1"]')!;

    await fireEvent(tabButton(source), makePointerEvent('pointerdown', 80));
    await fireEvent(tabButton(source), makePointerEvent('pointermove', 250, -500));
    await fireEvent(tabButton(source), makePointerEvent('pointermove', 250, 500));

    expect(document.querySelector('[data-workspace-drop-placement]')).toBeNull();
    expect(document.querySelector('[data-workspace-stack-preview]')).toBeNull();
    expect(source.style.top).toBe('18px');
  });
});
