/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dispatchMock, focusPanelMock, layoutState, resizeState, setActiveTabMock } = vi.hoisted(
  () => ({
    dispatchMock: vi.fn(),
    focusPanelMock: vi.fn(),
    setActiveTabMock: vi.fn(),
    layoutState: {
      panels: {} as Record<string, any>,
      hiddenTabs: [] as any[],
    },
    resizeState: {
      callback: null as ResizeObserverCallback | null,
    },
  }),
);

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

import BrowserTabChips from '../BrowserTabChips.svelte';
import { revealHiddenTabAvoidingPanel } from '$store/renderer/slices/panel-layout/panel-layout-slice';

const ownedTab = (id: string, title = id) => ({
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

function renderChips() {
  return render(BrowserTabChips, { workspaceId: 'ws-1', agentId: 'agent-1' });
}

async function resizeHeader(width: number) {
  await waitFor(() => expect(resizeState.callback).not.toBeNull());
  resizeState.callback?.(
    [{ contentRect: { width } } as unknown as ResizeObserverEntry],
    {} as ResizeObserver,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeState.callback = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  dispatchMock.mockClear();
  focusPanelMock.mockClear();
  setActiveTabMock.mockClear();
  layoutState.panels = {};
  layoutState.hiddenTabs = [];
  resizeState.callback = null;
  vi.unstubAllGlobals();
});

describe('BrowserTabChips', () => {
  it('renders nothing when the agent owns no browser tabs', () => {
    seedLayout(0);
    renderChips();
    expect(screen.queryByTestId('browser-tab-chips')).toBeNull();
  });

  it.each([
    [1, 1, null],
    [3, 3, null],
    [5, 3, '+2'],
  ])('renders %i owned tabs as %i direct chips with overflow %s', (count, direct, overflow) => {
    seedLayout(count);
    renderChips();

    expect(screen.getAllByTestId('browser-tab-chip')).toHaveLength(direct);
    if (overflow) {
      expect(screen.getByTestId('browser-tab-chips-overflow').textContent?.trim()).toBe(overflow);
    } else {
      expect(screen.queryByTestId('browser-tab-chips-overflow')).toBeNull();
    }
  });

  it('lists all owned tabs in visible-then-hidden order from the overflow menu', async () => {
    seedLayout(4, 1);
    renderChips();

    await fireEvent.click(screen.getByTestId('browser-tab-chips-overflow'));
    const items = await screen.findAllByTestId('browser-tab-chips-menu-item');
    expect(items.map((item) => item.getAttribute('data-browser-tab-id'))).toEqual([
      'visible-1',
      'visible-2',
      'visible-3',
      'visible-4',
      'hidden-1',
    ]);
  });

  it('collapses below 400px to one count chip opening the full menu', async () => {
    seedLayout(3);
    renderChips();
    await resizeHeader(399);

    await waitFor(() => expect(screen.queryAllByTestId('browser-tab-chip')).toHaveLength(0));
    expect(screen.getByTestId('browser-tab-chips-overflow').textContent?.trim()).toBe('+3');
    await fireEvent.click(screen.getByTestId('browser-tab-chips-overflow'));
    expect(await screen.findAllByTestId('browser-tab-chips-menu-item')).toHaveLength(3);
  });

  it('marks hidden tabs as dimmed and reveals them away from the conversation panel', async () => {
    seedLayout(1, 1);
    renderChips();

    const hidden = screen
      .getAllByTestId('browser-tab-chip')
      .find((chip) => chip.getAttribute('data-browser-tab-id') === 'hidden-1')!;
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
    renderChips();

    await fireEvent.click(screen.getByTestId('browser-tab-chip'));
    expect(setActiveTabMock).toHaveBeenCalledWith('visible-1', 'browser');
    expect(focusPanelMock).toHaveBeenCalledWith('browser');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
