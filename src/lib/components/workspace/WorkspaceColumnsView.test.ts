/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  goto: vi.fn(),
  selectCurrentWorkspaceTabId: vi.fn(),
}));
const currentWorkspaceId = writable('ws-2');
const workspaceStacks = writable([['ws-1'], ['ws-2'], ['ws-3']]);
const panelCounts = writable<Record<string, number>>({});
const panelCanvasWidths = writable<Record<string, number>>({});
const panelNavigatorItems = writable<Record<string, Array<{ id: string; title: string }>>>({});
const resizablePanelSizes = writable<Record<string, number>>({});
const hydratedResizablePanelSizes = writable<Record<string, true>>({});
const panelTabCounts = writable<Record<string, number>>({});
const panelRevealRequests = writable<
  Record<string, { panelId: string; tabId: string; requestId: string }>
>({});
const panelRestoreStatuses = writable<Record<string, string>>({});
const workspaceItems = writable<Array<{ id: string; title: string }>>([]);
const workspaceStatuses = writable<Record<string, never>>({});
const focusedPanelTargets = writable<
  Record<string, { panelId: string | null; activeTabId: string | null }>
>({});
const workspaceById = writable<{ id: string; title?: string } | undefined>(undefined);

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    state: {},
    // Selector modules (e.g. agent-queue-selectors, reached via the
    // workspace-selectors import chain) call this at module load.
    createSelector: (selector: (state: object, ...args: never[]) => unknown) => {
      const readable = (...args: never[]) => selector({}, ...args);
      readable.select = (state: object, ...args: never[]) => selector(state, ...args);
      return readable;
    },
  },
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectCurrentWorkspaceTabId: Object.assign(() => currentWorkspaceId, {
    select: mocks.selectCurrentWorkspaceTabId,
  }),
  selectWorkspaceStacks: () => workspaceStacks,
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectPanelCanvasWidthsByWorkspaceId: () => panelCanvasWidths,
  selectPanelColumnCountsByWorkspaceId: () => panelCounts,
  selectPanelNavigatorItemsByWorkspaceId: () => panelNavigatorItems,
  selectPanelTabCountsByWorkspaceId: () => panelTabCounts,
  selectPanelRevealRequestsByWorkspaceId: () => panelRevealRequests,
  selectPanelRestoreStatusesByWorkspaceId: () => panelRestoreStatuses,
  selectFocusedPanelTargetsByWorkspaceId: () => focusedPanelTargets,
}));
vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectResizablePanelSizes: () => resizablePanelSizes,
  selectHydratedResizablePanelSizes: () => hydratedResizablePanelSizes,
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () => workspaceById,
  selectWorkspaceItems: Object.assign(() => workspaceItems, { select: () => [] }),
}));
vi.mock('$store/renderer/slices/hud/hud-selectors', () => ({
  selectWorkspaceTabStatuses: () => workspaceStatuses,
}));
vi.mock('../../../routes/(app)/workspace/[id]/WorkspaceSurface.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockWorkspaceSurface.svelte')).default,
}));
vi.mock('$lib/components/layout/ResizablePanelGroup.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockResizablePanelGroup.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockAllWorkspacesCard.svelte')).default,
}));

import WorkspaceColumnsView from './WorkspaceColumnsView.svelte';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  elements = new Set<Element>();
  constructor(
    private callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    MockIntersectionObserver.instances.push(this);
  }
  observe(element: Element) {
    this.elements.add(element);
  }
  unobserve(element: Element) {
    this.elements.delete(element);
  }
  disconnect() {
    this.elements.clear();
  }
  fire(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

function stubIntersectionObserver() {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
}

const surfaceFor = (workspaceId: string) =>
  document.querySelector(
    `[data-testid="mock-workspace-surface"][data-workspace-id="${workspaceId}"]`,
  );
const placeholderFor = (workspaceId: string) =>
  document.querySelector(`[data-workspace-column-placeholder="${workspaceId}"]`);

describe('WorkspaceColumnsView', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
    mocks.dispatch.mockClear();
    mocks.goto.mockClear();
    mocks.selectCurrentWorkspaceTabId.mockReset();
    mocks.selectCurrentWorkspaceTabId.mockReturnValue('ws-3');
    currentWorkspaceId.set('ws-2');
    workspaceStacks.set([['ws-1'], ['ws-2'], ['ws-3']]);
    panelCounts.set({});
    panelCanvasWidths.set({});
    panelNavigatorItems.set({});
    resizablePanelSizes.set({});
    hydratedResizablePanelSizes.set(
      Object.fromEntries(
        ['ws-1', 'ws-2', 'ws-3'].flatMap((workspaceId) => [
          [`workspace-left-panel-width:${workspaceId}`, true],
          [`workspace-left-panel-expanded-width:${workspaceId}`, true],
        ]),
      ),
    );
    panelTabCounts.set({});
    panelRevealRequests.set({});
    panelRestoreStatuses.set({ 'ws-1': 'restored', 'ws-2': 'restored', 'ws-3': 'restored' });
    workspaceItems.set([]);
    workspaceStatuses.set({});
    focusedPanelTargets.set({});
  });

  it('affirms heading-band geometry and bidirectional column choreography in every required visual state', async () => {
    const observed = await exerciseVisualStates(async () => {
      workspaceStacks.set([['ws-1']]);
      const view = render(WorkspaceColumnsView);
      const scroller = view.container.querySelector<HTMLElement>('[data-workspace-columns]')!;
      scroller.scrollTo = vi.fn();
      const target = view.getByLabelText('Workspace column ws-1');
      target.tabIndex = 0;
      workspaceStacks.set([['ws-1'], ['ws-2'], ['ws-3']]);
      await tick();
      expect(document.querySelectorAll('[data-workspace-column-motion]')).toHaveLength(3);
      workspaceStacks.set([['ws-1']]);
      await tick();
      return {
        ...view,
        target,
        assertCapability: () => {
          expect(document.querySelectorAll('[data-workspace-column-motion]')).toHaveLength(1);
          expect(
            document.querySelector<HTMLElement>('[data-workspace-stack="ws-1"]')?.style.width,
          ).toBe('360px');
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('renders vertically stacked workspaces in one content-sized column', () => {
    workspaceStacks.set([['ws-1', 'ws-2'], ['ws-3']]);
    render(WorkspaceColumnsView);

    expect(
      screen.getAllByTestId('mock-workspace-surface').map((column) => column.dataset.workspaceId),
    ).toEqual(['ws-1', 'ws-2', 'ws-3']);
    expect(screen.queryAllByTestId('mock-resizable-panel')).toHaveLength(0);
    expect(document.querySelector('[data-workspace-stack="ws-1,ws-2"]')).toBeTruthy();
    const stackResizeGroup = screen.getByTestId('mock-resizable-panel-group');
    expect(stackResizeGroup.dataset.orientation).toBe('vertical');
    expect(stackResizeGroup.dataset.storageKey).toBe('workspace-stack-heights:ws-1:ws-2');
    expect(stackResizeGroup.querySelector('[data-resize-axis="y"]')).toBeTruthy();
  });

  it('preserves existing workspace surfaces when stack membership changes', async () => {
    workspaceStacks.set([['ws-1', 'ws-2'], ['ws-3']]);
    render(WorkspaceColumnsView);
    const ws1 = screen.getByLabelText('Workspace column ws-1');
    const ws2 = screen.getByLabelText('Workspace column ws-2');

    workspaceStacks.set([['ws-1', 'ws-2', 'ws-3']]);
    await tick();

    expect(screen.getByLabelText('Workspace column ws-1')).toBe(ws1);
    expect(screen.getByLabelText('Workspace column ws-2')).toBe(ws2);
  });

  it('parks distant surfaces while preserving mounted DOM identity across adjacent switches', async () => {
    stubIntersectionObserver();
    try {
      currentWorkspaceId.set('ws-1');
      workspaceStacks.set([['ws-1'], ['ws-2'], ['ws-3'], ['ws-4'], ['ws-5']]);
      hydratedResizablePanelSizes.set(
        Object.fromEntries(
          ['ws-1', 'ws-2', 'ws-3', 'ws-4', 'ws-5'].flatMap((workspaceId) => [
            [`workspace-left-panel-width:${workspaceId}`, true],
            [`workspace-left-panel-expanded-width:${workspaceId}`, true],
          ]),
        ),
      );
      panelRestoreStatuses.set(
        Object.fromEntries(
          ['ws-1', 'ws-2', 'ws-3', 'ws-4', 'ws-5'].map((workspaceId) => [workspaceId, 'restored']),
        ),
      );
      workspaceItems.set(
        Array.from({ length: 5 }, (_, index) => ({
          id: `ws-${index + 1}`,
          title: `Workspace ${index + 1}`,
        })),
      );
      render(WorkspaceColumnsView);
      await tick();
      const observer = MockIntersectionObserver.instances[0]!;
      observer.fire([
        { target: document.querySelector('[data-workspace-stack="ws-1"]')!, isIntersecting: true },
        { target: document.querySelector('[data-workspace-stack="ws-2"]')!, isIntersecting: true },
      ]);
      await tick();

      const ws1 = screen
        .getByLabelText('Workspace column ws-1')
        .querySelector('[data-testid="mock-workspace-surface"]');
      const ws2 = screen
        .getByLabelText('Workspace column ws-2')
        .querySelector('[data-testid="mock-workspace-surface"]');
      expect(ws1).toBeTruthy();
      expect(ws2).toBeTruthy();
      expect(placeholderFor('ws-4')).toBeTruthy();

      currentWorkspaceId.set('ws-2');
      await tick();
      observer.fire([
        { target: document.querySelector('[data-workspace-stack="ws-3"]')!, isIntersecting: true },
      ]);
      await tick();

      expect(
        screen
          .getByLabelText('Workspace column ws-1')
          .querySelector('[data-testid="mock-workspace-surface"]'),
      ).toBe(ws1);
      expect(
        screen
          .getByLabelText('Workspace column ws-2')
          .querySelector('[data-testid="mock-workspace-surface"]'),
      ).toBe(ws2);
      expect(
        screen
          .getByLabelText('Workspace column ws-3')
          .querySelector('[data-testid="mock-workspace-surface"]'),
      ).toBeTruthy();
      expect(placeholderFor('ws-5')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps each workspace width independent when stack membership changes', async () => {
    panelCounts.set({ 'ws-2': 1 });
    render(WorkspaceColumnsView);

    await fireEvent.click(document.querySelector('[data-mock-panel-resize-preview="ws-2"]')!);
    await tick();
    expect(document.querySelector<HTMLElement>('[data-workspace-stack="ws-1"]')?.style.width).toBe(
      '360px',
    );
    expect(document.querySelector<HTMLElement>('[data-workspace-stack="ws-2"]')?.style.width).toBe(
      '1456px',
    );
    expect(document.querySelector<HTMLElement>('[data-workspace-stack="ws-3"]')?.style.width).toBe(
      '360px',
    );

    workspaceStacks.set([['ws-1'], ['ws-2', 'ws-3']]);
    await tick();

    expect(
      document.querySelector<HTMLElement>('[data-workspace-stack="ws-2,ws-3"]')?.style.width,
    ).toBe('1456px');
  });

  it('renders fallback-width columns during width hydration and settles to clamped widths', async () => {
    resizablePanelSizes.set({
      'workspace-left-panel-width:ws-1': 390,
      'workspace-left-panel-width:ws-2': 720,
      'workspace-left-panel-width:ws-3': 320,
    });
    hydratedResizablePanelSizes.set({});
    render(WorkspaceColumnsView);
    const scroller = screen.getByLabelText('Open spaces in columns');
    scroller.scrollLeft = 140;

    // Columns render immediately at the fallback width — no empty-scroller flash.
    expect(document.querySelectorAll('[data-workspace-stack]')).toHaveLength(3);
    expect(
      [...document.querySelectorAll<HTMLElement>('[data-workspace-stack]')].every(
        (stack) => stack.style.width === '360px',
      ),
    ).toBe(true);
    expect(scroller.dataset.sidebarWidthsReady).toBe('false');
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual(
      ['ws-1', 'ws-2', 'ws-3'].flatMap((workspaceId) => [
        {
          type: 'uiLayout/requestResizablePanelSize',
          payload: [`workspace-left-panel-width:${workspaceId}`],
        },
        {
          type: 'uiLayout/requestResizablePanelSize',
          payload: [`workspace-left-panel-expanded-width:${workspaceId}`],
        },
      ]),
    );

    mocks.dispatch.mockClear();
    hydratedResizablePanelSizes.set(
      Object.fromEntries(
        ['ws-1', 'ws-2', 'ws-3'].flatMap((workspaceId) => [
          [`workspace-left-panel-width:${workspaceId}`, true],
          [`workspace-left-panel-expanded-width:${workspaceId}`, true],
        ]),
      ),
    );
    await tick();

    expect(scroller.dataset.sidebarWidthsReady).toBe('true');
    expect(document.querySelector<HTMLElement>('[data-workspace-stack="ws-1"]')?.style.width).toBe(
      '390px',
    );
    expect(document.querySelector<HTMLElement>('[data-workspace-stack="ws-2"]')?.style.width).toBe(
      '400px',
    );
    expect(document.querySelector<HTMLElement>('[data-workspace-stack="ws-3"]')?.style.width).toBe(
      '320px',
    );
    expect(scroller.scrollLeft).toBe(140);
    expect(mocks.dispatch).not.toHaveBeenCalled();

    workspaceStacks.set([['ws-1'], ['ws-2', 'ws-3']]);
    await tick();
    expect(
      document.querySelector<HTMLElement>('[data-workspace-stack="ws-2,ws-3"]')?.style.width,
    ).toBe('400px');
    expect(scroller.scrollLeft).toBe(140);
  });

  it('pre-restores panel layouts for open workspaces that have not restored yet', async () => {
    panelRestoreStatuses.set({ 'ws-2': 'restored' });
    render(WorkspaceColumnsView);
    await tick();

    const scopeMounts = mocks.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === 'panelLayout/scopeMounted');
    expect(scopeMounts).toEqual([
      { type: 'panelLayout/scopeMounted', payload: ['ws-1'] },
      { type: 'panelLayout/scopeMounted', payload: ['ws-3'] },
    ]);

    // A status change does not re-dispatch for already-requested workspaces.
    mocks.dispatch.mockClear();
    panelRestoreStatuses.set({ 'ws-1': 'pending', 'ws-2': 'restored', 'ws-3': 'empty' });
    await tick();
    expect(
      mocks.dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'panelLayout/scopeMounted'),
    ).toEqual([]);
  });

  it('sizes a vertical stack to its widest workspace', () => {
    workspaceStacks.set([['ws-1', 'ws-2']]);
    panelCounts.set({ 'ws-1': 1, 'ws-2': 2 });
    panelCanvasWidths.set({ 'ws-1': 480, 'ws-2': 960 });
    render(WorkspaceColumnsView);

    expect(
      document.querySelector<HTMLElement>('[data-workspace-stack="ws-1,ws-2"]')?.style.width,
    ).toBe('1336px');
  });

  it('fills the shared stack width after the final panel closes', async () => {
    workspaceStacks.set([['ws-1', 'ws-2']]);
    panelCounts.set({ 'ws-1': 1, 'ws-2': 2 });
    panelCanvasWidths.set({ 'ws-1': 480, 'ws-2': 960 });
    render(WorkspaceColumnsView);
    const stack = document.querySelector<HTMLElement>('[data-workspace-stack="ws-1,ws-2"]')!;
    expect(stack.style.width).toBe('1336px');
    panelCounts.set({ 'ws-1': 1, 'ws-2': 0 });
    await tick();

    expect(stack.style.width).toBe('856px');
  });

  it('uses the shared top and horizontal zones for stack and reorder drops', async () => {
    render(WorkspaceColumnsView);
    const source = screen.getByLabelText('Workspace column ws-1');
    const sourceTitle = source.querySelector('[data-workspace-title-region]')!;
    const target = screen.getByLabelText('Workspace column ws-2');
    const targetRect = { left: 100, top: 100, width: 400, height: 400 } as DOMRect;
    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => targetRect,
    });
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => 'ws-1'),
      setDragImage: vi.fn(),
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

    await fireEvent(sourceTitle, dragEvent('dragstart', 120, 120));
    await fireEvent(target, dragEvent('dragover', 300, 140));
    expect(target.getAttribute('data-workspace-drop-placement')).toBe('above');
    expect(document.querySelector('[data-workspace-stack-preview="above"]')).toBeTruthy();
    await fireEvent(target, dragEvent('drop', 300, 140));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/moveWorkspace',
      payload: ['ws-1', 'ws-2', 'above'],
    });

    mocks.dispatch.mockClear();
    await fireEvent(sourceTitle, dragEvent('dragstart', 120, 120));
    await fireEvent(target, dragEvent('dragover', 480, 300));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/moveWorkspace',
      payload: ['ws-1', 'ws-2', 'after'],
    });
  });

  it('does not intercept drags from nested panel headers', async () => {
    render(WorkspaceColumnsView);
    const source = screen.getByLabelText('Workspace column ws-1');
    const panelHeader = source.querySelector('[data-mock-panel-header]')!;
    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'none',
      types: ['application/x-panel-id'],
      setData: vi.fn(),
      getData: vi.fn(),
      setDragImage: vi.fn(),
    };
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });

    await fireEvent(panelHeader, event);

    expect(event.defaultPrevented).toBe(false);
    expect(source.getAttribute('data-dragging')).toBe('false');
    expect(mocks.dispatch).not.toHaveBeenCalledWith({ type: 'tabState/startDrag' });
  });

  it('renders every open workspace in order and marks only the active surface', () => {
    render(WorkspaceColumnsView);
    const columns = screen.getAllByTestId('mock-workspace-surface');
    expect(columns.map((column) => column.dataset.workspaceId)).toEqual(['ws-1', 'ws-2', 'ws-3']);
    expect(columns.map((column) => column.dataset.active)).toEqual(['false', 'true', 'false']);
    expect(columns.every((column) => column.dataset.manageTab === 'false')).toBe(true);
    expect(columns.every((column) => column.dataset.columnMode === 'true')).toBe(true);
    expect(screen.queryAllByTestId('mock-resizable-panel')).toHaveLength(0);
  });

  it('renders a searchable three-recent workspace directory as the final column', () => {
    render(WorkspaceColumnsView);

    const track = screen.getByLabelText('Open spaces in columns').firstElementChild;
    const directory = screen.getByLabelText('All workspaces');
    const directoryContent = directory.querySelector('[data-workspace-directory-content]');
    const workspaceList = screen.getByTestId('mock-all-workspaces-card');

    expect(track?.lastElementChild).toBe(directory);
    expect(directory.hasAttribute('data-workspace-directory-column')).toBe(true);
    expect(directory.classList.contains('bg-sidebar')).toBe(false);
    expect(directory.classList.contains('shadow-md')).toBe(false);
    expect(directory.classList.contains('overflow-y-auto')).toBe(true);
    expect(directoryContent?.classList.contains('my-auto')).toBe(true);
    expect(directory.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(workspaceList.dataset.recentsOnly).toBe('true');
    expect(workspaceList.dataset.recentLimit).toBe('3');
    expect(workspaceList.dataset.searchRecents).toBe('true');
    expect(workspaceList.dataset.expandableRecents).toBe('true');
    expect(workspaceList.dataset.excludedWorkspaceIds).toBe('ws-1,ws-2,ws-3');
    expect(workspaceList.dataset.showLoadingText).toBe('false');
  });

  it('renders compact workspace columns at their 360px content width', () => {
    render(WorkspaceColumnsView);

    const compactColumns = document.querySelectorAll('[data-compact-workspace-column]');
    const workspaceColumns = document.querySelectorAll('[data-workspace-column]');
    const workspaceStacks = document.querySelectorAll<HTMLElement>('[data-workspace-stack]');
    expect(compactColumns).toHaveLength(3);
    expect([...workspaceStacks].every((stack) => stack.style.width === '360px')).toBe(true);
    expect(screen.queryAllByTestId('mock-resizable-panel')).toHaveLength(0);
    expect(document.querySelectorAll('[data-workspace-column-motion]')).toHaveLength(3);
    expect(
      screen.queryAllByRole('button', { name: 'Resize panel (double-click to reset)' }),
    ).toHaveLength(0);
    expect(
      [...workspaceColumns].every(
        (column) =>
          column.classList.contains('rounded-xl') &&
          column.classList.contains('border') &&
          column.classList.contains('border-border') &&
          column.classList.contains('bg-sidebar'),
      ),
    ).toBe(true);
    expect([...workspaceColumns].every((column) => column.classList.contains('shadow-sm'))).toBe(
      true,
    );
    const columnsLayout = screen.getByLabelText('Open spaces in columns')
      .firstElementChild as HTMLElement | null;
    expect(columnsLayout?.classList.contains('gap-3')).toBe(true);
    expect(columnsLayout?.style.padding).toBe('var(--workspace-reveal-inset)');
  });

  it('adds the intrinsic panel canvas width and inset chrome to the measured sidebar width', () => {
    panelCounts.set({ 'ws-3': 2 });
    panelCanvasWidths.set({ 'ws-3': 960 });
    render(WorkspaceColumnsView);

    expect(document.querySelector<HTMLElement>('[data-workspace-stack="ws-3"]')?.style.width).toBe(
      '1336px',
    );
  });

  it('temporarily resizes the workspace to the projected drag column count', async () => {
    panelCounts.set({ 'ws-3': 2 });
    panelCanvasWidths.set({ 'ws-3': 960 });
    render(WorkspaceColumnsView);
    const panelColumn = document.querySelector<HTMLElement>('[data-workspace-stack="ws-3"]')!;

    expect(panelColumn.style.width).toBe('1336px');
    await fireEvent.click(document.querySelector('[data-mock-panel-preview="ws-3"]')!);
    await tick();
    expect(panelColumn.style.width).toBe('856px');

    await fireEvent.click(document.querySelector('[data-mock-panel-preview-clear="ws-3"]')!);
    await tick();
    expect(panelColumn.style.width).toBe('1336px');
  });

  it('reactively adopts a restored intrinsic canvas width', async () => {
    render(WorkspaceColumnsView);
    const panelColumn = document.querySelector<HTMLElement>('[data-workspace-stack="ws-3"]')!;
    expect(panelColumn.style.width).toBe('360px');

    panelCounts.set({ 'ws-3': 2 });
    panelCanvasWidths.set({ 'ws-3': 960 });
    await tick();

    expect(panelColumn.style.width).toBe('1336px');
  });

  it('uses measured sidebar pixels and clamps them to the column maximum', async () => {
    panelCounts.set({ 'ws-3': 2 });
    panelCanvasWidths.set({ 'ws-3': 960 });
    render(WorkspaceColumnsView);

    const panelColumn = document.querySelector<HTMLElement>('[data-workspace-stack="ws-3"]')!;
    expect(panelColumn.style.width).toBe('1336px');

    await fireEvent.click(document.querySelector('[data-mock-sidebar-width="ws-3"]')!);
    await tick();

    expect(panelColumn.style.width).toBe('1376px');
  });

  it('lets the inner panel canvas own resize updates without a competing dispatch', async () => {
    panelCounts.set({ 'ws-3': 2 });
    panelCanvasWidths.set({ 'ws-3': 960 });
    render(WorkspaceColumnsView);
    const panelColumn = document.querySelector<HTMLElement>('[data-workspace-stack="ws-3"]')!;
    await fireEvent.click(document.querySelector('[data-mock-panel-resize-preview="ws-3"]')!);
    await tick();

    expect(panelColumn.style.width).toBe('1456px');
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('keeps the scrollable right gutter without an outer workspace resize handle', () => {
    render(WorkspaceColumnsView);

    const scroller = document.querySelector<HTMLElement>('[data-workspace-columns]');
    const columnsTrack = scroller?.firstElementChild as HTMLElement | null;

    expect(scroller?.classList.contains('scrollbar-none')).toBe(true);
    expect(scroller?.classList.contains('overflow-x-auto')).toBe(true);
    expect(scroller?.style.getPropertyValue('--workspace-reveal-inset')).toBe('0.5rem');
    expect(columnsTrack?.style.padding).toBe('var(--workspace-reveal-inset)');
    expect(document.querySelector('[data-mock-resize-handle]')).toBeNull();
    expect(document.querySelector('[data-resize-scroll-container="true"]')).toBeNull();
  });

  it('activates an inactive column while leaving the active column alone', async () => {
    render(WorkspaceColumnsView);

    await fireEvent.pointerDown(screen.getByLabelText('Workspace column ws-1'));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-1'],
    });
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1');

    mocks.dispatch.mockClear();
    mocks.goto.mockClear();
    await fireEvent.pointerDown(screen.getByLabelText('Workspace column ws-2'));
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('continues panel cycling into the next populated workspace column', async () => {
    panelCounts.set({
      'ws-1': 1,
      'ws-2': 2,
      'ws-3': 0,
    });
    render(WorkspaceColumnsView);

    await fireEvent.click(screen.getByRole('button', { name: 'Cycle next panel from ws-2' }));

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-1'],
    });
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1');
  });

  it('activates a stacked workspace before a nested chat input stops pointer bubbling', async () => {
    workspaceStacks.set([['ws-1', 'ws-2']]);
    render(WorkspaceColumnsView);

    await fireEvent.pointerDown(document.querySelector('[data-mock-chat-input="ws-1"]')!);

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-1'],
    });
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1');
  });

  it('does not horizontally scroll when a stacked chat gains focus', async () => {
    workspaceStacks.set([['ws-1', 'ws-2']]);
    render(WorkspaceColumnsView);
    const panel = document.querySelector<HTMLElement>('[data-panel-id="panel-ws-1"]')!;
    const scrollIntoView = vi.fn();
    panel.scrollIntoView = scrollIntoView;

    focusedPanelTargets.set({
      'ws-1': { panelId: 'panel-ws-1', activeTabId: 'tab-ws-1' },
    });
    currentWorkspaceId.set('ws-1');
    await tick();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable descendant',
      () => {
        const host = document.createElement('div');
        host.setAttribute('contenteditable', 'true');
        host.tabIndex = 0;
        const target = document.createElement('span');
        host.append(target);
        return target;
      },
    ],
    [
      'role textbox descendant',
      () => {
        const host = document.createElement('div');
        host.setAttribute('role', 'textbox');
        host.tabIndex = 0;
        const target = document.createElement('span');
        host.append(target);
        return target;
      },
    ],
    [
      'ProseMirror descendant',
      () => {
        const host = document.createElement('div');
        host.className = 'ProseMirror';
        host.tabIndex = 0;
        const target = document.createElement('span');
        host.append(target);
        return target;
      },
    ],
    [
      'Monaco descendant',
      () => {
        const host = document.createElement('div');
        host.className = 'monaco-editor';
        host.tabIndex = 0;
        const target = document.createElement('span');
        host.append(target);
        return target;
      },
    ],
    [
      'CodeMirror descendant',
      () => {
        const host = document.createElement('div');
        host.className = 'cm-editor';
        host.tabIndex = 0;
        const target = document.createElement('span');
        host.append(target);
        return target;
      },
    ],
  ] as const)('leaves workspace arrows available to a focused %s', async (_name, createTarget) => {
    render(WorkspaceColumnsView);
    const target = createTarget();
    const host = target.parentElement ?? target;
    document.body.append(host);
    host.focus();

    for (const code of ['ArrowLeft', 'ArrowRight'] as const) {
      mocks.dispatch.mockClear();
      mocks.goto.mockClear();
      const event = new KeyboardEvent('keydown', {
        key: code,
        code,
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');

      await fireEvent(target, event);

      expect(event.defaultPrevented).toBe(false);
      expect(stopImmediatePropagation).not.toHaveBeenCalled();
      expect(mocks.dispatch).not.toHaveBeenCalled();
      expect(mocks.goto).not.toHaveBeenCalled();
    }
  });

  it('uses the focused editor when a capture event is retargeted to window', async () => {
    render(WorkspaceColumnsView);
    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      code: 'ArrowRight',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    await fireEvent(window, event);

    expect(event.defaultPrevented).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('navigates from non-editable controls and wraps column edges', async () => {
    currentWorkspaceId.set('ws-3');
    render(WorkspaceColumnsView);
    const scroller = screen.getByLabelText('Open spaces in columns');
    const target = screen.getByLabelText('Workspace column ws-1');
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 100, right: 900 }) as DOMRect);
    target.getBoundingClientRect = vi.fn(() => ({ left: 500, right: 900 }) as DOMRect);
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      value: 100,
      writable: true,
    });
    const button = document.createElement('button');
    scroller.append(button);
    button.focus();
    const moveRight = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      code: 'ArrowRight',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    await fireEvent(button, moveRight);

    expect(moveRight.defaultPrevented).toBe(true);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-1'],
    });
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1');

    currentWorkspaceId.set('ws-1');
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(scroller.scrollLeft).toBe(492);

    mocks.dispatch.mockClear();
    mocks.goto.mockClear();
    await fireEvent.keyDown(button, {
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      altKey: true,
      shiftKey: true,
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-3'],
    });
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-3');
  });

  it('jumps instantly to the current workspace on initial mount with left-edge alignment', async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      currentWorkspaceId.set('ws-3');
      hydratedResizablePanelSizes.set({});
      render(WorkspaceColumnsView);
      const scroller = screen.getByLabelText('Open spaces in columns');
      // ws-3 partially visible: inline 'nearest' would silently skip this jump.
      scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
      screen.getByLabelText('Workspace column ws-3').getBoundingClientRect = vi.fn(
        () => ({ left: 600, right: 960 }) as DOMRect,
      );

      hydratedResizablePanelSizes.set(
        Object.fromEntries(
          ['ws-1', 'ws-2', 'ws-3'].flatMap((workspaceId) => [
            [`workspace-left-panel-width:${workspaceId}`, true],
            [`workspace-left-panel-expanded-width:${workspaceId}`, true],
          ]),
        ),
      );
      await tick();

      expect(scroller.scrollLeft).toBe(592);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  // Boots the view with hydration incomplete, installs scroll/rect mocks, then
  // completes hydration so the initial left-edge jump runs against the mocks
  // and leaves the target anchored for the width-settle window.
  async function renderWithAnchoredInitialJump() {
    currentWorkspaceId.set('ws-3');
    hydratedResizablePanelSizes.set({});
    render(WorkspaceColumnsView);
    const scroller = screen.getByLabelText('Open spaces in columns');
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
    const target = screen.getByLabelText('Workspace column ws-3');
    target.getBoundingClientRect = vi.fn(() => ({ left: 600, right: 960 }) as DOMRect);

    hydratedResizablePanelSizes.set(
      Object.fromEntries(
        ['ws-1', 'ws-2', 'ws-3'].flatMap((workspaceId) => [
          [`workspace-left-panel-width:${workspaceId}`, true],
          [`workspace-left-panel-expanded-width:${workspaceId}`, true],
        ]),
      ),
    );
    await tick();
    expect(scroller.scrollLeft).toBe(592);
    expect(scroller.getAttribute('data-anchored-workspace-column')).toBe('ws-3');
    return { scroller, target };
  }

  it('re-anchors the initial-jump target when widths change before the settle window ends', async () => {
    const { scroller, target } = await renderWithAnchoredInitialJump();

    // A late width report from a lazily mounted surface shifts the target
    // right while scrollLeft stays frozen — the anchor must re-align it.
    target.getBoundingClientRect = vi.fn(() => ({ left: 240, right: 600 }) as DOMRect);
    panelCanvasWidths.set({ 'ws-1': 960 });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scroller.scrollLeft).toBe(824);
    expect(scroller.getAttribute('data-anchored-workspace-column')).toBe('ws-3');
  });

  it('stops re-anchoring as soon as the user scrolls', async () => {
    const { scroller, target } = await renderWithAnchoredInitialJump();

    scroller.scrollLeft = 250;
    await fireEvent.scroll(scroller);
    expect(scroller.getAttribute('data-anchored-workspace-column')).toBeNull();

    target.getBoundingClientRect = vi.fn(() => ({ left: 240, right: 600 }) as DOMRect);
    panelCanvasWidths.set({ 'ws-1': 960 });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scroller.scrollLeft).toBe(250);
  });

  it('stops re-anchoring on wheel input even when scroll events still report the anchor position', async () => {
    const { scroller, target } = await renderWithAnchoredInitialJump();

    // Regression: shift+wheel left while the anchor is live. Scroll events are
    // frame-coalesced, so a same-frame re-anchor can make the scroll event
    // report the anchor position again — the position heuristic then never
    // fires and the anchor keeps snapping the view back right. The wheel
    // event itself must cancel the anchor, before any scroll event fires.
    await fireEvent.wheel(scroller, { deltaY: -120, shiftKey: true });
    expect(scroller.getAttribute('data-anchored-workspace-column')).toBeNull();

    // A late width report after the user wheel must NOT scroll programmatically.
    target.getBoundingClientRect = vi.fn(() => ({ left: 240, right: 600 }) as DOMRect);
    panelCanvasWidths.set({ 'ws-1': 960 });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scroller.scrollLeft).toBe(592);
  });

  it('does not re-anchor after the width-settle window has elapsed', async () => {
    const { scroller, target } = await renderWithAnchoredInitialJump();

    await new Promise((resolve) => setTimeout(resolve, 400));
    await tick();
    expect(scroller.getAttribute('data-anchored-workspace-column')).toBeNull();

    target.getBoundingClientRect = vi.fn(() => ({ left: 240, right: 600 }) as DOMRect);
    panelCanvasWidths.set({ 'ws-1': 960 });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scroller.scrollLeft).toBe(592);
  });

  it('keeps layout motion disabled until the post-jump settle window ends', async () => {
    const { scroller } = await renderWithAnchoredInitialJump();

    // lifecycleMotionReady flips after one rAF, but motion must stay snapped
    // while the anchor window is live so late width reports do not animate.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scroller.dataset.layoutMotionDuration).toBe('0');

    await new Promise((resolve) => setTimeout(resolve, 400));
    await tick();
    expect(scroller.getAttribute('data-anchored-workspace-column')).toBeNull();
    expect(scroller.dataset.layoutMotionDuration).toBe('180');
  });

  it('smooth-scrolls workspace switches after the initial mount reveal', async () => {
    render(WorkspaceColumnsView);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const scroller = screen.getByLabelText('Open spaces in columns');
    const target = screen.getByLabelText('Workspace column ws-3');
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
    target.getBoundingClientRect = vi.fn(() => ({ left: 900, right: 1260 }) as DOMRect);

    currentWorkspaceId.set('ws-3');
    await tick();
    await waitFor(() => expect(scroller.scrollLeft).toBe(892), { timeout: 1000 });
  });

  it('mounts only the landing window on initial mount, not intermediate columns', async () => {
    stubIntersectionObserver();
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    const rect = (left: number, right: number) =>
      ({ left, right, top: 0, bottom: 600, width: right - left, height: 600 }) as DOMRect;
    // Post-jump layout: the landing column (ws-3) sits in the viewport while
    // the columns scrolled past (ws-1, ws-2) are far outside root + overscan.
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.getAttribute?.('aria-label') === 'Open spaces in columns') return rect(0, 800);
      const stack = this.getAttribute?.('data-workspace-stack');
      if (stack === 'ws-1') return rect(-3000, -2640);
      if (stack === 'ws-2') return rect(-2640, -2280);
      if (stack === 'ws-3') return rect(0, 360);
      return rect(0, 0);
    };
    try {
      currentWorkspaceId.set('ws-3');
      render(WorkspaceColumnsView);
      await tick();

      const scroller = screen.getByLabelText('Open spaces in columns');
      // No observer entries have fired — the layout seed alone mounts the
      // landing window, and intermediate columns stay placeholders.
      expect(scroller.getAttribute('data-visible-workspace-columns')).toBe('ws-3');
      expect(surfaceFor('ws-3')).toBeTruthy();
      expect(placeholderFor('ws-1')).toBeTruthy();
      expect(placeholderFor('ws-2')).toBeTruthy();
      expect(surfaceFor('ws-1')).toBeNull();
      expect(surfaceFor('ws-2')).toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      vi.unstubAllGlobals();
    }
  });

  it('scrolls a newly selected workspace column into horizontal view', async () => {
    render(WorkspaceColumnsView);
    const scroller = screen.getByLabelText('Open spaces in columns');
    const target = screen.getByLabelText('Workspace column ws-3');
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
    target.getBoundingClientRect = vi.fn(() => ({ left: 900, right: 1260 }) as DOMRect);

    currentWorkspaceId.set('ws-3');
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(scroller.scrollLeft).toBe(892);
  });

  it('re-reveals the active workspace after remove, add, and reorder changes', async () => {
    render(WorkspaceColumnsView);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const scroller = screen.getByLabelText('Open spaces in columns');
    const target = screen.getByLabelText('Workspace column ws-2');
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);

    scroller.scrollLeft = 500;
    target.getBoundingClientRect = vi.fn(() => ({ left: -20, right: 340 }) as DOMRect);
    workspaceStacks.set([['ws-2'], ['ws-3']]);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(scroller.scrollLeft).toBe(472);

    target.getBoundingClientRect = vi.fn(() => ({ left: 600, right: 960 }) as DOMRect);
    workspaceStacks.set([['ws-1'], ['ws-2'], ['ws-3']]);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(scroller.scrollLeft).toBeCloseTo(1064);

    target.getBoundingClientRect = vi.fn(() => ({ left: 100, right: 460 }) as DOMRect);
    workspaceStacks.set([['ws-2'], ['ws-3'], ['ws-1']]);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(scroller.scrollLeft).toBe(1156);
  });

  it('aligns a newly selected visible workspace to the padded start edge', async () => {
    render(WorkspaceColumnsView);
    const scroller = screen.getByLabelText('Open spaces in columns');
    const target = screen.getByLabelText('Workspace column ws-3');
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
    target.getBoundingClientRect = vi.fn(() => ({ left: 400, right: 760 }) as DOMRect);

    currentWorkspaceId.set('ws-3');
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(scroller.scrollLeft).toBe(392);
  });

  it('reveals a newly opened panel from its canonical request after layout expands', async () => {
    render(WorkspaceColumnsView);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const scroller = screen.getByLabelText('Open spaces in columns');
    const panel = document.querySelector<HTMLElement>('[data-panel-id="panel-ws-2"]')!;
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
    panel.getBoundingClientRect = vi.fn(() => ({ left: 900, right: 1380 }) as DOMRect);

    panelRevealRequests.set({
      'ws-2': { panelId: 'panel-ws-2', tabId: 'new-tab', requestId: 'new-panel-request' },
    });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(scroller.scrollLeft).toBe(588);
  });

  it('does not scroll a newly opened panel that is already visible', async () => {
    render(WorkspaceColumnsView);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const scroller = screen.getByLabelText('Open spaces in columns');
    const panel = document.querySelector<HTMLElement>('[data-panel-id="panel-ws-2"]')!;
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
    panel.getBoundingClientRect = vi.fn(() => ({ left: 320, right: 700 }) as DOMRect);

    panelRevealRequests.set({
      'ws-2': { panelId: 'panel-ws-2', tabId: 'new-tab', requestId: 'visible-request' },
    });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(scroller.scrollLeft).toBe(0);
  });

  it.each([
    {
      label: 'normal motion',
      reducedMotion: false,
      viewportRight: 800,
      panelLeft: 700,
      panelRight: 900,
    },
    {
      label: 'reduced motion in a narrow 200% layout',
      reducedMotion: true,
      viewportRight: 400,
      panelLeft: -20,
      panelRight: 380,
    },
  ])(
    'reveals and consumes a reused panel once with $label',
    async ({ reducedMotion, viewportRight, panelLeft, panelRight }) => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: reducedMotion })),
      );
      render(WorkspaceColumnsView);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      const scroller = screen.getByLabelText('Open spaces in columns');
      const panel = document.querySelector<HTMLElement>('[data-panel-id="panel-ws-2"]')!;
      scroller.scrollLeft = 100;
      scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: viewportRight }) as DOMRect);
      panel.getBoundingClientRect = vi.fn(
        () => ({ left: panelLeft, right: panelRight }) as DOMRect,
      );

      panelRevealRequests.set({
        'ws-2': { panelId: 'panel-ws-2', tabId: 'tab-ws-2', requestId: 'reuse-request' },
      });
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 450));

      expect(scroller.scrollLeft).toBeCloseTo(reducedMotion ? 88 : 208, 0);
      expect(
        mocks.dispatch.mock.calls.filter(
          ([action]) => action.type === 'panelLayout/consumePanelReveal',
        ),
      ).toEqual([
        [
          {
            type: 'panelLayout/consumePanelReveal',
            payload: ['ws-2', 'reuse-request'],
          },
        ],
      ]);
      vi.unstubAllGlobals();
    },
  );

  it('ignores a stale reused-panel reveal after a newer request replaces it', async () => {
    render(WorkspaceColumnsView);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const scroller = screen.getByLabelText('Open spaces in columns');
    const panel = document.querySelector<HTMLElement>('[data-panel-id="panel-ws-2"]')!;
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
    panel.getBoundingClientRect = vi.fn(() => ({ left: 700, right: 900 }) as DOMRect);

    panelRevealRequests.set({
      'ws-2': { panelId: 'panel-ws-2', tabId: 'old-tab', requestId: 'old-request' },
    });
    await tick();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    panelRevealRequests.set({
      'ws-2': { panelId: 'panel-ws-2', tabId: 'new-tab', requestId: 'new-request' },
    });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(scroller.scrollLeft).toBe(108);
    expect(
      mocks.dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'panelLayout/consumePanelReveal'),
    ).toEqual([
      {
        type: 'panelLayout/consumePanelReveal',
        payload: ['ws-2', 'new-request'],
      },
    ]);
  });

  it('closes a column without activating it and routes away when closing the active column', async () => {
    render(WorkspaceColumnsView);

    const inactiveClose = screen.getByRole('button', { name: 'Close workspace ws-1' });
    await fireEvent.pointerDown(inactiveClose);
    await fireEvent.click(inactiveClose);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/closeWorkspaceTab',
      payload: ['ws-1', expect.any(Number)],
    });
    expect(mocks.dispatch).not.toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-1'],
    });
    expect(mocks.goto).not.toHaveBeenCalled();

    mocks.dispatch.mockClear();
    const activeClose = screen.getByRole('button', { name: 'Close workspace ws-2' });
    await fireEvent.click(activeClose);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/closeWorkspaceTab',
      payload: ['ws-2', expect.any(Number)],
    });
    expect(mocks.selectCurrentWorkspaceTabId).toHaveBeenCalledWith({});
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-3');
  });

  it('tracks per-stack column visibility with overscan on the columns scroller', async () => {
    stubIntersectionObserver();
    try {
      workspaceStacks.set([['ws-1', 'ws-2'], ['ws-3']]);
      render(WorkspaceColumnsView);
      await tick();

      const scroller = screen.getByLabelText('Open spaces in columns');
      const observer = MockIntersectionObserver.instances[0]!;
      const stackA = document.querySelector('[data-workspace-stack="ws-1,ws-2"]')!;
      const stackB = document.querySelector('[data-workspace-stack="ws-3"]')!;
      expect(observer.options).toEqual({
        root: scroller,
        rootMargin: '0px 100% 0px 100%',
        threshold: 0,
      });
      expect(observer.elements).toEqual(new Set([stackA, stackB]));
      expect(scroller.getAttribute('data-visible-workspace-columns')).toBe('');

      observer.fire([{ target: stackA, isIntersecting: true }]);
      await tick();
      expect(scroller.getAttribute('data-visible-workspace-columns')).toBe('ws-1,ws-2');

      observer.fire([
        { target: stackA, isIntersecting: false },
        { target: stackB, isIntersecting: true },
      ]);
      await tick();
      expect(scroller.getAttribute('data-visible-workspace-columns')).toBe('ws-3');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('mounts columns inside the layout-seeded window before the observer fires', async () => {
    stubIntersectionObserver();
    try {
      render(WorkspaceColumnsView);
      await tick();
      const scroller = screen.getByLabelText('Open spaces in columns');
      const rect = (left: number, right: number) =>
        ({ left, right, top: 0, bottom: 600, width: right - left, height: 600 }) as DOMRect;
      scroller.getBoundingClientRect = () => rect(0, 800);
      document.querySelector('[data-workspace-stack="ws-1"]')!.getBoundingClientRect = () =>
        rect(0, 360);
      document.querySelector('[data-workspace-stack="ws-2"]')!.getBoundingClientRect = () =>
        rect(360, 720);
      document.querySelector('[data-workspace-stack="ws-3"]')!.getBoundingClientRect = () =>
        rect(3000, 3360);

      // Re-running element tracking (stacks change) re-seeds from layout —
      // no MockIntersectionObserver entries have been fired.
      workspaceStacks.set([['ws-1'], ['ws-2'], ['ws-3']]);
      await tick();

      expect(scroller.getAttribute('data-visible-workspace-columns')).toBe('ws-1,ws-2');
      expect(surfaceFor('ws-1')).toBeTruthy();
      expect(surfaceFor('ws-2')).toBeTruthy();
      expect(placeholderFor('ws-3')).toBeTruthy();
      expect(surfaceFor('ws-3')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats every column as visible when IntersectionObserver is unavailable', async () => {
    render(WorkspaceColumnsView);
    await tick();

    const scroller = screen.getByLabelText('Open spaces in columns');
    expect(scroller.getAttribute('data-visible-workspace-columns')).toBe('ws-1,ws-2,ws-3');
    expect(surfaceFor('ws-1')).toBeTruthy();
    expect(surfaceFor('ws-2')).toBeTruthy();
    expect(surfaceFor('ws-3')).toBeTruthy();
    expect(document.querySelector('[data-workspace-column-placeholder]')).toBeNull();
  });

  it('renders placeholders for off-window columns while keeping the current column mounted', async () => {
    stubIntersectionObserver();
    try {
      render(WorkspaceColumnsView);
      await tick();
      const observer = MockIntersectionObserver.instances[0]!;

      // Nothing reported visible yet: only the current column (ws-2) mounts.
      expect(surfaceFor('ws-2')).toBeTruthy();
      expect(placeholderFor('ws-1')).toBeTruthy();
      expect(placeholderFor('ws-3')).toBeTruthy();
      expect(surfaceFor('ws-1')).toBeNull();
      expect(surfaceFor('ws-3')).toBeNull();

      observer.fire([
        { target: document.querySelector('[data-workspace-stack="ws-3"]')!, isIntersecting: true },
      ]);
      await tick();

      expect(surfaceFor('ws-3')).toBeTruthy();
      expect(placeholderFor('ws-3')).toBeNull();
      expect(surfaceFor('ws-2')).toBeTruthy();
      expect(placeholderFor('ws-1')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('activates and mounts an off-screen workspace on pointer-down on its placeholder', async () => {
    stubIntersectionObserver();
    try {
      render(WorkspaceColumnsView);
      await tick();

      const placeholder = placeholderFor('ws-1')!;
      expect(surfaceFor('ws-1')).toBeNull();
      await fireEvent.pointerDown(placeholder);

      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'tabState/openWorkspaceTab',
        payload: ['ws-1'],
      });
      expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1');

      currentWorkspaceId.set('ws-1');
      await tick();

      expect(surfaceFor('ws-1')).toBeTruthy();
      expect(placeholderFor('ws-1')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('mounts the target workspace when panel cycling crosses a column boundary', async () => {
    stubIntersectionObserver();
    try {
      panelCounts.set({ 'ws-1': 1, 'ws-2': 2, 'ws-3': 0 });
      render(WorkspaceColumnsView);
      await tick();
      const observer = MockIntersectionObserver.instances[0]!;
      observer.fire([
        { target: document.querySelector('[data-workspace-stack="ws-2"]')!, isIntersecting: true },
      ]);
      await tick();
      expect(placeholderFor('ws-1')).toBeTruthy();

      await fireEvent.click(screen.getByRole('button', { name: 'Cycle next panel from ws-2' }));

      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'tabState/openWorkspaceTab',
        payload: ['ws-1'],
      });
      expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1');

      currentWorkspaceId.set('ws-1');
      await tick();

      expect(surfaceFor('ws-1')).toBeTruthy();
      expect(placeholderFor('ws-1')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the drag source and drop target mounted for the duration of a drag', async () => {
    stubIntersectionObserver();
    try {
      render(WorkspaceColumnsView);
      await tick();
      const observer = MockIntersectionObserver.instances[0]!;
      const stackA = document.querySelector('[data-workspace-stack="ws-1"]')!;
      observer.fire([
        { target: stackA, isIntersecting: true },
        { target: document.querySelector('[data-workspace-stack="ws-2"]')!, isIntersecting: true },
      ]);
      await tick();
      expect(surfaceFor('ws-1')).toBeTruthy();

      const dataTransfer = {
        effectAllowed: 'none',
        dropEffect: 'none',
        setData: vi.fn(),
        getData: vi.fn(() => 'ws-1'),
        setDragImage: vi.fn(),
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
      const sourceTitle = screen
        .getByLabelText('Workspace column ws-1')
        .querySelector('[data-workspace-title-region]')!;
      await fireEvent(sourceTitle, dragEvent('dragstart', 120, 120));

      // The drag source scrolls out of the window mid-drag but stays mounted.
      observer.fire([{ target: stackA, isIntersecting: false }]);
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(surfaceFor('ws-1')).toBeTruthy();

      // Dragging over an off-screen placeholder column mounts it as a drop target.
      expect(placeholderFor('ws-3')).toBeTruthy();
      await fireEvent(screen.getByLabelText('Workspace column ws-3'), dragEvent('dragover', 5, 5));
      await tick();
      expect(surfaceFor('ws-3')).toBeTruthy();

      await fireEvent(screen.getByLabelText('Workspace column ws-1'), dragEvent('dragend', 0, 0));
      await tick();

      expect(placeholderFor('ws-1')).toBeTruthy();
      expect(placeholderFor('ws-3')).toBeTruthy();
      expect(surfaceFor('ws-2')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('delays unmounting a column that leaves the visibility window', async () => {
    stubIntersectionObserver();
    try {
      render(WorkspaceColumnsView);
      await tick();
      const observer = MockIntersectionObserver.instances[0]!;
      const stackC = document.querySelector('[data-workspace-stack="ws-3"]')!;
      observer.fire([{ target: stackC, isIntersecting: true }]);
      await tick();
      expect(surfaceFor('ws-3')).toBeTruthy();

      // Leaving the window keeps the surface mounted through the hysteresis delay.
      observer.fire([{ target: stackC, isIntersecting: false }]);
      await tick();
      expect(surfaceFor('ws-3')).toBeTruthy();

      // Re-entering within the delay cancels the pending unmount.
      observer.fire([{ target: stackC, isIntersecting: true }]);
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(surfaceFor('ws-3')).toBeTruthy();
      expect(placeholderFor('ws-3')).toBeNull();

      // Staying out of the window past the delay swaps in the placeholder.
      observer.fire([{ target: stackC, isIntersecting: false }]);
      await tick();
      expect(surfaceFor('ws-3')).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(surfaceFor('ws-3')).toBeNull();
      expect(placeholderFor('ws-3')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
