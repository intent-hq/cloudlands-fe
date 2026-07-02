import {
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
}));

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
    getAppPath: vi.fn(() => '/tmp/app'),
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

const findAuggieAsyncMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/main/async-utils', () => ({
  findAuggieAsync: findAuggieAsyncMock,
  findVSCodeAsync: vi.fn(),
}));

vi.mock('../../../mcp/main/mcp-oauth', () => ({
  clearMcpOAuthTokens: vi.fn(async () => {}),
}));

import { setupSystemIPC } from '../system.ipc';
import { SYSTEM_CHANNELS, USER_MCP_CHANNELS } from '../../../../shared/ipc/channels';

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
  findAuggieAsyncMock.mockReset();
  setupSystemIPC();
});

describe('MCP handlers → host.exec (PROTOCOL.md §5.14)', () => {
  it('MCP_LIST forwards `mcp list --json` argv to host.exec and parses the JSON reply', async () => {
    findAuggieAsyncMock.mockResolvedValue('/usr/local/bin/auggie');
    const server = { name: 'context7', transport: 'stdio', command: 'context7-mcp' };
    hostExecMock.mockResolvedValue({
      stdout: JSON.stringify([server]),
      stderr: '',
      exitCode: 0,
    });

    const handler = handlerFor(USER_MCP_CHANNELS.MCP_LIST);
    const result = (await handler({}, undefined)) as { success: boolean; data?: unknown };

    expect(hostExecMock).toHaveBeenCalledWith('/usr/local/bin/auggie', {
      args: ['mcp', 'list', '--json'],
      timeoutMs: 30_000,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([server]);
  });

  it('MCP_LIST surfaces stderr when host.exec exits non-zero', async () => {
    findAuggieAsyncMock.mockResolvedValue('/usr/local/bin/auggie');
    hostExecMock.mockResolvedValue({ stdout: '', stderr: 'boom', exitCode: 1 });

    const handler = handlerFor(USER_MCP_CHANNELS.MCP_LIST);
    const result = (await handler({}, undefined)) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('MCP_LIST returns a not-found error without touching host.exec when auggie is missing', async () => {
    findAuggieAsyncMock.mockResolvedValue(null);

    const handler = handlerFor(USER_MCP_CHANNELS.MCP_LIST);
    const result = (await handler({}, undefined)) as { success: boolean; error?: string };

    expect(hostExecMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Auggie CLI not found');
  });

  it('MCP_ADD forwards `mcp add <name> --command <cmd> --replace` argv to host.exec', async () => {
    findAuggieAsyncMock.mockResolvedValue('/usr/local/bin/auggie');
    hostExecMock.mockResolvedValue({ stdout: 'added: my-server', stderr: '', exitCode: 0 });

    const handler = handlerFor(USER_MCP_CHANNELS.MCP_ADD);
    const result = (await handler(
      {},
      { name: 'my-server', transport: 'stdio', command: '/bin/my-mcp' },
    )) as { success: boolean; data?: { message?: string } };

    expect(hostExecMock).toHaveBeenCalledWith('/usr/local/bin/auggie', {
      args: ['mcp', 'add', 'my-server', '--command', '/bin/my-mcp', '--replace'],
      timeoutMs: 60_000,
    });
    expect(result.success).toBe(true);
    expect(result.data?.message).toBe('added: my-server');
  });

  it('MCP_ADD forwards HTTP transport flags (`-t http -u <url> --header k:v --replace`) via host.exec', async () => {
    findAuggieAsyncMock.mockResolvedValue('/usr/local/bin/auggie');
    hostExecMock.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

    const handler = handlerFor(USER_MCP_CHANNELS.MCP_ADD);
    await handler(
      {},
      {
        name: 'remote',
        transport: 'http',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer abc' },
      },
    );

    expect(hostExecMock).toHaveBeenCalledWith('/usr/local/bin/auggie', {
      args: [
        'mcp',
        'add',
        'remote',
        '-t',
        'http',
        '-u',
        'https://example.test/mcp',
        '--header',
        'Authorization:Bearer abc',
        '--replace',
      ],
      timeoutMs: 60_000,
    });
  });

  it('MCP_REMOVE forwards `mcp remove <name>` argv to host.exec', async () => {
    findAuggieAsyncMock.mockResolvedValue('/usr/local/bin/auggie');
    hostExecMock.mockResolvedValue({ stdout: 'removed', stderr: '', exitCode: 0 });

    const handler = handlerFor(USER_MCP_CHANNELS.MCP_REMOVE);
    const result = (await handler({}, { name: 'my-server' })) as {
      success: boolean;
      data?: { message?: string };
    };

    expect(hostExecMock).toHaveBeenCalledWith('/usr/local/bin/auggie', {
      args: ['mcp', 'remove', 'my-server'],
      timeoutMs: 30_000,
    });
    expect(result.success).toBe(true);
    expect(result.data?.message).toBe('removed');
  });
});

describe('SYSTEM_CHANNELS.EXECUTE_COMMAND → host.exec (shell shim, PROTOCOL.md §5.14)', () => {
  it('wraps the shell-form command via `sh -c` / `cmd /c` and forwards cwd to host.exec', async () => {
    hostExecMock.mockResolvedValue({
      stdout: 'main\n',
      stderr: '',
      exitCode: 0,
    });

    const handler = handlerFor(SYSTEM_CHANNELS.EXECUTE_COMMAND);
    const result = (await handler(
      {},
      { command: 'git rev-parse --abbrev-ref HEAD', cwd: '/ws/repo' },
    )) as { success: boolean; data?: { stdout?: string; code?: number } };

    expect(hostExecMock).toHaveBeenCalledWith(SHELL_CMD, {
      args: [SHELL_FLAG, 'git rev-parse --abbrev-ref HEAD'],
      cwd: '/ws/repo',
      timeoutMs: 30_000,
    });
    expect(result.success).toBe(true);
    expect(result.data?.stdout).toBe('main\n');
    expect(result.data?.code).toBe(0);
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
