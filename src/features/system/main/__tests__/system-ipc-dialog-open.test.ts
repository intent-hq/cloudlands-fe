import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: any[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  appOn: vi.fn(),
  getFocusedWindow: vi.fn(),
  fromWebContents: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
    getAppPath: vi.fn(() => '/tmp/app'),
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'Intent'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromId: vi.fn(),
    getFocusedWindow: electronMocks.getFocusedWindow,
    fromWebContents: electronMocks.fromWebContents,
  },
  clipboard: { writeText: vi.fn() },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
    showMessageBox: vi.fn(),
  },
  ipcMain: { handle: electronMocks.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: { openExternal: vi.fn() },
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: vi.fn() }),
}));

vi.mock('../../../../shared/main/host-exec', () => ({ hostExec: vi.fn() }));
vi.mock('../../../../shared/main/host-exec-stream', () => ({ hostExecStream: vi.fn() }));

import { DIALOG_CHANNELS } from '../../../../shared/ipc/channels';
import { setupSystemIPC } from '../system.ipc';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

describe('dialog:open IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSystemIPC();
  });

  it('opens a directory-only native dialog and returns selected paths', async () => {
    const focusedWindow = { id: 1 };
    electronMocks.getFocusedWindow.mockReturnValue(focusedWindow);
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/project'],
    });

    const result = await handlerFor(DIALOG_CHANNELS.OPEN)(
      { sender: {} },
      {
        title: 'Choose a folder',
        defaultPath: '/tmp',
      },
    );

    expect(result).toEqual(['/tmp/project']);
    expect(electronMocks.showOpenDialog).toHaveBeenCalledExactlyOnceWith(focusedWindow, {
      title: 'Choose a folder',
      defaultPath: '/tmp',
      properties: ['openDirectory'],
    });
  });

  it('returns null when the dialog is cancelled', async () => {
    electronMocks.getFocusedWindow.mockReturnValue(undefined);
    electronMocks.fromWebContents.mockReturnValue(undefined);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(handlerFor(DIALOG_CHANNELS.OPEN)({ sender: {} }, {})).resolves.toBeNull();
    expect(electronMocks.showOpenDialog).toHaveBeenCalledExactlyOnceWith({
      title: undefined,
      defaultPath: undefined,
      properties: ['openDirectory'],
    });
  });
});
