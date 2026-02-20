/**
 * Tests for GitService unstageHunk content-based fallback
 * Tests the patch parsing and content manipulation logic used in unstageHunkContentBased
 */

import { describe, it, expect } from 'vitest';

/**
 * Helper function to parse a hunk patch (same logic as used in unstageHunkContentBased)
 * Extracted here for testing the parsing logic independently
 */
function parsePatch(hunkPatch: string) {
  const patchLines = hunkPatch.split('\n');
  const hunkHeaderMatch = patchLines.find((l) => l.startsWith('@@'));
  if (!hunkHeaderMatch) {
    return { error: 'Could not parse hunk header from patch' };
  }

  const match = hunkHeaderMatch.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) {
    return { error: 'Invalid hunk header format' };
  }

  const oldStart = parseInt(match[1], 10);
  const oldCount = parseInt(match[2] || '1', 10);
  const newStart = parseInt(match[3], 10);
  const newCount = parseInt(match[4] || '1', 10);

  const addedLines: string[] = [];
  const removedLines: string[] = [];
  let inHunk = false;

  for (const line of patchLines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines.push(line.slice(1));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removedLines.push(line.slice(1));
    }
  }

  return {
    oldStart,
    oldCount,
    newStart,
    newCount,
    addedLines,
    removedLines,
  };
}

/**
 * Helper function to reverse a patch on content (same logic as unstageHunkContentBased)
 * To REVERSE the patch (unstage):
 * - Lines that were added in the patch should be removed
 * - Lines that were removed in the patch should be added back
 */
function applyReversePatch(
  stagedContent: string,
  addedLines: string[],
  removedLines: string[],
  oldStart: number,
  newStart: number,
): string {
  const stagedLines = stagedContent.split('\n');
  const newStagedLines = [...stagedLines];

  const insertPosition = newStart - 1; // 0-indexed

  // Remove the added lines from the staged content
  if (addedLines.length > 0) {
    newStagedLines.splice(insertPosition, addedLines.length);
  }

  // Insert back the removed lines at the old position
  if (removedLines.length > 0) {
    const insertAt = oldStart - 1; // 0-indexed
    newStagedLines.splice(insertAt, 0, ...removedLines);
  }

  return newStagedLines.join('\n');
}

describe('GitService unstageHunk content-based fallback', () => {
  describe('patch parsing', () => {
    it('should parse a simple addition patch', () => {
      const patch = `diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,4 @@
 line1
 line2
+newline
 line3`;

      const result = parsePatch(patch);
      expect(result.error).toBeUndefined();
      expect(result.oldStart).toBe(1);
      expect(result.oldCount).toBe(3);
      expect(result.newStart).toBe(1);
      expect(result.newCount).toBe(4);
      expect(result.addedLines).toEqual(['newline']);
      expect(result.removedLines).toEqual([]);
    });

    it('should parse a simple deletion patch', () => {
      const patch = `diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
@@ -1,4 +1,3 @@
 line1
-deletedline
 line2
 line3`;

      const result = parsePatch(patch);
      expect(result.error).toBeUndefined();
      expect(result.oldStart).toBe(1);
      expect(result.oldCount).toBe(4);
      expect(result.newStart).toBe(1);
      expect(result.newCount).toBe(3);
      expect(result.addedLines).toEqual([]);
      expect(result.removedLines).toEqual(['deletedline']);
    });

    it('should parse a modification patch with both additions and deletions', () => {
      const patch = `diff --git a/.prettierrc b/.prettierrc
--- a/.prettierrc
+++ b/.prettierrc
@@ -7,4 +7,5 @@
 	"plugins": ["prettier-plugin-svelte"],
-	"tabWidth": 2
+	"tabWidth": 4,
+	"useTabs": true
 }`;

      const result = parsePatch(patch);
      expect(result.error).toBeUndefined();
      expect(result.oldStart).toBe(7);
      expect(result.oldCount).toBe(4);
      expect(result.newStart).toBe(7);
      expect(result.newCount).toBe(5);
      expect(result.addedLines).toEqual(['\t"tabWidth": 4,', '\t"useTabs": true']);
      expect(result.removedLines).toEqual(['\t"tabWidth": 2']);
    });

    it('should parse a new file patch (oldStart = 0)', () => {
      const patch = `diff --git a/newfile.txt b/newfile.txt
new file mode 100644
--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,3 @@
+line1
+line2
+line3`;

      const result = parsePatch(patch);
      expect(result.error).toBeUndefined();
      expect(result.oldStart).toBe(0);
      expect(result.oldCount).toBe(0);
      expect(result.newStart).toBe(1);
      expect(result.newCount).toBe(3);
      expect(result.addedLines).toEqual(['line1', 'line2', 'line3']);
      expect(result.removedLines).toEqual([]);
    });

    it('should return error for invalid patch without hunk header', () => {
      const patch = `diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
no hunk header here`;

      const result = parsePatch(patch);
      expect(result.error).toBe('Could not parse hunk header from patch');
    });

    it('should handle hunk header without line count (single line)', () => {
      const patch = `diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-old
+new`;

      const result = parsePatch(patch);
      expect(result.error).toBeUndefined();
      expect(result.oldStart).toBe(1);
      expect(result.oldCount).toBe(1);
      expect(result.newStart).toBe(1);
      expect(result.newCount).toBe(1);
      expect(result.addedLines).toEqual(['new']);
      expect(result.removedLines).toEqual(['old']);
    });
  });

  describe('content-based unstaging line manipulation', () => {
    it('should remove added lines when reversing an addition', () => {
      // Staged content has: line1, line2, newline, line3
      // The patch added "newline" at position 3
      // After reversing, we should have: line1, line2, line3
      const stagedContent = 'line1\nline2\nnewline\nline3';
      const addedLines = ['newline'];
      const removedLines: string[] = [];
      const oldStart = 1;
      const newStart = 3; // The added line is at position 3

      const result = applyReversePatch(stagedContent, addedLines, removedLines, oldStart, newStart);
      expect(result).toBe('line1\nline2\nline3');
    });

    it('should restore removed lines when reversing a deletion', () => {
      // Staged content has: line1, line3
      // The patch removed "line2" from position 2
      // After reversing, we should have: line1, line2, line3
      const stagedContent = 'line1\nline3';
      const addedLines: string[] = [];
      const removedLines = ['line2'];
      const oldStart = 2; // The line was at position 2 originally
      const newStart = 2;

      const result = applyReversePatch(stagedContent, addedLines, removedLines, oldStart, newStart);
      expect(result).toBe('line1\nline2\nline3');
    });

    it('should handle both additions and deletions (modification)', () => {
      // Original: line1, oldvalue, line3
      // Staged: line1, newvalue, extra, line3
      // Patch: removed "oldvalue", added "newvalue" and "extra"
      // After reversing: should restore to original
      const stagedContent = 'line1\nnewvalue\nextra\nline3';
      const addedLines = ['newvalue', 'extra'];
      const removedLines = ['oldvalue'];
      const oldStart = 2;
      const newStart = 2;

      const result = applyReversePatch(stagedContent, addedLines, removedLines, oldStart, newStart);
      expect(result).toBe('line1\noldvalue\nline3');
    });
  });

  describe('content-based staging line manipulation', () => {
    /**
     * Helper function to apply a patch forward on content (same logic as stageHunkContentBased)
     * To APPLY the patch (stage):
     * - Lines that were removed in the patch should be removed from index
     * - Lines that were added in the patch should be added to index
     */
    function applyForwardPatch(
      indexContent: string,
      addedLines: string[],
      removedLines: string[],
      oldStart: number,
    ): string {
      const indexLines = indexContent.split('\n');
      const newIndexLines = [...indexLines];

      const insertPosition = oldStart - 1; // 0-indexed

      // Remove the lines that the patch says to remove
      if (removedLines.length > 0) {
        newIndexLines.splice(insertPosition, removedLines.length);
      }

      // Insert the added lines at the same position
      if (addedLines.length > 0) {
        newIndexLines.splice(insertPosition, 0, ...addedLines);
      }

      return newIndexLines.join('\n');
    }

    it('should add lines when staging an addition', () => {
      // Index content has: line1, line2, line3
      // The patch adds "newline" after line2
      // After staging, we should have: line1, line2, newline, line3
      const indexContent = 'line1\nline2\nline3';
      const addedLines = ['newline'];
      const removedLines: string[] = [];
      const oldStart = 3; // Insert at position 3 (before line3)

      const result = applyForwardPatch(indexContent, addedLines, removedLines, oldStart);
      expect(result).toBe('line1\nline2\nnewline\nline3');
    });

    it('should remove lines when staging a deletion', () => {
      // Index content has: line1, line2, line3
      // The patch removes "line2"
      // After staging, we should have: line1, line3
      const indexContent = 'line1\nline2\nline3';
      const addedLines: string[] = [];
      const removedLines = ['line2'];
      const oldStart = 2; // Line2 is at position 2

      const result = applyForwardPatch(indexContent, addedLines, removedLines, oldStart);
      expect(result).toBe('line1\nline3');
    });

    it('should handle both additions and deletions (modification)', () => {
      // Index content: line1, oldvalue, line3
      // Patch: removes "oldvalue", adds "newvalue" and "extra"
      // After staging: line1, newvalue, extra, line3
      const indexContent = 'line1\noldvalue\nline3';
      const addedLines = ['newvalue', 'extra'];
      const removedLines = ['oldvalue'];
      const oldStart = 2;

      const result = applyForwardPatch(indexContent, addedLines, removedLines, oldStart);
      expect(result).toBe('line1\nnewvalue\nextra\nline3');
    });
  });

  describe('error detection for worktree issues', () => {
    it('should identify "repository lacks the necessary blob" error', () => {
      const errorStr =
        'error: repository lacks the necessary blob to perform 3-way merge.\nfatal: patch failed';
      const isWorktreeBlobIssue =
        errorStr.includes('repository lacks the necessary blob') ||
        errorStr.includes('patch does not apply');
      expect(isWorktreeBlobIssue).toBe(true);
    });

    it('should identify "patch does not apply" error', () => {
      const errorStr = 'error: patch does not apply\nerror: test.txt: patch does not apply';
      const isWorktreeBlobIssue =
        errorStr.includes('repository lacks the necessary blob') ||
        errorStr.includes('patch does not apply');
      expect(isWorktreeBlobIssue).toBe(true);
    });

    it('should not trigger fallback for other errors', () => {
      const errorStr = 'error: not a git repository';
      const isWorktreeBlobIssue =
        errorStr.includes('repository lacks the necessary blob') ||
        errorStr.includes('patch does not apply');
      expect(isWorktreeBlobIssue).toBe(false);
    });
  });
});
