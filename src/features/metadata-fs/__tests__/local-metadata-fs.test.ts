import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mock fns are available to the hoisted vi.mock factory
const {
  mockReadFile, mockStat, mockAccess, mockReaddir,
  mockWriteFile, mockMkdir, mockUnlink, mockRm, mockRename,
} = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockStat: vi.fn(),
  mockAccess: vi.fn(),
  mockReaddir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockUnlink: vi.fn(),
  mockRm: vi.fn(),
  mockRename: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mocked = {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: mockReadFile,
      stat: mockStat,
      access: mockAccess,
      readdir: mockReaddir,
      writeFile: mockWriteFile,
      mkdir: mockMkdir,
      unlink: mockUnlink,
      rm: mockRm,
      rename: mockRename,
    },
  };
  return { ...mocked, default: mocked };
});

import { LocalMetadataFS } from '../main/local-metadata-fs';

describe('LocalMetadataFS', () => {
  let localFS: LocalMetadataFS;

  beforeEach(() => {
    vi.clearAllMocks();
    localFS = new LocalMetadataFS();
  });

  describe('readFile', () => {
    it('delegates to fs.readFile with utf-8 encoding', async () => {
      mockReadFile.mockResolvedValue('file contents');
      const result = await localFS.readFile('/path/to/file.md', 'utf-8');
      expect(result).toBe('file contents');
      expect(mockReadFile).toHaveBeenCalledWith('/path/to/file.md', 'utf-8');
    });
  });

  describe('stat', () => {
    it('returns MetadataStat from fs.Stats', async () => {
      const fakeStats = {
        size: 1024,
        mtime: new Date('2025-01-15T10:00:00Z'),
        isFile: () => true,
        isDirectory: () => false,
      };
      mockStat.mockResolvedValue(fakeStats);

      const result = await localFS.stat('/path/to/file.md');

      expect(result.size).toBe(1024);
      expect(result.mtime).toEqual(new Date('2025-01-15T10:00:00Z'));
      expect(result.isFile()).toBe(true);
      expect(result.isDirectory()).toBe(false);
      expect(mockStat).toHaveBeenCalledWith('/path/to/file.md');
    });
  });

  describe('access', () => {
    it('delegates to fs.access', async () => {
      mockAccess.mockResolvedValue(undefined);
      await localFS.access('/path/to/file.md');
      expect(mockAccess).toHaveBeenCalledWith('/path/to/file.md');
    });

    it('throws when file does not exist', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockAccess.mockRejectedValue(err);
      await expect(localFS.access('/missing')).rejects.toThrow('ENOENT');
    });
  });

  describe('readdir', () => {
    it('maps fs.Dirent to MetadataDirent', async () => {
      const fakeDirents = [
        { name: 'note.md', isFile: () => true, isDirectory: () => false },
        { name: 'subdir', isFile: () => false, isDirectory: () => true },
      ];
      mockReaddir.mockResolvedValue(fakeDirents);

      const result = await localFS.readdir('/notes', { withFileTypes: true });

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('note.md');
      expect(result[0].isFile()).toBe(true);
      expect(result[0].isDirectory()).toBe(false);
      expect(result[1].name).toBe('subdir');
      expect(result[1].isFile()).toBe(false);
      expect(result[1].isDirectory()).toBe(true);
      expect(mockReaddir).toHaveBeenCalledWith('/notes', { withFileTypes: true });
    });
  });

  describe('writeFile', () => {
    it('delegates to fs.writeFile with utf-8 encoding', async () => {
      mockWriteFile.mockResolvedValue(undefined);
      await localFS.writeFile('/path/to/file.md', 'content', 'utf-8');
      expect(mockWriteFile).toHaveBeenCalledWith('/path/to/file.md', 'content', 'utf-8');
    });
  });

  describe('mkdir', () => {
    it('delegates to fs.mkdir with options', async () => {
      mockMkdir.mockResolvedValue(undefined);
      await localFS.mkdir('/path/to/dir', { recursive: true });
      expect(mockMkdir).toHaveBeenCalledWith('/path/to/dir', { recursive: true });
    });
  });

  describe('unlink', () => {
    it('delegates to fs.unlink', async () => {
      mockUnlink.mockResolvedValue(undefined);
      await localFS.unlink('/path/to/file.md');
      expect(mockUnlink).toHaveBeenCalledWith('/path/to/file.md');
    });
  });

  describe('rm', () => {
    it('delegates to fs.rm with options', async () => {
      mockRm.mockResolvedValue(undefined);
      await localFS.rm('/path/to/dir', { recursive: true, force: true });
      expect(mockRm).toHaveBeenCalledWith('/path/to/dir', { recursive: true, force: true });
    });
  });

  describe('rename', () => {
    it('delegates to fs.rename', async () => {
      mockRename.mockResolvedValue(undefined);
      await localFS.rename('/old/path', '/new/path');
      expect(mockRename).toHaveBeenCalledWith('/old/path', '/new/path');
    });
  });
});

