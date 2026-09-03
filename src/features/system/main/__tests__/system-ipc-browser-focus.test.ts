import { runSaga } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockInvoke,
  registerMockIpcHandler,
  resetMockIpcRouter,
} from '../../../../shared/ipc-mock-router';

type Handler = (...args: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn(() => []),
}));

vi.mock('electron', () => ({
  app: { on: vi.fn(), getAppPath: vi.fn(), getVersion: vi.fn(), getName: vi.fn() },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
    fromId: vi.fn(),
    getFocusedWindow: electronMocks.getFocusedWindow,
    fromWebContents: electronMocks.fromWebContents,
  },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: electronMocks.handle, removeHandler: vi.fn() },
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false },
  shell: {},
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));
vi.mock('../../../../shared/main/async-utils', () => ({
  findAuggieAsync: vi.fn(),
  findVSCodeAsync: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({ isElectron: () => true }));

import { isFocusedWindowBrowserActive, setupSystemIPC } from '../system.ipc';
import { WINDOW_CHANNELS } from '../../../../shared/ipc/channels';
import { handleMenuZoom } from '../../../../main/menu-zoom';
import { sendWorkspaceCommand } from '../../../../main/menu-workspace-command';
import { zoomIpcSaga } from '../../../../store/renderer/slices/user-preferences/sagas/zoom-ipc-saga';
import {
  initialState,
  userPreferencesReducer,
} from '../../../../store/renderer/slices/user-preferences/user-preferences-slice';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

describe('WINDOW_CHANNELS.SET_BROWSER_FOCUSED ownership', () => {
  const window = { id: 914 };
  const event = { sender: {} };

  beforeEach(() => {
    electronMocks.handle.mockReset();
    electronMocks.fromWebContents.mockReturnValue(window);
    electronMocks.getFocusedWindow.mockReturnValue(window);
    setupSystemIPC();
  });

  it('ignores teardown from an owner replaced by a newer panel', async () => {
    const handle = handlerFor(WINDOW_CHANNELS.SET_BROWSER_FOCUSED);
    await handle(event, { browserFocused: true, focusOwnerId: 'old-panel' });
    await handle(event, { browserFocused: true, focusOwnerId: 'new-panel' });

    const result = await handle(event, { browserFocused: false, focusOwnerId: 'old-panel' });

    expect(result).toEqual({ success: true });
    expect(isFocusedWindowBrowserActive()).toBe(true);
  });

  it('clears zoom routing when the current owner tears down', async () => {
    const handle = handlerFor(WINDOW_CHANNELS.SET_BROWSER_FOCUSED);
    await handle(event, { browserFocused: true, focusOwnerId: 'current-panel' });

    await handle(event, { browserFocused: false, focusOwnerId: 'current-panel' });

    expect(isFocusedWindowBrowserActive()).toBe(false);
  });
});

describe('app menu zoom IPC', () => {
  // Electron documents scale = 1.2 ^ level and same-origin zoom sharing.
  function createZoomWindow(id: number, zoom = { level: 0 }) {
    return {
      id,
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        getZoomLevel: () => zoom.level,
        getZoomFactor: () => 1.2 ** zoom.level,
        setZoomLevel: vi.fn((level: number) => {
          zoom.level = level;
        }),
        send: vi.fn(),
      },
    };
  }

  beforeEach(() => {
    electronMocks.handle.mockReset();
    electronMocks.getAllWindows.mockReturnValue([]);
    setupSystemIPC();
  });

  it('delivers menu out/in/reset to renderer state, then hydrates a reload through the real query handler', async () => {
    const appWindow = createZoomWindow(915);
    electronMocks.getFocusedWindow.mockReturnValue(appWindow);
    electronMocks.fromWebContents.mockReturnValue(appWindow);
    electronMocks.getAllWindows.mockReturnValue([appWindow] as never);
    await handlerFor(WINDOW_CHANNELS.SET_BROWSER_FOCUSED)(
      { sender: appWindow.webContents },
      { browserFocused: false, focusOwnerId: 'zoom-test' },
    );
    let listener: (payload: unknown) => void = () => {};
    const originalApi = window.electronAPI;
    resetMockIpcRouter();
    const query = vi.fn((params: unknown) =>
      handlerFor(WINDOW_CHANNELS.GET_ZOOM_FACTOR)({ sender: appWindow.webContents }, params),
    );
    registerMockIpcHandler(WINDOW_CHANNELS.GET_ZOOM_FACTOR, query);
    const invoke = vi.fn(mockInvoke);
    window.electronAPI = {
      ...originalApi,
      invoke,
      on: vi.fn((_channel, handler) => {
        listener = handler;
        return 'zoom-listener';
      }),
      offById: vi.fn(),
    };
    appWindow.webContents.send.mockImplementation((channel, payload) => {
      expect(channel).toBe('window:zoom-changed');
      listener(payload);
    });
    let state = initialState;
    const dispatch = (action: Parameters<typeof userPreferencesReducer>[1]) => {
      state = userPreferencesReducer(state, action);
    };
    let task = runSaga({ dispatch }, zoomIpcSaga);
    const routeBrowserZoom = vi.fn();
    try {
      await vi.waitFor(() => expect(query).toHaveResolvedWith({ success: true, data: 1 }));
      for (const [command, factor] of [
        ['menu:zoom-out', 0.9128709291752769],
        ['menu:zoom-in', 1],
        ['menu:zoom-in', 1.0954451150103321],
        ['menu:reset-zoom', 1],
      ] as const) {
        handleMenuZoom(command, routeBrowserZoom);
        expect(appWindow.webContents.send).toHaveBeenLastCalledWith('window:zoom-changed', {
          zoomFactor: factor,
        });
        expect(state.zoomFactor).toBe(factor);
      }
      expect(appWindow.webContents.setZoomLevel.mock.calls).toEqual([[-0.5], [0], [0.5], [0]]);
      expect(routeBrowserZoom).not.toHaveBeenCalled();

      handleMenuZoom('menu:zoom-out', routeBrowserZoom);
      task.cancel();
      await task.toPromise();
      state = initialState;
      task = runSaga({ dispatch }, zoomIpcSaga);
      await vi.waitFor(() => expect(state.zoomFactor).toBe(0.9128709291752769));
      expect(invoke.mock.calls).toEqual([
        ['window:get-zoom-factor', undefined],
        ['window:get-zoom-factor', undefined],
      ]);
      expect(query).toHaveBeenLastCalledWith(undefined);
      expect(query).toHaveLastResolvedWith({ success: true, data: 0.9128709291752769 });
    } finally {
      task.cancel();
      await task.toPromise();
      window.electronAPI = originalApi;
      resetMockIpcRouter();
    }
  });

  it('publishes the actual factor of same-origin peers without imposing it on unrelated windows', async () => {
    const sharedZoom = { level: 0 };
    const focused = createZoomWindow(916, sharedZoom);
    const peer = createZoomWindow(917, sharedZoom);
    const other = createZoomWindow(918);
    const destroyed = createZoomWindow(919);
    destroyed.webContents.isDestroyed.mockReturnValue(true);
    electronMocks.getFocusedWindow.mockReturnValue(focused);
    electronMocks.getAllWindows.mockReturnValue([focused, peer, other, destroyed] as never);

    handleMenuZoom('menu:zoom-out', vi.fn());

    expect(peer.webContents.send).toHaveBeenCalledExactlyOnceWith('window:zoom-changed', {
      zoomFactor: 0.9128709291752769,
    });
    expect(other.webContents.send).toHaveBeenCalledExactlyOnceWith('window:zoom-changed', {
      zoomFactor: 1,
    });
    expect(peer.webContents.setZoomLevel).not.toHaveBeenCalled();
    expect(other.webContents.setZoomLevel).not.toHaveBeenCalled();
    expect(destroyed.webContents.send).not.toHaveBeenCalled();
  });

  it('routes every browser-focused zoom command with its workspace payload and leaves app zoom alone', async () => {
    const appWindow = createZoomWindow(920);
    electronMocks.getFocusedWindow.mockReturnValue(appWindow);
    electronMocks.fromWebContents.mockReturnValue(appWindow);
    electronMocks.getAllWindows.mockReturnValue([appWindow] as never);
    await handlerFor(WINDOW_CHANNELS.SET_BROWSER_FOCUSED)(
      { sender: appWindow.webContents },
      { browserFocused: true, focusOwnerId: 'browser-panel' },
    );
    for (const command of ['menu:zoom-out', 'menu:zoom-in', 'menu:reset-zoom'] as const) {
      handleMenuZoom(command, (channel) => {
        sendWorkspaceCommand(appWindow, channel, 'ws-zoom');
      });
    }
    expect(appWindow.webContents.send.mock.calls).toEqual([
      ['menu:zoom-out', { workspaceId: 'ws-zoom' }],
      ['menu:zoom-in', { workspaceId: 'ws-zoom' }],
      ['menu:reset-zoom', { workspaceId: 'ws-zoom' }],
    ]);
    expect(appWindow.webContents.setZoomLevel).not.toHaveBeenCalled();
  });
});
