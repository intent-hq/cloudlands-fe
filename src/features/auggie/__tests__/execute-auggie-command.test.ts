import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

// Mock auggie-path before importing the module under test
vi.mock('../main/auggie-path', () => ({
  findAuggiePathAsync: vi.fn(),
  getEnhancedPath: vi.fn(() => '/usr/bin:/bin:/usr/sbin:/sbin'),
}));

// Mock the hostExec seam — the module under test now proxies every auggie
// invocation through `host.exec` (PROTOCOL §5.14) instead of spawning locally.
vi.mock('../../../shared/main/host-exec', () => ({
  hostExec: vi.fn(),
}));

// Mock logger to avoid side effects in tests
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

import {
  getAuggieExecPATH,
  shouldUseWindowsShell,
  executeAuggieCommand,
  execWithEnhancedPath,
} from '../main/execute-auggie-command';
import {
  getEnhancedPath,
  findAuggiePathAsync,
} from '../main/auggie-path';
import { hostExec } from '../../../shared/main/host-exec';

describe('getAuggieExecPATH', () => {
  const MOCK_ENHANCED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

  beforeEach(() => {
    vi.mocked(getEnhancedPath).mockReturnValue(MOCK_ENHANCED_PATH);
  });

  it('returns enhanced PATH unchanged when auggiePath is null', () => {
    expect(getAuggieExecPATH(null)).toBe(MOCK_ENHANCED_PATH);
  });

  it('returns enhanced PATH unchanged when auggiePath is undefined (cast)', () => {
    expect(getAuggieExecPATH(undefined as unknown as string | null)).toBe(MOCK_ENHANCED_PATH);
  });

  it('returns enhanced PATH unchanged when auggiePath is empty string', () => {
    expect(getAuggieExecPATH('')).toBe(MOCK_ENHANCED_PATH);
  });

  it('returns enhanced PATH unchanged when auggiePath is a bare name (non-absolute)', () => {
    expect(getAuggieExecPATH('auggie')).toBe(MOCK_ENHANCED_PATH);
  });

  it('returns enhanced PATH unchanged when auggiePath is a relative path', () => {
    expect(getAuggieExecPATH('./auggie')).toBe(MOCK_ENHANCED_PATH);
    expect(getAuggieExecPATH('../bin/auggie')).toBe(MOCK_ENHANCED_PATH);
  });

  it('prepends auggie bin directory for absolute POSIX path', () => {
    const result = getAuggieExecPATH('/usr/local/bin/auggie');
    const sep = process.platform === 'win32' ? ';' : ':';
    expect(result).toBe(`/usr/local/bin${sep}${MOCK_ENHANCED_PATH}`);
  });

  it('prepends auggie bin directory for deeply nested absolute path', () => {
    const result = getAuggieExecPATH('/home/user/.nvm/versions/node/v20/bin/auggie');
    const sep = process.platform === 'win32' ? ';' : ':';
    expect(result).toBe(`/home/user/.nvm/versions/node/v20/bin${sep}${MOCK_ENHANCED_PATH}`);
  });
});

describe('shouldUseWindowsShell', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns true on Windows when auggiePath is a bare name (non-absolute)', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(shouldUseWindowsShell('auggie')).toBe(true);
  });

  it('returns true on Windows when auggiePath is a .cmd file', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(shouldUseWindowsShell('C:\\Users\\dev\\AppData\\auggie.cmd')).toBe(true);
  });

  it('returns true on Windows when auggiePath is a .bat file', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(shouldUseWindowsShell('C:\\Users\\dev\\AppData\\auggie.bat')).toBe(true);
  });

  it('returns false on Windows when auggiePath is an absolute non-shim binary', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(shouldUseWindowsShell('/opt/auggie/auggie.exe')).toBe(false);
  });

  it('returns false on macOS/Linux with absolute path', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(shouldUseWindowsShell('/usr/local/bin/auggie')).toBe(false);
  });

  it('returns false on macOS/Linux with bare name', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(shouldUseWindowsShell('auggie')).toBe(false);
  });

  it('returns true on Windows when auggiePath is a .CMD file (uppercase)', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(shouldUseWindowsShell('/opt/auggie/AUGGIE.CMD')).toBe(true);
  });

  it('returns true on Windows when auggiePath is a .BAT file (uppercase)', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(shouldUseWindowsShell('/opt/auggie/AUGGIE.BAT')).toBe(true);
  });

  it('returns false on Linux with absolute path', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(shouldUseWindowsShell('/usr/local/bin/auggie')).toBe(false);
  });
});


describe('executeAuggieCommand (host.exec seam)', () => {
  beforeEach(() => {
    vi.mocked(hostExec).mockReset();
    vi.mocked(findAuggiePathAsync).mockReset();
  });

  it('proxies to hostExec with the resolved auggie path and argv', async () => {
    vi.mocked(findAuggiePathAsync).mockResolvedValue('/usr/local/bin/auggie');
    vi.mocked(hostExec).mockResolvedValue({
      stdout: '0.14.0',
      stderr: '',
      exitCode: 0,
    });

    const result = await executeAuggieCommand('--version', { timeout: 8000 });

    expect(hostExec).toHaveBeenCalledTimes(1);
    expect(hostExec).toHaveBeenCalledWith('/usr/local/bin/auggie', {
      args: ['--version'],
      timeoutMs: 8000,
    });
    expect(result).toEqual({ stdout: '0.14.0', stderr: '' });
  });

  it('falls back to the bare `auggie` command when path resolution returns null', async () => {
    vi.mocked(findAuggiePathAsync).mockResolvedValue(null);
    vi.mocked(hostExec).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    await executeAuggieCommand('model list --json');

    expect(hostExec).toHaveBeenCalledWith('auggie', {
      args: ['model', 'list', '--json'],
      timeoutMs: 30_000,
    });
  });

  it('throws when hostExec reports a non-zero exit code', async () => {
    vi.mocked(findAuggiePathAsync).mockResolvedValue('/usr/local/bin/auggie');
    vi.mocked(hostExec).mockResolvedValue({
      stdout: '',
      stderr: 'not logged in',
      exitCode: 1,
    });

    await expect(executeAuggieCommand('model list')).rejects.toThrow('not logged in');
  });

  it('throws a timeout error when hostExec reports timedOut', async () => {
    vi.mocked(findAuggiePathAsync).mockResolvedValue('/usr/local/bin/auggie');
    vi.mocked(hostExec).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 124,
      timedOut: true,
    });

    await expect(executeAuggieCommand('--version', { timeout: 500 })).rejects.toThrow(
      /timed out after 500ms/,
    );
  });

  it('rejects when caller supplies stdin (host.exec has no stdin channel)', async () => {
    vi.mocked(findAuggiePathAsync).mockResolvedValue('/usr/local/bin/auggie');

    await expect(
      executeAuggieCommand('login', { stdin: 'y\n' }),
    ).rejects.toThrow(/stdin is not supported/);
    expect(hostExec).not.toHaveBeenCalled();
  });
});

describe('execWithEnhancedPath (host.exec seam)', () => {
  beforeEach(() => {
    vi.mocked(hostExec).mockReset();
  });

  it('forwards command + argv + timeout to hostExec', async () => {
    vi.mocked(hostExec).mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    });

    const result = await execWithEnhancedPath('/opt/claude/claude', ['mcp', 'list'], {
      timeout: 5000,
    });

    expect(hostExec).toHaveBeenCalledWith('/opt/claude/claude', {
      args: ['mcp', 'list'],
      timeoutMs: 5000,
    });
    expect(result).toEqual({ stdout: 'ok', stderr: '' });
  });

  it('propagates cwd + workspaceId when provided', async () => {
    vi.mocked(hostExec).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    await execWithEnhancedPath('/opt/bin/tool', ['run'], {
      timeout: 1000,
      cwd: '/workspace/repo',
      workspaceId: 'ws-1',
    });

    expect(hostExec).toHaveBeenCalledWith('/opt/bin/tool', {
      args: ['run'],
      timeoutMs: 1000,
      cwd: '/workspace/repo',
      workspaceId: 'ws-1',
    });
  });
});
