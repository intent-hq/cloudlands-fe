/**
 * `window:close` closes the SENDER's window (the guest-offline overlay's
 * "Close window"), never whichever window is focused, and opens a local
 * window first when the sender is the app's last live window so the
 * window-all-closed / quit path is never entered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn((): unknown[] => []),
  nativeTheme: {
    themeSource: 'system',
    shouldUseDarkColors: false,
    on: vi.fn(),
  },
}));

const windowModuleMocks = vi.hoisted(() => ({
  openOrFocusWindowsForBackend: vi.fn(async (_backendId: string) => {}),
  openLocalFrameBeforeClosingLast: vi.fn(async () => {}),
}));

vi.mock('electron', () => ({
  app: { on: vi.fn(), getAppPath: vi.fn(), getVersion: vi.fn(), getName: vi.fn(), emit: vi.fn() },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
    fromId: vi.fn(),
    getFocusedWindow: electronMocks.getFocusedWindow,
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

vi.mock('../../../../main/window', () => ({
  openOrFocusWindowsForBackend: windowModuleMocks.openOrFocusWindowsForBackend,
  openLocalFrameBeforeClosingLast: windowModuleMocks.openLocalFrameBeforeClosingLast,
}));

// Every test window is a frame holding `machines`.
vi.mock('../../../../main/frames', () => ({
  isFrame: (window: { machines?: string[] }) => window.machines !== undefined,
  frameMachines: (window: { machines: string[] }) => [...window.machines],
  shownMachine: (window: { machines: string[] }) => window.machines[0],
  rendererFor: () => null,
}));

import { setupSystemIPC } from '../system.ipc';
import { WINDOW_CHANNELS } from '../../../../shared/ipc/channels';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

function makeWindow(opts: { machines?: string[]; destroyed?: boolean } = {}) {
  return {
    machines: opts.machines ?? ['local'],
    isDestroyed: () => opts.destroyed ?? false,
    close: vi.fn(),
    on: vi.fn(),
    webContents: { isDestroyed: () => false },
  };
}

async function closeFrom(sender: unknown) {
  electronMocks.fromWebContents.mockReturnValue(sender);
  return handlerFor(WINDOW_CHANNELS.CLOSE)({ sender: {} });
}

beforeEach(() => {
  electronMocks.handle.mockReset();
  electronMocks.fromWebContents.mockReset();
  electronMocks.getFocusedWindow.mockReset();
  electronMocks.getAllWindows.mockReset().mockReturnValue([]);
  windowModuleMocks.openOrFocusWindowsForBackend.mockClear();
  windowModuleMocks.openLocalFrameBeforeClosingLast.mockClear();
  setupSystemIPC();
});

describe('WINDOW_CHANNELS.CLOSE', () => {
  it('closes the sender window, not the focused one', async () => {
    const guest = makeWindow({ machines: ['guest-1'] });
    const focused = makeWindow();
    electronMocks.getFocusedWindow.mockReturnValue(focused);
    electronMocks.getAllWindows.mockReturnValue([guest, focused]);

    const result = await closeFrom(guest);

    expect(result).toEqual({ success: true });
    expect(guest.close).toHaveBeenCalledOnce();
    expect(focused.close).not.toHaveBeenCalled();
  });

  it('leaves the local-window guard alone while another live window survives', async () => {
    const guest = makeWindow({ machines: ['guest-1'] });
    const other = makeWindow({ machines: ['other'] });
    electronMocks.getAllWindows.mockReturnValue([guest, other]);

    await closeFrom(guest);

    expect(windowModuleMocks.openLocalFrameBeforeClosingLast).not.toHaveBeenCalled();
    expect(guest.close).toHaveBeenCalledOnce();
  });

  it('opens a local window before closing the last live window', async () => {
    const guest = makeWindow({ machines: ['guest-1'] });
    const dead = makeWindow({ machines: ['other'], destroyed: true });
    electronMocks.getAllWindows.mockReturnValue([guest, dead]);
    const order: string[] = [];
    windowModuleMocks.openLocalFrameBeforeClosingLast.mockImplementation(async () => {
      order.push('ensure-local');
    });
    guest.close.mockImplementation(() => order.push('close'));

    await closeFrom(guest);

    // Local opens in a frame of its own: joining the closing frame would close it too.
    expect(windowModuleMocks.openLocalFrameBeforeClosingLast).toHaveBeenCalledOnce();
    expect(windowModuleMocks.openOrFocusWindowsForBackend).not.toHaveBeenCalled();
    expect(order).toEqual(['ensure-local', 'close']);
  });

  it('opens no local window when the last frame closing holds the local machine', async () => {
    const frame = makeWindow({ machines: ['guest-1', 'local'] });
    electronMocks.getAllWindows.mockReturnValue([frame]);

    await closeFrom(frame);

    expect(windowModuleMocks.openLocalFrameBeforeClosingLast).not.toHaveBeenCalled();
    expect(frame.close).toHaveBeenCalledOnce();
  });

  it('is a no-op when the sender has no live window', async () => {
    electronMocks.getAllWindows.mockReturnValue([makeWindow()]);

    const result = await closeFrom(null);

    expect(result).toEqual({ success: true });
    expect(windowModuleMocks.openLocalFrameBeforeClosingLast).not.toHaveBeenCalled();
  });
});
