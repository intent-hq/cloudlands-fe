import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveClient } from '$shared/types/browser-clients';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import {
  browserClientsReducer,
  initialState as browserClientsInitialState,
  liveClientsReceived,
  ownClientIdReceived,
} from '$store/renderer/slices/browser-clients/browser-clients-slice';

const dispatch = vi.hoisted(() => vi.fn());
const mockState = vi.hoisted(() => ({
  panelLayout: { byWorkspaceId: {} as Record<string, unknown> },
  workspaceAgents: { byWorkspaceId: {} },
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

const client = (clientId: string, hostname: string): LiveClient => ({
  clientId,
  name: 'Intent Desktop',
  capabilities: { browserExec: true },
  hostname,
  connections: 1,
  transports: ['uds'],
  connectedAt: '2026-11-07T00:00:00.000Z',
});

function seedClients(live: LiveClient[]) {
  let state = browserClientsReducer(browserClientsInitialState, ownClientIdReceived('cli-desk'));
  state = browserClientsReducer(state, liveClientsReceived(live, 'workspace-1'));
  mockState.browserClients = state;
}

const tab = (hostClientId: string | undefined, owned: boolean): PanelTab => ({
  id: 'browser-tab',
  type: 'browser',
  title: 'Intent docs',
  closable: true,
  browserUrl: 'https://intentapp.dev/docs',
  ...(hostClientId === undefined ? {} : { hostClientId }),
  ...(owned ? { ownerAgentId: 'agent-7', ownerAgentName: 'Docs agent' } : {}),
});

const renderTab = (hostClientId: string | undefined, owned: boolean) =>
  render(BrowserTabType, {
    props: {
      tab: tab(hostClientId, owned),
      workspaceId: 'workspace-1',
      layoutId: 'workspace-1',
      isActive: true,
      isPanelFocused: false,
    },
  });

const warning = () => document.querySelector('[data-browser-tab-not-primary]');
const agentBar = () => document.querySelector('[data-browser-tab-agent-control]');

describe('browser tab notices above the address bar', () => {
  beforeEach(() => {
    dispatch.mockClear();
    seedClients([client('cli-desk', 'dev-box'), client('cli-laptop', 'travel-air')]);
  });
  afterEach(cleanup);

  it.each([undefined, 'cli-desk'])(
    'shows only the agent bar on the primary computer (host %s) and opens the agent on click',
    async (hostClientId) => {
      renderTab(hostClientId, true);
      expect(warning()).toBeNull();
      const bar = screen.getByRole('button', { name: /Docs agent/ });
      expect(agentBar()?.contains(bar)).toBe(true);
      await fireEvent.click(bar);
      expect(dispatch).toHaveBeenCalledWith(
        openAgentTabRequested('workspace-1', {
          agentId: 'agent-7',
          sourcePanelId: undefined,
          openInAdjacentPanel: false,
        }),
      );
    },
  );

  it('shows no notice for a tab the user owns on the primary computer', () => {
    renderTab('cli-desk', false);
    expect(warning()).toBeNull();
    expect(agentBar()).toBeNull();
  });

  it('warns on a mirror of an agent tab, names the host, and shows the agent bar after it', () => {
    renderTab('cli-laptop', true);
    const warn = warning();
    expect(warn?.textContent).toContain('travel-air');
    expect(warn?.textContent).toMatch(/agent/);
    const bar = agentBar();
    expect(bar).not.toBeNull();
    expect(warn!.compareDocumentPosition(bar!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const viewer = screen.getByTestId('browser-viewer-tab');
    expect(bar!.compareDocumentPosition(viewer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no notice on a mirror of a tab without an owner agent', () => {
    renderTab('cli-laptop', false);
    expect(warning()).toBeNull();
    expect(agentBar()).toBeNull();
  });

  it('leaves the warning to the offline banner while the host is disconnected', () => {
    seedClients([client('cli-desk', 'dev-box')]);
    renderTab('cli-laptop', true);
    expect(warning()).toBeNull();
    expect(agentBar()).not.toBeNull();
  });
});
