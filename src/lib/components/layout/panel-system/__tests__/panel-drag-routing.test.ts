/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelState, PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { SHORTCUTS, formatShortcut } from '$lib/utils/shortcuts';

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
  selectRecentlyClosed: () => readable([]),
  selectPanelColumnCount: () => readable(1),
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
import PanelContainer from '../PanelContainer.svelte';
import PanelTabBar from '../PanelTabBar.svelte';
import {
  PANE_DRAG_MIME,
  clearDraggedPaneState,
  getDraggedPane,
  getPaneColumnDropZone,
  getPaneInsertionPlacement,
  getPaneInsertionPlacementAtX,
  getPaneInsertionTargetAtX,
  getPaneInsertionTargets,
  setDraggedPane,
} from '../panel-drag';

const TAB_DRAG_MIME = PANE_DRAG_MIME;

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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.dispatch.mockClear();
  setDraggedPane(null);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
});

afterEach(() => {
  setDraggedPane(null);
  cleanup();
  vi.unstubAllGlobals();
});

describe('pane and tab drag MIME routing', () => {
  it('creates one non-overlapping insertion gutter at every column boundary', () => {
    const layoutRect = { left: 100, width: 600 } as DOMRect;
    const panelRects = [
      { left: 100, width: 190 },
      { left: 300, width: 190 },
      { left: 500, width: 200 },
    ] as DOMRect[];

    const targets = getPaneInsertionTargets(layoutRect, panelRects);

    expect(targets).toEqual([
      { index: 0, left: 0, width: 40 },
      { index: 1, left: 175, width: 40 },
      { index: 2, left: 375, width: 40 },
      { index: 3, left: 560, width: 40 },
    ]);
    expect(getPaneInsertionTargetAtX(295, layoutRect, targets)?.index).toBe(1);
    expect(getPaneInsertionTargetAtX(450, layoutRect, targets)).toBeNull();
    expect(getPaneInsertionTargets(layoutRect, panelRects, false)).toEqual([]);
  });

  it('keeps insertion gutters separate in narrow layouts', () => {
    const targets = getPaneInsertionTargets(
      { left: 0, width: 60 } as DOMRect,
      [
        { left: 0, width: 20 },
        { left: 20, width: 20 },
        { left: 40, width: 20 },
      ] as DOMRect[],
    );

    expect(targets.map(({ left, width }) => ({ left, width }))).toEqual([
      { left: 0, width: 10 },
      { left: 15, width: 10 },
      { left: 35, width: 10 },
      { left: 50, width: 10 },
    ]);
  });

  it('maps each preview boundary to the same outer or interior drop placement', () => {
    const panelIds = ['panel-a', 'panel-b', 'panel-c'];

    expect(panelIds.map((_, index) => getPaneInsertionPlacement(index, panelIds))).toEqual([
      { kind: 'edge', position: 'before' },
      { kind: 'panel', targetPanelId: 'panel-b', zone: 'left' },
      { kind: 'panel', targetPanelId: 'panel-c', zone: 'left' },
    ]);
    expect(getPaneInsertionPlacement(panelIds.length, panelIds)).toEqual({
      kind: 'edge',
      position: 'after',
    });
  });

  it('keeps root insertion routing authoritative and stable for one pointer region', () => {
    const layoutRect = { left: 0, width: 800 } as DOMRect;
    const panelRects = [
      { left: 0, width: 400 },
      { left: 400, width: 400 },
    ] as DOMRect[];
    const panelIds = ['panel-a', 'panel-b'];
    const targets = getPaneInsertionTargets(layoutRect, panelRects);
    const placements = [395, 395, 396, 397].map((clientX) =>
      getPaneInsertionPlacementAtX(clientX, layoutRect, targets, panelIds),
    );

    expect(placements).toEqual(
      Array.from({ length: 4 }, () => ({
        kind: 'panel',
        targetPanelId: 'panel-b',
        zone: 'left',
      })),
    );
    expect(getPaneInsertionPlacementAtX(397, layoutRect, targets, panelIds)).toEqual(
      placements.at(-1),
    );
  });

  it('drags only the active pane from the visible stack header', async () => {
    const { container } = renderTabBar({ panelId: 'source-panel', layoutId: 'workspace-1' });
    const header = container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;
    const dataTransfer = new TestDataTransfer();

    await fireEvent(header, dragEvent('dragstart', dataTransfer));

    expect(JSON.parse(dataTransfer.getData(PANE_DRAG_MIME))).toEqual({
      panelId: 'source-panel',
      tabId: 'one',
    });
    expect(getDraggedPane()).toEqual({ panelId: 'source-panel', tabId: 'one' });
    const dragImage = dataTransfer.setDragImage.mock.calls[0]?.[0] as HTMLElement;
    expect(dragImage.dataset.paneDragImage).toBe('');
    expect(dragImage.textContent).toBe('one');
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'tabState/startDrag' });
  });

  it('cancels the pane drag without changing layout state', async () => {
    const { container } = renderTabBar({ panelId: 'source-panel', layoutId: 'workspace-1' });
    const header = container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;
    const dataTransfer = new TestDataTransfer();

    await fireEvent(header, dragEvent('dragstart', dataTransfer));

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(getDraggedPane()).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'panelLayout/restorePanelDragLayout' }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'tabState/endDrag' });
  });

  it.each(['dragend', 'Escape'] as const)(
    'removes the source tab bar safely during %s cleanup',
    async (route) => {
      let removeSource = () => {};
      const onPaneDragFinish = vi.fn(() => {
        clearDraggedPaneState();
        removeSource();
      });
      const result = renderTabBar({ panelId: 'source-panel', onPaneDragFinish });
      removeSource = result.unmount;
      const header = result.container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;
      const dataTransfer = new TestDataTransfer();

      await fireEvent(header, dragEvent('dragstart', dataTransfer));
      if (route === 'Escape') await fireEvent.keyDown(window, { key: 'Escape' });
      else await fireEvent(header, dragEvent('dragend', dataTransfer));

      expect(onPaneDragFinish).toHaveBeenCalledOnce();
      expect(getDraggedPane()).toBeNull();
      expect(result.container.querySelector('[data-panel-tabless-header]')).toBeNull();
    },
  );

  it('invokes the pane finish callback once when the source tab bar is destroyed', () => {
    const onPaneDragFinish = vi.fn(clearDraggedPaneState);
    const result = renderTabBar({
      panelId: 'source-panel',
      onPaneDragFinish,
    });
    setDraggedPane({ tabId: 'one', panelId: 'source-panel' });

    result.unmount();

    expect(onPaneDragFinish).toHaveBeenCalledOnce();
    expect(getDraggedPane()).toBeNull();
  });

  it('keeps the source panel identity stable when source removal starts child cleanup', async () => {
    const onPaneDragFinish = vi.fn(clearDraggedPaneState);
    const sourceNode = { type: 'panel' as const, panelId: 'source-panel' };
    const targetNode = { type: 'panel' as const, panelId: 'target-panel' };
    const props = {
      node: {
        type: 'split' as const,
        direction: 'horizontal' as const,
        sizes: [50, 50],
        children: [sourceNode, targetNode],
      },
      panels: {
        'source-panel': panel('source-panel', [tab('one')]),
        'target-panel': panel('target-panel', [tab('two')]),
      },
      panelOrder: ['source-panel', 'target-panel'],
      focusedPanelId: 'source-panel',
      workspaceId: 'workspace-1',
      layoutId: 'workspace-1',
      onPaneDragFinish,
    };
    const result = render(PanelContainer, { props });
    setDraggedPane({ tabId: 'one', panelId: 'source-panel' });

    await result.rerender({
      ...props,
      node: { ...props.node, sizes: [100], children: [targetNode] },
      panels: { 'target-panel': props.panels['target-panel'] },
      panelOrder: ['target-panel'],
    });

    await vi.waitFor(() => expect(onPaneDragFinish).toHaveBeenCalledOnce());
    expect(getDraggedPane()).toBeNull();
    expect(document.querySelector('[data-panel-id="source-panel"]')).toBeNull();
  });

  it('does not finish the same pane drag again when dragend follows Escape', async () => {
    const onPaneDragFinish = vi.fn(clearDraggedPaneState);
    const result = renderTabBar({ panelId: 'source-panel', onPaneDragFinish });
    const header = result.container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;
    const dataTransfer = new TestDataTransfer();

    await fireEvent(header, dragEvent('dragstart', dataTransfer));
    await fireEvent.keyDown(window, { key: 'Escape' });
    await fireEvent(header, dragEvent('dragend', dataTransfer));

    expect(onPaneDragFinish).toHaveBeenCalledOnce();
  });

  it('adds a dropped pane to another stack from the full column surface', async () => {
    const onTabMoveToPanel = vi.fn();
    const onPaneDropPreview = vi.fn();
    const { container } = render(Panel, {
      props: {
        panel: panel(),
        workspaceId: 'workspace-1',
        onTabMoveToPanel,
        onPaneDropPreview,
      },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(
      PANE_DRAG_MIME,
      JSON.stringify({ tabId: 'source-tab', panelId: 'source-panel' }),
    );
    setDraggedPane({ tabId: 'source-tab', panelId: 'source-panel' });

    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, 200, 20));
    expect(onPaneDropPreview).toHaveBeenLastCalledWith({
      kind: 'panel',
      targetPanelId: 'target-panel',
      zone: 'center',
    });
    expect(container.textContent).not.toContain('Move to stack');
    await fireEvent(targetPanel, dragEvent('drop', dataTransfer, 200, 20));

    expect(onTabMoveToPanel).toHaveBeenCalledWith('source-tab', 'source-panel');
    expect(onPaneDropPreview).toHaveBeenLastCalledWith(null);
    expect(dataTransfer.dropEffect).toBe('move');
    expect(getDraggedPane()).toBeNull();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'tabState/endDrag' });
  });

  it.each([
    ['left', 60],
    ['right', 340],
  ] as const)(
    'keeps the %s pane preview aligned with the committed panel side',
    async (zone, x) => {
      const onTabDrop = vi.fn();
      const onPaneDropPreview = vi.fn();
      const { container } = render(Panel, {
        props: {
          panel: panel(),
          workspaceId: 'workspace-1',
          onTabDrop,
          onPaneDropPreview,
        },
      });
      const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
      targetPanel.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
      const dataTransfer = new TestDataTransfer();
      dataTransfer.setData(
        PANE_DRAG_MIME,
        JSON.stringify({ tabId: 'source-tab', panelId: 'source-panel' }),
      );
      setDraggedPane({ tabId: 'source-tab', panelId: 'source-panel' });

      await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, x));
      const preview = onPaneDropPreview.mock.calls.at(-1)?.[0];
      expect(preview).toEqual({ kind: 'panel', targetPanelId: 'target-panel', zone });
      expect(container.textContent).not.toContain(zone === 'left' ? 'Split left' : 'Split right');
      await fireEvent(targetPanel, dragEvent('drop', dataTransfer, x));

      expect(onTabDrop).toHaveBeenCalledWith('source-tab', 'source-panel', preview.zone);
      expect(onPaneDropPreview).toHaveBeenLastCalledWith(null);
    },
  );

  it.each([
    ['center', 200],
    ['left', 60],
    ['right', 340],
  ] as const)('finishes a %s pane drop before its layout callback', async (zone, x) => {
    const order: string[] = [];
    const onPaneDragFinish = vi.fn(() => {
      order.push('finish');
      clearDraggedPaneState();
    });
    const onTabMoveToPanel = vi.fn(() => {
      expect(getDraggedPane()).toBeNull();
      order.push('move-center');
    });
    const onTabDrop = vi.fn(() => {
      expect(getDraggedPane()).toBeNull();
      order.push(`move-${zone}`);
    });
    const { container } = render(Panel, {
      props: {
        panel: panel(),
        workspaceId: 'workspace-1',
        onPaneDragFinish,
        onTabMoveToPanel,
        onTabDrop,
      },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(
      PANE_DRAG_MIME,
      JSON.stringify({ tabId: 'source-tab', panelId: 'source-panel' }),
    );
    setDraggedPane({ tabId: 'source-tab', panelId: 'source-panel' });

    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, x));
    await fireEvent(targetPanel, dragEvent('drop', dataTransfer, x));

    expect(onPaneDragFinish).toHaveBeenCalledOnce();
    expect(order).toEqual(['finish', `move-${zone}`]);
  });

  it('finishes a rejected self drop without invoking a layout callback', async () => {
    const onPaneDragFinish = vi.fn(clearDraggedPaneState);
    const onTabMoveToPanel = vi.fn();
    const onTabDrop = vi.fn();
    const { container } = render(Panel, {
      props: {
        panel: panel(),
        workspaceId: 'workspace-1',
        onPaneDragFinish,
        onTabMoveToPanel,
        onTabDrop,
      },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(PANE_DRAG_MIME, JSON.stringify({ tabId: 'one', panelId: 'target-panel' }));
    setDraggedPane({ tabId: 'one', panelId: 'target-panel' });

    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, 200));
    await fireEvent(targetPanel, dragEvent('drop', dataTransfer, 200));

    expect(onPaneDragFinish).toHaveBeenCalledOnce();
    expect(onTabMoveToPanel).not.toHaveBeenCalled();
    expect(onTabDrop).not.toHaveBeenCalled();
    expect(getDraggedPane()).toBeNull();
  });

  it('keeps a slow pointer stable through side-zone hysteresis and commits its preview', async () => {
    const onTabMoveToPanel = vi.fn();
    const onPaneDropPreview = vi.fn();
    const { container } = render(Panel, {
      props: {
        panel: panel(),
        workspaceId: 'workspace-1',
        onTabMoveToPanel,
        onPaneDropPreview,
      },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(
      PANE_DRAG_MIME,
      JSON.stringify({ tabId: 'source-tab', panelId: 'source-panel' }),
    );
    setDraggedPane({ tabId: 'source-tab', panelId: 'source-panel' });

    for (const clientX of [81, 81, 80, 79, 78, 77]) {
      await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, clientX));
    }

    const previews = onPaneDropPreview.mock.calls.map(([placement]) => placement);
    expect(previews).toEqual(
      Array.from({ length: 6 }, () => ({
        kind: 'panel',
        targetPanelId: 'target-panel',
        zone: 'center',
      })),
    );
    await fireEvent(targetPanel, dragEvent('drop', dataTransfer, 77));
    expect(onTabMoveToPanel).toHaveBeenCalledWith('source-tab', 'source-panel');
  });

  it('clears the active pane preview when the pointer leaves the panel', async () => {
    const onPaneDropPreview = vi.fn();
    const { container } = render(Panel, {
      props: { panel: panel(), workspaceId: 'workspace-1', onPaneDropPreview },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(
      PANE_DRAG_MIME,
      JSON.stringify({ tabId: 'source-tab', panelId: 'source-panel' }),
    );
    setDraggedPane({ tabId: 'source-tab', panelId: 'source-panel' });

    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, 200));
    await fireEvent(targetPanel, dragEvent('dragleave', dataTransfer, 500));

    expect(onPaneDropPreview).toHaveBeenLastCalledWith(null);
  });

  it('does not preview a no-op center drop into the source stack', async () => {
    const onPaneDropPreview = vi.fn();
    const { container } = render(Panel, {
      props: { panel: panel(), workspaceId: 'workspace-1', onPaneDropPreview },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(PANE_DRAG_MIME, JSON.stringify({ tabId: 'one', panelId: 'target-panel' }));
    setDraggedPane({ tabId: 'one', panelId: 'target-panel' });

    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, 200));

    expect(onPaneDropPreview).toHaveBeenLastCalledWith(null);
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

  it('offers only left, center, and right tab drop zones at every vertical position', async () => {
    const onTabDrop = vi.fn();
    const onTabMoveToPanel = vi.fn();
    const { container } = render(Panel, {
      props: {
        panel: panel(),
        workspaceId: 'workspace-1',
        onTabDrop,
        onTabMoveToPanel,
      },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(
      TAB_DRAG_MIME,
      JSON.stringify({ tabId: 'source-tab', panelId: 'source-panel' }),
    );

    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, 10, 50));
    await fireEvent(targetPanel, dragEvent('drop', dataTransfer, 10, 50));
    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, 200, 380));
    await fireEvent(targetPanel, dragEvent('drop', dataTransfer, 200, 380));
    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, 390, 50));
    await fireEvent(targetPanel, dragEvent('drop', dataTransfer, 390, 50));

    expect(onTabDrop.mock.calls).toEqual([
      ['source-tab', 'source-panel', 'left'],
      ['source-tab', 'source-panel', 'right'],
    ]);
    expect(onTabMoveToPanel).toHaveBeenCalledOnce();
    expect(onTabMoveToPanel).toHaveBeenCalledWith('source-tab', 'source-panel');
  });

  it('shows one neutral destination for a legacy tab drag over the panel body', async () => {
    const { container } = render(Panel, {
      props: { panel: panel(), workspaceId: 'workspace-1' },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, right: 400, top: 0, bottom: 400, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(
      TAB_DRAG_MIME,
      JSON.stringify({ tabId: 'source-tab', panelId: 'source-panel' }),
    );

    for (const [clientX, zone] of [
      [60, 'left'],
      [200, 'center'],
      [340, 'right'],
    ] as const) {
      await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, clientX));
      expect(
        container
          .querySelector('[data-panel-drop-destination]')
          ?.getAttribute('data-panel-legacy-tab-drop-zone'),
      ).toBe(zone);
    }

    await fireEvent(targetPanel, dragEvent('dragleave', dataTransfer, 500, 500));
    expect(container.querySelector('[data-panel-drop-destination]')).toBeNull();
  });

  it('removes side creation targets at the four-column limit', async () => {
    const onTabDrop = vi.fn();
    const onTabMoveToPanel = vi.fn();
    const { container } = render(Panel, {
      props: {
        panel: panel(),
        workspaceId: 'workspace-1',
        canCreateColumn: false,
        onTabDrop,
        onTabMoveToPanel,
      },
    });
    const targetPanel = container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!;
    targetPanel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect;
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(
      TAB_DRAG_MIME,
      JSON.stringify({ tabId: 'source-tab', panelId: 'source-panel' }),
    );

    await fireEvent(targetPanel, dragEvent('dragover', dataTransfer, 10, 200));
    expect(container.textContent).not.toContain('Move to stack');
    expect(
      container
        .querySelector('[data-panel-drop-destination]')
        ?.getAttribute('data-panel-legacy-tab-drop-zone'),
    ).toBe('center');
    await fireEvent(targetPanel, dragEvent('drop', dataTransfer, 10, 200));

    expect(onTabDrop).not.toHaveBeenCalled();
    expect(onTabMoveToPanel).toHaveBeenCalledWith('source-tab', 'source-panel');
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
  it('does not render the removed panel pin control', () => {
    const { container } = renderTabBar({ onClosePanel: vi.fn() });

    expect(container.querySelector('[data-panel-pin]')).toBeNull();
  });

  it('keeps kebab and Close visible while grouping other panel controls in the menu', async () => {
    const { container } = renderTabBar({ onSplitHorizontal: vi.fn(), onTabClose: vi.fn() });
    const directActions = container.querySelector<HTMLElement>('.panel-actions')!;

    expect(directActions.querySelectorAll('button')).toHaveLength(2);
    expect(directActions.querySelector('[data-panel-pin]')).toBeNull();
    expect(directActions.querySelector('[data-testid="panel-actions-trigger"]')).toBeTruthy();
    expect(directActions.querySelector('[data-testid="panel-close-button"]')).toBeTruthy();

    await fireEvent.click(
      directActions.querySelector<HTMLElement>('[data-testid="panel-actions-trigger"]')!,
    );

    const display = document.querySelector<HTMLElement>('[data-panel-actions-section="display"]');
    const actions = document.querySelector<HTMLElement>('[data-panel-actions-section="actions"]');
    expect(display?.textContent).toContain('Zoom Panel');
    expect(actions?.textContent).toContain('Create column to right');
    expect(actions?.textContent).not.toContain('Split down');
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('Close panel');
    expect(
      screen
        .getByRole('menuitem', { name: /Create column to right/i })
        .getAttribute('aria-disabled'),
    ).toBe('false');
  });

  it('disables column creation in the mounted menu at four columns', async () => {
    const panelIds = ['panel-1', 'panel-2', 'panel-3', 'panel-4'];
    const panels = Object.fromEntries(panelIds.map((id) => [id, panel(id, [tab(`${id}-tab`)])]));
    const { container } = render(PanelContainer, {
      props: {
        node: {
          type: 'split',
          direction: 'horizontal',
          sizes: [25, 25, 25, 25],
          children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
        },
        panels,
        panelOrder: panelIds,
        focusedPanelId: 'panel-1',
        workspaceId: 'workspace-1',
        layoutId: 'workspace-1',
        onSplitPanel: vi.fn(),
      },
    });

    await fireEvent.click(
      container.querySelector<HTMLElement>('[data-testid="panel-actions-trigger"]')!,
    );

    expect(
      screen
        .getByRole('menuitem', { name: /Create column to right/i })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('routes active-pane movement and disables the missing adjacent target', async () => {
    const panelIds = ['panel-1', 'panel-2'];
    const panels = Object.fromEntries(panelIds.map((id) => [id, panel(id, [tab(`${id}-pane`)])]));
    const onMoveActivePane = vi.fn();
    const { container } = render(PanelContainer, {
      props: {
        node: {
          type: 'split',
          direction: 'horizontal',
          sizes: [50, 50],
          children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
        },
        panels,
        panelOrder: panelIds,
        focusedPanelId: 'panel-1',
        workspaceId: 'workspace-1',
        layoutId: 'workspace-1',
        onMoveActivePane,
      },
    });

    await fireEvent.click(
      container.querySelector<HTMLElement>('[data-testid="panel-actions-trigger"]')!,
    );

    expect(
      screen.getByRole('menuitem', { name: 'Move active pane left' }).getAttribute('aria-disabled'),
    ).toBe('true');
    const moveRight = screen.getByRole('menuitem', { name: 'Move active pane right' });
    expect(moveRight.getAttribute('aria-disabled')).toBe('false');
    expect(moveRight.textContent).toContain(formatShortcut(SHORTCUTS.MOVE_PANE_NEXT_COLUMN.key));
    await fireEvent.click(moveRight);
    expect(onMoveActivePane).toHaveBeenCalledWith('panel-1', 'next');
  });

  it('uses a high-visibility kebab icon for panel actions', () => {
    const { container } = renderTabBar();
    const icon = container.querySelector<SVGElement>('[data-testid="panel-actions-trigger"] svg');

    expect(icon?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(icon?.getAttribute('class')).toContain('size-3');
    expect(icon?.querySelector('path')?.getAttribute('d')).toContain('M8 2a1.5');
  });

  it('opens the shared panel actions menu from the tabless header without tab actions', async () => {
    const onMoveRight = vi.fn();
    const { container } = renderTabBar({ showTabStrip: false, onMoveRight });
    const header = container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;

    await fireEvent.contextMenu(header, { clientX: 120, clientY: 80 });

    const menu = screen.getByRole('menu');
    const moveLeft = screen.getByRole('menuitem', { name: 'Move left' });
    const moveRight = screen.getByRole('menuitem', { name: 'Move right' });
    expect(moveLeft.getAttribute('aria-disabled')).toBe('true');
    expect(moveRight.getAttribute('aria-disabled')).toBe('false');
    expect(menu.querySelector('[data-panel-actions-section="open-in"]')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Close tabs to the right/ })).toBeNull();
    await fireEvent.click(moveRight);
    expect(onMoveRight).toHaveBeenCalledOnce();
  });

  it('disables Move right at the right boundary and keeps Move left enabled', async () => {
    const onMoveLeft = vi.fn();
    const { container } = renderTabBar({ showTabStrip: false, onMoveLeft });
    const header = container.querySelector<HTMLElement>('[data-panel-tabless-header]')!;

    await fireEvent.contextMenu(header, { clientX: 120, clientY: 80 });

    const moveLeft = screen.getByRole('menuitem', { name: 'Move left' });
    const moveRight = screen.getByRole('menuitem', { name: 'Move right' });
    expect(moveLeft.getAttribute('aria-disabled')).toBe('false');
    expect(moveRight.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(moveLeft);
    expect(onMoveLeft).toHaveBeenCalledOnce();
  });

  it('keeps tab actions on the explicit tab-strip menu', async () => {
    const { container } = renderTabBar();
    const tabElement = container.querySelector<HTMLElement>('[data-tab-id="one"]')!;

    await fireEvent.contextMenu(tabElement, { clientX: 120, clientY: 80 });

    const menu = document.querySelector<HTMLElement>('[data-panel-context-menu="tab"]')!;
    const labels = Array.from(menu.querySelectorAll('button'), (button) =>
      button.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(labels).toContain(`Close ${formatShortcut(SHORTCUTS.CLOSE_TAB.key)}`);
    expect(labels).toContain('Close other tabs in panel');
    expect(labels).toContain('Close tabs to the right');
  });
});

describe('pane drop geometry', () => {
  it('uses stable explicit side and stack zones instead of a midpoint flip', () => {
    const rect = { left: 0, width: 400 } as DOMRect;

    expect(getPaneColumnDropZone(40, rect)).toBe('left');
    expect(getPaneColumnDropZone(199, rect)).toBe('center');
    expect(getPaneColumnDropZone(201, rect)).toBe('center');
    expect(getPaneColumnDropZone(360, rect)).toBe('right');
    expect(getPaneColumnDropZone(88, rect, true, 'left')).toBe('left');
    expect(getPaneColumnDropZone(96, rect, true, 'left')).toBe('center');
    expect(getPaneColumnDropZone(70, rect, true, 'center')).toBe('center');
    expect(getPaneColumnDropZone(60, rect, true, 'center')).toBe('left');
  });

  it('disables side and insertion-gutter creation at four columns', () => {
    const columnRect = { left: 0, width: 400 } as DOMRect;
    const layoutRect = { left: 100, width: 800 } as DOMRect;
    const panelRects = [{ left: 100, width: 800 }] as DOMRect[];

    expect(getPaneColumnDropZone(10, columnRect, false)).toBe('center');
    expect(getPaneColumnDropZone(390, columnRect, false)).toBe('center');
    expect(getPaneInsertionTargets(layoutRect, panelRects, false)).toEqual([]);
  });

  it('resolves outer edges and the interior divider to their exact boundaries', () => {
    const layoutRect = { left: 100, width: 800 } as DOMRect;
    const panelIds = ['left', 'right'];
    const targets = getPaneInsertionTargets(layoutRect, [
      { left: 100, width: 390 },
      { left: 500, width: 400 },
    ] as DOMRect[]);

    expect(getPaneInsertionTargetAtX(102, layoutRect, targets)?.index).toBe(0);
    expect(getPaneInsertionTargetAtX(495, layoutRect, targets)?.index).toBe(1);
    expect(getPaneInsertionTargetAtX(898, layoutRect, targets)?.index).toBe(2);
    expect(getPaneInsertionTargetAtX(300, layoutRect, targets)).toBeNull();
    expect(getPaneInsertionPlacementAtX(102, layoutRect, targets, panelIds)).toEqual({
      kind: 'edge',
      position: 'before',
    });
    expect(getPaneInsertionPlacementAtX(495, layoutRect, targets, panelIds)).toEqual({
      kind: 'panel',
      targetPanelId: 'right',
      zone: 'left',
    });
    expect(getPaneInsertionPlacementAtX(898, layoutRect, targets, panelIds)).toEqual({
      kind: 'edge',
      position: 'after',
    });
    expect(getPaneInsertionPlacementAtX(300, layoutRect, targets, panelIds)).toBeNull();
  });
});
