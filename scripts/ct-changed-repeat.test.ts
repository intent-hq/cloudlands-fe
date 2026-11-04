// @verify-changed-triggers: .github/workflows/intent-pr.yml, scripts/ct-changed-repeat.mjs,
//   scripts/ct-changed-specs.mjs, scripts/ct-contract-paths.mjs, playwright/ct-spec-pattern.mjs
// @vitest-environment node

/**
 * The local runner for PR CI's repeated changed-spec job
 * (`pnpm run test:ct:changed-repeat`, `make fe-ct-changed-repeat`). The CI
 * parity block runs the workflow's own `test-ct-changed` steps under bash with
 * the CT launcher stubbed and compares the arguments and heaps they use with
 * the script's plan, so a change to either side fails here.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CT_BUILD_ARGS,
  CT_BUILD_HEAP_MB,
  CT_CHANGED_JSON_REPORT,
  CT_RUN_HEAP_MB,
  LOCAL_BUILD_GUARD,
  ctChangedListArgs,
  ctChangedRunArgs,
  localChangedSpecs,
  main,
  nodeOptionsWithHeap,
  parseArgs,
} from './ct-changed-repeat.mjs';
import { playwrightFilter } from './ct-changed-specs.mjs';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-changed-repeat-'));
  temps.push(dir);
  return dir;
}

function listReport(files: Record<string, number>) {
  return {
    config: {},
    errors: [],
    stats: {},
    suites: Object.entries(files).map(([file, tests]) => ({
      file,
      specs: Array.from({ length: tests }, (_, i) => ({
        title: `t${i}`,
        tests: [{ projectName: 'chromium' }],
      })),
    })),
  };
}

describe('parseArgs', () => {
  it('defaults to CI’s base and workers', () => {
    expect(parseArgs([])).toMatchObject({
      base: 'origin/main',
      workers: 2,
      repeatEach: null,
      skipBuild: false,
      dryRun: false,
      specs: [],
      extra: [],
    });
  });

  it('reads options, spec paths and the Playwright args after --', () => {
    expect(
      parseArgs([
        '--',
        '--base=HEAD~2',
        '--workers',
        '4',
        '--repeat-each=50',
        '--skip-build',
        '--dry-run',
        './src/a/one.ct.spec.ts',
        '--',
        '--grep',
        'opens the menu',
      ]),
    ).toMatchObject({
      base: 'HEAD~2',
      workers: 4,
      repeatEach: 50,
      skipBuild: true,
      dryRun: true,
      specs: ['src/a/one.ct.spec.ts'],
      extra: ['--grep', 'opens the menu'],
    });
  });

  it('rejects bad values, unknown options, non-specs and options it owns', () => {
    for (const argv of [
      ['--workers', '0'],
      ['--workers'],
      ['--repeat-each=x'],
      ['--grep', 'x'],
      ['src/a/one.test.ts'],
      ['--dry-run', '--', '--repeat-each=3'],
      ['--dry-run', '--', '--workers=8'],
      ['--dry-run', '--', '-j', '8'],
      ['--dry-run', '--', '--retries=2'],
      ['--dry-run', '--', '--reporter=dot'],
    ]) {
      expect(() => parseArgs(argv), argv.join(' ')).toThrow();
    }
  });
});

describe('nodeOptionsWithHeap', () => {
  it('replaces any heap flag and keeps the other options', () => {
    expect(nodeOptionsWithHeap(undefined, 4096)).toBe('--max-old-space-size=4096');
    expect(
      nodeOptionsWithHeap(
        '--require dd-trace/init --max-old-space-size=8192 --max_old_space_size_percentage=50',
        12288,
      ),
    ).toBe('--require dd-trace/init --max-old-space-size=12288');
  });
});

describe('nodeOptionsWithHeap: every heap flag form the launcher recognizes', () => {
  // The forms scripts/run-ct-tests.test.ts accepts as an explicit heap choice.
  it.each([
    ['canonical flag', '--max-old-space-size-percentage=25'],
    ['V8 underscore alias', '--max_old_space_size_percentage=25'],
    ['double-quoted token', '"--max-old-space-size-percentage=25"'],
    ['space-separated value', '--max-old-space-size-percentage 25'],
    ['double-quoted space-separated pair', '"--max-old-space-size-percentage" "25"'],
    ['double-quoted absolute cap', '"--max-old-space-size=8192"'],
  ])('replaces a %s and keeps the other options', (_label, heap) => {
    expect(nodeOptionsWithHeap(`--require ./trace.js ${heap} --enable-source-maps`, 4096)).toBe(
      '--require ./trace.js --enable-source-maps --max-old-space-size=4096',
    );
  });
});

describe('localChangedSpecs', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (repo: string, file: string, text = 'x\n') => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text);
  };

  function repo() {
    const dir = tempDir();
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@example.com');
    git(dir, 'config', 'user.name', 'T');
    git(dir, 'config', 'commit.gpgsign', 'false');
    write(dir, 'src/a/kept.ct.spec.ts');
    write(dir, 'src/a/edited-locally.ct.spec.ts');
    write(dir, 'src/a/deleted.ct.spec.ts');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'base');
    git(dir, 'checkout', '-q', '-b', 'pr');
    write(dir, 'src/b/committed.ct.spec.ts');
    write(dir, 'src/b/helper.ts');
    git(dir, 'rm', '-q', 'src/a/deleted.ct.spec.ts');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'pr');
    return dir;
  }

  it('selects CI’s committed specs plus uncommitted and untracked ones, marked local', () => {
    const dir = repo();
    write(dir, 'src/a/edited-locally.ct.spec.ts', 'y\n');
    write(dir, 'src/c/untracked.ct.spec.ts');
    const selection = localChangedSpecs('main', { cwd: dir });
    expect(selection.mergeBase).toBe(git(dir, 'rev-parse', 'main'));
    expect(selection.specs).toEqual([
      'src/a/edited-locally.ct.spec.ts',
      'src/b/committed.ct.spec.ts',
      'src/c/untracked.ct.spec.ts',
    ]);
    expect(selection.local).toEqual([
      'src/a/edited-locally.ct.spec.ts',
      'src/c/untracked.ct.spec.ts',
    ]);
  });

  it('drops a committed spec deleted locally and marks committed specs edited locally', () => {
    const dir = repo();
    write(dir, 'src/b/committed.ct.spec.ts', 'edited after commit\n');
    write(dir, 'src/d/gone.ct.spec.ts');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'more');
    write(dir, 'src/b/committed.ct.spec.ts', 'edited again\n');
    rmSync(join(dir, 'src/d/gone.ct.spec.ts'));
    const selection = localChangedSpecs('main', { cwd: dir });
    expect(selection.specs).toEqual(['src/b/committed.ct.spec.ts']);
    expect(selection.local).toEqual(['src/b/committed.ct.spec.ts']);
  });

  it('diffs from the merge-base, so later base commits are not counted', () => {
    const dir = repo();
    git(dir, 'checkout', '-q', 'main');
    write(dir, 'src/main/later.ct.spec.ts');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'later on main');
    git(dir, 'checkout', '-q', 'pr');
    expect(localChangedSpecs('main', { cwd: dir }).specs).toEqual(['src/b/committed.ct.spec.ts']);
  });

  it('fails on a base that does not resolve', () => {
    expect(() => localChangedSpecs('no-such-ref', { cwd: repo() })).toThrow(/cannot resolve/);
  });
});

describe('main', () => {
  type Call = { args: string[]; env: Record<string, string | undefined>; quietStdout?: boolean };

  function harness({
    specs = ['src/a/one.ct.spec.ts'],
    local = [] as string[],
    report = listReport({ 'a/one.ct.spec.ts': 3 }) as unknown,
    exits = {} as { list?: number; build?: number; run?: number },
  } = {}) {
    const calls: Call[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const kind = (args: string[]) =>
      args.includes('--list') ? 'list' : args.includes('--only-changed=HEAD') ? 'build' : 'run';
    const deps = {
      selectSpecs: () => ({ mergeBase: 'abcdef0123456789', specs, local }),
      launch: (args: string[], opts: { env: Record<string, string>; quietStdout?: boolean }) => {
        calls.push({ args, env: opts.env, quietStdout: opts.quietStdout });
        return exits[kind(args)] ?? 0;
      },
      readReport: () => JSON.stringify(report),
      makeTempDir: () => tempDir(),
      env: { NODE_OPTIONS: '--require ./trace.js', PATH: '/bin' },
      log: (line: string) => out.push(line),
      warn: (line: string) => err.push(line),
    };
    return { deps, calls, out, err, kind };
  }

  it('discovers, builds under 12 GiB, then repeats under 4 GiB with CI’s flags', () => {
    const h = harness();
    expect(main(['--', '--', '--grep', 'menu'], h.deps)).toBe(0);
    const filters = ['src/a/one.ct.spec.ts'].map(playwrightFilter);
    expect(h.calls.map((call) => h.kind(call.args))).toEqual(['list', 'build', 'run']);
    const [list, build, run] = h.calls;
    expect(list.args).toEqual([...ctChangedListArgs(filters), '--grep', 'menu']);
    expect(list.quietStdout).toBe(true);
    expect(list.env.NODE_OPTIONS).toBe('--require ./trace.js --max-old-space-size=4096');
    expect(list.env.PLAYWRIGHT_JSON_OUTPUT_FILE).toMatch(/ct-changed-list\.json$/);
    expect(build.args).toEqual([...CT_BUILD_ARGS, ...LOCAL_BUILD_GUARD]);
    expect(build.env.NODE_OPTIONS).toBe('--require ./trace.js --max-old-space-size=12288');
    expect(run.args).toEqual([...ctChangedRunArgs(filters, 20, 2), '--grep', 'menu']);
    expect(run.env.NODE_OPTIONS).toBe('--require ./trace.js --max-old-space-size=4096');
    expect(run.env.PLAYWRIGHT_JSON_OUTPUT_FILE).toBe(CT_CHANGED_JSON_REPORT);
    expect(h.out.join('\n')).toContain('repeating each 20 times with the extra Playwright args');
  });

  it('dry run prints the filters and repeat count without building or running', () => {
    const h = harness({
      specs: ['src/a/one.ct.spec.ts', 'src/b/two.ct.spec.ts'],
      local: ['src/b/two.ct.spec.ts'],
      report: listReport({ 'a/one.ct.spec.ts': 50, 'b/two.ct.spec.ts': 50 }),
    });
    expect(main(['--dry-run', '--workers=4'], h.deps)).toBe(0);
    expect(h.calls.map((call) => h.kind(call.args))).toEqual(['list']);
    const text = h.out.join('\n');
    expect(text).toContain(playwrightFilter('src/a/one.ct.spec.ts'));
    expect(text).toContain('src/b/two.ct.spec.ts  (local changes: CI does not see them yet)');
    expect(text).toContain('repeat-each: 8');
    expect(text).toContain('--repeat-each=8 --retries=0 --fail-on-flaky-tests --workers=4');
  });

  it('says the extra Playwright args, not CI, sized the repeat count', () => {
    const h = harness();
    expect(main(['--', '--', '--grep', 'menu'], h.deps)).toBe(0);
    const text = h.out.join('\n');
    expect(text).toContain('repeating each 20 times with the extra Playwright args');
    expect(text).not.toContain('CI repeats each');
  });

  it('honours --repeat-each and --skip-build', () => {
    const h = harness();
    expect(main(['--repeat-each', '100', '--skip-build'], h.deps)).toBe(0);
    expect(h.calls.map((call) => h.kind(call.args))).toEqual(['list', 'run']);
    expect(h.calls[1].args).toContain('--repeat-each=100');
  });

  it('runs the given specs without diffing', () => {
    const h = harness();
    h.deps.selectSpecs = () => {
      throw new Error('should not diff');
    };
    expect(main(['src/z/given.ct.spec.ts', '--dry-run'], h.deps)).toBe(0);
    expect(h.calls[0].args[0]).toBe(playwrightFilter('src/z/given.ct.spec.ts'));
  });

  it('exits 0 without launching when no spec changed, as CI skips the job', () => {
    const h = harness({ specs: [] });
    expect(main([], h.deps)).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it('stops at a failed discovery, an empty discovery or a failed build', () => {
    const listFail = harness({ exits: { list: 1 } });
    expect(main([], listFail.deps)).toBe(1);
    expect(listFail.calls).toHaveLength(1);

    const empty = harness({ report: listReport({ 'a/one.ct.spec.ts': 0 }) });
    expect(main([], empty.deps)).toBe(1);
    expect(empty.calls).toHaveLength(1);

    const buildFail = harness({ exits: { build: 134 } });
    expect(main([], buildFail.deps)).toBe(134);
    expect(buildFail.calls.map((call) => buildFail.kind(call.args))).toEqual(['list', 'build']);
  });

  it('returns the run’s exit status', () => {
    const h = harness({ exits: { run: 1 } });
    expect(main([], h.deps)).toBe(1);
  });

  it('rejects bad arguments and a selection error with exit 2', () => {
    expect(main(['--workers=0'], harness().deps)).toBe(2);
    const h = harness();
    h.deps.selectSpecs = () => {
      throw new Error('cannot resolve --base x');
    };
    expect(main([], h.deps)).toBe(2);
    expect(h.calls).toEqual([]);
  });
});

describe('parity with the test-ct-changed workflow job', () => {
  const workflowLines = readFileSync(resolve('.github/workflows/intent-pr.yml'), 'utf8').split(
    '\n',
  );

  function jobLines(name: string): string[] {
    const start = workflowLines.indexOf(`  ${name}:`);
    if (start === -1) throw new Error(`job ${name} not found`);
    const rest = workflowLines.slice(start + 1);
    const end = rest.findIndex((text) => /^ {2}[\w-]+:/.test(text));
    return rest.slice(0, end === -1 ? rest.length : end);
  }

  function stepLines(stepName: string): string[] {
    const job = jobLines('test-ct-changed');
    const start = job.indexOf(`      - name: ${stepName}`);
    if (start === -1) throw new Error(`step ${stepName} not found`);
    const rest = job.slice(start + 1);
    const end = rest.findIndex((text) => text.startsWith('      - '));
    return rest.slice(0, end === -1 ? rest.length : end);
  }

  function stepRun(stepName: string): string {
    const lines = stepLines(stepName);
    const runLine = lines.findIndex((text) => text.startsWith('        run:'));
    if (runLine === -1) throw new Error(`step ${stepName} has no run`);
    const inline = lines[runLine].slice('        run:'.length).trim();
    if (inline !== '|') return inline;
    const body: string[] = [];
    for (const text of lines.slice(runLine + 1)) {
      if (text.trim() !== '' && !text.startsWith('          ')) break;
      body.push(text.slice(10));
    }
    return body.join('\n');
  }

  const envValue = (stepName: string, key: string) =>
    stepLines(stepName)
      .find((text) => text.startsWith(`          ${key}:`))
      ?.slice(`          ${key}:`.length)
      .trim()
      .replace(/^'(.*)'$/, '$1');

  it('builds the bundle with the same arguments and heap', () => {
    expect(envValue('Build CT bundle', 'NODE_OPTIONS')).toBe(
      `--max-old-space-size=${CT_BUILD_HEAP_MB}`,
    );
    expect(stepRun('Build CT bundle')).toBe(
      `node scripts/run-ct-tests.mjs ${CT_BUILD_ARGS.join(' ')}`,
    );
  });

  it('repeats the tests under the same heap and JSON report path', () => {
    expect(envValue('Repeat changed component tests', 'NODE_OPTIONS')).toBe(
      `--max-old-space-size=${CT_RUN_HEAP_MB}`,
    );
    expect(envValue('Repeat changed component tests', 'PLAYWRIGHT_JSON_OUTPUT_FILE')).toBe(
      CT_CHANGED_JSON_REPORT,
    );
  });

  // The workflow's own step under bash, with `node scripts/run-ct-tests.mjs`
  // replaced by a stub that records each call's argv (and serves `report` to
  // the --list call), then the script's main() against the same report.
  it('lists and repeats with the same arguments and repeat count as the script', () => {
    const specs = ['src/a/one.ct.spec.ts', 'src/routes/[id]/two.ct.spec.ts'];
    const report = listReport({ 'a/one.ct.spec.ts': 30, 'routes/[id]/two.ct.spec.ts': 20 });
    const dir = tempDir();
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const fixture = join(dir, 'report.json');
    writeFileSync(fixture, JSON.stringify(report));
    writeFileSync(
      join(bin, 'node'),
      [
        '#!/usr/bin/env bash',
        'if [ "$1" = scripts/run-ct-tests.mjs ]; then',
        '  shift',
        '  for arg in "$@"; do',
        `    if [ "$arg" = --list ]; then printf '%s\\n' "$@" > "${dir}/list-argv"; cp "${fixture}" "$PLAYWRIGHT_JSON_OUTPUT_FILE"; exit 0; fi`,
        '  done',
        `  printf '%s\\n' "$@" > "${dir}/run-argv"`,
        '  exit 0',
        'fi',
        `NODE_OPTIONS= exec "${process.execPath}" "$@"`,
        '',
      ].join('\n'),
    );
    chmodSync(join(bin, 'node'), 0o755);
    const result = spawnSync(
      'bash',
      ['-e', '-o', 'pipefail', '-c', stepRun('Repeat changed component tests')],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          CT_CHANGED_SPECS: JSON.stringify(specs),
          RUNNER_TEMP: dir,
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const lines = (file: string) => readFileSync(join(dir, file), 'utf8').trimEnd().split('\n');

    const calls: string[][] = [];
    const code = main(specs, {
      launch: (args: string[]) => {
        calls.push(args);
        return 0;
      },
      readReport: () => JSON.stringify(report),
      makeTempDir: () => tempDir(),
      env: {},
      log: () => {},
      warn: () => {},
    });
    expect(code).toBe(0);
    const [list, build, run] = calls;
    expect(list).toEqual(lines('list-argv'));
    expect(build.slice(0, CT_BUILD_ARGS.length)).toEqual(CT_BUILD_ARGS);
    expect(run).toEqual(lines('run-argv'));
    expect(run).toContain('--repeat-each=16');
  });
});
