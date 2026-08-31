import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  closePanel,
  initializeLayout,
  preparePanelLayoutBackendRestore,
  setRestoreStatus,
  splitPanel,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import {
  selectPanelCanvasWidth,
  selectPanelLayoutRoot,
  selectPanels,
} from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import { resizePanelWidthsAtDivider } from '$shared/panel-layout-sizing';

vi.mock('../Panel.svelte', async () => ({
  default: (await import('./mocks/MockMountedPanel.svelte')).default,
}));

import PanelLayout from '../PanelLayout.svelte';

const STORE_CONTEXT = 'redux-store-context';
const WORKSPACE_ID = 'root-horizontal-resize';
const GUTTER_WIDTH = 8;
const INITIAL_CANVAS_WIDTH = 1200;
const INITIAL_CONTENT_WIDTH = 1184;
const INITIAL_WIDTHS = [320, 500, 364];
let storeContext: ReduxStoreContext | undefined;
let measuredViewportWidth = INITIAL_CANVAS_WIDTH;

class TestResizeObserver {
  static instances = new Set<TestResizeObserver>();
  constructor(private callback: ResizeObserverCallback) {
    TestResizeObserver.instances.add(this);
  }
  observe() {}
  disconnect() {
    TestResizeObserver.instances.delete(this);
  }
  static flush() {
    for (const observer of TestResizeObserver.instances) {
      observer.callback([], observer as unknown as ResizeObserver);
    }
  }
}

function flexWidth(element: HTMLElement): number {
  return Number.parseFloat(element.style.flex.match(/([\d.]+)px/)?.[1] ?? '0');
}

function canvasWidth(): number {
  let node = document.querySelector<HTMLElement>('.panel-split-container.horizontal');
  while (node && !node.style.width) node = node.parentElement;
  return Number.parseFloat(node?.style.width ?? '0');
}

function panelGeometry() {
  const root = document.querySelector<HTMLElement>('.panel-split-container.horizontal')!;
  const panels = Array.from(root.querySelectorAll<HTMLElement>(':scope > .panel-split-child'));
  let left = 0;
  return panels.map((panel, index) => {
    const width = flexWidth(panel);
    const geometry = { left, width, right: left + width };
    left += width + (index < panels.length - 1 ? GUTTER_WIDTH : 0);
    return geometry;
  });
}

function expectGeometry(actual: ReturnType<typeof panelGeometry>, expectedWidths: number[]) {
  let left = 0;
  expectedWidths.forEach((width, index) => {
    expect(actual[index].left).toBeCloseTo(left, 6);
    expect(actual[index].width).toBeCloseTo(width, 6);
    expect(actual[index].right).toBeCloseTo(left + width, 6);
    left += width + (index < expectedWidths.length - 1 ? GUTTER_WIDTH : 0);
  });
}

function initializeThreePanels() {
  appStore.dispatch(
    initializeLayout(WORKSPACE_ID, {
      root: {
        type: 'split',
        direction: 'horizontal',
        sizes: INITIAL_WIDTHS.map((width) => (width / INITIAL_CONTENT_WIDTH) * 100),
        children: ['p1', 'p2', 'p3'].map((panelId) => ({ type: 'panel' as const, panelId })),
      },
      panels: Object.fromEntries(
        ['p1', 'p2', 'p3'].map((panelId) => [
          panelId,
          { id: panelId, tabs: [], activeTabId: null },
        ]),
      ),
      focusedPanelId: 'p1',
      canvasWidth: INITIAL_CANVAS_WIDTH,
      canvasWidthSource: 'explicit',
    }),
  );
  appStore.dispatch(setRestoreStatus(WORKSPACE_ID, 'restored'));
}

async function renderLayout(contained: boolean, expectedCanvasWidth = INITIAL_CANVAS_WIDTH) {
  const result = render(PanelLayout, {
    props: {
      workspaceId: WORKSPACE_ID,
      layoutId: WORKSPACE_ID,
      contained,
      canvasSizing: contained ? ('content' as const) : ('viewport' as const),
    },
    context: new Map([[STORE_CONTEXT, storeContext]]),
  });
  await waitFor(() => {
    expect(canvasWidth()).toBe(expectedCanvasWidth);
  });
  // The initial viewport measurement runs in the batched layout read phase
  // (one rAF after mount), so flush a frame before tests measure or drag.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await tick();
  return result;
}

function splitHandle(index: number): HTMLButtonElement {
  const root = document.querySelector<HTMLElement>('.panel-split-container.horizontal')!;
  return Array.from(
    root.querySelectorAll<HTMLButtonElement>(
      ':scope > .panel-split-handle-wrapper > button[data-resize-axis="x"]',
    ),
  )[index];
}

async function dragSplit(index: number, cumulativeDeltas: number[]) {
  const handle = splitHandle(index);
  await fireEvent.mouseDown(handle, { clientX: 100 });
  await tick();
  const pointerDown = panelGeometry();
  for (const delta of cumulativeDeltas) {
    await fireEvent.mouseMove(window, { clientX: 100 + delta });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await tick();
  }
  const preview = panelGeometry();
  const previewCanvasWidth = canvasWidth();
  await fireEvent.mouseUp(window);
  await tick();
  return { pointerDown, preview, previewCanvasWidth };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
    if (this.classList.contains('panel-split-handle-wrapper')) return GUTTER_WIDTH;
    return Number.parseFloat(this.style.width) || 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
    if (this.dataset.testid === 'panel-workspace-inset') return measuredViewportWidth;
    return Number.parseFloat(this.style.width) || 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const width = this.classList.contains('panel-split-child')
      ? flexWidth(this)
      : Number.parseFloat(this.style.width) || 0;
    return {
      width,
      height: 800,
      top: 0,
      right: width,
      bottom: 800,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
  storeContext = initAppStore(appStore);
  measuredViewportWidth = INITIAL_CANVAS_WIDTH;
  initializeThreePanels();
});

afterEach(() => {
  cleanup();
  storeContext?.dispose();
  storeContext = undefined;
  TestResizeObserver.instances.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('root horizontal panel resizing', () => {
  it('fills the measured viewport when a one-panel workspace restores a skinny explicit canvas', async () => {
    appStore.dispatch(preparePanelLayoutBackendRestore(WORKSPACE_ID));
    appStore.dispatch(
      initializeLayout(WORKSPACE_ID, {
        root: { type: 'panel', panelId: 'restored' },
        panels: {
          restored: { id: 'restored', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'restored',
        canvasWidth: 420,
        canvasWidthSource: 'explicit',
      }),
    );
    appStore.dispatch(setRestoreStatus(WORKSPACE_ID, 'restored'));

    await renderLayout(false, INITIAL_CANVAS_WIDTH);
    expect(canvasWidth()).toBe(INITIAL_CANVAS_WIDTH);
  });

  it.each([600, 2400])(
    'normalizes a restored %spx root canvas and keeps its relative panel widths',
    async (persistedCanvasWidth) => {
      appStore.dispatch(
        initializeLayout(WORKSPACE_ID, {
          root: {
            type: 'split',
            direction: 'horizontal',
            sizes: [20, 30, 50],
            children: ['p1', 'p2', 'p3'].map((panelId) => ({
              type: 'panel' as const,
              panelId,
            })),
          },
          panels: Object.fromEntries(
            ['p1', 'p2', 'p3'].map((panelId) => [
              panelId,
              { id: panelId, tabs: [], activeTabId: null },
            ]),
          ),
          focusedPanelId: 'p1',
          canvasWidth: persistedCanvasWidth,
          canvasWidthSource: 'explicit',
        }),
      );
      appStore.dispatch(setRestoreStatus(WORKSPACE_ID, 'restored'));

      await renderLayout(false, INITIAL_CANVAS_WIDTH);
      expectGeometry(panelGeometry(), [236.8, 355.2, 592]);
    },
  );

  it('keeps the viewport filled after adding and closing a restored root column', async () => {
    appStore.dispatch(preparePanelLayoutBackendRestore(WORKSPACE_ID));
    appStore.dispatch(
      initializeLayout(WORKSPACE_ID, {
        root: { type: 'panel', panelId: 'p1' },
        panels: {
          p1: {
            id: 'p1',
            tabs: [{ id: 'note', type: 'note', title: 'Note', noteId: 'note' }],
            activeTabId: 'note',
          },
        },
        focusedPanelId: 'p1',
        columnCount: 1,
        canvasWidth: 420,
        canvasWidthSource: 'explicit',
      }),
    );
    appStore.dispatch(setRestoreStatus(WORKSPACE_ID, 'restored'));
    await renderLayout(false, INITIAL_CANVAS_WIDTH);

    const split = splitPanel(WORKSPACE_ID, 'p1', 'horizontal', undefined, 10);
    appStore.dispatch(split);
    await waitFor(() => expect(panelGeometry()).toHaveLength(2));
    expect(panelGeometry().reduce((sum, panel) => sum + panel.width, 0) + GUTTER_WIDTH).toBeCloseTo(
      INITIAL_CANVAS_WIDTH,
      6,
    );

    appStore.dispatch(closePanel(WORKSPACE_ID, split.payload.newPanelId, 20));
    await waitFor(() => expect(canvasWidth()).toBe(INITIAL_CANVAS_WIDTH));
  });

  it('refits restored root proportions when the measured viewport resizes', async () => {
    await renderLayout(false);
    measuredViewportWidth = 800;
    TestResizeObserver.flush();
    await waitFor(() => expect(canvasWidth()).toBe(800));

    const scale = (800 - GUTTER_WIDTH * 2) / INITIAL_CONTENT_WIDTH;
    expectGeometry(
      panelGeometry(),
      INITIAL_WIDTHS.map((width) => width * scale),
    );
  });

  it('keeps the viewport fixed while its right edge updates relative proportions', async () => {
    await renderLayout(false);
    const handle = document.querySelector<HTMLButtonElement>('.panel-canvas-resize-handle')!;
    await fireEvent.mouseDown(handle, { clientX: 1200 });
    await fireEvent.mouseMove(document, { clientX: 1290 });
    await tick();
    expect(canvasWidth()).toBe(INITIAL_CANVAS_WIDTH);
    expect(
      panelGeometry().reduce((sum, panel) => sum + panel.width, 0) + GUTTER_WIDTH * 2,
    ).toBeCloseTo(INITIAL_CANVAS_WIDTH, 6);
    await fireEvent.mouseUp(document);
    await waitFor(() => expect(canvasWidth()).toBe(INITIAL_CANVAS_WIDTH));
  });

  it.each([true, false])(
    'keeps the canvas fixed through proportional resize, commit, and measurement (contained=%s)',
    async (contained) => {
      await renderLayout(contained);
      const initialWidths = panelGeometry().map(({ width }) => width);
      const expanded = await dragSplit(0, [32, 96]);
      const expandedWidths = resizePanelWidthsAtDivider(initialWidths, 0, 96).panelWidths;

      expectGeometry(expanded.pointerDown, initialWidths);
      expectGeometry(expanded.preview, expandedWidths);
      expect(expanded.previewCanvasWidth).toBeCloseTo(INITIAL_CANVAS_WIDTH, 6);
      expectGeometry(panelGeometry(), expandedWidths);
      expect(selectPanelCanvasWidth.select(appStore.state, WORKSPACE_ID)).toBeCloseTo(
        INITIAL_CANVAS_WIDTH,
        6,
      );

      TestResizeObserver.flush();
      await tick();
      expectGeometry(panelGeometry(), expandedWidths);

      const shrunk = await dragSplit(0, [-40, -140]);
      const shrunkWidths = resizePanelWidthsAtDivider(expandedWidths, 0, -140).panelWidths;
      expectGeometry(shrunk.pointerDown, expandedWidths);
      expectGeometry(shrunk.preview, shrunkWidths);
      expect(shrunk.previewCanvasWidth).toBeCloseTo(INITIAL_CANVAS_WIDTH, 6);
      expectGeometry(panelGeometry(), shrunkWidths);
      expect(selectPanelCanvasWidth.select(appStore.state, WORKSPACE_ID)).toBeCloseTo(
        INITIAL_CANVAS_WIDTH,
        6,
      );
    },
  );

  it('preserves the left side while resizing the second divider', async () => {
    await renderLayout(true);
    const inset = document.querySelector<HTMLElement>('[data-testid="panel-workspace-inset"]')!;
    inset.scrollLeft = 180;

    const result = await dragSplit(1, [-25, -80]);

    expectGeometry(result.pointerDown, INITIAL_WIDTHS);
    const expected = resizePanelWidthsAtDivider(INITIAL_WIDTHS, 1, -80).panelWidths;
    expectGeometry(result.preview, expected);
    expect(result.previewCanvasWidth).toBe(INITIAL_CANVAS_WIDTH);
    expectGeometry(panelGeometry(), expected);
    expect(inset.scrollLeft).toBe(180);
  });

  it('clamps at the reference minimum in preview and keeps the canvas fixed', async () => {
    await renderLayout(true);

    const result = await dragSplit(0, [-1000]);

    const expected = resizePanelWidthsAtDivider(INITIAL_WIDTHS, 0, -1000).panelWidths;
    expectGeometry(result.preview, expected);
    expect(result.previewCanvasWidth).toBe(INITIAL_CANVAS_WIDTH);
    expectGeometry(panelGeometry(), expected);
    expect(selectPanelCanvasWidth.select(appStore.state, WORKSPACE_ID)).toBe(INITIAL_CANVAS_WIDTH);
  });

  it('changes only the final panel at the outer edge and has no pointer-up jump', async () => {
    await renderLayout(true);
    const handle = document.querySelector<HTMLButtonElement>('.panel-canvas-resize-handle')!;
    const inset = document.querySelector<HTMLElement>('[data-testid="panel-workspace-inset"]')!;
    inset.scrollLeft = 120;

    await fireEvent.mouseDown(handle, { clientX: 1200 });
    await fireEvent.mouseMove(document, { clientX: 1290 });
    await tick();
    expectGeometry(panelGeometry(), [320, 500, 454]);
    expect(canvasWidth()).toBe(1290);

    await fireEvent.mouseUp(document);
    expect(selectPanelCanvasWidth.select(appStore.state, WORKSPACE_ID)).toBe(1290);
    const committedRoot = selectPanelLayoutRoot.select(appStore.state, WORKSPACE_ID);
    expect(committedRoot.type).toBe('split');
    if (committedRoot.type === 'split') {
      expect(committedRoot.sizes.map((size) => (size / 100) * 1274)).toEqual([
        expect.closeTo(320, 8),
        expect.closeTo(500, 8),
        expect.closeTo(454, 8),
      ]);
    }
  });

  it('rehydrates committed percentages to the exact same pixels and complete right edge', async () => {
    await renderLayout(true);
    await dragSplit(1, [70]);
    const expected = resizePanelWidthsAtDivider(INITIAL_WIDTHS, 1, 70).panelWidths;
    const committed = {
      root: selectPanelLayoutRoot.select(appStore.state, WORKSPACE_ID),
      panels: selectPanels.select(appStore.state, WORKSPACE_ID),
      focusedPanelId: 'p1',
      canvasWidth: selectPanelCanvasWidth.select(appStore.state, WORKSPACE_ID),
      canvasWidthSource: 'explicit' as const,
    };
    expectGeometry(panelGeometry(), expected);
    cleanup();

    appStore.dispatch(initializeLayout(WORKSPACE_ID, JSON.parse(JSON.stringify(committed))));
    await renderLayout(true, committed.canvasWidth ?? INITIAL_CANVAS_WIDTH);

    const geometry = panelGeometry();
    expectGeometry(geometry, expected);
    expect(geometry.at(-1)?.right).toBeCloseTo(canvasWidth(), 6);
  });
});
