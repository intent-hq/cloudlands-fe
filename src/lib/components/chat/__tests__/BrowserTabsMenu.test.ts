/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { dispatchMock, focusPanelMock, layoutState, setActiveTabMock, agentState, mockState } =
  vi.hoisted(() => ({
    agentState: { running: false },
    mockState: { theme: { name: 'dark' }, browserClients: undefined as unknown },
    dispatchMock: vi.fn(),
    focusPanelMock: vi.fn(),
    setActiveTabMock: vi.fn(),
    layoutState: {
      panels: {} as Record<string, any>,
      hiddenTabs: [] as any[],
    },
  }));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsRunning: { select: () => agentState.running },
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({
    setActiveTab: setActiveTabMock,
    focusPanel: focusPanelMock,
  }),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mockState, dispatch: dispatchMock });
});

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => {
  const readable = (getter: () => unknown) => ({
    subscribe: (run: (value: unknown) => void) => (run(getter()), () => {}),
  });
  const selectPanels = () => readable(() => layoutState.panels);
  selectPanels.select = () => layoutState.panels;
  const selectHiddenTabs = () => readable(() => layoutState.hiddenTabs);
  selectHiddenTabs.select = () => layoutState.hiddenTabs;
  return { selectPanels, selectHiddenTabs };
});

import BrowserTabsMenu from '../BrowserTabsMenu.svelte';
import type { BrowserTabEntry } from '../browser-tab-entries';
import {
  closeTab,
  destroyHiddenTabsByOwnerAgent,
  revealHiddenTabAvoidingPanel,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import {
  browserClientsReducer,
  closeBrowserTabRequested,
  liveClientsReceived,
  ownClientIdReceived,
} from '$store/renderer/slices/browser-clients/browser-clients-slice';
import { initialState as browserClientsInitialState } from '$store/renderer/slices/browser-clients/browser-clients-types';
import type { LiveClient } from '$shared/types/browser-clients';

const ownedTab = (id: string, title = id, hostClientId?: string): BrowserTabEntry['tab'] => ({
  id,
  type: 'browser',
  title,
  browserUrl: `https://${id}.example.test/`, // i18n-ignore (test fixture URL)
  ownerAgentId: 'agent-1',
  ...(hostClientId === undefined ? {} : { hostClientId }),
  closable: true,
});

/** PROTOCOL §5.17 `client.list` rows. */
const liveClient = (clientId: string, hostname: string): LiveClient => ({
  clientId,
  name: 'Intent Desktop',
  capabilities: { browserExec: true },
  hostname,
  connections: 1,
  transports: ['ws'],
  connectedAt: '2026-09-07T00:00:00.000Z',
});

/** This renderer is `cli-me`; `live` lists the connected clients. */
function seedClients(live: LiveClient[]) {
  let state = browserClientsReducer(browserClientsInitialState, ownClientIdReceived('cli-me'));
  state = browserClientsReducer(state, liveClientsReceived(live));
  mockState.browserClients = state;
}

function seedLayout(visibleCount: number, hiddenCount = 0) {
  layoutState.panels = {
    chat: {
      id: 'chat',
      activeTabId: 'agent-tab',
      tabs: [
        {
          id: 'agent-tab',
          type: 'agent',
          title: 'Agent',
          agentId: 'agent-1',
          closable: true,
        },
      ],
    },
    browser: {
      id: 'browser',
      activeTabId: visibleCount > 0 ? 'visible-1' : null,
      tabs: Array.from({ length: visibleCount }, (_, index) =>
        ownedTab(`visible-${index + 1}`, `Visible ${index + 1}`),
      ),
    },
  };
  layoutState.hiddenTabs = Array.from({ length: hiddenCount }, (_, index) =>
    ownedTab(`hidden-${index + 1}`, `Hidden ${index + 1}`),
  );
}

function renderMenu() {
  return render(BrowserTabsMenu, { workspaceId: 'ws-1', agentId: 'agent-1' });
}

afterEach(() => {
  cleanup();
  agentState.running = false;
  mockState.browserClients = undefined;
  dispatchMock.mockClear();
  focusPanelMock.mockClear();
  setActiveTabMock.mockClear();
  layoutState.panels = {};
  layoutState.hiddenTabs = [];
});

describe('BrowserTabsMenu', () => {
  it('renders nothing when the agent owns no browser tabs', () => {
    seedLayout(0);
    renderMenu();
    expect(screen.queryByTestId('browser-tabs-trigger')).toBeNull();
  });

  it('renders preview entries without routing clicks through the product store', async () => {
    seedLayout(1);
    const entries: BrowserTabEntry[] = [
      {
        tab: ownedTab('preview-visible', 'Preview visible'),
        panelId: 'preview-panel',
        active: true,
        hidden: false,
      },
      {
        tab: ownedTab('preview-hidden', 'Preview hidden'),
        active: false,
        hidden: true,
      },
    ];

    render(BrowserTabsMenu, { workspaceId: 'ws-1', agentId: 'agent-1', entries });
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    const items = await screen.findAllByTestId('browser-tabs-menu-item');
    expect(items.map((item) => item.getAttribute('data-browser-tab-id'))).toEqual([
      'preview-visible',
      'preview-hidden',
    ]);
    await fireEvent.click(items[0]);

    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    const reopenedItems = await screen.findAllByTestId('browser-tabs-menu-item');
    await fireEvent.click(reopenedItems[1]);

    expect(setActiveTabMock).not.toHaveBeenCalled();
    expect(focusPanelMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it.each([
    [1, '1 browser tab'],
    [3, '3 browser tabs'],
    [5, '5 browser tabs'],
  ])('renders %i owned tabs as one labeled trigger', (count, label) => {
    seedLayout(count);
    renderMenu();

    expect(screen.getAllByTestId('browser-tabs-trigger')).toHaveLength(1);
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
  });

  it('lists all owned tabs in visible-then-hidden order', async () => {
    seedLayout(4, 1);
    renderMenu();

    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    const items = await screen.findAllByTestId('browser-tabs-menu-item');
    expect(items.map((item) => item.getAttribute('data-browser-tab-id'))).toEqual([
      'visible-1',
      'visible-2',
      'visible-3',
      'visible-4',
      'hidden-1',
    ]);
  });

  it('marks hidden tabs as dimmed and reveals them away from the conversation panel', async () => {
    seedLayout(1, 1);
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));

    const hidden = screen
      .getAllByTestId('browser-tabs-menu-item')
      .find((item) => item.getAttribute('data-browser-tab-id') === 'hidden-1')!;
    expect(hidden.getAttribute('data-hidden')).toBe('true');
    expect(hidden.classList).toContain('opacity-60');
    await fireEvent.click(hidden);

    const reveal = dispatchMock.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === revealHiddenTabAvoidingPanel('ws-1', 'x', null).type);
    expect(reveal?.payload).toMatchObject({
      wsId: 'ws-1',
      tabId: 'hidden-1',
      avoidPanelId: 'chat',
    });
    expect(focusPanelMock).not.toHaveBeenCalled();
  });

  it('activates and focuses visible tabs through the panel layout manager', async () => {
    seedLayout(1);
    renderMenu();

    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    await fireEvent.click(await screen.findByTestId('browser-tabs-menu-item'));
    expect(setActiveTabMock).toHaveBeenCalledWith('visible-1', 'browser');
    expect(focusPanelMock).toHaveBeenCalledWith('browser');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

const dispatchedActions = () => dispatchMock.mock.calls.map(([action]) => action);
const closeTabType = closeTab('ws', 't').type;
const destroyHiddenType = destroyHiddenTabsByOwnerAgent('ws', 'a').type;

describe('permanent close actions (intent#4762)', () => {
  it('per-row Close destroys a visible owned tab without activating it', async () => {
    seedLayout(1, 1);
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    const closeButtons = screen.getAllByTestId('browser-tab-close');
    expect(closeButtons).toHaveLength(2);
    expect(closeButtons[0].getAttribute('aria-label')).toContain('Visible 1');

    await fireEvent.click(closeButtons[0]);

    const close = dispatchedActions().find((a) => a.type === closeTabType);
    expect(close?.payload).toMatchObject({
      wsId: 'ws-1',
      tabId: 'visible-1',
      panelId: 'browser',
      destroy: true,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(setActiveTabMock).not.toHaveBeenCalled();
    expect(focusPanelMock).not.toHaveBeenCalled();
  });

  it('per-row Close destroys a hidden owned tab instead of revealing it', async () => {
    seedLayout(1, 1);
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    await fireEvent.click(screen.getAllByTestId('browser-tab-close')[1]);

    const actions = dispatchedActions();
    const close = actions.find((a) => a.type === closeTabType);
    expect(close?.payload).toMatchObject({ wsId: 'ws-1', tabId: 'hidden-1', destroy: true });
    expect(
      actions.some((a) => a.type === revealHiddenTabAvoidingPanel('ws-1', 'x', null).type),
    ).toBe(false);
  });

  it('"Close hidden tabs" destroys only this agent hidden tabs and is absent without hidden tabs', async () => {
    seedLayout(1, 1);
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    await fireEvent.click(screen.getByTestId('browser-tabs-close-hidden'));

    const actions = dispatchedActions();
    const bulk = actions.find((a) => a.type === destroyHiddenType);
    expect(bulk?.payload).toMatchObject({ wsId: 'ws-1', agentId: 'agent-1' });
    expect(actions.some((a) => a.type === closeTabType)).toBe(false);
    cleanup();

    seedLayout(1, 1);
    layoutState.hiddenTabs = [];
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    expect(screen.queryByTestId('browser-tabs-close-hidden')).toBeNull();
  });

  it('asks for confirmation before destroying a tab while the owner agent is running', async () => {
    seedLayout(1, 1);
    agentState.running = true;
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    await fireEvent.click(screen.getAllByTestId('browser-tab-close')[0]);

    expect(dispatchedActions().some((a) => a.type === closeTabType)).toBe(false);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    await fireEvent.click(screen.getByTestId('browser-tabs-close-dialog-confirm'));
    const close = dispatchedActions().find((a) => a.type === closeTabType);
    expect(close?.payload).toMatchObject({ wsId: 'ws-1', tabId: 'visible-1', destroy: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancelling the confirmation destroys nothing', async () => {
    seedLayout(1, 1);
    agentState.running = true;
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    await fireEvent.click(screen.getByTestId('browser-tabs-close-hidden'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('browser-tabs-close-dialog-cancel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(dispatchedActions().some((a) => a.type === destroyHiddenType)).toBe(false);
    expect(dispatchedActions().some((a) => a.type === closeTabType)).toBe(false);
  });

  it('confirms the bulk close while the owner agent is running, then dispatches it', async () => {
    seedLayout(1, 1);
    agentState.running = true;
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    await fireEvent.click(screen.getByTestId('browser-tabs-close-hidden'));
    expect(dispatchedActions().some((a) => a.type === destroyHiddenType)).toBe(false);

    await fireEvent.click(screen.getByTestId('browser-tabs-close-dialog-confirm'));
    const bulk = dispatchedActions().find((a) => a.type === destroyHiddenType);
    expect(bulk?.payload).toMatchObject({ wsId: 'ws-1', agentId: 'agent-1' });
  });
});

// A tab the registry homes on another client (REV-2 §5.45) has no local
// webview to destroy: a local destroy would only drop the mirror while the
// daemon row (and the host's tab) live on and re-materialise on the next
// event or reconnect. Such tabs close on their host via `browser.closeTab`.
describe('mirrors hosted by another client', () => {
  const me = liveClient('cli-me', 'dev-box');
  const other = liveClient('cli-other', 'travel-air');

  function seedMixedLayout() {
    layoutState.panels = {
      chat: {
        id: 'chat',
        activeTabId: 'agent-tab',
        tabs: [{ id: 'agent-tab', type: 'agent', title: 'Chat', agentId: 'agent-1' }],
      },
      p1: {
        id: 'p1',
        activeTabId: 'mine',
        tabs: [ownedTab('mine', 'Mine', 'cli-me'), ownedTab('mirror', 'Mirror', 'cli-other')],
      },
    };
    layoutState.hiddenTabs = [
      ownedTab('hidden-mine', 'Hidden mine', 'cli-me'),
      ownedTab('hidden-unhomed', 'Hidden unhomed'),
      ownedTab('hidden-mirror', 'Hidden mirror', 'cli-other'),
    ];
  }

  it('closes a visible mirror on its connected host instead of destroying it locally', async () => {
    seedClients([me, other]);
    seedMixedLayout();
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    await fireEvent.click(screen.getAllByTestId('browser-tab-close')[1]);

    expect(dispatchedActions()).toEqual([closeBrowserTabRequested('mirror', false)]);
  });

  it('still destroys a tab hosted here locally', async () => {
    seedClients([me, other]);
    seedMixedLayout();
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    await fireEvent.click(screen.getAllByTestId('browser-tab-close')[0]);

    const actions = dispatchedActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe(closeTabType);
    expect(actions[0].payload).toMatchObject({ wsId: 'ws-1', tabId: 'mine', destroy: true });
  });

  it('force-closes a hidden mirror whose host is offline', async () => {
    seedClients([me]);
    seedMixedLayout();
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    await fireEvent.click(screen.getAllByTestId('browser-tab-close')[4]);

    expect(dispatchedActions()).toEqual([closeBrowserTabRequested('hidden-mirror', true)]);
  });

  it('"Close hidden tabs" destroys the hidden tabs hosted here and closes hidden mirrors on their host', async () => {
    seedClients([me, other]);
    seedMixedLayout();
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    await fireEvent.click(screen.getByTestId('browser-tabs-close-hidden'));

    const actions = dispatchedActions();
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe(destroyHiddenType);
    expect(actions[0].payload).toMatchObject({
      wsId: 'ws-1',
      agentId: 'agent-1',
      ownClientId: 'cli-me',
    });
    expect(actions[1]).toEqual(closeBrowserTabRequested('hidden-mirror', false));
  });

  it('"Close hidden tabs" with only mirrors hidden dispatches no local destroy', async () => {
    seedClients([me]);
    seedMixedLayout();
    layoutState.hiddenTabs = [ownedTab('hidden-mirror', 'Hidden mirror', 'cli-other')];
    renderMenu();
    await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
    await fireEvent.click(screen.getByTestId('browser-tabs-close-hidden'));

    expect(dispatchedActions()).toEqual([closeBrowserTabRequested('hidden-mirror', true)]);
  });
});

it('lets keyboard users move between a tab and its close control without revealing it', async () => {
  seedLayout(1, 1);
  renderMenu();
  await fireEvent.click(screen.getByTestId('browser-tabs-trigger'));
  const item = screen.getAllByTestId('browser-tabs-menu-item')[1];
  const close = screen.getAllByTestId('browser-tab-close')[1];
  item.focus();
  await fireEvent.keyDown(item, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(close);
  await fireEvent.keyDown(close, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(item);
  expect(dispatchMock).not.toHaveBeenCalled();
});
