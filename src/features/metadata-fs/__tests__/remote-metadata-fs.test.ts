import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mock objects are available inside the hoisted vi.mock factory
const { mockRpcClient } = vi.hoisted(() => ({
  mockRpcClient: {
    readFile: vi.fn(),
    stat: vi.fn(),
    fileExists: vi.fn(),
    listDir: vi.fn(),
    writeFile: vi.fn(),
    exec: vi.fn(),
  },
}));

// Mock the remote RPC manager
vi.mock('$shared/main/remote-rpc-manager', () => ({
  remoteRPCManager: {
    getClient: vi.fn().mockResolvedValue(mockRpcClient),
  },
}));

// Mock the Logger (must be a class since it's used with `new`)
vi.mock('$shared/logger', () => ({
  Logger: class {
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

import { RemoteMetadataFS } from '../main/remote-metadata-fs';

describe('RemoteMetadataFS', () => {
  let remoteFS: RemoteMetadataFS;

  beforeEach(() => {
    vi.clearAllMocks();
    remoteFS = new RemoteMetadataFS('test-workspace-id');
  });

  describe('readFile', () => {
    it('calls client.readFile and returns content', async () => {
      mockRpcClient.readFile.mockResolvedValue({ content: 'hello', size: 5, truncated: false });
      const result = await remoteFS.readFile('/remote/path/file.md', 'utf-8');
      expect(result).toBe('hello');
      expect(mockRpcClient.readFile).toHaveBeenCalledWith({ path: '/remote/path/file.md', encoding: 'utf-8' });
    });
  });

  describe('stat', () => {
    it('converts RPC stat result to MetadataStat', async () => {
      mockRpcClient.stat.mockResolvedValue({
        size: 2048,
        mtime: '2025-06-15T12:00:00.000Z',
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        permissions: '0644',
      });

      const result = await remoteFS.stat('/remote/path/file.md');

      expect(result.size).toBe(2048);
      expect(result.mtime).toEqual(new Date('2025-06-15T12:00:00.000Z'));
      expect(result.isFile()).toBe(true);
      expect(result.isDirectory()).toBe(false);
    });
  });

  describe('access', () => {
    it('resolves when file exists', async () => {
      mockRpcClient.fileExists.mockResolvedValue({ exists: true, isFile: true, isDirectory: false });
      await expect(remoteFS.access('/remote/path/file.md')).resolves.toBeUndefined();
    });

    it('throws ENOENT when file does not exist', async () => {
      mockRpcClient.fileExists.mockResolvedValue({ exists: false, isFile: false, isDirectory: false });
      try {
        await remoteFS.access('/remote/missing');
        expect.fail('Expected ENOENT error');
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        expect(error.code).toBe('ENOENT');
        expect(error.message).toContain('/remote/missing');
      }
    });
  });

  describe('readdir', () => {
    it('maps DirEntry to MetadataDirent with correct types', async () => {
      mockRpcClient.listDir.mockResolvedValue({
        entries: [
          { name: 'note.md', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
          { name: '.meta', type: 'directory', size: 0, mtime: '2025-01-01T00:00:00Z' },
        ],
      });

      const result = await remoteFS.readdir('/notes', { withFileTypes: true });

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('note.md');
      expect(result[0].isFile()).toBe(true);
      expect(result[0].isDirectory()).toBe(false);
      expect(result[1].name).toBe('.meta');
      expect(result[1].isFile()).toBe(false);
      expect(result[1].isDirectory()).toBe(true);
      // Ensure includeHidden is true (for .meta/ dirs)
      expect(mockRpcClient.listDir).toHaveBeenCalledWith({ path: '/notes', includeHidden: true });
    });
  });

  describe('writeFile', () => {
    it('calls client.writeFile with mkdirp: true', async () => {
      mockRpcClient.writeFile.mockResolvedValue({ ok: true });
      await remoteFS.writeFile('/remote/file.md', 'content', 'utf-8');
      expect(mockRpcClient.writeFile).toHaveBeenCalledWith({
        path: '/remote/file.md', content: 'content', encoding: 'utf-8', mkdirp: true,
      });
    });
  });

  describe('mkdir', () => {
    it('uses exec with mkdir -p for recursive', async () => {
      mockRpcClient.exec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
      await remoteFS.mkdir('/remote/dir/sub', { recursive: true });
      expect(mockRpcClient.exec).toHaveBeenCalledWith({
        command: expect.stringContaining('mkdir -p'),
      });
    });
  });

  describe('unlink', () => {
    it('uses exec with rm command', async () => {
      mockRpcClient.exec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
      await remoteFS.unlink('/remote/file.md');
      expect(mockRpcClient.exec).toHaveBeenCalledWith({
        command: expect.stringContaining('rm'),
      });
    });
  });

  describe('rm', () => {
    it('uses exec with rm -rf for recursive+force', async () => {
      mockRpcClient.exec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
      await remoteFS.rm('/remote/dir', { recursive: true, force: true });
      expect(mockRpcClient.exec).toHaveBeenCalledWith({
        command: expect.stringContaining('rm -rf'),
      });
    });
  });

  describe('rename', () => {
    it('uses exec with mv command', async () => {
      mockRpcClient.exec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
      await remoteFS.rename('/old/path', '/new/path');
      const call = mockRpcClient.exec.mock.calls[0][0].command;
      expect(call).toContain('mv');
      expect(call).toContain('/old/path');
      expect(call).toContain('/new/path');
    });
  });

  // ── Tilde expansion tests ──────────────────────────────────────────

  describe('tilde expansion in shell commands', () => {
    beforeEach(() => {
      mockRpcClient.exec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    });

    it('mkdir keeps ~ outside quotes for tilde paths', async () => {
      await remoteFS.mkdir('~/intent/.workspace/notes', { recursive: true });
      const cmd = mockRpcClient.exec.mock.calls[0][0].command;
      // ~ must NOT be inside single quotes; the rest of the path must be quoted
      expect(cmd).toBe("mkdir -p ~/'intent/.workspace/notes'");
    });

    it('unlink keeps ~ outside quotes for tilde paths', async () => {
      await remoteFS.unlink('~/intent/.workspace/notes/spec.md');
      const cmd = mockRpcClient.exec.mock.calls[0][0].command;
      expect(cmd).toBe("rm ~/'intent/.workspace/notes/spec.md'");
    });

    it('rm keeps ~ outside quotes for tilde paths', async () => {
      await remoteFS.rm('~/intent/.workspace', { recursive: true, force: true });
      const cmd = mockRpcClient.exec.mock.calls[0][0].command;
      expect(cmd).toBe("rm -rf ~/'intent/.workspace'");
    });

    it('rename keeps ~ outside quotes for tilde paths', async () => {
      await remoteFS.rename('~/intent/.workspace/old', '~/intent/.workspace/new');
      const cmd = mockRpcClient.exec.mock.calls[0][0].command;
      expect(cmd).toBe("mv ~/'intent/.workspace/old' ~/'intent/.workspace/new'");
    });

    it('non-tilde paths remain fully single-quoted', async () => {
      await remoteFS.mkdir('/abs/path/dir', { recursive: true });
      const cmd = mockRpcClient.exec.mock.calls[0][0].command;
      expect(cmd).toBe("mkdir -p '/abs/path/dir'");
    });
  });
});

