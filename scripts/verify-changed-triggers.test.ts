// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  EXEMPT_MARKER,
  inspectDeclaredSuites,
  listDeclaredSuites,
  matchesTrigger,
  readTriggerHeader,
  requiresTriggerDeclaration,
  selectDeclaredSuites,
  TRIGGER_MARKER,
} from './verify-changed-triggers.mjs';

const CLI = path.resolve('scripts/verify-changed-triggers.mjs');

const lines = (...parts: string[]) => `${parts.join('\n')}\n`;
const cwdReader = lines(
  "import { readFileSync } from 'node:fs';",
  "import { resolve } from 'node:path';",
  "import { describe, it } from 'vitest';",
  "const source = readFileSync(resolve(process.cwd(), 'src/App.svelte'), 'utf8');",
  'it("x", () => expect(source).toContain("main"));',
);

const tempRoots: string[] = [];
function fixtureRoot(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-changed-triggers-'));
  tempRoots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}
afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe('readTriggerHeader', () => {
  it('parses comma-separated entries and resolves relative ones against the test file', () => {
    const content = lines(
      `// ${TRIGGER_MARKER} src/preload/index.ts, ../Sidebar.svelte, ./fixtures/**`,
      "import { it } from 'vitest';",
    );
    expect(readTriggerHeader(content, 'src/lib/components/__tests__/a.test.ts')).toEqual({
      kind: 'triggers',
      triggers: [
        'src/preload/index.ts',
        'src/lib/components/Sidebar.svelte',
        'src/lib/components/__tests__/fixtures/**',
      ],
    });
  });

  it('accumulates several marker lines and trailing-comma continuations', () => {
    const content = lines(
      '/**',
      ` * ${TRIGGER_MARKER} src/a.ts,`,
      ' *   src/b.ts',
      ` * ${TRIGGER_MARKER} src/c/**`,
      ' */',
      "import { it } from 'vitest';",
    );
    expect(readTriggerHeader(content, 'scripts/x.test.ts')).toEqual({
      kind: 'triggers',
      triggers: ['src/a.ts', 'src/b.ts', 'src/c/**'],
    });
  });

  it('keeps brace and class globs whole when splitting the entry list', () => {
    const content = lines(
      `// ${TRIGGER_MARKER} src/*.{ts,svelte}, src/lib/[a,b]*.ts, src/c.ts`,
      "import { it } from 'vitest';",
    );
    const header = readTriggerHeader(content, 'scripts/x.test.ts');
    expect(header).toEqual({
      kind: 'triggers',
      triggers: ['src/*.{ts,svelte}', 'src/lib/[a,b]*.ts', 'src/c.ts'],
    });
    expect(
      selectDeclaredSuites(
        [{ path: 'scripts/x.test.ts', triggers: header.triggers! }],
        ['src/App.svelte'],
      ),
    ).toEqual(['scripts/x.test.ts']);
  });

  it('glob-escapes the resolved directory of a relative glob entry', () => {
    const testFile =
      'src/routes/(app)/workspace/[id]/composables/__tests__/lifecycle-safe-selectors.test.ts';
    const header = readTriggerHeader(
      lines(`// ${TRIGGER_MARKER} ../*.ts, ../foo.ts, ../../WorkspaceSurface.svelte`),
      testFile,
    );
    expect(header).toEqual({
      kind: 'triggers',
      triggers: [
        'src/routes/[(]app[)]/workspace/[[]id[]]/composables/*.ts',
        'src/routes/[(]app[)]/workspace/[[]id[]]/composables/foo.ts',
        'src/routes/[(]app[)]/workspace/[[]id[]]/WorkspaceSurface.svelte',
      ],
    });
    const suites = [{ path: testFile, triggers: header.triggers! }];
    expect(
      selectDeclaredSuites(suites, ['src/routes/(app)/workspace/[id]/composables/foo.ts']),
    ).toEqual([testFile]);
    expect(
      selectDeclaredSuites(suites, ['src/routes/(app)/workspace/[id]/composables/bar.svelte.ts']),
    ).toEqual([testFile]);
    expect(
      selectDeclaredSuites(suites, ['src/routes/(app)/workspace/creating/composables/unread.ts']),
    ).toEqual([]);
    expect(
      selectDeclaredSuites(suites, ['src/routes/(app)/workspace/[id]/WorkspaceSurface.svelte']),
    ).toEqual([testFile]);
  });

  it('matches an exact relative entry under a bracketed directory by equality only', () => {
    const testFile = 'src/routes/(app)/workspace/[id]/page.test.ts';
    const header = readTriggerHeader(lines(`// ${TRIGGER_MARKER} ./+page.svelte`), testFile);
    const suites = [{ path: testFile, triggers: header.triggers! }];
    expect(selectDeclaredSuites(suites, ['src/routes/(app)/workspace/[id]/+page.svelte'])).toEqual([
      testFile,
    ]);
    expect(selectDeclaredSuites(suites, ['src/routes/(app)/workspace/i/+page.svelte'])).toEqual([]);
    expect(readTriggerHeader(lines(`// ${TRIGGER_MARKER} ./b.ts`), 'src/a/x.test.ts')).toEqual({
      kind: 'triggers',
      triggers: ['src/a/b.ts'],
    });
  });

  it('keeps a leading * on a line-comment continuation as glob text', () => {
    const lineComments = lines(
      `// ${TRIGGER_MARKER} src/a.ts,`,
      '// **/*.svelte',
      "import { it } from 'vitest';",
    );
    expect(readTriggerHeader(lineComments, 'scripts/x.test.ts')).toEqual({
      kind: 'triggers',
      triggers: ['src/a.ts', '**/*.svelte'],
    });
    const blockComment = lines(
      '/**',
      ` * ${TRIGGER_MARKER} src/a.ts,`,
      ' * *.svelte',
      ' */',
      "import { it } from 'vitest';",
    );
    expect(readTriggerHeader(blockComment, 'scripts/x.test.ts')).toEqual({
      kind: 'triggers',
      triggers: ['src/a.ts', '*.svelte'],
    });
  });

  it('resolves relative entries that land on the package root without a leading ./', () => {
    const header = readTriggerHeader(
      lines(`// ${TRIGGER_MARKER} ../*.yml, ../foo.ts, ../../*.ts`),
      'scripts/x.test.ts',
    );
    expect(header).toEqual({ kind: 'triggers', triggers: ['*.yml', 'foo.ts', '../*.ts'] });
    expect(readTriggerHeader(lines(`// ${TRIGGER_MARKER} ./*.ts, ./a.ts`), 'x.test.ts')).toEqual({
      kind: 'triggers',
      triggers: ['*.ts', 'a.ts'],
    });
    const suites = [{ path: 'scripts/x.test.ts', triggers: header.triggers!.slice(0, 2) }];
    expect(selectDeclaredSuites(suites, ['electron-builder.yml'])).toEqual(['scripts/x.test.ts']);
    expect(selectDeclaredSuites(suites, ['foo.ts'])).toEqual(['scripts/x.test.ts']);
    expect(selectDeclaredSuites(suites, ['scripts/foo.ts'])).toEqual([]);
  });

  it('rejects entries that escape the package root or are absolute', () => {
    const result = inspectDeclaredSuites([
      {
        path: 'scripts/x.test.ts',
        content: lines(`// ${TRIGGER_MARKER} ../../*.ts, src/a.ts`, ''),
      },
      {
        path: 'scripts/y.test.ts',
        content: lines(`// ${TRIGGER_MARKER} /src/preload/index.ts`, ''),
      },
      { path: 'scripts/z.test.ts', content: lines(`// ${TRIGGER_MARKER} C:\\src\\a.ts`, '') },
    ]);
    expect(result.suites).toEqual([]);
    expect(result.violations.map((entry) => [entry.path, entry.message])).toEqual([
      ['scripts/x.test.ts', `${TRIGGER_MARKER} entries are not repo-relative: ../*.ts`],
      [
        'scripts/y.test.ts',
        `${TRIGGER_MARKER} entries are not repo-relative: /src/preload/index.ts`,
      ],
      ['scripts/z.test.ts', `${TRIGGER_MARKER} entries are not repo-relative: C:/src/a.ts`],
    ]);
  });

  it('reads the exempt marker with its reason and ignores markers after the first token', () => {
    expect(
      readTriggerHeader(lines(`// ${EXEMPT_MARKER} reads only its temp dir`, 'const a = 1;')),
    ).toEqual({ kind: 'exempt', reason: 'reads only its temp dir' });
    expect(readTriggerHeader(lines('const a = 1;', `// ${TRIGGER_MARKER} src/a.ts`))).toEqual({
      kind: null,
    });
  });
});

describe('matchesTrigger', () => {
  it('matches exact paths and globs only', () => {
    expect(matchesTrigger('src/preload/index.ts', 'src/preload/index.ts')).toBe(true);
    expect(matchesTrigger('src/preload/index.ts', 'src/preload/index.template.ts')).toBe(false);
    expect(matchesTrigger('src/lib/components/**', 'src/lib/components/a/b/C.svelte')).toBe(true);
    expect(matchesTrigger('src/lib/components/**', 'src/lib/componentsx/C.svelte')).toBe(false);
    expect(matchesTrigger('src/lib/*.svelte', 'src/lib/nested/C.svelte')).toBe(false);
  });

  it('matches literal route segments before treating brackets as glob syntax', () => {
    const route = 'src/routes/(app)/workspace/[id]/+page.svelte';
    expect(matchesTrigger(route, route)).toBe(true);
    expect(matchesTrigger(route, 'src/routes/(app)/workspace/xyz/+page.svelte')).toBe(false);
    expect(matchesTrigger('src/*.{ts,svelte}', 'src/App.svelte')).toBe(true);
  });

  it('recognizes extglob entries as glob syntax', () => {
    expect(matchesTrigger('src/@(a|b).ts', 'src/a.ts')).toBe(true);
    expect(matchesTrigger('src/@(a|b).ts', 'src/c.ts')).toBe(false);
    expect(matchesTrigger('src/+(a|b).ts', 'src/ab.ts')).toBe(true);
    expect(matchesTrigger('src/!(b).ts', 'src/a.ts')).toBe(true);
    expect(matchesTrigger('src/!(b).ts', 'src/b.ts')).toBe(false);
    expect(matchesTrigger('src/?(a)b.ts', 'src/b.ts')).toBe(true);
    expect(matchesTrigger('src/*(a).ts', 'src/aa.ts')).toBe(true);
    expect(matchesTrigger('src/routes/[(]app[)]/*.ts', 'src/routes/(app)/x.ts')).toBe(true);
    expect(matchesTrigger('src/routes/(app)/x.ts', 'src/routes/(app)/x.ts')).toBe(true);
  });
});

describe('requiresTriggerDeclaration', () => {
  const rootReads: Array<[string, string]> = [
    ['process.cwd()', "readFileSync(path.join(process.cwd(), 'src/a.ts'), 'utf8')"],
    ['__dirname', "fs.readdirSync(path.resolve(__dirname, '..'))"],
    ['import.meta.url', "readFileSync(new URL('../Sidebar.svelte', import.meta.url), 'utf8')"],
    ['import.meta.dirname', "await fs.promises.readFile(path.join(import.meta.dirname, 'x'))"],
    ['a repoRoot binding', "readdir(path.join(repoRoot, 'src'))"],
    ['a bare src/ literal', "readFileSync('src/lib/App.svelte', 'utf8')"],
    ['an existsSync probe', "expect(existsSync(resolve(process.cwd(), 'src/a.ts'))).toBe(true)"],
    ['a cwd option', "globSync('*.ts', { cwd: path.join(process.cwd(), 'src/shared') })"],
    ['a bare src/ cwd option', "fs.globSync('**/*.ts', { cwd: 'src/shared' })"],
    [
      'a bound options object',
      "const opts = { cwd: path.join(process.cwd(), 'src/shared') }; globSync('*.ts', opts)",
    ],
    [
      'a shorthand cwd option',
      "const cwd = path.join(process.cwd(), 'src/shared'); globSync('*.ts', { cwd })",
    ],
    [
      'a cwd option beside a spread',
      "const defaults = { withFileTypes: false }; globSync('*.ts', { ...defaults, cwd: process.cwd() })",
    ],
    [
      'a bound options object with a spread',
      "const defaults = { withFileTypes: false }; const opts = { ...defaults, cwd: process.cwd() }; globSync('*.ts', opts)",
    ],
  ];
  for (const [label, read] of rootReads) {
    it(`flags a read derived from ${label}`, () => {
      const content = lines(
        "import fs, { readFileSync, readdirSync } from 'node:fs';",
        "import { readdir } from 'node:fs/promises';",
        "import path from 'node:path';",
        "import { it } from 'vitest';",
        "const repoRoot = path.resolve(process.env.ROOT ?? '.');",
        `it('x', async () => { ${read}; });`,
      );
      expect(requiresTriggerDeclaration(content, 'src/lib/__tests__/a.test.ts')).toBe(true);
    });
  }

  it('follows a root through an assignment made after declaration', () => {
    const content = lines(
      "import { readFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "import { beforeAll, it } from 'vitest';",
      'let sourcePath: string;',
      "beforeAll(() => { sourcePath = join(process.cwd(), 'src/app.html'); });",
      "it('x', () => expect(readFileSync(sourcePath, 'utf8')).toContain('x'));",
    );
    expect(requiresTriggerDeclaration(content, 'src/lib/__tests__/a.test.ts')).toBe(true);
  });

  it('follows a root through intermediate bindings and helper functions', () => {
    const content = lines(
      "import { readFileSync } from 'node:fs';",
      "import { dirname, join } from 'node:path';",
      "import { fileURLToPath } from 'node:url';",
      "it('x', () => expect(source('Foo.svelte')).toContain('x'));",
      'function source(name) { return readFileSync(join(componentsDir, name), "utf8"); }',
      'const here = dirname(fileURLToPath(import.meta.url));',
      "const componentsDir = join(here, '..');",
    );
    expect(requiresTriggerDeclaration(content, 'src/lib/__tests__/a.test.ts')).toBe(true);
  });

  it('does not taint a helper parameter that shadows a tainted module-level name', () => {
    const suite = (helperRead: string) =>
      lines(
        "import { spawnSync } from 'node:child_process';",
        "import { mkdtempSync, readFileSync } from 'node:fs';",
        "import { tmpdir } from 'node:os';",
        "import { join } from 'node:path';",
        "import { it } from 'vitest';",
        "const args = ['--root', process.cwd()];",
        "const tmp = mkdtempSync(join(tmpdir(), 'case-'));",
        `function run(args: string[]) { return ${helperRead}; }`,
        "it('x', () => {",
        '  spawnSync(process.execPath, args);',
        "  expect(run(['owner.json'])).toBe('{}');",
        '});',
      );
    const fixtureOnly = suite("readFileSync(join(tmp, ...args), 'utf8')");
    expect(requiresTriggerDeclaration(fixtureOnly, 'scripts/a.test.ts')).toBe(false);
    const renamed = fixtureOnly
      .replaceAll('run(args', 'run(files')
      .replace('...args)', '...files)');
    expect(requiresTriggerDeclaration(renamed, 'scripts/a.test.ts')).toBe(false);
    const repoRead = suite("readFileSync(join(process.cwd(), ...args), 'utf8')");
    expect(requiresTriggerDeclaration(repoRead, 'scripts/a.test.ts')).toBe(true);
  });

  it('lets block-scoped locals shadow a tainted outer name and still follows unshadowed ones', () => {
    const shadowed = lines(
      "import { mkdtempSync, readFileSync } from 'node:fs';",
      "import { tmpdir } from 'node:os';",
      "import { join } from 'node:path';",
      "import { it } from 'vitest';",
      "const root = join(process.cwd(), 'src');",
      "const tmp = mkdtempSync(join(tmpdir(), 'case-'));",
      "it('x', () => {",
      "  const root = join(tmp, 'fixture');",
      "  expect(readFileSync(join(root, 'a.json'), 'utf8')).toBe('{}');",
      '});',
    );
    expect(requiresTriggerDeclaration(shadowed, 'scripts/a.test.ts')).toBe(false);
    const unshadowed = lines(
      "import { readFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "import { it } from 'vitest';",
      "const root = join(process.cwd(), 'src');",
      "it('x', () => {",
      "  const entry = join(root, 'a.ts');",
      "  expect(readFileSync(entry, 'utf8')).toContain('x');",
      '});',
    );
    expect(requiresTriggerDeclaration(unshadowed, 'scripts/a.test.ts')).toBe(true);
    const reassignedParameter = lines(
      "import { readFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "import { it } from 'vitest';",
      "function read(dir: string) { dir = process.cwd(); return readFileSync(join(dir, 'src/a.ts'), 'utf8'); }",
      "it('x', () => expect(read('x')).toContain('x'));",
    );
    expect(requiresTriggerDeclaration(reassignedParameter, 'scripts/a.test.ts')).toBe(true);
  });

  it('follows a root through parameter and destructuring defaults', () => {
    const suite = (helper: string) =>
      lines(
        "import { globSync, readFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "import { it } from 'vitest';",
        helper,
        "it('x', () => expect(helper()).toBeTruthy());",
      );
    const parameterDefault = suite(
      "function helper(root = process.cwd()) { return readFileSync(join(root, 'src/a.ts'), 'utf8'); }",
    );
    expect(requiresTriggerDeclaration(parameterDefault, 'scripts/a.test.ts')).toBe(true);
    const optionsDefault = suite(
      "function helper(opts = { cwd: process.cwd() }) { return globSync('*.ts', opts); }",
    );
    expect(requiresTriggerDeclaration(optionsDefault, 'scripts/a.test.ts')).toBe(true);
    const destructuredDefault = suite(
      "function helper({ root = process.cwd() } = {}) { return readFileSync(join(root, 'src/a.ts'), 'utf8'); }",
    );
    expect(requiresTriggerDeclaration(destructuredDefault, 'scripts/a.test.ts')).toBe(true);
    const patternDefault = suite(
      "function helper({ root } = { root: process.cwd() }) { return readFileSync(join(root, 'src/a.ts'), 'utf8'); }",
    );
    expect(requiresTriggerDeclaration(patternDefault, 'scripts/a.test.ts')).toBe(true);
    const destructuredVariable = suite(
      "function helper() { const { root } = { root: process.cwd() }; return readFileSync(join(root, 'src/a.ts'), 'utf8'); }",
    );
    expect(requiresTriggerDeclaration(destructuredVariable, 'scripts/a.test.ts')).toBe(true);
    const fixtureDefault = suite(
      "function helper(root = '/tmp/fixture') { return readFileSync(join(root, 'a.json'), 'utf8'); }",
    );
    expect(requiresTriggerDeclaration(fixtureDefault, 'scripts/a.test.ts')).toBe(false);
  });

  it('does not flag a suite that imports a source module (vitest related selects it)', () => {
    for (const specifier of ['../Sidebar.svelte', '$lib/utils', 'src/lib/utils']) {
      const content = lines(`import { thing } from '${specifier}';`, cwdReader);
      expect(requiresTriggerDeclaration(content, 'src/lib/__tests__/a.test.ts')).toBe(false);
    }
  });

  it('still flags a suite whose only source imports are type-only or test helpers', () => {
    const content = lines(
      "import type { Session } from '$shared/types';",
      "import { type A, type B } from '../types';",
      "import { renderHarness } from './test-utils';",
      "import { m } from '$shared/paraglide/messages.js';",
      cwdReader,
    );
    expect(requiresTriggerDeclaration(content, 'src/lib/__tests__/a.test.ts')).toBe(true);
  });

  it('resolves relative imports against the test file before counting them as source', () => {
    const scriptSuite = lines(
      "import { audit } from './audit.mjs';",
      "import { readFileSync } from 'node:fs';",
      "readFileSync(process.cwd() + '/src/app.html', 'utf8');",
    );
    expect(requiresTriggerDeclaration(scriptSuite, 'scripts/a.test.ts')).toBe(true);
    const helperSuite = lines("import { render } from './helpers';", cwdReader);
    expect(requiresTriggerDeclaration(helperSuite, 'src/lib/__tests__/a.test.ts')).toBe(true);
    const fixtureSuite = lines("import data from '../__fixtures__/data';", cwdReader);
    expect(requiresTriggerDeclaration(fixtureSuite, 'src/lib/__tests__/a.test.ts')).toBe(true);
    const mockSuite = lines("import { page } from '$app/stores';", cwdReader);
    expect(requiresTriggerDeclaration(mockSuite, 'src/lib/__tests__/a.test.ts')).toBe(true);
    const escapingSuite = lines("import { util } from '../../../scripts/util';", cwdReader);
    expect(requiresTriggerDeclaration(escapingSuite, 'src/lib/__tests__/a.test.ts')).toBe(true);
    const sourceSuite = lines("import { Sidebar } from '../Sidebar.svelte';", cwdReader);
    expect(requiresTriggerDeclaration(sourceSuite, 'src/lib/__tests__/a.test.ts')).toBe(false);
    const aliasSuite = lines("import { util } from '@/lib/util';", cwdReader);
    expect(requiresTriggerDeclaration(aliasSuite, 'scripts/a.test.ts')).toBe(false);
  });

  it('does not flag Playwright specs or integration suites', () => {
    expect(requiresTriggerDeclaration(cwdReader, 'src/lib/a.ct.spec.ts')).toBe(false);
    expect(requiresTriggerDeclaration(cwdReader, 'src/lib/a.visual.spec.ts')).toBe(false);
    expect(requiresTriggerDeclaration(cwdReader, 'tests/integration/a.test.ts')).toBe(false);
  });

  it('ignores reads that only appear in strings or comments', () => {
    const content = lines(
      "import { it } from 'vitest';",
      "// readFileSync(path.join(process.cwd(), 'src/a.ts'))",
      'const doc = "readFileSync(resolve(__dirname, \'x\'))";',
      "it('x', () => expect(doc).toContain('readFileSync'));",
    );
    expect(requiresTriggerDeclaration(content, 'src/lib/__tests__/a.test.ts')).toBe(false);
  });

  it('does not taint a fixture root through a computed object key naming a src path', () => {
    const content = lines(
      "import { readFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "import { it } from 'vitest';",
      "import { fixtureRoot } from './helpers';",
      "const entry = 'src/lib/a.ts';",
      "it('x', () => {",
      "  const root = fixtureRoot({ [entry]: '', 'src/lib/b.ts': '' });",
      "  expect(readFileSync(join(root, 'src/lib/b.ts'), 'utf8')).toBe('');",
      '});',
    );
    expect(requiresTriggerDeclaration(content, 'scripts/a.test.ts')).toBe(false);
  });

  it('does not flag a suite that reads only temp directories it creates', () => {
    const content = lines(
      "import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';",
      "import os from 'node:os';",
      "import path from 'node:path';",
      "import { it } from 'vitest';",
      "const root = mkdtempSync(path.join(os.tmpdir(), 'x-'));",
      'const opts = { cwd: root };',
      "it('x', () => {",
      "  writeFileSync(path.join(root, 'src/a.json'), '{}');",
      "  expect(readFileSync(path.join(root, 'src/a.json'), 'utf8')).toBe('{}');",
      "  expect(readFileSync(path.join(process.env.TMP ?? '/tmp', 'src/a.json'), 'utf8')).toBe('{}');",
      "  expect(globSync('**/*.json', { cwd: root })).toHaveLength(1);",
      "  expect(globSync('**/*.json', opts)).toHaveLength(1);",
      '});',
    );
    expect(requiresTriggerDeclaration(content, 'scripts/a.test.ts')).toBe(false);
  });

  it('does not flag a temp read whose callback or non-cwd option mentions the root', () => {
    const content = lines(
      "import fs, { mkdtempSync } from 'node:fs';",
      "import { tmpdir } from 'node:os';",
      "import { join } from 'node:path';",
      "import { it } from 'vitest';",
      "const tmp = mkdtempSync(join(tmpdir(), 'case-'));",
      "it('x', () => {",
      "  fs.readFile(join(tmp, 'output.txt'), 'utf8', (err, text) => {",
      '    expect(text).toContain(process.cwd());',
      '  });',
      "  fs.readdirSync(tmp, { withFileTypes: true, encoding: process.cwd() ? 'utf8' : 'utf8' });",
      '});',
    );
    expect(requiresTriggerDeclaration(content, 'scripts/a.test.ts')).toBe(false);
  });

  it('does not flag a bound temp options object whose other properties mention the root', () => {
    const content = lines(
      "import fs, { globSync, mkdtempSync } from 'node:fs';",
      "import { tmpdir } from 'node:os';",
      "import { join } from 'node:path';",
      "import { it } from 'vitest';",
      "const cwd = mkdtempSync(join(tmpdir(), 'case-'));",
      'const opts = {',
      '  cwd,',
      '  exclude: (name: string) => name.startsWith(process.cwd()),',
      '};',
      "const readOpts = { encoding: 'utf8', signal: process.cwd() ? undefined : undefined };",
      "it('x', () => {",
      "  expect(globSync('**/*', opts)).toHaveLength(0);",
      "  fs.readFile(join(cwd, 'output.txt'), readOpts, (err, text) => {",
      '    expect(text).toContain(process.cwd());',
      '  });',
      '});',
    );
    expect(requiresTriggerDeclaration(content, 'scripts/a.test.ts')).toBe(false);
  });

  it('does not flag or expand a spread beside a temp cwd option', () => {
    const content = lines(
      "import { globSync, mkdtempSync } from 'node:fs';",
      "import { tmpdir } from 'node:os';",
      "import { join } from 'node:path';",
      "import { it } from 'vitest';",
      "const tmp = mkdtempSync(join(tmpdir(), 'case-'));",
      'const defaults = { withFileTypes: false, exclude: (name: string) => name.startsWith(process.cwd()) };',
      "it('x', () => {",
      "  expect(globSync('**/*', { ...defaults, cwd: tmp })).toHaveLength(0);",
      '});',
    );
    expect(requiresTriggerDeclaration(content, 'scripts/a.test.ts')).toBe(false);
  });
});

describe('inspectDeclaredSuites', () => {
  const declared = lines(`// ${TRIGGER_MARKER} src/preload/index.ts, ./fixtures/**`, cwdReader);

  it('separates declared, exempt, and @ui-invariant suites and flags the rest', () => {
    const result = inspectDeclaredSuites([
      { path: 'src/b/missing.test.ts', content: cwdReader },
      { path: 'src/a/declared.test.ts', content: declared },
      {
        path: 'scripts/exempt.test.ts',
        content: lines(`// ${EXEMPT_MARKER} temp only`, cwdReader),
      },
      { path: 'scripts/gate.test.ts', content: lines('// @ui-invariant', cwdReader) },
      { path: 'src/c/pure.test.ts', content: "it('x', () => expect(1).toBe(1));" },
    ]);
    expect(result.suites).toEqual([
      { path: 'src/a/declared.test.ts', triggers: ['src/preload/index.ts', 'src/a/fixtures/**'] },
    ]);
    expect(result.exempt).toEqual([{ path: 'scripts/exempt.test.ts', reason: 'temp only' }]);
    expect(result.uiInvariant).toEqual(['scripts/gate.test.ts']);
    expect(result.violations.map((entry) => entry.path)).toEqual(['src/b/missing.test.ts']);
    expect(result.violations[0].hint).toContain(TRIGGER_MARKER);
    expect(result.auditedFiles).toBe(5);
  });

  it('reports an exempt marker without a reason and an empty trigger list', () => {
    const result = inspectDeclaredSuites([
      { path: 'a.test.ts', content: lines(`// ${EXEMPT_MARKER}`, "it('x', () => {});") },
      { path: 'b.test.ts', content: lines(`// ${TRIGGER_MARKER}`, "it('x', () => {});") },
      { path: 'c.test.ts', content: lines(`// ${TRIGGER_MARKER} ../../outside.ts`, '') },
    ]);
    expect(result.suites).toEqual([]);
    expect(result.violations.map((entry) => [entry.path, entry.message])).toEqual([
      ['a.test.ts', `${EXEMPT_MARKER} needs a reason`],
      ['b.test.ts', `${TRIGGER_MARKER} lists no paths`],
      ['c.test.ts', `${TRIGGER_MARKER} entries are not repo-relative: ../../outside.ts`],
    ]);
  });
});

describe('selectDeclaredSuites', () => {
  const suites = [
    { path: 'scripts/z.test.ts', triggers: ['src/preload/index.ts', 'src/shared/ipc-registry.ts'] },
    { path: 'scripts/a.test.ts', triggers: ['src/lib/components/**'] },
    { path: 'scripts/m.test.ts', triggers: ['src/lib/utils.ts'] },
  ];

  it('returns the sorted unique suites whose triggers intersect the changed set', () => {
    expect(
      selectDeclaredSuites(suites, [
        'src/lib/components/a/B.svelte',
        'src/preload/index.ts',
        'src/shared/ipc-registry.ts',
      ]),
    ).toEqual(['scripts/a.test.ts', 'scripts/z.test.ts']);
    expect(selectDeclaredSuites(suites, ['src/lib/utils.test.ts', 'README.md'])).toEqual([]);
  });
});

describe('CLI', () => {
  const run = (root: string, flag: string) =>
    spawnSync(process.execPath, [CLI, flag], { cwd: root, encoding: 'utf8', env: process.env });

  it('fails --check for an unmarked cwd-reading suite and passes once it is exempt', () => {
    const failing = fixtureRoot({ 'scripts/reader.test.ts': cwdReader });
    const result = run(failing, '--check');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('scripts/reader.test.ts');
    expect(result.stderr).toContain(TRIGGER_MARKER);

    const passing = fixtureRoot({
      'scripts/reader.test.ts': lines(`// ${EXEMPT_MARKER} reads its own temp dir`, cwdReader),
      'src/a/declared.test.ts': lines(`// ${TRIGGER_MARKER} src/preload/index.ts`, cwdReader),
      'src/a/other.ct.spec.ts': cwdReader,
    });
    expect(run(passing, '--check').status).toBe(0);
    const list = run(passing, '--list');
    expect(list.status).toBe(0);
    expect(list.stdout).toContain('src/a/declared.test.ts: src/preload/index.ts');
    expect(list.stdout).toContain('scripts/reader.test.ts: exempt (reads its own temp dir)');
    expect(listDeclaredSuites(passing).suites.map((suite) => suite.path)).toEqual([
      'src/a/declared.test.ts',
    ]);
  });

  it('rejects an unknown invocation', () => {
    expect(run(fixtureRoot({}), '--nope').status).toBe(2);
  });
});
