import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

const navigateToAgent = vi.hoisted(() => vi.fn());
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToAgent }));
vi.mock('$lib/components/browser/EmbeddedBrowser.svelte', async () => ({
  default: (await import('./mocks/MockEmbeddedBrowser.svelte')).default,
}));
vi.mock('$lib/components/browser/BrowserViewerTab.svelte', async () => ({
  default: (await import('./mocks/MockBrowserViewerTab.svelte')).default,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { initialState: permission } =
    await import('$store/renderer/slices/permission/permission-slice');
  return createAppStoreMockModule({
    state: { workspaceAgents: { byWorkspaceId: {} }, permission },
  });
});

import Harness from './mocks/BrowserTabTypeHeaderHarness.svelte';

const ownedTab = (id: string): PanelTab => ({
  id,
  type: 'browser',
  title: 'Browser',
  browserUrl: 'about:blank',
  closable: true,
  ownerAgentId: `agent-${id}`,
  ownerAgentName: `Owner ${id}`,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('browser connected agent in the panel header', () => {
  it.each([undefined, 'remote-client'])(
    'navigates to the owner for host %s',
    async (hostClientId) => {
      const tab = { ...ownedTab('one'), hostClientId };
      render(Harness, { tabs: [tab], activeTabId: tab.id });

      const header = within(screen.getByTestId('panel-header'));
      await fireEvent.click(header.getByRole('button', { name: /Owner one/ }));
      expect(navigateToAgent).toHaveBeenCalledWith('agent-one');
    },
  );

  it('follows the active tab and keeps its registration when an inactive tab unmounts', async () => {
    const tabs = [ownedTab('one'), ownedTab('two')];
    const view = render(Harness, { tabs, activeTabId: 'one' });
    const header = within(screen.getByTestId('panel-header'));
    await fireEvent.click(header.getByRole('button', { name: /Owner one/ }));
    expect(navigateToAgent).toHaveBeenLastCalledWith('agent-one');

    await view.rerender({ tabs, activeTabId: 'two' });
    expect(header.queryByRole('button', { name: /Owner one/ })).toBeNull();
    await fireEvent.click(header.getByRole('button', { name: /Owner two/ }));
    expect(navigateToAgent).toHaveBeenLastCalledWith('agent-two');

    await view.rerender({ tabs: [tabs[1]], activeTabId: 'two' });
    await fireEvent.click(header.getByRole('button', { name: /Owner two/ }));
    expect(navigateToAgent).toHaveBeenLastCalledWith('agent-two');

    await view.rerender({ tabs: [], activeTabId: '' });
    expect(header.queryByRole('button')).toBeNull();
  });

  it('rebinds ownership and clears the chip when the tab becomes unowned', async () => {
    const tab = ownedTab('one');
    const view = render(Harness, { tabs: [tab], activeTabId: tab.id });
    const header = within(screen.getByTestId('panel-header'));
    await view.rerender({
      tabs: [{ ...tab, ownerAgentId: 'agent-new', ownerAgentName: 'New owner' }],
      activeTabId: tab.id,
    });
    await fireEvent.click(header.getByRole('button', { name: /New owner/ }));
    expect(navigateToAgent).toHaveBeenCalledWith('agent-new');

    await view.rerender({ tabs: [{ ...tab, ownerAgentId: undefined }], activeTabId: tab.id });
    expect(header.queryByRole('button')).toBeNull();
  });
});
