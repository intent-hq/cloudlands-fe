import { EventEmitter } from 'events';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * Regression tests for monorepo#672: IPC-provided file paths in the VSCode
 * OPEN_FILE and JetBrains OPEN fallbacks in `system.ipc.ts` must never be
 * interpolated into a shell command string. A path containing backticks or
 * `$(...)` has to reach the executable as a literal argv element via
 * `execFileAsync` / `spawn` — never through the shell-form `execAsync`.
 */

type Handler = (...args: unknown[]) => unknown;

const TRICKY_PATH = '/tmp/repo `touch /tmp/pwned`/$(whoami)/file name.ts';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  appOn: vi.fn(),
}));

const { mockSpawn, mockExecAsync, mockExecFileAsync, mockFindVSCodeAsync } =
  vi.hoisted(() => ({
    mockSpawn: vi.fn(),
    mockExecAsync: vi.fn(),
    mockExecFileAsync: vi.fn(),
    mockFindVSCodeAsync: vi.fn(),
  }));

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
    getAppPath: vi.fn(() => '/tmp/app'),
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'Intent'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromId: vi.fn(),
    getFocusedWindow: vi.fn(() => undefined),
    fromWebContents: vi.fn(() => undefined),
  },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: electronMocks.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: { openExternal: vi.fn() },
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: vi.fn() }),
}));

vi.mock(import('child_process'), async (importOriginal) => {
  const actual = await importOriginal();
  const patched = { ...actual, spawn: mockSpawn };
  return { ...patched, default: patched };
});

vi.mock('../../../../shared/git/git-env', () => ({
  execAsync: mockExecAsync,
  execFileAsync: mockExecFileAsync,
}));

vi.mock('../../../../shared/main/host-exec', () => ({
  hostExec: vi.fn(),
}));

vi.mock('../../../../shared/main/host-exec-stream', () => ({
  hostExecStream: vi.fn(),
}));

vi.mock('../../../../shared/main/async-utils', () => ({
  findAuggieAsync: vi.fn(),
  findVSCodeAsync: mockFindVSCodeAsync,
}));

import { setupSystemIPC } from '../system.ipc';
import {
  JETBRAINS_CHANNELS,
  VSCODE_CHANNELS,
} from '../../../../shared/ipc/channels';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

function createFailingChild() {
  const child = new EventEmitter() as any;
  child.unref = vi.fn();
  queueMicrotask(() => child.emit('error', new Error('spawn idea ENOENT')));
  return child;
}

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

beforeEach(() => {
  electronMocks.handle.mockReset();
  mockSpawn.mockReset();
  mockExecAsync.mockReset();
  mockExecFileAsync.mockReset();
  mockFindVSCodeAsync.mockReset();
  setupSystemIPC();
});

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
});

describe('VSCODE_CHANNELS.OPEN_FILE — no shell interpolation of the file path (monorepo#672)', () => {
  it('passes the file path (with line) as a literal argv element to the resolved code binary', async () => {
    mockFindVSCodeAsync.mockResolvedValue('/usr/local/bin/code');
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const handler = handlerFor(VSCODE_CHANNELS.OPEN_FILE);
    const result = (await handler({}, { file: TRICKY_PATH, line: 12 })) as {
      success: boolean;
    };

    expect(mockExecFileAsync).toHaveBeenCalledWith('/usr/local/bin/code', [
      '-n',
      '--skip-add-to-recently-opened',
      '--goto',
      `${TRICKY_PATH}:12`,
    ]);
    expect(mockExecAsync).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('passes the file path (no line) as a literal argv element to the resolved code binary', async () => {
    mockFindVSCodeAsync.mockResolvedValue('/usr/local/bin/code');
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const handler = handlerFor(VSCODE_CHANNELS.OPEN_FILE);
    const result = (await handler({}, { file: TRICKY_PATH })) as { success: boolean };

    expect(mockExecFileAsync).toHaveBeenCalledWith('/usr/local/bin/code', [
      '-n',
      '--skip-add-to-recently-opened',
      TRICKY_PATH,
    ]);
    expect(mockExecAsync).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('uses argv-style `open -a` on macOS when the code binary is not found', async () => {
    setPlatform('darwin');
    mockFindVSCodeAsync.mockResolvedValue(null);
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const handler = handlerFor(VSCODE_CHANNELS.OPEN_FILE);
    const result = (await handler({}, { file: TRICKY_PATH, line: 3 })) as {
      success: boolean;
    };

    expect(mockExecFileAsync).toHaveBeenCalledWith('open', [
      '-a',
      'Visual Studio Code',
      '--args',
      '-n',
      '--skip-add-to-recently-opened',
      '--goto',
      `${TRICKY_PATH}:3`,
    ]);
    expect(mockExecAsync).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('uses argv-style `open -a` on macOS without a goto argument when no line is given', async () => {
    setPlatform('darwin');
    mockFindVSCodeAsync.mockResolvedValue(null);
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const handler = handlerFor(VSCODE_CHANNELS.OPEN_FILE);
    const result = (await handler({}, { file: TRICKY_PATH })) as { success: boolean };

    expect(mockExecFileAsync).toHaveBeenCalledWith('open', [
      '-a',
      'Visual Studio Code',
      '--args',
      '-n',
      '--skip-add-to-recently-opened',
      TRICKY_PATH,
    ]);
    expect(mockExecAsync).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe('JETBRAINS_CHANNELS.OPEN — fallback loop uses argv, not shell strings (monorepo#672)', () => {
  it('spawns `idea` with the path as a literal argv element on the primary path', async () => {
    const child = new EventEmitter() as any;
    child.unref = vi.fn();
    mockSpawn.mockReturnValue(child);

    const handler = handlerFor(JETBRAINS_CHANNELS.OPEN);
    const result = (await handler({}, TRICKY_PATH)) as { success: boolean };

    expect(mockSpawn).toHaveBeenCalledWith('idea', [TRICKY_PATH], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    expect(result.success).toBe(true);
    expect(child.unref).toHaveBeenCalled();
  });

  it('falls back through JetBrains commands with the path as a literal argv element', async () => {
    mockSpawn.mockImplementation(() => createFailingChild());
    mockExecFileAsync
      .mockRejectedValueOnce(new Error('idea not found'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const handler = handlerFor(JETBRAINS_CHANNELS.OPEN);
    const result = (await handler({}, TRICKY_PATH)) as { success: boolean };

    expect(mockExecFileAsync).toHaveBeenNthCalledWith(1, 'idea', [TRICKY_PATH]);
    expect(mockExecFileAsync).toHaveBeenNthCalledWith(2, 'pycharm', [TRICKY_PATH]);
    expect(mockExecAsync).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('reports failure after all fallback commands fail — without ever using the shell', async () => {
    mockSpawn.mockImplementation(() => createFailingChild());
    mockExecFileAsync.mockRejectedValue(new Error('not found'));

    const handler = handlerFor(JETBRAINS_CHANNELS.OPEN);
    const result = (await handler({}, TRICKY_PATH)) as {
      success: boolean;
      error?: string;
    };

    expect(mockExecFileAsync).toHaveBeenCalledTimes(5);
    expect(
      mockExecFileAsync.mock.calls.map(([cmd, args]) => [cmd, args]),
    ).toEqual([
      ['idea', [TRICKY_PATH]],
      ['pycharm', [TRICKY_PATH]],
      ['webstorm', [TRICKY_PATH]],
      ['clion', [TRICKY_PATH]],
      ['goland', [TRICKY_PATH]],
    ]);
    expect(mockExecAsync).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('JetBrains');
  });
});
