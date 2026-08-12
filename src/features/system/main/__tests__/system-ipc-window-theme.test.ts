import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false },
}));

vi.mock('electron', () => ({
  app: { on: vi.fn(), getAppPath: vi.fn(), getVersion: vi.fn(), getName: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
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

vi.mock('../../../../shared/main/async-utils', () => ({
  findAuggieAsync: vi.fn(),
  findVSCodeAsync: vi.fn(),
}));

import { setupSystemIPC } from '../system.ipc';
import { WINDOW_CHANNELS } from '../../../../shared/ipc/channels';
import { getWindowBackgroundColor } from '../../../../shared/main/window-appearance';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

beforeEach(() => {
  electronMocks.handle.mockReset();
  electronMocks.fromWebContents.mockReset();
  electronMocks.nativeTheme.themeSource = 'system';
  electronMocks.nativeTheme.shouldUseDarkColors = false;
  setupSystemIPC();
});

describe('WINDOW_CHANNELS.SET_THEME', () => {
  it('applies the requested source to Electron before refreshing the native window tint', async () => {
    const window = { setBackgroundColor: vi.fn() };
    electronMocks.fromWebContents.mockReturnValue(window);
    electronMocks.nativeTheme.shouldUseDarkColors = true;

    const result = await handlerFor(WINDOW_CHANNELS.SET_THEME)({ sender: {} }, { theme: 'dark' });

    expect(electronMocks.nativeTheme.themeSource).toBe('dark');
    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      getWindowBackgroundColor(true, process.platform),
    );
    expect(result).toEqual({ success: true });
  });
});
