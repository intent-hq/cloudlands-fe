import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  showSaveDialog: vi.fn(),
  stat: vi.fn(),
  copyFile: vi.fn(),
  createZipFromPaths: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mocks.handlers.set(channel, handler);
    }),
  },
  dialog: {
    showSaveDialog: mocks.showSaveDialog,
  },
}));

vi.mock('fs', () => ({
  default: {
    promises: {
      stat: mocks.stat,
      copyFile: mocks.copyFile,
    },
  },
  promises: {
    stat: mocks.stat,
    copyFile: mocks.copyFile,
  },
}));

vi.mock('../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(),
}));

vi.mock('../../../../shared/main/file-sync-utils', () => ({
  renameWithRetry: vi.fn(),
}));

vi.mock('../../../debug-export/main/zip-utils', () => ({
  createZipFromPaths: mocks.createZipFromPaths,
}));

import { IPC_CHANNELS } from '../../../../shared/ipc-registry';
import { setupFileIPC } from '../file.ipc';

function getDownloadHandler(): Function {
  setupFileIPC();
  const handler = mocks.handlers.get(IPC_CHANNELS.FILE.DOWNLOAD);
  expect(handler).toBeDefined();
  return handler as Function;
}

describe('file:download IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.copyFile.mockResolvedValue(undefined);
    mocks.createZipFromPaths.mockResolvedValue(undefined);
  });

  it('copies a regular file to the chosen location', async () => {
    mocks.stat.mockResolvedValue({ isDirectory: () => false });
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/report.txt', canceled: false });

    const result = await getDownloadHandler()({}, { path: '/src/docs/report.txt' });

    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'report.txt' }),
    );
    expect(mocks.copyFile).toHaveBeenCalledWith('/src/docs/report.txt', '/dest/report.txt');
    expect(result).toEqual({ success: true, data: { filePath: '/dest/report.txt' } });
  });

  it('zips a directory with entries prefixed by the folder name', async () => {
    mocks.stat.mockResolvedValue({ isDirectory: () => true });
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/myfolder.zip', canceled: false });

    const result = await getDownloadHandler()({}, { path: '/src/myfolder' });

    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: 'myfolder.zip',
        filters: [expect.objectContaining({ extensions: ['zip'] })],
      }),
    );
    expect(mocks.createZipFromPaths).toHaveBeenCalledWith(
      '/src/myfolder',
      '/dest/myfolder.zip',
      'myfolder',
    );
    expect(result).toEqual({ success: true, data: { filePath: '/dest/myfolder.zip' } });
  });

  it('returns canceled when the save dialog is dismissed', async () => {
    mocks.stat.mockResolvedValue({ isDirectory: () => false });
    mocks.showSaveDialog.mockResolvedValue({ filePath: undefined, canceled: true });

    const result = await getDownloadHandler()({}, { path: '/src/docs/report.txt' });

    expect(result).toEqual({ success: false, canceled: true });
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });

  it('returns a NOT_FOUND error for a nonexistent path', async () => {
    mocks.stat.mockRejectedValue(new Error('ENOENT'));

    const result = await getDownloadHandler()({}, { path: '/src/missing.txt' });

    expect(result).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: expect.stringContaining('/src/missing.txt'),
      },
    });
    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
  });

  it('returns a localized DOWNLOAD_FAILED error when the copy fails', async () => {
    mocks.stat.mockResolvedValue({ isDirectory: () => false });
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/report.txt', canceled: false });
    mocks.copyFile.mockRejectedValue(new Error('disk full'));

    const result = await getDownloadHandler()({}, { path: '/src/docs/report.txt' });

    expect(result).toEqual({
      success: false,
      error: {
        code: 'DOWNLOAD_FAILED',
        message: expect.stringContaining('/src/docs/report.txt'),
      },
    });
    // The raw error message is logged in the main process, not surfaced.
    expect(result.error.message).not.toContain('disk full');
  });
});
