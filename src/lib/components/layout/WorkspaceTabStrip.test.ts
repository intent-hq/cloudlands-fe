/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceTabStatus } from '$store/renderer/slices/hud/hud-types';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  goto: vi.fn(() => Promise.resolve()),
  nextCurrentId: 'ws-2',
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
  selectWorkspaceTabOrder: () => readable(['ws-1', 'ws-2', 'ws-3']),
  selectWorkspaceViewMode: () => readable('single'),
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
        },
        { id: 'ws-2', title: 'Beta', branch: 'main', repositoryName: 'intent' },
        { id: 'ws-3', title: 'Gamma', branch: 'release', repositoryName: 'intent' },
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
vi.mock('$features/agent/components/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('../workspace/__tests__/mocks/MockAugieAvatar.svelte')).default,
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

describe('WorkspaceTabStrip', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.goto.mockClear();
    mocks.nextCurrentId = 'ws-2';
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
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
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
    expect(hydrated.querySelector('[data-workspace-tab-status="running"]')).toBeTruthy();
    expect(hydrated.querySelector('[data-workspace-tab-title]')?.textContent).toBe('Alpha');
  });

  it('activates exactly once from the title, status icon, padding, trailing background, and loading surface', async () => {
    mocks.loadedWorkspaceIds.delete('ws-3');
    render(WorkspaceTabStrip);

    const alpha = screen.getByRole('tab', { name: /Alpha/ });
    const statusIcon = alpha.querySelector('[data-workspace-tab-status="running"]')!;
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

  it('keeps the trailing close reservation when a workspace has no status', () => {
    mocks.tabStatuses = {};
    render(WorkspaceTabStrip);
    for (const tab of screen.getAllByRole('tab')) {
      const controls = tab.querySelector('[data-workspace-tab-controls]');
      if (!controls) continue;
      expect(controls.querySelector('[data-workspace-tab-status-cluster]')).toBeNull();
      expect(controls.children).toHaveLength(1);
      expect(controls.firstElementChild?.hasAttribute('data-workspace-tab-close-space')).toBe(true);
    }
  });

  it('renders only the highest-priority status as a circle while announcing every status', () => {
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
    const statuses = tab.querySelectorAll('[data-workspace-tab-status]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].getAttribute('data-workspace-tab-status')).toBe('question');
    expect(statuses[0].getAttribute('data-workspace-status-icon')).toBe('circle');
    expect(statuses[0].className).toContain('text-warning');
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
    expect(loadingTab.classList).toContain('border-b-transparent');
    expect(loadingTab.classList).toContain('bg-sidebar');
    expect(loadingTab.classList).not.toContain('shadow-xs');
    expect(loadingTab.classList).not.toContain('backdrop-blur-xl');
    expect(placeholder.classList).toContain('bg-sidebar-foreground/10');
  });

  it('renders accessible tabs with delayed shared workspace hover cards', async () => {
    render(WorkspaceTabStrip);

    expect(screen.getByRole('tablist', { name: 'Open spaces' })).toBeTruthy();
    // pl-3 preserves the 12px corner-flare clip guard; -ml-1 (not -ml-3) keeps
    // an 8px net inset so the first tab sits clear of the view-mode toggle.
    expect(screen.getByRole('tablist', { name: 'Open spaces' }).className).toContain(
      'pl-3 -ml-1 pr-3',
    );
    expect(screen.getByRole('tablist', { name: 'Open spaces' }).className).toContain('-mr-2.5');
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    const alpha = screen.getByRole('tab', { name: /Alpha/ });
    expect(alpha.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-tooltip-delay="500"]')).toBeTruthy();
    const tooltipRoot = alpha.closest<HTMLElement>('[data-testid="workspace-tab-tooltip-root"]')!;
    await fireEvent.mouseEnter(tooltipRoot);
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

    await fireEvent.mouseLeave(tooltipRoot);
    await waitFor(() => expect(screen.queryByTestId('workspace-tab-preview')).toBeNull());
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
    const strip = screen.getByRole('tablist', { name: 'Open spaces' });
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
    const strip = screen.getByRole('tablist', { name: 'Open spaces' });
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
    const strip = screen.getByRole('tablist', { name: 'Open spaces' });
    const activeTab = document.querySelector<HTMLElement>('[data-workspace-tab="ws-1"]')!;
    Object.defineProperty(strip, 'scrollLeft', { value: 120, writable: true });
    strip.getBoundingClientRect = () => ({ left: 100, right: 400, width: 300 }) as DOMRect;
    // Active tab scrolled out past the strip's left edge by the user.
    activeTab.getBoundingClientRect = () => ({ left: 20, right: 90, width: 70 }) as DOMRect;
    onActiveTabBoundsChange.mockClear();

    await fireEvent.scroll(strip);

    expect(strip.scrollLeft).toBe(120);
    expect(onActiveTabBoundsChange).toHaveBeenCalledWith({ left: 20, width: 70 });
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

  it('supports keyboard and pointer drag reordering', async () => {
    render(WorkspaceTabStrip);
    const alpha = screen.getByRole('tab', { name: /Alpha/ });

    await fireEvent.keyDown(alpha, { key: 'ArrowRight', altKey: true, shiftKey: true });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/moveWorkspace',
      payload: ['ws-1', 'ws-2', 'after'],
    });

    mocks.dispatch.mockClear();
    const alphaContainer = document.querySelector('[data-workspace-tab="ws-1"]')!;
    const gammaContainer = document.querySelector('[data-workspace-tab="ws-3"]')!;
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => 'ws-1'),
    };
    await fireEvent.dragStart(alphaContainer, { dataTransfer });
    await fireEvent.dragOver(gammaContainer, { dataTransfer });
    await fireEvent.drop(gammaContainer, { dataTransfer });

    expect(mocks.dispatch).not.toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: expect.any(Array),
    });
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/moveWorkspace',
      payload: ['ws-1', 'ws-3', 'after'],
    });
    expect(screen.getByText('Moved Alpha to position 3')).toBeTruthy();
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

  it('uses the centered top zone to stack a tab above another workspace', async () => {
    render(WorkspaceTabStrip);
    const source = document.querySelector('[data-workspace-tab="ws-1"]')!;
    const target = document.querySelector('[data-workspace-tab="ws-2"]')!;
    const targetRect = { left: 100, top: 100, width: 160, height: 32 } as DOMRect;
    Object.defineProperty(target, 'getBoundingClientRect', { value: () => targetRect });
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => 'ws-1'),
    };
    const dragEvent = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        dataTransfer: { value: dataTransfer },
      });
      return event;
    };

    await fireEvent(source, dragEvent('dragstart', 110, 110));
    await fireEvent(target, dragEvent('dragover', 180, 103));
    expect(target.getAttribute('data-workspace-drop-placement')).toBe('above');
    expect(document.querySelector('[data-workspace-stack-preview="above"]')).toBeTruthy();
    await fireEvent(target, dragEvent('drop', 180, 103));

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/moveWorkspace',
      payload: ['ws-1', 'ws-2', 'above'],
    });
  });
});
