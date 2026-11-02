// @verify-changed-triggers: .github/workflows/intent-pr.yml, scripts/ct-changed-specs.mjs,
//   playwright/ct-spec-pattern.mjs
// @vitest-environment node

/**
 * The changed-spec repetition job (`test-ct-changed` in intent-pr.yml) and the
 * script that feeds it. The diff mode runs against a real temporary git
 * repository; the workflow's test step runs under bash with the CT launcher
 * stubbed, so the assertions cover the arguments Playwright actually receives.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CT_CHANGED_MIN_REPEAT_EACH,
  CT_CHANGED_REPEAT_EACH,
  changedCtSpecs,
  changedFiles,
  ctChangedRepeatEach,
  main,
  playwrightFilter,
} from './ct-changed-specs.mjs';

const SCRIPT = resolve('scripts/ct-changed-specs.mjs');
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-changed-specs-'));
  temps.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(root: string, file: string, text = 'x') {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

// Mirrors Playwright's forceRegExp + createFileMatcher (playwright/lib/util.js).
function playwrightSelects(filter: string, absolutePath: string) {
  return new RegExp(filter, 'gi').test(absolutePath);
}

function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  let written = '';
  const code = main(argv, {
    log: (line: string) => out.push(line),
    warn: (line: string) => err.push(line),
    write: (text: string) => {
      written += text;
    },
  });
  return { code, out, err, written };
}

describe('changedCtSpecs', () => {
  it('keeps exactly the files Playwright CT discovers, sorted and deduplicated', () => {
    expect(
      changedCtSpecs([
        'src/b/z.ct.spec.ts',
        './src/a/y.CT.SPEC.TS',
        'src/b/z.ct.spec.ts',
        'src/a/plain.spec.ts',
        'src/a/unit.test.ts',
        'test/outside.ct.spec.ts',
        'src/a/z.ct.test.ts',
      ]),
    ).toEqual(['src/a/y.CT.SPEC.TS', 'src/b/z.ct.spec.ts']);
  });
});

describe('--diff against a real repository', () => {
  it('lists added, edited and moved specs but not deleted ones', () => {
    const repo = tempDir();
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'ci@example.com');
    git(repo, 'config', 'user.name', 'CI');
    write(repo, 'src/edit.ct.spec.ts');
    write(repo, 'src/delete.ct.spec.ts');
    write(repo, 'src/move/old.ct.spec.ts', 'stable body long enough to be detected as a rename');
    write(repo, 'src/untouched.ct.spec.ts');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'base');
    const base = git(repo, 'rev-parse', 'HEAD');

    write(repo, 'src/edit.ct.spec.ts', 'edited');
    rmSync(join(repo, 'src/delete.ct.spec.ts'));
    git(repo, 'mv', 'src/move/old.ct.spec.ts', 'src/move/new.ct.spec.ts');
    write(repo, 'src/routes/[id]/+page.ct.spec.ts');
    write(repo, 'src/lib/component.svelte');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'head');

    const cwd = process.cwd();
    process.chdir(repo);
    try {
      expect(changedCtSpecs(changedFiles(base, 'HEAD'))).toEqual([
        'src/edit.ct.spec.ts',
        'src/move/new.ct.spec.ts',
        'src/routes/[id]/+page.ct.spec.ts',
      ]);
    } finally {
      process.chdir(cwd);
    }

    const cli = spawnSync(process.execPath, [SCRIPT, '--diff', base, 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    expect(cli.status).toBe(0);
    expect(cli.stdout.trim().split('\n').at(-1)).toBe(
      'ct_changed_specs=["src/edit.ct.spec.ts","src/move/new.ct.spec.ts","src/routes/[id]/+page.ct.spec.ts"]',
    );
  });

  it('prints an empty list when no spec changed', () => {
    const result = main(['--diff', 'a', 'b'], {
      diff: () => ['src/lib/x.svelte'],
      log: (line: string) => expect(line).toBe('ct_changed_specs=[]'),
    });
    expect(result).toBe(0);
  });

  it('fails closed with `error` when git fails or arguments are wrong', () => {
    for (const argv of [
      ['--diff', 'a', 'b'],
      ['--diff', 'a'],
      ['--diff', 'a', 'b', 'c'],
    ]) {
      const out: string[] = [];
      main(argv, {
        diff: () => {
          throw new Error('bad revision');
        },
        log: (line: string) => out.push(line),
        warn: () => {},
      });
      expect(out).toEqual(['ct_changed_specs=error']);
    }
  });
});

describe('--filters', () => {
  it('selects each listed spec and nothing that merely resembles it', () => {
    const root = '/runner/work/cloudlands-fe/cloudlands-fe';
    const spec = 'src/routes/[id]/+page.ct.spec.ts';
    const filter = playwrightFilter(spec);
    expect(playwrightSelects(filter, `${root}/${spec}`)).toBe(true);
    for (const other of [
      'src/routes/i/+page.ct.spec.ts',
      'src/routes/[id]/x+page.ct.spec.ts',
      'src/routes/[id]/+page.ct.spec.tsx',
      'src/routes/[id]/+pageXctXspecXts',
      'xsrc/routes/[id]/+page.ct.spec.ts',
    ]) {
      expect(playwrightSelects(filter, `${root}/${other}`), other).toBe(false);
    }
  });

  it('writes one NUL-terminated filter per spec', () => {
    const specs = ['src/a.ct.spec.ts', 'src/b.ct.spec.ts'];
    const { code, written } = run(['--filters', JSON.stringify(specs)]);
    expect(code).toBe(0);
    expect(written.split('\0')).toEqual([...specs.map(playwrightFilter), '']);
  });

  it('rejects an error marker, an empty list and non-spec paths', () => {
    for (const value of ['error', '', '[]', '["src/a.test.ts"]', '{"a":1}', '[1]']) {
      expect(run(['--filters', value]).code, value).toBe(1);
    }
    expect(run(['--filters']).code).toBe(2);
  });
});

describe('repetition count', () => {
  it('repeats a few specs 20 times and scales down for mass edits', () => {
    expect(CT_CHANGED_REPEAT_EACH).toBe(20);
    expect(ctChangedRepeatEach(1)).toBe(20);
    expect(ctChangedRepeatEach(10)).toBe(20);
    expect(ctChangedRepeatEach(40)).toBe(5);
    expect(ctChangedRepeatEach(1000)).toBe(CT_CHANGED_MIN_REPEAT_EACH);
    expect(run(['--repeat-each', '["src/a.ct.spec.ts"]']).written).toBe('20\n');
  });
});

const workflowLines = readFileSync(resolve('.github/workflows/intent-pr.yml'), 'utf8').split('\n');

// Top-level job blocks live at a two-space indent under `jobs:`.
function jobLines(name: string): string[] {
  const start = workflowLines.indexOf(`  ${name}:`);
  if (start === -1) throw new Error(`job ${name} not found`);
  const rest = workflowLines.slice(start + 1);
  const end = rest.findIndex((text) => /^ {2}[\w-]+:/.test(text));
  return rest.slice(0, end === -1 ? rest.length : end);
}

// Body of a `run: |` block for the named step, dedented to column 0.
function stepRun(lines: string[], stepName: string): string {
  const step = lines.indexOf(`      - name: ${stepName}`);
  if (step === -1) throw new Error(`step ${stepName} not found`);
  const runLine = lines.findIndex((text, index) => index > step && text === '        run: |');
  if (runLine === -1) throw new Error(`step ${stepName} has no run block`);
  const body: string[] = [];
  for (const text of lines.slice(runLine + 1)) {
    if (text.trim() !== '' && !text.startsWith('          ')) break;
    body.push(text.slice(10));
  }
  return body.join('\n');
}

describe('test-ct-changed workflow job', () => {
  const job = jobLines('test-ct-changed');
  const field = (key: string) =>
    job
      .find((text) => text.startsWith(`    ${key}:`))
      ?.slice(`    ${key}:`.length)
      .trim() ?? '';

  it('runs on pull requests only when the spec list is not empty', () => {
    expect(field('if')).toContain("github.event_name == 'pull_request'");
    expect(field('if')).toContain("needs.release-fast-path.outputs.ct_changed_specs != '[]'");
    expect(job).toContain(
      '      CT_CHANGED_SPECS: ${{ needs.release-fast-path.outputs.ct_changed_specs }}',
    );
    expect(jobLines('release-fast-path')).toContain(
      '      ct_changed_specs: ${{ steps.ct-changed.outputs.ct_changed_specs }}',
    );
    expect(jobLines('gate')).toContain('        test-ct-changed,');
  });

  it('lists the specs with the helper in the diff classifier, failing closed', () => {
    const dir = tempDir();
    const output = join(dir, 'out');
    writeFileSync(output, '');
    const result = spawnSync(
      'bash',
      [
        '-e',
        '-o',
        'pipefail',
        '-c',
        stepRun(jobLines('release-fast-path'), 'List changed component test specs'),
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          BASE_SHA: 'not-a-revision',
          GITHUB_OUTPUT: output,
        },
      },
    );
    expect(result.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('ct_changed_specs=error\n');
  });

  it('writes an empty list when the diff has no spec changes', () => {
    const dir = tempDir();
    const output = join(dir, 'out');
    writeFileSync(output, '');
    const result = spawnSync(
      'bash',
      [
        '-e',
        '-o',
        'pipefail',
        '-c',
        stepRun(jobLines('release-fast-path'), 'List changed component test specs'),
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '', BASE_SHA: 'HEAD', GITHUB_OUTPUT: output },
      },
    );
    expect(result.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('ct_changed_specs=[]\n');
  });

  // Runs the workflow's own step under bash with `node scripts/run-ct-tests.mjs`
  // replaced by a stub that records its argv, one argument per line.
  function runTestStep(specs: string) {
    const dir = tempDir();
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const record = join(dir, 'argv');
    writeFileSync(
      join(bin, 'node'),
      `#!/usr/bin/env bash\nif [ "$1" = scripts/run-ct-tests.mjs ]; then shift; printf '%s\\n' "$@" > "${record}"; exit 0; fi\nNODE_OPTIONS= exec "${process.execPath}" "$@"\n`,
    );
    chmodSync(join(bin, 'node'), 0o755);
    const result = spawnSync(
      'bash',
      ['-e', '-o', 'pipefail', '-c', stepRun(job, 'Repeat changed component tests')],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          CT_CHANGED_SPECS: specs,
          RUNNER_TEMP: dir,
        },
      },
    );
    let argv: string[] = [];
    try {
      argv = readFileSync(record, 'utf8').trimEnd().split('\n');
    } catch {}
    return { status: result.status, argv, stderr: result.stderr };
  }

  it('passes every changed spec, 20 repetitions and no retries to the CT launcher', () => {
    const specs = ['src/a/one.ct.spec.ts', 'src/routes/[id]/two.ct.spec.ts'];
    const { status, argv, stderr } = runTestStep(JSON.stringify(specs));
    expect(status, stderr).toBe(0);
    expect(argv.slice(0, 2)).toEqual(specs.map(playwrightFilter));
    expect(argv).toContain('--repeat-each=20');
    expect(argv).toContain('--retries=0');
    expect(argv).toContain('--fail-on-flaky-tests');
    expect(argv).not.toContain('--pass-with-no-tests');
  });

  it('fails before launching tests when the spec list is an error marker', () => {
    const { status, argv } = runTestStep('error');
    expect(status).not.toBe(0);
    expect(argv).toEqual([]);
  });
});
