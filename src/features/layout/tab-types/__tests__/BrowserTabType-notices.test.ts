import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveClient } from '$shared/types/browser-clients';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
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

describe('browser ownership changes', () => {
  beforeEach(() => {
    dispatch.mockClear();
    seedClients([client('cli-desk', 'dev-box'), client('cli-laptop', 'travel-air')]);
  });
  afterEach(cleanup);

  it('keeps the same live browser element when the notices appear or disappear', async () => {
    const props = (owned: boolean) => ({
      tab: tab('cli-desk', owned),
      workspaceId: 'workspace-1',
      layoutId: 'workspace-1',
      isActive: true,
      isPanelFocused: false,
    });
    const { rerender } = render(BrowserTabType, { props: props(true) });
    const browser = screen.getByTestId('embedded-browser');

    await rerender(props(false));
    expect(screen.getByTestId('embedded-browser')).toBe(browser);

    await rerender(props(true));
    expect(screen.getByTestId('embedded-browser')).toBe(browser);
  });
});
