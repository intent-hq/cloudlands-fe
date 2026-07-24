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

const { hostExecMock, hostExecStreamMock } = vi.hoisted(() => ({
  hostExecMock: vi.fn(),
  hostExecStreamMock: vi.fn(),
}));

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

import fs from 'node:fs';

import { installIntentCli, setupSystemIPC } from '../system.ipc';
// Globally mocked in src/test-setup.ts — the exec seam installIntentCli's
// osascript fallback goes through.
import { execFileAsync } from '../../../../shared/git/git-env';
import { SYSTEM_CHANNELS } from '../../../../shared/ipc/channels';

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
  it('opens host.execStream via the shell shim and pipes stdout/stderr/close back to the renderer session', async () => {
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
      stdin: 'ignored-payload',
    })) as { success: boolean };

    expect(result.success).toBe(true);
    expect(hostExecStreamMock).toHaveBeenCalledWith(SHELL_CMD, expect.objectContaining({
      args: [SHELL_FLAG, 'echo hello'],
      cwd: '/ws/repo',
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
