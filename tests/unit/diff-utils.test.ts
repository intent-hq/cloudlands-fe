import { describe, it, expect } from 'vitest';
import { patchToContents } from '../../src/lib/utils/diff-utils';

describe('patchToContents', () => {
  it('returns empty strings for null/undefined/empty input', () => {
    expect(patchToContents(null)).toEqual({ oldContent: '', newContent: '' });
    expect(patchToContents(undefined)).toEqual({ oldContent: '', newContent: '' });
    expect(patchToContents('')).toEqual({ oldContent: '', newContent: '' });
  });

  it('parses a simple unified diff with additions and deletions', () => {
    const patch = [
      'diff --git a/file.txt b/file.txt',
      'index abc..def 100644',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,3 +1,3 @@',
      ' context line 1',
      '-old line',
      '+new line',
      ' context line 2',
    ].join('\n');

    const result = patchToContents(patch);
    expect(result.oldContent).toBe('context line 1\nold line\ncontext line 2');
    expect(result.newContent).toBe('context line 1\nnew line\ncontext line 2');
  });

  it('handles patches ending with a trailing newline (no spurious empty line)', () => {
    const patch = [
      'diff --git a/file.txt b/file.txt',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      ' context',
      '', // trailing newline artifact from split
    ].join('\n');

    const result = patchToContents(patch);
    // Should NOT have a trailing empty line
    expect(result.oldContent).toBe('old\ncontext');
    expect(result.newContent).toBe('new\ncontext');
  });

  it('preserves empty context lines within a hunk', () => {
    // This is the bug that today's commit fixed: empty lines in the middle
    // of a hunk are context lines (some diff tools omit the leading space)
    const patch = [
      'diff --git a/file.txt b/file.txt',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,5 +1,5 @@',
      ' line 1',
      '',  // empty context line (no leading space)
      '-old line 3',
      '+new line 3',
      '',  // empty context line (no leading space)
      ' line 5',
    ].join('\n');

    const result = patchToContents(patch);
    expect(result.oldContent).toBe('line 1\n\nold line 3\n\nline 5');
    expect(result.newContent).toBe('line 1\n\nnew line 3\n\nline 5');
  });

  it('handles empty context lines AND trailing newline correctly', () => {
    // Combines both: empty context lines in the middle + trailing newline
    const patch = [
      '@@ -1,4 +1,4 @@',
      ' line 1',
      '',  // empty context line
      '-old',
      '+new',
      ' line 4',
    ].join('\n') + '\n'; // trailing newline

    const result = patchToContents(patch);
    expect(result.oldContent).toBe('line 1\n\nold\nline 4');
    expect(result.newContent).toBe('line 1\n\nnew\nline 4');
  });

  it('handles multiple hunks', () => {
    const patch = [
      '@@ -1,3 +1,3 @@',
      ' context A',
      '-old A',
      '+new A',
      ' context A end',
      '@@ -10,3 +10,3 @@',
      ' context B',
      '-old B',
      '+new B',
      ' context B end',
    ].join('\n');

    const result = patchToContents(patch);
    expect(result.oldContent).toBe('context A\nold A\ncontext A end\ncontext B\nold B\ncontext B end');
    expect(result.newContent).toBe('context A\nnew A\ncontext A end\ncontext B\nnew B\ncontext B end');
  });

  it('handles additions only (new file)', () => {
    const patch = [
      '@@ -0,0 +1,3 @@',
      '+line 1',
      '+line 2',
      '+line 3',
    ].join('\n');

    const result = patchToContents(patch);
    expect(result.oldContent).toBe('');
    expect(result.newContent).toBe('line 1\nline 2\nline 3');
  });

  it('handles deletions only (deleted file)', () => {
    const patch = [
      '@@ -1,3 +0,0 @@',
      '-line 1',
      '-line 2',
      '-line 3',
    ].join('\n');

    const result = patchToContents(patch);
    expect(result.oldContent).toBe('line 1\nline 2\nline 3');
    expect(result.newContent).toBe('');
  });

  it('skips "No newline at end of file" markers', () => {
    const patch = [
      '@@ -1,2 +1,2 @@',
      '-old line',
      '\\ No newline at end of file',
      '+new line',
      '\\ No newline at end of file',
    ].join('\n');

    const result = patchToContents(patch);
    expect(result.oldContent).toBe('old line');
    expect(result.newContent).toBe('new line');
  });

  it('ignores lines before the first hunk header', () => {
    const patch = [
      'some random text',
      'more random text',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n');

    const result = patchToContents(patch);
    expect(result.oldContent).toBe('old');
    expect(result.newContent).toBe('new');
  });
});
