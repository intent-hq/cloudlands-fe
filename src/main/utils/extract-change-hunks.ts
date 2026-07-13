/**
 * Extract only the specific hunks that changed from a git diff
 * This is used to store minimal change information in timeline entries
 */

export interface ChangeHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  oldContent: string[];
  newContent: string[];
  contextBefore: string[];
  contextAfter: string[];
}

export interface ExtractedChanges {
  hunks: ChangeHunk[];
  additions: number;
  deletions: number;
  // Store minimal content for reconstruction
  oldContentHunks: string; // Just the old lines from changed regions with minimal context
  newContentHunks: string; // Just the new lines from changed regions with minimal context
}

/**
 * Parse a git diff and extract only the changed hunks with minimal context
 */
export function extractChangesFromDiff(
  diff: string,
  oldContent?: string,
  newContent?: string,
  contextLines: number = 3,
): ExtractedChanges {
  const lines = diff.split('\n');
  const hunks: ChangeHunk[] = [];
  let additions = 0;
  let deletions = 0;

  let currentHunk: ChangeHunk | null = null;
  let inHeader = true;

  for (const line of lines) {
    // Skip file headers
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      continue;
    }

    // Parse hunk header
    if (line.startsWith('@@')) {
      inHeader = false;
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: parseInt(match[1]),
          oldLines: parseInt(match[2] || '1'),
          newStart: parseInt(match[3]),
          newLines: parseInt(match[4] || '1'),
          oldContent: [],
          newContent: [],
          contextBefore: [],
          contextAfter: [],
        };
      }
    } else if (!inHeader && currentHunk) {
      // Process diff lines
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.newContent.push(line.substring(1));
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.oldContent.push(line.substring(1));
        deletions++;
      } else if (line.startsWith(' ')) {
        // Context line
        const contextLine = line.substring(1);

        // If we haven't seen any changes yet in this hunk, it's context before
        if (currentHunk.oldContent.length === 0 && currentHunk.newContent.length === 0) {
          currentHunk.contextBefore.push(contextLine);
          // Keep only the last N context lines before changes
          if (currentHunk.contextBefore.length > contextLines) {
            currentHunk.contextBefore.shift();
          }
        } else {
          // Context after changes
          currentHunk.contextAfter.push(contextLine);
          // Keep only the first N context lines after changes
          if (currentHunk.contextAfter.length > contextLines) {
            currentHunk.contextAfter.pop();
          }
        }
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  // Build minimal content strings for storage
  const oldContentHunks = buildMinimalContent(hunks, 'old');
  const newContentHunks = buildMinimalContent(hunks, 'new');

  return {
    hunks,
    additions,
    deletions,
    oldContentHunks,
    newContentHunks,
  };
}

/**
 * Build minimal content string from hunks for storage
 */
function buildMinimalContent(hunks: ChangeHunk[], version: 'old' | 'new'): string {
  const lines: string[] = [];

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i];

    // Add separator between hunks
    if (i > 0) {
      lines.push('...');
    }

    // Add line number indicator
    const lineNum = version === 'old' ? hunk.oldStart : hunk.newStart;
    lines.push(`@@ Line ${lineNum} @@`);

    // Add context before
    lines.push(...hunk.contextBefore);

    // Add the actual changed lines
    const content = version === 'old' ? hunk.oldContent : hunk.newContent;
    lines.push(...content);

    // Add context after
    lines.push(...hunk.contextAfter);
  }

  return lines.join('\n');
}

/**
 * Extract changes from comparing two file contents directly
 * Used when we don't have a git diff but have both versions
 */
export function extractChangesFromContents(
  oldContent: string,
  newContent: string,
  contextLines: number = 3,
): ExtractedChanges {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const hunks: ChangeHunk[] = [];

  // Find changed regions using a simple algorithm
  const changes = findChangedRegions(oldLines, newLines);

  let additions = 0;
  let deletions = 0;

  for (const change of changes) {
    const hunk: ChangeHunk = {
      oldStart: change.oldStart + 1, // Convert to 1-based
      oldLines: change.oldEnd - change.oldStart,
      newStart: change.newStart + 1,
      newLines: change.newEnd - change.newStart,
      oldContent: [],
      newContent: [],
      contextBefore: [],
      contextAfter: [],
    };

    // Add context before
    const contextStart = Math.max(0, change.oldStart - contextLines);
    for (let i = contextStart; i < change.oldStart; i++) {
      hunk.contextBefore.push(oldLines[i]);
    }

    // Add old content
    for (let i = change.oldStart; i < change.oldEnd; i++) {
      hunk.oldContent.push(oldLines[i]);
      deletions++;
    }

    // Add new content
    for (let i = change.newStart; i < change.newEnd; i++) {
      hunk.newContent.push(newLines[i]);
      additions++;
    }

    // Add context after
    const contextEndOld = Math.min(oldLines.length, change.oldEnd + contextLines);
    const contextEndNew = Math.min(newLines.length, change.newEnd + contextLines);
    const contextEnd = Math.min(contextEndOld, contextEndNew);

    for (let i = 0; i < contextLines && change.oldEnd + i < contextEnd; i++) {
      hunk.contextAfter.push(oldLines[change.oldEnd + i]);
    }

    hunks.push(hunk);
  }

  const oldContentHunks = buildMinimalContent(hunks, 'old');
  const newContentHunks = buildMinimalContent(hunks, 'new');

  return {
    hunks,
    additions,
    deletions,
    oldContentHunks,
    newContentHunks,
  };
}

/**
 * Simple algorithm to find changed regions between two arrays of lines
 */
function findChangedRegions(
  oldLines: string[],
  newLines: string[],
): Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }> {
  const regions: Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }> = [];

  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    // Skip matching lines
    while (
      oldIdx < oldLines.length &&
      newIdx < newLines.length &&
      oldLines[oldIdx] === newLines[newIdx]
    ) {
      oldIdx++;
      newIdx++;
    }

    if (oldIdx >= oldLines.length && newIdx >= newLines.length) {
      break;
    }

    // Found start of a change
    const changeOldStart = oldIdx;
    const changeNewStart = newIdx;

    // Find end of change by looking for next matching line
    let matchFound = false;
    const maxLookAhead = 20;

    for (let d = 1; d <= maxLookAhead && !matchFound; d++) {
      for (let oldOffset = 0; oldOffset <= d && !matchFound; oldOffset++) {
        const newOffset = d - oldOffset;

        if (
          oldIdx + oldOffset < oldLines.length &&
          newIdx + newOffset < newLines.length &&
          oldLines[oldIdx + oldOffset] === newLines[newIdx + newOffset]
        ) {
          // Found matching line
          regions.push({
            oldStart: changeOldStart,
            oldEnd: oldIdx + oldOffset,
            newStart: changeNewStart,
            newEnd: newIdx + newOffset,
          });

          oldIdx = oldIdx + oldOffset;
          newIdx = newIdx + newOffset;
          matchFound = true;
        }
      }
    }

    if (!matchFound) {
      // No match found, treat rest as changed
      regions.push({
        oldStart: changeOldStart,
        oldEnd: oldLines.length,
        newStart: changeNewStart,
        newEnd: newLines.length,
      });
      break;
    }
  }

  return regions;
}
