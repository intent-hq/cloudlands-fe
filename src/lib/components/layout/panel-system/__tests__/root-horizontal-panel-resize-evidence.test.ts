import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  initializeLayout,
  panelLayoutScopeMounted,
  panelLayoutScopeUnmounted,
  resizePanelLayoutAtRootDivider,
  setRestoreStatus,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { selectPanelCanvasWidth } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import { panelLayoutSaga } from '$store/renderer/slices/panel-layout/sagas/panel-layout-saga';
import { PANEL_LAYOUT_STORAGE_KEY_PREFIX } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { resizePanelWidthsAtDivider } from '$shared/panel-layout-sizing';
import PanelLayout from '../PanelLayout.svelte';

const STORE_CONTEXT = 'redux-store-context';
const WORKSPACE_ID = 'root-resize-evidence';
const INITIAL_CANVAS_WIDTH = 1200;
const INITIAL_CONTENT_WIDTH = 1184;
const INITIAL_WIDTHS = [320, 500, 364];
const GUTTER_WIDTH = 8;
const STORAGE_KEY = `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WORKSPACE_ID}`;

let storeContext: ReduxStoreContext | undefined;
let sagaTask: Task | undefined;
let sagaChannel: ReturnType<typeof stdChannel> | undefined;
let storage = new Map<string, string>();

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

function flexWidth(element: HTMLElement): number {
  return Number.parseFloat(element.style.flex.match(/([\d.]+)px/)?.[1] ?? '0');
}

function canvasWidth(): number {
  const canvas = document.querySelector<HTMLElement>('.panel-canvas-resize-handle')?.parentElement;
  return Number.parseFloat(canvas?.style.width ?? '0');
}

function panelWidths(): number[] {
  const root = document.querySelector<HTMLElement>('.panel-split-container.horizontal')!;
  return [...root.querySelectorAll<HTMLElement>(':scope > .panel-split-child')].map(flexWidth);
}

function expectWidths(expected: number[]) {
  const actual = panelWidths();
  expect(actual).toHaveLength(expected.length);
  actual.forEach((width, index) => expect(width).toBeCloseTo(expected[index], 6));
  const panelContentWidth =
    actual.reduce((sum, width) => sum + width, 0) + GUTTER_WIDTH * (actual.length - 1);
  expect(
    canvasWidth(),
    `persisted=${selectPanelCanvasWidth.select(appStore.state, WORKSPACE_ID)} source=${appStore.state.panelLayout.byWorkspaceId[WORKSPACE_ID].canvasWidthSource}`,
  ).toBeCloseTo(panelContentWidth, 6);
}

function widthsAfterDelta(index: number, delta: number): number[] {
  return resizePanelWidthsAtDivider(panelWidths(), index, delta).panelWidths;
}

function widthsAfterOuterDelta(delta: number): number[] {
  const expected = panelWidths();
  expected[expected.length - 1] += delta;
  return expected;
}

function splitHandle(index: number): HTMLButtonElement {
  const root = document.querySelector<HTMLElement>('.panel-split-container.horizontal')!;
  return [
    ...root.querySelectorAll<HTMLButtonElement>(
      ':scope > .panel-split-handle-wrapper > button[data-resize-axis="x"]',
    ),
  ][index];
}

function outerHandle(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('.panel-canvas-resize-handle')!;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function mount(mode: 'tab' | 'columns' | 'stacked', width = INITIAL_CANVAS_WIDTH) {
  const contained = mode !== 'tab';
  const result = render(PanelLayout, {
    props: {
      workspaceId: WORKSPACE_ID,
      layoutId: WORKSPACE_ID,
      contained,
      canvasSizing: contained ? ('content' as const) : ('viewport' as const),
    },
    context: new Map([[STORE_CONTEXT, storeContext]]),
  });
  await waitFor(() => expect(canvasWidth()).toBeCloseTo(width, 6));
  await waitFor(() => expect(document.querySelectorAll('[data-panel-id]')).toHaveLength(3));
  return result;
}

type Sample = { phase: string; timestamp: number; widths: number[] };

async function releaseAndSample(
  handle: HTMLButtonElement,
  startX: number,
  moves: number[],
  expected: number[],
): Promise<Sample[]> {
  fireEvent.mouseDown(handle, { clientX: startX });
  for (const clientX of moves) fireEvent.mouseMove(document, { clientX });
  await nextFrame();
  await tick();
  expectWidths(expected);

  const samples: Sample[] = [];
  const sample = (phase: string, verifyCanvas = true) => {
    if (verifyCanvas) expectWidths(expected);
    else {
      const actual = panelWidths();
      expect(actual).toHaveLength(expected.length);
      actual.forEach((width, index) => expect(width).toBeCloseTo(expected[index], 6));
    }
    samples.push({ phase, timestamp: performance.now(), widths: panelWidths() });
  };
  sample('final-preview');
  fireEvent.mouseUp(document, { clientX: moves.at(-1) ?? startX });
  sample('pointerup', false);
  await Promise.resolve();
  sample('microtask', false);
  await tick();
  TestResizeObserver.flush();
  await tick();
  sample('resize-observer');
  await nextFrame();
  sample('authoritative-frame');
  await nextFrame();
  sample('settlement-frame');
  await nextFrame();
  await tick();
  sample('released-frame');
  expect(samples.map(({ phase }) => phase)).toEqual([
    'final-preview',
    'pointerup',
    'microtask',
    'resize-observer',
    'authoritative-frame',
    'settlement-frame',
    'released-frame',
  ]);
  expect(
    samples.every((entry, index) => index === 0 || entry.timestamp >= samples[index - 1].timestamp),
  ).toBe(true);
  return samples;
}

function startProductionSaga() {
  sagaChannel = stdChannel();
  sagaTask = runSaga(
    {
      channel: sagaChannel,
      dispatch: (action) => appStore.dispatch(action),
      getState: () => appStore.state,
    },
    panelLayoutSaga,
  );
}

async function settleSaga() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function stopSaga() {
  if (!sagaTask) return;
  sagaTask.cancel();
  await sagaTask.toPromise();
  sagaTask = undefined;
  sagaChannel = undefined;
}

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  /* eslint-disable themis/direct-local-storage-usage -- This integration test controls the
     browser storage boundary while the production saga uses the safe storage helpers. */
  vi.mocked(localStorage.getItem).mockImplementation((key) => storage.get(key) ?? null);
  vi.mocked(localStorage.setItem).mockImplementation((key, value) => storage.set(key, value));
  vi.mocked(localStorage.removeItem).mockImplementation((key) => storage.delete(key));
  /* eslint-enable themis/direct-local-storage-usage */
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
    if (this.classList.contains('panel-split-handle-wrapper')) return GUTTER_WIDTH;
    return Number.parseFloat(this.style.width) || 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
    if (this.dataset.testid === 'panel-workspace-inset') return INITIAL_CANVAS_WIDTH;
    return Number.parseFloat(this.style.width) || 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const width =
      this.dataset.testid === 'panel-workspace-inset'
        ? INITIAL_CANVAS_WIDTH
        : this.classList.contains('panel-split-child')
          ? flexWidth(this)
          : this.dataset.panelId
            ? flexWidth(this.closest<HTMLElement>('.panel-split-child')!)
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
  initializeThreePanels();
});

afterEach(async () => {
  cleanup();
  await stopSaga();
  storeContext?.dispose();
  storeContext = undefined;
  TestResizeObserver.instances.clear();
  document.documentElement.style.removeProperty('zoom');
  Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('root horizontal resize release evidence', () => {
  it.each([
    { mode: 'tab' as const, zoom: 1 },
    { mode: 'tab' as const, zoom: 2 },
    { mode: 'columns' as const, zoom: 1 },
    { mode: 'columns' as const, zoom: 2 },
    { mode: 'stacked' as const, zoom: 1 },
    { mode: 'stacked' as const, zoom: 2 },
  ])('settles panels 1/2/3 without replay in $mode mode at $zoom× zoom', async ({ mode, zoom }) => {
    document.documentElement.style.zoom = String(zoom);
    await mount(mode);
    const inset = document.querySelector<HTMLElement>('[data-testid="panel-workspace-inset"]')!;
    inset.scrollLeft = 173;

    await releaseAndSample(splitHandle(0), 100, [116, 148, 180], widthsAfterDelta(0, 80));
    expect(inset.scrollLeft).toBe(173);
    await releaseAndSample(splitHandle(1), 200, [180, 160, 140], widthsAfterDelta(1, -60));
    expect(inset.scrollLeft).toBe(173);
    await releaseAndSample(outerHandle(), 1000, [1030, 1060, 1090], widthsAfterOuterDelta(90));
    expect(inset.scrollLeft).toBe(173);
  });

  it('keeps totals valid through repeated proportional resize and minimum clamps', async () => {
    await mount('columns');
    await releaseAndSample(splitHandle(0), 100, [140, 196], widthsAfterDelta(0, 96));
    await releaseAndSample(splitHandle(0), 100, [80, 20, -40], widthsAfterDelta(0, -140));
    await releaseAndSample(splitHandle(0), 100, [-900], widthsAfterDelta(0, -1000));
    await releaseAndSample(splitHandle(1), 200, [260, 310], widthsAfterDelta(1, 110));
    expect(selectPanelCanvasWidth.select(appStore.state, WORKSPACE_ID)).toBeCloseTo(
      canvasWidth(),
      6,
    );
    expect(appStore.state.panelLayout.byWorkspaceId[WORKSPACE_ID].canvasWidthSource).toBe(
      'explicit',
    );
  });

  it('persists explicit pixels and restores them through production storage, migration, and mounting', async () => {
    await mount('columns');
    startProductionSaga();
    await settleSaga();
    const persistedWidths = widthsAfterDelta(0, 88);
    const trace = await releaseAndSample(splitHandle(0), 100, [188], persistedWidths);
    sagaChannel!.put({ type: resizePanelLayoutAtRootDivider.type, payload: [WORKSPACE_ID] });
    await settleSaga();

    const serialized = JSON.parse(storage.get(STORAGE_KEY) ?? 'null');
    const persistedCanvasWidth = canvasWidth();
    expect(serialized).toMatchObject({
      canvasWidth: persistedCanvasWidth,
      canvasWidthSource: 'explicit',
    });
    trace.push({
      phase: 'serialized-storage',
      timestamp: performance.now(),
      widths: panelWidths(),
    });
    cleanup();
    sagaChannel!.put(panelLayoutScopeUnmounted(WORKSPACE_ID));
    await settleSaga();
    await stopSaga();
    storeContext?.dispose();

    storeContext = initAppStore(appStore);
    startProductionSaga();
    await settleSaga();
    sagaChannel!.put(panelLayoutScopeMounted(WORKSPACE_ID));
    await settleSaga();
    const result = await mount('columns', persistedCanvasWidth);
    expectWidths(persistedWidths);
    trace.push({ phase: 'rehydrated-mount', timestamp: performance.now(), widths: panelWidths() });
    expect(trace.slice(-2).map(({ phase }) => phase)).toEqual([
      'serialized-storage',
      'rehydrated-mount',
    ]);
    expect(
      trace.every((entry, index) => index === 0 || entry.timestamp >= trace[index - 1].timestamp),
    ).toBe(true);
    expect(appStore.state.panelLayout.byWorkspaceId[WORKSPACE_ID].canvasWidthSource).toBe(
      'explicit',
    );
    result.unmount();

    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        root: { type: 'panel', panelId: 'legacy' },
        panels: { legacy: { id: 'legacy', tabs: [], activeTabId: null } },
        focusedPanelId: 'legacy',
        canvasWidth: 1600,
      }),
    );
    sagaChannel!.put(panelLayoutScopeUnmounted(WORKSPACE_ID));
    await settleSaga();
    sagaChannel!.put(panelLayoutScopeMounted(WORKSPACE_ID));
    await settleSaga();
    const legacy = render(PanelLayout, {
      props: {
        workspaceId: WORKSPACE_ID,
        layoutId: WORKSPACE_ID,
        contained: true,
        canvasSizing: 'content',
      },
      context: new Map([[STORE_CONTEXT, storeContext]]),
    });
    await waitFor(() => expect(canvasWidth()).toBe(500));
    expect(selectPanelCanvasWidth.select(appStore.state, WORKSPACE_ID)).toBeNull();
    expect(appStore.state.panelLayout.byWorkspaceId[WORKSPACE_ID].canvasWidthSource).toBeNull();
    expect(document.querySelector('[data-panel-id="legacy"]')).not.toBeNull();
    legacy.unmount();
  });
});
