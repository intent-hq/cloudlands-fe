import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: any[]) => unknown;

const electronMocks = vi.hoisted(() => {
  const constructed: any[] = [];
  class MockBrowserWindow {
    static getAllWindows = vi.fn((): unknown[] => []);
    static fromId = vi.fn();
    static getFocusedWindow = vi.fn(() => undefined);
    static fromWebContents = vi.fn(() => undefined);

    id: number;
    destroyed = false;
    minimized = false;
    loadedUrl: string | null = null;
    restore = vi.fn(() => {
      this.minimized = false;
    });
    focus = vi.fn();
    show = vi.fn();
    once = vi.fn();
    closedHandlers: Array<() => void> = [];
    on = vi.fn((event: string, cb: () => void) => {
      if (event === 'closed') this.closedHandlers.push(cb);
    });
    loadURL = vi.fn(async (url: string) => {
      this.loadedUrl = url;
    });
    isDestroyed = () => this.destroyed;
    isMinimized = () => this.minimized;
    webContents = {
      isDestroyed: () => false,
      getURL: () => this.loadedUrl ?? '',
      on: vi.fn(),
      send: vi.fn(),
    };

    constructor(_options: unknown) {
      this.id = constructed.length + 1;
      constructed.push(this);
    }

    _close() {
      this.destroyed = true;
      this.closedHandlers.forEach((cb) => cb());
    }
  }
  return { MockBrowserWindow, constructed, handle: vi.fn(), appOn: vi.fn() };
});

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
    getAppPath: vi.fn(() => '/tmp/app'),
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'Intent'),
  },
  BrowserWindow: electronMocks.MockBrowserWindow,
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: electronMocks.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: {},
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: vi.fn() }),
}));

vi.mock('../../../../shared/main/host-exec', () => ({ hostExec: vi.fn() }));
vi.mock('../../../../shared/main/host-exec-stream', () => ({ hostExecStream: vi.fn() }));
vi.mock('../../../../main/window', () => ({ forwardRendererConsoleToMainLog: vi.fn() }));

import { WINDOW_CHANNELS } from '../../../../shared/ipc/channels';
import { _resetHudWindowRefForTests } from '../../../../main/hud-window';
import { setupSystemIPC } from '../system.ipc';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

describe('HUD window singleton via WINDOW.OPEN_NEW', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.constructed.length = 0;
    electronMocks.MockBrowserWindow.getAllWindows.mockReturnValue([]);
    _resetHudWindowRefForTests();
    setupSystemIPC();
  });

  it('opening /hud twice reuses the first window and focuses it', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    const first = (await openNew({ sender: {} }, { route: '/hud' })) as {
      success: boolean;
      windowId: number;
    };
    expect(first.success).toBe(true);
    expect(electronMocks.constructed).toHaveLength(1);

    const second = (await openNew({ sender: {} }, { route: '/hud' })) as {
      success: boolean;
      windowId: number;
    };
    expect(second).toEqual({ success: true, windowId: first.windowId });
    expect(electronMocks.constructed).toHaveLength(1);
    expect(electronMocks.constructed[0].focus).toHaveBeenCalled();
    expect(electronMocks.constructed[0].show).toHaveBeenCalled();
  });

  it('a minimized HUD window is restored before focusing', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    await openNew({ sender: {} }, { route: '/hud' });
    const hud = electronMocks.constructed[0];
    hud.minimized = true;

    await openNew({ sender: {} }, { route: '/hud' });
    expect(hud.restore).toHaveBeenCalledTimes(1);
    expect(hud.focus).toHaveBeenCalled();
    expect(electronMocks.constructed).toHaveLength(1);
  });

  it('a destroyed HUD reference leads to a fresh window', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    await openNew({ sender: {} }, { route: '/hud' });
    electronMocks.constructed[0]._close();

    const result = (await openNew({ sender: {} }, { route: '/hud' })) as { windowId: number };
    expect(electronMocks.constructed).toHaveLength(2);
    expect(result.windowId).toBe(electronMocks.constructed[1].id);
  });

  it('non-HUD routes always create a new window', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    await openNew({ sender: {} }, { route: '/workspace/ws-1' });
    await openNew({ sender: {} }, { route: '/workspace/ws-2' });
    expect(electronMocks.constructed).toHaveLength(2);
  });

  it('WINDOW.CREATE funnels through the same singleton as OPEN_NEW', async () => {
    await handlerFor(WINDOW_CHANNELS.OPEN_NEW)({ sender: {} }, { route: '/hud' });
    const viaCreate = (await handlerFor(WINDOW_CHANNELS.CREATE)(
      { sender: {} },
      { route: '/hud' },
    )) as { success: boolean; windowId: number };
    expect(viaCreate).toEqual({ success: true, windowId: electronMocks.constructed[0].id });
    expect(electronMocks.constructed).toHaveLength(1);
  });
});
