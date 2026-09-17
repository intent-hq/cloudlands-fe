import { describe, expect, it } from 'vitest';
import {
  CT_SPEC_SUFFIX,
  CT_TEST_DIR,
  CT_TEST_MATCH,
  ctGeometryScene,
  hasCtSpecSuffix,
  isCtSpec,
} from './ct-spec-pattern.mjs';

// `isCtSpec` matches with Node's `path.matchesGlob` while Playwright matches
// `testMatch` with its own glob engine; these fixtures pin that the two agree
// for `CT_TEST_MATCH` (`**/` spans zero or more directories, `*` never crosses
// `/`, the suffix is literal), so the change classifiers keep selecting exactly
// the files `playwright-ct.config.ts` discovers.
describe('isCtSpec', () => {
  it('derives the discovery pattern from the one suffix', () => {
    expect(CT_TEST_DIR).toBe('src');
    expect(CT_TEST_MATCH).toBe(`**/*${CT_SPEC_SUFFIX}`);
  });

  it.each([
    'src/a/b.ct.spec.ts',
    './src/a/b.ct.spec.ts',
    'src/top-level.ct.spec.ts',
    'src/lib/components/ui/card/card.geometry.ct.spec.ts',
  ])('accepts %s', (file) => {
    expect(isCtSpec(file)).toBe(true);
  });

  it.each([
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
  ])('rejects %s', (file) => {
    expect(isCtSpec(file)).toBe(false);
  });
});

describe('hasCtSpecSuffix', () => {
  it('checks only the suffix, regardless of directory', () => {
    expect(hasCtSpecSuffix('scripts/probe.ct.spec.ts')).toBe(true);
    expect(hasCtSpecSuffix('./src/a/b.ct.spec.ts')).toBe(true);
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
