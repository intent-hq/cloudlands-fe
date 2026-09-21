// @vitest-environment node
// @verify-changed-triggers: test/**, src/**/*.ct.spec.ts, playwright/index.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CT_FONT_IMPORT,
  CT_HARNESS,
  ESCAPE_TOKEN,
  HELPER_EXPORT,
  INCIDENTS,
  collectSpecFiles,
  findSnapshotCalls,
  findSnapshotFontHits,
  harnessImportsFont,
  importsFontHelper,
} from './check-snapshot-fonts.mjs';

const scriptPath = join(process.cwd(), 'scripts/check-snapshot-fonts.mjs');
const HELPER_IMPORT = `import { ${HELPER_EXPORT} } from './test-fonts';`;
const ROOT_SPEC_BODY = [
  "import { expect, test } from '@playwright/test';",
  '',
  "test('renders', async ({ page }) => {",
  "  await page.goto('/');",
  "  expect(await page.screenshot()).toMatchSnapshot('avatar.png');",
  '});',
  '',
];
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

  it('ignores the matcher names inside comments and string literals', () => {
    const content = [
      '// toHaveScreenshot is documented here',
      '/* expect(x).toMatchSnapshot() */',
      "const note = 'call toMatchSnapshot() later';",
      'const tpl = `toHaveScreenshot(${name})`;',
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

  it('detects the CT harness side-effect import of the bundled face', () => {
    expect(harnessImportsFont(HARNESS)).toBe(true);
    expect(harnessImportsFont(HARNESS.replace(`import '${CT_FONT_IMPORT}';`, ''))).toBe(false);
    expect(harnessImportsFont(`// import '${CT_FONT_IMPORT}';`)).toBe(false);
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
      ['test/agent-avatar.spec.ts', 5, 'toMatchSnapshot'],
    ]);
    const { exitCode, output } = runGate(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('test/agent-avatar.spec.ts:5:');
    expect(output).toContain(HELPER_IMPORT);
    expect(output).toContain(`await ${HELPER_EXPORT}(page, { baseUrl })`);
    for (const incident of INCIDENTS) expect(output).toContain(incident);
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
      5,
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
      5,
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
