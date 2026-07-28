import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to ensure mocks are available before module resolution
const { mockAppStore, mockState, mockIsElectron } = vi.hoisted(() => {
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
  };
});

vi.mock('$store/renderer/store', () => ({
  store: mockAppStore,
}));

vi.mock('$lib/electron-bridge', () => ({
  isElectron: mockIsElectron,
}));

// Import after mocking
import { createBrowserIpcMiddleware } from './browser-ipc-service';
import {
  openTab,
  openTabInAdjacentOrSplit,
  setActiveTab,
  updateTabBrowserUrl,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';

const BROWSER_TAB = {
  type: 'browser',
  title: 'Browser',
  browserUrl: 'https://example.com',
  closable: true,
};

describe('createBrowserIpcMiddleware', () => {
  let mockOn: ReturnType<typeof vi.fn>;
  let next: ReturnType<typeof vi.fn>;

  const setupMiddleware = () => {
    const middleware = createBrowserIpcMiddleware();
    middleware({} as any)(next);
    const handler = mockOn.mock.calls.find((c) => c[0] === 'browser:open-tab')?.[1];
    return { handler };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElectron.mockReturnValue(true);
    mockState.workspace.activeWorkspaceId = 'ws-1';
    mockState.panelLayout.byWorkspaceId = {};
    next = vi.fn((action) => action);
    mockOn = vi.fn(() => 'listener-id-123');
    (window as any).electronAPI = { on: mockOn };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('registers a listener for browser:open-tab on creation', () => {
    setupMiddleware();

    expect(mockOn).toHaveBeenCalledTimes(1);
    expect(mockOn).toHaveBeenCalledWith('browser:open-tab', expect.any(Function));
  });

  it('does not register a listener outside Electron', () => {
    mockIsElectron.mockReturnValue(false);
    setupMiddleware();

    expect(mockOn).not.toHaveBeenCalled();
  });

  it('opens a browser tab adjacent by default', () => {
    const { handler } = setupMiddleware();

    handler({ url: 'https://example.com' });

    expect(mockAppStore.dispatch).toHaveBeenCalledTimes(1);
    expect(mockAppStore.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: openTabInAdjacentOrSplit.type,
        payload: expect.objectContaining({ wsId: 'ws-1', tab: BROWSER_TAB }),
      }),
    );
  });

  it('opens a browser tab adjacent when position is "adjacent"', () => {
    const { handler } = setupMiddleware();

    handler({ url: 'https://example.com', position: 'adjacent' });

    expect(mockAppStore.dispatch).toHaveBeenCalledTimes(1);
    expect(mockAppStore.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: openTabInAdjacentOrSplit.type,
        payload: expect.objectContaining({ wsId: 'ws-1', tab: BROWSER_TAB }),
      }),
    );
  });

  it('opens a plain tab for position "same"', () => {
    const { handler } = setupMiddleware();

    handler({ url: 'https://example.com', position: 'same' });

    expect(mockAppStore.dispatch).toHaveBeenCalledTimes(1);
    expect(mockAppStore.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: openTab.type,
        payload: expect.objectContaining({ wsId: 'ws-1', tab: BROWSER_TAB }),
      }),
    );
  });

  it('prefers the payload workspaceId over the active workspace', () => {
    const { handler } = setupMiddleware();

    handler({ url: 'https://example.com', workspaceId: 'ws-2' });

    expect(mockAppStore.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: openTabInAdjacentOrSplit.type,
        payload: expect.objectContaining({ wsId: 'ws-2', tab: BROWSER_TAB }),
      }),
    );
  });

  it('no-ops without a payload workspaceId or active workspace', () => {
    mockState.workspace.activeWorkspaceId = null;
    const { handler } = setupMiddleware();

    handler({ url: 'https://example.com' });

    expect(mockAppStore.dispatch).not.toHaveBeenCalled();
  });

  describe('position "replace"', () => {
    it('updates and activates an existing browser tab', () => {
      mockState.panelLayout.byWorkspaceId = {
        'ws-1': {
          panels: {
            'panel-1': { tabs: [{ id: 'tab-note', type: 'note' }] },
            'panel-2': { tabs: [{ id: 'tab-browser', type: 'browser' }] },
          },
        },
      };
      const { handler } = setupMiddleware();

      handler({ url: 'https://example.com', position: 'replace' });

      expect(mockAppStore.dispatch).toHaveBeenCalledTimes(2);
      expect(mockAppStore.dispatch).toHaveBeenNthCalledWith(
        1,
        updateTabBrowserUrl('ws-1', 'tab-browser', 'https://example.com'),
      );
      expect(mockAppStore.dispatch).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: setActiveTab.type,
          payload: expect.objectContaining({ wsId: 'ws-1', tabId: 'tab-browser' }),
        }),
      );
    });

    it('opens a plain tab when no browser tab exists', () => {
      mockState.panelLayout.byWorkspaceId = {
        'ws-1': { panels: { 'panel-1': { tabs: [{ id: 'tab-note', type: 'note' }] } } },
      };
      const { handler } = setupMiddleware();

      handler({ url: 'https://example.com', position: 'replace' });

      expect(mockAppStore.dispatch).toHaveBeenCalledTimes(1);
      expect(mockAppStore.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: openTab.type,
          payload: expect.objectContaining({ wsId: 'ws-1', tab: BROWSER_TAB }),
        }),
      );
    });
  });

  it('passes through all actions', () => {
    const middleware = createBrowserIpcMiddleware();
    const chain = middleware({} as any)(next);

    const action = { type: 'test/action' };
    const result = chain(action);

    expect(result).toBe(action);
    expect(next).toHaveBeenCalledWith(action);
  });
});
