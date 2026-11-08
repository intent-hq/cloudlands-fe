// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandTimeoutError, execBounded, retryTimeouts } from './bounded-exec.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A node command that starts a grandchild (recording its pid) and then hangs. */
function hangingCommand({ ignoreTerm = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bounded-exec-test-'));
  dirs.push(dir);
  const pidFile = path.join(dir, 'grandchild');
  const grandchild =
    (ignoreTerm ? "process.on('SIGTERM', () => {});" : '') + 'setInterval(() => {}, 1000)';
  const source = `
    const { spawn } = require('node:child_process');
    ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' });
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
    setInterval(() => {}, 1000);
  `;
  return {
    args: ['-e', source],
    grandchild: () => Number(readFileSync(pidFile, 'utf8')),
    started: () => existsSync(pidFile),
  };
}

describe('execBounded', () => {
  it('resolves when the command exits 0', async () => {
    await expect(
      execBounded(process.execPath, ['-e', ''], { timeoutMs: 10_000, stdio: 'ignore' }),
    ).resolves.toBeUndefined();
  });

  it('rejects a non-zero exit without calling it a timeout', async () => {
    const run = execBounded(process.execPath, ['-e', 'process.exit(3)'], {
      timeoutMs: 10_000,
      stdio: 'ignore',
      label: 'fake tool',
    });
    await expect(run).rejects.toThrow('fake tool exited with code 3');
    await expect(run).rejects.not.toBeInstanceOf(CommandTimeoutError);
  });

  it('stops a hung command and its whole process tree at the deadline', async () => {
    const cmd = hangingCommand();
    const run = execBounded(process.execPath, cmd.args, {
      timeoutMs: 500,
      graceMs: 2_000,
      stdio: 'ignore',
      label: 'fake tool',
    });
    await expect(run).rejects.toBeInstanceOf(CommandTimeoutError);
    await expect(run).rejects.toThrow('fake tool did not finish within 1 s and was stopped');
    expect(alive(cmd.grandchild())).toBe(false);
  });

  it('SIGKILLs a tree that ignores SIGTERM once the grace period ends', async () => {
    const cmd = hangingCommand({ ignoreTerm: true });
    const run = execBounded(process.execPath, cmd.args, {
      timeoutMs: 500,
      graceMs: 300,
      stdio: 'ignore',
    });
    await expect(run).rejects.toBeInstanceOf(CommandTimeoutError);
    expect(alive(cmd.grandchild())).toBe(false);
  });

  it('rejects a command that cannot be started', async () => {
    await expect(
      execBounded('/nonexistent/tool', [], { timeoutMs: 1_000, stdio: 'ignore' }),
    ).rejects.toThrow(/ENOENT/);
  });
});

describe('retryTimeouts', () => {
  it('retries timed-out attempts up to the limit, then rethrows', async () => {
    const retries: number[] = [];
    let calls = 0;
    await expect(
      retryTimeouts(
        async () => {
          calls++;
          throw new CommandTimeoutError('tool', 1_000);
        },
        { attempts: 3, onRetry: (_error, n) => retries.push(n) },
      ),
    ).rejects.toBeInstanceOf(CommandTimeoutError);
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it('returns the first successful attempt', async () => {
    await expect(
      retryTimeouts(
        async (n) => {
          if (n < 2) throw new CommandTimeoutError('tool', 1_000);
          return `attempt ${n}`;
        },
        { attempts: 3 },
      ),
    ).resolves.toBe('attempt 2');
  });

  it('does not retry a real failure', async () => {
    let calls = 0;
    await expect(
      retryTimeouts(
        async () => {
          calls++;
          throw new Error('bad icon');
        },
        { attempts: 3 },
      ),
    ).rejects.toThrow('bad icon');
    expect(calls).toBe(1);
  });
});
