/**
 * @vitest-environment jsdom
 *
 * BrowserTabsRow rendering: an inline single tab or collapsed-by-default
 * multi-tab summary counting the agent's owned browser tabs (visible + hidden,
 * monorepo#2857), expanded tab rows, and the click-to-reveal wiring — visible tabs
 * activate + focus via the panel layout manager (sidebar path), hidden tabs
 * reveal into a panel other than the one hosting the conversation, never
 * displacing the conversation tab or moving panel focus.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resetAgentSubscriptionsViewStateForTests } from '../agent-subscriptions-view-state';

const { dispatchMock, layoutState, setActiveTabMock, focusPanelMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  layoutState: {
    panels: {} as Record<string, unknown>,
    hiddenTabs: [] as unknown[],
  },
  setActiveTabMock: vi.fn(),
  focusPanelMock: vi.fn(),
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
    state: () => ({ theme: { name: 'dark' } }),
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
import { revealHiddenTabAvoidingPanel } from '$store/renderer/slices/panel-layout/panel-layout-slice';

const ownedTab = (id: string, title: string) => ({
  id,
  type: 'browser',
  title,
  browserUrl: `http://example.test/${id}`, // i18n-ignore (test fixture URL)
  ownerAgentId: 'agent-1',
});

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
  resetAgentSubscriptionsViewStateForTests();
});

function renderRow() {
  return render(BrowserTabsRow, { workspaceId: 'ws-1', agentId: 'agent-1' });
}

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
    expect(screen.getByText('2 browser tabs')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('browser-tabs-list')).toBeNull();
  });

  it('renders one browser tab inline and activates it without a disclosure', async () => {
    layoutState.panels = {
      p1: {
        id: 'p1',
        activeTabId: 'note-1',
        tabs: [ownedTab('visible-1', 'Docs'), { id: 'note-1', type: 'note', title: 'Note' }],
      },
    };
    renderRow();

    expect(screen.queryByTestId('browser-tabs-summary')).toBeNull();
    expect(screen.queryByTestId('browser-tabs-list')).toBeNull();
    expect(screen.getByTestId('browser-tabs-row').getAttribute('aria-label')).toBe('1 browser tab');
    const item = screen.getByTestId('browser-tab-item');
    expect(screen.getByText('http://example.test/visible-1').classList).toContain(
      'text-muted-foreground',
    );

    await fireEvent.click(item);
    expect(setActiveTabMock).toHaveBeenCalledWith('visible-1', 'p1');
    expect(focusPanelMock).toHaveBeenCalledWith('p1');
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
});
