// @verify-changed-triggers: tsconfig.main-tests.json, tsconfig.renderer-tests.json, package.json, scripts/test-type-baselines/**

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BASELINES_DIR,
  EXTENDED_TSCONFIGS,
  PROJECTS,
  checkTestTypes,
  compareCounts,
  findBaselineGrowth,
  isTestTypeCheckInput,
  loadBaseline,
  parseBaselineEntries,
  parseDiagnostics,
  readCommittedBaseline,
  readRenames,
} from './check-test-types.mjs';

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A throwaway package root holding `files` (repo-relative path → lines). */
function tree(files: Record<string, string | string[]>) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-types-')));
  roots.push(root);
  writeFiles(root, files);
  return root;
}

function writeFiles(root: string, files: Record<string, string | string[]>) {
  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, Array.isArray(content) ? content.join('\n') : content);
  }
}

const FIXTURE_PROJECTS = { main: { tsconfig: 'tsconfig.tests.json', label: 'fixture tests' } };

/** A key-union API like local-prefs and one test file using it with `testLines`. */
function prefsProject(testLines: string[], extra: Record<string, string> = {}) {
  const root = tree({
    'tsconfig.tests.json': JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, types: [], lib: ['ES2022'] },
      include: ['src/**/*.ts'],
    }),
    'src/prefs.ts': [
      "export type PrefKey = 'dockEnabled' | 'menuBarAutoHide';",
      'export function setPref(key: PrefKey, value: unknown): void {',
      '  void key;',
      '  void value;',
      '}',
    ],
    'src/__tests__/prefs.test.ts': ["import { setPref } from '../prefs';", ...testLines],
    ...extra,
  });
  // The spawned tsc enables Node's compile cache; keep it inside the removed fixture.
  vi.stubEnv('NODE_COMPILE_CACHE', path.join(root, 'node-compile-cache'));
  return root;
}

const TEST_FILE = 'src/__tests__/prefs.test.ts';
const baselineEntry = (count: number) => ({
  [`${BASELINES_DIR}/main/${TEST_FILE}.json`]: JSON.stringify({ count }),
});
const check = (root: string, update = false) =>
  checkTestTypes({ root, projects: FIXTURE_PROJECTS, update });

describe('parseDiagnostics', () => {
  it('groups located errors by file and keeps message chains and global errors', () => {
    const output = [
      'src/a.test.ts(3,5): error TS2345: Argument of type \'"x"\' is not assignable.',
      "  Type '\"x\"' is not assignable to type 'Key'.",
      "src/a.test.ts(9,1): error TS2578: Unused '@ts-expect-error' directive.",
      "lib/b.ts(1,1): error TS2307: Cannot find module 'z'.",
      "error TS2688: Cannot find type definition file for 'nope'.",
    ].join('\n');
    const { byFile, global } = parseDiagnostics(output, '/repo');
    expect([...byFile.keys()]).toEqual(['src/a.test.ts', 'lib/b.ts']);
    expect(byFile.get('src/a.test.ts')).toMatchObject([
      { line: 3, column: 5, code: 'TS2345', message: expect.stringContaining("type 'Key'") },
      { line: 9, column: 1, code: 'TS2578' },
    ]);
    expect(global).toEqual(["TS2688: Cannot find type definition file for 'nope'."]);
  });

  it('reports a located tsconfig error as configuration, not test debt', () => {
    const { byFile, global } = parseDiagnostics(
      "tsconfig.tests.json(4,5): error TS5023: Unknown compiler option 'nope'.",
      '/repo',
    );
    expect(byFile.size).toBe(0);
    expect(global).toEqual(["tsconfig.tests.json(4,5) TS5023: Unknown compiler option 'nope'."]);
  });
});

describe('baseline comparison', () => {
  it('treats a missing entry as zero and a clean baselined file as shrunk', () => {
    const baseline = new Map([
      ['a.test.ts', 2],
      ['b.test.ts', 1],
      ['c.test.ts', 3],
    ]);
    const counts = new Map([
      ['a.test.ts', 3],
      ['c.test.ts', 3],
      ['new.test.ts', 1],
    ]);
    expect(compareCounts(baseline, counts)).toEqual({
      grown: [
        { file: 'a.test.ts', allowed: 2, current: 3 },
        { file: 'new.test.ts', allowed: 0, current: 1 },
      ],
      shrunk: [{ file: 'b.test.ts', allowed: 1, current: 0 }],
    });
  });

  it('rejects malformed entries', () => {
    expect(() => parseBaselineEntries([['a.ts.json', '{"count":0}']], 'x')).toThrow(/count/);
    expect(() => parseBaselineEntries([['a.ts.json', '{"count":1,"why":"y"}']], 'x')).toThrow();
    expect(() => parseBaselineEntries([['a.ts', '{"count":1}']], 'x')).toThrow(/\.json/);
    expect(parseBaselineEntries([['src/a.ts.json', '{"count":4}']], 'x')).toEqual(
      new Map([['src/a.ts', 4]]),
    );
  });

  it('lets a new project establish its baseline and forbids later growth', () => {
    const after = new Map([['a.test.ts', 2]]);
    expect(findBaselineGrowth(null, after)).toEqual([]);
    expect(findBaselineGrowth(new Map([['a.test.ts', 1]]), after)).toEqual([
      { file: 'a.test.ts', allowed: 1, current: 2 },
    ]);
    expect(findBaselineGrowth(new Map([['a.test.ts', 3]]), after)).toEqual([]);
  });

  it('keeps zero debt at zero once every entry is gone', () => {
    expect(findBaselineGrowth(new Map(), new Map([['a.test.ts', 1]]))).toEqual([
      { file: 'a.test.ts', allowed: 0, current: 1 },
    ]);
  });

  it("carries a renamed file's allowance to its new path", () => {
    const renames = new Map([['old/a.test.ts', 'new/a.test.ts']]);
    const committed = new Map([['old/a.test.ts', 2]]);
    expect(findBaselineGrowth(committed, new Map([['new/a.test.ts', 2]]), renames)).toEqual([]);
    expect(findBaselineGrowth(committed, new Map([['new/a.test.ts', 3]]), renames)).toEqual([
      { file: 'new/a.test.ts', allowed: 2, current: 3 },
    ]);
  });
});

describe('checkTestTypes on a fixture project', { timeout: 120_000 }, () => {
  it('fails a test that passes an unregistered key', async () => {
    const root = prefsProject(["setPref('notAKey', 1);"]);
    const { ok, lines } = await check(root);
    expect(ok).toBe(false);
    expect(lines.join('\n')).toContain(`${TEST_FILE}: 1 type error(s), baseline allows 0`);
    expect(lines.join('\n')).toContain('TS2345');
  });

  it('passes known debt and fails once it is fixed until the baseline shrinks', async () => {
    const root = prefsProject(["setPref('notAKey', 1);"], baselineEntry(1));
    expect((await check(root)).ok).toBe(true);

    writeFiles(root, {
      [TEST_FILE]: ["import { setPref } from '../prefs';", "setPref('dockEnabled', 1);"],
    });
    const fixed = await check(root);
    expect(fixed.ok).toBe(false);
    expect(fixed.lines.join('\n')).toMatch(/1 → 0[\s\S]*--update-baseline/);

    const updated = await check(root, true);
    expect(updated.ok).toBe(true);
    expect(loadBaseline(root, 'main')).toEqual(new Map());
    expect((await check(root)).ok).toBe(true);
  });

  it('checks type-level rules written as @ts-expect-error lines', async () => {
    const used = prefsProject([
      "setPref('dockEnabled', true);",
      '// @ts-expect-error unregistered keys do not compile',
      "setPref('notAKey', 1);",
    ]);
    expect((await check(used)).ok).toBe(true);

    const unused = prefsProject([
      '// @ts-expect-error unregistered keys do not compile',
      "setPref('menuBarAutoHide', 1);",
    ]);
    const { ok, lines } = await check(unused);
    expect(ok).toBe(false);
    expect(lines.join('\n')).toContain('TS2578');
  });

  it.each([
    ['killed by a signal', null, 'Killed by SIGKILL'],
    ['out of memory', 134, 'FATAL ERROR: Reached heap limit'],
  ])('never compares or writes partial counts when tsc is %s', async (_name, code, tail) => {
    const root = prefsProject([], baselineEntry(1));
    const output = `${TEST_FILE}(2,9): error TS2345: Argument is not assignable.\n${tail}\n`;
    const run = async () => ({ code, output });
    for (const update of [false, true]) {
      const { ok, lines } = await checkTestTypes({ root, projects: FIXTURE_PROJECTS, update, run });
      expect(ok).toBe(false);
      expect(lines.join('\n')).toContain(tail);
    }
    expect(loadBaseline(root, 'main')).toEqual(new Map([[TEST_FILE, 1]]));
  });

  it('fails on a configuration error that names no file', async () => {
    const root = prefsProject([]);
    writeFiles(root, {
      'tsconfig.tests.json': JSON.stringify({
        compilerOptions: { noEmit: true, types: ['not-a-types-package'] },
        include: ['src/**/*.ts'],
      }),
    });
    const { ok, lines } = await check(root);
    expect(ok).toBe(false);
    expect(lines.join('\n')).toMatch(/failed outside any test file[\s\S]*TS2688/);
  });
});

describe('renderer test program on a fixture', { timeout: 120_000 }, () => {
  // The real include/exclude rules over a minimal base config, so the fixture stays small.
  const RENDERER_PROJECTS = { renderer: PROJECTS.renderer };
  const rendererFixture = (files: Record<string, string[]>) => {
    const root = tree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, types: [], lib: ['ES2022'] },
      }),
      [PROJECTS.renderer.tsconfig]: fs.readFileSync(PROJECTS.renderer.tsconfig, 'utf8'),
      'src/lib/prefs.ts': [
        "export type PrefKey = 'dockEnabled' | 'menuBarAutoHide';",
        'export function setPref(key: PrefKey, value: unknown): void {',
        '  void key;',
        '  void value;',
        '}',
      ],
      ...files,
    });
    vi.stubEnv('NODE_COMPILE_CACHE', path.join(root, 'node-compile-cache'));
    return root;
  };
  const wrongValue = (from: string) => [
    `import { setPref } from '${from}';`,
    "setPref('nope', 1);",
  ];

  it('fails a renderer test that calls a narrowed API with a wrong value', async () => {
    const root = rendererFixture({
      'src/lib/prefs.test.ts': wrongValue('./prefs'),
      'src/store/__tests__/helpers.ts': wrongValue('../../lib/prefs'),
    });
    const { ok, lines } = await checkTestTypes({ root, projects: RENDERER_PROJECTS });
    expect(ok).toBe(false);
    const report = lines.join('\n');
    expect(report).toContain('src/lib/prefs.test.ts: 1 type error(s), baseline allows 0');
    expect(report).toContain('src/store/__tests__/helpers.ts: 1 type error(s), baseline allows 0');
  });

  it('leaves main-process, preload and Playwright files to their own checks', async () => {
    const root = rendererFixture({
      'src/main/a.test.ts': wrongValue('../lib/prefs'),
      'src/features/backend/main/a.test.ts': wrongValue('../../../lib/prefs'),
      'src/preload/a.test.ts': wrongValue('../lib/prefs'),
      'src/lib/__tests__/a.ct.spec.ts': wrongValue('../prefs'),
      'src/lib/a.visual.spec.ts': wrongValue('./prefs'),
      'src/lib/ok.test.ts': ["import { setPref } from './prefs';", "setPref('dockEnabled', 1);"],
    });
    const { ok, lines } = await checkTestTypes({ root, projects: RENDERER_PROJECTS });
    expect(lines.join('\n')).toContain('0 known type error(s)');
    expect(ok).toBe(true);
  });
});

describe('committed baseline', () => {
  const git = (root: string, ...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

  it('reads the baseline tree at a revision, or null before the project existed', () => {
    const root = tree({ 'README.md': 'x' });
    git(root, 'init', '-q');
    git(
      root,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '-qm',
      'init',
      '--allow-empty',
    );
    const before = git(root, 'rev-parse', 'HEAD');
    writeFiles(root, baselineEntry(2));
    git(root, 'add', '-A');
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'baseline');
    expect(readCommittedBaseline(root, 'main', before, 'tsconfig.tests.json')).toBeNull();
    expect(readCommittedBaseline(root, 'main', 'HEAD', 'tsconfig.tests.json')).toEqual(
      new Map([[TEST_FILE, 2]]),
    );
  });

  it('reads an established project with no entries as zero debt, not a new project', () => {
    const root = tree({ 'tsconfig.tests.json': '{}', ...baselineEntry(1) });
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'debt');
    git(root, 'rm', '-rq', BASELINES_DIR);
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'paid off');
    expect(readCommittedBaseline(root, 'main', 'HEAD', 'tsconfig.tests.json')).toEqual(new Map());
  });

  it('detects files renamed since a revision', () => {
    const root = tree({ 'src/old.test.ts': 'export const value = 1;\n'.repeat(20) });
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    git(root, 'mv', 'src/old.test.ts', 'src/new.test.ts');
    expect(readRenames(root, 'HEAD')).toEqual(new Map([['src/old.test.ts', 'src/new.test.ts']]));
  });

  // CI sets LINT_BASELINE_BASE_REF to the PR or merge-group base; locally HEAD.
  it('only shrinks against the comparison revision', () => {
    const ref = process.env.LINT_BASELINE_BASE_REF || 'HEAD';
    for (const project of Object.keys(PROJECTS)) {
      const committed = readCommittedBaseline(process.cwd(), project, ref);
      const renames = readRenames(process.cwd(), ref);
      expect(
        findBaselineGrowth(committed, loadBaseline(process.cwd(), project), renames),
        project,
      ).toEqual([]);
    }
  });
});

describe('repository wiring', () => {
  it('runs from lint:architecture', () => {
    const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
    expect(scripts['lint:architecture']).toContain('pnpm-run.mjs lint:test-types');
    expect(scripts['lint:test-types']).toMatch(/node scripts\/check-test-types\.mjs$/);
  });

  it('type-checks the main-process unit tests', () => {
    const { tsconfig } = PROJECTS.main;
    const { config } = ts.readConfigFile(tsconfig, ts.sys.readFile);
    const { fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, process.cwd());
    const files = fileNames.map((file) => path.relative(process.cwd(), file));
    expect(files).toContain('src/main/__tests__/local-prefs.test.ts');
    expect(files).toContain('src/features/backend/main/tunnel-manager.test.ts');
    expect(files.filter((file) => !file.endsWith('.d.ts') && !file.includes('/main/'))).toEqual([]);
  });

  it('type-checks the renderer unit tests and nothing the main program owns', () => {
    const { tsconfig } = PROJECTS.renderer;
    const { config } = ts.readConfigFile(tsconfig, ts.sys.readFile);
    const { fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, process.cwd());
    const files = fileNames.map((file) => path.relative(process.cwd(), file));
    expect(files).toContain('src/store/renderer/slices/workspace/workspace-slice.test.ts');
    expect(
      files.filter((file) => /^src\/(main|preload|features\/[^/]+\/main)\//.test(file)),
    ).toEqual([]);
    expect(files.filter((file) => file.endsWith('.spec.ts'))).toEqual([]);
  });

  it('lists every config a project tsconfig extends as a gate input', () => {
    for (const { tsconfig } of Object.values(PROJECTS)) {
      let config: string | undefined = tsconfig;
      while (config) {
        const { config: json } = ts.readConfigFile(config, ts.sys.readFile);
        config = json.extends;
        if (config) expect(EXTENDED_TSCONFIGS).toContain(config.replace(/^\.\//, ''));
      }
    }
  });

  it('treats the tsconfig and baselines as gate inputs', () => {
    expect(isTestTypeCheckInput(PROJECTS.main.tsconfig)).toBe(true);
    expect(isTestTypeCheckInput(PROJECTS.renderer.tsconfig)).toBe(true);
    expect(isTestTypeCheckInput(`${BASELINES_DIR}/renderer/src/lib/a.test.ts.json`)).toBe(true);
    expect(isTestTypeCheckInput('tsconfig.main.json')).toBe(true);
    expect(isTestTypeCheckInput(`${BASELINES_DIR}/main/src/main/a.test.ts.json`)).toBe(true);
    expect(isTestTypeCheckInput('src/main/a.test.ts')).toBe(false);
  });
});
