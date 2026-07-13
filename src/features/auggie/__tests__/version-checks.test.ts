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

vi.mock('../../../shared/main/host-exec', () => ({
  hostExec: vi.fn(),
}));

import { checkGitVersion } from '../main/version-checks';
import { hostExec } from '../../../shared/main/host-exec';

describe('checkGitVersion', () => {
  beforeEach(() => {
    vi.mocked(hostExec).mockReset();
  });

  it('routes the probe through host.exec with argv (no shell)', async () => {
    vi.mocked(hostExec).mockResolvedValueOnce({
      stdout: 'git version 2.39.0\n',
      stderr: '',
      exitCode: 0,
    });

    const result = await checkGitVersion();

    expect(result).toEqual({ gitInstalled: true, gitVersion: '2.39.0' });
    expect(hostExec).toHaveBeenCalledTimes(1);
    expect(hostExec).toHaveBeenCalledWith('git', {
      args: ['--version'],
      timeoutMs: 5000,
    });
  });

  it('parses version from macOS Xcode git output', async () => {
    vi.mocked(hostExec).mockResolvedValueOnce({
      stdout: 'git version 2.39.5 (Apple Git-154)\n',
      stderr: '',
      exitCode: 0,
    });

    const result = await checkGitVersion();

    expect(result).toEqual({ gitInstalled: true, gitVersion: '2.39.5' });
  });

  it('parses version from Windows Git for Windows output', async () => {
    vi.mocked(hostExec).mockResolvedValueOnce({
      stdout: 'git version 2.44.0.windows.1\n',
      stderr: '',
      exitCode: 0,
    });

    const result = await checkGitVersion();

    expect(result).toEqual({ gitInstalled: true, gitVersion: '2.44.0' });
  });

  it('returns gitInstalled: false when host.exec reports a non-zero exit', async () => {
    vi.mocked(hostExec).mockResolvedValueOnce({
      stdout: '',
      stderr: 'command not found: git',
      exitCode: 127,
    });

    const result = await checkGitVersion();

    expect(result).toEqual({ gitInstalled: false });
    expect(hostExec).toHaveBeenCalledTimes(1);
  });

  it('returns gitInstalled: false when host.exec times out', async () => {
    vi.mocked(hostExec).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 124,
      timedOut: true,
    });

    const result = await checkGitVersion();

    expect(result).toEqual({ gitInstalled: false });
  });

  it('honest-degrades on RPC failure without throwing', async () => {
    vi.mocked(hostExec).mockRejectedValueOnce(new Error('connection reset'));

    const result = await checkGitVersion();

    expect(result).toEqual({ gitInstalled: false });
    expect(hostExec).toHaveBeenCalledTimes(1);
  });

  it('handles empty stdout on a successful exit as gitInstalled: false', async () => {
    vi.mocked(hostExec).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const result = await checkGitVersion();

    expect(result).toEqual({ gitInstalled: false });
  });
});
