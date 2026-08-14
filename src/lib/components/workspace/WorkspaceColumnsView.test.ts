/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
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
const focusedPanelTargets = writable<
  Record<string, { panelId: string | null; activeTabId: string | null }>
>({});

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
  selectFocusedPanelTargetsByWorkspaceId: () => focusedPanelTargets,
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
          column.classList.contains('rounded-md') && column.classList.contains('bg-sidebar'),
      ),
    ).toBe(true);
    expect([...workspaceColumns].every((column) => column.classList.contains('shadow-md'))).toBe(
      true,
    );
    const columnsLayout = screen.getByLabelText('Open spaces in columns').firstElementChild;
    expect(columnsLayout?.classList.contains('gap-2')).toBe(true);
    expect(columnsLayout?.classList.contains('pt-2')).toBe(true);
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

  it('uses measured sidebar pixels instead of persisted percentage values', async () => {
    panelCounts.set({ 'ws-3': 2 });
    panelCanvasWidths.set({ 'ws-3': 960 });
    render(WorkspaceColumnsView);

    const panelColumn = document.querySelector<HTMLElement>('[data-workspace-stack="ws-3"]')!;
    expect(panelColumn.style.width).toBe('1336px');

    await fireEvent.click(document.querySelector('[data-mock-sidebar-width="ws-3"]')!);
    await tick();

    expect(panelColumn.style.width).toBe('1396px');
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

    const scroller = document.querySelector('[data-workspace-columns]');
    const columnsTrack = document.querySelector('[data-workspace-columns]')?.firstElementChild;

    expect(scroller?.classList.contains('scrollbar-none')).toBe(true);
    expect(scroller?.classList.contains('overflow-x-auto')).toBe(true);
    expect(columnsTrack?.classList.contains('pr-2')).toBe(true);
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

  it('captures Option+Shift+Arrow navigation from inputs and wraps column edges', async () => {
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
    const input = document.createElement('textarea');
    scroller.append(input);
    input.focus();
    const moveRight = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      code: 'ArrowRight',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    await fireEvent(input, moveRight);

    expect(moveRight.defaultPrevented).toBe(true);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-1'],
    });
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1');

    currentWorkspaceId.set('ws-1');
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(scroller.scrollLeft).toBe(500);

    mocks.dispatch.mockClear();
    mocks.goto.mockClear();
    await fireEvent.keyDown(input, {
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

  it('scrolls a newly selected workspace column into horizontal view', async () => {
    render(WorkspaceColumnsView);
    const scroller = screen.getByLabelText('Open spaces in columns');
    const target = screen.getByLabelText('Workspace column ws-3');
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
    target.getBoundingClientRect = vi.fn(() => ({ left: 900, right: 1260 }) as DOMRect);

    currentWorkspaceId.set('ws-3');
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: expect.stringMatching(/^(auto|smooth)$/),
      block: 'nearest',
      inline: 'nearest',
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('does not scroll a newly selected workspace that is already visible', async () => {
    render(WorkspaceColumnsView);
    const scroller = screen.getByLabelText('Open spaces in columns');
    const target = screen.getByLabelText('Workspace column ws-3');
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
    target.getBoundingClientRect = vi.fn(() => ({ left: 500, right: 860 }) as DOMRect);

    currentWorkspaceId.set('ws-3');
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('reveals a newly opened panel once after its workspace width expands', async () => {
    render(WorkspaceColumnsView);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const scroller = screen.getByLabelText('Open spaces in columns');
    const panel = document.querySelector<HTMLElement>('[data-panel-id="panel-ws-2"]')!;
    const scrollIntoView = vi.fn();
    panel.scrollIntoView = scrollIntoView;
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
    panel.getBoundingClientRect = vi.fn(() => ({ left: 900, right: 1380 }) as DOMRect);

    focusedPanelTargets.set({
      'ws-2': { panelId: 'panel-ws-2', activeTabId: null },
    });
    panelCounts.set({ 'ws-2': 1 });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: expect.stringMatching(/^(auto|smooth)$/),
      block: 'nearest',
      inline: 'end',
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('does not scroll a newly opened panel that is already visible', async () => {
    render(WorkspaceColumnsView);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const scroller = screen.getByLabelText('Open spaces in columns');
    const panel = document.querySelector<HTMLElement>('[data-panel-id="panel-ws-2"]')!;
    const scrollIntoView = vi.fn();
    panel.scrollIntoView = scrollIntoView;
    scroller.getBoundingClientRect = vi.fn(() => ({ left: 0, right: 800 }) as DOMRect);
    panel.getBoundingClientRect = vi.fn(() => ({ left: 320, right: 700 }) as DOMRect);

    focusedPanelTargets.set({
      'ws-2': { panelId: 'panel-ws-2', activeTabId: null },
    });
    panelCounts.set({ 'ws-2': 1 });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(scrollIntoView).not.toHaveBeenCalled();
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
});
