// @verify-changed-triggers: scripts/**, playwright/**

import { describe, expect, it } from 'vitest';
import {
  checkSpecPatternSources,
  collectSourceFiles,
  extractLiterals,
  findOffenders,
  isScannedPath,
} from './check-spec-pattern-sources.mjs';

const file = (path: string, ...lines: string[]) => ({ path, content: lines.join('\n') });
const rules = (...lines: string[]) => findOffenders(lines.join('\n')).map((hit) => hit.rule);

describe('spec pattern sources guard', () => {
  it.each([
    ['root regex', 'const PLAYWRIGHT_TEST_RE = /^test\\/.*\\.spec\\.ts$/;', 'rootPattern'],
    ['root regex with dotall class', 'const RE = /^test\\/[^]*\\.spec\\.ts$/;', 'rootPattern'],
    ['root glob string', "const GLOB = 'test/**/*.spec.ts';", 'rootPattern'],
    ['root glob with ./ prefix', 'const GLOB = "./test/**/*.spec.ts";', 'rootPattern'],
    ['root glob template', 'const GLOB = `test/**/*.spec.ts`;', 'rootPattern'],
    ['upper-case suffix', "const GLOB = 'test/**/*.SPEC.TS';", 'rootPattern'],
    ['CT suffix string', "if (file.endsWith('.ct.spec.ts')) run(file);", 'ctSuffix'],
    ['CT suffix regex', 'const CT_RE = /\\.ct\\.spec\\.ts$/;', 'ctSuffix'],
    ['CT glob under src', "const CT_GLOB = 'src/**/*.ct.spec.ts';", 'ctSuffix'],
    [
      'ignored basename',
      "const MANUAL = ['catalog-manual-review.capture.spec.ts'];",
      'ignoredSpec',
    ],
    [
      'ignored stems in an alternation',
      'const MANUAL_RE = /(?:^|\\/)(?:catalog-manual-review\\.capture|current-main-baseline)\\.spec\\.ts$/;',
      'ignoredSpec',
    ],
    ['ignored electron spec', "skip('electron-browser-lifetime.spec.ts');", 'ignoredSpec'],
    ['ROOT_ dir constant', "export const ROOT_TEST_DIR = 'test';", 'rootConstant'],
    ['ROOT_ dir constant with slash', "const ROOT_DIR = './test/';", 'rootConstant'],
    ['ROOT_ suffix constant', "export const ROOT_SPEC_SUFFIX = '.spec.ts';", 'rootConstant'],
    ['ROOT_ suffix regex', 'const ROOT_SPEC_RE = /\\.spec\\.ts$/;', 'rootConstant'],
    ['PLAYWRIGHT_ suffix template', 'let PLAYWRIGHT_MATCH = `**/*.spec.ts`;', 'rootConstant'],
    ['ROOT_ constant after a comment', '// dir\nconst ROOT_TEST_DIR =\n  "test";', 'rootConstant'],
  ])('flags %s', (_name, line, rule) => {
    expect(rules(line)).toEqual([rule]);
  });

  it.each([
    [
      'module import',
      "import { isRootSpec, ROOT_TEST_DIR } from '../playwright/root-spec-pattern.mjs';",
    ],
    [
      'CT module import',
      "import { CT_TEST_DIR, isCtSpec } from '../playwright/ct-spec-pattern.mjs';",
    ],
    ['classifier call', "if (isRootSpec(file)) return 'playwright';"],
    ['dir prefix from the module', 'if (file.startsWith(`${ROOT_TEST_DIR}/`)) return manual;'],
    ['glob built from module constants', 'const GLOB = `${ROOT_TEST_DIR}/${ROOT_TEST_MATCH}`;'],
    ['agent-list-scope test-path heuristic', 'const TEST_PATH = /\\.(?:ct|visual)\\.spec\\./;'],
    ['unit-test suffix family', 'const UNIT_TEST_RE = /\\.(?:test|spec)\\.[cm]?[jt]sx?$/;'],
    [
      'test-or-spec ts suffix',
      'const isTestFile = (p) => /\\.(?:test|spec|ct\\.spec)\\.ts$/.test(p);',
    ],
    ['visual suffix', 'const VISUAL_TEST_RE = /\\.visual\\.spec\\.ts$/;'],
    ['generic spec suffix without a dir', 'if (/\\.spec\\.(ts|js|tsx|jsx)$/.test(p)) skip();'],
    ['integration dir', 'const INTEGRATION_TEST_RE = /^tests\\/integration\\/.*\\.test\\.ts$/;'],
    ['vitest include glob', "const VITEST_INCLUDE_GLOB = '**/*.{test,spec}.?(c|m)[jt]s?(x)';"],
    ['a test/ path that is not a spec', "const CT_TEST = 'src/test/ct-test.ts';"],
    ['plain dir string not on a ROOT_ name', "const dir = 'test';"],
    ['plain suffix string not on a ROOT_ name', "const suffix = '.spec.ts';"],
    ['ROOT_ name holding something else', "const ROOT_PACKAGE = 'package.json';"],
    ['line comment', '// mirrors playwright.config.ts: test/**/*.spec.ts'],
    ['block comment', '/* the CT suffix is .ct.spec.ts */'],
    ['comment after a URL string', "const u = 'https://x'; // test/**/*.spec.ts"],
    ['division, not a regex', 'const ratio = total / count; // test/**/*.spec.ts'],
    ['division between calls', 'const r = a() / b() / 2;'],
  ])('ignores %s', (_name, line) => {
    expect(rules(line)).toEqual([]);
  });

  it('reports the line and source text of every hit', () => {
    expect(
      findOffenders(
        [
          "import { isCtSpec } from '../playwright/ct-spec-pattern.mjs';",
          '',
          'const ROOT_RE = /^test\\/.*\\.spec\\.ts$/;',
          "const CT = '.ct.spec.ts';",
        ].join('\n'),
      ),
    ).toEqual([
      { line: 3, text: 'const ROOT_RE = /^test\\/.*\\.spec\\.ts$/;', rule: 'rootPattern' },
      { line: 4, text: "const CT = '.ct.spec.ts';", rule: 'ctSuffix' },
    ]);
  });

  it('extracts regex literals only where a regex can start', () => {
    const literals = extractLiterals(
      ['const a = x / y / z;', 'return /^test\\//.test(p);', "call('q', /z/);"].join('\n'),
    );
    expect(literals.map((literal) => literal.text)).toEqual(['^test\\/', 'q', 'z']);
  });

  it('walks template expressions without ending the template early', () => {
    const literals = extractLiterals('const s = `${a ? `${b}` : "}"} tail`; const t = /x/;');
    expect(literals.map((literal) => literal.text)).toEqual(['${a ? `${b}` : "}"} tail', 'x']);
  });

  it('scans only source under the roots and never test files or the pattern modules', () => {
    expect(isScannedPath('scripts/verify-changed.mjs')).toBe(true);
    expect(isScannedPath('scripts/perf/run.cjs')).toBe(true);
    expect(isScannedPath('playwright/ct-port.ts')).toBe(true);
    expect(isScannedPath('scripts/verify-changed.test.ts')).toBe(false);
    expect(isScannedPath('playwright/root-spec-pattern.mjs')).toBe(false);
    expect(isScannedPath('playwright/ct-spec-pattern.mjs')).toBe(false);
    expect(isScannedPath('playwright/root-spec-pattern.test.ts')).toBe(false);
    expect(isScannedPath('scripts/README.md')).toBe(false);
  });

  it('reports hits per file and skips test fixtures and allowlisted files', () => {
    const allowlist = { 'scripts/legacy.mjs': 'kept for the fixture' };
    const { hits, stale } = checkSpecPatternSources(
      [
        file('scripts/new.mjs', 'const RE = /^test\\/.*\\.spec\\.ts$/;'),
        file('scripts/new.test.ts', "expect(isRootSpec('test/a.spec.ts')).toBe(true);"),
        file('scripts/legacy.mjs', "const CT = '.ct.spec.ts';"),
        file('scripts/clean.mjs', "import { isCtSpec } from '../playwright/ct-spec-pattern.mjs';"),
      ],
      allowlist,
    );
    expect(hits).toEqual([
      {
        path: 'scripts/new.mjs',
        line: 1,
        text: 'const RE = /^test\\/.*\\.spec\\.ts$/;',
        rule: 'rootPattern',
      },
    ]);
    expect(stale).toEqual([]);
  });

  it('reports an allowlist entry whose file no longer offends as stale', () => {
    const { hits, stale } = checkSpecPatternSources(
      [file('scripts/legacy.mjs', "import { isCtSpec } from '../playwright/ct-spec-pattern.mjs';")],
      { 'scripts/legacy.mjs': 'no longer needed' },
    );
    expect(hits).toEqual([]);
    expect(stale).toEqual(['scripts/legacy.mjs']);
  });

  it('finds no re-derived spec discovery in the repository scripts', () => {
    const { hits, stale } = checkSpecPatternSources(collectSourceFiles(process.cwd()));
    expect(hits.map((hit) => `${hit.path}:${hit.line} ${hit.text}`)).toEqual([]);
    expect(stale).toEqual([]);
  });
});
