// @vitest-environment node

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  CT_SPEC_SUFFIX,
  CT_TEST_DIR,
  CT_TEST_MATCH,
  ctGeometryScene,
  hasCtSpecSuffix,
  isCtSpec,
} from './ct-spec-pattern.mjs';

// The oracle is the CT runner's own `testMatch` matcher: the `playwright` that
// `@playwright/experimental-ct-svelte` resolves through `experimental-ct-core`
// (not the top-level `@playwright/test`, which may be a different version).
// `createFileMatcher` is `minimatch(..., { nocase: true, dot: true })`, so a
// dot-directory spec or a case-folded suffix is discovered; `isCtSpec` must
// agree, or the CT gate and `verify:changed` skip a spec the matrix runs.
const ctRequire = createRequire(
  createRequire(
    createRequire(import.meta.url).resolve('@playwright/experimental-ct-svelte'),
  ).resolve('@playwright/experimental-ct-core'),
);
const { createFileMatcher } = ctRequire('playwright/lib/util') as {
  createFileMatcher: (patterns: string | string[]) => (filePath: string) => boolean;
};
const playwrightMatches = createFileMatcher(CT_TEST_MATCH);
// Playwright walks `testDir` and matches absolute paths, so the oracle sees the
// repo-relative path without any `./` prefix and only files under `testDir`.
const playwrightDiscovers = (file: string) => {
  const path = file.replace(/^(?:\.\/)+/, '');
  return path.startsWith(`${CT_TEST_DIR}/`) && playwrightMatches(path);
};

describe('isCtSpec', () => {
  it('derives the discovery pattern from the one suffix', () => {
    expect(CT_TEST_DIR).toBe('src');
    expect(CT_TEST_MATCH).toBe(`**/*${CT_SPEC_SUFFIX}`);
  });

  const accepted = [
    'src/a/b.ct.spec.ts',
    './src/a/b.ct.spec.ts',
    'src/top-level.ct.spec.ts',
    'src/lib/components/ui/card/card.geometry.ct.spec.ts',
    'src/.fixtures/button.ct.spec.ts',
    'src/.hidden.ct.spec.ts',
    'src/button.CT.spec.ts',
    'src/button.CT.SPEC.TS',
  ];
  const rejected = [
    'src/a/b.ct.test.ts',
    'src/a/b.ct.spec.js',
    'src/a/b.ct.spec.tsx',
    'src/a/b.ct.spec.mts',
    'src/a/b.ct.spec.ts.snap',
    'src/a/b.spec.ts',
    'tests/x.ct.spec.ts',
    'test/x.ct.spec.ts',
    'srcfoo/x.ct.spec.ts',
    'scripts/probe.ct.spec.ts',
    'src',
    '',
  ];

  it.each(accepted)('accepts %s', (file) => {
    expect(isCtSpec(file)).toBe(true);
  });

  it.each(rejected)('rejects %s', (file) => {
    expect(isCtSpec(file)).toBe(false);
  });

  it.each([...accepted, ...rejected])(
    "agrees with Playwright's testMatch matcher on %s",
    (file) => {
      expect(isCtSpec(file)).toBe(playwrightDiscovers(file));
    },
  );
});

describe('hasCtSpecSuffix', () => {
  it('checks only the suffix, regardless of directory or case', () => {
    expect(hasCtSpecSuffix('scripts/probe.ct.spec.ts')).toBe(true);
    expect(hasCtSpecSuffix('./src/a/b.ct.spec.ts')).toBe(true);
    expect(hasCtSpecSuffix('scripts/.probe.CT.spec.ts')).toBe(true);
    expect(hasCtSpecSuffix('src/a/b.ct.test.ts')).toBe(false);
    expect(hasCtSpecSuffix('src/a/b.ct.spec.tsx')).toBe(false);
  });
});

describe('ctGeometryScene', () => {
  it('extracts the directory and scene from a geometry spec path', () => {
    expect(ctGeometryScene('src/lib/components/ui/card/card.geometry.ct.spec.ts')).toEqual({
      directory: 'src/lib/components/ui/card/',
      scene: 'card',
    });
    expect(ctGeometryScene('./src/x/workspace-hover-card.geometry.ct.spec.ts')).toEqual({
      directory: 'src/x/',
      scene: 'workspace-hover-card',
    });
    expect(ctGeometryScene('card.geometry.ct.spec.ts')).toEqual({ directory: '', scene: 'card' });
    expect(ctGeometryScene('src/.fixtures/Card.Geometry.CT.Spec.TS')).toEqual({
      directory: 'src/.fixtures/',
      scene: 'Card',
    });
  });

  it.each([
    'src/x/card.ct.spec.ts',
    'src/x/card.geometry.ct.test.ts',
    'src/x/card.geometry.ct.spec.tsx',
    'src/x/.geometry.ct.spec.ts',
    'src/x/__geometry__/card.geometry.json',
  ])('returns null for %s', (file) => {
    expect(ctGeometryScene(file)).toBeNull();
  });
});
