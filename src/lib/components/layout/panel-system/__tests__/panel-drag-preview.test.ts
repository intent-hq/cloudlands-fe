/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PanelDragPreview from '../PanelDragPreview.svelte';
import { PANE_DROP_PREVIEW_PANEL_ID } from '$features/layout/panel-move-preview';
import type { PanelState } from '$store/renderer/slices/panel-layout/panel-layout-types';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  initializeLayout,
  setRestoreStatus,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { endDrag, startDrag } from '$store/renderer/slices/tab-state/tab-state-slice';
import { PANE_DRAG_MIME, clearDraggedPaneState, setDraggedPane } from '../panel-drag';

vi.mock('../Panel.svelte', async () => ({
  default: (await import('./mocks/PaneDragRoutingPanel.svelte')).default,
}));

import PanelLayout from '../PanelLayout.svelte';

function panel(panelId: string, paneIds: string[], activeTabId = paneIds[0]): PanelState {
  return {
    id: panelId,
    tabs: paneIds.map((id) => ({ id, type: 'note', title: `${id} title`, closable: true })),
    activeTabId: activeTabId ?? null,
  };
}

function addSourcePanel(state: PanelState): HTMLElement {
  const panel = document.createElement('section');
  panel.dataset.panelId = state.id;
  panel.className = 'actual-panel-shell';
  const active = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
  panel.innerHTML = `<header data-pane-stack data-pane-stack-size="${state.tabs.length}">
    <div data-pane-stack-active="${active?.id ?? ''}"><span data-panel-header-title>${active?.title ?? ''}</span></div>
  </header><main class="panel-content">${state.tabs
    .map(
      (tab) =>
        `<div class="tab-content-wrapper ${tab.id === active?.id ? '' : 'hidden'}" data-tab-id="${tab.id}" aria-hidden="${tab.id !== active?.id}"><input value="initial"><span>${tab.id} content</span></div>`,
    )
    .join('')}</main>`;
  panel.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    input.value = `${input.parentElement?.dataset.tabId ?? ''} state`;
  });
  document.body.append(panel);
  return panel;
}

function addPanelModeStyles(): HTMLStyleElement {
  const styles = document.createElement('style');
  styles.textContent = `
    .actual-panel-shell .panel-content {
      padding-inline-start: 24px;
      padding-inline-end: 20px;
    }
    .actual-panel-shell.contained .panel-content {
      padding-inline-start: 8px;
      padding-inline-end: 8px;
    }
  `;
  document.head.append(styles);
  return styles;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
    return this.classList.contains('panel-drag-preview-split') ? 1000 : 0;
  });
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('.actual-panel-shell').forEach((panel) => panel.remove());
  vi.restoreAllMocks();
});

describe('PanelLayout drag preview overlay', () => {
  const STORE_CONTEXT = 'redux-store-context';
  const WORKSPACE_ID = 'panel-drag-preview-overlay';
  const PANEL_WIDTH = 400;
  let storeContext: ReduxStoreContext | undefined;

  class TestResizeObserver {
    observe() {}
    disconnect() {}
  }

  function rect(left: number, right: number): DOMRect {
    return { left, right, top: 0, bottom: 400, width: right - left, height: 400 } as DOMRect;
  }

  function dragOver(clientX: number): DragEvent {
    const event = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperties(event, {
      clientX: { value: clientX },
      clientY: { value: 20 },
      dataTransfer: { value: { dropEffect: 'none', types: [PANE_DRAG_MIME] } },
    });
    return event;
  }

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
      if (this.getAttribute('data-testid') === 'panel-workspace-inset') return PANEL_WIDTH * 2;
      return this.classList.contains('panel-drag-preview-split') ? 1000 : 0;
    });
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
    storeContext = initAppStore(appStore);
  });

  afterEach(() => {
    clearDraggedPaneState();
    appStore.dispatch(endDrag());
    cleanup();
    storeContext?.dispose();
    storeContext = undefined;
    vi.unstubAllGlobals();
  });

  // A one-pane source column plus a two-pane target; dragging the target's
  // first pane to the layout's leading edge projects a third column, so the
  // projected canvas is wider than the committed one.
  async function projectNewColumn(props: {
    contained: boolean;
    onPanelMovePreviewWidthRatioChange?: (ratio: number) => void;
  }) {
    appStore.dispatch(
      initializeLayout(WORKSPACE_ID, {
        root: {
          type: 'split',
          direction: 'horizontal',
          sizes: [50, 50],
          children: [
            { type: 'panel', panelId: 'source-panel' },
            { type: 'panel', panelId: 'target-panel' },
          ],
        },
        panels: {
          'source-panel': panel('source-panel', ['source']),
          'target-panel': panel('target-panel', ['one', 'two']),
        },
        focusedPanelId: 'target-panel',
        canvasWidth: PANEL_WIDTH * 2,
      }),
    );
    appStore.dispatch(setRestoreStatus(WORKSPACE_ID, 'restored'));
    const { container } = render(PanelLayout, {
      props: {
        workspaceId: WORKSPACE_ID,
        layoutId: WORKSPACE_ID,
        canvasSizing: props.contained ? 'content' : 'viewport',
        ...props,
      },
      context: new Map([[STORE_CONTEXT, storeContext]]),
    });
    const sourcePanel = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-panel-id="source-panel"]');
      expect(element).toBeTruthy();
      return element!;
    });
    sourcePanel.getBoundingClientRect = () => rect(0, PANEL_WIDTH);
    container.querySelector<HTMLElement>('[data-panel-id="target-panel"]')!.getBoundingClientRect =
      () => rect(PANEL_WIDTH + 8, PANEL_WIDTH * 2 + 8);
    container.querySelector<HTMLElement>('[data-panel-layout-motion]')!.getBoundingClientRect =
      () => rect(0, PANEL_WIDTH * 2 + 8);
    setDraggedPane({ tabId: 'one', panelId: 'target-panel' });
    appStore.dispatch(startDrag());

    await fireEvent(sourcePanel, dragOver(10));
    const overlay = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        '[data-panel-layout-drag-preview="before"]',
      );
      expect(element).toBeTruthy();
      return element!;
    });
    return { container, overlay };
  }

  // The overlay is a pure projection: it must let pointer events fall through
  // to the real panels beneath it (drop targets keep receiving dragover) and
  // pin itself to the layout's leading edge and full height above the panels.
  function expectOverlayShell(overlay: HTMLElement) {
    for (const className of [
      'pointer-events-none',
      'absolute',
      'inset-y-0',
      'left-0',
      'z-40',
      'box-content',
    ]) {
      expect(overlay.classList.contains(className), className).toBe(true);
    }
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
  }

  it('projects the wider canvas itself when a contained layout has no outer owner', async () => {
    const { container, overlay } = await projectNewColumn({ contained: true });

    expect(container.querySelectorAll('[data-panel-layout-preview-panel]')).toHaveLength(3);
    const ratio = Number.parseFloat(overlay.style.width) / 100;
    expect(ratio).toBeGreaterThan(1);
    expectOverlayShell(overlay);
    expect(overlay.classList.contains('px-2')).toBe(true);
    expect(overlay.classList.contains('pr-2')).toBe(false);
    expect(overlay.classList.contains('sm:pr-3')).toBe(false);
  });

  it('lets the outer workspace own the projected width when it subscribes to the ratio', async () => {
    const onPanelMovePreviewWidthRatioChange = vi.fn();
    const { overlay } = await projectNewColumn({
      contained: true,
      onPanelMovePreviewWidthRatioChange,
    });

    expect(overlay.style.width).toBe('100%');
    expect(onPanelMovePreviewWidthRatioChange).toHaveBeenCalledTimes(1);
    const [reportedRatio] = onPanelMovePreviewWidthRatioChange.mock.calls[0];
    expect(reportedRatio).toBeGreaterThan(1);

    clearDraggedPaneState();
    appStore.dispatch(endDrag());
    await waitFor(() => expect(onPanelMovePreviewWidthRatioChange).toHaveBeenLastCalledWith(1));
  });

  it('keeps the viewport layout overlay at full width with the trailing inset only', async () => {
    const { overlay } = await projectNewColumn({ contained: false });

    expect(overlay.style.width).toBe('100%');
    expectOverlayShell(overlay);
    expect(overlay.classList.contains('pr-2')).toBe(true);
    expect(overlay.classList.contains('sm:pr-3')).toBe(true);
    expect(overlay.classList.contains('px-2')).toBe(false);
  });
});

describe('PanelDragPreview', () => {
  it.each([
    ['left source to right destination', ['target-panel', 'source-panel']],
    ['right source to left destination', ['source-panel', 'target-panel']],
  ] as const)('renders a one-pane column reorder from inert snapshots for %s', (_, panelOrder) => {
    const sourceState = panel('source-panel', ['source']);
    const targetState = panel('target-panel', ['target']);
    const source = addSourcePanel(sourceState);
    const target = addSourcePanel(targetState);
    const { container } = render(PanelDragPreview, {
      props: {
        panels: { 'source-panel': sourceState, 'target-panel': targetState },
        draggedPanelId: 'source-panel',
        contained: true,
        node: {
          type: 'split',
          direction: 'horizontal',
          sizes: [50, 50],
          children: panelOrder.map((panelId) => ({ type: 'panel' as const, panelId })),
        },
      },
    });

    expect(container.querySelector('[data-panel-layout-preview-split="horizontal"]')).toBeTruthy();
    expect(container.querySelector('.panel-drag-preview-split')).toBeTruthy();
    const snapshots = [
      ...container.querySelectorAll<HTMLElement>('[data-panel-layout-preview-snapshot]'),
    ];
    expect(snapshots.map((snapshot) => snapshot.dataset.panelLayoutPreviewSnapshot)).toEqual(
      panelOrder,
    );
    expect(container.textContent).toContain('target content');
    expect(container.textContent).toContain('source content');
    expect(container.querySelector('[data-panel-id]')).toBeNull();
    expect(snapshots.every((snapshot) => snapshot.inert)).toBe(true);
    const previewSplit = container.querySelector<HTMLElement>(
      '[data-panel-layout-preview-split="horizontal"]',
    )!;
    const previewColumns = previewSplit.querySelectorAll<HTMLElement>(
      ':scope > .panel-drag-preview-child',
    );
    expect([...previewColumns].map((column) => column.style.flex)).toEqual([
      '0 0 496px',
      '0 0 496px',
    ]);
    expect(
      previewSplit.querySelector<HTMLElement>('[data-panel-layout-preview-gutter]')?.style.width,
    ).toBe('8px');
    const sourceSnapshot = snapshots.find(
      (snapshot) => snapshot.dataset.panelLayoutPreviewSnapshot === 'source-panel',
    )!;
    expect(sourceSnapshot.querySelector('input')?.value).toBe('source state');
    expect(snapshots[0].style.animation).toBe('none');
    const draggedPreview = container.querySelector<HTMLElement>(
      '[data-panel-layout-preview-dragged]',
    );
    expect(draggedPreview).toBe(sourceSnapshot.parentElement?.parentElement);
    expect(draggedPreview?.children).toHaveLength(2);
    const destinations = container.querySelectorAll<HTMLElement>('[data-panel-drop-destination]');
    expect(destinations).toHaveLength(1);
    expect(destinations[0].parentElement).toBe(draggedPreview);
    expect(destinations[0].classList).toContain('panel-drop-destination');
    expect(
      [...(draggedPreview?.classList ?? [])].some(
        (className) => className.startsWith('border') || className.startsWith('bg-'),
      ),
    ).toBe(false);

    source.remove();
    target.remove();
  });

  it('uses the dragged source snapshot for a projected new-column destination', () => {
    const sourceState = panel('source-panel', ['drag']);
    const destinationState = { ...sourceState, id: PANE_DROP_PREVIEW_PANEL_ID };
    const source = addSourcePanel(sourceState);
    const { container } = render(PanelDragPreview, {
      props: {
        panels: { [PANE_DROP_PREVIEW_PANEL_ID]: destinationState },
        draggedPanelId: PANE_DROP_PREVIEW_PANEL_ID,
        draggedPanelSourceId: 'source-panel',
        node: { type: 'panel', panelId: PANE_DROP_PREVIEW_PANEL_ID },
      },
    });

    const destination = container.querySelector<HTMLElement>('[data-panel-layout-preview-dragged]');
    const snapshot = destination?.querySelector<HTMLElement>(
      '[data-panel-layout-preview-snapshot]',
    );
    expect(destination?.dataset.panelLayoutPreviewPanel).toBe(PANE_DROP_PREVIEW_PANEL_ID);
    expect(snapshot?.dataset.panelLayoutPreviewSnapshot).toBe(PANE_DROP_PREVIEW_PANEL_ID);
    expect(snapshot?.dataset.panelLayoutPreviewSnapshotSource).toBe('source-panel');
    expect(snapshot?.textContent).toContain('drag content');
    expect(destination?.querySelectorAll('[data-panel-drop-destination]')).toHaveLength(1);

    source.remove();
  });

  it('keeps the same inert snapshot when projected panel inputs are unchanged', async () => {
    const sourceState = panel('source-panel', ['drag']);
    const source = addSourcePanel(sourceState);
    const props = {
      panels: { 'source-panel': sourceState },
      draggedPanelId: 'source-panel',
      node: { type: 'panel' as const, panelId: 'source-panel' },
    };
    const result = render(PanelDragPreview, { props });
    const firstSnapshot = result.container.querySelector('[data-panel-layout-preview-snapshot]');

    await result.rerender({ ...props, panels: { 'source-panel': sourceState } });
    await tick();

    expect(result.container.querySelector('[data-panel-layout-preview-snapshot]')).toBe(
      firstSnapshot,
    );
    source.remove();
  });

  it('renders a center merge once and removes the one-pane source column', () => {
    const sourceState = panel('source-panel', ['drag']);
    const targetState = panel('target-panel', ['target']);
    const projectedTarget = panel('target-panel', ['target', 'drag'], 'drag');
    const source = addSourcePanel(sourceState);
    const target = addSourcePanel(targetState);
    const { container } = render(PanelDragPreview, {
      props: {
        panels: { 'target-panel': projectedTarget },
        draggedPanelId: 'target-panel',
        draggedPanelSourceId: 'source-panel',
        node: { type: 'panel', panelId: 'target-panel' },
      },
    });

    expect(container.querySelector('[data-panel-layout-preview-panel="source-panel"]')).toBeNull();
    expect(container.querySelectorAll('[data-tab-id="drag"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-tab-id="target"]')).toHaveLength(0);
    expect(container.textContent).toContain('drag title');
    expect(container.querySelector('[data-pane-stack]')?.getAttribute('data-pane-stack-size')).toBe(
      '2',
    );

    source.remove();
    target.remove();
  });

  it('reveals the next source pane while showing the dragged pane at its side destination', () => {
    const sourceState = panel('source-panel', ['drag', 'under'], 'drag');
    const targetState = panel('target-panel', ['target']);
    const projectedSource = panel('source-panel', ['under'], 'under');
    const destinationState = panel(PANE_DROP_PREVIEW_PANEL_ID, ['drag'], 'drag');
    const source = addSourcePanel(sourceState);
    const target = addSourcePanel(targetState);
    const { container } = render(PanelDragPreview, {
      props: {
        panels: {
          'source-panel': projectedSource,
          'target-panel': targetState,
          [PANE_DROP_PREVIEW_PANEL_ID]: destinationState,
        },
        draggedPanelId: PANE_DROP_PREVIEW_PANEL_ID,
        draggedPanelSourceId: 'source-panel',
        node: {
          type: 'split',
          direction: 'horizontal',
          sizes: [33, 33, 34],
          children: [
            { type: 'panel', panelId: 'source-panel' },
            { type: 'panel', panelId: PANE_DROP_PREVIEW_PANEL_ID },
            { type: 'panel', panelId: 'target-panel' },
          ],
        },
      },
    });

    expect(container.querySelectorAll('[data-tab-id="drag"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-tab-id="under"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-panel-layout-preview-panel="source-panel"]')?.textContent,
    ).toContain('under content');
    expect(
      container.querySelector(`[data-panel-layout-preview-panel="${PANE_DROP_PREVIEW_PANEL_ID}"]`)
        ?.textContent,
    ).toContain('drag content');
    const previewColumns = container.querySelectorAll<HTMLElement>(
      '[data-panel-layout-preview-split="horizontal"] > .panel-drag-preview-child',
    );
    expect([...previewColumns].map((column) => column.style.flex)).toEqual([
      '0 0 324.72px',
      '0 0 324.72px',
      '0 0 334.56px',
    ]);
    expect(container.querySelectorAll('[data-panel-layout-preview-gutter]')).toHaveLength(2);

    source.remove();
    target.remove();
  });

  it.each([
    { contained: false, expectedPadding: ['24px', '20px'] },
    { contained: true, expectedPadding: ['8px', '8px'] },
  ])(
    'preserves content classes and inline padding during panel-header move preview (contained=$contained)',
    ({ contained, expectedPadding }) => {
      const styles = addPanelModeStyles();
      const draggedState = panel('dragged-panel', ['dragged']);
      const stableState = panel('stable-panel', ['stable']);
      const dragged = addSourcePanel(draggedState);
      const stable = addSourcePanel(stableState);
      stable.classList.toggle('contained', contained);
      const stableContent = stable.querySelector<HTMLElement>('.panel-content');
      const { container } = render(PanelDragPreview, {
        props: {
          panels: { 'dragged-panel': draggedState, 'stable-panel': stableState },
          draggedPanelId: 'dragged-panel',
          node: {
            type: 'split',
            direction: 'horizontal',
            sizes: [50, 50],
            children: [
              { type: 'panel', panelId: 'dragged-panel' },
              { type: 'panel', panelId: 'stable-panel' },
            ],
          },
        },
      });

      const snapshot = container.querySelector<HTMLElement>(
        '[data-panel-layout-preview-snapshot="stable-panel"]',
      );
      const snapshotContent = snapshot?.querySelector<HTMLElement>('.panel-content');
      expect(snapshot?.classList.contains('contained')).toBe(contained);
      expect(snapshotContent?.className).toBe(stableContent?.className);
      expect(stableContent).toBeTruthy();
      expect(snapshotContent).toBeTruthy();
      expect([
        getComputedStyle(snapshotContent!).paddingInlineStart,
        getComputedStyle(snapshotContent!).paddingInlineEnd,
      ]).toEqual(expectedPadding);
      expect([
        getComputedStyle(stableContent!).paddingInlineStart,
        getComputedStyle(stableContent!).paddingInlineEnd,
      ]).toEqual(expectedPadding);

      dragged.remove();
      stable.remove();
      styles.remove();
    },
  );
});
