import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EventEmitter from 'events';

// Mock auggie-path before importing the module under test
vi.mock('../main/auggie-path', () => ({
  findAuggiePathAsync: vi.fn(),
  getEnhancedPath: vi.fn(() => '/usr/bin:/bin:/usr/sbin:/sbin'),
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

// The source uses createRequire(import.meta.url)('child_process').spawn at runtime.
// We can intercept this by patching the module-level `requireNode` via vi.hoisted + vi.mock on 'module'.
const { mockSpawn } = vi.hoisted(() => {
  const mockSpawn = vi.fn();
  return { mockSpawn };
});

vi.mock('module', () => {
  const mockCreateRequire = () => (id: string) => {
    if (id === 'child_process') {
      return { spawn: mockSpawn };
    }
    throw new Error(`Unmocked requireNode call: ${id}`);
  };
  // vitest requires a default export for the 'module' built-in
  return {
    default: { createRequire: mockCreateRequire },
    createRequire: mockCreateRequire,
  };
});

import {
  getAuggieExecPATH,
  shouldUseWindowsShell,
  executeAuggieCommand,
} from '../main/execute-auggie-command';
import { getEnhancedPath } from '../main/auggie-path';
import { findAuggiePathAsync } from '../main/auggie-path';

describe('getAuggieExecPATH', () => {
  const MOCK_ENHANCED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

  beforeEach(() => {
    vi.mocked(getEnhancedPath).mockReturnValue(MOCK_ENHANCED_PATH);
  });

  it('returns enhanced PATH unchanged when auggiePath is null', () => {
    expect(getAuggieExecPATH(null)).toBe(MOCK_ENHANCED_PATH);
  });

  it('returns enhanced PATH unchanged when auggiePath is undefined (cast)', () => {
    // executeAuggieCommand may pass undefined in edge cases
    expect(getAuggieExecPATH(undefined as unknown as string | null)).toBe(MOCK_ENHANCED_PATH);
  });

  it('returns enhanced PATH unchanged when auggiePath is empty string', () => {
    expect(getAuggieExecPATH('')).toBe(MOCK_ENHANCED_PATH);
  });

  it('returns enhanced PATH unchanged when auggiePath is a bare name (non-absolute)', () => {
    // This is the key fix: path.dirname('auggie') === '.' which would leak CWD into PATH
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
    // Use a POSIX-style absolute path so path.isAbsolute() returns true on macOS test host.
    // On a real Windows box, path.isAbsolute('C:\\...\\auggie.exe') would also be true.
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



describe('executeAuggieWithStdin timeout tree-kill', () => {
  const originalPlatform = process.platform;

  function createFakeChild(pid: number) {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: ReturnType<typeof vi.fn>;
      stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.pid = pid;
    child.kill = vi.fn();
    child.stdin = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      end: vi.fn(),
    });
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mockSpawn.mockReset();
    vi.mocked(findAuggiePathAsync).mockResolvedValue('/usr/local/bin/auggie');
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('uses taskkill /T /F on Windows when shell is true', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    // findAuggiePathAsync returns null so executablePath='auggie' → useShell=true on win32
    vi.mocked(findAuggiePathAsync).mockResolvedValue(null);

    const fakeChild = createFakeChild(12345);
    const fakeTaskkill = createFakeChild(0);

    mockSpawn
      .mockReturnValueOnce(fakeChild) // first call: auggie spawn
      .mockReturnValueOnce(fakeTaskkill); // second call: taskkill spawn

    const promise = executeAuggieCommand('session stats', { stdin: 'data', timeout: 5000 });
    // Attach catch handler early to prevent unhandled rejection warning
    const caught = promise.catch((e: Error) => e);

    // Let the async findAuggiePathAsync resolve
    await vi.advanceTimersByTimeAsync(0);

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(5000);

    // Verify taskkill was spawned with the correct args
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn).toHaveBeenLastCalledWith(
      'taskkill',
      ['/pid', '12345', '/T', '/F'],
      { windowsHide: true },
    );

    // child.kill should NOT have been called directly (taskkill handles it)
    expect(fakeChild.kill).not.toHaveBeenCalled();

    // The promise should reject with timeout error
    const error = await caught;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Command timed out after 5000ms');
  });

  it('uses child.kill() on macOS/Linux (no taskkill)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    vi.mocked(findAuggiePathAsync).mockResolvedValue('/usr/local/bin/auggie');

    const fakeChild = createFakeChild(99999);
    mockSpawn.mockReturnValueOnce(fakeChild);

    const promise = executeAuggieCommand('session stats', { stdin: 'data', timeout: 3000 });
    const caught = promise.catch((e: Error) => e);

    // Let the async findAuggiePathAsync resolve
    await vi.advanceTimersByTimeAsync(0);

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(3000);

    // Only one spawn call (the auggie child), no taskkill
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // child.kill should have been called directly
    expect(fakeChild.kill).toHaveBeenCalledTimes(1);

    const error = await caught;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Command timed out after 3000ms');
  });

  it('falls back to child.kill() when taskkill spawn errors', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    vi.mocked(findAuggiePathAsync).mockResolvedValue(null);

    const fakeChild = createFakeChild(12345);
    const fakeTaskkill = createFakeChild(0);

    mockSpawn
      .mockReturnValueOnce(fakeChild)
      .mockReturnValueOnce(fakeTaskkill);

    const promise = executeAuggieCommand('session stats', { stdin: 'data', timeout: 5000 });
    const caught = promise.catch((e: Error) => e);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);

    // Simulate taskkill spawn error
    fakeTaskkill.emit('error', new Error('spawn taskkill ENOENT'));

    // Should fall back to child.kill()
    expect(fakeChild.kill).toHaveBeenCalledTimes(1);

    const error = await caught;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Command timed out after 5000ms');
  });
});

describe('executeAuggieWithStdin — spawn error clears timeout', () => {
  const originalPlatform = process.platform;

  function createFakeChild(pid: number) {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: ReturnType<typeof vi.fn>;
      stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.pid = pid;
    child.kill = vi.fn();
    child.stdin = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      end: vi.fn(),
    });
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mockSpawn.mockReset();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.mocked(findAuggiePathAsync).mockResolvedValue('/usr/local/bin/auggie');
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('rejects with spawn error and does not fire timeout afterwards', async () => {
    const fakeChild = createFakeChild(0);
    // Simulate spawn emitting error synchronously after creation
    mockSpawn.mockImplementation(() => {
      // Defer the error to next microtick so the promise constructor finishes
      Promise.resolve().then(() => fakeChild.emit('error', new Error('spawn ENOENT')));
      return fakeChild;
    });

    const promise = executeAuggieCommand('session stats', { stdin: 'data', timeout: 5000 });
    const caught = promise.catch((e: Error) => e);

    // Let findAuggiePathAsync resolve and the spawn error emit
    await vi.advanceTimersByTimeAsync(0);

    // The promise should have rejected with the spawn error
    const error = await caught;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('spawn ENOENT');

    // Advance well past the timeout — should NOT cause taskkill spawn
    await vi.advanceTimersByTimeAsync(10000);

    // Only 1 spawn call (the auggie child), no taskkill
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    // child.kill should NOT have been called by the timeout
    expect(fakeChild.kill).not.toHaveBeenCalled();
  });

  it('promise settles only once even if close fires after error', async () => {
    const fakeChild = createFakeChild(12345);
    mockSpawn.mockReturnValue(fakeChild);

    const promise = executeAuggieCommand('session stats', { stdin: 'data', timeout: 5000 });
    // Attach catch handler early to prevent unhandled rejection warning
    const caught = promise.catch((e: Error) => e);

    // Let findAuggiePathAsync resolve
    await vi.advanceTimersByTimeAsync(0);

    // Emit error first, then close
    fakeChild.emit('error', new Error('spawn EACCES'));
    fakeChild.emit('close', 1);

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(10000);

    // Promise should reject with the spawn error (first rejection wins)
    const error = await caught;
    expect((error as Error).message).toBe('spawn EACCES');
  });
});