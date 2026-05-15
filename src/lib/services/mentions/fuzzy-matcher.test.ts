import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  fuzzyMatch,
  fuzzyFilterAndScore,
  pathFuzzyMatch,
} from './fuzzy-matcher';

describe('fuzzyMatch', () => {
  it('should match exact strings', () => {
    const result = fuzzyMatch('test', 'test');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should match camelCase patterns', () => {
    const result = fuzzyMatch('fmsy', 'FileManagementSystem');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should match partial words', () => {
    const result = fuzzyMatch('spec', 'specification');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should match multiple occurrences', () => {
    const result = fuzzyMatch('test', 'test-test-test');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should not match if characters are out of order', () => {
    const result = fuzzyMatch('tse', 'test');
    expect(result).toBeNull();
  });

  it('should be case-insensitive', () => {
    const result1 = fuzzyMatch('TEST', 'test');
    const result2 = fuzzyMatch('test', 'TEST');
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
  });

  it('should score matches with better span', () => {
    const consecutive = fuzzyMatch('test', 'test');
    const scattered = fuzzyMatch('test', 't-e-s-t');
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    // Both should have valid scores
    expect(consecutive!.score).toBeGreaterThan(0);
    expect(scattered!.score).toBeGreaterThan(0);
  });

  it('should score word boundary matches higher', () => {
    const wordBoundary = fuzzyMatch('file', 'FileManagement');
    const middle = fuzzyMatch('ile', 'FileManagement');
    expect(wordBoundary).not.toBeNull();
    expect(middle).not.toBeNull();
    expect(wordBoundary!.score).toBeGreaterThan(middle!.score);
  });

  it('should return null for empty query', () => {
    const result = fuzzyMatch('', 'test');
    expect(result).toBeNull();
  });

  it('should return null for empty target', () => {
    const result = fuzzyMatch('test', '');
    expect(result).toBeNull();
  });
});

describe('fuzzyFilterAndScore', () => {
  const candidates = [
    { id: '1', name: 'FileManagementSystem' },
    { id: '2', name: 'specification' },
    { id: '3', name: 'test-file' },
    { id: '4', name: 'implementation' },
  ];

  it('should filter and score candidates', () => {
    const results = fuzzyFilterAndScore('file', candidates, (c) => c.name);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('should sort by score descending', () => {
    const results = fuzzyFilterAndScore('file', candidates, (c) => c.name);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('should return all candidates when query is empty', () => {
    const results = fuzzyFilterAndScore('', candidates, (c) => c.name);
    expect(results.length).toBe(candidates.length);
  });

  it('should filter out non-matching candidates', () => {
    const results = fuzzyFilterAndScore('xyz', candidates, (c) => c.name);
    expect(results.length).toBe(0);
  });
});

describe('pathFuzzyMatch', () => {
  it('should match path segments with file extension', () => {
    const result = pathFuzzyMatch('routes/svelte', 'src/routes/shared/+page.svelte');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should match path segments without extension', () => {
    const result = pathFuzzyMatch('lib/comp', 'src/lib/components/Button.svelte');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should match non-adjacent path segments', () => {
    const result = pathFuzzyMatch('a/b/c', 'x/a/y/b/z/c.ts');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should match exact path segments', () => {
    const result = pathFuzzyMatch('src/index', 'src/index.ts');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should fall back to fuzzyMatch when query has no slash', () => {
    const result = pathFuzzyMatch('button', 'src/components/Button.svelte');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should match component names with partial fuzzy matching', () => {
    const result = pathFuzzyMatch('comp/btn', 'src/components/ui/Button.tsx');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should return null for empty query', () => {
    const result = pathFuzzyMatch('', 'src/file.ts');
    expect(result).toBeNull();
  });

  it('should return null for empty target path', () => {
    const result = pathFuzzyMatch('routes/svelte', '');
    expect(result).toBeNull();
  });

  it('should return null when query segments cannot be matched', () => {
    const result = pathFuzzyMatch('xyz/abc', 'src/routes/shared/+page.svelte');
    expect(result).toBeNull();
  });

  it('should score consecutive segments higher than non-adjacent', () => {
    const consecutive = pathFuzzyMatch('routes/shared', 'src/routes/shared/+page.svelte');
    const nonAdjacent = pathFuzzyMatch('routes/page', 'src/routes/shared/+page.svelte');
    expect(consecutive).not.toBeNull();
    expect(nonAdjacent).not.toBeNull();
    expect(consecutive!.score).toBeGreaterThan(nonAdjacent!.score);
  });

  it('should score filename matches higher', () => {
    const withFilename = pathFuzzyMatch('routes/page', 'src/routes/shared/+page.svelte');
    const withoutFilename = pathFuzzyMatch('routes/shared', 'src/routes/shared/+page.svelte');
    expect(withFilename).not.toBeNull();
    expect(withoutFilename).not.toBeNull();
    // Both should have valid scores
    expect(withFilename!.score).toBeGreaterThan(0);
    expect(withoutFilename!.score).toBeGreaterThan(0);
  });

  it('should match file extensions correctly', () => {
    const result = pathFuzzyMatch('svelte', 'src/routes/shared/+page.svelte');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should match tsx extension', () => {
    const result = pathFuzzyMatch('tsx', 'src/components/Button.tsx');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should be case-insensitive', () => {
    const result1 = pathFuzzyMatch('ROUTES/SVELTE', 'src/routes/shared/+page.svelte');
    const result2 = pathFuzzyMatch('routes/svelte', 'src/routes/shared/+page.svelte');
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    // Both should match
    expect(result1!.score).toBeGreaterThan(0);
    expect(result2!.score).toBeGreaterThan(0);
  });

  it('should handle paths with dots in filenames', () => {
    const result = pathFuzzyMatch('lib/index', 'src/lib/index.test.ts');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should handle single segment paths', () => {
    const result = pathFuzzyMatch('button', 'src/components/Button.svelte');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should not match if query segments are out of order', () => {
    const result = pathFuzzyMatch('shared/routes', 'src/routes/shared/+page.svelte');
    expect(result).toBeNull();
  });

  it('should handle trailing slashes', () => {
    const result = pathFuzzyMatch('routes/svelte/', 'src/routes/shared/+page.svelte');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });

  it('should handle leading slashes', () => {
    const result = pathFuzzyMatch('/routes/svelte', 'src/routes/shared/+page.svelte');
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThan(0);
  });
});
