/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

const mocks = vi.hoisted(() => {
  let columnCount = 2;
  const subscribers = new Set<(value: number) => void>();
  return {
    dispatch: vi.fn(),
    panelColumnCount: {
      subscribe(run: (value: number) => void) {
        subscribers.add(run);
        run(columnCount);
        return () => subscribers.delete(run);
      },
    },
    setPanelColumnCount(value: number) {
      columnCount = value;
      subscribers.forEach((run) => run(value));
    },
  };
});
const readable = <T>(value: T) => ({
  subscribe(run: (current: T) => void) {
    run(value);
    return () => {};
  },
});

vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    state: {
      panelLayout: {
        byWorkspaceId: {
          'workspace-1': {
            root: { type: 'panel', panelId: 'panel-1' },
            panels: {},
            focusedPanelId: 'panel-1',
            layoutHistory: [],
            historyIndex: 0,
          },
        },
      },
    },
  },
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectIsDragging: () => readable(false),
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-slice', () => ({
  startDrag: () => ({ type: 'tabState/startDrag' }),
  endDrag: () => ({ type: 'tabState/endDrag' }),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectPanelColumnCount: () => mocks.panelColumnCount,
  selectRecentlyClosed: () => readable([]),
  selectPanelLayoutWorkspace: {
    select: (state: any) => state.panelLayout.byWorkspaceId['workspace-1'],
  },
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: { select: () => null },
}));
vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  filterPickableSpecialists: (value: unknown[]) => value,
  selectSpecialistName: { select: () => null },
  selectSpecialists: () => readable([]),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => readable(false),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: () => null },
  selectIsWorkspaceHostLocal: () => readable(true),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: () => readable([]),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsResponding: () => readable(false),
  selectAgentIsBlockedWaiting: () => readable(false),
  selectAgentAttentionRequest: () => readable(null),
  selectAgentSession: () => readable(null),
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPermissionRequests: () => readable([]),
}));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAgentAvatar.svelte'))
    .default,
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAgentAvatar.svelte'))
    .default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import PanelTabBar from '../PanelTabBar.svelte';
import { PANEL_DRAG_MIME, getDraggedPanelId, setDraggedPanelId } from '../panel-drag';

const panelTypes = ['agent', 'note', 'browser', 'terminal', 'changes'] as const;
const contentActions = {
  display: createRawSnippet(() => ({
    render: () => '<span data-testid="content-display-action">Content display action</span>',
  })),
  actions: createRawSnippet(() => ({
    render: () => '<span data-testid="content-command-action">Content command action</span>',
  })),
};

function tab(type: (typeof panelTypes)[number]): PanelTab {
  return {
    id: `${type}-tab`,
    type,
    title: `${type} panel`,
    closable: true,
    ...(type === 'agent' ? { agentId: 'agent-1' } : {}),
  } as PanelTab;
}

function renderHeader(type: (typeof panelTypes)[number], props: Record<string, unknown> = {}) {
  const activeTab = tab(type);
  return render(PanelTabBar, {
    props: {
      tabs: [activeTab],
      activeTabId: activeTab.id,
      panelId: 'panel-1',
      workspaceId: 'workspace-1',
      contentActions,
      ...props,
    },
  });
}

function panelTrigger(container: HTMLElement): HTMLButtonElement {
  return container.querySelector(
    '[data-panel-tabless-header] [data-testid="panel-actions-trigger"]',
  )!;
}

function dragEvent(target: Element) {
  const data = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: 'none',
    dropEffect: 'none',
    types: [],
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    setDragImage: vi.fn(),
  };
  const event = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return fireEvent(target, event).then(() => ({ event, dataTransfer }));
}

beforeEach(() => {
  mocks.dispatch.mockClear();
  mocks.setPanelColumnCount(2);
  setDraggedPanelId(null);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  setDraggedPanelId(null);
  cleanup();
  vi.unstubAllGlobals();
});

describe('mounted panel header actions menu', () => {
  it('renders the workspace column selector only for the rightmost panel and dispatches its count', async () => {
    const left = renderHeader('note', { panelId: 'panel-left', isRightmostPanel: false });
    expect(left.container.querySelector('[data-panel-column-count-trigger]')).toBeNull();
    left.unmount();

    const { container } = renderHeader('note', { isRightmostPanel: true });
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-panel-column-count-trigger]',
    )!;
    expect(trigger.getAttribute('aria-label')).toBe('Panel columns: 2');
    expect(trigger.querySelector('[data-icon="table-columns"]')).toBeNull();
    expect(trigger.querySelector('[data-panel-column-icon="2"]')).toBeTruthy();

    await fireEvent.click(trigger);
    const radios = await screen.findAllByRole('menuitemradio');
    expect(radios).toHaveLength(4);
    expect(
      screen.getByRole('menuitemradio', { name: '2 columns' }).getAttribute('aria-checked'),
    ).toBe('true');
    await fireEvent.click(screen.getByRole('menuitemradio', { name: '4 columns' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'panelLayout/setPanelColumnCount',
      payload: expect.objectContaining({
        wsId: 'workspace-1',
        count: 4,
        newPanelIds: expect.arrayContaining([
          expect.any(String),
          expect.any(String),
          expect.any(String),
        ]),
      }),
    });
  });

  it('renders one equal bar per selected count and reacts to selector updates', async () => {
    const { container } = renderHeader('note', { isRightmostPanel: true });
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-panel-column-count-trigger]',
    )!;

    let previousIcon: Element | null = null;
    for (const count of [1, 2, 3, 4]) {
      mocks.setPanelColumnCount(count);
      await waitFor(() =>
        expect(trigger.querySelector(`[data-panel-column-icon="${count}"]`)).toBeTruthy(),
      );
      expect(trigger.getAttribute('aria-label')).toBe(`Panel columns: ${count}`);
      const icon = trigger.querySelector(`[data-panel-column-icon="${count}"]`)!;
      expect(icon).not.toBe(previousIcon);
      expect(previousIcon?.isConnected ?? false).toBe(false);
      expect(icon.getAttribute('stroke-width')).toBe('1');
      expect(icon.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      const bars = Array.from(icon.querySelectorAll('[data-panel-column-icon-bar]'));
      expect(bars).toHaveLength(count);
      expect(
        bars.map((bar) => [
          bar.getAttribute('width'),
          bar.getAttribute('height'),
          bar.getAttribute('stroke-width'),
          bar.getAttribute('vector-effect'),
        ]),
      ).toEqual(Array.from({ length: count }, () => ['4', '14', '1', 'non-scaling-stroke']));
      previousIcon = icon;
    }
  });

  it.each(panelTypes)('opens one portalled menu from one click for the %s panel', async (type) => {
    const { container } = renderHeader(type);
    const header = container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;
    header.style.width = '240px';
    header.style.zoom = '2';
    header.style.overflow = 'hidden';
    const trigger = panelTrigger(container);

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(trigger);

    const menu = await screen.findByRole('menu');
    await Promise.resolve();
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(container.contains(menu)).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('content-display-action')).toBeTruthy();
    expect(screen.getByTestId('content-command-action')).toBeTruthy();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'panelLayout/toggleExpandPanel' }),
    );
  });

  it.each(
    panelTypes.flatMap(
      (type) =>
        [
          ['Enter', type],
          [' ', type],
        ] as const,
    ),
  )('opens with %s for the %s panel without starting a drag', async (key, type) => {
    const { container } = renderHeader(type);
    const trigger = panelTrigger(container);
    trigger.focus();

    await fireEvent.keyDown(trigger, { key });
    await screen.findByRole('menu');

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(getDraggedPanelId()).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith({ type: 'tabState/startDrag' });
  });

  it('restores focus on Escape and dismisses from an outside pointer', async () => {
    const escapeHeader = renderHeader('note');
    const trigger = panelTrigger(escapeHeader.container);
    trigger.focus();
    await fireEvent.click(trigger);
    await fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);

    escapeHeader.unmount();
    const outsideHeader = renderHeader('note');
    const outsideTrigger = panelTrigger(outsideHeader.container);
    await fireEvent.click(outsideTrigger);
    await screen.findByRole('menu');
    await fireEvent.pointerDown(document.body, {
      button: 0,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(outsideTrigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('runs enabled actions once, keeps disabled items inert, and preserves close behavior', async () => {
    const onZoomToggle = vi.fn();
    const onSplitHorizontal = vi.fn();
    const onMoveLeft = vi.fn();
    const onMoveRight = vi.fn();
    const onClosePanel = vi.fn();
    const { container } = renderHeader('browser', {
      onZoomToggle,
      onSplitHorizontal,
      onMoveLeft,
      onMoveRight,
      onClosePanel,
    });
    const trigger = panelTrigger(container);

    await fireEvent.click(trigger);
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Zoom Panel/i }));
    expect(onZoomToggle).toHaveBeenCalledOnce();

    await fireEvent.click(trigger);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Move left' }));
    expect(onMoveLeft).toHaveBeenCalledOnce();

    await fireEvent.click(trigger);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Move right' }));
    expect(onMoveRight).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await fireEvent.click(trigger);
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Split right/i }));
    expect(onSplitHorizontal).toHaveBeenCalledOnce();

    await fireEvent.click(trigger);
    const disabled = await screen.findByRole('menuitem', { name: /Split down/i });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(disabled);
    expect(onSplitHorizontal).toHaveBeenCalledOnce();
    expect(onZoomToggle).toHaveBeenCalledOnce();
    await fireEvent.click(
      container.querySelector('[data-panel-tabless-header] [data-testid="panel-close-button"]')!,
    );
    expect(onClosePanel).toHaveBeenCalledOnce();
  });

  it('rejects a drag from the trigger but keeps blank-header dragging active', async () => {
    const { container } = renderHeader('terminal');
    const trigger = panelTrigger(container);
    const header = container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;

    const triggerDrag = await dragEvent(trigger);
    expect(triggerDrag.event.defaultPrevented).toBe(true);
    expect(getDraggedPanelId()).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith({ type: 'tabState/startDrag' });

    await fireEvent.dblClick(trigger);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'panelLayout/toggleExpandPanel' }),
    );

    const headerDrag = await dragEvent(header);
    expect(headerDrag.event.defaultPrevented).toBe(false);
    expect(getDraggedPanelId()).toBe('panel-1');
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'tabState/startDrag' });
    expect(headerDrag.dataTransfer.getData(PANEL_DRAG_MIME)).toContain('panel-1');
  });
});
