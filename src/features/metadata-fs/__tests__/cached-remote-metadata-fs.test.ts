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

// Mock the remote RPC manager (needed by RemoteMetadataFS)
vi.mock('$shared/main/remote-rpc-manager', () => ({
  remoteRPCManager: {
    getClient: vi.fn().mockResolvedValue(mockRpcClient),
  },
}));

// Mock the Logger
vi.mock('$shared/logger', () => ({
  Logger: class {
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Mock LocalMetadataFS to track calls without touching the real filesystem
const mockLocal = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
  access: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  rm: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('../main/local-metadata-fs', () => ({
  LocalMetadataFS: class {
    readFile = mockLocal.readFile;
    stat = mockLocal.stat;
    access = mockLocal.access;
    readdir = mockLocal.readdir;
    writeFile = mockLocal.writeFile;
    mkdir = mockLocal.mkdir;
    unlink = mockLocal.unlink;
    rm = mockLocal.rm;
    rename = mockLocal.rename;
  },
}));

import { CachedRemoteMetadataFS } from '../main/cached-remote-metadata-fs';

const LOCAL_BASE = '/Users/testuser/intent/workspaces/test-workspace/.workspace';
const REMOTE_BASE = '~/intent/workspaces/test-workspace/.workspace';

describe('CachedRemoteMetadataFS', () => {
  let cachedFS: CachedRemoteMetadataFS;

  beforeEach(() => {
    vi.clearAllMocks();
    cachedFS = new CachedRemoteMetadataFS({
      workspaceId: 'test-workspace',
      localBasePath: LOCAL_BASE,
      remoteBasePath: REMOTE_BASE,
    });
  });

  describe('read operations delegate to local', () => {
    it('readFile delegates to local', async () => {
      mockLocal.readFile.mockResolvedValue('local content');
      const result = await cachedFS.readFile('/some/file.md', 'utf-8');
      expect(result).toBe('local content');
      expect(mockLocal.readFile).toHaveBeenCalledWith('/some/file.md', 'utf-8');
    });

    it('stat delegates to local', async () => {
      const fakeStat = { mtime: new Date(), isFile: () => true, isDirectory: () => false };
      mockLocal.stat.mockResolvedValue(fakeStat);
      const result = await cachedFS.stat('/some/file.md');
      expect(result).toBe(fakeStat);
      expect(mockLocal.stat).toHaveBeenCalledWith('/some/file.md');
    });

    it('access delegates to local', async () => {
      mockLocal.access.mockResolvedValue(undefined);
      await cachedFS.access('/some/file.md');
      expect(mockLocal.access).toHaveBeenCalledWith('/some/file.md');
    });

    it('readdir delegates to local', async () => {
      const fakeEntries = [{ name: 'a.md', isFile: () => true, isDirectory: () => false }];
      mockLocal.readdir.mockResolvedValue(fakeEntries);
      const result = await cachedFS.readdir('/some/dir', { withFileTypes: true });
      expect(result).toBe(fakeEntries);
      expect(mockLocal.readdir).toHaveBeenCalledWith('/some/dir', { withFileTypes: true });
    });
  });

  describe('write operations translate paths for remote, keep local paths unchanged', () => {
    it('writeFile sends remote path to remote and local path to local', async () => {
      mockRpcClient.writeFile.mockResolvedValue({});
      mockLocal.writeFile.mockResolvedValue(undefined);

      const localPath = `${LOCAL_BASE}/notes/spec.md`;
      await cachedFS.writeFile(localPath, 'content', 'utf-8');

      // Remote should receive the translated path (with mkdirp for safety)
      expect(mockRpcClient.writeFile).toHaveBeenCalledWith({
        path: `${REMOTE_BASE}/notes/spec.md`,
        content: 'content',
        encoding: 'utf-8',
        mkdirp: true,
      });
      // Local should receive the original local path
      expect(mockLocal.writeFile).toHaveBeenCalledWith(localPath, 'content', 'utf-8');
    });

    it('mkdir translates path for remote', async () => {
      mockRpcClient.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
      mockLocal.mkdir.mockResolvedValue(undefined);

      const localPath = `${LOCAL_BASE}/notes`;
      await cachedFS.mkdir(localPath, { recursive: true });

      // Remote exec should contain the remote path with tilde outside quotes
      expect(mockRpcClient.exec).toHaveBeenCalledWith({
        command: expect.stringContaining("~/'intent/workspaces/test-workspace/.workspace/notes'"),
      });
      // Local should receive the original local path
      expect(mockLocal.mkdir).toHaveBeenCalledWith(localPath, { recursive: true });
    });

    it('unlink translates path for remote', async () => {
      mockRpcClient.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
      mockLocal.unlink.mockResolvedValue(undefined);

      const localPath = `${LOCAL_BASE}/notes/old.md`;
      await cachedFS.unlink(localPath);

      expect(mockRpcClient.exec).toHaveBeenCalledWith({
        command: expect.stringContaining("~/'intent/workspaces/test-workspace/.workspace/notes/old.md'"),
      });
      expect(mockLocal.unlink).toHaveBeenCalledWith(localPath);
    });

    it('rm translates path for remote', async () => {
      mockRpcClient.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
      mockLocal.rm.mockResolvedValue(undefined);

      const localPath = `${LOCAL_BASE}/agents`;
      await cachedFS.rm(localPath, { recursive: true, force: true });

      expect(mockRpcClient.exec).toHaveBeenCalledWith({
        command: expect.stringContaining("~/'intent/workspaces/test-workspace/.workspace/agents'"),
      });
      expect(mockLocal.rm).toHaveBeenCalledWith(localPath, { recursive: true, force: true });
    });

    it('rename translates BOTH old and new paths for remote', async () => {
      mockRpcClient.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
      mockLocal.rename.mockResolvedValue(undefined);

      const oldLocal = `${LOCAL_BASE}/notes/old.md`;
      const newLocal = `${LOCAL_BASE}/notes/new.md`;
      await cachedFS.rename(oldLocal, newLocal);

      // Remote exec should contain both translated paths with tilde outside quotes
      const execCall = mockRpcClient.exec.mock.calls[0][0].command as string;
      expect(execCall).toContain("~/'intent/workspaces/test-workspace/.workspace/notes/old.md'");
      expect(execCall).toContain("~/'intent/workspaces/test-workspace/.workspace/notes/new.md'");
      // Local should receive the original local paths
      expect(mockLocal.rename).toHaveBeenCalledWith(oldLocal, newLocal);
    });
  });

  describe('path translation edge cases', () => {
    it('passes through path unchanged when it does not start with localBasePath', async () => {
      mockRpcClient.writeFile.mockResolvedValue({});
      mockLocal.writeFile.mockResolvedValue(undefined);

      const unknownPath = '/some/other/path/file.md';
      await cachedFS.writeFile(unknownPath, 'content', 'utf-8');

      // Remote should receive the path unchanged (with mkdirp)
      expect(mockRpcClient.writeFile).toHaveBeenCalledWith({
        path: unknownPath,
        content: 'content',
        encoding: 'utf-8',
        mkdirp: true,
      });
      // Local should also receive the path unchanged
      expect(mockLocal.writeFile).toHaveBeenCalledWith(unknownPath, 'content', 'utf-8');
    });

    it('handles trailing slashes in base paths', async () => {
      const fsWithTrailingSlash = new CachedRemoteMetadataFS({
        workspaceId: 'test-workspace',
        localBasePath: LOCAL_BASE + '/',
        remoteBasePath: REMOTE_BASE + '/',
      });

      mockRpcClient.writeFile.mockResolvedValue({});
      mockLocal.writeFile.mockResolvedValue(undefined);

      const localPath = `${LOCAL_BASE}/notes/spec.md`;
      await fsWithTrailingSlash.writeFile(localPath, 'content', 'utf-8');

      expect(mockRpcClient.writeFile).toHaveBeenCalledWith({
        path: `${REMOTE_BASE}/notes/spec.md`,
        content: 'content',
        encoding: 'utf-8',
        mkdirp: true,
      });
    });
  });

  describe('error propagation — remote failure prevents local update', () => {
    it('writeFile does not update local when remote fails', async () => {
      mockRpcClient.writeFile.mockRejectedValue(new Error('RPC unavailable'));

      await expect(cachedFS.writeFile('/f.md', 'x', 'utf-8')).rejects.toThrow('RPC unavailable');
      expect(mockLocal.writeFile).not.toHaveBeenCalled();
    });

    it('unlink does not update local when remote fails', async () => {
      mockRpcClient.exec.mockRejectedValue(new Error('RPC unavailable'));

      await expect(cachedFS.unlink('/f.md')).rejects.toThrow('RPC unavailable');
      expect(mockLocal.unlink).not.toHaveBeenCalled();
    });

    it('rm does not update local when remote fails', async () => {
      mockRpcClient.exec.mockRejectedValue(new Error('RPC unavailable'));

      await expect(cachedFS.rm('/dir', { recursive: true })).rejects.toThrow('RPC unavailable');
      expect(mockLocal.rm).not.toHaveBeenCalled();
    });
  });
});

