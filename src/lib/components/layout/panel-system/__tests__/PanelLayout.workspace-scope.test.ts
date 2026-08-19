import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dispatchMock, readableSelector } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  readableSelector: (value: unknown) =>
    Object.assign(
      () => ({ subscribe: (listener: (next: unknown) => void) => (listener(value), () => {}) }),
      { select: () => value },
    ),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ tabState: { currentTabId: 'ws-redux-b' } }),
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectPanelLayoutRoot: readableSelector(null),
  selectExpandedPanelId: readableSelector(null),
  selectPanels: readableSelector({}),
  selectFocusedPanelId: readableSelector(null),
  selectFocusedPanel: readableSelector(null),
  selectActiveTab: readableSelector(null),
  selectAllTabs: readableSelector([]),
  selectPanelColumnCount: readableSelector(0),
  selectPanelColumnDefaultWidthTiers: readableSelector([]),
  selectPanelCanvasWidth: readableSelector(null),
  selectPanelCanvasWidthSource: readableSelector(null),
  selectPanelIds: readableSelector([]),
  selectPendingPanelReveal: readableSelector(null),
  selectRestoreStatus: readableSelector('pending'),
  selectRecentlyClosed: readableSelector([]),
}));
vi.mock('$store/renderer/slices/terminals/terminals-selectors', () => ({
  selectIsTerminalOverlayOpen: readableSelector(true),
}));
vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectIsCollapsed: readableSelector(false),
  selectResizablePanelSize: () => readableSelector(null)(),
  selectResizablePanelSizeHydrated: () => readableSelector(true)(),
  selectSidebarSide: readableSelector('left'),
  selectSidebarExpandedWidth: readableSelector(320),
  selectSidebarWidth: readableSelector(320),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: readableSelector(null),
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectIsDragging: readableSelector(false),
}));

vi.mock('$store/renderer/slices/terminals/terminals-slice', () => ({
  removeTerminal: vi.fn(),
  terminalCreated: vi.fn(),
}));

const layoutManager = {
  reopenClosedTab: vi.fn(),
  getPanel: vi.fn(),
  batchMutations: vi.fn(),
  createGridLayout: vi.fn(),
};
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => layoutManager,
}));
vi.mock('$features/layout/panel-keyboard-shortcuts.svelte', () => ({
  createPanelKeyboardShortcuts: () => ({
    handleKeyDown: () => false,
    executeAction: vi.fn(),
    cleanup: vi.fn(),
    leaderActive: false,
    showPanelNumbers: false,
    zoomedPanelId: null,
  }),
  registerPanelKeyboardShortcuts: vi.fn(),
  unregisterPanelKeyboardShortcuts: vi.fn(),
}));
vi.mock('$features/terminal/terminal-manager.svelte', () => ({
  terminalManager: { loadTerminalMetadata: () => [], saveTerminalMetadata: vi.fn() },
}));
vi.mock('$features/terminal/terminal-history-tracker', () => ({
  terminalHistoryTracker: {
    updateCounter: { subscribe: (listener: () => void) => (listener(), () => {}) },
    getHistory: vi.fn(),
  },
}));
vi.mock('$lib/utils/keyboardShortcuts', () => ({ isFocusInTerminal: () => false }));
vi.mock('$lib/utils/platform-capabilities', () => ({ hasCapability: () => false }));
vi.mock('$lib/utils/window-events', () => ({ dispatchWindowEvent: vi.fn() }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  listenSync: vi.fn(() => () => {}),
}));
vi.mock('$shared/generated/ipc-client', () => ({ invoke: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { terminals: { create: vi.fn() } } }));
vi.mock('../PanelContainer.svelte', async () => ({
  default: (await import('../../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../HandleDropOverlay.svelte', async () => ({
  default: (await import('../../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

import PanelLayout from '../PanelLayout.svelte';

describe('PanelLayout workspace-scoped layout lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mounts the component workspace instead of Redux active workspace', async () => {
    render(PanelLayout, { props: { workspaceId: 'ws-component-a' } });

    await waitFor(() =>
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'panelLayout/scopeMounted',
        payload: ['ws-component-a'],
      }),
    );
    expect(dispatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ payload: ['ws-redux-b'] }),
    );
  });

  it('only renders the handle drop overlay while the layout is active', async () => {
    const { container, rerender } = render(PanelLayout, {
      props: { workspaceId: 'ws-component-a', active: false },
    });
    const inactiveMockCount = container.querySelectorAll('[data-testid="mock-component"]').length;

    await rerender({ workspaceId: 'ws-component-a', active: true });

    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid="mock-component"]')).toHaveLength(
        inactiveMockCount + 1,
      ),
    );
  });
});
