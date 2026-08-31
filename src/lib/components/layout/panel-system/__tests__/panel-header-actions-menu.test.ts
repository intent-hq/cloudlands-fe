/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { SHORTCUTS, formatShortcut } from '$lib/utils/shortcuts';

const panelTabBarSource = readFileSync(
  path.resolve(process.cwd(), 'src/lib/components/layout/panel-system/PanelTabBar.svelte'),
  'utf8',
);

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
  selectAgentProvider: () => readable(undefined),
  selectAgentIsResponding: Object.assign(() => readable(false), { select: () => false }),
  selectAgentIsBlockedWaiting: () => readable(false),
  selectAgentAttentionRequest: () => readable(null),
  selectAgentSession: () => readable(null),
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPendingCount: () => readable(0),
  selectPermissionRequests: () => readable([]),
}));
vi.mock('$store/renderer/slices/hud/hud-selectors', () => ({
  selectHudAgentHasPendingQuestion: () => readable(false),
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
vi.mock('$features/workspace/components/WorkspaceActionsMenu.svelte', async () => ({
  default: (await import('./mocks/MockWorkspaceActionsMenu.svelte')).default,
}));

import PanelTabBar from '../PanelTabBar.svelte';
import { PANE_DRAG_MIME, getDraggedPane, setDraggedPane } from '../panel-drag';

const panelTypes = ['agent', 'note', 'browser', 'terminal', 'changes'] as const;
const contentActions = {
  primary: createRawSnippet(() => ({
    render: () =>
      '<button type="button" aria-label="Content navigation" data-testid="content-primary-action">Content navigation</button>',
  })),
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
      onTabClose: vi.fn(),
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
  setDraggedPane(null);
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
  setDraggedPane(null);
  cleanup();
  vi.unstubAllGlobals();
});

describe('mounted panel header actions menu', () => {
  it('keeps identity left and orders every action at the right edge', () => {
    const onClosePanel = vi.fn();
    const populated = renderHeader('note', {
      tabs: [tab('note'), tab('browser')],
      isRightmostPanel: true,
      onClosePanel,
      onTabClick: vi.fn(),
    });
    const populatedContentActions = populated.container.querySelector(
      '[data-panel-tabless-header] [data-panel-header-content-actions]',
    )!;
    const populatedPanelControls = populated.container.querySelector(
      '[data-panel-tabless-header] [data-panel-header-actions]',
    )!;
    expect(
      Array.from(populatedContentActions.querySelectorAll('button')).map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual(['Content navigation']);
    expect(
      Array.from(populatedPanelControls.querySelectorAll('button')).map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual([
      'Content navigation',
      'More',
      'Show pane list. Total panes: 2.',
      'Add column',
      'Close active pane',
    ]);
    expect(populatedPanelControls.querySelectorAll('[data-panel-controls-divider]')).toHaveLength(
      1,
    );
    expect(
      populatedContentActions.querySelector('[data-panel-content-actions-divider]'),
    ).toBeNull();
    expect(
      populated.container
        .querySelector('[data-panel-header-identity]')!
        .compareDocumentPosition(populatedPanelControls),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const stackTrigger = populatedPanelControls.querySelector<HTMLElement>(
      '[data-pane-stack-selector-trigger]',
    )!;
    expect(stackTrigger).toBeTruthy();
    expect(stackTrigger.textContent?.trim()).toBe('');
    expect(stackTrigger.querySelector('[data-pane-stack-glyph]')).toBeTruthy();
    expect(stackTrigger.querySelector('[data-pane-stack-selector-chevron]')).toBeNull();
    expect(stackTrigger.classList.contains('border-0')).toBe(true);
    expect(stackTrigger.classList.contains('bg-transparent')).toBe(true);
    expect(populatedContentActions.querySelector('[data-pane-stack-selector-trigger]')).toBeNull();
    expect(populated.container.querySelector('[data-panel-column-count-trigger]')).toBeNull();
    populated.unmount();

    const withoutNavigation = renderHeader('note', {
      isRightmostPanel: true,
      contentActions: { display: contentActions.display, actions: contentActions.actions },
    });
    const withoutNavigationContentActions = withoutNavigation.container.querySelector(
      '[data-panel-tabless-header] [data-panel-header-content-actions]',
    );
    const withoutNavigationPanelControls = withoutNavigation.container.querySelector(
      '[data-panel-tabless-header] [data-panel-header-actions]',
    )!;
    expect(
      withoutNavigationPanelControls.querySelectorAll('[data-panel-controls-divider]'),
    ).toHaveLength(1);
    expect(withoutNavigationContentActions).toBeNull();
    expect(
      Array.from(withoutNavigationPanelControls.querySelectorAll('button')).map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual(['More', 'Add column', 'Close active pane']);
    expect(
      withoutNavigationPanelControls.querySelector('[data-pane-stack-selector-trigger]'),
    ).toBeNull();
    withoutNavigation.unmount();

    const empty = render(PanelTabBar, {
      props: {
        tabs: [],
        activeTabId: null,
        panelId: 'panel-empty',
        workspaceId: 'workspace-1',
        isRightmostPanel: true,
        onClosePanel,
      },
    });
    const emptyHeader = empty.container.querySelector('[data-empty-panel-header]')!;
    expect(
      Array.from(emptyHeader.querySelectorAll('button')).map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual(['Add column', 'Close panel']);
    expect(emptyHeader.querySelector('[data-panel-content-actions-divider]')).toBeNull();
    expect(emptyHeader.querySelector('[data-panel-column-count-trigger]')).toBeNull();
  });

  it('opens the neighboring panes from top-level stack actions with shortcut hints', async () => {
    const tabs = [tab('note'), tab('browser'), tab('terminal')];
    const onTabClick = vi.fn();
    const middle = renderHeader('browser', {
      tabs,
      activeTabId: 'browser-tab',
      onTabClick,
    });

    await fireEvent.click(middle.container.querySelector('[data-pane-stack-selector-trigger]')!);
    const above = await screen.findByRole('menuitem', { name: 'Open panel above' });
    const below = screen.getByRole('menuitem', { name: 'Open panel below' });
    expect(above.textContent).toContain(formatShortcut(SHORTCUTS.PREVIOUS_PANE.key));
    expect(below.textContent).toContain(formatShortcut(SHORTCUTS.NEXT_PANE.key));
    expect(above.getAttribute('aria-disabled')).not.toBe('true');
    expect(below.getAttribute('aria-disabled')).not.toBe('true');
    expect(
      above.compareDocumentPosition(screen.getByRole('menuitem', { name: 'note panel' })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.queryByText('Use Up or Down to move, Enter to select, and Escape to close.'),
    ).toBeNull();
    await fireEvent.click(above);
    expect(onTabClick).toHaveBeenCalledWith('note-tab');
    middle.unmount();

    const top = renderHeader('note', { tabs, activeTabId: 'note-tab', onTabClick });
    await fireEvent.click(top.container.querySelector('[data-pane-stack-selector-trigger]')!);
    expect(
      (await screen.findByRole('menuitem', { name: 'Open panel above' })).getAttribute(
        'aria-disabled',
      ),
    ).toBe('true');
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Open panel below' }));
    expect(onTabClick).toHaveBeenLastCalledWith('browser-tab');
    top.unmount();

    const bottom = renderHeader('terminal', {
      tabs,
      activeTabId: 'terminal-tab',
      onTabClick,
    });
    await fireEvent.click(bottom.container.querySelector('[data-pane-stack-selector-trigger]')!);
    expect(
      (await screen.findByRole('menuitem', { name: 'Open panel below' })).getAttribute(
        'aria-disabled',
      ),
    ).toBe('true');
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

  it('opens the same panel actions menu from non-interactive header right-click', async () => {
    const { container } = renderHeader('note');
    const header = container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;
    const trigger = panelTrigger(container);

    await fireEvent.contextMenu(header, { clientX: 40, clientY: 20 });

    const menu = await screen.findByRole('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(menu.querySelector('[data-panel-actions-section="display"]')).toBeTruthy();
    expect(menu.querySelector('[data-panel-actions-section="actions"]')).toBeTruthy();
    expect(menu.querySelector('[data-panel-actions-section="open-in"]')).toBeTruthy();
    expect(screen.getByTestId('content-display-action')).toBeTruthy();
    expect(screen.getByTestId('content-command-action')).toBeTruthy();
  });

  it('sizes the grouped action menu from content within a viewport cap', async () => {
    const { container } = renderHeader('note');

    await fireEvent.click(panelTrigger(container));
    const menu = await screen.findByRole('menu');

    expect(menu.classList).toContain('w-max');
    expect(menu.classList).toContain('panel-actions-menu-content');
    expect(panelTabBarSource).toContain('min-width: min(14rem, calc(100vw - 1rem))');
    expect(panelTabBarSource).toContain('max-width: calc(100vw - 1rem)');
    expect(menu.classList).toContain('[&_[data-slot=menu-command-item]>kbd]:text-muted-foreground');
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
    expect(getDraggedPane()).toBeNull();
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

  it('runs enabled actions once and closes only the active pane', async () => {
    const onZoomToggle = vi.fn();
    const onSplitHorizontal = vi.fn();
    const onMoveLeft = vi.fn();
    const onMoveRight = vi.fn();
    const onMovePaneLeft = vi.fn();
    const onMovePaneRight = vi.fn();
    const onClosePanel = vi.fn();
    const onTabClose = vi.fn();
    const { container } = renderHeader('browser', {
      onZoomToggle,
      onSplitHorizontal,
      onMoveLeft,
      onMoveRight,
      onMovePaneLeft,
      onMovePaneRight,
      onClosePanel,
      onTabClose,
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
    const movePaneLeft = await screen.findByRole('menuitem', { name: 'Move active pane left' });
    expect(movePaneLeft.textContent).toContain(
      formatShortcut(SHORTCUTS.MOVE_PANE_PREVIOUS_COLUMN.key),
    );
    await fireEvent.click(movePaneLeft);
    expect(onMovePaneLeft).toHaveBeenCalledOnce();

    await fireEvent.click(trigger);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Move active pane right' }));
    expect(onMovePaneRight).toHaveBeenCalledOnce();

    await fireEvent.click(trigger);
    const createColumn = await screen.findByRole('menuitem', { name: /Create column to right/i });
    expect(createColumn.textContent).toContain(formatShortcut(SHORTCUTS.CREATE_COLUMN_RIGHT.key));
    await fireEvent.click(createColumn);
    expect(onSplitHorizontal).toHaveBeenCalledOnce();

    await fireEvent.click(trigger);
    expect(screen.queryByRole('menuitem', { name: /Split down/i })).toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSplitHorizontal).toHaveBeenCalledOnce();
    expect(onZoomToggle).toHaveBeenCalledOnce();
    await fireEvent.click(
      container.querySelector('[data-panel-tabless-header] [data-testid="panel-close-button"]')!,
    );
    expect(onTabClose).toHaveBeenCalledOnce();
    expect(onTabClose).toHaveBeenCalledWith('browser-tab');
    expect(onClosePanel).not.toHaveBeenCalled();
  });

  it('shows disabled pane-move commands when no adjacent column exists', async () => {
    const { container } = renderHeader('note');

    await fireEvent.click(panelTrigger(container));

    expect(
      (await screen.findByRole('menuitem', { name: 'Move active pane left' })).getAttribute(
        'aria-disabled',
      ),
    ).toBe('true');
    expect(
      screen
        .getByRole('menuitem', { name: 'Move active pane right' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('rejects a drag from the trigger but keeps blank-header dragging active', async () => {
    const { container } = renderHeader('terminal');
    const trigger = panelTrigger(container);
    const header = container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;

    const triggerDrag = await dragEvent(trigger);
    expect(triggerDrag.event.defaultPrevented).toBe(true);
    expect(getDraggedPane()).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith({ type: 'tabState/startDrag' });

    await fireEvent.dblClick(trigger);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'panelLayout/toggleExpandPanel' }),
    );

    const headerDrag = await dragEvent(header);
    expect(headerDrag.event.defaultPrevented).toBe(false);
    expect(getDraggedPane()).toEqual({ panelId: 'panel-1', tabId: 'terminal-tab' });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'tabState/startDrag' });
    expect(JSON.parse(headerDrag.dataTransfer.getData(PANE_DRAG_MIME))).toEqual({
      panelId: 'panel-1',
      tabId: 'terminal-tab',
    });
  });
});
