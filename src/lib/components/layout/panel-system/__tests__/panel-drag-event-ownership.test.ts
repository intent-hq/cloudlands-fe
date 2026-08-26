/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  initializeLayout,
  setRestoreStatus,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import {
  PANE_DRAG_MIME,
  clearDraggedPaneState,
  createPaneDragImage,
  getDraggedPane,
  setDraggedPane,
} from '../panel-drag';
import { endDrag, startDrag } from '$store/renderer/slices/tab-state/tab-state-slice';

vi.mock('../Panel.svelte', async () => ({
  default: (await import('./mocks/PaneDragRoutingPanel.svelte')).default,
}));

import PanelLayout from '../PanelLayout.svelte';

const STORE_CONTEXT = 'redux-store-context';
const WORKSPACE_ID = 'pane-drag-event-ownership';
const PANEL_WIDTH = 400;
let storeContext: ReduxStoreContext | undefined;

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

class TestDataTransfer {
  dropEffect = 'none';
  readonly types = [PANE_DRAG_MIME];
}

function dragEvent(clientX: number, type = 'dragover'): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: 20 },
    dataTransfer: { value: new TestDataTransfer() },
  });
  return event;
}

async function mountLayout() {
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
        'source-panel': {
          id: 'source-panel',
          tabs: [{ id: 'source-tab', type: 'note', title: 'Source', closable: true }],
          activeTabId: 'source-tab',
        },
        'target-panel': {
          id: 'target-panel',
          tabs: [
            { id: 'one', type: 'note', title: 'One', closable: true },
            { id: 'two', type: 'note', title: 'Two', closable: true },
          ],
          activeTabId: 'one',
        },
      },
      focusedPanelId: 'target-panel',
      canvasWidth: PANEL_WIDTH,
    }),
  );
  appStore.dispatch(setRestoreStatus(WORKSPACE_ID, 'restored'));
  const result = render(PanelLayout, {
    props: {
      workspaceId: WORKSPACE_ID,
      layoutId: WORKSPACE_ID,
      contained: true,
      canvasSizing: 'content',
    },
    context: new Map([[STORE_CONTEXT, storeContext]]),
  });
  const panel = await waitFor(() => {
    const element = result.container.querySelector<HTMLElement>('[data-panel-id="target-panel"]');
    expect(element).toBeTruthy();
    return element!;
  });
  const layout = result.container.querySelector<HTMLElement>('[data-panel-layout-motion]')!;
  const sourcePanel = result.container.querySelector<HTMLElement>(
    '[data-panel-id="source-panel"]',
  )!;
  sourcePanel.getBoundingClientRect = () =>
    ({
      left: -408,
      right: -8,
      top: 0,
      bottom: 400,
      width: PANEL_WIDTH,
      height: 400,
    }) as DOMRect;
  panel.getBoundingClientRect = () =>
    ({
      left: 0,
      right: PANEL_WIDTH,
      top: 0,
      bottom: 400,
      width: PANEL_WIDTH,
      height: 400,
    }) as DOMRect;
  layout.getBoundingClientRect = () =>
    ({
      left: 0,
      right: PANEL_WIDTH,
      top: 0,
      bottom: 400,
      width: PANEL_WIDTH,
      height: 400,
    }) as DOMRect;
  setDraggedPane({ tabId: 'source-tab', panelId: 'source-panel' });
  appStore.dispatch(startDrag());
  return panel;
}

async function probeNonGutterSequence(coordinates: readonly number[]): Promise<(string | null)[]> {
  const panel = await mountLayout();
  const probes: (string | null)[] = [];

  await fireEvent(panel, dragEvent(coordinates[0]));
  await waitFor(() =>
    expect(document.querySelector('[data-panel-layout-drag-preview="center"]')).toBeTruthy(),
  );
  for (const clientX of coordinates) {
    await fireEvent(panel, dragEvent(clientX));
    probes.push(
      document.querySelector<HTMLElement>('[data-panel-layout-drag-preview]')?.dataset
        .panelLayoutDragPreview ?? null,
    );
  }

  return probes;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pane drag event ownership', () => {
  it('does not render a projected overlay for a stable self target', async () => {
    const panel = await mountLayout();
    setDraggedPane({ tabId: 'one', panelId: 'target-panel' });

    await fireEvent(panel, dragEvent(200));

    expect(document.querySelector('[data-panel-layout-drag-preview]')).toBeNull();
  });

  it('does not alternate the target for repeated stationary non-gutter dragovers', async () => {
    expect(await probeNonGutterSequence([200, 200, 200])).toEqual(['center', 'center', 'center']);
  });

  it('does not alternate the target during slow non-gutter movement', async () => {
    expect(await probeNonGutterSequence([81, 80, 79, 78, 77])).toEqual([
      'center',
      'center',
      'center',
      'center',
      'center',
    ]);
  });

  it('coalesces dragover updates to the latest pointer position in one frame', async () => {
    const panel = await mountLayout();
    const layout = panel.closest<HTMLElement>('[data-panel-layout-motion]')!;
    const layoutRect = vi.spyOn(layout, 'getBoundingClientRect');

    panel.dispatchEvent(dragEvent(60));
    panel.dispatchEvent(dragEvent(340));

    expect(document.querySelector('[data-panel-layout-drag-preview]')).toBeNull();
    await waitFor(() =>
      expect(document.querySelector('[data-panel-layout-drag-preview="right"]')).toBeTruthy(),
    );
    expect(layoutRect).toHaveBeenCalledOnce();
  });

  it('reuses drag-session geometry and the rendered preview in an unchanged region', async () => {
    const panel = await mountLayout();
    const layout = panel.closest<HTMLElement>('[data-panel-layout-motion]')!;
    const source = layout.querySelector<HTMLElement>('[data-panel-id="source-panel"]')!;
    const panelRect = vi.spyOn(panel, 'getBoundingClientRect');
    const sourceRect = vi.spyOn(source, 'getBoundingClientRect');
    const layoutRect = vi.spyOn(layout, 'getBoundingClientRect');

    await fireEvent(panel, dragEvent(340));
    const firstSnapshot = await waitFor(() => {
      const snapshot = document.querySelector<HTMLElement>('[data-panel-layout-preview-snapshot]');
      expect(snapshot).toBeTruthy();
      return snapshot!;
    });
    const geometryReads = [
      panelRect.mock.calls.length,
      sourceRect.mock.calls.length,
      layoutRect.mock.calls.length,
    ];

    await fireEvent(panel, dragEvent(340));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect([
      panelRect.mock.calls.length,
      sourceRect.mock.calls.length,
      layoutRect.mock.calls.length,
    ]).toEqual(geometryReads);
    expect(document.querySelector('[data-panel-layout-preview-snapshot]')).toBe(firstSnapshot);
  });

  it('keeps the settled outer inset, panel widths, and inter-panel gap in the preview', async () => {
    const panel = await mountLayout();

    await fireEvent(panel, dragEvent(340));
    const preview = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-panel-layout-drag-preview]');
      expect(element).toBeTruthy();
      return element!;
    });
    const split = preview.querySelector<HTMLElement>(
      '[data-panel-layout-preview-split="horizontal"]',
    )!;
    const panelBases = [...split.children].map((child) => (child as HTMLElement).style.flex);

    expect(preview.classList).toContain('box-content');
    expect(preview.classList).toContain('px-2');
    expect(preview.style.width).toBe('100%');
    expect(split.classList).toContain('gap-2');
    expect(panelBases).toEqual(['50 1 0%', '50 1 0%']);
  });

  it('updates one live preview through gutter, panel, invalid, and valid regions', async () => {
    const panel = await mountLayout();
    const layout = panel.closest<HTMLElement>('[data-panel-layout-motion]')!;
    const readPreview = () =>
      document.querySelector<HTMLElement>('[data-panel-layout-drag-preview]')?.dataset
        .panelLayoutDragPreview ?? null;
    const previews: (string | null)[] = [];

    for (const [target, clientX, expected] of [
      [panel, 400, 'after'],
      [panel, 340, 'right'],
      [panel, 200, 'center'],
      [layout, 200, null],
      [panel, 340, 'right'],
    ] as const) {
      await fireEvent(target, dragEvent(clientX));
      await waitFor(() => expect(readPreview()).toBe(expected));
      previews.push(readPreview());
    }

    expect(previews).toEqual(['after', 'right', 'center', null, 'right']);
  });

  it('finishes a center drop before source unmount and starts a second drag normally', async () => {
    const panel = await mountLayout();
    appStore.dispatch(startDrag());
    createPaneDragImage('Source');

    await fireEvent(panel, dragEvent(200));
    await waitFor(() =>
      expect(document.querySelector('[data-panel-layout-drag-preview="center"]')).toBeTruthy(),
    );
    await fireEvent(panel, dragEvent(200, 'drop'));

    expect(getDraggedPane()).toBeNull();
    expect(appStore.state.tabState.isDragging).toBe(false);
    expect(document.querySelector('[data-pane-drag-image]')).toBeNull();
    expect(document.querySelector('[data-panel-layout-drag-preview]')).toBeNull();
    await waitFor(() =>
      expect(document.querySelector('[data-panel-id="source-panel"]')).toBeNull(),
    );

    setDraggedPane({ tabId: 'one', panelId: 'target-panel' });
    appStore.dispatch(startDrag());
    await fireEvent(panel, dragEvent(0));
    await waitFor(() =>
      expect(document.querySelector('[data-panel-layout-drag-preview="before"]')).toBeTruthy(),
    );
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(getDraggedPane()).toBeNull();
    expect(appStore.state.tabState.isDragging).toBe(false);
  });
});
