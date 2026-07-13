/**
 * Patch Parsing Utilities
 *
 * Utilities for parsing unified diff/patch strings into structured data.
 * Adapted from the browser prototype's patch-utils.ts.
 */

export type LineType = 'context' | 'addition' | 'deletion' | 'hunkHeader';

export interface DiffLine {
  type: LineType;
  content: string;
  oldNum: number | null;
  newNum: number | null;
  raw: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number | null;
  newStart: number;
  newLines: number | null;
  lines: DiffLine[];
}

const headerIgnore = [
  /^diff --git /,
  /^index\s/,
  /^---\s/,
  /^\+\+\+\s/,
  /^\\ No newline at end of file/,
];

/**
 * Parse a unified diff/patch string into hunks and typed lines with old/new line numbers.
 */
export function parsePatch(patch: string | undefined | null): Hunk[] {
  const hunks: Hunk[] = [];
  if (!patch) return hunks;
  const lines = patch.split('\n');
  let cur: Hunk | null = null;
  let oldPtr = 0;
  let newPtr = 0;

  const startHunk = (headerLine: string) => {
    const m = headerLine.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    const oldStart = m ? parseInt(m[1], 10) : 0;
    const oldLines = m && m[2] ? parseInt(m[2], 10) : null;
    const newStart = m ? parseInt(m[3], 10) : 0;
    const newLines = m && m[4] ? parseInt(m[4], 10) : null;
    cur = { header: headerLine, oldStart, oldLines, newStart, newLines, lines: [] };
    hunks.push(cur);
    oldPtr = oldStart;
    newPtr = newStart;
  };

  for (const raw of lines) {
    if (raw.startsWith('@@')) {
      startHunk(raw);
      continue;
    }
    // cur is set by startHunk - if null, we haven't seen a hunk header yet
    if (!cur) {
      // Skip global headers (before first hunk)
      continue;
    }

    // TypeScript needs explicit cast since cur is mutated by nested function
    const currentHunk: Hunk = cur;

    if (raw.startsWith('+')) {
      currentHunk.lines.push({
        type: 'addition',
        content: raw.slice(1),
        oldNum: null,
        newNum: newPtr++,
        raw,
      });
    } else if (raw.startsWith('-')) {
      currentHunk.lines.push({
        type: 'deletion',
        content: raw.slice(1),
        oldNum: oldPtr++,
        newNum: null,
        raw,
      });
    } else if (raw.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: raw.slice(1),
        oldNum: oldPtr++,
        newNum: newPtr++,
        raw,
      });
    } else if (headerIgnore.some((re) => re.test(raw))) {
      // ignore header lines within hunk
    } else if (raw.trim() === '') {
      // blank context within hunk
      currentHunk.lines.push({
        type: 'context',
        content: '',
        oldNum: oldPtr++,
        newNum: newPtr++,
        raw,
      });
    }
  }

  return hunks;
}

/**
 * Extract file path from a diff --git line
 */
export function extractFilePath(diffHeader: string): string | null {
  // Match "diff --git a/path/to/file b/path/to/file"
  const match = diffHeader.match(/diff --git a\/(.+) b\/(.+)/);
  if (match) {
    return match[2]; // Return the "b" path (new file path)
  }
  return null;
}

/**
 * Split a combined diff into individual file diffs
 */
export function splitDiffByFile(combinedDiff: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = combinedDiff.split('\n');
  let currentFile: string | null = null;
  let currentDiff: string[] = [];

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      // Save previous file's diff
      if (currentFile && currentDiff.length > 0) {
        result.set(currentFile, currentDiff.join('\n'));
      }
      // Start new file
      currentFile = extractFilePath(line);
      currentDiff = [line];
    } else if (currentFile) {
      currentDiff.push(line);
    }
  }

  // Save last file's diff
  if (currentFile && currentDiff.length > 0) {
    result.set(currentFile, currentDiff.join('\n'));
  }

  return result;
}
