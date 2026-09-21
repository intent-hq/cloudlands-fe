// @vitest-environment node

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  ROOT_IGNORED_SPEC_NAMES,
  ROOT_SPEC_SUFFIX,
  ROOT_TEST_DIR,
  ROOT_TEST_IGNORE,
  ROOT_TEST_MATCH,
  isIgnoredRootSpec,
  isRootSpec,
} from './root-spec-pattern.mjs';

// The oracle is the root runner's own pattern matcher: the `playwright` that the
// top-level `@playwright/test` (the one `playwright.config.ts` runs under)
// resolves. Playwright builds one `createFileMatcher` for `testMatch` and one
// for `testIgnore` and keeps a file when `!testIgnore(file) && testMatch(file)`
// (playwright/lib/runner, `collectFilesForProject`); `isRootSpec` /
// `isIgnoredRootSpec` must agree, or a script routes a spec to the wrong lane.
// This establishes testMatch/testIgnore parity over repo-relative paths only:
// `collectFilesForProject` also filters on a case-sensitive extension list
// before matching, so a `test/a.Spec.TS` passes the matcher (and this oracle)
// but is never collected by `playwright test`. The extension filter is not
// modelled here; the repo commits only `.ts` specs, for which the two agree.
const rootRequire = createRequire(createRequire(import.meta.url).resolve('@playwright/test'));
const { createFileMatcher } = rootRequire('playwright/lib/util') as {
  createFileMatcher: (patterns: string | string[]) => (filePath: string) => boolean;
};
const playwrightMatches = createFileMatcher(ROOT_TEST_MATCH);
const playwrightIgnores = createFileMatcher(ROOT_TEST_IGNORE);
// Playwright walks `testDir` and matches absolute paths, so the oracle sees the
// repo-relative path without any `./` prefix and only files under `testDir`.
const underTestDir = (file: string) => {
  const path = file.replace(/^(?:\.\/)+/, '');
  return path.startsWith(`${ROOT_TEST_DIR}/`) ? path : null;
};
const patternAccepts = (file: string) => {
  const path = underTestDir(file);
  return path !== null && !playwrightIgnores(path) && playwrightMatches(path);
};
const patternIgnores = (file: string) => {
  const path = underTestDir(file);
  return path !== null && playwrightIgnores(path) && playwrightMatches(path);
};

const accepted = [
  'test/theme-contract.spec.ts',
  'test/nested/deeper/geometry.spec.ts',
  './test/theme-contract.spec.ts',
  'test/.hidden/x.spec.ts',
  'test/.dotfile.spec.ts',
  'test/Foo.SPEC.ts',
  'test/a.Spec.TS',
];
const ignored = [
  ...ROOT_IGNORED_SPEC_NAMES.map((name) => `test/${name}`),
  'test/nested/electron-browser-lifetime.spec.ts',
  './test/current-main-baseline.spec.ts',
  'test/Catalog-Manual-Review.Capture.SPEC.ts',
];
const rejected = [
  'test/a.test.ts',
  'test/a.spec.js',
  'test/a.spec.tsx',
  'test/a.spec.ts.snap',
  'tests/a.spec.ts',
  'src/test/a.spec.ts',
  'src/a.ct.spec.ts',
  'testing/a.spec.ts',
  'test',
  '',
];

describe('root spec pattern', () => {
  it('derives the discovery patterns from the one suffix and the ignored names', () => {
    expect(ROOT_TEST_DIR).toBe('test');
    expect(ROOT_TEST_MATCH).toBe(`**/*${ROOT_SPEC_SUFFIX}`);
    expect(ROOT_TEST_IGNORE).toEqual(ROOT_IGNORED_SPEC_NAMES.map((name) => `**/${name}`));
    expect(ROOT_IGNORED_SPEC_NAMES).toEqual([
      'catalog-manual-review.capture.spec.ts',
      'current-main-baseline.spec.ts',
      'electron-browser-lifetime.spec.ts',
    ]);
  });
});

describe('isRootSpec', () => {
  it.each(accepted)('accepts %s', (file) => {
    expect(isRootSpec(file)).toBe(true);
  });

  it.each([...ignored, ...rejected])('rejects %s', (file) => {
    expect(isRootSpec(file)).toBe(false);
  });

  it.each([...accepted, ...ignored, ...rejected])(
    "agrees with Playwright's testMatch and testIgnore on %s",
    (file) => {
      expect(isRootSpec(file)).toBe(patternAccepts(file));
    },
  );
});

describe('isIgnoredRootSpec', () => {
  it.each(ignored)('accepts %s', (file) => {
    expect(isIgnoredRootSpec(file)).toBe(true);
  });

  it.each([...accepted, ...rejected])('rejects %s', (file) => {
    expect(isIgnoredRootSpec(file)).toBe(false);
  });

  it.each([...accepted, ...ignored, ...rejected])(
    "agrees with Playwright's testMatch and testIgnore on %s",
    (file) => {
      expect(isIgnoredRootSpec(file)).toBe(patternIgnores(file));
    },
  );
});
