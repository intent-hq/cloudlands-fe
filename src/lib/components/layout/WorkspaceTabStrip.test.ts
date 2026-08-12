/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  goto: vi.fn(() => Promise.resolve()),
  nextCurrentId: 'ws-2',
  loadedWorkspaceIds: new Set<string>(),
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

  it('keeps persisted tabs opaque and stationary during initial hydration', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/components/layout/WorkspaceTabStrip.svelte'),
      'utf8',
    );

    expect(source).not.toContain('in:fly');
    expect(source).not.toContain('out:fly');
    expect(source).toContain('animate:flip');
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

  it('renders an accessible tablist with delayed workspace previews', () => {
    render(WorkspaceTabStrip);

    expect(screen.getByRole('tablist', { name: 'Open spaces' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Open spaces' }).className).toContain(
      'pl-3 -ml-3 pr-3 -mr-2.5',
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-tooltip-delay="500"]')).toBeTruthy();
    expect(screen.getByText('Polishing the workspace navigation experience.')).toBeTruthy();
    expect(document.querySelector('[data-workspace-tab-description]')?.className).toContain(
      'leading-4',
    );
    expect(screen.getByLabelText('2 of 5 tasks complete')).toBeTruthy();
    expect(screen.getAllByTestId('mock-avatar')).toHaveLength(2);
    expect(screen.queryByText('feature/alpha')).toBeNull();
    expect(screen.queryByText('Ctrl Tab')).toBeNull();
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

  it('uses arrow keys to activate adjacent tabs and Delete to close the focused tab', async () => {
    render(WorkspaceTabStrip);
    const alpha = screen.getByRole('tab', { name: /Alpha/ });

    await fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-2'],
    });
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-2');

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

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/moveWorkspace',
      payload: ['ws-1', 'ws-3', 'after'],
    });
    expect(screen.getByText('Moved Alpha to position 3')).toBeTruthy();
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
