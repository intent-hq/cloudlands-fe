/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  initializeLayout,
  setRestoreStatus,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';

vi.mock('../Panel.svelte', async () => ({
  default: (await import('./mocks/PanelFocusRoutingPanel.svelte')).default,
}));

import PanelLayout from '../PanelLayout.svelte';

const STORE_CONTEXT = 'redux-store-context';
const LAYOUT_ID = 'panel-active-focus';
let storeContext: ReduxStoreContext | undefined;

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  storeContext = initAppStore(appStore);
  appStore.dispatch(
    initializeLayout(LAYOUT_ID, {
      root: {
        type: 'split',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { type: 'panel', panelId: 'left' },
          { type: 'panel', panelId: 'right' },
        ],
      },
      panels: {
        left: {
          id: 'left',
          tabs: [{ id: 'left-tab', type: 'note', title: 'Left', closable: true }],
          activeTabId: 'left-tab',
        },
        right: {
          id: 'right',
          tabs: [{ id: 'right-tab', type: 'note', title: 'Right', closable: true }],
          activeTabId: 'right-tab',
        },
      },
      focusedPanelId: 'right',
      canvasWidth: 800,
    }),
  );
  appStore.dispatch(setRestoreStatus(LAYOUT_ID, 'restored'));
});

afterEach(() => {
  cleanup();
  storeContext?.dispose();
  storeContext = undefined;
  vi.unstubAllGlobals();
});

async function renderLayout(active: boolean) {
  const view = render(PanelLayout, {
    props: {
      workspaceId: LAYOUT_ID,
      layoutId: LAYOUT_ID,
      contained: true,
      canvasSizing: 'content',
      active,
    },
    context: new Map([[STORE_CONTEXT, storeContext]]),
  });
  await waitFor(() => expect(view.container.querySelector('[data-panel-id="right"]')).toBeTruthy());
  return view;
}

function focusedPanelIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-panel-focused]')).map(
    (panel) => panel.dataset.panelId!,
  );
}

describe('panel focus ownership', () => {
  it('marks the stored focused panel while the workspace is active', async () => {
    const { container } = await renderLayout(true);

    expect(focusedPanelIds(container)).toEqual(['right']);
  });

  it('exposes no focused panel while the workspace is inactive', async () => {
    const { container } = await renderLayout(false);

    expect(focusedPanelIds(container)).toEqual([]);
  });
});
