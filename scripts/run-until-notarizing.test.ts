// @vitest-environment node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MARKER_ENV,
  STALL_EXIT_CODE,
  parseArguments,
  runUntilNotarizing,
} from './run-until-notarizing.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-until-notarizing.mjs');
const dirs: string[] = [];
const readyFiles: string[] = [];

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'run-until-notarizing-test-'));
  dirs.push(dir);
  return dir;
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Liveness wait for an external process event; not a timing assertion.
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 1_500; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition not met');
}

/**
 * A fake packaging command, driven by files rather than timers so no test depends
 * on scheduling. At start it optionally writes the notarization marker and spawns a
 * long-lived grandchild, which writes `ready` with its own pid. It exits with
 * `code` once `release` exists, or never when no release file is given.
 */
function fakeBuild(
  dir: string,
  opts: {
    mark?: boolean;
    code?: number;
    release?: boolean;
    ignoreTerm?: boolean;
    grandchildIgnoresTerm?: boolean;
  },
) {
  readyFiles.push(path.join(dir, 'ready'));
  const files = {
    ready: path.join(dir, 'ready'),
    release: opts.release ? path.join(dir, 'release') : null,
  };
  const source = `
    const fs = require('node:fs');
    const { spawn } = require('node:child_process');
    const o = ${JSON.stringify({ ...opts, ...files })};
    if (o.ignoreTerm) process.on('SIGTERM', () => {});
    if (o.mark) fs.writeFileSync(process.env.${MARKER_ENV}, 'marked\\n');
    // The grandchild reports ready itself, after installing any signal handler.
    const body =
      (o.grandchildIgnoresTerm ? "process.on('SIGTERM', () => {});" : '') +
      'require("node:fs").writeFileSync(' + JSON.stringify(o.ready) + ', String(process.pid));' +
      'setInterval(() => {}, 1000)';
    spawn(process.execPath, ['-e', body], { stdio: 'ignore' });
    setInterval(() => {
      if (o.release && fs.existsSync(o.release)) process.exit(o.code ?? 0);
    }, 20);
  `;
  return { command: process.execPath, args: ['-e', source], ...files };
}

function manualDeadline() {
  let fire: (() => void) | null = null;
  let armedMs: number | null = null;
  return {
    armDeadline: (callback: () => void, ms: number) => {
      fire = callback;
      armedMs = ms;
      return () => {
        fire = null;
      };
    },
    fire: () => fire?.(),
    get armedMs() {
      return armedMs;
    },
  };
}

function start(
  build: { command: string; args: string[] },
  deadline = manualDeadline(),
  overrides: Partial<Parameters<typeof runUntilNotarizing>[0]> = {},
) {
  const lines: string[] = [];
  const result = runUntilNotarizing({
    command: build.command,
    args: build.args,
    budgetMs: 30 * 60_000,
    graceMs: 200,
    log: (line: string) => lines.push(line),
    stdio: 'ignore',
    armDeadline: deadline.armDeadline,
    ...overrides,
  });
  return { result, lines, deadline };
}

const pidOf = (ready: string) => Number(readFileSync(ready, 'utf8'));
const hasPid = (ready: string) => existsSync(ready) && readFileSync(ready, 'utf8') !== '';

afterEach(() => {
  // Builds that exit normally leave their grandchild running; reap it.
  for (const ready of readyFiles.splice(0)) {
    if (!hasPid(ready)) continue;
    try {
      process.kill(pidOf(ready), 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('runUntilNotarizing', () => {
  it('passes the exit code through when the command finishes before the deadline', async () => {
    const build = fakeBuild(scratch(), { release: true, code: 3 });
    const { result, lines, deadline } = start(build);
    expect(deadline.armedMs).toBe(30 * 60_000);
    await waitFor(() => hasPid(build.ready));
    writeFileSync(build.release!, '');
    await expect(result).resolves.toBe(3);
    const out = lines.join('\n');
    expect(out).not.toContain('::error');
    expect(out).toMatch(/within 30 min/);
    expect(out).toMatch(/notarization never started/i);
  });

  it('never stops a command that started notarization before the deadline', async () => {
    const build = fakeBuild(scratch(), { mark: true, release: true, code: 0 });
    const { result, lines, deadline } = start(build);
    await waitFor(() => hasPid(build.ready));
    deadline.fire();
    expect(alive(pidOf(build.ready))).toBe(true);
    writeFileSync(build.release!, '');
    await expect(result).resolves.toBe(0);
    expect(lines.join('\n')).toMatch(/notarization started in time \(marked\)/i);
    expect(lines.join('\n')).not.toContain('::error');
  });

  it('reports when notarization started for a build that finishes before the deadline', async () => {
    const build = fakeBuild(scratch(), { mark: true, release: true, code: 0 });
    const { result, lines } = start(build);
    await waitFor(() => hasPid(build.ready));
    writeFileSync(build.release!, '');
    await expect(result).resolves.toBe(0);
    expect(lines.join('\n')).toMatch(/notarization started at marked\./i);
  });

  it('passes a later failure through after notarization started', async () => {
    const build = fakeBuild(scratch(), { mark: true, release: true, code: 7 });
    const { result, deadline } = start(build);
    await waitFor(() => hasPid(build.ready));
    deadline.fire();
    writeFileSync(build.release!, '');
    await expect(result).resolves.toBe(7);
  });

  it('stops the whole process group when notarization has not started by the deadline', async () => {
    const build = fakeBuild(scratch(), {});
    const { result, lines, deadline } = start(build);
    await waitFor(() => hasPid(build.ready));
    deadline.fire();
    await expect(result).resolves.toBe(STALL_EXIT_CODE);
    const out = lines.join('\n');
    expect(out).toMatch(/^::error title=macOS packaging stalled::/m);
    expect(out).toMatch(/after 30 min/);
    await waitFor(() => !alive(pidOf(build.ready)));
  });

  it('escalates to SIGKILL when the command ignores SIGTERM', async () => {
    const build = fakeBuild(scratch(), { ignoreTerm: true });
    const { result, deadline } = start(build);
    await waitFor(() => hasPid(build.ready));
    deadline.fire();
    await expect(result).resolves.toBe(STALL_EXIT_CODE);
    await waitFor(() => !alive(pidOf(build.ready)));
  });

  it('kills a straggler that ignores SIGTERM after the main process has exited', async () => {
    const build = fakeBuild(scratch(), { grandchildIgnoresTerm: true });
    // A grace period far longer than the wait below: only the exit sweep can kill it.
    const { result, deadline } = start(build, manualDeadline(), { graceMs: 10 * 60_000 });
    await waitFor(() => hasPid(build.ready));
    deadline.fire();
    await expect(result).resolves.toBe(STALL_EXIT_CODE);
    await waitFor(() => !alive(pidOf(build.ready)));
  });

  it('gives the command a fresh marker path and removes it afterwards', async () => {
    const out = path.join(scratch(), 'env.txt');
    const source = `require('node:fs').writeFileSync(${JSON.stringify(out)}, process.env.${MARKER_ENV} || '')`;
    const { result } = start({ command: process.execPath, args: ['-e', source] });
    await expect(result).resolves.toBe(0);
    const marker = readFileSync(out, 'utf8');
    expect(marker).not.toBe('');
    expect(existsSync(path.dirname(marker))).toBe(false);
  });

  it('reports a command that cannot be started as a failure', async () => {
    const { result, lines } = start({ command: path.join(scratch(), 'missing-binary'), args: [] });
    await expect(result).resolves.toBe(1);
    expect(lines.join('\n')).toMatch(/^::error title=macOS packaging failed to start::/m);
  });
});

describe('parseArguments', () => {
  it('reads the budget and the command after --', () => {
    expect(parseArguments(['--minutes', '30', '--', 'pnpm', 'run', 'dist:mac', '--arm64'])).toEqual(
      {
        minutes: 30,
        command: 'pnpm',
        args: ['run', 'dist:mac', '--arm64'],
      },
    );
  });

  it.each([
    [[]],
    [['--minutes', '30']],
    [['--minutes', '30', '--']],
    [['--', 'pnpm']],
    [['--minutes', '0', '--', 'pnpm']],
    [['--minutes', '-5', '--', 'pnpm']],
    [['--minutes', 'soon', '--', 'pnpm']],
    [['--minutes', '30', 'pnpm']],
    [['--bogus', '--minutes', '30', '--', 'pnpm']],
  ])('rejects %j', (argv) => {
    expect(() => parseArguments(argv)).toThrow(/usage/);
  });
});

describe('command line', () => {
  it('forwards SIGTERM to the process group so a cancelled job leaves nothing behind', async () => {
    const build = fakeBuild(scratch(), {});
    const wrapper = spawn(
      process.execPath,
      [SCRIPT, '--minutes', '30', '--', build.command, ...build.args],
      { stdio: 'ignore' },
    );
    await waitFor(() => hasPid(build.ready));
    const exited = new Promise<number | null>((resolve) =>
      wrapper.on('exit', (code) => resolve(code)),
    );
    wrapper.kill('SIGTERM');
    expect(await exited).not.toBe(0);
    await waitFor(() => !alive(pidOf(build.ready)));
  });

  it('exits 2 with a usage message on bad arguments', async () => {
    const child = spawn(process.execPath, [SCRIPT, '--minutes', 'x'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const code = await new Promise((resolve) => child.on('exit', resolve));
    expect(code).toBe(2);
    expect(stderr).toMatch(/usage/i);
  });
});
