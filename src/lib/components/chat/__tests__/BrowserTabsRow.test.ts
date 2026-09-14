/**
 * @vitest-environment jsdom
 *
 * BrowserTabsRow rendering: collapsed-by-default "Browser tabs (N)" summary
 * counting the agent's owned browser tabs (visible + hidden, monorepo#2857),
 * expanded tab rows, and the click-to-reveal wiring — visible tabs
 * activate + focus via the panel layout manager (sidebar path), hidden tabs
 * reveal into a panel other than the one hosting the conversation, never
 * displacing the conversation tab or moving panel focus. Also the permanent
 * close actions (intent#4762): per-row Close destroys the owned tab, "Close
 * hidden tabs" destroys only this agent's hidden tabs, a mirror hosted by
 * another client is closed on its host through `browser.closeTab` (forced
 * while that host is offline), and both are gated behind a confirmation
 * while the owner agent is running.
 */
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resetAgentSubscriptionsViewStateForTests } from '../agent-subscriptions-view-state';

const { dispatchMock, layoutState, agentState, mockState, setActiveTabMock, focusPanelMock } =
  vi.hoisted(() => ({
    dispatchMock: vi.fn(),
    layoutState: {
      panels: {} as Record<string, unknown>,
      hiddenTabs: [] as unknown[],
    },
    agentState: { running: false },
    mockState: {
      theme: { name: 'dark' },
      browserClients: undefined as unknown,
    },
    setActiveTabMock: vi.fn(),
    focusPanelMock: vi.fn(),
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
  return createAppStoreMockModule({
    state: () => mockState,
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => {
  const readable = (getter: () => unknown) => ({
    subscribe: (run: (value: unknown) => void) => {
      run(getter());
      return () => {};
    },
  });
  const selectPanels = () => readable(() => layoutState.panels);
  selectPanels.select = () => layoutState.panels;
  const selectHiddenTabs = () => readable(() => layoutState.hiddenTabs);
  selectHiddenTabs.select = () => layoutState.hiddenTabs;
  return { selectPanels, selectHiddenTabs };
});

import BrowserTabsRow from '../BrowserTabsRow.svelte';
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

const ownedTab = (id: string, title: string, hostClientId?: string) => ({
  id,
  type: 'browser',
  title,
  browserUrl: `http://example.test/${id}`, // i18n-ignore (test fixture URL)
  ownerAgentId: 'agent-1',
  ...(hostClientId === undefined ? {} : { hostClientId }),
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

function seedLayout() {
  layoutState.panels = {
    chat: {
      id: 'chat',
      activeTabId: 'agent-tab',
      tabs: [{ id: 'agent-tab', type: 'agent', title: 'Chat', agentId: 'agent-1' }],
    },
    p1: {
      id: 'p1',
      activeTabId: 'visible-1',
      tabs: [ownedTab('visible-1', 'Docs'), { id: 'note-1', type: 'note', title: 'Note' }],
    },
  };
  layoutState.hiddenTabs = [ownedTab('hidden-1', 'Preview')];
}

afterEach(() => {
  cleanup();
  dispatchMock.mockClear();
  setActiveTabMock.mockClear();
  focusPanelMock.mockClear();
  layoutState.panels = {};
  layoutState.hiddenTabs = [];
  agentState.running = false;
  mockState.browserClients = undefined;
  resetAgentSubscriptionsViewStateForTests();
});

function renderRow() {
  return render(BrowserTabsRow, { workspaceId: 'ws-1', agentId: 'agent-1' });
}

const dispatchedActions = () => dispatchMock.mock.calls.map(([action]) => action);
const closeTabType = closeTab('ws', 't').type;
const destroyHiddenType = destroyHiddenTabsByOwnerAgent('ws', 'a').type;

describe('BrowserTabsRow', () => {
  it('renders nothing when the agent owns no browser tabs', () => {
    layoutState.panels = {
      p1: {
        id: 'p1',
        activeTabId: 't1',
        tabs: [{ ...ownedTab('t1', 'X'), ownerAgentId: 'other' }],
      },
    };
    renderRow();
    expect(screen.queryByTestId('browser-tabs-row')).toBeNull();
  });

  it('shows a collapsed summary counting visible + hidden owned tabs', () => {
    seedLayout();
    renderRow();
    const toggle = screen.getByTestId('browser-tabs-summary');
    expect(screen.getByText('Browser tabs (2)')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('browser-tabs-list')).toBeNull();
  });

  it('expands to list rows, marking hidden tabs, and persists across remounts', async () => {
    seedLayout();
    const first = renderRow();
    await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
    const rows = screen.getAllByTestId('browser-tab-item');
    expect(rows.map((row) => row.getAttribute('data-browser-tab-id'))).toEqual([
      'visible-1',
      'hidden-1',
    ]);
    expect(rows[0].getAttribute('data-active')).toBe('true');
    expect(rows[1].getAttribute('data-hidden')).toBe('true');
    first.unmount();

    renderRow();
    expect(screen.getByTestId('browser-tabs-summary').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByTestId('browser-tab-item')).toHaveLength(2);
  });

  it('activates and focuses an already-visible tab via the layout manager', async () => {
    seedLayout();
    renderRow();
    await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
    await fireEvent.click(screen.getAllByTestId('browser-tab-item')[0]);
    expect(setActiveTabMock).toHaveBeenCalledWith('visible-1', 'p1');
    expect(focusPanelMock).toHaveBeenCalledWith('p1');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('reveals a hidden tab avoiding the panel hosting the conversation', async () => {
    seedLayout();
    renderRow();
    await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
    await fireEvent.click(screen.getAllByTestId('browser-tab-item')[1]);

    const dispatched = dispatchMock.mock.calls.map(([action]) => action);
    const reveal = dispatched.find(
      (a) => a.type === revealHiddenTabAvoidingPanel('ws-1', 'x', null).type,
    );
    // The conversation panel ('chat' hosts this agent's tab) is avoided, so
    // the reveal can never displace the conversation tab.
    expect(reveal?.payload).toMatchObject({
      wsId: 'ws-1',
      tabId: 'hidden-1',
      avoidPanelId: 'chat',
    });
    // No panel-focus steal on the hidden-tab path.
    expect(focusPanelMock).not.toHaveBeenCalled();
    expect(setActiveTabMock).not.toHaveBeenCalled();
  });

  it('passes a null avoided panel when no panel hosts the conversation', async () => {
    seedLayout();
    delete (layoutState.panels as Record<string, unknown>).chat;
    renderRow();
    await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
    await fireEvent.click(screen.getAllByTestId('browser-tab-item')[1]);

    const dispatched = dispatchMock.mock.calls.map(([action]) => action);
    const reveal = dispatched.find(
      (a) => a.type === revealHiddenTabAvoidingPanel('ws-1', 'x', null).type,
    );
    expect(reveal?.payload).toMatchObject({ wsId: 'ws-1', tabId: 'hidden-1', avoidPanelId: null });
  });

  describe('permanent close actions (intent#4762)', () => {
    it('per-row Close destroys a visible owned tab without activating it', async () => {
      seedLayout();
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
      const closeButtons = screen.getAllByTestId('browser-tab-close');
      expect(closeButtons).toHaveLength(2);
      expect(closeButtons[0].getAttribute('aria-label')).toContain('Docs');

      await fireEvent.click(closeButtons[0]);

      const close = dispatchedActions().find((a) => a.type === closeTabType);
      expect(close?.payload).toMatchObject({
        wsId: 'ws-1',
        tabId: 'visible-1',
        panelId: 'p1',
        destroy: true,
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(setActiveTabMock).not.toHaveBeenCalled();
      expect(focusPanelMock).not.toHaveBeenCalled();
    });

    it('per-row Close destroys a hidden owned tab instead of revealing it', async () => {
      seedLayout();
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
      await fireEvent.click(screen.getAllByTestId('browser-tab-close')[1]);

      const actions = dispatchedActions();
      const close = actions.find((a) => a.type === closeTabType);
      expect(close?.payload).toMatchObject({ wsId: 'ws-1', tabId: 'hidden-1', destroy: true });
      expect(
        actions.some((a) => a.type === revealHiddenTabAvoidingPanel('ws-1', 'x', null).type),
      ).toBe(false);
    });

    it('"Close hidden tabs" destroys only this agent hidden tabs and is absent without hidden tabs', async () => {
      seedLayout();
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
      await fireEvent.click(screen.getByTestId('browser-tabs-close-hidden'));

      const actions = dispatchedActions();
      const bulk = actions.find((a) => a.type === destroyHiddenType);
      expect(bulk?.payload).toMatchObject({ wsId: 'ws-1', agentId: 'agent-1' });
      expect(actions.some((a) => a.type === closeTabType)).toBe(false);
      cleanup();

      seedLayout();
      layoutState.hiddenTabs = [];
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
      expect(screen.queryByTestId('browser-tabs-close-hidden')).toBeNull();
    });

    it('asks for confirmation before destroying a tab while the owner agent is running', async () => {
      seedLayout();
      agentState.running = true;
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
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
      seedLayout();
      agentState.running = true;
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
      await fireEvent.click(screen.getByTestId('browser-tabs-close-hidden'));
      expect(screen.getByRole('dialog')).toBeTruthy();

      await fireEvent.click(screen.getByTestId('browser-tabs-close-dialog-cancel'));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(dispatchedActions().some((a) => a.type === destroyHiddenType)).toBe(false);
      expect(dispatchedActions().some((a) => a.type === closeTabType)).toBe(false);
    });

    it('confirms the bulk close while the owner agent is running, then dispatches it', async () => {
      seedLayout();
      agentState.running = true;
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
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
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
      await fireEvent.click(screen.getAllByTestId('browser-tab-close')[1]);

      expect(dispatchedActions()).toEqual([closeBrowserTabRequested('mirror', false)]);
    });

    it('still destroys a tab hosted here locally', async () => {
      seedClients([me, other]);
      seedMixedLayout();
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
      await fireEvent.click(screen.getAllByTestId('browser-tab-close')[0]);

      const actions = dispatchedActions();
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe(closeTabType);
      expect(actions[0].payload).toMatchObject({ wsId: 'ws-1', tabId: 'mine', destroy: true });
    });

    it('force-closes a hidden mirror whose host is offline', async () => {
      seedClients([me]);
      seedMixedLayout();
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
      await fireEvent.click(screen.getAllByTestId('browser-tab-close')[4]);

      expect(dispatchedActions()).toEqual([closeBrowserTabRequested('hidden-mirror', true)]);
    });

    it('"Close hidden tabs" destroys the hidden tabs hosted here and closes hidden mirrors on their host', async () => {
      seedClients([me, other]);
      seedMixedLayout();
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
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
      renderRow();
      await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
      await fireEvent.click(screen.getByTestId('browser-tabs-close-hidden'));

      expect(dispatchedActions()).toEqual([closeBrowserTabRequested('hidden-mirror', true)]);
    });
  });
});
