import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveClient } from '$shared/types/browser-clients';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import {
  browserClientsReducer,
  closeBrowserTabRequested,
  initialState as browserClientsInitialState,
  liveClientsReceived,
  navigateBrowserTabRequested,
  ownClientIdReceived,
} from '$store/renderer/slices/browser-clients/browser-clients-slice';
import { updateTabFavicon } from '$store/renderer/slices/panel-layout/panel-layout-slice';

const dispatch = vi.hoisted(() => vi.fn());
const mockState = vi.hoisted(() => ({
  panelLayout: { byWorkspaceId: {} as Record<string, unknown> },
  browserClients: undefined as unknown,
}));

vi.mock('$lib/components/browser/EmbeddedBrowser.svelte', async () => ({
  default: (await import('./mocks/MockEmbeddedBrowser.svelte')).default,
}));
vi.mock('$lib/components/browser/BrowserViewerTab.svelte', async () => ({
  default: (await import('./mocks/MockBrowserViewerTab.svelte')).default,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mockState, dispatch });
});

import BrowserTabType from '../BrowserTabType.svelte';

/** PROTOCOL §5.17 `client.list` rows. */
const desk: LiveClient = {
  clientId: 'cli-desk',
  name: 'Intent Desktop',
  capabilities: { browserExec: true },
  hostname: 'dev-box',
  connections: 1,
  transports: ['uds'],
  connectedAt: '2026-09-07T00:00:00.000Z',
};
const laptop: LiveClient = {
  clientId: 'cli-laptop',
  name: 'Intent Desktop',
  capabilities: { browserExec: true },
  hostname: 'travel-air',
  connections: 1,
  transports: ['ws'],
  connectedAt: '2026-09-07T00:00:02.000Z',
};

function seedClients(live: LiveClient[]) {
  let state = browserClientsReducer(browserClientsInitialState, ownClientIdReceived('cli-desk'));
  state = browserClientsReducer(state, liveClientsReceived(live));
  mockState.browserClients = state;
}

const tab = (hostClientId?: string): PanelTab => ({
  id: 'browser-tab',
  type: 'browser',
  title: 'Intent docs',
  closable: true,
  browserUrl: 'https://intentapp.dev/docs',
  ...(hostClientId === undefined ? {} : { hostClientId }),
});

const renderTab = (hostClientId?: string) =>
  render(BrowserTabType, {
    props: {
      tab: tab(hostClientId),
      workspaceId: 'workspace-1',
      layoutId: 'workspace-1',
      isActive: true,
      isPanelFocused: false,
    },
  });

describe('BrowserTabType viewer (mirror) rendering — REV-2 Model 3', () => {
  beforeEach(() => {
    dispatch.mockClear();
    mockState.panelLayout.byWorkspaceId = {};
    seedClients([desk, laptop]);
  });
  afterEach(cleanup);

  it('renders the live webview for a tab hosted here or not yet homed by the registry', () => {
    const { unmount } = renderTab('cli-desk');
    expect(screen.getByTestId('embedded-browser')).toBeTruthy();
    expect(screen.queryByTestId('browser-viewer-tab')).toBeNull();
    unmount();

    renderTab(undefined);
    expect(screen.getByTestId('embedded-browser')).toBeTruthy();
    expect(screen.queryByTestId('browser-viewer-tab')).toBeNull();
  });

  it('renders a mirror at the canonical URL with the host resolved from client.list', () => {
    renderTab('cli-laptop');
    const viewer = screen.getByTestId('browser-viewer-tab');
    expect(screen.queryByTestId('embedded-browser')).toBeNull();
    expect(viewer.getAttribute('data-url')).toBe('https://intentapp.dev/docs');
    expect(viewer.getAttribute('data-title')).toBe('Intent docs');
    expect(viewer.getAttribute('data-host-name')).toBe('travel-air');
    expect(viewer.getAttribute('data-host-connected')).toBe('true');
    expect(viewer.getAttribute('data-is-active')).toBe('true');
  });

  it('flips live → mirror → live as the registry re-homes the tab (hostClientId change)', async () => {
    const { rerender } = renderTab('cli-desk');
    expect(screen.getByTestId('embedded-browser')).toBeTruthy();

    await rerender({
      tab: tab('cli-laptop'),
      workspaceId: 'workspace-1',
      layoutId: 'workspace-1',
      isActive: true,
      isPanelFocused: false,
    });
    expect(screen.queryByTestId('embedded-browser')).toBeNull();
    expect(screen.getByTestId('browser-viewer-tab')).toBeTruthy();

    await rerender({
      tab: tab('cli-desk'),
      workspaceId: 'workspace-1',
      layoutId: 'workspace-1',
      isActive: true,
      isPanelFocused: false,
    });
    expect(screen.getByTestId('embedded-browser')).toBeTruthy();
    expect(screen.queryByTestId('browser-viewer-tab')).toBeNull();
  });

  it('reports the host offline when it is absent from a loaded client.list', () => {
    seedClients([desk]);
    renderTab('cli-laptop');
    const viewer = screen.getByTestId('browser-viewer-tab');
    expect(viewer.getAttribute('data-host-connected')).toBe('false');
  });

  it('forwards navigation and close to the host through the browser-clients actions', async () => {
    renderTab('cli-laptop');
    await fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Close anyway' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Change favicon' }));

    expect(dispatch.mock.calls.map(([a]) => a)).toEqual([
      navigateBrowserTabRequested('browser-tab', 'https://next.example/'),
      closeBrowserTabRequested('browser-tab', false),
      closeBrowserTabRequested('browser-tab', true),
      updateTabFavicon('workspace-1', 'browser-tab', 'https://next.example/favicon.ico'),
    ]);
  });
});
