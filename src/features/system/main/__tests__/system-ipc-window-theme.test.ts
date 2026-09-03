import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  getAllWindows: vi.fn(() => [] as Array<{ setBackgroundColor: ReturnType<typeof vi.fn> }>),
  nativeTheme: {
    themeSource: 'system',
    shouldUseDarkColors: false,
    on: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: { on: vi.fn(), getAppPath: vi.fn(), getVersion: vi.fn(), getName: vi.fn() },
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
  electronMocks.getAllWindows.mockReset().mockReturnValue([]);
  electronMocks.nativeTheme.themeSource = 'system';
  electronMocks.nativeTheme.shouldUseDarkColors = false;
  setupSystemIPC();
});

describe('WINDOW_CHANNELS.SET_THEME', () => {
  it.each([
    { theme: 'dark', isDark: true },
    { theme: 'light', isDark: false },
  ] as const)(
    'applies app $theme while the system uses the opposite appearance',
    async ({ theme, isDark }) => {
      const window = { setBackgroundColor: vi.fn() };
      electronMocks.fromWebContents.mockReturnValue(window);
      electronMocks.nativeTheme.shouldUseDarkColors = isDark;

      const result = await handlerFor(WINDOW_CHANNELS.SET_THEME)({ sender: {} }, { theme });

      expect(electronMocks.nativeTheme.themeSource).toBe(theme);
      expect(window.setBackgroundColor).toHaveBeenCalledWith(
        getWindowBackgroundColor(isDark, process.platform),
      );
      expect(result).toEqual({ success: true });
    },
  );

  it('uses the current system appearance in system mode', async () => {
    const window = { setBackgroundColor: vi.fn() };
    electronMocks.fromWebContents.mockReturnValue(window);
    electronMocks.nativeTheme.shouldUseDarkColors = true;

    const result = await handlerFor(WINDOW_CHANNELS.SET_THEME)({ sender: {} }, { theme: 'system' });

    expect(electronMocks.nativeTheme.themeSource).toBe('system');
    expect(window.setBackgroundColor).toHaveBeenCalledWith(
      getWindowBackgroundColor(true, process.platform),
    );
    expect(result).toEqual({ success: true });
  });

  it('refreshes every native window when the system appearance changes', () => {
    const windows = [{ setBackgroundColor: vi.fn() }, { setBackgroundColor: vi.fn() }];
    electronMocks.getAllWindows.mockReturnValue(windows);
    electronMocks.nativeTheme.shouldUseDarkColors = true;
    const listener = electronMocks.nativeTheme.on.mock.calls.find(
      ([event]) => event === 'updated',
    )?.[1];

    expect(listener).toBeTypeOf('function');
    listener();

    for (const window of windows) {
      expect(window.setBackgroundColor).toHaveBeenCalledWith(
        getWindowBackgroundColor(true, process.platform),
      );
    }
  });
});
