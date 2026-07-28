import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';

// Use vi.hoisted to ensure mocks are available before module resolution
const { mockAppStore, mockState, mockIsElectron, mockIsFocusInTerminal, mockDispatchWindowEvent } =
  vi.hoisted(() => {
    const mockState: {
      workspace: { activeWorkspaceId: string | null };
      panelLayout: { byWorkspaceId: Record<string, unknown> };
    } = {
      workspace: { activeWorkspaceId: 'ws-1' },
      panelLayout: { byWorkspaceId: {} },
    };
    return {
      mockState,
      mockAppStore: { state: mockState, dispatch: vi.fn() },
      mockIsElectron: vi.fn(() => true),
      mockIsFocusInTerminal: vi.fn(() => false),
      mockDispatchWindowEvent: vi.fn(),
    };
  });

vi.mock('$store/renderer/store', () => ({
  store: mockAppStore,
}));

vi.mock('$lib/electron-bridge', () => ({
  isElectron: mockIsElectron,
}));

vi.mock('$lib/utils/keyboardShortcuts', () => ({
  isFocusInTerminal: mockIsFocusInTerminal,
}));

vi.mock('$lib/utils/window-events', () => ({
  dispatchWindowEvent: mockDispatchWindowEvent,
}));

// Import after mocking
import { createMenuIpcMiddleware } from './menu-ipc-service';
import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { createAgentRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { createNoteRequested } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
import { createTerminalRequested } from '$store/renderer/slices/terminals/terminals-slice';
import {
  openTab,
  closeActiveTab,
  reopenClosedTab,
  selectPreviousTab,
  selectNextTab,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { browserTabZoomRequested } from '$store/renderer/slices/browser/browser-slice';

const ALL_CHANNELS = [
  'navigate',
  'menu:new-agent',
  'menu:new-note',
  'menu:new-terminal',
  'menu:new-browser',
  'menu:close-tab',
  'menu:reopen-closed-tab',
  'menu:select-previous-tab',
  'menu:select-next-tab',
  'menu:zoom-in',
  'menu:zoom-out',
  'menu:reset-zoom',
] as const;

describe('createMenuIpcMiddleware', () => {
  let mockOn: ReturnType<typeof vi.fn>;
  let next: ReturnType<typeof vi.fn>;

  const setupMiddleware = () => {
    const middleware = createMenuIpcMiddleware();
    middleware({} as any)(next);
    const handlerFor = (channel: string) =>
      mockOn.mock.calls.find((c) => c[0] === channel)?.[1];
    return { handlerFor };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElectron.mockReturnValue(true);
    mockIsFocusInTerminal.mockReturnValue(false);
    mockState.workspace.activeWorkspaceId = 'ws-1';
    mockState.panelLayout.byWorkspaceId = {};
    next = vi.fn((action) => action);
    mockOn = vi.fn(() => 'listener-id-123');
    (window as any).electronAPI = { on: mockOn };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('registers a listener for every menu channel on creation', () => {
    setupMiddleware();

    for (const channel of ALL_CHANNELS) {
      expect(mockOn).toHaveBeenCalledWith(channel, expect.any(Function));
    }
    expect(mockOn).toHaveBeenCalledTimes(ALL_CHANNELS.length);
  });

  it('does not register listeners outside Electron', () => {
    mockIsElectron.mockReturnValue(false);
    setupMiddleware();

    expect(mockOn).not.toHaveBeenCalled();
  });

  describe('navigate', () => {
    it('opens the create-workspace modal for /?create=true', async () => {
      const { handlerFor } = setupMiddleware();

      await handlerFor('navigate')('/?create=true');

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(setShowCreateModal(true));
      expect(goto).not.toHaveBeenCalled();
    });

    it('opens the create-workspace modal for /workspace/new', async () => {
      const { handlerFor } = setupMiddleware();

      await handlerFor('navigate')('/workspace/new');

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(setShowCreateModal(true));
      expect(goto).not.toHaveBeenCalled();
    });

    it('navigates to any other path via goto', async () => {
      const { handlerFor } = setupMiddleware();

      await handlerFor('navigate')('/settings');

      expect(goto).toHaveBeenCalledWith('/settings');
      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
    });

    it('ignores missing or non-string payloads', async () => {
      const { handlerFor } = setupMiddleware();

      await handlerFor('navigate')(undefined);
      await handlerFor('navigate')(null);
      await handlerFor('navigate')('');

      expect(goto).not.toHaveBeenCalled();
      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
    });

    it('swallows navigation failures', async () => {
      vi.mocked(goto).mockRejectedValueOnce(new Error('nav failed'));
      const { handlerFor } = setupMiddleware();

      await expect(handlerFor('navigate')('/settings')).resolves.toBeUndefined();
    });
  });

  describe('menu:new-agent', () => {
    it('dispatches createAgentRequested for the active workspace', () => {
      const { handlerFor } = setupMiddleware();

      handlerFor('menu:new-agent')();

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(createAgentRequested('ws-1'));
    });

    it('dispatches a workspace:new-terminal window event when focus is in a terminal', () => {
      mockIsFocusInTerminal.mockReturnValue(true);
      const { handlerFor } = setupMiddleware();

      handlerFor('menu:new-agent')();

      expect(mockDispatchWindowEvent).toHaveBeenCalledWith('workspace:new-terminal', {
        workspaceId: 'ws-1',
      });
      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
    });

    it('no-ops without an active workspace', () => {
      mockState.workspace.activeWorkspaceId = null;
      const { handlerFor } = setupMiddleware();

      handlerFor('menu:new-agent')();

      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
      expect(mockDispatchWindowEvent).not.toHaveBeenCalled();
    });
  });

  describe('workspace-scoped menu actions', () => {
    it('menu:new-note dispatches createNoteRequested', () => {
      const { handlerFor } = setupMiddleware();

      handlerFor('menu:new-note')();

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(createNoteRequested('ws-1'));
    });

    it('menu:new-terminal dispatches createTerminalRequested', () => {
      const { handlerFor } = setupMiddleware();

      handlerFor('menu:new-terminal')();

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(createTerminalRequested('ws-1'));
    });

    it('menu:new-browser dispatches openTab with a browser tab', () => {
      const { handlerFor } = setupMiddleware();

      handlerFor('menu:new-browser')();

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: openTab.type,
          payload: expect.objectContaining({
            wsId: 'ws-1',
            tab: {
              type: 'browser',
              title: 'Browser',
              browserUrl: 'https://google.com',
              closable: true,
            },
          }),
        }),
      );
    });

    it.each([
      ['menu:close-tab', closeActiveTab.type],
      ['menu:reopen-closed-tab', reopenClosedTab.type],
      ['menu:select-previous-tab', selectPreviousTab.type],
      ['menu:select-next-tab', selectNextTab.type],
    ])('%s dispatches %s for the active workspace', (channel, actionType) => {
      const { handlerFor } = setupMiddleware();

      handlerFor(channel)();

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: actionType,
          payload: expect.objectContaining({ wsId: 'ws-1' }),
        }),
      );
    });

    it.each([
      'menu:new-note',
      'menu:new-terminal',
      'menu:new-browser',
      'menu:close-tab',
      'menu:reopen-closed-tab',
      'menu:select-previous-tab',
      'menu:select-next-tab',
    ])('%s no-ops without an active workspace', (channel) => {
      mockState.workspace.activeWorkspaceId = null;
      const { handlerFor } = setupMiddleware();

      handlerFor(channel)();

      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('menu zoom channels', () => {
    const browserLayout = {
      focusedPanelId: 'panel-1',
      panels: {
        'panel-1': {
          activeTabId: 'tab-1',
          tabs: [{ id: 'tab-1', type: 'browser' }],
        },
      },
    };

    it.each([
      ['menu:zoom-in', 'in'],
      ['menu:zoom-out', 'out'],
      ['menu:reset-zoom', 'reset'],
    ])('%s dispatches browserTabZoomRequested(%s) for a focused browser tab', (channel, zoom) => {
      mockState.panelLayout.byWorkspaceId = { 'ws-1': browserLayout };
      const { handlerFor } = setupMiddleware();

      handlerFor(channel)();

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(
        browserTabZoomRequested('ws-1', 'tab-1', zoom as 'in' | 'out' | 'reset'),
      );
    });

    it('no-ops when the focused panel active tab is not a browser tab', () => {
      mockState.panelLayout.byWorkspaceId = {
        'ws-1': {
          focusedPanelId: 'panel-1',
          panels: {
            'panel-1': { activeTabId: 'tab-1', tabs: [{ id: 'tab-1', type: 'note' }] },
          },
        },
      };
      const { handlerFor } = setupMiddleware();

      handlerFor('menu:zoom-in')();

      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
    });

    it('no-ops when there is no panel layout for the workspace', () => {
      const { handlerFor } = setupMiddleware();

      handlerFor('menu:zoom-in')();

      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
    });

    it('no-ops without an active workspace', () => {
      mockState.workspace.activeWorkspaceId = null;
      mockState.panelLayout.byWorkspaceId = { 'ws-1': browserLayout };
      const { handlerFor } = setupMiddleware();

      handlerFor('menu:zoom-in')();

      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
    });
  });

  it('passes through all actions', () => {
    const middleware = createMenuIpcMiddleware();
    const chain = middleware({} as any)(next);

    const action = { type: 'test/action' };
    const result = chain(action);

    expect(result).toBe(action);
    expect(next).toHaveBeenCalledWith(action);
  });
});
