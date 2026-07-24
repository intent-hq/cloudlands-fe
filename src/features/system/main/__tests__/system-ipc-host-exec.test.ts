import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * Wire-contract tests for the arbitrary-execution handlers in
 * `system.ipc.ts`.
 *
 * Per PROTOCOL.md §5.14, `spawn`/`execAsync` in the FE main process are
 * retired in favor of the daemon-side one-shot (`host.exec`) and streaming
 * (`host.execStream`) surfaces. These tests capture the registered
 * `ipcMain.handle` callback for each channel, invoke it with a validated
 * payload, and assert the exact wire request forwarded through the
 * `hostExec` / `hostExecStream` seams. Mock replies mirror the PROTOCOL
 * shape (`{ stdout, stderr, exitCode }` for `host.exec`; an
 * `onStdout`/`onStderr` callback pair plus a `done` promise for
 * `host.execStream`).
 */

type Handler = (...args: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getAllWindows: vi.fn(() => []),
  fromId: vi.fn(),
  appOn: vi.fn(),
  getAppPath: vi.fn(() => '/tmp/app'),
}));

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
    getAppPath: electronMocks.getAppPath,
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'Intent'),
  },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
    fromId: electronMocks.fromId,
    getFocusedWindow: vi.fn(() => undefined),
    fromWebContents: vi.fn(() => undefined),
  },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: electronMocks.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: {},
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));

const { hostExecMock, hostExecStreamMock, spawnMock } = vi.hoisted(() => ({
  hostExecMock: vi.fn(),
  hostExecStreamMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock(import('child_process'), async (importOriginal) => {
  const actual = await importOriginal();
  const patched = { ...actual, spawn: spawnMock };
  return { ...patched, default: patched };
});

vi.mock('../../../../shared/main/host-exec', () => ({
  hostExec: hostExecMock,
}));

vi.mock('../../../../shared/main/host-exec-stream', () => ({
  hostExecStream: hostExecStreamMock,
}));

vi.mock('../../../../shared/main/async-utils', () => ({
  findAuggieAsync: vi.fn(),
  findVSCodeAsync: vi.fn(),
}));

import { EventEmitter } from 'node:events';
import fs from 'node:fs';

import { installIntentCli, setupSystemIPC } from '../system.ipc';
// Globally mocked in src/test-setup.ts — the exec seam installIntentCli's
// osascript fallback goes through.
import { execFileAsync } from '../../../../shared/git/git-env';
import { findVSCodeAsync } from '../../../../shared/main/async-utils';
import {
  JETBRAINS_CHANNELS,
  SYSTEM_CHANNELS,
  VSCODE_CHANNELS,
} from '../../../../shared/ipc/channels';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

const [SHELL_CMD, SHELL_FLAG] =
  process.platform === 'win32' ? ['cmd.exe', '/c'] : ['/bin/sh', '-c'];

beforeEach(() => {
  electronMocks.handle.mockReset();
  hostExecMock.mockReset();
  hostExecStreamMock.mockReset();
  setupSystemIPC();
});

describe('SYSTEM_CHANNELS.EXECUTE_COMMAND → host.exec (shell shim, PROTOCOL.md §5.14)', () => {
  it('wraps the shell-form command via `sh -c` / `cmd /c` and forwards cwd + workspaceId to host.exec', async () => {
    hostExecMock.mockResolvedValue({
      stdout: 'main\n',
      stderr: '',
      exitCode: 0,
    });

    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND);
    const result = (await handler(
      {},
      {
        command: 'git rev-parse --abbrev-ref HEAD',
        cwd: '/ws/repo',
        workspaceId: 'amber-forest',
      },
    )) as { success: boolean; data?: { stdout?: string; code?: number } };

    expect(hostExecMock).toHaveBeenCalledWith(SHELL_CMD, {
      args: [SHELL_FLAG, 'git rev-parse --abbrev-ref HEAD'],
      cwd: '/ws/repo',
      workspaceId: 'amber-forest',
      timeoutMs: 30_000,
    });
    expect(result.success).toBe(true);
    expect(result.data?.stdout).toBe('main\n');
    expect(result.data?.code).toBe(0);
  });

  it('forwards workspaceId alongside cwd so the daemon containment guard runs (monorepo#537)', async () => {
    hostExecMock.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND);
    const result = (await handler(
      {},
      {
        command: 'git commit --amend -m "fix: typo"',
        cwd: '/ws/repo',
        workspaceId: 'amber-forest',
      },
    )) as { success: boolean };

    expect(hostExecMock).toHaveBeenCalledTimes(1);
    expect(hostExecMock.mock.calls[0]).toEqual([
      SHELL_CMD,
      {
        args: [SHELL_FLAG, 'git commit --amend -m "fix: typo"'],
        cwd: '/ws/repo',
        workspaceId: 'amber-forest',
        timeoutMs: 30_000,
      },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects a cwd-only payload at the schema level before the handler runs (monorepo#578)', async () => {
    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND);
    const result = await handler({}, { command: 'git status', cwd: '/ws/repo' });

    expect(hostExecMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request parameters',
        details: [
          {
            code: 'custom',
            message: 'cwd requires workspaceId (PROTOCOL §5.14 containment guard)',
            path: ['workspaceId'],
          },
        ],
      },
    });
  });

  it('treats an empty-string cwd as absent — passes validation and hostExec drops it off the wire', async () => {
    hostExecMock.mockResolvedValue({
      stdout: 'git version 2.44.0\n',
      stderr: '',
      exitCode: 0,
    });

    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND);
    const result = (await handler({}, { command: 'git --version', cwd: '' })) as {
      success: boolean;
    };

    // A blank cwd never arms the cwd⇒workspaceId guard: `hostExec` only
    // forwards non-empty cwd strings, so nothing reaches the daemon's
    // containment check (parity with the web bridge's `if (cwd)`).
    expect(hostExecMock).toHaveBeenCalledWith(SHELL_CMD, {
      args: [SHELL_FLAG, 'git --version'],
      cwd: '',
      timeoutMs: 30_000,
    });
    expect(result.success).toBe(true);
  });

  it('folds a host.exec rejection to the generic failure envelope', async () => {
    hostExecMock.mockRejectedValue(new Error('boom: transport failure'));

    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND);
    const result = await handler(
      {},
      { command: 'git status', cwd: '/ws/repo', workspaceId: 'amber-forest' },
    );

    expect(result).toEqual({
      success: false,
      error: 'Command execution failed',
      data: { stdout: '', stderr: '', code: 1 },
    });
  });

  it('reports non-zero host.exec exits with a scrubbed error and the exit code', async () => {
    hostExecMock.mockResolvedValue({
      stdout: '',
      stderr: 'fatal: not a git repo',
      exitCode: 128,
    });

    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND);
    const result = (await handler({}, { command: 'git status' })) as {
      success: boolean;
      error?: string;
      data?: { code?: number; stderr?: string };
    };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Command execution failed');
    expect(result.data?.code).toBe(128);
    expect(result.data?.stderr).toBe('fatal: not a git repo');
  });
});

describe('SYSTEM_CHANNELS.EXECUTE_COMMAND_STREAMING → host.execStream (shell shim, PROTOCOL.md §5.14)', () => {
  it('opens host.execStream via the shell shim, forwards cwd + workspaceId, and pipes stdout/stderr/close back to the renderer session', async () => {
    let capturedOnStdout: ((chunk: Buffer) => void) | undefined;
    let capturedOnStderr: ((chunk: Buffer) => void) | undefined;
    let resolveDone!: (r: { ok: boolean; exitCode?: number }) => void;
    const donePromise = new Promise<{ ok: boolean; exitCode?: number }>((r) => {
      resolveDone = r;
    });
    hostExecStreamMock.mockImplementation((_cmd: string, opts: {
      onStdout?: (chunk: Buffer) => void;
      onStderr?: (chunk: Buffer) => void;
    }) => {
      capturedOnStdout = opts.onStdout;
      capturedOnStderr = opts.onStderr;
      return Promise.resolve({ requestId: 'req-1', done: donePromise });
    });

    const send = vi.fn();
    const event = { sender: { send } };
    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND_STREAMING);
    const result = (await handler(event, {
      sessionId: 'sess-1',
      command: 'echo hello',
      cwd: '/ws/repo',
      workspaceId: 'amber-forest',
      stdin: 'ignored-payload',
    })) as { success: boolean };

    expect(result.success).toBe(true);
    expect(hostExecStreamMock).toHaveBeenCalledWith(SHELL_CMD, expect.objectContaining({
      args: [SHELL_FLAG, 'echo hello'],
      cwd: '/ws/repo',
      workspaceId: 'amber-forest',
      stdin: 'ignored-payload',
    }));

    capturedOnStdout?.(Buffer.from('out', 'utf8'));
    capturedOnStderr?.(Buffer.from('err', 'utf8'));
    expect(send).toHaveBeenCalledWith('auggie:stream:sess-1', {
      sessionId: 'sess-1',
      type: 'stdout',
      data: 'out',
    });
    expect(send).toHaveBeenCalledWith('auggie:stream:sess-1', {
      sessionId: 'sess-1',
      type: 'stderr',
      data: 'err',
    });

    resolveDone({ ok: true, exitCode: 0 });
    await donePromise;
    // Flush the .then microtask that sends the terminal `close` frame.
    await new Promise((r) => setImmediate(r));
    expect(send).toHaveBeenCalledWith('auggie:stream:sess-1', {
      sessionId: 'sess-1',
      type: 'close',
      code: 0,
    });
  });

  it('rejects a cwd-only payload at the schema level before the handler runs (monorepo#588)', async () => {
    const send = vi.fn();
    const event = { sender: { send } };
    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND_STREAMING);
    const result = await handler(event, {
      sessionId: 'sess-3',
      command: 'git status',
      cwd: '/ws/repo',
    });

    expect(hostExecStreamMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request parameters',
        details: [
          {
            code: 'custom',
            message: 'cwd requires workspaceId (PROTOCOL §5.14 containment guard)',
            path: ['workspaceId'],
          },
        ],
      },
    });
  });

  it('accepts a no-cwd payload without workspaceId — the guard is never armed', async () => {
    const donePromise = Promise.resolve({ ok: true, exitCode: 0 });
    hostExecStreamMock.mockResolvedValue({ requestId: 'req-4', done: donePromise });

    const send = vi.fn();
    const event = { sender: { send } };
    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND_STREAMING);
    const result = (await handler(event, {
      sessionId: 'sess-4',
      command: 'echo hi',
    })) as { success: boolean };

    expect(result.success).toBe(true);
    expect(hostExecStreamMock).toHaveBeenCalledWith(SHELL_CMD, expect.objectContaining({
      args: [SHELL_FLAG, 'echo hi'],
      cwd: undefined,
      workspaceId: undefined,
    }));
  });

  it('treats an empty-string cwd as absent — passes validation without workspaceId', async () => {
    const donePromise = Promise.resolve({ ok: true, exitCode: 0 });
    hostExecStreamMock.mockResolvedValue({ requestId: 'req-5', done: donePromise });

    const send = vi.fn();
    const event = { sender: { send } };
    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND_STREAMING);
    const result = (await handler(event, {
      sessionId: 'sess-5',
      command: 'echo hi',
      cwd: '',
    })) as { success: boolean };

    // A blank cwd never arms the cwd⇒workspaceId guard (same `!params.cwd`
    // blank-as-absent semantics as the non-streaming schema): validation
    // passes and hostExecStream drops the empty cwd off the wire.
    expect(result.success).toBe(true);
    expect(hostExecStreamMock).toHaveBeenCalledWith(SHELL_CMD, expect.objectContaining({
      args: [SHELL_FLAG, 'echo hi'],
      cwd: '',
      workspaceId: undefined,
    }));
  });

  it('surfaces host.execStream rejection as a stderr + null-code close frame', async () => {
    const rejected = Promise.reject(new Error('rpc down'));
    // Prevent unhandled-rejection warnings in test runner.
    rejected.catch(() => {});
    hostExecStreamMock.mockResolvedValue({ requestId: 'req-2', done: rejected });

    const send = vi.fn();
    const event = { sender: { send } };
    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND_STREAMING);
    await handler(event, { sessionId: 'sess-2', command: 'false' });

    await new Promise((r) => setImmediate(r));
    expect(send).toHaveBeenCalledWith('auggie:stream:sess-2', {
      sessionId: 'sess-2',
      type: 'stderr',
      data: 'rpc down',
    });
    expect(send).toHaveBeenCalledWith('auggie:stream:sess-2', {
      sessionId: 'sess-2',
      type: 'close',
      code: null,
    });
  });
});


describe('installIntentCli osascript fallback → host.execStream (monorepo#585)', () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('single-quotes the symlink paths so backticks/$() and single quotes stay literal, and passes the AppleScript via argv (no outer shell)', async () => {
    // Dev-mode path resolution so the mocked app.getAppPath() controls
    // cliScriptPath; the hostile segments survive the '../..' join.
    vi.stubEnv('NODE_ENV', 'development');
    electronMocks.getAppPath.mockReturnValueOnce("/tmp/it`s $(bad)'dir/a/b");

    spies.push(vi.spyOn(fs, 'existsSync').mockReturnValue(true));
    spies.push(
      vi
        .spyOn(fs.promises, 'readlink')
        .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    );
    spies.push(
      vi
        .spyOn(fs.promises, 'symlink')
        .mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' })),
    );
    vi.mocked(execFileAsync).mockClear();

    const result = await installIntentCli();

    // Inner sh layer: both paths POSIX-single-quoted (' → '\''), so the
    // backtick and $() are literal. AppleScript layer: the lone backslash of
    // '\'' doubles to \\ inside the double-quoted `do shell script` string.
    // Outer layer: argv form — the script is a single -e argument, no shell.
    const expectedScript = `do shell script "ln -sf '/tmp/it\`s $(bad)'\\\\''dir/resources/bin/intent' '/usr/local/bin/intent'" with administrator privileges`;
    expect(execFileAsync).toHaveBeenCalledTimes(1);
    expect(execFileAsync).toHaveBeenCalledWith('osascript', ['-e', expectedScript]);
    expect(result.success).toBe(true);
  });
});


const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function restorePlatform() {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
}

// A hostile path: backtick, $(), and a single quote must all stay literal.
const HOSTILE_FILE = "/tmp/it`s $(bad)'dir/src/main.ts";

describe('VSCODE_CHANNELS.OPEN_FILE → execFileAsync argv (monorepo#672)', () => {
  beforeEach(() => {
    vi.mocked(execFileAsync).mockClear();
    vi.mocked(findVSCodeAsync).mockReset();
  });

  afterEach(() => {
    restorePlatform();
  });

  it('passes the hostile file path as a single argv entry through the macOS `open -a` fallback (no shell)', async () => {
    setPlatform('darwin');
    vi.mocked(findVSCodeAsync).mockResolvedValue(null);

    const handler = handlerFor(VSCODE_CHANNELS.OPEN_FILE);
    const result = (await handler({}, { file: HOSTILE_FILE })) as { success: boolean };

    expect(execFileAsync).toHaveBeenCalledTimes(1);
    expect(execFileAsync).toHaveBeenCalledWith('open', [
      '-a',
      'Visual Studio Code',
      '--args',
      '-n',
      '--skip-add-to-recently-opened',
      HOSTILE_FILE,
    ]);
    expect(result.success).toBe(true);
  });

  it('appends `:line` inside the same literal argv entry on the `open -a` fallback', async () => {
    setPlatform('darwin');
    vi.mocked(findVSCodeAsync).mockResolvedValue(null);

    const handler = handlerFor(VSCODE_CHANNELS.OPEN_FILE);
    const result = (await handler({}, { file: HOSTILE_FILE, line: 42 })) as { success: boolean };

    expect(execFileAsync).toHaveBeenCalledTimes(1);
    expect(execFileAsync).toHaveBeenCalledWith('open', [
      '-a',
      'Visual Studio Code',
      '--args',
      '-n',
      '--skip-add-to-recently-opened',
      '--goto',
      `${HOSTILE_FILE}:42`,
    ]);
    expect(result.success).toBe(true);
  });

  it('invokes the resolved `code` binary directly with the hostile path as a literal argv entry', async () => {
    vi.mocked(findVSCodeAsync).mockResolvedValue('/usr/local/bin/code');

    const handler = handlerFor(VSCODE_CHANNELS.OPEN_FILE);
    const result = (await handler({}, { file: HOSTILE_FILE, line: 7 })) as { success: boolean };

    expect(execFileAsync).toHaveBeenCalledTimes(1);
    expect(execFileAsync).toHaveBeenCalledWith('/usr/local/bin/code', [
      '-n',
      '--skip-add-to-recently-opened',
      '--goto',
      `${HOSTILE_FILE}:7`,
    ]);
    expect(result.success).toBe(true);
  });
});

describe('JETBRAINS_CHANNELS.OPEN fallback loop → execFileAsync argv (monorepo#672)', () => {
  beforeEach(() => {
    vi.mocked(execFileAsync).mockClear();
    // Force the primary `spawn('idea', ...)` attempt to fail so the handler
    // reaches the execFileAsync fallback loop.
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.unref = vi.fn();
      queueMicrotask(() => child.emit('error', new Error('ENOENT')));
      return child;
    });
  });

  afterEach(() => {
    spawnMock.mockReset();
  });

  it('tries `idea` first with the hostile path as a single literal argv entry', async () => {
    const handler = handlerFor(JETBRAINS_CHANNELS.OPEN);
    const result = (await handler({}, HOSTILE_FILE)) as { success: boolean };

    expect(execFileAsync).toHaveBeenCalledTimes(1);
    expect(execFileAsync).toHaveBeenCalledWith('idea', [HOSTILE_FILE]);
    expect(result.success).toBe(true);
  });

  it('walks the fallback binaries in order (idea → pycharm → webstorm → …), one argv path each', async () => {
    vi.mocked(execFileAsync)
      .mockRejectedValueOnce(new Error('idea: command not found'))
      .mockRejectedValueOnce(new Error('pycharm: command not found'));

    const handler = handlerFor(JETBRAINS_CHANNELS.OPEN);
    const result = (await handler({}, HOSTILE_FILE)) as { success: boolean };

    expect(vi.mocked(execFileAsync).mock.calls).toEqual([
      ['idea', [HOSTILE_FILE]],
      ['pycharm', [HOSTILE_FILE]],
      ['webstorm', [HOSTILE_FILE]],
    ]);
    expect(result.success).toBe(true);
  });
});
