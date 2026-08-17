/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  initializeLayout,
  setRestoreStatus,
  toggleExpandPanel,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { selectPanelCanvasWidth } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';
import {
  allocatePanelWidths,
  DEFAULT_CHAT_PANEL_WIDTH,
  MIN_PANEL_CANVAS_WIDTH,
} from '$shared/panel-layout-sizing';

vi.mock('../Panel.svelte', async () => ({
  default: (await import('./mocks/MockMountedPanel.svelte')).default,
}));

import PanelLayout from '../PanelLayout.svelte';

const STORE_CONTEXT = 'redux-store-context';
const GUTTER = 8;
let storeContext: ReduxStoreContext | undefined;
let viewportWidth = 1200;
let testSequence = 0;

class TestResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {}
  disconnect() {}
  flush() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function flexWidth(element: HTMLElement): number {
  return Number.parseFloat(element.style.flex.match(/([\d.]+)px/)?.[1] ?? '0');
}

function panelWidths(): number[] {
  const root = document.querySelector<HTMLElement>('.panel-split-container.horizontal')!;
  return Array.from(root.querySelectorAll<HTMLElement>(':scope > .panel-split-child')).map(
    flexWidth,
  );
}

function initialize(
  panelCount: number,
  canvasWidth: number,
  widths: number[],
  tabType: 'agent' | 'note' = 'note',
) {
  const workspaceId = `dominant-${++testSequence}`;
  const panelIds = Array.from({ length: panelCount }, (_, index) => `p${index + 1}`);
  const referenceWidth = canvasWidth - GUTTER * (panelCount - 1);
  appStore.dispatch(
    initializeLayout(workspaceId, {
      root: {
        type: 'split',
        direction: 'horizontal',
        sizes: widths.map((width) => (width / referenceWidth) * 100),
        children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
      },
      panels: Object.fromEntries(
        panelIds.map((panelId) => [
          panelId,
          {
            id: panelId,
            tabs: [{ id: `${panelId}-tab`, type: tabType, title: panelId, closable: true }],
            activeTabId: `${panelId}-tab`,
          },
        ]),
      ),
      focusedPanelId: panelIds[0],
      canvasWidth,
    }),
  );
  appStore.dispatch(setRestoreStatus(workspaceId, 'restored'));
  return { workspaceId, panelIds };
}

async function mount(workspaceId: string, contained = false) {
  const result = render(PanelLayout, {
    props: {
      workspaceId,
      layoutId: workspaceId,
      contained,
      canvasSizing: contained ? 'content' : 'viewport',
    },
    context: new Map([[STORE_CONTEXT, storeContext]]),
  });
  await waitFor(() =>
    expect(document.querySelectorAll('[data-mounted-panel]').length).toBeGreaterThan(1),
  );
  return result;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
    return this.classList.contains('panel-split-handle-wrapper')
      ? GUTTER
      : Number.parseFloat(this.style.width) || 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
    return this.dataset.testid === 'panel-workspace-inset'
      ? viewportWidth
      : Number.parseFloat(this.style.width) || 0;
  });
  storeContext = initAppStore(appStore);
});

afterEach(() => {
  cleanup();
  storeContext?.dispose();
  storeContext = undefined;
  viewportWidth = 1200;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mounted dominant panel expansion', () => {
  it('affirms dominant-panel expand and restore in every required visual state', async () => {
    const observed = await exerciseVisualStates(async ({ width }) => {
      viewportWidth = width;
      const { workspaceId, panelIds } = initialize(3, 1200, [392, 392, 400]);
      const view = await mount(workspaceId);
      const target = document.querySelector<HTMLButtonElement>('[data-panel-interaction]')!;
      appStore.dispatch(toggleExpandPanel(workspaceId, panelIds[1]));
      await waitFor(() => expect(panelWidths()[1]).toBeGreaterThan(panelWidths()[0]));
      appStore.dispatch(toggleExpandPanel(workspaceId, panelIds[1]));
      await waitFor(() => expect(panelWidths()[0]).toBeCloseTo(392, 6));
      return {
        ...view,
        target,
        assertCapability: () => {
          expect(document.querySelectorAll('[data-mounted-panel]')).toHaveLength(3);
          expect(selectPanelCanvasWidth.select(appStore.state, workspaceId)).toBe(1200);
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it.each([
    { widths: [350, 642], target: 0 },
    { widths: [320, 500, 364], target: 1 },
    { widths: [390, 410, 610, 450], target: 2 },
    { widths: [440, 360, 520, 460, 688], target: 4 },
  ])(
    'keeps 2–5 siblings mounted and interactive for target $target',
    async ({ widths, target }) => {
      const canvasWidth =
        widths.reduce((sum, width) => sum + width, 0) + GUTTER * (widths.length - 1);
      const restoredWidths = allocatePanelWidths(widths, viewportWidth).panelWidths;
      const { workspaceId, panelIds } = initialize(widths.length, canvasWidth, widths);
      await mount(workspaceId);
      const inset = document.querySelector<HTMLElement>('[data-testid="panel-workspace-inset"]')!;
      inset.scrollLeft = 120;

      appStore.dispatch(toggleExpandPanel(workspaceId, panelIds[target]));
      await waitFor(() => {
        panelWidths()
          .filter((_, index) => index !== target)
          .forEach((width) => expect(width).toBeCloseTo(280, 6));
      });
      expect(panelWidths()[target]).toBeGreaterThan(
        Math.max(...panelWidths().filter((_, index) => index !== target)),
      );
      expect(document.querySelectorAll('[data-mounted-panel]')).toHaveLength(widths.length);
      await fireEvent.click(
        document.querySelectorAll<HTMLButtonElement>('[data-panel-interaction]')[0],
      );
      expect(appStore.state.panelLayout.byWorkspaceId[workspaceId].focusedPanelId).toBe('p1');
      expect(inset.scrollLeft).toBe(120);

      appStore.dispatch(toggleExpandPanel(workspaceId, panelIds[target]));
      await waitFor(() => {
        panelWidths().forEach((width, index) =>
          expect(width).toBeCloseTo(restoredWidths[index], 6),
        );
      });
      expect(selectPanelCanvasWidth.select(appStore.state, workspaceId)).toBe(canvasWidth);
      expect(inset.scrollLeft).toBe(120);
    },
  );

  it('grows a narrow five-panel canvas into overflow and restores its explicit width', async () => {
    viewportWidth = 720;
    const { workspaceId, panelIds } = initialize(
      5,
      1000,
      [193.6, 193.6, 193.6, 193.6, 193.6],
      'agent',
    );
    const result = await mount(workspaceId);
    const expandedCanvasWidth =
      DEFAULT_CHAT_PANEL_WIDTH + MIN_PANEL_CANVAS_WIDTH * 4 + GUTTER * 4;
    appStore.dispatch(toggleExpandPanel(workspaceId, panelIds[2]));
    await waitFor(() =>
      expect(selectPanelCanvasWidth.select(appStore.state, workspaceId)).toBe(expandedCanvasWidth),
    );
    await waitFor(() => {
      panelWidths().forEach((width, index) =>
        expect(width).toBeCloseTo(
          index === 2 ? DEFAULT_CHAT_PANEL_WIDTH : MIN_PANEL_CANVAS_WIDTH,
          6,
        ),
      );
    });
    expect(document.querySelectorAll('[data-mounted-panel]')).toHaveLength(5);
    await result.rerender({
      workspaceId,
      layoutId: workspaceId,
      contained: true,
      canvasSizing: 'content',
    });
    panelWidths().forEach((width, index) =>
      expect(width).toBeCloseTo(
        index === 2 ? DEFAULT_CHAT_PANEL_WIDTH : MIN_PANEL_CANVAS_WIDTH,
        6,
      ),
    );
    appStore.dispatch(toggleExpandPanel(workspaceId, panelIds[2]));
    await waitFor(() =>
      expect(selectPanelCanvasWidth.select(appStore.state, workspaceId)).toBe(1000),
    );
  });
});
