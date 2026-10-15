/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import { tick } from 'svelte';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

const dispatch = vi.hoisted(() => vi.fn());
const visibleTabs = writable<PanelTab[]>([]);
const hiddenTabs = writable<PanelTab[]>([]);

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch });
});
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectAllTabs: () => visibleTabs,
  selectHiddenTabs: () => hiddenTabs,
}));

import BrowserActivityBadge from './BrowserActivityBadge.svelte';

afterEach(() => {
  cleanup();
  dispatch.mockClear();
  visibleTabs.set([]);
  hiddenTabs.set([]);
});

describe('browser activity badge', () => {
  it.each(['visible', 'hidden'])('reveals the existing %s tab when clicked', async (visibility) => {
    const tabs = visibility === 'hidden' ? hiddenTabs : visibleTabs;
    tabs.set([
      {
        id: 'tab-1',
        type: 'browser',
        title: 'Docs',
        browserUrl: 'https://svelte.dev/docs',
        closable: true,
      },
    ]);
    render(BrowserActivityBadge, {
      workspaceId: 'ws-1',
      tabId: 'tab-1',
      url: 'https://svelte.dev/docs',
    });
    await fireEvent.click(screen.getByRole('button', { name: /svelte\.dev/ }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'appLayout/focusBrowserTabRequested',
      payload: ['ws-1', 'tab-1'],
    });
  });

  it('stops offering navigation when the tab is destroyed', async () => {
    hiddenTabs.set([{ id: 'tab-1', type: 'browser', title: 'Preview', closable: true }]);
    render(BrowserActivityBadge, {
      workspaceId: 'ws-1',
      tabId: 'tab-1',
      url: 'http://localhost:5173/app',
    });
    const button = screen.getByRole('button', { name: /localhost:5173/ });
    expect(button.hasAttribute('disabled')).toBe(false);
    hiddenTabs.set([]);
    await tick();
    await fireEvent.click(button);
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
