/**
 * Calculate Content Diff Utility
 *
 * Pure function for calculating line additions/deletions between two content strings.
 * Extracted from the old LineChangesService.
 */

import { diffLines } from 'diff';

/**
 * Calculate line changes from content diff
 */
export function calculateContentDiff(
  oldContent: string,
  newContent: string,
): { additions: number; deletions: number } {
  const changes = diffLines(oldContent, newContent);
  let additions = 0;
  let deletions = 0;

  for (const change of changes) {
    if (change.added) {
      additions += change.count || 0;
    } else if (change.removed) {
      deletions += change.count || 0;
    }
  }

  return { additions, deletions };
}

