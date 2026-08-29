import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  isDockWindow: vi.fn(),
  setDockPointerRegionActive: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { on: vi.fn(), getAppPath: vi.fn(), getVersion: vi.fn(), getName: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromId: vi.fn(),
    getFocusedWindow: vi.fn(),
    fromWebContents: mocks.fromWebContents,
  },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: mocks.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: {},
}));

vi.mock('../../../../main/dock-window', () => ({
  isDockWindow: mocks.isDockWindow,
  setDockPointerRegionActive: mocks.setDockPointerRegionActive,
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));

import { WINDOW_CHANNELS } from '../../../../shared/ipc/channels';
import { setupSystemIPC } from '../system.ipc';

function handlerFor(channel: string): Handler {
  const call = mocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

describe('dock pointer-region IPC', () => {
  const window = { id: 24 };
  const event = { sender: {} };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fromWebContents.mockReturnValue(window);
    mocks.isDockWindow.mockReturnValue(true);
    mocks.setDockPointerRegionActive.mockReturnValue(true);
    setupSystemIPC();
  });

  it('validates and routes active pointer regions to the sender dock', async () => {
    const result = await handlerFor(WINDOW_CHANNELS.SET_DOCK_POINTER_REGION)(event, {
      active: true,
    });

    expect(mocks.setDockPointerRegionActive).toHaveBeenCalledWith(window, true);
    expect(result).toEqual({ success: true, supported: true });
  });

  it('rejects invalid pointer-region payloads', async () => {
    const result = await handlerFor(WINDOW_CHANNELS.SET_DOCK_POINTER_REGION)(event, {
      active: 'yes',
    });

    expect(mocks.setDockPointerRegionActive).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('does not route pointer state for a non-dock sender', async () => {
    mocks.isDockWindow.mockReturnValue(false);

    const result = await handlerFor(WINDOW_CHANNELS.SET_DOCK_POINTER_REGION)(event, {
      active: false,
    });

    expect(mocks.setDockPointerRegionActive).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, supported: false });
  });
});
