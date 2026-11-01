// @verify-changed-triggers: .github/workflows/browser-tests.yml
// @vitest-environment node
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  QUARANTINE_FILTER,
  UsageError,
  countsFromReport,
  createProgressTracker,
  formatDuration,
  formatShardLine,
  formatSummary,
  parseFullArgs,
  runFull,
  runStamp,
  shardArgs,
  shardEnv,
  summarizeShard,
  totals,
  usage,
} from './run-ct-full.mjs';
import { ctLockKey, HELD_LOCK_ENV } from './verification-lock.mjs';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ct-full-'));
  dirs.push(dir);
  return dir;
}

function report(stats: Record<string, number>, suites: unknown[] = []) {
  return { config: {}, suites, errors: [], stats: { startTime: '', duration: 1, ...stats } };
}

const failingSuite = {
  title: 'a.ct.spec.ts',
  file: 'a.ct.spec.ts',
  specs: [
    {
      title: 'breaks',
      file: 'a.ct.spec.ts',
      line: 3,
      column: 1,
      tests: [{ status: 'unexpected' }],
    },
    { title: 'wobbles', file: 'a.ct.spec.ts', line: 9, column: 1, tests: [{ status: 'flaky' }] },
    { title: 'holds', file: 'a.ct.spec.ts', line: 12, column: 1, tests: [{ status: 'expected' }] },
  ],
};

class Sink {
  text = '';
  write(chunk: string) {
    this.text += chunk;
    return true;
  }
}

/**
 * A fake launcher: logs its args and the held lock, writes a JSON report
 * unless the shard is listed in FAKE_NO_REPORT, and exits with the code
 * FAKE_EXIT_<shard> (default 0). `FAKE_FAILED` shards report one failure.
 */
function writeFakeLauncher(dir: string) {
  const file = path.join(dir, 'fake-launcher.mjs');
  writeFileSync(
    file,
    `import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const shard = /--shard=(\\d+)\\//.exec(args[0])[1];
console.log('ARGS ' + JSON.stringify(args));
console.error('LOCK ' + process.env.${HELD_LOCK_ENV});
console.log('Running 3 tests using 1 worker');
console.log('  ✓  1 [chromium] › a.ct.spec.ts:1:1 › one (5ms)');
const failed = (process.env.FAKE_FAILED ?? '').split(',').includes(shard);
if (!(process.env.FAKE_NO_REPORT ?? '').split(',').includes(shard)) {
  writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify({
    suites: failed ? [{ title: 'f.ct.spec.ts', file: 'f.ct.spec.ts', specs: [
      { title: 'shard ' + shard + ' breaks', file: 'f.ct.spec.ts', line: 2, column: 3, tests: [{ status: 'unexpected' }] },
    ] }] : [],
    stats: { expected: 2, unexpected: failed ? 1 : 0, flaky: 0, skipped: 1 },
  }));
}
process.exit(Number(process.env['FAKE_EXIT_' + shard] ?? (failed ? 1 : 0)));
`,
  );
  return file;
}

async function runFake(
  argv: string[],
  env: Record<string, string> = {},
  { dir = tempDir() }: { dir?: string } = {},
) {
  const stdout = new Sink();
  const stderr = new Sink();
  const lockCalls: unknown[] = [];
  let released = 0;
  const proc = new EventEmitter();
  const code = await runFull({
    argv: ['--out-dir', path.join(dir, 'run'), '--heartbeat=0', ...argv],
    env: { PATH: process.env.PATH ?? '', ...env },
    cwd: dir,
    launcher: writeFakeLauncher(dir),
    acquireLock: async (opts: unknown) => {
      lockCalls.push(opts);
      return () => {
        released += 1;
      };
    },
    stdout,
    stderr,
    proc,
  });
  const runDir = path.join(dir, 'run');
  const summaryFile = path.join(runDir, 'summary.json');
  const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, 'utf8')) : null;
  const log = (shard: number) =>
    readFileSync(path.join(runDir, `shard-${shard}`, 'output.log'), 'utf8');
  return { code, stdout: stdout.text, stderr: stderr.text, summary, log, lockCalls, released };
}

describe('parseFullArgs', () => {
  it('defaults to four quiet shards with nothing forwarded', () => {
    expect(parseFullArgs([])).toMatchObject({
      shards: 4,
      outDir: null,
      stream: false,
      heartbeatMinutes: 5,
      help: false,
      forwarded: [],
    });
  });

  it('drops the pnpm separator and keeps playwright args in order', () => {
    const parsed = parseFullArgs(['--', '--shards=2', '--list', 'src/a.ct.spec.ts', '--grep', 'x']);
    expect(parsed.shards).toBe(2);
    expect(parsed.forwarded).toEqual(['--list', 'src/a.ct.spec.ts', '--grep', 'x']);
  });

  it('accepts both value spellings for its own options', () => {
    expect(parseFullArgs(['--out-dir', 'o', '--heartbeat', '0', '--stream'])).toMatchObject({
      outDir: 'o',
      heartbeatMinutes: 0,
      stream: true,
    });
    expect(parseFullArgs(['--out-dir=o2']).outDir).toBe('o2');
  });

  it.each([
    [['--shard=1/4'], /--shard is set per shard/],
    [['--reporter', 'dot'], /--reporter is set per shard/],
    [['--output=x'], /--output is set per shard/],
    [['-o', 'x'], /--output is set per shard/],
    [['--shards=0'], /at least 1/],
    [['--shards=two'], /whole number/],
    [['--out-dir'], /expects a value/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseFullArgs(argv)).toThrow(UsageError);
    expect(() => parseFullArgs(argv)).toThrow(message);
  });

  it('recognises help', () => {
    expect(parseFullArgs(['--help']).help).toBe(true);
    expect(parseFullArgs(['--', '-h']).help).toBe(true);
  });
});

describe('per-shard command', () => {
  it('owns shard, reporters and output, and mirrors the CI quarantine filter', () => {
    expect(
      shardArgs({ shard: 2, shards: 4, shardDir: '/r/shard-2', forwarded: ['--list'] }),
    ).toEqual([
      '--shard=2/4',
      '--reporter=list,html,json',
      '--output=/r/shard-2/test-results',
      '--grep-invert',
      '@quarantine\\b',
      '--list',
    ]);
    expect(QUARANTINE_FILTER[1]).toBe('@quarantine\\b');
  });

  it("uses the same quarantine filter as CI's required CT lane", () => {
    const workflow = readFileSync(
      path.join(import.meta.dirname, '..', '.github', 'workflows', 'browser-tests.yml'),
      'utf8',
    );
    const requiredLane = workflow
      .split('\n')
      .filter((line) => line.includes('pnpm run test:ct') && line.includes('--shard='));
    expect(requiredLane).toHaveLength(1);
    const [flag, pattern] = QUARANTINE_FILTER;
    expect(requiredLane[0]).toContain(`${flag} '${pattern}'`);
  });

  it.each([[['--grep-invert', 'slow']], [['--grep-invert=slow']]])(
    'leaves out the quarantine filter when the caller inverts the grep (%j)',
    (forwarded) => {
      const args = shardArgs({ shard: 1, shards: 4, shardDir: '/r', forwarded });
      expect(args).not.toContain('@quarantine\\b');
      expect(args.slice(-forwarded.length)).toEqual(forwarded);
    },
  );

  it('points the reports into the shard folder and passes the held lock', () => {
    const env = shardEnv({
      env: { NODE_OPTIONS: '--x' },
      shardDir: '/r/shard-1',
      lockKey: 'ct-3100',
    });
    expect(env).toEqual({
      NODE_OPTIONS: '--x',
      PLAYWRIGHT_JSON_OUTPUT_FILE: '/r/shard-1/results.json',
      PLAYWRIGHT_HTML_OUTPUT_DIR: '/r/shard-1/html',
      [HELD_LOCK_ENV]: 'ct-3100',
    });
  });
});

describe('summaries', () => {
  it('counts tests from JSON stats, and listed tests for --list', () => {
    expect(countsFromReport(report({ expected: 5, unexpected: 1, flaky: 2, skipped: 3 }))).toEqual({
      passed: 5,
      failed: 1,
      flaky: 2,
      skipped: 3,
    });
    expect(countsFromReport(report({ skipped: 575 }), { listOnly: true })).toEqual({ listed: 575 });
    expect(countsFromReport(null)).toBeNull();
  });

  it('lists failed and flaky cases from the JSON report', () => {
    const result = summarizeShard({
      shard: 1,
      shards: 4,
      exitCode: 1,
      durationMs: 1000,
      report: report({ expected: 1, unexpected: 1, flaky: 1 }, [failingSuite]),
      logText: '',
      logPath: '/r/shard-1/output.log',
    });
    expect(result).toMatchObject({ status: 'fail', casesSource: 'json' });
    expect(result.cases.map((c: { status: string }) => c.status)).toEqual(['failed', 'flaky']);
  });

  it('falls back to the list log summary when the JSON report is missing', () => {
    const logText = [
      '  1 failed',
      '    [chromium] › a.ct.spec.ts:3:1 › breaks',
      '  4 passed (1.0m)',
    ].join('\n');
    const result = summarizeShard({
      shard: 3,
      shards: 4,
      exitCode: 1,
      durationMs: 1,
      report: null,
      logText,
      logPath: 'l',
    });
    expect(result).toMatchObject({ status: 'fail', counts: null, casesSource: 'log' });
    expect(result.note).toMatch(/no JSON report/);
    expect(result.cases).toEqual([
      { status: 'failed', specFile: 'a.ct.spec.ts', title: 'breaks', location: 'a.ct.spec.ts:3:1' },
    ]);
  });

  it('keeps a shard that finished cleanly before a signal as passed', () => {
    const base = { shard: 1, shards: 4, durationMs: 1, report: null, logText: '', logPath: 'l' };
    expect(summarizeShard({ ...base, exitCode: 0, interrupted: true }).status).toBe('pass');
    expect(summarizeShard({ ...base, exitCode: 130, interrupted: true })).toMatchObject({
      status: 'interrupted',
      note: 'stopped by signal',
    });
  });

  it('labels a heap-exhaustion exit as a crash, not a test result', () => {
    const result = summarizeShard({
      shard: 2,
      shards: 4,
      exitCode: 134,
      durationMs: 1,
      report: null,
      logText: '',
      logPath: 'l',
    });
    expect(result.status).toBe('fail');
    expect(result.note).toMatch(/heap exhaustion/);
  });

  it('formats one line per shard and a total', () => {
    const pass = summarizeShard({
      shard: 1,
      shards: 2,
      exitCode: 0,
      durationMs: 38 * 60_000 + 48_000,
      report: report({ expected: 600, skipped: 3 }),
      logText: '',
      logPath: '/r/shard-1/output.log',
    });
    const fail = summarizeShard({
      shard: 2,
      shards: 2,
      exitCode: 1,
      durationMs: 60_000,
      report: report({ expected: 1, unexpected: 1, flaky: 1 }, [failingSuite]),
      logText: '',
      logPath: '/r/shard-2/output.log',
    });
    expect(formatShardLine(pass)).toBe(
      '[ct-full] shard 1/2 PASS exit 0 | 38m48s | 600 passed, 0 failed, 0 flaky, 3 skipped | log /r/shard-1/output.log',
    );
    const text = formatSummary([pass, fail], { runDir: '/r', wallMs: 2 * 3_600_000 + 12 * 60_000 });
    expect(text).toContain('[ct-full] shard 2/2 FAIL exit 1 | 1m00s');
    expect(text).toContain(
      '[ct-full] failed (1):\n[ct-full]   [shard 2] a.ct.spec.ts:3:1 › breaks',
    );
    expect(text).toContain(
      '[ct-full] flaky (1):\n[ct-full]   [shard 2] a.ct.spec.ts:9:1 › wobbles',
    );
    expect(text.split('\n').at(-1)).toBe(
      '[ct-full] total: FAIL — 1/2 shards passed | 601 passed, 1 failed, 1 flaky, 3 skipped | 2h12m',
    );
    expect(totals([pass]).ok).toBe(true);
  });

  it('reports unknown totals when a shard has no counts', () => {
    const crashed = summarizeShard({
      shard: 1,
      shards: 1,
      exitCode: 1,
      durationMs: 1,
      report: null,
      logText: '',
      logPath: 'l',
    });
    expect(totals([crashed]).counts).toBeNull();
    expect(formatSummary([crashed], { runDir: '/r', wallMs: 1 })).toContain('counts unavailable');
  });

  it('formats durations and run stamps', () => {
    expect(formatDuration(5_400)).toBe('5s');
    expect(formatDuration(25.7 * 60_000)).toBe('25m42s');
    expect(formatDuration(3_600_000 + 5 * 60_000)).toBe('1h05m');
    expect(runStamp(new Date('2026-10-27T08:40:05.123Z'))).toBe('2026-10-27T08-40-05Z');
  });

  it('tracks list-reporter progress across chunk boundaries', () => {
    const progress = createProgressTracker();
    progress.push('Running 40 tests using 4 workers\n  ✓  1 [chromium] › a:1:1 › x (1s)\n  ✘  1');
    progress.push('2 [chromium] › b:1:1 › y (1s)\n');
    expect(progress.total).toBe(40);
    expect(progress.done).toBe(12);
  });

  it('tracks progress through colored list-reporter output (FORCE_COLOR)', () => {
    const progress = createProgressTracker();
    progress.push('\x1b[2mRunning \x1b[22m575\x1b[2m tests using 2 workers\x1b[22m\n');
    progress.push('  \x1b[32m✓\x1b[39m  \x1b[2m 7 \x1b[22m[chromium] › a:1:1 › x (1s)\n');
    expect(progress.total).toBe(575);
    expect(progress.done).toBe(7);
  });
});

describe('runFull', () => {
  it('prints usage for --help without running shards', async () => {
    const stdout = new Sink();
    const code = await runFull({ argv: ['--', '--help'], stdout, stderr: new Sink() });
    expect(code).toBe(0);
    expect(stdout.text).toBe(`${usage()}\n`);
    expect(stdout.text).toMatch(/2h15m/);
  });

  it('rejects an owned option with exit 2', async () => {
    const stderr = new Sink();
    const code = await runFull({ argv: ['--shard=1/4'], stdout: new Sink(), stderr });
    expect(code).toBe(2);
    expect(stderr.text).toMatch(/--shard is set per shard/);
  });

  it('runs every shard in order under one held lock and exits 0', async () => {
    const run = await runFake(['src/x.ct.spec.ts']);
    expect(run.code).toBe(0);
    expect(run.lockCalls).toHaveLength(1);
    expect(run.released).toBe(1);
    for (const shard of [1, 2, 3, 4]) {
      const log = run.log(shard);
      expect(log).toContain(`"--shard=${shard}/4"`);
      expect(log).toContain('"--grep-invert","@quarantine\\\\b","src/x.ct.spec.ts"');
      expect(log).toContain(`LOCK ${ctLockKey({})}`);
    }
    expect(run.summary).toMatchObject({
      ok: true,
      interrupted: null,
      totals: { passedShards: 4, shardCount: 4, counts: { passed: 8, failed: 0, skipped: 4 } },
    });
    expect(run.stdout).toMatch(
      /total: PASS — 4\/4 shards passed \| 8 passed, 0 failed, 0 flaky, 4 skipped/,
    );
    // Quiet by default: shard output stays in the logs.
    expect(run.stdout + run.stderr).not.toContain('ARGS');
  });

  it('keeps going after a failing shard and exits 1', async () => {
    const run = await runFake([], { FAKE_FAILED: '2', FAKE_NO_REPORT: '3', FAKE_EXIT_3: '134' });
    expect(run.code).toBe(1);
    expect(run.summary.shards.map((s: { status: string }) => s.status)).toEqual([
      'pass',
      'fail',
      'fail',
      'pass',
    ]);
    expect(run.stdout).toContain('[ct-full] shard 3/4 FAIL exit 134');
    expect(run.stdout).toContain('heap exhaustion');
    expect(run.stdout).toContain('[shard 2] f.ct.spec.ts:2:3 › shard 2 breaks');
    expect(run.stdout).toMatch(/total: FAIL — 2\/4 shards passed \| counts unavailable/);
    expect(run.log(4)).toContain('"--shard=4/4"');
  });

  it('prints a run folder outside the package as an absolute path', async () => {
    const outside = tempDir();
    const run = await runFake(['--shards=1', '--out-dir', outside]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`log ${path.join(outside, 'shard-1', 'output.log')}`);
    expect(run.stdout).not.toContain('../');
  });

  it('echoes shard output with --stream', async () => {
    const run = await runFake(['--shards=1', '--stream']);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('ARGS ["--shard=1/1"');
    expect(run.stderr).toContain(`LOCK ${ctLockKey({})}`);
  });

  it('fails without running shards when the port lock is busy', async () => {
    const stderr = new Sink();
    const code = await runFull({
      argv: ['--out-dir', path.join(tempDir(), 'run')],
      env: { CT_PORT: '3999' },
      launcher: '/nonexistent',
      acquireLock: async () => {
        throw new Error('verification lock busy');
      },
      stdout: new Sink(),
      stderr,
      proc: new EventEmitter(),
    });
    expect(code).toBe(1);
    expect(stderr.text).toMatch(/another CT run owns port 3999/);
  });

  it('stops the current shard on a signal, skips the rest and exits 128+n', async () => {
    const dir = tempDir();
    const proc = new EventEmitter();
    const killed: string[] = [];
    const spawnImpl = () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill(signal: string) {
          killed.push(signal);
          setImmediate(() => child.emit('close', null, signal));
          return true;
        },
      });
      setImmediate(() => proc.emit('SIGINT', 'SIGINT'));
      return child;
    };
    const stdout = new Sink();
    const code = await runFull({
      argv: ['--out-dir', path.join(dir, 'run'), '--heartbeat=0'],
      cwd: dir,
      spawnImpl,
      acquireLock: async () => () => {},
      stdout,
      stderr: new Sink(),
      proc,
    });
    expect(code).toBe(130);
    expect(killed).toEqual(['SIGINT']);
    expect(stdout.text).toContain('[ct-full] shard 1/4 STOP exit 130');
    expect(stdout.text).toContain('[ct-full] shard 4/4 SKIP not run');
    expect(proc.listenerCount('SIGINT')).toBe(0);
  });

  it('does not reuse a stale report when --out-dir is reused', async () => {
    const dir = tempDir();
    const first = await runFake(['--shards=1'], {}, { dir });
    expect(first.code).toBe(0);
    const second = await runFake(
      ['--shards=1'],
      { FAKE_NO_REPORT: '1', FAKE_EXIT_1: '1' },
      { dir },
    );
    expect(second.code).toBe(1);
    expect(second.summary.shards[0]).toMatchObject({ status: 'fail', counts: null });
    expect(second.summary.shards[0].note).toMatch(/no JSON report/);
  });

  it('says when a custom --grep-invert replaces the quarantine filter', async () => {
    const run = await runFake(['--shards=1', '--grep-invert', '@slow']);
    expect(run.code).toBe(0);
    expect(run.stderr).toMatch(/--grep-invert.*@quarantine/);
    expect(run.log(1)).not.toContain('@quarantine');
  });

  function fakeChild(pid = 4242) {
    const pipe = () =>
      Object.assign(new EventEmitter(), {
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      });
    return Object.assign(new EventEmitter(), {
      pid,
      stdout: pipe(),
      stderr: pipe(),
      killed: [] as string[],
      kill(signal: string) {
        this.killed.push(signal);
        return true;
      },
    });
  }

  it('starts each shard in its own process group so one Ctrl-C is forwarded once', async () => {
    const dir = tempDir();
    const proc = new EventEmitter();
    const options: Array<{ detached?: boolean }> = [];
    const groupKills: Array<[number, string]> = [];
    let child: ReturnType<typeof fakeChild> | undefined;
    const spawnImpl = (_cmd: string, _args: string[], opts: { detached?: boolean }) => {
      options.push(opts);
      const current = fakeChild();
      child = current;
      setImmediate(() => {
        // The same Ctrl-C arrives twice (TTY group + pnpm forwarding).
        proc.emit('SIGINT', 'SIGINT');
        proc.emit('SIGINT', 'SIGINT');
        setImmediate(() => current.emit('close', null, 'SIGINT'));
      });
      return current;
    };
    const code = await runFull({
      argv: ['--out-dir', path.join(dir, 'run'), '--heartbeat=0'],
      cwd: dir,
      spawnImpl,
      killProcessGroup: (pid: number, signal: string) => groupKills.push([pid, signal]),
      acquireLock: async () => () => {},
      stdout: new Sink(),
      stderr: new Sink(),
      proc,
    });
    expect(code).toBe(130);
    expect(options[0]?.detached).toBe(process.platform !== 'win32');
    expect(child?.killed).toEqual(['SIGINT']);
    expect(groupKills).toEqual([]);
  });

  it('kills the whole shard process group on a later second signal', async () => {
    const dir = tempDir();
    const proc = new EventEmitter();
    const groupKills: Array<[number, string]> = [];
    let clock = 0;
    const spawnImpl = () => {
      const current = fakeChild(5151);
      setImmediate(() => {
        proc.emit('SIGINT', 'SIGINT');
        clock += 5_000;
        proc.emit('SIGINT', 'SIGINT');
        setImmediate(() => current.emit('close', null, 'SIGKILL'));
      });
      return current;
    };
    const code = await runFull({
      argv: ['--out-dir', path.join(dir, 'run'), '--heartbeat=0'],
      cwd: dir,
      spawnImpl,
      now: () => clock,
      killProcessGroup: (pid: number, signal: string) => groupKills.push([pid, signal]),
      acquireLock: async () => () => {},
      stdout: new Sink(),
      stderr: new Sink(),
      proc,
    });
    expect(code).toBe(130);
    expect(groupKills).toEqual([[5151, 'SIGKILL']]);
  });

  it('closes a shard whose leaked processes hold its pipes, without crashing on late output', async () => {
    const dir = tempDir();
    const groupKills: Array<[number, string]> = [];
    let child: ReturnType<typeof fakeChild> | undefined;
    const spawnImpl = () => {
      const current = fakeChild(6262);
      child = current;
      setImmediate(() => {
        current.stdout.emit('data', 'before exit\n');
        current.emit('exit', 0, null);
      });
      return current;
    };
    const run = runFull({
      argv: ['--out-dir', path.join(dir, 'run'), '--heartbeat=0', '--shards=1'],
      cwd: dir,
      spawnImpl,
      drainMs: 20,
      killProcessGroup: (pid: number, signal: string) => groupKills.push([pid, signal]),
      acquireLock: async () => () => {},
      stdout: new Sink(),
      stderr: new Sink(),
      proc: new EventEmitter(),
    });
    const code = await run;
    // A leaked grandchild writes after the shard was closed.
    child?.stderr.emit('data', 'late output\n');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(code).toBe(0);
    expect(groupKills).toEqual([[6262, 'SIGKILL']]);
    expect(child?.stdout.destroyed).toBe(true);
    expect(child?.stderr.destroyed).toBe(true);
    const log = readFileSync(path.join(dir, 'run', 'shard-1', 'output.log'), 'utf8');
    expect(log).toContain('before exit');
    expect(log).toMatch(/output stayed open; killing leftover processes/);
    expect(log).not.toContain('late output');
  });

  /**
   * A real launcher -> grandchild chain. The grandchild ignores SIGINT/SIGTERM
   * and inherits the launcher's stdout (like a Playwright worker or the CT
   * server). `mode=stubborn`: the launcher also ignores signals, so only a
   * group kill stops it. `mode=leak`: the launcher exits at once, leaving the
   * silent grandchild holding the pipes.
   */
  function writeTreeLauncher(dir: string, mode: 'stubborn' | 'leak') {
    const file = path.join(dir, `tree-launcher-${mode}.mjs`);
    writeFileSync(
      file,
      `import { spawn } from 'node:child_process';
const grandchild = spawn(process.execPath, ['-e', "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: ['ignore', 'inherit', 'inherit'] });
console.log('GRANDCHILD ' + grandchild.pid);
${
  mode === 'stubborn'
    ? "process.on('SIGINT', () => {}); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"
    : 'process.exit(0);'
}
`,
    );
    return file;
  }

  async function waitFor<T>(read: () => T | null, timeoutMs = 10_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = read();
      if (value !== null) return value;
      if (Date.now() > deadline) throw new Error('timed out waiting');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  function alive(pid: number) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function grandchildPid(logFile: string) {
    if (!existsSync(logFile)) return null;
    const match = /GRANDCHILD (\d+)/.exec(readFileSync(logFile, 'utf8'));
    return match ? Number(match[1]) : null;
  }

  it.skipIf(process.platform === 'win32')(
    'a second signal kills a real launcher and the grandchild it started',
    async () => {
      const dir = tempDir();
      const proc = new EventEmitter();
      let clock = 0;
      const logFile = path.join(dir, 'run', 'shard-1', 'output.log');
      const run = runFull({
        argv: ['--out-dir', path.join(dir, 'run'), '--heartbeat=0', '--shards=2'],
        cwd: dir,
        launcher: writeTreeLauncher(dir, 'stubborn'),
        now: () => clock,
        acquireLock: async () => () => {},
        stdout: new Sink(),
        stderr: new Sink(),
        proc,
      });
      const pid = await waitFor(() => grandchildPid(logFile));
      proc.emit('SIGTERM', 'SIGTERM');
      clock += 5_000;
      proc.emit('SIGTERM', 'SIGTERM');
      expect(await run).toBe(143);
      await waitFor(() => (alive(pid) ? null : true));
    },
    20_000,
  );

  it.skipIf(process.platform === 'win32')(
    'kills a silent grandchild that keeps the pipes open after the launcher exits',
    async () => {
      const dir = tempDir();
      const logFile = path.join(dir, 'run', 'shard-1', 'output.log');
      const code = await runFull({
        argv: ['--out-dir', path.join(dir, 'run'), '--heartbeat=0', '--shards=1'],
        cwd: dir,
        launcher: writeTreeLauncher(dir, 'leak'),
        drainMs: 200,
        acquireLock: async () => () => {},
        stdout: new Sink(),
        stderr: new Sink(),
        proc: new EventEmitter(),
      });
      expect(code).toBe(0);
      const pid = grandchildPid(logFile);
      expect(pid).not.toBeNull();
      await waitFor(() => (alive(pid!) ? null : true));
    },
    20_000,
  );
});
