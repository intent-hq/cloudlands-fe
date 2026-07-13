/**
 * Utility functions for calculating diff statistics
 */

/**
 * Calculate line additions and deletions from a unified diff string
 */
export function calculateDiffStats(diff: string): { additions: number; deletions: number } {
  const lines = diff.split('\n');
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    // Skip diff headers
    if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }

    // Count additions (lines starting with +)
    if (line.startsWith('+')) {
      additions++;
    }
    // Count deletions (lines starting with -)
    else if (line.startsWith('-')) {
      deletions++;
    }
  }

  return { additions, deletions };
}

/**
 * Calculate line changes between two text contents
 */
export function calculateContentStats(
  oldContent: string,
  newContent: string,
): { additions: number; deletions: number } {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple calculation based on line counts
  // For more accurate results, use a proper diff library
  const additions = Math.max(0, newLines.length - oldLines.length);
  const deletions = Math.max(0, oldLines.length - newLines.length);

  return { additions, deletions };
}

/**
 * Parse git diff output and extract file stats
 */
export function parseGitDiffStats(
  gitOutput: string,
): Map<string, { additions: number; deletions: number }> {
  const fileStats = new Map<string, { additions: number; deletions: number }>();
  const lines = gitOutput.split('\n');

  let currentFile: string | null = null;
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    // New file header
    if (line.startsWith('diff --git')) {
      // Save previous file stats if any
      if (currentFile) {
        fileStats.set(currentFile, { additions, deletions });
      }

      // Extract filename from diff header
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      if (match) {
        currentFile = match[2];
        additions = 0;
        deletions = 0;
      }
    }
    // Count additions and deletions
    else if (currentFile) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }
  }

  // Save last file stats
  if (currentFile) {
    fileStats.set(currentFile, { additions, deletions });
  }

  return fileStats;
}

/**
 * Extract stats from a patch string
 */
export function extractPatchStats(patch: string): { additions: number; deletions: number } {
  if (!patch) {
    return { additions: 0, deletions: 0 };
  }

  const lines = patch.split('\n');
  let additions = 0;
  let deletions = 0;
  let inHunk = false;

  for (const line of lines) {
    // Start of a hunk
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;

    // Count additions (skip +++ header)
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++;
    }
    // Count deletions (skip --- header)
    else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
    }
  }

  return { additions, deletions };
}

/**
 * Merge multiple stats objects
 */
export function mergeStats(...stats: Array<{ additions: number; deletions: number }>): {
  additions: number;
  deletions: number;
} {
  return stats.reduce(
    (acc, stat) => ({
      additions: acc.additions + stat.additions,
      deletions: acc.deletions + stat.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

/**
 * Convert a unified diff patch string into old and new content strings.
 * This is useful when you have a stored patch and need to reconstruct
 * the original and modified file contents for a Monaco diff editor.
 *
 * Note: Only the lines covered by hunks are reconstructed. Lines outside
 * of hunk ranges are not included since the patch doesn't contain them.
 * This is fine for diff display since Monaco will show the same hunks.
 */
export function patchToContents(patch: string | null | undefined): {
  oldContent: string;
  newContent: string;
} {
  if (!patch) return { oldContent: '', newContent: '' };

  const oldLines: string[] = [];
  const newLines: string[] = [];
  const lines = patch.split('\n');
  // Remove trailing empty string that split() produces when the patch ends with '\n'.
  // Without this, the empty string is mistaken for an empty context line inside a hunk.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  let inHunk = false;

  for (const line of lines) {
    // Skip file headers
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('\\ No newline at end of file')
    ) {
      continue;
    }

    // Hunk header - start collecting lines
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith('+')) {
      // Addition: only in new content
      newLines.push(line.slice(1));
    } else if (line.startsWith('-')) {
      // Deletion: only in old content
      oldLines.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      // Context: in both
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    } else if (line === '') {
      // Empty line within a hunk is context (an empty line in the original file).
      // Some diff tools omit the leading space for empty context lines.
      oldLines.push('');
      newLines.push('');
    }
  }

  return {
    oldContent: oldLines.join('\n'),
    newContent: newLines.join('\n'),
  };
}
