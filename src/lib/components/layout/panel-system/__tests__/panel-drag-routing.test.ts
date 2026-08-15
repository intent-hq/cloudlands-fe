/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelState, PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {
    panelLayout: {
      byWorkspaceId: {
        'workspace-1': {
          root: { type: 'panel', panelId: 'source-panel' },
          panels: {},
          focusedPanelId: 'source-panel',
          restoreStatus: 'idle',
          pendingFocusTabId: null,
          recentlyClosed: [],
          layoutHistory: [],
          historyIndex: 0,
          historyLoaded: true,
          focusHistory: [],
          focusHistoryIndex: -1,
          expandedPanelId: null,
          savedSizesBeforeExpand: [],
          deferSpecTab: false,
        },
      },
    },
  },
}));
const readable = <T>(value: T) => ({
  subscribe(run: (current: T) => void) {
    run(value);
    return () => {};
  },
});

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch, state: mocks.state },
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectIsDragging: () => readable(true),
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-slice', () => ({
  startDrag: () => ({ type: 'tabState/startDrag' }),
  endDrag: () => ({ type: 'tabState/endDrag' }),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectPanelLayoutWorkspace: {
    select: () => mocks.state.panelLayout.byWorkspaceId['workspace-1'],
  },
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: { select: () => null },
}));
vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  filterSpecialistsByGitHubAuth: (specialists: unknown[]) => specialists,
  filterPickableSpecialists: (specialists: unknown[]) => specialists,
  selectSpecialistName: { select: () => null },
  selectSpecialists: () => readable([]),
}));
vi.mock('$store/renderer/slices/daemon-health/daemon-health-selectors', () => ({
  selectIsDaemonLocal: () => readable(true),
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
vi.mock('../PanelEmptyState.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAgentAvatar.svelte'))
    .default,
}));
vi.mock('../PanelContentRenderer.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAgentAvatar.svelte'))
    .default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import Panel from '../Panel.svelte';
import PanelTabBar from '../PanelTabBar.svelte';
import {
  PANEL_DRAG_MIME,
  getDraggedPanelId,
  getPanelDragPlacement,
  getPanelLayoutEdgePlacement,
  setDraggedPanelId,
} from '../panel-drag';

const TAB_DRAG_MIME = 'application/x-panel-tab';

class TestDataTransfer {
  effectAllowed = 'none';
  dropEffect = 'none';
  private readonly data = new Map<string, string>();
  readonly setDragImage = vi.fn();

  get types() {
    return [...this.data.keys()];
  }

  setData(type: string, value: string) {
    this.data.set(type, value);
  }

  getData(type: string) {
    return this.data.get(type) ?? '';
  }
}

function tab(id: string): PanelTab {
  return { id, type: 'file', title: id, closable: true };
}

function panel(id = 'target-panel', tabs = [tab('one'), tab('two')]): PanelState {
  return { id, tabs, activeTabId: tabs[0]?.id ?? null };
}

function dragEvent(type: string, dataTransfer: TestDataTransfer, clientX = 0, clientY = 20) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}

function renderTabBar(props: Record<string, unknown> = {}) {
  return render(PanelTabBar, {
    props: {
      tabs: [tab('one'), tab('two')],
      activeTabId: 'one',
      panelId: 'target-panel',
      workspaceId: 'workspace-1',
      showTabStrip: true,
      ...props,
    },
  });
}

beforeEach(() => {
  mocks.dispatch.mockClear();
  setDraggedPanelId(null);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  setDraggedPanelId(null);
  cleanup();
  vi.unstubAllGlobals();
});

describe('panel and tab drag MIME routing', () => {
  it('previews a whole-panel move without mutating the layout until drop', async () => {
    const onPanelMove = vi.fn();
    const onPanelMovePreview = vi.fn();
    const { container } = render(Panel, {
      props: {
        panel: panel(),
        workspaceId: 'workspace-1',
        onPanelMove,
        onPanelMovePreview,
      },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
    const targetTab = container.querySelector<HTMLElement>('[data-tab-id="one"]')!;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(PANEL_DRAG_MIME, JSON.stringify({ panelId: 'source-panel' }));
    setDraggedPanelId('source-panel');

    await fireEvent(targetTab, dragEvent('dragover', dataTransfer, 10, 200));
    expect(onPanelMove).not.toHaveBeenCalled();
    expect(onPanelMovePreview).toHaveBeenLastCalledWith('source-panel', 'target-panel', 'before');
    await fireEvent(targetTab, dragEvent('dragover', dataTransfer, 10, 200));
    expect(onPanelMove).not.toHaveBeenCalled();
    expect(container.querySelector('.panel-reorder-indicator')).toBeNull();
    await fireEvent(targetTab, dragEvent('drop', dataTransfer, 10, 200));

    expect(onPanelMove).toHaveBeenCalledOnce();
    expect(onPanelMove).toHaveBeenCalledWith('source-panel', 'before');
  });

  it('keeps the dragged preview visible over its original panel', async () => {
    const onPanelMovePreview = vi.fn();
    const { container } = render(Panel, {
      props: {
        panel: panel('source-panel'),
        workspaceId: 'workspace-1',
        onPanelMove: vi.fn(),
        onPanelMovePreview,
      },
    });
    const sourcePanel = container.querySelector<HTMLElement>('[data-panel-id="source-panel"]')!;
    sourcePanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(PANEL_DRAG_MIME, JSON.stringify({ panelId: 'source-panel' }));
    setDraggedPanelId('source-panel');

    await fireEvent(sourcePanel, dragEvent('dragover', dataTransfer, 20, 200));

    expect(onPanelMovePreview).toHaveBeenLastCalledWith('source-panel', 'source-panel', 'before');
    expect(dataTransfer.dropEffect).toBe('move');
  });

  it('keeps the preview stable across child dragleave events and clears it outside', async () => {
    const onPanelMovePreview = vi.fn();
    const { container } = render(Panel, {
      props: {
        panel: panel(),
        workspaceId: 'workspace-1',
        onPanelMove: vi.fn(),
        onPanelMovePreview,
      },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, right: 400, top: 0, bottom: 400, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(PANEL_DRAG_MIME, JSON.stringify({ panelId: 'source-panel' }));
    setDraggedPanelId('source-panel');

    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, 20, 200));
    await fireEvent(targetPanel, dragEvent('dragleave', dataTransfer, 30, 200));
    expect(onPanelMovePreview).toHaveBeenCalledTimes(1);
    expect(onPanelMovePreview).toHaveBeenLastCalledWith('source-panel', 'target-panel', 'before');

    await fireEvent(targetPanel, dragEvent('dragleave', dataTransfer, 500, 200));
    expect(onPanelMovePreview).toHaveBeenLastCalledWith('source-panel', 'target-panel', null);
  });

  it('uses nearest-edge placement with hysteresis to prevent preview oscillation', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
    expect(getPanelDragPlacement(50, 15, rect)).toBe('above');
    expect(getPanelDragPlacement(15, 50, rect)).toBe('before');
    expect(getPanelDragPlacement(85, 50, rect)).toBe('after');
    expect(getPanelDragPlacement(50, 85, rect)).toBe('below');
    expect(getPanelDragPlacement(46, 50, rect, 'before')).toBe('before');
    expect(getPanelDragPlacement(60, 50, rect, 'before')).toBe('after');
  });

  it('uses predictable stacking bands and horizontal halves', () => {
    const rect = { left: 0, top: 0, width: 400, height: 400 } as DOMRect;
    expect(getPanelDragPlacement(20, 110, rect)).toBe('above');
    expect(getPanelDragPlacement(20, 130, rect)).toBe('before');
    expect(getPanelDragPlacement(380, 200, rect)).toBe('after');
    expect(getPanelDragPlacement(200, 290, rect)).toBe('below');
  });

  it('uses the centered top zone to preview the real stacked layout', async () => {
    const onPanelMove = vi.fn();
    const onPanelMovePreview = vi.fn();
    const { container } = render(Panel, {
      props: {
        panel: panel(),
        workspaceId: 'workspace-1',
        onPanelMove,
        onPanelMovePreview,
      },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(PANEL_DRAG_MIME, JSON.stringify({ panelId: 'source-panel' }));
    setDraggedPanelId('source-panel');

    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, 200, 20));
    expect(onPanelMovePreview).toHaveBeenLastCalledWith('source-panel', 'target-panel', 'above');
    expect(onPanelMove).not.toHaveBeenCalled();
    expect(dataTransfer.dropEffect).toBe('move');

    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, 200, 380));
    expect(onPanelMovePreview).toHaveBeenLastCalledWith('source-panel', 'target-panel', 'below');

    await fireEvent(targetPanel, dragEvent('drop', dataTransfer, 200, 380));

    expect(onPanelMove).toHaveBeenCalledWith('source-panel', 'below');
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'tabState/endDrag' });
  });

  it('commits a whole-panel drop from the mirrored id when the payload is unavailable', async () => {
    const onPanelMove = vi.fn();
    const { container } = render(Panel, {
      props: { panel: panel(), workspaceId: 'workspace-1', onPanelMove },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
    setDraggedPanelId('source-panel');

    await fireEvent(targetPanel, dragEvent('drop', new TestDataTransfer(), 390, 200));

    expect(onPanelMove).toHaveBeenCalledWith('source-panel', 'after');
    expect(getDraggedPanelId()).toBeNull();
  });

  it('keeps a dragged panel opaque and restores its layout when Escape is pressed', async () => {
    const { container } = renderTabBar({ panelId: 'source-panel', layoutId: 'workspace-1' });
    const header = container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;
    const dataTransfer = new TestDataTransfer();

    await fireEvent(header, dragEvent('dragstart', dataTransfer));
    expect(header.className).not.toContain('opacity-60');
    expect(document.querySelector('.panel-drag-source')).toBeNull();
    const dragImage = dataTransfer.setDragImage.mock.calls[0]?.[0] as HTMLElement;
    expect(dragImage.dataset.panelDragImage).toBe('');
    expect(dragImage.textContent).toBe('one');
    expect(dragImage.style.width).toBe('220px');
    expect(getDraggedPanelId()).toBe('source-panel');

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(getDraggedPanelId()).toBeNull();
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'panelLayout/restorePanelDragLayout' }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'tabState/endDrag' });
  });

  it('keeps same-panel tab reordering visuals and drag cleanup', async () => {
    const onTabReorder = vi.fn();
    const { container } = renderTabBar({ onTabReorder });
    const sourceTab = container.querySelector<HTMLElement>('[data-tab-id="one"]')!;
    const targetTab = container.querySelector<HTMLElement>('[data-tab-id="two"]')!;
    targetTab.getBoundingClientRect = () => ({ left: 100, width: 100 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();

    await fireEvent(sourceTab, dragEvent('dragstart', dataTransfer));
    expect(sourceTab.style.opacity).toBe('0.5');
    expect(sourceTab.className).toContain('opacity-50');
    await fireEvent(targetTab, dragEvent('dragover', dataTransfer, 175));
    expect(targetTab.querySelector('.absolute.right-0')).toBeTruthy();
    await fireEvent(targetTab, dragEvent('drop', dataTransfer, 175));
    await fireEvent(sourceTab, dragEvent('dragend', dataTransfer));

    expect(onTabReorder).toHaveBeenCalledWith(0, 1);
    expect(sourceTab.style.opacity).toBe('');
    expect(sourceTab.className).not.toContain('opacity-50');
  });

  it('moves a cross-panel tab at the hovered tab position', async () => {
    const onTabMoveToPanel = vi.fn();
    const { container } = renderTabBar({ onTabMoveToPanel });
    const targetTab = container.querySelector<HTMLElement>('[data-tab-id="one"]')!;
    targetTab.getBoundingClientRect = () => ({ left: 100, width: 100 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(
      TAB_DRAG_MIME,
      JSON.stringify({ tabId: 'source-tab', panelId: 'source-panel' }),
    );

    await fireEvent(targetTab, dragEvent('dragover', dataTransfer, 110));
    await fireEvent(targetTab, dragEvent('drop', dataTransfer, 110));

    expect(onTabMoveToPanel).toHaveBeenCalledWith('source-tab', 'source-panel', 0);
  });

  it('does not consume drops with unrelated MIME', async () => {
    const onTabReorder = vi.fn();
    const onTabMoveToPanel = vi.fn();
    const { container } = renderTabBar({ onTabReorder, onTabMoveToPanel });
    const targetTab = container.querySelector<HTMLElement>('[data-tab-id="one"]')!;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData('text/plain', 'external payload');
    const bubbledDrop = vi.fn();
    container.addEventListener('drop', bubbledDrop);
    const event = dragEvent('drop', dataTransfer);

    await fireEvent(targetTab, event);

    expect(event.defaultPrevented).toBe(false);
    expect(bubbledDrop).toHaveBeenCalledOnce();
    expect(onTabReorder).not.toHaveBeenCalled();
    expect(onTabMoveToPanel).not.toHaveBeenCalled();
  });
});

describe('panel context menu routing', () => {
  it('keeps only the kebab and Close visible while grouping panel controls in the menu', async () => {
    const { container } = renderTabBar({ onClosePanel: vi.fn() });
    const directActions = container.querySelector<HTMLElement>('.panel-actions')!;

    expect(directActions.querySelectorAll('button')).toHaveLength(2);
    expect(directActions.querySelector('[data-testid="panel-actions-trigger"]')).toBeTruthy();
    expect(directActions.querySelector('[data-testid="panel-close-button"]')).toBeTruthy();

    await fireEvent.click(
      directActions.querySelector<HTMLElement>('[data-testid="panel-actions-trigger"]')!,
    );

    const display = document.querySelector<HTMLElement>('[data-panel-actions-section="display"]');
    const actions = document.querySelector<HTMLElement>('[data-panel-actions-section="actions"]');
    expect(display?.textContent).toContain('Zoom Panel');
    expect(actions?.textContent).toContain('Split right');
    expect(actions?.textContent).toContain('Split down');
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('Close panel');
  });

  it('uses a high-visibility kebab icon for panel actions', () => {
    const { container } = renderTabBar();
    const icon = container.querySelector<SVGElement>('[data-testid="panel-actions-trigger"] svg');

    expect(icon?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(icon?.getAttribute('class')).toContain('size-4');
    expect(icon?.querySelector('path')?.getAttribute('d')).toContain('M8 2a1.5');
  });

  it('portals the tabless-header menu to viewport coordinates without tab actions', async () => {
    const { container } = renderTabBar({ showTabStrip: false });
    const header = container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;

    await fireEvent.contextMenu(header, { clientX: 120, clientY: 80 });

    const menu = document.querySelector<HTMLElement>('[data-panel-context-menu="panel"]')!;
    const labels = Array.from(menu.querySelectorAll('button'), (button) =>
      button.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(container.contains(menu)).toBe(false);
    expect(menu.style.left).toBe('124px');
    expect(menu.style.top).toBe('84px');
    expect(labels).toContain('Close panel');
    expect(labels).toContain('Close all others');
    expect(labels).not.toContain('Close ⌘W');
    expect(labels).not.toContain('Close other tabs in panel');
    expect(labels).not.toContain('Close tabs to the right');
  });

  it('keeps tab actions on the explicit tab-strip menu', async () => {
    const { container } = renderTabBar();
    const tabElement = container.querySelector<HTMLElement>('[data-tab-id="one"]')!;

    await fireEvent.contextMenu(tabElement, { clientX: 120, clientY: 80 });

    const menu = document.querySelector<HTMLElement>('[data-panel-context-menu="tab"]')!;
    const labels = Array.from(menu.querySelectorAll('button'), (button) =>
      button.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(labels).toContain('Close ⌘W');
    expect(labels).toContain('Close other tabs in panel');
    expect(labels).toContain('Close tabs to the right');
  });
});

describe('layout edge routing', () => {
  const rect = { left: 100, top: 50, width: 800, height: 600 } as DOMRect;

  it('captures only the narrow outer layout bands', () => {
    expect(getPanelLayoutEdgePlacement(102, 350, rect)).toBe('before');
    expect(getPanelLayoutEdgePlacement(898, 350, rect)).toBe('after');
    expect(getPanelLayoutEdgePlacement(500, 52, rect)).toBe('above');
    expect(getPanelLayoutEdgePlacement(500, 648, rect)).toBe('below');
    expect(getPanelLayoutEdgePlacement(500, 350, rect)).toBeNull();
    expect(getPanelLayoutEdgePlacement(179, 350, rect)).toBe('before');
    expect(getPanelLayoutEdgePlacement(181, 350, rect)).toBeNull();
  });

  it('chooses the closest edge at a corner', () => {
    expect(getPanelLayoutEdgePlacement(101, 70, rect)).toBe('before');
    expect(getPanelLayoutEdgePlacement(120, 51, rect)).toBe('above');
  });
});
