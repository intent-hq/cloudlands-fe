import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  showSaveDialog: vi.fn(),
  stat: vi.fn(),
  copyFile: vi.fn(),
  open: vi.fn(),
  unlink: vi.fn(),
  renameWithRetry: vi.fn(),
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
      unlink: mocks.unlink,
    },
  },
  promises: {
    stat: mocks.stat,
    copyFile: mocks.copyFile,
    open: mocks.open,
    unlink: mocks.unlink,
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
  renameWithRetry: mocks.renameWithRetry,
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
  const request = {
    workspaceId: 'ws-1',
    path: '.intent/attachments/photo.png',
    fileName: 'photo.png',
  };
  const TEMP_PATH_RE = /^\/dest\/photo\.png\.\d+-[a-z0-9]+\.tmp$/;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.copyFile.mockResolvedValue(undefined);
    mocks.unlink.mockResolvedValue(undefined);
    mocks.renameWithRetry.mockResolvedValue(undefined);
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
      expect.stringMatching(TEMP_PATH_RE),
    );
    const stagedPath = mocks.copyFile.mock.calls[0]?.[1];
    expect(mocks.renameWithRetry).toHaveBeenCalledWith(stagedPath, '/dest/photo.png');
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
      expect.stringMatching(TEMP_PATH_RE),
    );
  });

  it('remote backend: loops file.readChunk over a per-transfer connection and streams chunks', async () => {
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/photo.png', canceled: false });
    mocks.getConfig.mockReturnValue({ transport: 'wss', url: 'wss://daemon.example' });
    mocks.shouldUseTransferConnection.mockReturnValue(true);

    const CHUNK = 16 * 1024 * 1024;
    const size = CHUNK + 5;
    // PROTOCOL §5.9: content decodes to exactly bytesRead bytes.
    const first = Buffer.alloc(CHUNK, 1);
    const second = Buffer.from('tail!');
    const connectionRequest = vi
      .fn()
      .mockResolvedValueOnce({ content: first.toString('base64'), bytesRead: CHUNK, size })
      .mockResolvedValueOnce({ content: second.toString('base64'), bytesRead: 5, size });
    mocks.withTransferConnection.mockImplementation(async (_config, fn) =>
      fn({ request: connectionRequest, release: vi.fn() }),
    );
    const write = vi.fn().mockImplementation(async (buffer: Buffer, offset: number) => ({
      bytesWritten: buffer.length - offset,
    }));
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.open.mockResolvedValue({ write, close });

    const result = await getDownloadAttachmentHandler()({}, request);

    expect(mocks.open).toHaveBeenCalledWith(expect.stringMatching(TEMP_PATH_RE), 'w');
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
    // Buffer.equals (memcmp) instead of deep-equality matchers: vitest's
    // recursive diff on a 16 MiB buffer takes minutes.
    expect(write).toHaveBeenCalledTimes(2);
    expect((write.mock.calls[0]?.[0] as Buffer).equals(first)).toBe(true);
    expect(write.mock.calls[0]?.[1]).toBe(0);
    expect((write.mock.calls[1]?.[0] as Buffer).equals(second)).toBe(true);
    expect(write.mock.calls[1]?.[1]).toBe(0);
    expect(close).toHaveBeenCalled();
    const stagedPath = mocks.open.mock.calls[0]?.[0];
    expect(mocks.renameWithRetry).toHaveBeenCalledWith(stagedPath, '/dest/photo.png');
    expect(result).toEqual({ success: true, data: { filePath: '/dest/photo.png' } });
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });

  it('remote backend: retries short writes until the whole chunk is on disk', async () => {
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/photo.png', canceled: false });
    mocks.getConfig.mockReturnValue({ transport: 'wss', url: 'wss://daemon.example' });
    mocks.shouldUseTransferConnection.mockReturnValue(true);

    const content = Buffer.from('0123456789');
    const connectionRequest = vi
      .fn()
      .mockResolvedValue({ content: content.toString('base64'), bytesRead: 10, size: 10 });
    mocks.withTransferConnection.mockImplementation(async (_config, fn) =>
      fn({ request: connectionRequest, release: vi.fn() }),
    );
    const write = vi
      .fn()
      .mockResolvedValueOnce({ bytesWritten: 4 })
      .mockResolvedValueOnce({ bytesWritten: 6 });
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.open.mockResolvedValue({ write, close });

    const result = await getDownloadAttachmentHandler()({}, request);

    expect(write).toHaveBeenNthCalledWith(1, content, 0);
    expect(write).toHaveBeenNthCalledWith(2, content, 4);
    expect(write).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ success: true, data: { filePath: '/dest/photo.png' } });
  });

  it('remote backend: fails loudly when content and bytesRead diverge instead of corrupting the file', async () => {
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/photo.png', canceled: false });
    mocks.getConfig.mockReturnValue({ transport: 'wss', url: 'wss://daemon.example' });
    mocks.shouldUseTransferConnection.mockReturnValue(true);

    const connectionRequest = vi.fn().mockResolvedValue({
      content: Buffer.alloc(8, 1).toString('base64'),
      bytesRead: 16 * 1024 * 1024,
      size: 16 * 1024 * 1024 + 5,
    });
    mocks.withTransferConnection.mockImplementation(async (_config, fn) =>
      fn({ request: connectionRequest, release: vi.fn() }),
    );
    const write = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.open.mockResolvedValue({ write, close });

    const result = await getDownloadAttachmentHandler()({}, request);

    expect(write).not.toHaveBeenCalled();
    expect(mocks.renameWithRetry).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: { code: 'DOWNLOAD_FAILED', message: expect.stringContaining('photo.png') },
    });
  });

  it('local backend: rejects an attachment path that escapes the workspace root', async () => {
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/photo.png', canceled: false });
    mocks.backendRequest.mockResolvedValue({ workspace: { path: '/home/u/proj' } });

    const result = await getDownloadAttachmentHandler()(
      {},
      { workspaceId: 'ws-1', path: '../../etc/passwd', fileName: 'passwd' },
    );

    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.renameWithRetry).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: { code: 'DOWNLOAD_FAILED', message: expect.stringContaining('passwd') },
    });
  });

  it('leaves the chosen destination untouched and removes the temp file when the transfer fails', async () => {
    mocks.showSaveDialog.mockResolvedValue({ filePath: '/dest/photo.png', canceled: false });
    mocks.getConfig.mockReturnValue({ transport: 'wss', url: 'wss://daemon.example' });
    mocks.shouldUseTransferConnection.mockReturnValue(true);

    const connectionRequest = vi.fn().mockRejectedValue(new Error('connection dropped'));
    mocks.withTransferConnection.mockImplementation(async (_config, fn) =>
      fn({ request: connectionRequest, release: vi.fn() }),
    );
    const write = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.open.mockResolvedValue({ write, close });

    const result = await getDownloadAttachmentHandler()({}, request);

    expect(mocks.open).toHaveBeenCalledWith(expect.stringMatching(TEMP_PATH_RE), 'w');
    expect(close).toHaveBeenCalled();
    expect(mocks.renameWithRetry).not.toHaveBeenCalled();
    const stagedPath = mocks.open.mock.calls[0]?.[0];
    expect(mocks.unlink).toHaveBeenCalledWith(stagedPath);
    expect(result).toEqual({
      success: false,
      error: { code: 'DOWNLOAD_FAILED', message: expect.stringContaining('photo.png') },
    });
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
