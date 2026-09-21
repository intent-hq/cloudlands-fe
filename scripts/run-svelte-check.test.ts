import { EventEmitter } from 'node:events';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MIN_FILES,
  RSS_FILE_ENV,
  createOutputCollector,
  evaluateRun,
  formatDiagnostic,
  formatPeakRss,
  heapCapMB,
  parseMachineLine,
  readRssMiB,
  syncEnv,
  runSvelteCheck,
} from './run-svelte-check.mjs';

describe('parseMachineLine', () => {
  it('parses a COMPLETED summary line', () => {
    const event = parseMachineLine(
      '1590680326283 COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS',
    );
    expect(event).toEqual({
      kind: 'completed',
      files: 4400,
      errors: 0,
      warnings: 2,
      filesWithProblems: 1,
    });
  });

  it('parses a COMPLETED line with trailing whitespace or CR', () => {
    const event = parseMachineLine(
      '1590680326283 COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS\r',
    );
    expect(event).toMatchObject({ kind: 'completed', files: 4400 });
  });

  it('parses a legacy COMPLETED line without the FILES_WITH_PROBLEMS clause', () => {
    const event = parseMachineLine('1590680326283 COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS');
    expect(event).toEqual({
      kind: 'completed',
      files: 4400,
      errors: 0,
      warnings: 2,
      filesWithProblems: 0,
    });
  });

  it('rejects a COMPLETED line with unexpected extra trailing fields', () => {
    const event = parseMachineLine(
      '1590680326283 COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS 3 HINTS',
    );
    expect(event).toEqual({
      kind: 'unknown',
      body: 'COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS 3 HINTS',
    });
  });

  it('parses a COMPLETED record without the epoch timestamp prefix', () => {
    expect(
      parseMachineLine('COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS'),
    ).toMatchObject({ kind: 'completed', files: 4400 });
  });

  it('keeps prefix-less non-COMPLETED lines as passthrough', () => {
    expect(parseMachineLine('START "/repo"')).toBeNull();
    expect(parseMachineLine('FAILURE "boom"')).toBeNull();
    expect(parseMachineLine('{"type":"ERROR","message":"x"}')).toBeNull();
  });

  it('does not treat a truncated COMPLETED line as a completion', () => {
    expect(parseMachineLine('1590680326283 COMPLETED 4400 FILES 0 ERR')).toEqual({
      kind: 'unknown',
      body: 'COMPLETED 4400 FILES 0 ERR',
    });
    expect(parseMachineLine('COMPLETED 4400 FI')).toBeNull();
  });

  it('rejects a COMPLETED line truncated after the WARNINGS clause', () => {
    for (const tail of ['1', '1 FI', '1 FILES_WITH_PROB']) {
      expect(
        parseMachineLine(`1590680326283 COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS ${tail}`),
      ).toEqual({
        kind: 'unknown',
        body: `COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS ${tail}`,
      });
    }
  });

  it('parses machine-verbose JSON diagnostics', () => {
    const diagnostic = {
      type: 'ERROR',
      filename: 'src/lib/Foo.svelte',
      start: { line: 11, character: 4 },
      end: { line: 11, character: 7 },
      message: "Cannot find name 'bar'",
      code: 2304,
      source: 'ts',
    };
    const event = parseMachineLine(`1590680326283 ${JSON.stringify(diagnostic)}`);
    expect(event).toEqual({ kind: 'diagnostic', diagnostic });
  });

  it('recognizes START and FAILURE lines', () => {
    expect(parseMachineLine('1590680326283 START "/repo"')).toEqual({ kind: 'start' });
    expect(parseMachineLine('1590680326283 FAILURE "boom"')).toEqual({
      kind: 'failure',
      message: '"boom"',
    });
  });

  it('returns null for non-machine lines and unknown for unrecognized bodies', () => {
    expect(parseMachineLine('Loading svelte-check…')).toBeNull();
    expect(parseMachineLine('1590680326283 SOMETHING ELSE')).toEqual({
      kind: 'unknown',
      body: 'SOMETHING ELSE',
    });
  });
});

describe('formatDiagnostic', () => {
  it('renders a human-readable diagnostic with relative path and 1-based position', () => {
    const out = formatDiagnostic(
      {
        type: 'ERROR',
        filename: '/repo/src/lib/Foo.svelte',
        start: { line: 11, character: 4 },
        message: "Cannot find name 'bar'",
        source: 'ts',
      },
      '/repo',
    );
    expect(out).toBe("src/lib/Foo.svelte:12:5\nError: Cannot find name 'bar' (ts)\n");
  });
});

describe('syncEnv', () => {
  it('forces NODE_ENV to development so sync typegen covers src/routes', () => {
    expect(syncEnv({ NODE_ENV: 'production', PATH: '/bin' })).toEqual({
      NODE_ENV: 'development',
      PATH: '/bin',
    });
  });

  it('sets NODE_ENV even when absent', () => {
    expect(syncEnv({ PATH: '/bin' })).toEqual({ NODE_ENV: 'development', PATH: '/bin' });
  });
});

describe('createOutputCollector', () => {
  const completedLine =
    '1590680326283 COMPLETED 4760 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS';

  it('records the COMPLETED summary from a current-format stream and passes the guard', () => {
    const printed: string[] = [];
    const collector = createOutputCollector({
      print: (line: string) => printed.push(line),
      printError: () => {},
      workspaceDir: '/repo',
    });
    for (const line of ['1590680326283 START "/repo"', completedLine]) {
      collector.handleLine(line);
    }
    expect(collector.completed).toMatchObject({ kind: 'completed', files: 4760, errors: 0 });
    expect(evaluateRun({ exitCode: 0, completed: collector.completed })).toEqual([]);
  });

  it('re-prints diagnostics and passthrough lines without recording completion', () => {
    const printed: string[] = [];
    const collector = createOutputCollector({
      print: (line: string) => printed.push(line),
      printError: () => {},
      workspaceDir: '/repo',
    });
    const diagnostic = {
      type: 'ERROR',
      filename: 'src/lib/Foo.svelte',
      start: { line: 11, character: 4 },
      message: "Cannot find name 'bar'",
      source: 'ts',
    };
    collector.handleLine('Loading svelte-check…');
    collector.handleLine(`1590680326283 ${JSON.stringify(diagnostic)}`);
    expect(printed[0]).toBe('Loading svelte-check…');
    expect(printed[1]).toContain('src/lib/Foo.svelte:12:5');
    expect(collector.completed).toBeNull();
  });

  it('fails the guard on a truncated stream that never completes', () => {
    const collector = createOutputCollector({ print: () => {}, printError: () => {} });
    for (const line of ['1590680326283 START "/repo"', '1590680326283 COMPLETED 4760 FIL']) {
      collector.handleLine(line);
    }
    expect(collector.completed).toBeNull();
    const failures = evaluateRun({ exitCode: 0, completed: collector.completed });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('COMPLETED');
  });

  it('defers to a failing check (nonzero exit) without inventing guard failures', () => {
    const collector = createOutputCollector({ print: () => {}, printError: () => {} });
    collector.handleLine(
      '1590680326283 COMPLETED 4760 FILES 3 ERRORS 0 WARNINGS 2 FILES_WITH_PROBLEMS',
    );
    expect(collector.completed).toMatchObject({ errors: 3 });
    expect(evaluateRun({ exitCode: 1, completed: collector.completed })).toEqual([]);
  });
});

describe('evaluateRun', () => {
  const completed = {
    kind: 'completed',
    files: 4400,
    errors: 0,
    warnings: 0,
    filesWithProblems: 0,
  };

  it('accepts a plausible clean run', () => {
    expect(evaluateRun({ exitCode: 0, completed })).toEqual([]);
  });

  it('defers to svelte-check when it already failed', () => {
    expect(evaluateRun({ exitCode: 1, completed: { ...completed, files: 3 } })).toEqual([]);
  });

  it('fails an exit-0 run with an implausibly low file count', () => {
    const failures = evaluateRun({ exitCode: 0, completed: { ...completed, files: 3 } });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('3 checked files');
    expect(failures[0]).toContain(String(MIN_FILES));
  });

  it('fails an exit-0 run that never reported completion', () => {
    const failures = evaluateRun({ exitCode: 0, completed: null });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('COMPLETED');
  });

  it('fails an exit-0 run that still reported errors', () => {
    const failures = evaluateRun({ exitCode: 0, completed: { ...completed, errors: 2 } });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('2 errors');
  });
});

describe('runSvelteCheck', () => {
  it.each([undefined, '', '  ', '--single-threaded-gc', '  --single-threaded-gc   --no-opt  '])(
    'passes node arguments %s',
    async (nodeArgs) => {
      const child = new EventEmitter();
      const calls: unknown[][] = [];
      const result = runSvelteCheck({
        cliPath: '/checker.js',
        args: ['--output', 'machine-verbose'],
        outputFd: 42,
        env: { CT_NODE_ARGS: nodeArgs },
        spawnImpl: ((...args: unknown[]) => {
          calls.push(args);
          return child;
        }) as never,
        sampleRss: () => null,
      });
      expect(calls[0]?.[0]).toBe(process.execPath);
      const expectedTail = [
        ...(nodeArgs?.trim() ? nodeArgs.trim().split(/\s+/) : []),
        '/checker.js',
        '--output',
        'machine-verbose',
      ];
      const spawnArgs = calls[0]?.[1] as string[];
      expect(spawnArgs.slice(-expectedTail.length)).toEqual(expectedTail);
      expect(spawnArgs).toContain('--report-on-fatalerror');
      expect(spawnArgs[spawnArgs.indexOf('--import') + 1]).toMatch(/^data:text\/javascript,/);
      const spawnEnv = (calls[0]?.[2] as { env: Record<string, string> }).env;
      expect(spawnEnv[RSS_FILE_ENV]).toBeTruthy();
      child.emit('close', 0, null);
      await expect(result).resolves.toEqual({ exitCode: 0, peakRssMiB: null });
    },
  );

  it.each(['SIGSEGV', 'SIGTERM'])('reports %s and fails when killed', async (signal) => {
    const child = new EventEmitter();
    const errors: string[] = [];
    const result = runSvelteCheck({
      cliPath: '/checker.js',
      args: [],
      outputFd: 42,
      spawnImpl: (() => child) as never,
      printError: (message: string) => errors.push(message),
      sampleRss: () => null,
    });
    child.emit('close', null, signal);
    await expect(result).resolves.toMatchObject({ exitCode: 1 });
    expect(errors).toEqual([`svelte-check died with ${signal}`]);
  });

  it('keeps the peak of the sampled RSS across the run, including an OOM abort', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 4242 });
    const samples = [512, 3900, 3700];
    const sampledPids: unknown[] = [];
    const result = runSvelteCheck({
      cliPath: '/checker.js',
      args: [],
      outputFd: 42,
      spawnImpl: (() => child) as never,
      printError: () => {},
      sampleRss: (pid: unknown) => {
        sampledPids.push(pid);
        return samples.shift() ?? null;
      },
      sampleIntervalMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    child.emit('close', null, 'SIGABRT');
    await expect(result).resolves.toEqual({ exitCode: 1, peakRssMiB: 3900 });
    expect(sampledPids.every((pid) => pid === 4242)).toBe(true);
  });

  it('prefers the high-water mark the child left behind over the sparse samples', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 4242 });
    const probeDir = mkdtempSync(path.join(tmpdir(), 'rss-probe-test-'));
    let rssFile: string | undefined;
    const result = runSvelteCheck({
      cliPath: '/checker.js',
      args: [],
      outputFd: 42,
      spawnImpl: ((_cmd: string, _args: string[], opts: { env: Record<string, string> }) => {
        rssFile = opts.env[RSS_FILE_ENV];
        return child;
      }) as never,
      printError: () => {},
      sampleRss: () => 128,
      sampleIntervalMs: 60_000,
      probeDir,
    });
    expect(rssFile && path.dirname(rssFile)).toBe(probeDir);
    writeFileSync(rssFile as string, String(3999 * 1024));
    child.emit('close', 0, null);
    await expect(result).resolves.toEqual({ exitCode: 0, peakRssMiB: 3999 });
    expect(existsSync(probeDir)).toBe(false);
  });

  describe('with a real child process', () => {
    const runChild = async (code: string, nodeArgs = '') => {
      const dir = mkdtempSync(path.join(tmpdir(), 'rss-child-test-'));
      const outputPath = path.join(dir, 'output');
      const outputFd = openSync(outputPath, 'w');
      const errors: string[] = [];
      const result = await runSvelteCheck({
        cliPath: code,
        args: [],
        outputFd,
        env: { ...process.env, CT_NODE_ARGS: `${nodeArgs} --input-type=module --eval` },
        printError: (message: string) => errors.push(message),
      });
      closeSync(outputFd);
      const output = readFileSync(outputPath, 'utf8');
      rmSync(dir, { recursive: true, force: true });
      return { ...result, errors, output };
    };

    it.each([0, 1])(
      'reports a child that touched 256 MiB and exited %i, even within one interval',
      async (exitCode) => {
        const { peakRssMiB, output, ...rest } = await runChild(
          `Buffer.alloc(256 * 1024 * 1024, 1); console.log(process.resourceUsage().maxRSS); process.exit(${exitCode});`,
        );
        expect(rest).toEqual({ exitCode, errors: [] });
        const childMaxRssMiB = Math.round(Number(output.trim()) / 1024);
        expect(childMaxRssMiB).toBeGreaterThanOrEqual(256);
        expect(peakRssMiB).toBeGreaterThanOrEqual(childMaxRssMiB);
      },
    );

    it('still reports a peak after a V8 heap-limit OOM abort', async () => {
      const { exitCode, peakRssMiB, errors } = await runChild(
        [
          "import { closeSync, openSync } from 'node:fs';",
          "closeSync(2); openSync('/dev/null', 'w');",
          'const a = []; for (;;) a.push(new Array(1e5).fill(1));',
        ].join('\n'),
        '--max-old-space-size=32',
      );
      expect(exitCode).toBe(1);
      expect(errors).toEqual(['svelte-check died with SIGABRT']);
      expect(peakRssMiB).toBeGreaterThanOrEqual(32);
    }, 30_000);
  });
});

describe('readRssMiB', () => {
  it('reads a positive RSS for the current process', () => {
    const rss = readRssMiB(process.pid);
    expect(rss).not.toBeNull();
    expect(rss).toBeGreaterThan(0);
  });

  it('returns null for a missing pid or a process that is gone', () => {
    expect(readRssMiB(undefined)).toBeNull();
    expect(readRssMiB(2 ** 22 - 1)).toBeNull();
  });
});

describe('heapCapMB and formatPeakRss', () => {
  it('reads the last --max-old-space-size across NODE_OPTIONS and CT_NODE_ARGS', () => {
    expect(heapCapMB({ NODE_OPTIONS: '--max-old-space-size=4096' })).toBe(4096);
    expect(
      heapCapMB({
        NODE_OPTIONS: '--max-old-space-size=4096',
        CT_NODE_ARGS: '--max-old-space-size=6144',
      }),
    ).toBe(6144);
    expect(heapCapMB({})).toBeNull();
  });

  it('formats the peak with the cap it ran under and stays silent without a sample', () => {
    expect(formatPeakRss(3412, { NODE_OPTIONS: '--max-old-space-size=4096' })).toBe(
      'svelte-check peak RSS: 3412 MiB (--max-old-space-size=4096)',
    );
    expect(formatPeakRss(3412, {})).toBe(
      'svelte-check peak RSS: 3412 MiB (no --max-old-space-size set)',
    );
    expect(formatPeakRss(null, {})).toBeNull();
  });
});
