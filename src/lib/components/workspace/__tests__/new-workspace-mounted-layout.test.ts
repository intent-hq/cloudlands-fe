/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  bootstrapNewWorkspaceLayout,
  revealDeferredSpecTab,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';

vi.mock('$lib/components/layout/panel-system/Panel.svelte', async () => ({
  default: (
    await import('$lib/components/layout/panel-system/__tests__/mocks/MockMountedPanel.svelte')
  ).default,
}));

import PanelLayout from '$lib/components/layout/panel-system/PanelLayout.svelte';

const STORE_CONTEXT = 'redux-store-context';
let storeContext: ReduxStoreContext | undefined;
let sequence = 0;

class TestResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {}
  disconnect() {}
  flush() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(0);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  storeContext = initAppStore(appStore);
});

afterEach(() => {
  cleanup();
  storeContext?.dispose();
  storeContext = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountedPanels(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-mounted-panel]')];
}

describe('mounted new workspace layout', () => {
  it('shows chat plus one reserved panel, then reveals Spec without duplication', async () => {
    const workspaceId = `mounted-bootstrap-${++sequence}`;
    appStore.dispatch(bootstrapNewWorkspaceLayout(workspaceId, 'agent-1', 'Coordinator', true));
    const result = render(PanelLayout, {
      props: { workspaceId, layoutId: workspaceId },
      context: new Map([[STORE_CONTEXT, storeContext]]),
    });

    await waitFor(() => expect(mountedPanels()).toHaveLength(2));
    expect(mountedPanels().map((panel) => panel.textContent)).toEqual([
      expect.stringContaining('Coordinator'),
      expect.not.stringContaining('Spec'),
    ]);

    appStore.dispatch(revealDeferredSpecTab(workspaceId, 'spec:created', 'Spec', 10));
    await waitFor(() =>
      expect(mountedPanels().map((panel) => panel.textContent)).toEqual([
        expect.stringContaining('Coordinator'),
        expect.stringContaining('Spec'),
      ]),
    );

    result.unmount();
    render(PanelLayout, {
      props: { workspaceId, layoutId: workspaceId },
      context: new Map([[STORE_CONTEXT, storeContext]]),
    });
    await waitFor(() => expect(mountedPanels()).toHaveLength(2));
    expect(mountedPanels().filter((panel) => panel.textContent?.includes('Spec'))).toHaveLength(1);
  });
});
