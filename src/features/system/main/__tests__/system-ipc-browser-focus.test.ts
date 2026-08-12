import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  getFocusedWindow: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { on: vi.fn(), getAppPath: vi.fn(), getVersion: vi.fn(), getName: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
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

import { isFocusedWindowBrowserActive, setupSystemIPC } from '../system.ipc';
import { WINDOW_CHANNELS } from '../../../../shared/ipc/channels';

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
