/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { dispatchMock, focusPanelMock, layoutState, setActiveTabMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  focusPanelMock: vi.fn(),
  setActiveTabMock: vi.fn(),
  layoutState: {
    panels: {} as Record<string, any>,
    hiddenTabs: [] as any[],
  },
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
  return createAppStoreMockModule({ dispatch: dispatchMock });
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
import { revealHiddenTabAvoidingPanel } from '$store/renderer/slices/panel-layout/panel-layout-slice';

const ownedTab = (id: string, title = id): BrowserTabEntry['tab'] => ({
  id,
  type: 'browser',
  title,
  browserUrl: `https://${id}.example.test/`, // i18n-ignore (test fixture URL)
  ownerAgentId: 'agent-1',
  closable: true,
});

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
