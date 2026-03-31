import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Mock getEnhancedPath to return a predictable value for testing
const MOCK_ENHANCED_PATH = process.env.PATH + ':/opt/homebrew/bin';
vi.mock('../../../shared/main/find-binary', () => ({
  getEnhancedPath: () => MOCK_ENHANCED_PATH,
}));

import { checkGitVersion } from '../main/version-checks';

describe('checkGitVersion', () => {
  let mockExec: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExec = vi.fn();
  });

  it('should return gitInstalled: true and parsed version when git is available', async () => {
    mockExec.mockResolvedValueOnce({ stdout: 'git version 2.39.0\n', stderr: '' });

    const result = await checkGitVersion(mockExec);

    expect(result).toEqual({ gitInstalled: true, gitVersion: '2.39.0' });
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledWith('git --version', {
      timeout: 5000,
      env: { ...process.env, PATH: MOCK_ENHANCED_PATH },
      windowsHide: true,
    });
  });

  it('should parse version from macOS Xcode git output', async () => {
    mockExec.mockResolvedValueOnce({
      stdout: 'git version 2.39.5 (Apple Git-154)\n',
      stderr: '',
    });

    const result = await checkGitVersion(mockExec);

    expect(result).toEqual({ gitInstalled: true, gitVersion: '2.39.5' });
  });

  it('should parse version from Windows Git for Windows output', async () => {
    mockExec.mockResolvedValueOnce({
      stdout: 'git version 2.44.0.windows.1\n',
      stderr: '',
    });

    const result = await checkGitVersion(mockExec);

    expect(result).toEqual({ gitInstalled: true, gitVersion: '2.44.0' });
  });

  it('should return gitInstalled: false when git is not found', async () => {
    const error = new Error('Command not found: git') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockExec.mockRejectedValueOnce(error);

    const result = await checkGitVersion(mockExec);

    expect(result).toEqual({ gitInstalled: false });
    expect(mockExec).toHaveBeenCalledTimes(1); // No retry for ENOENT
  });

  it('should retry on transient EAGAIN errors', async () => {
    const eagainError = new Error('spawn EAGAIN') as NodeJS.ErrnoException;
    eagainError.code = 'EAGAIN';

    mockExec
      .mockRejectedValueOnce(eagainError)
      .mockResolvedValueOnce({ stdout: 'git version 2.40.1\n', stderr: '' });

    const result = await checkGitVersion(mockExec);

    expect(result).toEqual({ gitInstalled: true, gitVersion: '2.40.1' });
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it('should return gitInstalled: false after exhausting retries on transient errors', async () => {
    const eagainError = new Error('spawn EAGAIN') as NodeJS.ErrnoException;
    eagainError.code = 'EAGAIN';

    mockExec
      .mockRejectedValueOnce(eagainError)
      .mockRejectedValueOnce(eagainError)
      .mockRejectedValueOnce(eagainError);

    const result = await checkGitVersion(mockExec);

    expect(result).toEqual({ gitInstalled: false });
    expect(mockExec).toHaveBeenCalledTimes(3);
  });

  it('should handle empty stdout gracefully', async () => {
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const error = new Error('Command not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockExec.mockRejectedValueOnce(error);

    const result = await checkGitVersion(mockExec);

    // First call returns empty stdout, second attempt fails — gitInstalled: false
    expect(result).toEqual({ gitInstalled: false });
  });
});
