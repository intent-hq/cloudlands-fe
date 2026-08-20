import { cleanup, render, waitFor } from '@testing-library/svelte';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  panelLayoutScopeMounted,
  setPanelColumnCount,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { panelLayoutSaga } from '$store/renderer/slices/panel-layout/sagas/panel-layout-saga';
import {
  PANEL_LAYOUT_PERSISTENCE_VERSION,
  PANEL_LAYOUT_STORAGE_KEY_PREFIX,
} from '$store/renderer/slices/panel-layout/panel-layout-types';
import PanelLayout from '../PanelLayout.svelte';

const STORE_CONTEXT = 'redux-store-context';
const WORKSPACE_ID = 'restore-reconciliation';
const STORAGE_KEY = `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WORKSPACE_ID}`;

let storeContext: ReduxStoreContext | undefined;
let sagaTask: Task | undefined;
let sagaChannel: ReturnType<typeof stdChannel> | undefined;
let storage: Map<string, string>;

async function settleSaga() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  storage = new Map([
    [
      STORAGE_KEY,
      JSON.stringify({
        version: PANEL_LAYOUT_PERSISTENCE_VERSION,
        root: { type: 'panel', panelId: 'restored' },
        panels: { restored: { id: 'restored', tabs: [], activeTabId: null } },
        focusedPanelId: 'restored',
        columnCount: 2,
        canvasWidth: null,
        canvasWidthSource: null,
      }),
    ],
  ]);
  /* eslint-disable themis/direct-local-storage-usage -- This integration test controls the
     browser storage boundary while the production saga uses the safe storage helpers. */
  vi.mocked(localStorage.getItem).mockImplementation((key) => storage.get(key) ?? null);
  vi.mocked(localStorage.setItem).mockImplementation((key, value) => storage.set(key, value));
  vi.mocked(localStorage.removeItem).mockImplementation((key) => storage.delete(key));
  /* eslint-enable themis/direct-local-storage-usage */
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  storeContext = initAppStore(appStore);
  appStore.dispatch(setPanelColumnCount(WORKSPACE_ID, 2, 10));
  sagaChannel = stdChannel();
  sagaTask = runSaga(
    {
      channel: sagaChannel,
      dispatch: (action) => appStore.dispatch(action),
      getState: () => appStore.state,
    },
    panelLayoutSaga,
  );
  await settleSaga();
});

afterEach(async () => {
  cleanup();
  sagaTask?.cancel();
  await sagaTask?.toPromise();
  sagaTask = undefined;
  sagaChannel = undefined;
  storeContext?.dispose();
  storeContext = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PanelLayout restore reconciliation', () => {
  it('renders the selected two columns after a one-panel layout reload', async () => {
    sagaChannel!.put(panelLayoutScopeMounted(WORKSPACE_ID));
    await settleSaga();

    const result = render(PanelLayout, {
      props: {
        workspaceId: WORKSPACE_ID,
        layoutId: WORKSPACE_ID,
        contained: true,
        canvasSizing: 'content',
      },
      context: new Map([[STORE_CONTEXT, storeContext]]),
    });

    await waitFor(() =>
      expect(result.container.querySelectorAll('[data-panel-id]')).toHaveLength(2),
    );
    expect(result.container.querySelector('[data-panel-id="restored"]')).not.toBeNull();
  });
});
