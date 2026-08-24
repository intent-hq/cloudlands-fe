/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  initializeLayout,
  setRestoreStatus,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { PANE_DRAG_MIME, clearDraggedPaneState, setDraggedPane } from '../panel-drag';

vi.mock('../Panel.svelte', async () => ({
  default: (await import('./mocks/PaneDragRoutingPanel.svelte')).default,
}));

import PanelLayout from '../PanelLayout.svelte';

const STORE_CONTEXT = 'redux-store-context';
const WORKSPACE_ID = 'pane-drag-event-ownership';
const PREVIEW_PROBE_EVENT = 'pane-drag-preview-probe';
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

function dragEvent(clientX: number): DragEvent {
  const event = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
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
      root: { type: 'panel', panelId: 'target-panel' },
      panels: {
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
  return panel;
}

async function probeNonGutterSequence(coordinates: readonly number[]): Promise<(string | null)[]> {
  const panel = await mountLayout();
  const probes: (string | null)[] = [];
  const recordProbe = (event: Event) => probes.push((event as CustomEvent<string | null>).detail);
  window.addEventListener(PREVIEW_PROBE_EVENT, recordProbe);

  await fireEvent(panel, dragEvent(coordinates[0]));
  await waitFor(() =>
    expect(document.querySelector('[data-panel-layout-drag-preview="center"]')).toBeTruthy(),
  );
  probes.length = 0;
  for (const clientX of coordinates) await fireEvent(panel, dragEvent(clientX));

  window.removeEventListener(PREVIEW_PROBE_EVENT, recordProbe);
  return probes;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  storeContext = initAppStore(appStore);
});

afterEach(() => {
  clearDraggedPaneState();
  cleanup();
  storeContext?.dispose();
  storeContext = undefined;
  vi.unstubAllGlobals();
});

describe('pane drag event ownership', () => {
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
});
