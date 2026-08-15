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
  open: vi.fn(),
  createZipFromPaths: vi.fn(),
  backendRequest: vi.fn(),
  getConfig: vi.fn(),
  shouldUseTransferConnection: vi.fn(),
  withTransferConnection: vi.fn(),
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
      open: mocks.open,
    },
  },
  promises: {
    stat: mocks.stat,
    copyFile: mocks.copyFile,
    open: mocks.open,
  },
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({
    request: mocks.backendRequest,
    getConfig: mocks.getConfig,
  }),
}));

vi.mock('../../../backend/main/transfer-connections', () => ({
  shouldUseTransferConnection: mocks.shouldUseTransferConnection,
  withTransferConnection: mocks.withTransferConnection,
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

function getDownloadAttachmentHandler(): Function {
  setupFileIPC();
  const handler = mocks.handlers.get(IPC_CHANNELS.FILE.DOWNLOAD_ATTACHMENT);
  expect(handler).toBeDefined();
  return handler as Function;
}

describe('file:download-attachment IPC handler', () => {
  const request = { workspaceId: 'ws-1', path: '.intent/attachments/photo.png', fileName: 'photo.png' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.copyFile.mockResolvedValue(undefined);
    mocks.getConfig.mockReturnValue({ transport: 'uds', socketPath: '/tmp/i.sock' });
    mocks.shouldUseTransferConnection.mockReturnValue(false);
  });

  it('local backend: copies from the workspace root resolved via workspace.get', async () => {
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/photo.png', canceled: false });
    mocks.backendRequest.mockResolvedValue({ workspace: { path: '/home/u/proj' } });

    const result = await getDownloadAttachmentHandler()({}, request);

    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'photo.png' }),
    );
    expect(mocks.backendRequest).toHaveBeenCalledWith('workspace.get', { workspaceId: 'ws-1' });
    expect(mocks.copyFile).toHaveBeenCalledWith(
      '/home/u/proj/.intent/attachments/photo.png',
      '/dest/photo.png',
    );
    expect(result).toEqual({ success: true, data: { filePath: '/dest/photo.png' } });
    expect(mocks.withTransferConnection).not.toHaveBeenCalled();
  });

  it('local backend: prefers the worktree path over the workspace path', async () => {
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/photo.png', canceled: false });
    mocks.backendRequest.mockResolvedValue({
      workspace: { path: '/home/u/proj', worktreePath: '/home/u/worktrees/ws-1' },
    });

    await getDownloadAttachmentHandler()({}, request);

    expect(mocks.copyFile).toHaveBeenCalledWith(
      '/home/u/worktrees/ws-1/.intent/attachments/photo.png',
      '/dest/photo.png',
    );
  });

  it('remote backend: loops file.readChunk over a per-transfer connection and streams chunks', async () => {
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/photo.png', canceled: false });
    mocks.getConfig.mockReturnValue({ transport: 'wss', url: 'wss://daemon.example' });
    mocks.shouldUseTransferConnection.mockReturnValue(true);

    const CHUNK = 16 * 1024 * 1024;
    const size = CHUNK + 5;
    const first = Buffer.alloc(8, 1); // content length ≠ bytesRead is fine: write uses content
    const second = Buffer.from('tail!');
    const connectionRequest = vi
      .fn()
      .mockResolvedValueOnce({ content: first.toString('base64'), bytesRead: CHUNK, size })
      .mockResolvedValueOnce({ content: second.toString('base64'), bytesRead: 5, size });
    mocks.withTransferConnection.mockImplementation(async (_config, fn) =>
      fn({ request: connectionRequest, release: vi.fn() }),
    );
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.open.mockResolvedValue({ write, close });

    const result = await getDownloadAttachmentHandler()({}, request);

    expect(connectionRequest).toHaveBeenNthCalledWith(1, 'file.readChunk', {
      workspaceId: 'ws-1',
      path: '.intent/attachments/photo.png',
      offset: 0,
      length: CHUNK,
    });
    expect(connectionRequest).toHaveBeenNthCalledWith(2, 'file.readChunk', {
      workspaceId: 'ws-1',
      path: '.intent/attachments/photo.png',
      offset: CHUNK,
      length: CHUNK,
    });
    expect(connectionRequest).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenNthCalledWith(1, first);
    expect(write).toHaveBeenNthCalledWith(2, second);
    expect(close).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: { filePath: '/dest/photo.png' } });
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });

  it('remote backend: an empty file writes nothing and still succeeds', async () => {
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/photo.png', canceled: false });
    mocks.getConfig.mockReturnValue({ transport: 'wss', url: 'wss://daemon.example' });
    mocks.shouldUseTransferConnection.mockReturnValue(true);
    const connectionRequest = vi.fn().mockResolvedValue({ content: '', bytesRead: 0, size: 0 });
    mocks.withTransferConnection.mockImplementation(async (_config, fn) =>
      fn({ request: connectionRequest, release: vi.fn() }),
    );
    const write = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.open.mockResolvedValue({ write, close });

    const result = await getDownloadAttachmentHandler()({}, request);

    expect(connectionRequest).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: { filePath: '/dest/photo.png' } });
  });

  it('returns canceled without touching the backend when the save dialog is dismissed', async () => {
    mocks.showSaveDialog.mockResolvedValue({ filePath: undefined, canceled: true });

    const result = await getDownloadAttachmentHandler()({}, request);

    expect(result).toEqual({ success: false, canceled: true });
    expect(mocks.backendRequest).not.toHaveBeenCalled();
    expect(mocks.withTransferConnection).not.toHaveBeenCalled();
  });

  it('returns a DOWNLOAD_FAILED error naming the attachment when the fetch fails', async () => {
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/photo.png', canceled: false });
    mocks.backendRequest.mockRejectedValue(new Error('daemon unreachable'));

    const result = await getDownloadAttachmentHandler()({}, request);

    expect(result).toEqual({
      success: false,
      error: {
        code: 'DOWNLOAD_FAILED',
        message: expect.stringContaining('photo.png'),
      },
    });
    expect(result.error.message).not.toContain('daemon unreachable');
  });
});
