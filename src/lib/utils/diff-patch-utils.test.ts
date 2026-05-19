import {
  decodeDiffContent,
  hasUnifiedDiffHeaders,
  withSyntheticDiffHeaders,
} from './diff-patch-utils';
import {
  describe,
  expect,
  it,
} from 'vitest';

describe('diff-patch-utils', () => {
  it('prepends synthetic headers to raw added and removed lines', () => {
    const result = withSyntheticDiffHeaders('-old\n+new');

    expect(result).toBe('--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-old\n+new');
    expect(hasUnifiedDiffHeaders(result)).toBe(true);
  });

  it('passes through valid unified diffs unchanged', () => {
    const diff = '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new';

    expect(hasUnifiedDiffHeaders(diff)).toBe(true);
    expect(withSyntheticDiffHeaders(diff)).toBe(diff);
  });

  it('handles all additions without removals', () => {
    expect(withSyntheticDiffHeaders('+one\n+two')).toBe(
      '--- a/file\n+++ b/file\n@@ -0,0 +1,2 @@\n+one\n+two'
    );
  });

  it('handles all deletions without additions', () => {
    expect(withSyntheticDiffHeaders('-one\n-two')).toBe(
      '--- a/file\n+++ b/file\n@@ -1,2 +0,0 @@\n-one\n-two'
    );
  });

  it('handles empty input', () => {
    expect(hasUnifiedDiffHeaders('')).toBe(false);
    expect(withSyntheticDiffHeaders('')).toBe('--- a/file\n+++ b/file\n@@ -0,0 +0,0 @@\n');
  });

  it('normalizes CRLF line endings when synthesizing headers', () => {
    expect(withSyntheticDiffHeaders('-old\r\n+new\r\n')).toBe(
      '--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-old\n+new\n'
    );
  });

  it('does not confuse body lines for unified diff headers unless the full header pattern matches', () => {
    const diff = '--- removed body text\n+++ added body text\n@@ body marker';

    expect(hasUnifiedDiffHeaders(diff)).toBe(false);
    expect(withSyntheticDiffHeaders(diff)).toBe(
      '--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n--- removed body text\n+++ added body text\n @@ body marker'
    );
  });

  it('prepends a space to context lines without one', () => {
    expect(withSyntheticDiffHeaders('context\n already spaced')).toBe(
      '--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n context\n already spaced'
    );
  });

  it('preserves no-newline markers without counting them as content lines', () => {
    expect(
      withSyntheticDiffHeaders('-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file')
    ).toBe(
      '--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file'
    );
  });

  it('decodes diff content from base64 and HTML entities', () => {
    const encoded = btoa(unescape(encodeURIComponent('+&lt;tag&gt;&amp;')));

    expect(decodeDiffContent(encoded)).toBe('+<tag>&');
  });
});