// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const leftovers: number[] = [];

// Liveness wait for an external process event; not a timing assertion.
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 1_500; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition not met');
}

/** A deadline the test fires by hand, once the command is known to be running. */
function manualDeadline() {
  let fire: (() => void) | null = null;
  return {
    armDeadline: (callback: () => void) => {
      fire = callback;
      return () => {
        fire = null;
      };
    },
    fire: () => fire?.(),
  };
}
import { CommandTimeoutError, execBounded, retryTimeouts } from './bounded-exec.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const pid of leftovers.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
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
  const leaderFile = path.join(dir, 'leader');
  const source = `
    require('node:fs').writeFileSync(${JSON.stringify(leaderFile)}, String(process.pid));
    const { spawn } = require('node:child_process');
    ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' });
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
    setInterval(() => {}, 1000);
  `;
  return {
    args: ['-e', source],
    grandchild: () => Number(readFileSync(pidFile, 'utf8')),
    leader: () => Number(readFileSync(leaderFile, 'utf8')),
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
    const deadline = manualDeadline();
    const run = execBounded(process.execPath, cmd.args, {
      timeoutMs: 500,
      graceMs: 2_000,
      stdio: 'ignore',
      label: 'fake tool',
      armDeadline: deadline.armDeadline,
    });
    await waitFor(cmd.started);
    deadline.fire();
    await expect(run).rejects.toBeInstanceOf(CommandTimeoutError);
    await expect(run).rejects.toThrow('fake tool did not finish within 1 s and was stopped');
    expect(alive(cmd.grandchild())).toBe(false);
  });

  it('SIGKILLs a tree that ignores SIGTERM once the grace period ends', async () => {
    const cmd = hangingCommand({ ignoreTerm: true });
    const deadline = manualDeadline();
    const run = execBounded(process.execPath, cmd.args, {
      timeoutMs: 500,
      graceMs: 300,
      stdio: 'ignore',
      armDeadline: deadline.armDeadline,
    });
    await waitFor(cmd.started);
    deadline.fire();
    await expect(run).rejects.toBeInstanceOf(CommandTimeoutError);
    expect(alive(cmd.grandchild())).toBe(false);
  });

  it('gives up on a command that outlives SIGKILL so the caller can retry', async () => {
    const cmd = hangingCommand();
    const deadline = manualDeadline();
    const run = execBounded(process.execPath, cmd.args, {
      timeoutMs: 500,
      graceMs: 0,
      abandonMs: 0,
      stdio: 'ignore',
      armDeadline: deadline.armDeadline,
      // Stands in for a process stuck in an uninterruptible wait: no signal lands.
      sendSignal: () => {},
    });
    await waitFor(cmd.started);
    leftovers.push(cmd.leader(), cmd.grandchild());
    deadline.fire();
    await expect(run).rejects.toBeInstanceOf(CommandTimeoutError);
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
