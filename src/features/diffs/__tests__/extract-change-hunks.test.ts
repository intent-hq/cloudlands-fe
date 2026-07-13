/**
 * Tests for extract-change-hunks utility
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  extractChangesFromDiff,
  extractChangesFromContents,
  parseGitStatus,
} from '../main/extract-change-hunks';

describe('extract-change-hunks', () => {
  describe('extractChangesFromDiff', () => {
    it('should extract hunks from a simple diff', () => {
      const diff = `diff --git a/test.ts b/test.ts
index abc123..def456 100644
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3`;

      const hunks = extractChangesFromDiff(diff);
      expect(hunks).toHaveLength(1);
      expect(hunks[0].file).toBe('test.ts');
      expect(hunks[0].startLine).toBe(1);
      expect(hunks[0].type).toBe('modified');
    });

    it('should handle new file', () => {
      const diff = `diff --git a/new-file.ts b/new-file.ts
new file mode 100644
index 0000000..abc123
--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,3 @@
+line 1
+line 2
+line 3`;

      const hunks = extractChangesFromDiff(diff);
      expect(hunks).toHaveLength(1);
      expect(hunks[0].file).toBe('new-file.ts');
      expect(hunks[0].type).toBe('added');
    });

    it('should handle deleted file', () => {
      const diff = `diff --git a/deleted.ts b/deleted.ts
deleted file mode 100644
index abc123..0000000
--- a/deleted.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-line 1
-line 2
-line 3`;

      const hunks = extractChangesFromDiff(diff);
      expect(hunks).toHaveLength(1);
      expect(hunks[0].file).toBe('deleted.ts');
      expect(hunks[0].type).toBe('deleted');
    });

    it('should handle multiple files', () => {
      const diff = `diff --git a/file1.ts b/file1.ts
index abc..def 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,2 +1,3 @@
 line 1
+new line
 line 2
diff --git a/file2.ts b/file2.ts
index ghi..jkl 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,2 @@
-old line
+new line
 line 2`;

      const hunks = extractChangesFromDiff(diff);
      expect(hunks).toHaveLength(2);
      expect(hunks[0].file).toBe('file1.ts');
      expect(hunks[1].file).toBe('file2.ts');
    });

    it('should handle empty diff', () => {
      const hunks = extractChangesFromDiff('');
      expect(hunks).toHaveLength(0);
    });
  });

  describe('extractChangesFromContents', () => {
    it('should handle new file (no old content)', () => {
      const hunks = extractChangesFromContents(null, 'line 1\nline 2\nline 3', 'new-file.ts');
      expect(hunks).toHaveLength(1);
      expect(hunks[0].type).toBe('added');
      expect(hunks[0].file).toBe('new-file.ts');
      expect(hunks[0].endLine).toBe(3);
    });

    it('should handle deleted file (no new content)', () => {
      const hunks = extractChangesFromContents('line 1\nline 2', null, 'deleted.ts');
      expect(hunks).toHaveLength(1);
      expect(hunks[0].type).toBe('deleted');
      expect(hunks[0].file).toBe('deleted.ts');
    });

    it('should handle modified file', () => {
      const hunks = extractChangesFromContents('old content', 'new content', 'modified.ts');
      expect(hunks).toHaveLength(1);
      expect(hunks[0].type).toBe('modified');
    });

    it('should return empty for no content', () => {
      const hunks = extractChangesFromContents(null, null, 'empty.ts');
      expect(hunks).toHaveLength(0);
    });
  });

  describe('parseGitStatus', () => {
    it('should parse git status output', () => {
      const statusOutput = `M  modified.ts
A  added.ts
D  deleted.ts
?? untracked.ts`;

      const files = parseGitStatus(statusOutput);
      expect(files).toHaveLength(4);
      expect(files[0]).toEqual({ file: 'modified.ts', status: 'M' });
      expect(files[1]).toEqual({ file: 'added.ts', status: 'A' });
      expect(files[2]).toEqual({ file: 'deleted.ts', status: 'D' });
      expect(files[3]).toEqual({ file: 'untracked.ts', status: '??' });
    });

    it('should handle empty status', () => {
      const files = parseGitStatus('');
      expect(files).toHaveLength(0);
    });

    it('should handle staged and unstaged changes', () => {
      const statusOutput = `MM both-modified.ts
AM staged-then-modified.ts`;

      const files = parseGitStatus(statusOutput);
      expect(files).toHaveLength(2);
      expect(files[0]).toEqual({ file: 'both-modified.ts', status: 'MM' });
      expect(files[1]).toEqual({ file: 'staged-then-modified.ts', status: 'AM' });
    });
  });
});
