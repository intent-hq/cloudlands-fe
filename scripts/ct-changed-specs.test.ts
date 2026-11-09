// @verify-changed-triggers: .github/workflows/intent-pr.yml, scripts/ct-changed-specs.mjs,
//   scripts/ct-changed-repeat.mjs, scripts/ct-contract-paths.mjs, playwright/ct-spec-pattern.mjs
// @vitest-environment node

/**
 * The changed-spec list and repetition helpers the local stress runner
 * (scripts/ct-changed-repeat.mjs) uses, and the release-fast-path step that
 * resolves the diff base for every relevance step in intent-pr.yml. The
 * runner's spec selection (localChangedSpecs) runs against real temporary git
 * repositories and the step under bash.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { localChangedSpecs } from './ct-changed-repeat.mjs';
import {
  CT_CHANGED_MIN_REPEAT_EACH,
  CT_CHANGED_REPEAT_EACH,
  CT_CHANGED_TEST_RUN_BUDGET,
  changedCtSpecs,
  ctChangedRepeatEach,
  listedCtTests,
  playwrightFilter,
} from './ct-changed-specs.mjs';
import { spawnWorkflowBash } from './workflow-shell-fixture';

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

function commitAll(repo: string, message: string) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function initRepo() {
  const repo = tempDir();
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'ci@example.com');
  git(repo, 'config', 'user.name', 'CI');
  return repo;
}

// A Playwright `--list --reporter=json` report: one suite per spec file, each
// holding `tests` specs of one test, the second half nested in a describe.
function listReport(files: Record<string, number>, errors: unknown[] = []) {
  return {
    config: {},
    errors,
    stats: {},
    suites: Object.entries(files).map(([file, tests]) => {
      const spec = (i: number) => ({ title: `t${i}`, tests: [{ projectName: 'chromium' }] });
      const top = Math.ceil(tests / 2);
      return {
        file,
        specs: Array.from({ length: top }, (_, i) => spec(i)),
        suites: [
          { title: 'nested', specs: Array.from({ length: tests - top }, (_, i) => spec(i)) },
        ],
      };
    }),
  };
}

// The 10 dock specs of cloudlands-fe#4047 as `--list` discovered them: 86 tests,
// which a spec-file budget
// planned at 20 repetitions (1720 runs); the 45-minute job could not finish.
const DOCK_4047 = {
  'dock-annotation-overlay.ct.spec.ts': 8,
  'dock-conversation-paste.ct.spec.ts': 6,
  'dock-conversation.ct.spec.ts': 21,
  'dock-edge-shell.ct.spec.ts': 4,
  'dock-intro.ct.spec.ts': 8,
  'dock-mode-visual.ct.spec.ts': 22,
  'dock-motion-audit.ct.spec.ts': 8,
  'dock-notch-picker.ct.spec.ts': 1,
  'dock-rail-preview.ct.spec.ts': 5,
  'dock-side-hover.ct.spec.ts': 3,
};

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

describe('localChangedSpecs against a real repository', () => {
  it('lists added, edited and moved specs but not deleted ones', () => {
    const repo = initRepo();
    write(repo, 'src/edit.ct.spec.ts');
    write(repo, 'src/delete.ct.spec.ts');
    write(repo, 'src/move/old.ct.spec.ts', 'stable body long enough to be detected as a rename');
    write(repo, 'src/untouched.ct.spec.ts');
    const base = commitAll(repo, 'base');

    write(repo, 'src/edit.ct.spec.ts', 'edited');
    rmSync(join(repo, 'src/delete.ct.spec.ts'));
    git(repo, 'mv', 'src/move/old.ct.spec.ts', 'src/move/new.ct.spec.ts');
    write(repo, 'src/routes/[id]/+page.ct.spec.ts');
    write(repo, 'src/lib/component.svelte');
    commitAll(repo, 'head');

    expect(localChangedSpecs(base, { cwd: repo }).specs).toEqual([
      'src/edit.ct.spec.ts',
      'src/move/new.ct.spec.ts',
      'src/routes/[id]/+page.ct.spec.ts',
    ]);
  });
});

// A PR branch and a main that moved ahead after it branched. main edits a
// spec; the branch edits its own spec only.
function divergedRepo() {
  const repo = initRepo();
  write(repo, 'src/pr/own.ct.spec.ts', 'v1');
  write(repo, 'src/main/edited-on-main.ct.spec.ts', 'v1');
  const branched = commitAll(repo, 'branch point');
  git(repo, 'checkout', '-q', '-b', 'pr');
  write(repo, 'src/pr/own.ct.spec.ts', 'v2');
  const prHead = commitAll(repo, 'pr change');
  git(repo, 'checkout', '-q', 'main');
  write(repo, 'src/main/edited-on-main.ct.spec.ts', 'v2');
  const mainTip = commitAll(repo, 'main moves ahead');
  // Lets clones fetch a commit that is no longer a branch tip by its SHA under
  // any protocol version, as GitHub serves the event SHAs.
  git(repo, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  return { repo, branched, prHead, mainTip };
}

function specs(cwd: string, base: string) {
  return localChangedSpecs(base, { cwd }).specs;
}

// cloudlands-fe#4114 (job 126070303811) repeated seven specs, six of them
// changed only on main, and was cancelled at its time limit: the diff ran
// from a base that main had since moved past. The selection diffs from the
// merge-base of base and HEAD (diffBase), so only the branch's own changes count.
describe('a base that moved ahead of the branch', () => {
  it('lists only the branch’s own specs', () => {
    const { repo, mainTip } = divergedRepo();
    git(repo, 'checkout', '-q', 'pr');
    expect(specs(repo, mainTip)).toEqual(['src/pr/own.ct.spec.ts']);
  });

  it('falls back to the base itself when no merge-base is reachable', () => {
    const { repo, branched, prHead } = divergedRepo();
    const shallow = tempDir();
    git(shallow, 'init', '-q');
    git(shallow, 'fetch', '-q', '--depth=1', `file://${repo}`, prHead);
    git(shallow, 'fetch', '-q', '--depth=1', `file://${repo}`, branched);
    git(shallow, 'checkout', '-q', prHead);
    expect(specs(shallow, branched)).toEqual(['src/pr/own.ct.spec.ts']);
  });
});

describe('playwrightFilter', () => {
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
});

describe('repetition count', () => {
  it('spreads a budget of test runs over the discovered tests, 3 to 20 each', () => {
    expect(CT_CHANGED_REPEAT_EACH).toBe(20);
    expect(CT_CHANGED_MIN_REPEAT_EACH).toBe(3);
    expect(CT_CHANGED_TEST_RUN_BUDGET).toBe(800);
    expect(ctChangedRepeatEach(1)).toBe(20);
    expect(ctChangedRepeatEach(40)).toBe(20);
    expect(ctChangedRepeatEach(41)).toBe(19);
    expect(ctChangedRepeatEach(86)).toBe(9);
    expect(ctChangedRepeatEach(266)).toBe(3);
    // Past the budget the floor holds: never fewer than 3 repetitions.
    expect(ctChangedRepeatEach(1000)).toBe(3);
  });

  it('rejects a test count that is not a positive integer', () => {
    for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => ctChangedRepeatEach(count), String(count)).toThrow(/positive number/);
    }
  });

  it('sizes by tests, not files: one large spec and many small ones', () => {
    // The #4047 case: 10 specs, 86 tests -> 9 repetitions, 774 runs.
    expect(listedCtTests(listReport(DOCK_4047)).total).toBe(86);
    expect(ctChangedRepeatEach(listedCtTests(listReport(DOCK_4047)).total)).toBe(9);
    // One spec holding the same 86 tests gets the same 9, not 20.
    expect(ctChangedRepeatEach(listedCtTests(listReport({ 'big.ct.spec.ts': 86 })).total)).toBe(9);
    // Ten one-test specs keep the full 20.
    const small = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`s${i}.ct.spec.ts`, 1]));
    expect(ctChangedRepeatEach(listedCtTests(listReport(small)).total)).toBe(20);
  });
});

describe('listedCtTests', () => {
  it('counts tests per spec file through nested suites', () => {
    expect(listedCtTests(listReport({ 'a.ct.spec.ts': 3, 'b.ct.spec.ts': 1 }))).toEqual({
      total: 4,
      files: [
        { file: 'a.ct.spec.ts', tests: 3 },
        { file: 'b.ct.spec.ts', tests: 1 },
      ],
    });
  });

  it('fails closed on discovery errors, zero tests and malformed reports', () => {
    expect(() =>
      listedCtTests(
        listReport({ 'a.ct.spec.ts': 2 }, [{ message: 'SyntaxError in a.ct.spec.ts' }]),
      ),
    ).toThrow(/discovery failed: SyntaxError/);
    expect(() => listedCtTests(listReport({ 'a.ct.spec.ts': 0 }))).toThrow(/no tests/);
    expect(() => listedCtTests(listReport({}))).toThrow(/no tests/);
    for (const report of [
      null,
      [],
      {},
      { errors: [] },
      { suites: [] },
      { errors: [], suites: [{ file: 'a', specs: [{ title: 'x' }] }] },
      { errors: [], suites: [null] },
    ]) {
      expect(() => listedCtTests(report), JSON.stringify(report)).toThrow();
    }
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

// The release-fast-path step that picks $BASE_SHA for every relevance step,
// under bash against the checkout shape of cloudlands-fe#4114: HEAD is
// GitHub's merge commit of the PR head onto the current main tip, while
// pull_request.base.sha still names the older main the PR was pushed against.
describe('release-fast-path diff base', () => {
  function resolveBase(cwd: string, env: Record<string, string>) {
    const githubEnv = join(tempDir(), 'env');
    writeFileSync(githubEnv, '');
    const result = spawnWorkflowBash(
      ['-e', '-o', 'pipefail', '-c', stepRun(jobLines('release-fast-path'), 'Resolve diff base')],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          PR_HEAD_SHA: '',
          ...env,
          GITHUB_ENV: githubEnv,
          GITHUB_WORKSPACE: process.cwd(),
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    return readFileSync(githubEnv, 'utf8');
  }

  // CI's shape: refs/pull/N/merge checked out at depth 2, plus the event base
  // fetched at depth 1 (as the job did before it resolved the base itself).
  function prMergeCheckout() {
    const { repo, branched, prHead, mainTip } = divergedRepo();
    git(repo, 'checkout', '-q', '--detach', mainTip);
    git(repo, 'merge', '-q', '--no-ff', '-m', `Merge ${prHead} into ${mainTip}`, prHead);
    git(repo, 'update-ref', 'refs/pull/1/merge', 'HEAD');
    const checkout = tempDir();
    git(checkout, 'init', '-q');
    git(checkout, 'remote', 'add', 'origin', `file://${repo}`);
    git(checkout, 'fetch', '-q', '--depth=2', 'origin', 'refs/pull/1/merge');
    git(checkout, 'checkout', '-q', 'FETCH_HEAD');
    git(checkout, 'fetch', '-q', '--depth=1', 'origin', branched);
    expect(git(checkout, 'rev-parse', '--is-shallow-repository')).toBe('true');
    return { checkout, branched, prHead, mainTip };
  }

  it('checks out the merge commit and its parents', () => {
    const job = jobLines('release-fast-path');
    const checkout = job.indexOf('      - uses: actions/checkout@v7');
    expect(job.slice(checkout, checkout + 4)).toContain('          fetch-depth: 2');
    expect(job.filter((line) => line.includes('BASE_SHA: ${{'))).toEqual([
      '          EVENT_BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}',
    ]);
  });

  it('uses the merge commit’s first parent, not a lagging pull_request.base.sha', () => {
    const { checkout, branched, prHead, mainTip } = prMergeCheckout();
    expect(resolveBase(checkout, { EVENT_BASE_SHA: branched, PR_HEAD_SHA: prHead })).toBe(
      `BASE_SHA=${mainTip}\n`,
    );
    // The lagging base reproduces the incident; the resolved one does not.
    expect(specs(checkout, branched)).toEqual([
      'src/main/edited-on-main.ct.spec.ts',
      'src/pr/own.ct.spec.ts',
    ]);
    expect(specs(checkout, mainTip)).toEqual(['src/pr/own.ct.spec.ts']);
  });

  it('keeps the event base, fetched, when HEAD is not a merge of the PR head', () => {
    const { repo, branched, prHead } = divergedRepo();
    // Queue entries have no PR head; a PR checked out at its head keeps it too.
    for (const env of [
      { EVENT_BASE_SHA: branched },
      { EVENT_BASE_SHA: branched, PR_HEAD_SHA: prHead },
    ]) {
      const checkout = tempDir();
      git(checkout, 'init', '-q');
      git(checkout, 'remote', 'add', 'origin', `file://${repo}`);
      git(checkout, 'fetch', '-q', '--depth=1', 'origin', prHead);
      git(checkout, 'checkout', '-q', prHead);
      const present = () =>
        spawnSync('git', ['cat-file', '-e', `${branched}^{commit}`], { cwd: checkout }).status;
      expect(present()).not.toBe(0);
      expect(resolveBase(checkout, env)).toBe(`BASE_SHA=${branched}\n`);
      expect(present()).toBe(0);
    }
  });
});
