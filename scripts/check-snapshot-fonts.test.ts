// @vitest-environment node
// @verify-changed-triggers: test/**, src/**/*.ct.spec.ts, playwright/index.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT_IGNORED_SPEC_NAMES, isRootSpec } from '../playwright/root-spec-pattern.mjs';
import {
  CT_FONT_IMPORT,
  CT_HARNESS,
  ESCAPE_TOKEN,
  HELPER_EXPORT,
  INCIDENTS,
  callsFontHelper,
  collectSpecFiles,
  createEscapePattern,
  findSnapshotCalls,
  findSnapshotFontHits,
  harnessImportsFont,
  importsFontHelper,
  isCtSpec,
} from './check-snapshot-fonts.mjs';

const scriptPath = join(process.cwd(), 'scripts/check-snapshot-fonts.mjs');
const HELPER_IMPORT = `import { ${HELPER_EXPORT} } from './test-fonts';`;
const HELPER_CALL = `  await ${HELPER_EXPORT}(page, { baseUrl });`;
const ROOT_SPEC_BODY = [
  "import { expect, test } from '@playwright/test';",
  '',
  "test('renders', async ({ page }) => {",
  "  await page.goto('/');",
  HELPER_CALL,
  "  expect(await page.screenshot()).toMatchSnapshot('avatar.png');",
  '});',
  '',
];
const SNAPSHOT_LINE = ROOT_SPEC_BODY.findIndex((line) => line.includes('toMatchSnapshot')) + 1;
const CT_SPEC = [
  "import { expect, test } from '../src/test/ct-test';",
  "test('looks right', async ({ mount }) => {",
  '  const component = await mount(Thing);',
  "  await expect(component).toHaveScreenshot('thing.png');",
  '});',
  '',
].join('\n');
const HARNESS = ["import '../src/app.css';", `import '${CT_FONT_IMPORT}';`, ''].join('\n');
const passingTree = {
  'test/agent-avatar.spec.ts': [HELPER_IMPORT, ...ROOT_SPEC_BODY].join('\n'),
  'src/features/thing/__tests__/thing.ct.spec.ts': CT_SPEC,
  [CT_HARNESS]: HARNESS,
};

const fixtureRoots: string[] = [];
afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeTree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'snapshot-fonts-'));
  fixtureRoots.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

function runGate(cwd: string) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: err.status ?? 1,
      output: `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`,
    };
  }
}

describe('pixel-snapshot call detection', () => {
  it('finds toHaveScreenshot and toMatchSnapshot calls with their line', () => {
    const content = [
      'await expect(page).toHaveScreenshot();',
      'const text = render();',
      "expect(await canvas.screenshot()).toMatchSnapshot('a.png');",
    ].join('\n');
    expect(findSnapshotCalls('test/a.spec.ts', content)).toEqual([
      { line: 1, matcher: 'toHaveScreenshot', text: 'await expect(page).toHaveScreenshot();' },
      {
        line: 3,
        matcher: 'toMatchSnapshot',
        text: "expect(await canvas.screenshot()).toMatchSnapshot('a.png');",
      },
    ]);
  });

  it('finds element-access and parenthesised callee forms of both matchers', () => {
    const content = [
      "await expect(page)['toHaveScreenshot']();",
      '(expect(page).toHaveScreenshot)();',
      'const text = render();',
      'expect(tree)["toMatchSnapshot"]();',
      '(expect(tree).toMatchSnapshot)();',
      '((expect(tree))[(`toMatchSnapshot`)])();',
    ].join('\n');
    expect(
      findSnapshotCalls('test/a.spec.ts', content).map((call) => [call.line, call.matcher]),
    ).toEqual([
      [1, 'toHaveScreenshot'],
      [2, 'toHaveScreenshot'],
      [4, 'toMatchSnapshot'],
      [5, 'toMatchSnapshot'],
      [6, 'toMatchSnapshot'],
    ]);
  });

  it('ignores the matcher names inside comments, string literals, and regex literals', () => {
    const content = [
      '// toHaveScreenshot is documented here',
      '/* expect(x).toMatchSnapshot() */',
      "const note = 'call toMatchSnapshot() later';",
      'const tpl = `toHaveScreenshot(${name})`;',
      'const re = /expect\\(x\\)\\["toMatchSnapshot"\\]\\(\\)/;',
      'expect(page)[matcherName]();',
      "expect(page)['toHaveScreenshot' + '']();",
    ].join('\n');
    expect(findSnapshotCalls('test/a.spec.ts', content)).toEqual([]);
  });

  it(`honours a same-line \`// ${ESCAPE_TOKEN}: <reason>\` comment`, () => {
    const content = [
      `expect(tree).toMatchSnapshot(); // ${ESCAPE_TOKEN}: text snapshot, no glyphs rendered`,
      `expect(tree).toMatchSnapshot(); /* ${ESCAPE_TOKEN}: serialized JSON */`,
    ].join('\n');
    expect(findSnapshotCalls('test/a.spec.ts', content)).toEqual([]);
  });

  it('matches the exported escape token literally, including regex metacharacters', () => {
    expect(createEscapePattern(ESCAPE_TOKEN).test(`// ${ESCAPE_TOKEN}: reason`)).toBe(true);
    expect(createEscapePattern(ESCAPE_TOKEN).test('// snapshotXfontXok: reason')).toBe(false);
    const bracketed = createEscapePattern('[snapshot-font-ok]');
    expect(bracketed.test('// [snapshot-font-ok]: reason')).toBe(true);
    expect(bracketed.test('// s: reason')).toBe(false);
    expect(bracketed.test('// snapshot-font-ok: reason')).toBe(false);
  });

  it('does not exempt a bare token, an empty reason, or a token inside a string', () => {
    const content = [
      `expect(tree).toMatchSnapshot(); // ${ESCAPE_TOKEN}`,
      `expect(tree).toMatchSnapshot(); // ${ESCAPE_TOKEN}:`,
      `expect(tree).toMatchSnapshot(); /* ${ESCAPE_TOKEN}: */`,
      `expect(tree).toMatchSnapshot('// ${ESCAPE_TOKEN}: inside a string');`,
      `// ${ESCAPE_TOKEN}: reason on the previous line does not count`,
      'expect(tree).toMatchSnapshot();',
    ].join('\n');
    expect(findSnapshotCalls('test/a.spec.ts', content).map((call) => call.line)).toEqual([
      1, 2, 3, 4, 6,
    ]);
  });
});

describe('font load detection', () => {
  it('accepts a value import of the helper from any relative path resolving to test/test-fonts', () => {
    expect(importsFontHelper('test/a.spec.ts', HELPER_IMPORT)).toBe(true);
    expect(
      importsFontHelper(
        'test/nested/a.spec.ts',
        `import { ${HELPER_EXPORT} } from '../test-fonts';`,
      ),
    ).toBe(true);
    expect(
      importsFontHelper('test/a.spec.ts', `import { ${HELPER_EXPORT} } from './test-fonts.ts';`),
    ).toBe(true);
    expect(
      importsFontHelper(
        'test/a.spec.ts',
        `import { ${HELPER_EXPORT} as load } from './test-fonts';`,
      ),
    ).toBe(true);
  });

  it('rejects type-only, other-export, other-module, and commented-out imports', () => {
    expect(
      importsFontHelper('test/a.spec.ts', `import type { ${HELPER_EXPORT} } from './test-fonts';`),
    ).toBe(false);
    expect(importsFontHelper('test/a.spec.ts', "import { other } from './test-fonts';")).toBe(
      false,
    );
    expect(importsFontHelper('test/a.spec.ts', `import { ${HELPER_EXPORT} } from './fonts';`)).toBe(
      false,
    );
    expect(importsFontHelper('test/a.spec.ts', `// ${HELPER_IMPORT}`)).toBe(false);
    expect(importsFontHelper('test/a.spec.ts', `const s = "${HELPER_IMPORT}";`)).toBe(false);
  });

  it('requires a call expression invoking the imported helper binding', () => {
    const imported = [HELPER_IMPORT, ...ROOT_SPEC_BODY].join('\n');
    expect(callsFontHelper('test/a.spec.ts', imported)).toBe(true);
    expect(
      callsFontHelper(
        'test/a.spec.ts',
        imported.replace(HELPER_CALL, `  (${HELPER_EXPORT})(page);`),
      ),
    ).toBe(true);
    expect(
      callsFontHelper(
        'test/a.spec.ts',
        [
          `import { ${HELPER_EXPORT} as load } from './test-fonts';`,
          ...ROOT_SPEC_BODY.map((line) => line.replace(`${HELPER_EXPORT}(`, 'load(')),
        ].join('\n'),
      ),
    ).toBe(true);
    expect(callsFontHelper('test/a.spec.ts', imported.replace(HELPER_CALL, ''))).toBe(false);
    expect(
      callsFontHelper(
        'test/a.spec.ts',
        imported.replace(HELPER_CALL, `  // ${HELPER_CALL.trim()}`),
      ),
    ).toBe(false);
    expect(
      callsFontHelper(
        'test/a.spec.ts',
        imported.replace(HELPER_CALL, `  const fn = ${HELPER_EXPORT}; void fn;`),
      ),
    ).toBe(false);
    expect(callsFontHelper('test/a.spec.ts', ROOT_SPEC_BODY.join('\n'))).toBe(false);
  });

  it('detects the CT harness side-effect import of the bundled face', () => {
    expect(harnessImportsFont(HARNESS)).toBe(true);
    expect(harnessImportsFont(HARNESS.replace(`import '${CT_FONT_IMPORT}';`, ''))).toBe(false);
    expect(harnessImportsFont(`// import '${CT_FONT_IMPORT}';`)).toBe(false);
  });

  it('rejects CT harness import forms that are erased or not the bare side-effect import', () => {
    for (const statement of [
      `import type {} from '${CT_FONT_IMPORT}';`,
      `import type Inter from '${CT_FONT_IMPORT}';`,
      `import type * as inter from '${CT_FONT_IMPORT}';`,
      `import { type Inter } from '${CT_FONT_IMPORT}';`,
      `import inter from '${CT_FONT_IMPORT}';`,
      `import * as inter from '${CT_FONT_IMPORT}';`,
    ]) {
      expect(harnessImportsFont(`import '../src/app.css';\n${statement}\n`), statement).toBe(false);
    }
  });
});

describe('spec discovery', () => {
  it('classifies root specs with the shared Playwright classifier', () => {
    for (const file of [
      'test/a.spec.ts',
      'test/nested/a.spec.ts',
      'test/.visual/a.spec.ts',
      'test/.a.spec.ts',
      'test/a.SPEC.ts',
      'test/a.Spec.TS',
      './test/a.spec.ts',
    ]) {
      expect(isRootSpec(file), file).toBe(true);
    }
    for (const file of [
      'test/a.test.ts',
      'test/a.spec.js',
      'test/a.spec.tsx',
      'test/a.ct.spec.ts.bak',
      'tests/a.spec.ts',
      'src/test/a.spec.ts',
      'src/a.ct.spec.ts',
      'test',
      ...ROOT_IGNORED_SPEC_NAMES.map((name) => `test/${name}`),
    ]) {
      expect(isRootSpec(file), file).toBe(false);
    }
  });

  it('does not scan the root specs playwright.config.ts ignores', () => {
    const ignoredWithoutHelper = Object.fromEntries(
      ROOT_IGNORED_SPEC_NAMES.map((name) => [`test/${name}`, ROOT_SPEC_BODY.join('\n')]),
    );
    const root = writeTree({ ...passingTree, ...ignoredWithoutHelper });
    const files = collectSpecFiles(root);
    expect(files.map((file) => file.path).sort()).toEqual([
      'src/features/thing/__tests__/thing.ct.spec.ts',
      'test/agent-avatar.spec.ts',
    ]);
    const handed = Object.entries(ignoredWithoutHelper).map(([path, content]) => ({
      path,
      content,
    }));
    expect(findSnapshotFontHits([...files, ...handed], HARNESS)).toEqual([]);
    expect(runGate(root).exitCode).toBe(0);
  });

  it('classifies CT specs with the shared Playwright classifier', () => {
    for (const file of [
      'src/a.ct.spec.ts',
      'src/.visual/a.ct.spec.ts',
      'src/.a.ct.spec.ts',
      'src/a.CT.SPEC.ts',
    ]) {
      expect(isCtSpec(file), file).toBe(true);
    }
    for (const file of ['src/a.spec.ts', 'src/a.ct.test.ts', 'test/a.ct.spec.ts']) {
      expect(isCtSpec(file), file).toBe(false);
    }
  });

  it('guards dot-segment and upper-case specs that Playwright discovers', () => {
    const root = writeTree({
      ...passingTree,
      'test/.visual/hidden.spec.ts': ROOT_SPEC_BODY.join('\n'),
      'test/upper.SPEC.ts': ROOT_SPEC_BODY.join('\n'),
      'src/.hidden/thing.ct.spec.ts': CT_SPEC,
      'src/features/thing/__tests__/upper.CT.SPEC.ts': CT_SPEC,
    });
    const files = collectSpecFiles(root);
    expect(files.map((file) => file.path).sort()).toEqual([
      'src/.hidden/thing.ct.spec.ts',
      'src/features/thing/__tests__/thing.ct.spec.ts',
      'src/features/thing/__tests__/upper.CT.SPEC.ts',
      'test/.visual/hidden.spec.ts',
      'test/agent-avatar.spec.ts',
      'test/upper.SPEC.ts',
    ]);
    expect(
      findSnapshotFontHits(files, HARNESS)
        .map((hit) => hit.path)
        .sort(),
    ).toEqual(['test/.visual/hidden.spec.ts', 'test/upper.SPEC.ts']);
    const stripped = HARNESS.replace(`import '${CT_FONT_IMPORT}';`, '');
    expect(
      findSnapshotFontHits(files, stripped)
        .map((hit) => hit.path)
        .sort(),
    ).toEqual([
      'src/.hidden/thing.ct.spec.ts',
      'src/features/thing/__tests__/thing.ct.spec.ts',
      'src/features/thing/__tests__/upper.CT.SPEC.ts',
      'test/.visual/hidden.spec.ts',
      'test/upper.SPEC.ts',
    ]);
  });
});

describe('snapshot font gate', () => {
  it('passes a tree whose root spec imports the helper and whose harness loads the face', () => {
    const root = writeTree(passingTree);
    const files = collectSpecFiles(root);
    expect(files.map((file) => file.path).sort()).toEqual([
      'src/features/thing/__tests__/thing.ct.spec.ts',
      'test/agent-avatar.spec.ts',
    ]);
    expect(findSnapshotFontHits(files, HARNESS)).toEqual([]);
    const { exitCode, output } = runGate(root);
    expect(exitCode).toBe(0);
    expect(output).toContain('Snapshot fonts valid');
  });

  it('fails a root spec that snapshots without the helper import, naming file and line', () => {
    const root = writeTree({
      ...passingTree,
      'test/agent-avatar.spec.ts': ROOT_SPEC_BODY.join('\n'),
    });
    const hits = findSnapshotFontHits(collectSpecFiles(root), HARNESS);
    expect(hits.map((hit) => [hit.path, hit.line, hit.matcher])).toEqual([
      ['test/agent-avatar.spec.ts', SNAPSHOT_LINE, 'toMatchSnapshot'],
    ]);
    const { exitCode, output } = runGate(root);
    expect(exitCode).toBe(1);
    expect(output).toContain(`test/agent-avatar.spec.ts:${SNAPSHOT_LINE}:`);
    expect(output).toContain(HELPER_IMPORT);
    expect(output).toContain(`await ${HELPER_EXPORT}(page, { baseUrl })`);
    for (const incident of INCIDENTS) expect(output).toContain(incident);
  });

  it('fails a root spec that imports the helper but never calls it', () => {
    const root = writeTree({
      ...passingTree,
      'test/agent-avatar.spec.ts': [HELPER_IMPORT, ...ROOT_SPEC_BODY]
        .filter((line) => line !== HELPER_CALL)
        .join('\n'),
    });
    const hits = findSnapshotFontHits(collectSpecFiles(root), HARNESS);
    expect(hits.map((hit) => [hit.path, hit.line, hit.reason])).toEqual([
      [
        'test/agent-avatar.spec.ts',
        SNAPSHOT_LINE,
        `\`${HELPER_EXPORT}\` is imported but never called`,
      ],
    ]);
    const { exitCode, output } = runGate(root);
    expect(exitCode).toBe(1);
    expect(output).toContain(`test/agent-avatar.spec.ts:${SNAPSHOT_LINE}:`);
    expect(output).toContain('imported but never called');
  });

  it('accepts a root spec that snapshots through element access once the helper is called', () => {
    const root = writeTree({
      ...passingTree,
      'test/agent-avatar.spec.ts': [HELPER_IMPORT, ...ROOT_SPEC_BODY]
        .join('\n')
        .replace(".toMatchSnapshot('avatar.png')", "['toMatchSnapshot']('avatar.png')"),
    });
    expect(findSnapshotFontHits(collectSpecFiles(root), HARNESS)).toEqual([]);
    const withoutHelper = writeTree({
      ...passingTree,
      'test/agent-avatar.spec.ts': ROOT_SPEC_BODY.join('\n').replace(
        ".toMatchSnapshot('avatar.png')",
        "['toMatchSnapshot']('avatar.png')",
      ),
    });
    expect(
      findSnapshotFontHits(collectSpecFiles(withoutHelper), HARNESS).map((hit) => hit.line),
    ).toEqual([SNAPSHOT_LINE]);
  });

  it('reports only the first offending call per file', () => {
    const root = writeTree({
      ...passingTree,
      'test/agent-avatar.spec.ts': [
        ...ROOT_SPEC_BODY,
        "expect(await page.screenshot()).toMatchSnapshot('again.png');",
      ].join('\n'),
    });
    expect(findSnapshotFontHits(collectSpecFiles(root), HARNESS).map((hit) => hit.line)).toEqual([
      SNAPSHOT_LINE,
    ]);
  });

  it('lets a text-only snapshot opt out per line with a reasoned comment', () => {
    const root = writeTree({
      ...passingTree,
      'test/agent-avatar.spec.ts': ROOT_SPEC_BODY.join('\n').replace(
        "toMatchSnapshot('avatar.png');",
        `toMatchSnapshot('avatar.txt'); // ${ESCAPE_TOKEN}: serialized text, no glyphs`,
      ),
    });
    expect(findSnapshotFontHits(collectSpecFiles(root), HARNESS)).toEqual([]);
    expect(runGate(root).exitCode).toBe(0);
  });

  it('ignores a bare exemption token', () => {
    const root = writeTree({
      ...passingTree,
      'test/agent-avatar.spec.ts': ROOT_SPEC_BODY.join('\n').replace(
        "toMatchSnapshot('avatar.png');",
        `toMatchSnapshot('avatar.txt'); // ${ESCAPE_TOKEN}`,
      ),
    });
    expect(findSnapshotFontHits(collectSpecFiles(root), HARNESS).map((hit) => hit.line)).toEqual([
      SNAPSHOT_LINE,
    ]);
    expect(runGate(root).exitCode).toBe(1);
  });

  it('fails CT pixel-snapshot specs when the harness import is type-only', () => {
    const erased = HARNESS.replace(
      `import '${CT_FONT_IMPORT}';`,
      `import type {} from '${CT_FONT_IMPORT}';`,
    );
    const root = writeTree({ ...passingTree, [CT_HARNESS]: erased });
    const hits = findSnapshotFontHits(collectSpecFiles(root), erased);
    expect(hits.map((hit) => [hit.path, hit.line])).toEqual([
      ['src/features/thing/__tests__/thing.ct.spec.ts', 4],
    ]);
    expect(runGate(root).exitCode).toBe(1);
  });

  it('fails every CT pixel-snapshot spec when the harness drops the font import', () => {
    const stripped = HARNESS.replace(`import '${CT_FONT_IMPORT}';`, '');
    const root = writeTree({ ...passingTree, [CT_HARNESS]: stripped });
    const hits = findSnapshotFontHits(collectSpecFiles(root), stripped);
    expect(hits.map((hit) => [hit.path, hit.line, hit.reason])).toEqual([
      [
        'src/features/thing/__tests__/thing.ct.spec.ts',
        4,
        `${CT_HARNESS} no longer imports '${CT_FONT_IMPORT}'`,
      ],
    ]);
    const { exitCode, output } = runGate(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('src/features/thing/__tests__/thing.ct.spec.ts:4:');
    expect(output).toContain(`import '${CT_FONT_IMPORT}';`);
  });

  it('fails CT pixel-snapshot specs when the harness file is missing', () => {
    const { [CT_HARNESS]: _harness, ...withoutHarness } = passingTree;
    const root = writeTree(withoutHarness);
    const { exitCode, output } = runGate(root);
    expect(exitCode).toBe(1);
    expect(output).toContain(`${CT_HARNESS} is missing`);
  });

  it('ignores specs outside the two suites and ones that take no pixel snapshot', () => {
    const root = writeTree({
      ...passingTree,
      'test/agent-avatar.spec.ts': "test('nothing visual', () => {});",
      'src/lib/catalog.test.ts': 'expect(x).toMatchSnapshot();',
      'src/lib/visual.visual.spec.ts': 'await expect(page).toHaveScreenshot();',
      'node_modules/pkg/test/a.spec.ts': 'expect(x).toMatchSnapshot();',
    });
    expect(
      collectSpecFiles(root)
        .map((file) => file.path)
        .sort(),
    ).toEqual(['src/features/thing/__tests__/thing.ct.spec.ts', 'test/agent-avatar.spec.ts']);
    expect(runGate(root).exitCode).toBe(0);
  });
});
