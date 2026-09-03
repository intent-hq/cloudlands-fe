import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  getAllWindows: vi.fn((): unknown[] => []),
  nativeTheme: {
    themeSource: 'system',
    shouldUseDarkColors: false,
    on: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: { on: vi.fn(), getAppPath: vi.fn(), getVersion: vi.fn(), getName: vi.fn(), emit: vi.fn() },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
    fromId: vi.fn(),
    getFocusedWindow: vi.fn(),
    fromWebContents: electronMocks.fromWebContents,
  },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: electronMocks.handle, removeHandler: vi.fn() },
  nativeTheme: electronMocks.nativeTheme,
  shell: {},
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: vi.fn() }),
  getBackendIdForIpcSender: vi.fn(() => 'local'),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('../../../../shared/main/async-utils', () => ({
  findAuggieAsync: vi.fn(),
  findVSCodeAsync: vi.fn(),
}));

import type { BrowserWindow } from 'electron';
import { setupSystemIPC } from '../system.ipc';
import { WINDOW_CHANNELS } from '../../../../shared/ipc/channels';
import { registerHudWindow, _resetHudWindowRefForTests } from '../../../../main/hud-window';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

function makeWindow(
  opts: { url?: string; destroyed?: boolean; visible?: boolean; minimized?: boolean } = {},
) {
  return {
    isDestroyed: () => opts.destroyed ?? false,
    isVisible: () => opts.visible ?? true,
    isMinimized: () => opts.minimized ?? false,
    restore: vi.fn(),
    focus: vi.fn(),
    on: vi.fn(),
    webContents: {
      isDestroyed: () => false,
      getURL: () => opts.url ?? 'http://localhost:5173/',
    },
  };
}

async function cycleFrom(sender: unknown) {
  electronMocks.fromWebContents.mockReturnValue(sender);
  return handlerFor(WINDOW_CHANNELS.CYCLE_FOCUS)({ sender: {} });
}

beforeEach(() => {
  electronMocks.handle.mockReset();
  electronMocks.fromWebContents.mockReset();
  electronMocks.getAllWindows.mockReset().mockReturnValue([]);
  _resetHudWindowRefForTests();
  setupSystemIPC();
});

describe('WINDOW_CHANNELS.CYCLE_FOCUS', () => {
  it('focuses the next window in list order', async () => {
    const [w1, w2, w3] = [makeWindow(), makeWindow(), makeWindow()];
    electronMocks.getAllWindows.mockReturnValue([w1, w2, w3]);

    const result = await cycleFrom(w2);

    expect(result).toEqual({ cycled: true, windowCount: 3 });
    expect(w3.focus).toHaveBeenCalled();
    expect(w1.focus).not.toHaveBeenCalled();
    expect(w2.focus).not.toHaveBeenCalled();
  });

  it('wraps around from the last window to the first', async () => {
    const [w1, w2, w3] = [makeWindow(), makeWindow(), makeWindow()];
    electronMocks.getAllWindows.mockReturnValue([w1, w2, w3]);

    const result = await cycleFrom(w3);

    expect(result).toEqual({ cycled: true, windowCount: 3 });
    expect(w1.focus).toHaveBeenCalled();
  });

  it('returns a no-op result with a single window and focuses nothing', async () => {
    const w1 = makeWindow();
    electronMocks.getAllWindows.mockReturnValue([w1]);

    const result = await cycleFrom(w1);

    expect(result).toEqual({ cycled: false, windowCount: 1 });
    expect(w1.focus).not.toHaveBeenCalled();
  });

  it('skips destroyed windows', async () => {
    const [w1, dead, w2] = [makeWindow(), makeWindow({ destroyed: true }), makeWindow()];
    electronMocks.getAllWindows.mockReturnValue([w1, dead, w2]);

    const result = await cycleFrom(w1);

    expect(result).toEqual({ cycled: true, windowCount: 2 });
    expect(w2.focus).toHaveBeenCalled();
    expect(dead.focus).not.toHaveBeenCalled();
  });

  it('skips HUD pop-out windows', async () => {
    const [w1, hud, w2] = [
      makeWindow(),
      makeWindow({ url: 'http://localhost:5173/hud' }),
      makeWindow(),
    ];
    electronMocks.getAllWindows.mockReturnValue([w1, hud, w2]);

    const result = await cycleFrom(w1);

    expect(result).toEqual({ cycled: true, windowCount: 2 });
    expect(w2.focus).toHaveBeenCalled();
    expect(hud.focus).not.toHaveBeenCalled();
  });

  it('skips a tracked HUD window still on about:blank', async () => {
    const [w1, hud, w2] = [makeWindow(), makeWindow({ url: 'about:blank' }), makeWindow()];
    registerHudWindow(hud as unknown as BrowserWindow);
    electronMocks.getAllWindows.mockReturnValue([w1, hud, w2]);

    const result = await cycleFrom(w1);

    expect(result).toEqual({ cycled: true, windowCount: 2 });
    expect(w2.focus).toHaveBeenCalled();
    expect(hud.focus).not.toHaveBeenCalled();
  });

  it('skips hidden windows', async () => {
    const [w1, hidden, w2] = [makeWindow(), makeWindow({ visible: false }), makeWindow()];
    electronMocks.getAllWindows.mockReturnValue([w1, hidden, w2]);

    const result = await cycleFrom(w1);

    expect(result).toEqual({ cycled: true, windowCount: 2 });
    expect(w2.focus).toHaveBeenCalled();
    expect(hidden.focus).not.toHaveBeenCalled();
  });

  it('focuses the first cycleable window when the sender is not in the cycle', async () => {
    const [w1, w2] = [makeWindow(), makeWindow()];
    electronMocks.getAllWindows.mockReturnValue([w1, w2]);

    const result = await cycleFrom(makeWindow({ url: 'http://localhost:5173/hud' }));

    expect(result).toEqual({ cycled: true, windowCount: 2 });
    expect(w1.focus).toHaveBeenCalled();
  });

  it('restores a minimized window before focusing it', async () => {
    const [w1, w2] = [makeWindow(), makeWindow({ minimized: true })];
    electronMocks.getAllWindows.mockReturnValue([w1, w2]);

    const result = await cycleFrom(w1);

    expect(result).toEqual({ cycled: true, windowCount: 2 });
    expect(w2.restore).toHaveBeenCalled();
    expect(w2.focus).toHaveBeenCalled();
  });

  it('includes a minimized window that reports not visible (macOS) and restores it', async () => {
    const [w1, w2] = [makeWindow(), makeWindow({ minimized: true, visible: false })];
    electronMocks.getAllWindows.mockReturnValue([w1, w2]);

    const result = await cycleFrom(w1);

    expect(result).toEqual({ cycled: true, windowCount: 2 });
    expect(w2.restore).toHaveBeenCalled();
    expect(w2.focus).toHaveBeenCalled();
  });
});
