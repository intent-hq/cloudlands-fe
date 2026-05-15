import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  sendToWorkspaceWindows: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  renameWithRetry: vi.fn(),
  getWorkspaceGitInfo: vi.fn(),
  getRemoteClient: vi.fn(),
  trackMain: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('fs', () => ({
  default: {
    promises: {
      access: mocks.access,
      mkdir: mocks.mkdir,
      writeFile: mocks.writeFile,
      unlink: mocks.unlink,
    },
  },
  promises: {
    access: mocks.access,
    mkdir: mocks.mkdir,
    writeFile: mocks.writeFile,
    unlink: mocks.unlink,
  },
}));

vi.mock('../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: mocks.sendToWorkspaceWindows,
}));

vi.mock('../../../git/main/git-router', () => ({
  getWorkspaceGitInfo: mocks.getWorkspaceGitInfo,
}));

vi.mock('../../../../shared/main/file-sync-utils', () => ({
  renameWithRetry: mocks.renameWithRetry,
}));

vi.mock('../../../../shared/main/remote-rpc-manager', () => ({
  remoteRPCManager: {
    getClient: mocks.getRemoteClient,
  },
}));

vi.mock('$lib/services/analytics/main', () => ({
  trackMain: mocks.trackMain,
}));

vi.mock('$lib/services/analytics/utils', () => ({
  getFileExtension: vi.fn(() => '.ts'),
}));

import { FILE_CHANNELS } from '../../../../shared/ipc/channels';
import { setupFileIPC } from '../file.ipc';

describe('file IPC content emitter contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.access.mockRejectedValue(new Error('missing'));
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.renameWithRetry.mockResolvedValue(undefined);
    mocks.getWorkspaceGitInfo.mockResolvedValue(null);
    mocks.getRemoteClient.mockReturnValue(null);
  });

  it('emits static file:content-changed payload after local file writes', async () => {
    setupFileIPC();
    const handler = mocks.handlers.get(FILE_CHANNELS.WRITE);
    expect(handler).toBeDefined();

    const result = await handler?.(
      {},
      {
        workspaceId: 'ws-1',
        path: '/repo/src/app.ts',
        content: 'updated content',
      },
    );

    expect(result).toEqual({ success: true, data: { bytesWritten: 'updated content'.length } });
    expect(mocks.sendToWorkspaceWindows).toHaveBeenCalledWith('ws-1', 'file:content-changed', {
      workspaceId: 'ws-1',
      path: '/repo/src/app.ts',
      relativePath: '/repo/src/app.ts',
      content: 'updated content',
      source: 'user',
    });
  });

  it('emits static file:content-changed payload after remote file writes', async () => {
    const remoteClient = {
      fileExists: vi.fn().mockResolvedValue({ exists: true }),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getWorkspaceGitInfo.mockResolvedValue({ isRemote: true, sshConfig: {} });
    mocks.getRemoteClient.mockReturnValue(remoteClient);

    setupFileIPC();
    const handler = mocks.handlers.get(FILE_CHANNELS.WRITE);

    const result = await handler?.(
      {},
      {
        workspaceId: 'ws-1',
        path: 'src/app.ts',
        content: 'remote content',
      },
    );

    expect(result).toEqual({ success: true, data: { bytesWritten: 'remote content'.length } });
    expect(mocks.sendToWorkspaceWindows).toHaveBeenCalledWith('ws-1', 'file:content-changed', {
      workspaceId: 'ws-1',
      path: 'src/app.ts',
      relativePath: 'src/app.ts',
      content: 'remote content',
      source: 'user',
    });
  });
});