/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initAppStore, store } from '$store/renderer/store';
import {
  closeTab,
  initializeLayout,
  setRestoreStatus,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import type { ReduxStoreContext } from '$store/renderer/types';
import { removeScript } from '$store/renderer/slices/scripts/scripts-slice';

vi.mock('../PanelContentRenderer.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));

import PanelLayout from '../PanelLayout.svelte';

let context: ReduxStoreContext;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
  context = initAppStore(store);
  store.dispatch(
    initializeLayout('header-removal', {
      root: {
        type: 'split',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { type: 'panel', panelId: 'first' },
          { type: 'panel', panelId: 'second' },
        ],
      },
      panels: Object.fromEntries(
        ['first', 'second'].map((id) => [
          id,
          {
            id,
            tabs: [{ id: `${id}-tab`, type: 'terminal', title: id, scriptId: id, closable: true }],
            activeTabId: `${id}-tab`,
          },
        ]),
      ),
      focusedPanelId: 'first',
    }),
  );
  store.dispatch(setRestoreStatus('header-removal', 'restored'));
});
afterEach(() => {
  cleanup();
  context.dispose();
  vi.unstubAllGlobals();
});

it.each(['close', 'delete'] as const)(
  'keeps the surviving header usable after script panel %s',
  async (action) => {
    render(PanelLayout, {
      props: { workspaceId: 'header-removal', layoutId: 'header-removal', contained: false },
    });
    await waitFor(() => expect(document.querySelectorAll('[data-panel-id]')).toHaveLength(2));
    const trigger = document.querySelector(
      '[data-panel-id="first"] [data-testid="pane-stack-selector-trigger"]',
    )!;
    await fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    store.dispatch(
      action === 'close'
        ? closeTab('header-removal', 'first-tab')
        : removeScript('header-removal', 'first'),
    );
    await waitFor(() => expect(document.querySelectorAll('[data-panel-id]')).toHaveLength(1));
    expect(document.querySelector('[data-panel-id="second"]')).not.toBeNull();
    await fireEvent.click(
      document.querySelector('[data-panel-id="second"] [data-testid="panel-actions-trigger"]')!,
    );
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
  },
);

it('replaces headers safely when switching to an uninitialized workspace and back', async () => {
  const view = render(PanelLayout, {
    props: { workspaceId: 'header-removal', layoutId: 'header-removal', contained: false },
  });
  await waitFor(() =>
    expect(document.querySelectorAll('[data-panel-content-header]')).toHaveLength(2),
  );
  await view.rerender({ workspaceId: 'not-loaded', layoutId: 'not-loaded' });
  await waitFor(() =>
    expect(document.querySelectorAll('[data-panel-content-header]')).toHaveLength(0),
  );
  await view.rerender({ workspaceId: 'header-removal', layoutId: 'header-removal' });
  await waitFor(() =>
    expect(document.querySelectorAll('[data-panel-content-header]')).toHaveLength(2),
  );
});
