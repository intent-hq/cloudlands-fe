// @verify-changed-triggers: .github/workflows/intent-pr.yml, scripts/ct-changed-specs.mjs,
//   scripts/ct-contract-paths.mjs, playwright/ct-spec-pattern.mjs, src/lib/components/chat/**
// @vitest-environment node

/**
 * The changed-spec repetition job (`test-ct-changed` in intent-pr.yml), the
 * affected-spec job (`test-ct-affected`) and the script that feeds both. The diff mode runs against a real temporary git
 * repository; the workflow's test step runs under bash with the CT launcher
 * stubbed, so the assertions cover the arguments Playwright actually receives.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CT_AFFECTED_BUDGET,
  CT_CHANGED_MIN_REPEAT_EACH,
  CT_CHANGED_REPEAT_EACH,
  CT_CHANGED_TEST_RUN_BUDGET,
  affectedCtSpecs,
  changedCtSpecs,
  changedFiles,
  ctChangedRepeatEach,
  listedCtTests,
  main,
  overBudgetNote,
  playwrightFilter,
} from './ct-changed-specs.mjs';
import { ctImportGraph } from './ct-contract-paths.mjs';

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

// `edges` in ctImportGraph's shape from a plain object.
function graphOf(edges: Record<string, string[]>, headSpecs: string[]) {
  return {
    edges: new Map(Object.entries(edges).map(([from, to]) => [from, new Set(to)])),
    headSpecs,
  };
}

function run(argv: string[], readReport?: (path: string) => string) {
  const out: string[] = [];
  const err: string[] = [];
  let written = '';
  const code = main(argv, {
    log: (line: string) => out.push(line),
    warn: (line: string) => err.push(line),
    write: (text: string) => {
      written += text;
    },
    ...(readReport ? { readReport } : {}),
  });
  return { code, out, err, written };
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

describe('affectedCtSpecs', () => {
  it('lists the specs that load a changed file, nearest first, with the path to it', () => {
    const graph = graphOf(
      {
        'src/a.ct.spec.ts': ['src/AHost.svelte'],
        'src/AHost.svelte': ['src/Panel.svelte'],
        'src/b.ct.spec.ts': ['src/Panel.svelte', 'src/Other.svelte'],
        'src/c.ct.spec.ts': ['src/Other.svelte'],
        'src/Panel.svelte': ['src/store.ts'],
      },
      ['src/a.ct.spec.ts', 'src/b.ct.spec.ts', 'src/c.ct.spec.ts'],
    );
    expect(affectedCtSpecs(graph, ['src/Panel.svelte'])).toEqual([
      { spec: 'src/b.ct.spec.ts', via: 'src/Panel.svelte', distance: 1 },
      { spec: 'src/a.ct.spec.ts', via: 'src/Panel.svelte', distance: 2 },
    ]);
    expect(affectedCtSpecs(graph, ['src/unrelated.ts'])).toEqual([]);
  });

  it('leaves out changed specs and specs missing from the head tree', () => {
    const graph = graphOf(
      {
        'src/a.ct.spec.ts': ['src/Panel.svelte'],
        'src/gone.ct.spec.ts': ['src/Panel.svelte'],
        'src/edited.ct.spec.ts': ['src/Panel.svelte'],
      },
      ['src/a.ct.spec.ts', 'src/edited.ct.spec.ts'],
    );
    expect(
      affectedCtSpecs(graph, ['src/Panel.svelte', 'src/edited.ct.spec.ts']).map(({ spec }) => spec),
    ).toEqual(['src/a.ct.spec.ts']);
  });

  it('follows import cycles without looping and keeps the shortest distance', () => {
    const graph = graphOf(
      {
        'src/a.ct.spec.ts': ['src/X.svelte', 'src/Y.svelte'],
        'src/X.svelte': ['src/Y.svelte'],
        'src/Y.svelte': ['src/X.svelte'],
      },
      ['src/a.ct.spec.ts'],
    );
    expect(affectedCtSpecs(graph, ['src/Y.svelte'])).toEqual([
      { spec: 'src/a.ct.spec.ts', via: 'src/Y.svelte', distance: 1 },
    ]);
  });

  it('gives every changed file its nearest specs before a hub fills the budget', () => {
    // A store hub loaded (directly) by many specs and a leaf component that
    // one spec mounts two edges away: the leaf's spec must come second, not
    // after every hub spec.
    const hubSpecs = Array.from(
      { length: CT_AFFECTED_BUDGET * 2 },
      (_, i) => `src/hub/${String(i).padStart(3, '0')}.ct.spec.ts`,
    );
    const edges: Record<string, string[]> = {
      'src/z/leaf.ct.spec.ts': ['src/z/LeafHost.svelte'],
      'src/z/LeafHost.svelte': ['src/z/Leaf.svelte'],
    };
    for (const spec of hubSpecs) edges[spec] = ['src/store/hub.ts'];
    const graph = graphOf(edges, [...hubSpecs, 'src/z/leaf.ct.spec.ts']);
    const ranked = affectedCtSpecs(graph, ['src/store/hub.ts', 'src/z/Leaf.svelte']);
    expect(ranked).toHaveLength(hubSpecs.length + 1);
    expect(ranked.slice(0, 2)).toEqual([
      { spec: hubSpecs[0], via: 'src/store/hub.ts', distance: 1 },
      { spec: 'src/z/leaf.ct.spec.ts', via: 'src/z/Leaf.svelte', distance: 2 },
    ]);
  });
});

describe('--affected against a real repository', () => {
  it('selects a spec two imports above a changed component, and not unrelated specs', () => {
    const repo = initRepo();
    write(repo, 'src/chat/Panel.svelte', '<script lang="ts">\n  let x = 1;\n</script>\n');
    write(
      repo,
      'src/chat/__tests__/PanelHost.svelte',
      '<script lang="ts">\n  import Panel from \'../Panel.svelte\';\n</script>\n<Panel />\n',
    );
    write(
      repo,
      'src/chat/__tests__/panel.ct.spec.ts',
      "import Host from './PanelHost.svelte';\nexport { Host };\n",
    );
    write(repo, 'src/other/other.ct.spec.ts', "import { y } from './y';\nexport { y };\n");
    write(repo, 'src/other/y.ts', 'export const y = 1;\n');
    write(
      repo,
      'src/chat/edited.ct.spec.ts',
      "import Panel from './Panel.svelte';\nexport { Panel };\n",
    );
    const base = commitAll(repo, 'base');
    write(repo, 'src/chat/Panel.svelte', '<script lang="ts">\n  let x = 2;\n</script>\n');
    write(
      repo,
      'src/chat/edited.ct.spec.ts',
      "import Panel from './Panel.svelte';\nexport { Panel as P };\n",
    );
    commitAll(repo, 'head');

    const cli = spawnSync(process.execPath, [SCRIPT, '--affected', base, 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    expect(cli.status, cli.stderr).toBe(0);
    const lines = cli.stdout.trim().split('\n');
    expect(lines.slice(-2)).toEqual([
      'ct_affected_specs=["src/chat/__tests__/panel.ct.spec.ts"]',
      'ct_affected_over_budget=[]',
    ]);
    expect(lines[0]).toContain('src/chat/Panel.svelte');
  });

  it('runs the first CT_AFFECTED_BUDGET specs and reports the rest as over budget', () => {
    const specs = Array.from(
      { length: CT_AFFECTED_BUDGET + 2 },
      (_, i) => `src/s${String(i).padStart(3, '0')}.ct.spec.ts`,
    );
    const out: string[] = [];
    main(['--affected', 'base', 'head'], {
      diff: () => ['src/hub.ts'],
      graph: () => graphOf(Object.fromEntries(specs.map((spec) => [spec, ['src/hub.ts']])), specs),
      log: (line: string) => out.push(line),
    });
    expect(out.at(-2)).toBe(
      `ct_affected_specs=${JSON.stringify(specs.slice(0, CT_AFFECTED_BUDGET))}`,
    );
    expect(out.at(-1)).toBe(
      `ct_affected_over_budget=${JSON.stringify(specs.slice(CT_AFFECTED_BUDGET))}`,
    );
    expect(out.filter((line) => line.startsWith('over budget: '))).toHaveLength(2);
  });

  it('fails closed with `error` when the graph or diff fails or arguments are wrong', () => {
    for (const argv of [
      ['--affected', 'a', 'b'],
      ['--affected', 'a'],
      ['--affected', 'a', 'b', 'c'],
    ]) {
      const out: string[] = [];
      main(argv, {
        diff: () => ['src/x.ts'],
        graph: () => {
          throw new Error('unsupported CT dependency syntax');
        },
        log: (line: string) => out.push(line),
        warn: () => {},
      });
      expect(out).toEqual(['ct_affected_specs=error', 'ct_affected_over_budget=[]']);
    }
  });
});

// A PR branch and a main that moved ahead after it branched. main edits a spec
// and a component another spec loads; the branch edits its own spec only.
function divergedRepo() {
  const repo = initRepo();
  write(repo, 'src/pr/own.ct.spec.ts', 'v1');
  write(repo, 'src/main/edited-on-main.ct.spec.ts', 'v1');
  write(repo, 'src/main/Widget.svelte', '<p>v1</p>\n');
  write(
    repo,
    'src/main/widget.ct.spec.ts',
    "import Widget from './Widget.svelte';\nexport { Widget };\n",
  );
  const branched = commitAll(repo, 'branch point');
  git(repo, 'checkout', '-q', '-b', 'pr');
  write(repo, 'src/pr/own.ct.spec.ts', 'v2');
  const prHead = commitAll(repo, 'pr change');
  git(repo, 'checkout', '-q', 'main');
  write(repo, 'src/main/edited-on-main.ct.spec.ts', 'v2');
  write(repo, 'src/main/Widget.svelte', '<p>v2</p>\n');
  const mainTip = commitAll(repo, 'main moves ahead');
  // Lets clones fetch a commit that is no longer a branch tip by its SHA under
  // any protocol version, as GitHub serves the event SHAs.
  git(repo, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  return { repo, branched, prHead, mainTip };
}

function cli(repo: string, ...argv: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...argv], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim().split('\n');
}

// cloudlands-fe#4114 (job 126070303811) repeated seven specs, six of them
// changed only on main, and was cancelled at its time limit: the diff ran
// from a base that main had since moved past. Both modes diff from the
// merge-base of base and head, so only the branch's own changes count.
describe('a base that moved ahead of the branch', () => {
  it('--diff lists only the branch’s own specs', () => {
    const { repo, prHead, mainTip } = divergedRepo();
    expect(cli(repo, '--diff', mainTip, prHead).at(-1)).toBe(
      'ct_changed_specs=["src/pr/own.ct.spec.ts"]',
    );
  });

  it('--affected leaves out specs that load files only main changed', () => {
    const { repo, prHead, mainTip } = divergedRepo();
    expect(cli(repo, '--affected', mainTip, prHead).slice(-2)).toEqual([
      'ct_affected_specs=[]',
      'ct_affected_over_budget=[]',
    ]);
  });

  it('falls back to the base itself when no merge-base is reachable', () => {
    const { repo, branched, prHead } = divergedRepo();
    const shallow = tempDir();
    git(shallow, 'init', '-q');
    git(shallow, 'fetch', '-q', '--depth=1', `file://${repo}`, prHead);
    git(shallow, 'fetch', '-q', '--depth=1', `file://${repo}`, branched);
    git(shallow, 'checkout', '-q', prHead);
    expect(cli(shallow, '--diff', branched, 'HEAD').at(-1)).toBe(
      'ct_changed_specs=["src/pr/own.ct.spec.ts"]',
    );
  });
});

// cloudlands-fe#4029's first ChatPanel commit (180340be9) changed these files;
// the queue then failed chat-panel-composer-geometry.ct.spec.ts. Replayed
// against this checkout's committed tree, which a shallow CI clone has, so the
// selector and budget keep covering the incident as the spec graph evolves.
describe('cloudlands-fe#4029 replay', () => {
  const geometrySpec = 'src/lib/components/chat/__tests__/chat-panel-composer-geometry.ct.spec.ts';
  const graph = ctImportGraph('HEAD', 'HEAD');
  const selected = (changed: string[]) =>
    affectedCtSpecs(graph, changed)
      .slice(0, CT_AFFECTED_BUDGET)
      .map(({ spec }) => spec);

  it('selects the geometry spec for the commit that first changed ChatPanel', () => {
    expect(
      selected([
        'src/lib/components/chat/ChatPanel.svelte',
        'src/lib/components/chat/__tests__/ChatPanelComposerGeometryHost.svelte',
        'src/lib/components/chat/__tests__/optimistic-conversation-layout.ct.spec.ts',
      ]),
    ).toContain(geometrySpec);
  });

  it('selects it from the ChatPanel edit alone', () => {
    expect(selected(['src/lib/components/chat/ChatPanel.svelte'])).toContain(geometrySpec);
  });
});

describe('--over-budget', () => {
  it('names every spec over the budget', () => {
    const note = overBudgetNote(['src/a.ct.spec.ts'], ['src/b.ct.spec.ts', 'src/c.ct.spec.ts']);
    expect(note).toContain(`budget: ${CT_AFFECTED_BUDGET}`);
    expect(note).toContain('- src/b.ct.spec.ts\n- src/c.ct.spec.ts');
    expect(overBudgetNote(['src/a.ct.spec.ts'], [])).not.toContain('not run');
    const { code, written } = run([
      '--over-budget',
      '["src/a.ct.spec.ts"]',
      '["src/b.ct.spec.ts"]',
    ]);
    expect(code).toBe(0);
    expect(written).toContain('- src/b.ct.spec.ts');
  });

  it('rejects an error marker in either list', () => {
    expect(run(['--over-budget', 'error', '[]']).code).toBe(1);
    expect(run(['--over-budget', '["src/a.ct.spec.ts"]', 'error']).code).toBe(1);
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

describe('--repeat-each-listed', () => {
  const reading = (report: unknown) => () => JSON.stringify(report);

  it('prints the repetitions for the listed tests and logs the plan', () => {
    const { code, written, err } = run(
      ['--repeat-each-listed', 'list.json'],
      reading(listReport(DOCK_4047)),
    );
    expect(code).toBe(0);
    expect(written).toBe('9\n');
    expect(err.at(-1)).toBe(
      'Discovered 86 tests in 10 spec files; repeating each 9 times (774 runs; budget 800, 3-20 repetitions).',
    );
  });

  it('exits 1 without a count for an unreadable, malformed, failed or empty listing', () => {
    const cases: Array<() => string> = [
      () => {
        throw new Error('ENOENT: list.json');
      },
      () => 'not json',
      () => '',
      reading({ suites: 'x' }),
      reading(listReport({ 'a.ct.spec.ts': 1 }, [{ message: 'boom' }])),
      reading(listReport({ 'a.ct.spec.ts': 0 })),
    ];
    for (const readReport of cases) {
      const { code, written } = run(['--repeat-each-listed', 'list.json'], readReport);
      expect(code).toBe(1);
      expect(written).toBe('');
    }
  });

  it('rejects the retired spec-count mode and a missing report path', () => {
    expect(run(['--repeat-each', '["src/a.ct.spec.ts"]']).code).toBe(2);
    expect(run(['--repeat-each-listed']).code).toBe(2);
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
    const result = spawnSync(
      'bash',
      ['-e', '-o', 'pipefail', '-c', stepRun(jobLines('release-fast-path'), 'Resolve diff base')],
      {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, PR_HEAD_SHA: '', ...env, GITHUB_ENV: githubEnv },
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
    expect(cli(checkout, '--diff', branched, 'HEAD').at(-1)).toBe(
      'ct_changed_specs=["src/main/edited-on-main.ct.spec.ts","src/pr/own.ct.spec.ts"]',
    );
    expect(cli(checkout, '--diff', mainTip, 'HEAD').at(-1)).toBe(
      'ct_changed_specs=["src/pr/own.ct.spec.ts"]',
    );
    expect(cli(checkout, '--affected', mainTip, 'HEAD').slice(-2)).toEqual([
      'ct_affected_specs=[]',
      'ct_affected_over_budget=[]',
    ]);
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
  // A `--list` call instead writes `list` (a Playwright JSON report) to
  // $PLAYWRIGHT_JSON_OUTPUT_FILE, records its argv and exits `listExit`.
  function runTestStep(
    specs: string,
    list: unknown = listReport({ 'a.ct.spec.ts': 2 }),
    listExit = 0,
  ) {
    const dir = tempDir();
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const record = join(dir, 'argv');
    const listRecord = join(dir, 'list-argv');
    const listJson = join(dir, 'list-fixture.json');
    writeFileSync(listJson, JSON.stringify(list));
    writeFileSync(
      join(bin, 'node'),
      [
        '#!/usr/bin/env bash',
        'if [ "$1" = scripts/run-ct-tests.mjs ]; then',
        '  shift',
        '  for arg in "$@"; do',
        '    if [ "$arg" = --list ]; then',
        `      printf '%s\\n' "$@" > "${listRecord}"`,
        `      cp "${listJson}" "$PLAYWRIGHT_JSON_OUTPUT_FILE"`,
        `      exit ${listExit}`,
        '    fi',
        '  done',
        `  printf '%s\\n' "$@" > "${record}"`,
        '  exit 0',
        'fi',
        `NODE_OPTIONS= exec "${process.execPath}" "$@"`,
        '',
      ].join('\n'),
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
    const lines = (path: string) => {
      try {
        return readFileSync(path, 'utf8').trimEnd().split('\n');
      } catch {
        return [];
      }
    };
    return {
      status: result.status,
      argv: lines(record),
      listArgv: lines(listRecord),
      stderr: result.stderr,
    };
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

  it('lists the same filtered, unquarantined tests first and repeats by their count', () => {
    const specs = Object.keys(DOCK_4047).map((file) => `src/features/hud/components/${file}`);
    const { status, argv, listArgv, stderr } = runTestStep(
      JSON.stringify(specs),
      listReport(DOCK_4047),
    );
    expect(status, stderr).toBe(0);
    expect(listArgv).toEqual([
      ...specs.map(playwrightFilter),
      '--list',
      '--grep-invert',
      '@quarantine\\b',
      '--reporter=json',
    ]);
    expect(argv.slice(0, specs.length)).toEqual(specs.map(playwrightFilter));
    expect(argv).toContain('--repeat-each=9');
    expect(argv).toContain('--retries=0');
    expect(argv).toContain('--grep-invert');
    expect(stderr).toContain('Discovered 86 tests in 10 spec files; repeating each 9 times');
  });

  it('fails without launching tests when discovery errors, finds nothing or exits non-zero', () => {
    const spec = '["src/a/one.ct.spec.ts"]';
    for (const [list, exit] of [
      [listReport({ 'a.ct.spec.ts': 1 }, [{ message: 'load error' }]), 0],
      [listReport({ 'a.ct.spec.ts': 0 }), 0],
      [{ unexpected: true }, 0],
      [listReport({ 'a.ct.spec.ts': 2 }), 1],
    ] as const) {
      const { status, argv } = runTestStep(spec, list, exit);
      expect(status, JSON.stringify(list)).not.toBe(0);
      expect(argv).toEqual([]);
    }
  });

  it('fails before launching tests when the spec list is an error marker', () => {
    const { status, argv, listArgv } = runTestStep('error');
    expect(status).not.toBe(0);
    expect(argv).toEqual([]);
    expect(listArgv).toEqual([]);
  });
});

describe('test-ct-affected workflow job', () => {
  const job = jobLines('test-ct-affected');
  const field = (key: string) =>
    job
      .find((text) => text.startsWith(`    ${key}:`))
      ?.slice(`    ${key}:`.length)
      .trim() ?? '';

  it('runs on pull requests only when the affected list is not empty', () => {
    expect(field('if')).toContain("github.event_name == 'pull_request'");
    expect(field('if')).toContain("needs.release-fast-path.outputs.ct_affected_specs != '[]'");
    expect(job).toContain(
      '      CT_AFFECTED_SPECS: ${{ needs.release-fast-path.outputs.ct_affected_specs }}',
    );
    expect(jobLines('release-fast-path')).toContain(
      '      ct_affected_specs: ${{ steps.ct-affected.outputs.ct_affected_specs }}',
    );
    expect(jobLines('gate')).toContain('        test-ct-affected,');
  });

  function listStep(baseSha: string) {
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
        stepRun(jobLines('release-fast-path'), 'List affected component test specs'),
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '', BASE_SHA: baseSha, GITHUB_OUTPUT: output },
      },
    );
    return { status: result.status, output: readFileSync(output, 'utf8') };
  }

  it('lists the specs with the helper in the diff classifier, failing closed', () => {
    expect(listStep('not-a-revision')).toEqual({
      status: 0,
      output: 'ct_affected_specs=error\nct_affected_over_budget=[]\n',
    });
  });

  it('writes empty lists when the diff changes nothing', () => {
    expect(listStep('HEAD')).toEqual({
      status: 0,
      output: 'ct_affected_specs=[]\nct_affected_over_budget=[]\n',
    });
  });

  // The workflow's own step under bash, with the CT launcher stubbed as above.
  function runJobStep(stepName: string, specs: string, overBudget = '[]') {
    const dir = tempDir();
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const record = join(dir, 'argv');
    const summary = join(dir, 'summary');
    writeFileSync(summary, '');
    writeFileSync(
      join(bin, 'node'),
      `#!/usr/bin/env bash\nif [ "$1" = scripts/run-ct-tests.mjs ]; then shift; printf '%s\\n' "$@" > "${record}"; exit 0; fi\nNODE_OPTIONS= exec "${process.execPath}" "$@"\n`,
    );
    chmodSync(join(bin, 'node'), 0o755);
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', stepRun(job, stepName)], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CT_AFFECTED_SPECS: specs,
        CT_AFFECTED_OVER_BUDGET: overBudget,
        RUNNER_TEMP: dir,
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    let argv: string[] = [];
    try {
      argv = readFileSync(record, 'utf8').trimEnd().split('\n');
    } catch {}
    return {
      status: result.status,
      argv,
      stdout: result.stdout,
      stderr: result.stderr,
      summary: readFileSync(summary, 'utf8'),
    };
  }

  it('runs each affected spec once, with the queue shard settings', () => {
    const specs = ['src/a/one.ct.spec.ts', 'src/routes/[id]/two.ct.spec.ts'];
    const { status, argv, stderr } = runJobStep(
      'Run affected component tests once',
      JSON.stringify(specs),
    );
    expect(status, stderr).toBe(0);
    expect(argv.slice(0, 2)).toEqual(specs.map(playwrightFilter));
    expect(argv).toContain('--fail-on-flaky-tests');
    expect(argv).toContain('--workers=2');
    expect(argv.some((arg) => arg.startsWith('--repeat-each'))).toBe(false);
    expect(argv).not.toContain('--pass-with-no-tests');
  });

  it('names the over-budget specs in the log and step summary', () => {
    const { status, stdout, summary } = runJobStep(
      'Validate affected spec list',
      '["src/a.ct.spec.ts"]',
      '["src/b.ct.spec.ts"]',
    );
    expect(status).toBe(0);
    expect(stdout).toContain('- src/b.ct.spec.ts');
    expect(summary).toContain('- src/b.ct.spec.ts');
  });

  it('fails before launching tests when the affected list is an error marker', () => {
    for (const stepName of ['Validate affected spec list', 'Run affected component tests once']) {
      const { status, argv } = runJobStep(stepName, 'error');
      expect(status, stepName).not.toBe(0);
      expect(argv).toEqual([]);
    }
  });
});
