import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  sendToWorkspaceWindows: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  stat: vi.fn(),
  open: vi.fn(),
  createReadStream: vi.fn(),
  renameWithRetry: vi.fn(),
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
      stat: mocks.stat,
      open: mocks.open,
    },
    createReadStream: mocks.createReadStream,
  },
  promises: {
    access: mocks.access,
    mkdir: mocks.mkdir,
    writeFile: mocks.writeFile,
    unlink: mocks.unlink,
    stat: mocks.stat,
    open: mocks.open,
  },
  createReadStream: mocks.createReadStream,
}));

vi.mock('../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: mocks.sendToWorkspaceWindows,
}));

vi.mock('../../../../shared/main/file-sync-utils', () => ({
  renameWithRetry: mocks.renameWithRetry,
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
});

describe('file:read-chunk / file:hash (chunked remote attachment upload)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    setupFileIPC();
  });

  it('reads one bounded base64 slice at the requested offset', async () => {
    const fileBytes = Buffer.from('0123456789');
    mocks.stat.mockResolvedValue({ isDirectory: () => false, size: fileBytes.length });
    const read = vi.fn(async (buffer: Buffer, _off: number, length: number, position: number) => {
      const slice = fileBytes.subarray(position, position + length);
      slice.copy(buffer);
      return { bytesRead: slice.length };
    });
    const close = vi.fn();
    mocks.open.mockResolvedValue({ read, close });

    const handler = mocks.handlers.get(FILE_CHANNELS.READ_CHUNK);
    expect(handler).toBeDefined();
    const result = await handler?.({}, { path: '/data/file.bin', offset: 4, length: 3 });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      content: Buffer.from('456').toString('base64'),
      bytesRead: 3,
      size: 10,
    });
    expect(close).toHaveBeenCalled();
  });

  it('short-reads the final chunk past EOF', async () => {
    const fileBytes = Buffer.from('0123456789');
    mocks.stat.mockResolvedValue({ isDirectory: () => false, size: fileBytes.length });
    const read = vi.fn(async (buffer: Buffer, _off: number, length: number, position: number) => {
      const slice = fileBytes.subarray(position, position + length);
      slice.copy(buffer);
      return { bytesRead: slice.length };
    });
    mocks.open.mockResolvedValue({ read, close: vi.fn() });

    const handler = mocks.handlers.get(FILE_CHANNELS.READ_CHUNK);
    const result = await handler?.({}, { path: '/data/file.bin', offset: 8, length: 5 });

    expect(result.success).toBe(true);
    expect(result.data.bytesRead).toBe(2);
    expect(result.data.content).toBe(Buffer.from('89').toString('base64'));
  });

  it('rejects directories and surfaces read errors as { success: false }', async () => {
    mocks.stat.mockResolvedValue({ isDirectory: () => true, size: 0 });
    const handler = mocks.handlers.get(FILE_CHANNELS.READ_CHUNK);
    const dirResult = await handler?.({}, { path: '/data', offset: 0, length: 1 });
    expect(dirResult.success).toBe(false);
    expect(dirResult.error.code).toBe('IS_DIRECTORY');

    mocks.stat.mockRejectedValue(new Error('ENOENT: no such file'));
    const missingResult = await handler?.({}, { path: '/gone.bin', offset: 0, length: 1 });
    expect(missingResult.success).toBe(false);
    expect(missingResult.error.code).toBe('FILE_READ_FAILED');
    expect(missingResult.error.message).toContain('ENOENT');
  });

  it('streams a SHA-256 over the file contents', async () => {
    const { EventEmitter } = await import('events');
    const { createHash } = await import('crypto');
    const fileBytes = Buffer.from('hello chunked world');
    mocks.stat.mockResolvedValue({ isDirectory: () => false, size: fileBytes.length });
    mocks.createReadStream.mockImplementation(() => {
      const stream = new EventEmitter();
      queueMicrotask(() => {
        stream.emit('data', fileBytes.subarray(0, 5));
        stream.emit('data', fileBytes.subarray(5));
        stream.emit('end');
      });
      return stream;
    });

    const handler = mocks.handlers.get(FILE_CHANNELS.HASH);
    expect(handler).toBeDefined();
    const result = await handler?.({}, { path: '/data/file.bin' });

    expect(result.success).toBe(true);
    expect(result.data.sha256).toBe(createHash('sha256').update(fileBytes).digest('hex'));
    expect(result.data.size).toBe(fileBytes.length);
  });

  it('surfaces hash stream errors as { success: false }', async () => {
    const { EventEmitter } = await import('events');
    mocks.stat.mockResolvedValue({ isDirectory: () => false, size: 10 });
    mocks.createReadStream.mockImplementation(() => {
      const stream = new EventEmitter();
      queueMicrotask(() => stream.emit('error', new Error('EIO: i/o error')));
      return stream;
    });

    const handler = mocks.handlers.get(FILE_CHANNELS.HASH);
    const result = await handler?.({}, { path: '/data/file.bin' });

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('FILE_READ_FAILED');
    expect(result.error.message).toContain('EIO');
  });
});
