// @vitest-environment node
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUSY_LOOP_SOURCE,
  DEFAULT_BUSY,
  VITEST_CONFIG,
  parseAllowedCpuList,
  parseArgs,
  parseCpuList,
  pickBusyCount,
  pickCore,
  planRun,
} from './vitest-loaded.mjs';

describe('parseCpuList', () => {
  it('expands ranges and singletons into sorted unique cores', () => {
    expect(parseCpuList('0-31\n')).toHaveLength(32);
    expect(parseCpuList('0-3,5,7-8')).toEqual([0, 1, 2, 3, 5, 7, 8]);
    expect(parseCpuList('4,2,2-3')).toEqual([2, 3, 4]);
    expect(parseCpuList('')).toEqual([]);
  });

  it('rejects entries it cannot read', () => {
    expect(() => parseCpuList('0-x')).toThrow(/Unrecognised cpu list entry/);
  });
});

describe('parseAllowedCpuList', () => {
  const status = [
    'Name:\tnode',
    'Cpus_allowed:\tff',
    'Cpus_allowed_list:\t4-7,9',
    'Mems_allowed_list:\t0',
    '',
  ].join('\n');

  it('reads the cpuset this process may run on, not the machine-wide list', () => {
    expect(parseAllowedCpuList(status)).toEqual([4, 5, 6, 7, 9]);
    expect(parseAllowedCpuList('Cpus_allowed_list:\t0-3\n')).toEqual([0, 1, 2, 3]);
  });

  it('returns null when the status text has no allowed list', () => {
    expect(parseAllowedCpuList('Name:\tnode\nCpus_allowed:\tff\n')).toBeNull();
    expect(parseAllowedCpuList('')).toBeNull();
  });

  it.runIf(process.platform === 'linux')('agrees with the kernel about the current process', () => {
    // Independent oracle: the live process can run on every core it reports.
    const live = parseAllowedCpuList(readFileSync('/proc/self/status', 'utf8'));
    expect(live).not.toBeNull();
    expect(live!.length).toBeGreaterThan(0);
    for (const core of live!) expect(core).toBeLessThan(os.cpus().length);
  });
});

describe('pickCore', () => {
  it('defaults to the last usable core', () => {
    expect(pickCore([0, 1, 2, 3], undefined)).toBe(3);
    expect(pickCore([0, 1, 2, 3], '')).toBe(3);
    expect(pickCore([4, 5, 6, 7, 9], undefined)).toBe(9);
  });

  it('honours a usable LOADED_CORE and rejects a disallowed or malformed one', () => {
    expect(pickCore([0, 1, 2, 3], '1')).toBe(1);
    expect(() => pickCore([0, 1, 2, 3], '9')).toThrow(/not a core this process may run on/);
    expect(() => pickCore([0, 1], 'two')).toThrow(/non-negative integer/);
    expect(() => pickCore([0, 1], '-1')).toThrow(/non-negative integer/);
  });

  it('fails when no core is usable rather than pinning to nothing', () => {
    expect(() => pickCore([], undefined)).toThrow(/No usable core/);
  });
});

describe('pickBusyCount', () => {
  it('defaults to three loops and honours LOADED_BUSY', () => {
    expect(pickBusyCount(undefined)).toBe(DEFAULT_BUSY);
    expect(pickBusyCount('')).toBe(DEFAULT_BUSY);
    expect(pickBusyCount('0')).toBe(0);
    expect(pickBusyCount('5')).toBe(5);
    expect(() => pickBusyCount('1.5')).toThrow(/non-negative integer/);
  });
});

describe('parseArgs', () => {
  it('requires a file or filter so a typo cannot run the whole suite pinned', () => {
    expect(() => parseArgs([])).toThrow(/No test file or filter given/);
    expect(() => parseArgs(['--reporter=verbose'])).toThrow(/No test file or filter given/);
    expect(() => parseArgs(['--'])).toThrow(/No test file or filter given/);
  });

  it('does not mistake an option value given as a separate token for a filter', () => {
    expect(() => parseArgs(['--reporter', 'verbose'])).toThrow(/No test file or filter given/);
    expect(() => parseArgs(['--testTimeout', '15000'])).toThrow(/No test file or filter given/);
    expect(() => parseArgs(['-t', 'name'])).toThrow(/No test file or filter given/);
    expect(() => parseArgs(['--', '--reporter', 'verbose'])).toThrow(
      /No test file or filter given/,
    );
  });

  it('accepts a file or name filter alongside options in either form', () => {
    expect(parseArgs(['src/a.test.ts', '--reporter', 'verbose'])).toEqual([
      'src/a.test.ts',
      '--reporter',
      'verbose',
    ]);
    expect(parseArgs(['--testTimeout', '15000', 'src/a.test.ts'])).toEqual([
      '--testTimeout',
      '15000',
      'src/a.test.ts',
    ]);
    expect(parseArgs(['text-rebase', '--testTimeout=15000'])).toEqual([
      'text-rebase',
      '--testTimeout=15000',
    ]);
  });

  it('drops the separators pnpm forwards and keeps vitest flags verbatim', () => {
    expect(parseArgs(['src/a.test.ts'])).toEqual(['src/a.test.ts']);
    expect(parseArgs(['src/a.test.ts', '--', '--reporter=verbose', '-t', 'name'])).toEqual([
      'src/a.test.ts',
      '--reporter=verbose',
      '-t',
      'name',
    ]);
  });
});

describe('planRun', () => {
  const base = {
    execPath: '/usr/bin/node',
    vitestBin: '/repo/node_modules/vitest/vitest.mjs',
    vitestArgs: ['src/a.test.ts', '--reporter=verbose'],
    core: 31,
    busy: 3,
    harnessPid: 4242,
  };

  it('pins the busy loops and a one-worker vitest to the same core', () => {
    const plan = planRun({ ...base, pinned: true });
    expect(plan.busy).toHaveLength(3);
    for (const loop of plan.busy) {
      expect(loop).toEqual({
        executable: 'taskset',
        args: ['-c', '31', '/usr/bin/node', '-e', BUSY_LOOP_SOURCE, '4242'],
      });
    }
    expect(plan.vitest).toEqual({
      executable: 'taskset',
      args: [
        '-c',
        '31',
        '/usr/bin/node',
        '/repo/node_modules/vitest/vitest.mjs',
        'run',
        '--config',
        VITEST_CONFIG,
        '--maxWorkers=1',
        'src/a.test.ts',
        '--reporter=verbose',
      ],
    });
    expect(plan.notice).toMatch(/pinned to core 31 with 3 busy loop/);
  });

  it('runs unpinned with a weaker-reproduction notice when taskset is unavailable', () => {
    const plan = planRun({ ...base, core: undefined, busy: 2, pinned: false });
    expect(plan.busy).toHaveLength(2);
    expect(plan.busy[0]).toEqual({
      executable: '/usr/bin/node',
      args: ['-e', BUSY_LOOP_SOURCE, '4242'],
    });
    expect(plan.vitest.executable).toBe('/usr/bin/node');
    expect(plan.vitest.args).toEqual([
      '/repo/node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      VITEST_CONFIG,
      '--maxWorkers=1',
      'src/a.test.ts',
      '--reporter=verbose',
    ]);
    expect(plan.notice).toMatch(/no taskset/);
    expect(plan.notice).toMatch(/weaker/);
  });

  it('never sets CI in the vitest command line', () => {
    const plan = planRun({ ...base, pinned: true });
    expect(plan.vitest.args.join(' ')).not.toMatch(/\bCI\b/);
  });
});

describe('busy loop lifecycle', () => {
  /** Runs the loop source exactly as the harness does, told `harnessPid`. */
  function spawnLoop(harnessPid: number): ChildProcess {
    return spawn(process.execPath, ['-e', BUSY_LOOP_SOURCE, String(harnessPid)], {
      stdio: 'ignore',
    });
  }

  function exitOf(loop: ChildProcess): Promise<number | null> {
    return new Promise((resolve) => loop.once('exit', (code) => resolve(code)));
  }

  function settle(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('exits on its own when it starts already orphaned from the harness', async () => {
    // A harness SIGKILLed before the loop's startup finished leaves the loop
    // reparented by the time its source runs: its parent is then not the
    // harness pid it was told, which is the situation this reproduces by
    // naming a pid that is not this process. Use a pid that does not exist so
    // it cannot be the adopter either.
    const loop = spawnLoop(2 ** 22 - 1);
    const exit = exitOf(loop);
    await expect(Promise.race([exit, settle(5000).then(() => 'still running')])).resolves.toBe(0);
  });

  it('keeps running while its parent is the harness it was told', async () => {
    const loop = spawnLoop(process.pid);
    const exit = exitOf(loop);
    try {
      await expect(Promise.race([exit, settle(500).then(() => 'still running')])).resolves.toBe(
        'still running',
      );
    } finally {
      loop.kill('SIGKILL');
      await exit;
    }
  });
});

const hasTaskset =
  process.platform === 'linux' &&
  spawnSync('taskset', ['--version'], { stdio: 'ignore' }).status === 0;

describe.runIf(hasTaskset)('harness end to end', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const harness = path.join(root, 'scripts', 'vitest-loaded.mjs');
  // A cheap real suite (not this file: the harness would recurse into itself).
  const cheapFile = 'scripts/check-package-scripts.test.ts';

  /** Live busy loops spawned by the harness with pid `harnessPid`, per `ps`. */
  function loopsOf(harnessPid: number): number {
    const { stdout } = spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
    return stdout
      .split('\n')
      .filter(
        (line) =>
          line.includes('const parent = Number') && line.trimEnd().endsWith(` ${harnessPid}`),
      ).length;
  }

  async function poll(until: () => boolean, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (until()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return until();
  }

  async function runHarness(vitestArgs: string[]) {
    const child = spawn(process.execPath, [harness, ...vitestArgs], {
      cwd: root,
      env: { ...process.env, LOADED_BUSY: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const pid = child.pid!;
    const exited = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    let done = false;
    void exited.then(() => (done = true));
    const sawLoops = await poll(() => done || loopsOf(pid) >= 1, 10_000);
    const code = await exited;
    const loopsGone = await poll(() => loopsOf(pid) === 0, 3_000);
    return { code, stderr, sawLoops, loopsGone, pid };
  }

  it('propagates a passing exit code and leaves no busy loop behind', async () => {
    const run = await runHarness([cheapFile]);
    expect(run.stderr).toMatch(/test:loaded: vitest pinned to core \d+ with 1 busy loop/);
    expect(run.sawLoops).toBe(true);
    expect(run.code).toBe(0);
    expect(run.loopsGone).toBe(true);
  }, 25_000);

  it('propagates a failing exit code and leaves no busy loop behind', async () => {
    const run = await runHarness(['scripts/does-not-exist.test.ts']);
    expect(run.sawLoops).toBe(true);
    expect(run.code).toBe(1);
    expect(run.loopsGone).toBe(true);
  }, 25_000);
});
