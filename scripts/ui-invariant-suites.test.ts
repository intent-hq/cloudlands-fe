// @vitest-environment node
// @ui-invariant
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  collectTestFiles,
  inspectUiInvariantSuites,
  listUiInvariantSuites,
  readHeaderMarker,
  requiresUiInvariantMarker,
} from './ui-invariant-suites.mjs';

const CLI = path.resolve('scripts/ui-invariant-suites.mjs');

const inventoryConsumer = [
  "import { describe, it } from 'vitest';",
  "import { buildUiComponentInventory } from '../../scripts/ui-component-inventory';",
  'it("x", () => buildUiComponentInventory());',
].join('\n');
const ledgerConsumer = [
  "import { fooMetadata } from './foo.meta';",
  'it("x", () => expect(fooMetadata.callers).toHaveLength(2));',
].join('\n');

function writeFixture(root: string, files: Record<string, string>) {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
}

function runCli(cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('ui invariant suite markers', () => {
  it('reads the gate marker from leading comments only', () => {
    expect(readHeaderMarker("// @ui-invariant\nimport x from 'y';")).toEqual({ kind: 'gate' });
    expect(readHeaderMarker('// @vitest-environment node\n// @ui-invariant\nimport x;')).toEqual({
      kind: 'gate',
    });
    expect(
      readHeaderMarker('/**\n * @vitest-environment jsdom\n * @ui-invariant\n */\nimport x;'),
    ).toEqual({ kind: 'gate' });
    expect(readHeaderMarker('/* Header\nMore description\n\n@ui-invariant\n*/\nimport x;')).toEqual(
      { kind: 'gate' },
    );
    expect(readHeaderMarker('#!/usr/bin/env node\n// @ui-invariant\nconst a = 1;')).toEqual({
      kind: 'gate',
    });
    expect(readHeaderMarker('\uFEFF// intro\r\n\r\n// @ui-invariant\r\nconst a = 1;')).toEqual({
      kind: 'gate',
    });
    expect(readHeaderMarker("import x from 'y';\n// @ui-invariant")).toEqual({ kind: null });
    expect(readHeaderMarker('// @ui-invariants are documented elsewhere')).toEqual({ kind: null });
  });

  it('reads the exemption marker with its reason', () => {
    expect(readHeaderMarker('// @ui-invariant-exempt: ledger only\nimport x;')).toEqual({
      kind: 'exempt',
      reason: 'ledger only',
    });
    expect(readHeaderMarker('/* @ui-invariant-exempt: ledger only */\nimport x;')).toEqual({
      kind: 'exempt',
      reason: 'ledger only',
    });
    expect(readHeaderMarker('// @ui-invariant-exempt:\nimport x;')).toEqual({
      kind: 'exempt',
      reason: '',
    });
  });

  it('ignores markers that appear in code after the header comments end', () => {
    const content =
      '/* Header */ const marker = "@ui-invariant-exempt: example";\nbuildUiComponentInventory();';
    expect(readHeaderMarker(content)).toEqual({ kind: null });
    const result = inspectUiInvariantSuites([{ path: 'a/a.test.ts', content }]);
    expect(result.suites).toEqual([]);
    expect(result.exempt).toEqual([]);
    expect(result.violations).toHaveLength(1);
  });

  it('requires a marker for inventory consumers and *.meta caller ledger assertions', () => {
    expect(requiresUiInvariantMarker(inventoryConsumer)).toBe(true);
    expect(requiresUiInvariantMarker(ledgerConsumer)).toBe(true);
    expect(
      requiresUiInvariantMarker(
        'const { fooMetadata } = await import("./foo.meta");\nexpect(fooMetadata.callers).toHaveLength(2);',
      ),
    ).toBe(true);
    expect(
      requiresUiInvariantMarker(
        "import { fooMetadata } from /* keep */ './foo.meta';\nexpect(fooMetadata.callers).toEqual([]);",
      ),
    ).toBe(true);
    expect(
      requiresUiInvariantMarker(
        "import { fooMetadata } from './foo.meta.ts';\nexpect(fooMetadata?.callers).toEqual([]);",
      ),
    ).toBe(true);
    expect(
      requiresUiInvariantMarker(
        'const punctuation = /[/*]/;\nimport { probe } from "./probe.meta";\nexpect(probe.callers).toEqual([]);',
      ),
    ).toBe(true);
    expect(
      requiresUiInvariantMarker(
        'import { probe } from "./probe.meta";\nexpect(probe./* ledger */callers).toEqual([]);',
      ),
    ).toBe(true);
    expect(
      requiresUiInvariantMarker(
        "import { fooMetadata } from './foo.meta';\nexpect(<div>{fooMetadata.callers.length}</div>);",
        'src/foo.test.tsx',
      ),
    ).toBe(true);
  });

  it('does not treat comments, strings, regexes, or unrelated locals as consumers', () => {
    expect(
      requiresUiInvariantMarker(
        'it("buildUiComponentInventory() is only documentation", () => expect(1).toBe(1));',
      ),
    ).toBe(false);
    expect(
      requiresUiInvariantMarker(
        'const re = /buildUiComponentInventory\\(/;\nexpect(re).toBeTruthy();',
      ),
    ).toBe(false);
    expect(
      requiresUiInvariantMarker(
        'import { probe } from "./probe.meta";\nconst s = `${/* probe.callers */ 1}`;\nexpect(s).toBe("1");',
      ),
    ).toBe(false);
    expect(
      requiresUiInvariantMarker(
        '// buildUiComponentInventory() is covered elsewhere\nconst a = 1;',
      ),
    ).toBe(false);
    expect(
      requiresUiInvariantMarker('/* see buildUiComponentInventory */\nit("x", () => {});'),
    ).toBe(false);
    expect(
      requiresUiInvariantMarker(
        "import { fooMetadata } from './foo.meta';\nconst callers = [];\nexpect(fooMetadata.name).toBe('x');",
      ),
    ).toBe(false);
    expect(
      requiresUiInvariantMarker("import { fooMetadata } from './foo.meta';\nexpect(fooMetadata);"),
    ).toBe(false);
    expect(
      requiresUiInvariantMarker("readFileSync(new URL('x', import.meta.url));\nconst callers = 1;"),
    ).toBe(false);
    expect(requiresUiInvariantMarker("import { render } from '@testing-library/svelte';")).toBe(
      false,
    );
  });

  it('names the file and both accepted markers when a qualifying suite is unmarked', () => {
    const result = inspectUiInvariantSuites([
      { path: 'src/lib/components/ui/foo/foo-callers.test.ts', content: ledgerConsumer },
      { path: 'src/lib/components/ui/bar/bar.test.ts', content: inventoryConsumer },
      { path: 'src/lib/components/ui/baz/baz.test.ts', content: "import { render } from 'x';" },
    ]);
    expect(result.suites).toEqual([]);
    expect(result.violations).toHaveLength(2);
    for (const [file, violation] of [
      ['src/lib/components/ui/bar/bar.test.ts', result.violations[0]],
      ['src/lib/components/ui/foo/foo-callers.test.ts', result.violations[1]],
    ]) {
      expect(violation).toContain(file);
      expect(violation).toContain('// @ui-invariant');
      expect(violation).toContain('// @ui-invariant-exempt: <reason>');
    }
  });

  it('admits marked suites, records reasoned exemptions, and rejects bare exemptions', () => {
    const result = inspectUiInvariantSuites([
      { path: 'z/marked.test.ts', content: `// @ui-invariant\n${ledgerConsumer}` },
      { path: 'a/unrelated-marked.test.ts', content: '// @ui-invariant\nimport x;' },
      {
        path: 'm/exempt.test.ts',
        content: `// @ui-invariant-exempt: related covers it\n${ledgerConsumer}`,
      },
      { path: 'n/bare.test.ts', content: `// @ui-invariant-exempt:\n${ledgerConsumer}` },
    ]);
    expect(result.suites).toEqual(['a/unrelated-marked.test.ts', 'z/marked.test.ts']);
    expect(result.exempt).toEqual([{ path: 'm/exempt.test.ts', reason: 'related covers it' }]);
    expect(result.violations).toEqual([
      'n/bare.test.ts: `@ui-invariant-exempt:` requires a reason',
    ]);
  });

  it('keeps the checked-in tree complete', () => {
    const result = listUiInvariantSuites(process.cwd());
    expect(result.violations).toEqual([]);
    expect(result.suites).toEqual(
      expect.arrayContaining([
        'scripts/design-token-audit.test.ts',
        'scripts/ui-component-audit.test.ts',
        'scripts/ui-component-integration.test.ts',
        'scripts/neutral-border-audit.test.ts',
        'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.test.ts',
        'src/lib/components/__tests__/disclosure-chevron-inventory.test.ts',
        'src/lib/components/ui/__tests__/ProductCompatibilityInventory.test.ts',
        'src/lib/components/ui/toggle/toggle-caller-regression.test.ts',
        'src/lib/components/ui/dropdown/Dropdown.test.ts',
      ]),
    );
  });
});

describe('ui invariant suite discovery and CLI', () => {
  const roots: string[] = [];
  const makeRoot = () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ui-invariant-suites-'));
    roots.push(root);
    return root;
  };
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it('discovers every vitest test filename form and skips Playwright suites', () => {
    const root = makeRoot();
    writeFixture(root, {
      'src/a.test.ts': '',
      'src/b.spec.ts': '',
      'src/c.test.tsx': '',
      'src/d.test.cts': '',
      'src/e.test.mjs': '',
      'scripts/f.test.js': '',
      'src/g.ct.spec.ts': '',
      'src/h.visual.spec.ts': '',
      'src/i.ts': '',
      'src/node_modules/j.test.ts': '',
      'src/.hidden/k.test.ts': '',
      'other/l.test.ts': '',
    });
    expect(collectTestFiles(root).map((file) => file.path)).toEqual([
      'scripts/f.test.js',
      'src/a.test.ts',
      'src/b.spec.ts',
      'src/c.test.tsx',
      'src/d.test.cts',
      'src/e.test.mjs',
    ]);
  });

  it('lists, checks, and fails on a missing marker from the command line', () => {
    const root = makeRoot();
    writeFixture(root, {
      'src/marked.spec.ts': '// @ui-invariant\n',
      'src/exempt.test.ts': `// @ui-invariant-exempt: ledger only\n${ledgerConsumer}`,
      'src/plain.test.ts': "import { it } from 'vitest';\n",
    });
    expect(runCli(root, ['--list'])).toEqual({ status: 0, output: 'src/marked.spec.ts\n' });
    const check = runCli(root, ['--check']);
    expect(check.status).toBe(0);
    expect(check.output).toContain('1 suites, 1 exempt, 3 test files audited');

    writeFixture(root, { 'src/consumer.test.tsx': inventoryConsumer });
    const failed = runCli(root, ['--check']);
    expect(failed.status).toBe(1);
    expect(failed.output).toContain('src/consumer.test.tsx');
    expect(failed.output).toContain('// @ui-invariant');
    expect(failed.output).toContain('// @ui-invariant-exempt: <reason>');
  });

  it('runs only marked suites through vitest, forwards arguments, and propagates the exit status', () => {
    const root = makeRoot();
    writeFixture(root, {
      'vitest.config.ts': "export default { test: { include: ['**/*.test.ts'] } };\n",
      'src/pass.test.ts': [
        '// @ui-invariant',
        "import { expect, it } from 'vitest';",
        "it('passes', () => expect(1).toBe(1));",
        "it('name with spaces', () => expect(2).toBe(2));",
      ].join('\n'),
      'src/fail.test.ts': [
        '// @ui-invariant',
        "import { it } from 'vitest';",
        "it('fails', () => { throw new Error('boom'); });",
      ].join('\n'),
      'src/unmarked.test.ts': [
        "import { it } from 'vitest';",
        "it('unmarked', () => { throw new Error('must not run'); });",
      ].join('\n'),
    });
    const filtered = runCli(root, ['--testNamePattern', 'name with spaces']);
    expect(filtered.status).toBe(0);
    expect(filtered.output).toMatch(/Tests\s+1 passed \| 2 skipped/);
    expect(filtered.output).not.toContain('unmarked');

    const unfiltered = runCli(root, []);
    expect(unfiltered.status).toBe(1);
    expect(unfiltered.output).toMatch(/Tests\s+1 failed \| 2 passed/);
    expect(unfiltered.output).not.toContain('must not run');
  });
});
