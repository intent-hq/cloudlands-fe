import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Buffer } from 'node:buffer';

/**
 * Wire-contract tests for the `terminal:runCommand` note primitive.
 *
 * Under thin-presenter, arbitrary command execution is daemon-owned: the
 * handler routes the shell-form command through `host.execStream`
 * (PROTOCOL.md §5.14) via a `sh -c` / `cmd /c` shim instead of a local
 * `exec`. These tests capture the registered `ipcMain.handle` callback,
 * invoke it, and assert (1) the exact wire request forwarded to
 * `hostExecStream` and (2) that the existing `terminal:subscribeOutput` /
 * `terminal:killProcess` streamed-output contract is preserved via
 * PROTOCOL-shaped mock stream frames.
 */

type Handler = (...args: unknown[]) => Promise<unknown>;

interface StreamOpts {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  workspaceId?: string;
  signal?: AbortSignal;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
}

const electronMocks = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: electronMocks.handle, removeHandler: electronMocks.removeHandler },
}));

const { hostExecStreamMock } = vi.hoisted(() => ({ hostExecStreamMock: vi.fn() }));
vi.mock('../../../../shared/main/host-exec-stream', () => ({
  hostExecStream: hostExecStreamMock,
}));

const { getWorkspaceMock } = vi.hoisted(() => ({ getWorkspaceMock: vi.fn() }));
vi.mock('../../../workspace/main/workspace.service', () => ({
  workspaceService: { getWorkspace: getWorkspaceMock },
}));

import { setupNotesPrimitivesIPC } from '../notes-primitives.ipc';

const WS_ID = '11111111-1111-4111-8111-111111111111';
const [SHELL_CMD, SHELL_FLAG] =
  process.platform === 'win32' ? ['cmd.exe', '/c'] : ['/bin/sh', '-c'];

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

function stubStream(): { opts: () => StreamOpts; resolveDone: (r: unknown) => void } {
  let captured: StreamOpts = {};
  let resolve!: (r: unknown) => void;
  const done = new Promise((r) => {
    resolve = r;
  });
  hostExecStreamMock.mockImplementation((_cmd: string, o: StreamOpts) => {
    captured = o;
    return Promise.resolve({ requestId: 'req-1', done });
  });
  return { opts: () => captured, resolveDone: resolve };
}

beforeEach(() => {
  electronMocks.handle.mockReset();
  hostExecStreamMock.mockReset();
  getWorkspaceMock.mockReset();
  getWorkspaceMock.mockResolvedValue({ ok: true, data: { worktreePath: '/ws/repo' } });
  setupNotesPrimitivesIPC();
});

describe('terminal:runCommand → host.execStream (PROTOCOL.md §5.14)', () => {
  it('forwards the shell-shimmed command with cwd/env/workspace containment', async () => {
    stubStream();
    const result = (await handlerFor('terminal:runCommand')({}, {
      workspaceId: WS_ID,
      command: 'echo hi',
      env: { FOO: 'bar' },
      timeoutMs: 5000,
    })) as { ok: boolean; data?: { terminalId: number } };

    expect(hostExecStreamMock).toHaveBeenCalledWith(
      SHELL_CMD,
      expect.objectContaining({
        args: [SHELL_FLAG, 'echo hi'],
        cwd: '/ws/repo',
        env: { FOO: 'bar' },
        timeoutMs: 5000,
        workspaceId: WS_ID,
      }),
    );
    expect(result.ok).toBe(true);
    expect(typeof result.data?.terminalId).toBe('number');
  });

  it('buffers-then-streams stdout/stderr and forwards exit via terminal:subscribeOutput', async () => {
    const stream = stubStream();
    const res = (await handlerFor('terminal:runCommand')({}, {
      workspaceId: WS_ID,
      command: 'echo hi',
    })) as { data: { terminalId: number } };
    const terminalId = res.data.terminalId;

    stream.opts().onStdout?.(Buffer.from('early-out', 'utf8'));

    const send = vi.fn();
    await handlerFor('terminal:subscribeOutput')({ sender: { send } }, { terminalId });
    expect(send).toHaveBeenCalledWith(`terminal:output:${terminalId}`, 'early-out');

    stream.opts().onStdout?.(Buffer.from('live-out', 'utf8'));
    stream.opts().onStderr?.(Buffer.from('live-err', 'utf8'));
    expect(send).toHaveBeenCalledWith(`terminal:output:${terminalId}`, 'live-out');
    expect(send).toHaveBeenCalledWith(`terminal:output:${terminalId}`, 'live-err');

    stream.resolveDone({ ok: true, exitCode: 0 });
    await new Promise((r) => setImmediate(r));
    expect(send).toHaveBeenCalledWith(`terminal:exit:${terminalId}`, 0);
  });

  it('honest-degrades to ok:false when host.execStream rejects (no local fallback)', async () => {
    hostExecStreamMock.mockRejectedValue(new Error('rpc down'));
    const res = await handlerFor('terminal:runCommand')({}, { workspaceId: WS_ID, command: 'echo hi' });
    expect(res).toEqual({ ok: false, error: 'rpc down' });
  });

  it('terminal:killProcess cancels the daemon stream via the abort signal', async () => {
    const stream = stubStream();
    const res = (await handlerFor('terminal:runCommand')({}, {
      workspaceId: WS_ID,
      command: 'sleep 100',
    })) as { data: { terminalId: number } };

    expect(stream.opts().signal?.aborted).toBe(false);
    const killRes = await handlerFor('terminal:killProcess')({}, { terminalId: res.data.terminalId });
    expect(stream.opts().signal?.aborted).toBe(true);
    expect(killRes).toEqual({ ok: true });
  });

  it('returns ok:false without touching host.execStream when the workspace is missing', async () => {
    getWorkspaceMock.mockResolvedValue({ ok: false, error: 'nope' });
    const res = await handlerFor('terminal:runCommand')({}, { workspaceId: WS_ID, command: 'echo hi' });
    expect(res).toEqual({ ok: false, error: 'Workspace not found' });
    expect(hostExecStreamMock).not.toHaveBeenCalled();
  });
});
