/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  bootstrapNewWorkspaceLayout,
  openTabInNewRootColumn,
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
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
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

  it.each(['light', 'dark'] as const)(
    'keeps the %s first-open agent columns and empty surface equivalent after remount',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.dataset.theme = theme;
      const workspaceId = `mounted-sidebar-agent-${++sequence}`;
      const result = render(PanelLayout, {
        props: { workspaceId, layoutId: workspaceId },
        context: new Map([[STORE_CONTEXT, storeContext]]),
      });
      await waitFor(() => expect(mountedPanels()).toHaveLength(0));

      const action = openTabInNewRootColumn(
        workspaceId,
        {
          type: 'agent',
          title: 'Ada',
          agentId: 'agent-1',
          workspaceId,
          closable: true,
        },
        { adaptiveFirstChat: true, availableCanvasWidth: 1400, force: true },
        10,
      );
      appStore.dispatch(action);
      await waitFor(() => expect(mountedPanels()).toHaveLength(2));
      const firstOpenText = mountedPanels().map((panel) => panel.textContent);
      expect(firstOpenText.filter((text) => text?.includes('Ada'))).toHaveLength(1);
      const firstEmptyPanel = document.querySelector<HTMLElement>(
        '[data-empty-panel-surface="true"]',
      );
      const firstPopulatedPanel = mountedPanels().find((panel) =>
        panel.textContent?.includes('Ada'),
      );
      expect(firstEmptyPanel?.classList.contains('bg-sidebar')).toBe(true);
      expect(firstEmptyPanel?.classList.contains('bg-card')).toBe(false);
      expect(firstEmptyPanel?.querySelector('[data-mounted-panel]')).toBeTruthy();
      expect(firstPopulatedPanel?.classList.contains('bg-card')).toBe(true);
      expect(firstPopulatedPanel?.classList.contains('bg-sidebar')).toBe(false);

      result.unmount();
      render(PanelLayout, {
        props: { workspaceId, layoutId: workspaceId },
        context: new Map([[STORE_CONTEXT, storeContext]]),
      });
      await waitFor(() => expect(mountedPanels()).toHaveLength(2));
      expect(mountedPanels().map((panel) => panel.textContent)).toEqual(firstOpenText);
      const remountedEmptyPanel = document.querySelector<HTMLElement>(
        '[data-empty-panel-surface="true"]',
      );
      expect(remountedEmptyPanel?.classList.contains('bg-sidebar')).toBe(true);
      expect(remountedEmptyPanel?.classList.contains('bg-card')).toBe(false);

      appStore.dispatch(action);
      await waitFor(() => expect(mountedPanels()).toHaveLength(2));
      expect(mountedPanels().filter((panel) => panel.textContent?.includes('Ada'))).toHaveLength(1);
    },
  );
});
