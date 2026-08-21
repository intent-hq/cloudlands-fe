/**
 * @vitest-environment jsdom
 *
 * BrowserTabsRow rendering: collapsed-by-default "Browser tabs (N)" summary
 * counting the agent's owned browser tabs (visible + hidden, monorepo#2857),
 * expanded tab rows, and the click-to-reveal wiring — visible tabs
 * activate + focus via the panel layout manager (sidebar path), hidden tabs
 * restore without focus and then activate in the hosting panel.
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
import {
  restoreHiddenTab,
  setActiveTab,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';

const ownedTab = (id: string, title: string) => ({
  id,
  type: 'browser',
  title,
  browserUrl: `http://example.test/${id}`, // i18n-ignore (test fixture URL)
  ownerAgentId: 'agent-1',
});

function seedLayout() {
  layoutState.panels = {
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

  it('reveals a hidden tab: restore without focus, then activate in the hosting panel', async () => {
    seedLayout();
    // Simulate the reducer: the focus-less restore mounts the tab into p1's
    // tab list, so the follow-up host-panel lookup finds it there.
    dispatchMock.mockImplementation((action: { type?: string }) => {
      if (action?.type === restoreHiddenTab('ws-1', 'hidden-1').type) {
        const p1 = layoutState.panels.p1 as { tabs: unknown[] };
        p1.tabs = [...p1.tabs, ownedTab('hidden-1', 'Preview')];
        layoutState.hiddenTabs = [];
      }
    });
    renderRow();
    await fireEvent.click(screen.getByTestId('browser-tabs-summary'));
    await fireEvent.click(screen.getAllByTestId('browser-tab-item')[1]);

    const dispatched = dispatchMock.mock.calls.map(([action]) => action);
    const restore = dispatched.find((a) => a.type === restoreHiddenTab('ws-1', 'x').type);
    expect(restore?.payload).toMatchObject({ wsId: 'ws-1', tabId: 'hidden-1', focus: false });
    const activate = dispatched.find((a) => a.type === setActiveTab('ws-1', 'x').type);
    expect(activate?.payload).toMatchObject({ wsId: 'ws-1', tabId: 'hidden-1', panelId: 'p1' });
    // No panel-focus steal on the hidden-tab path.
    expect(focusPanelMock).not.toHaveBeenCalled();
    expect(setActiveTabMock).not.toHaveBeenCalled();
  });
});
