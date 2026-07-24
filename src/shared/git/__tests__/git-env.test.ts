import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for git-env's exec helpers.
 *
 * Per PROTOCOL.md §5.14 the git exec chokepoint routes through the daemon's
 * `host.execStream` seam (with stdout/stderr frame accumulation). These tests
 * assert the argv / shell-form shape sent on the wire, the computed gitEnv is
 * forwarded, and that the legacy `promisify(exec)` contract is reconstructed
 * (resolve `{ stdout, stderr }` on exit 0; throw with numeric `.code` /
 * `.stdout` / `.stderr` on non-zero exit, `.killed` on timeout).
 */

const { execStreamMock, streamState } = vi.hoisted(() => ({
  execStreamMock: vi.fn(),
  streamState: {
    stdout: '',
    stderr: '',
    result: { ok: true, exitCode: 0 } as {
      ok: boolean;
      exitCode?: number;
      timedOut?: boolean;
    },
  },
}));

vi.mock('../../main/host-exec-stream', () => ({ hostExecStream: execStreamMock }));
vi.mock('../../main/find-binary', () => ({ getEnhancedPath: () => '/usr/bin:/bin' }));

// git-env is globally mocked in test-setup (resolve alias + vi.mock); load the
// real module via importActual so we exercise the daemon-routing implementation.
type ExecFn = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;
type ShellFn = (
  command: string,
  options?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

const gitEnv = (await vi.importActual('../git-env')) as {
  execAsync: ShellFn;
  execFileAsync: ExecFn;
};

function lastCall(): { command: string; options: Record<string, unknown> } {
  const call = execStreamMock.mock.calls[execStreamMock.mock.calls.length - 1];
  return { command: call[0] as string, options: call[1] as Record<string, unknown> };
}

describe('git-env exec helpers (host.execStream)', () => {
  beforeEach(() => {
    execStreamMock.mockReset();
    streamState.stdout = '';
    streamState.stderr = '';
    streamState.result = { ok: true, exitCode: 0 };
    execStreamMock.mockImplementation(
      async (
        _command: string,
        options: {
          onStdout?: (b: Buffer) => void;
          onStderr?: (b: Buffer) => void;
        },
      ) => {
        if (streamState.stdout && options.onStdout) {
          options.onStdout(Buffer.from(streamState.stdout, 'utf-8'));
        }
        if (streamState.stderr && options.onStderr) {
          options.onStderr(Buffer.from(streamState.stderr, 'utf-8'));
        }
        return {
          requestId: 'req-1',
          done: Promise.resolve(streamState.result),
          writeStdin: vi.fn(),
          writeStdinBase64: vi.fn(),
          endStdin: vi.fn(),
          cancel: vi.fn(),
        };
      },
    );
  });

  it('execFileAsync forwards argv, cwd, timeoutMs and gitEnv; returns accumulated output', async () => {
    streamState.stdout = 'clean\n';
    const result = await gitEnv.execFileAsync('git', ['status', '--porcelain'], {
      cwd: '/repo',
      timeout: 5000,
    });

    const { command, options } = lastCall();
    expect(command).toBe('git');
    expect(options.args).toEqual(['status', '--porcelain']);
    expect(options.cwd).toBe('/repo');
    expect(options.timeoutMs).toBe(5000);
    expect((options.env as Record<string, string>).GIT_TERMINAL_PROMPT).toBe('0');
    expect(result).toEqual({ stdout: 'clean\n', stderr: '' });
  });

  it('execAsync wraps shell-form commands via the host shell shim', async () => {
    streamState.stdout = 'out';
    await gitEnv.execAsync('git log --oneline', { cwd: '/repo' });

    const { command, options } = lastCall();
    const expectedShell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const expectedFlag = process.platform === 'win32' ? '/c' : '-c';
    expect(command).toBe(expectedShell);
    expect(options.args).toEqual([expectedFlag, 'git log --oneline']);
  });

  it('throws with numeric .code, .stdout and .stderr on non-zero exit', async () => {
    streamState.stdout = 'partial';
    streamState.stderr = 'fatal: not a git repository';
    streamState.result = { ok: false, exitCode: 128 };

    await expect(gitEnv.execFileAsync('git', ['status'])).rejects.toMatchObject({
      code: 128,
      stdout: 'partial',
      stderr: 'fatal: not a git repository',
    });
  });

  it('throws with .killed on timeout (daemon group-reap)', async () => {
    streamState.result = { ok: false, timedOut: true };

    await expect(
      gitEnv.execFileAsync('git', ['fetch'], { timeout: 10 }),
    ).rejects.toMatchObject({ killed: true });
  });
});
