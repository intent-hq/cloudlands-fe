import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecAsync, mockExecAsyncWithRetry, mockExistsSync, loggerSpies, originalPlatform, originalEnv } = vi.hoisted(
  () => ({
    mockExecAsync: vi.fn(),
    mockExecAsyncWithRetry: vi.fn(),
    mockExistsSync: vi.fn<(path: string | Buffer) => boolean>(() => false),
    loggerSpies: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    originalPlatform: process.platform,
    originalEnv: { ...process.env },
  }),
);

vi.mock('../async-utils', () => ({
  execAsync: mockExecAsync,
}));

vi.mock('../../git/git-env', () => ({
  execAsyncWithRetry: mockExecAsyncWithRetry,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mocked = {
    ...actual,
    existsSync: mockExistsSync,
  };
  return { ...mocked, default: mocked };
});

vi.mock('../../logger', () => ({
  Logger: class MockLogger {
    debug = loggerSpies.debug;
    info = loggerSpies.info;
    warn = loggerSpies.warn;
    error = loggerSpies.error;
  },
}));

import { clearBinaryCache, findBinary } from '../find-binary';

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

describe('findBinary', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsyncWithRetry.mockReset();
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(false);
    loggerSpies.debug.mockReset();
    loggerSpies.info.mockReset();
    loggerSpies.warn.mockReset();
    loggerSpies.error.mockReset();
    clearBinaryCache();
    process.env = { ...originalEnv };
    setPlatform(originalPlatform);
  });

  afterEach(() => {
    clearBinaryCache();
    process.env = { ...originalEnv };
    setPlatform(originalPlatform);
  });

  it('returns a cached result immediately on the second lookup', async () => {
    setPlatform('win32');
    mockExecAsync.mockResolvedValue({
      stdout: 'C:\\Users\\test\\AppData\\Roaming\\npm\\foo.cmd\r\n',
      stderr: '',
    });

    const firstResult = await findBinary('foo');
    const secondResult = await findBinary('foo');

    expect(firstResult).toBe('C:\\Users\\test\\AppData\\Roaming\\npm\\foo.cmd');
    expect(secondResult).toBe(firstResult);
    expect(mockExecAsync).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid binary names before running shell commands', async () => {
    const result = await findBinary('foo; rm -rf /');

    expect(result).toBeNull();
    expect(mockExecAsync).not.toHaveBeenCalled();
    expect(loggerSpies.warn).toHaveBeenCalledWith('Invalid binary name rejected', { name: 'foo; rm -rf /' });
  });

  it('keeps cached results separate for option sets that affect discovery', async () => {
    setPlatform('win32');
    mockExecAsync
      .mockResolvedValueOnce({ stdout: 'C:\\Tools\\foo.exe\r\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'C:\\Users\\test\\AppData\\Roaming\\npm\\foo.cmd\r\n', stderr: '' });

    const withoutEnhancedPath = await findBinary('foo', { useEnhancedPath: false });
    const withEnhancedPath = await findBinary('foo', { useEnhancedPath: true });

    expect(withoutEnhancedPath).toBe('C:\\Tools\\foo.exe');
    expect(withEnhancedPath).toBe('C:\\Users\\test\\AppData\\Roaming\\npm\\foo.cmd');
    expect(mockExecAsync).toHaveBeenCalledTimes(2);
  });

  it('clears all cached variants for a binary name', async () => {
    setPlatform('win32');
    mockExecAsync
      .mockResolvedValueOnce({ stdout: 'C:\\Tools\\foo.exe\r\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'C:\\Users\\test\\AppData\\Roaming\\npm\\foo.cmd\r\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'C:\\Refreshed\\foo.exe\r\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'C:\\Refreshed\\foo.cmd\r\n', stderr: '' });

    await findBinary('foo', { useEnhancedPath: false });
    await findBinary('foo', { useEnhancedPath: true });

    clearBinaryCache('foo');

    const refreshedWithoutEnhancedPath = await findBinary('foo', { useEnhancedPath: false });
    const refreshedWithEnhancedPath = await findBinary('foo', { useEnhancedPath: true });

    expect(refreshedWithoutEnhancedPath).toBe('C:\\Refreshed\\foo.exe');
    expect(refreshedWithEnhancedPath).toBe('C:\\Refreshed\\foo.cmd');
    expect(mockExecAsync).toHaveBeenCalledTimes(4);
  });

  it('returns the where result on Windows when a single path is found', async () => {
    setPlatform('win32');
    mockExecAsync.mockResolvedValue({ stdout: 'C:\\Tools\\foo.exe\r\n', stderr: '' });

    const result = await findBinary('foo', { cache: false });

    expect(result).toBe('C:\\Tools\\foo.exe');
    expect(mockExecAsync).toHaveBeenCalledWith(
      'where foo',
      expect.objectContaining({
        timeout: 5000,
        env: expect.objectContaining({ PATH: expect.stringContaining('System32') }),
      }),
    );
  });

  it('uses retry-enabled exec for command lookup when retry is true', async () => {
    setPlatform('win32');
    mockExecAsyncWithRetry.mockResolvedValue({ stdout: 'C:\\Tools\\foo.exe\r\n', stderr: '' });

    const result = await findBinary('foo', { cache: false, retry: true });

    expect(result).toBe('C:\\Tools\\foo.exe');
    expect(mockExecAsyncWithRetry).toHaveBeenCalledWith(
      'where foo',
      expect.objectContaining({
        timeout: 5000,
        env: expect.objectContaining({ PATH: expect.stringContaining('System32') }),
      }),
    );
    expect(mockExecAsync).not.toHaveBeenCalled();
  });

  it('prefers .cmd results from where on Windows when multiple paths are returned', async () => {
    setPlatform('win32');
    mockExecAsync.mockResolvedValue({
      stdout: [
        'C:\\Program Files\\nodejs\\foo.exe',
        'C:\\Users\\test\\AppData\\Roaming\\npm\\foo.cmd',
      ].join('\r\n'),
      stderr: '',
    });

    const result = await findBinary('foo', { cache: false });

    expect(result).toBe('C:\\Users\\test\\AppData\\Roaming\\npm\\foo.cmd');
  });

  it('returns the which result on macOS', async () => {
    setPlatform('darwin');
    mockExecAsync.mockResolvedValue({ stdout: '/opt/homebrew/bin/foo\n', stderr: '' });

    const result = await findBinary('foo', { cache: false, useLoginShell: false });

    expect(result).toBe('/opt/homebrew/bin/foo');
    expect(mockExecAsync).toHaveBeenCalledWith(
      'which foo',
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it('falls back to commonPaths when command lookup fails', async () => {
    setPlatform('win32');
    const commonPath = 'C:\\custom\\foo.cmd';
    mockExecAsync.mockRejectedValue(new Error('not found'));
    mockExistsSync.mockImplementation((candidate) => String(candidate) === commonPath);

    const result = await findBinary('foo', {
      commonPaths: ['C:\\other\\foo.cmd', commonPath],
      cache: false,
    });

    expect(result).toBe(commonPath);
    expect(mockExistsSync).toHaveBeenCalledWith(commonPath);
  });

  it('falls back to a login shell on macOS when which fails', async () => {
    setPlatform('darwin');
    process.env.SHELL = '/bin/zsh';
    const loginShellPath = '/Users/test/.local/bin/foo';
    mockExecAsync
      .mockRejectedValueOnce(new Error('which failed'))
      .mockResolvedValueOnce({ stdout: `${loginShellPath}\n`, stderr: '' });
    mockExistsSync.mockImplementation((candidate) => String(candidate) === loginShellPath);

    const result = await findBinary('foo', { cache: false });

    expect(result).toBe(loginShellPath);
    expect(mockExecAsync).toHaveBeenNthCalledWith(
      2,
      '/bin/zsh -l -c "which foo"',
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it('uses retry-enabled exec for login shell fallback when retry is true', async () => {
    setPlatform('darwin');
    process.env.SHELL = '/bin/zsh';
    const loginShellPath = '/Users/test/.local/bin/foo';
    mockExecAsyncWithRetry
      .mockRejectedValueOnce(new Error('which failed'))
      .mockResolvedValueOnce({ stdout: `${loginShellPath}\n`, stderr: '' });
    mockExistsSync.mockImplementation((candidate) => String(candidate) === loginShellPath);

    const result = await findBinary('foo', { cache: false, retry: true });

    expect(result).toBe(loginShellPath);
    expect(mockExecAsyncWithRetry).toHaveBeenNthCalledWith(
      1,
      'which foo',
      expect.objectContaining({ timeout: 5000 }),
    );
    expect(mockExecAsyncWithRetry).toHaveBeenNthCalledWith(
      2,
      '/bin/zsh -l -c "which foo"',
      expect.objectContaining({ timeout: 5000 }),
    );
    expect(mockExecAsync).not.toHaveBeenCalled();
  });

  it('returns null when nothing is found', async () => {
    setPlatform('darwin');
    mockExecAsync.mockRejectedValue(new Error('not found'));

    const result = await findBinary('foo', { cache: false });

    expect(result).toBeNull();
    expect(mockExecAsync).toHaveBeenCalledTimes(2);
  });
});