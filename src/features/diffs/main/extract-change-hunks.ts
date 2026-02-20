/**
 * Extract Change Hunks Utility
 * Parses git diffs and extracts change information
 */

export interface ChangeHunk {
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  type: 'added' | 'modified' | 'deleted';
}

export function extractChangesFromDiff(diff: string): ChangeHunk[] {
  const hunks: ChangeHunk[] = [];
  const lines = diff.split('\n');

  let currentFile: string | null = null;
  let currentHunk: Partial<ChangeHunk> | null = null;
  let hunkContent: string[] = [];
  let currentFileType: 'added' | 'modified' | 'deleted' = 'modified';

  for (const line of lines) {
    // File header
    if (line.startsWith('diff --git')) {
      // Save previous hunk if exists
      if (currentHunk && currentFile) {
        hunks.push({
          file: currentFile,
          startLine: currentHunk.startLine || 0,
          endLine: currentHunk.endLine || 0,
          content: hunkContent.join('\n'),
          type: currentHunk.type || currentFileType,
        });
      }

      // Extract file name
      const match = line.match(/b\/(.+)$/);
      currentFile = match ? match[1] : null;
      currentHunk = null;
      hunkContent = [];
      currentFileType = 'modified'; // Reset for new file
    }

    // New file
    else if (line.startsWith('new file mode')) {
      currentFileType = 'added';
    }

    // Deleted file
    else if (line.startsWith('deleted file mode')) {
      currentFileType = 'deleted';
    }

    // Hunk header
    else if (line.startsWith('@@')) {
      // Save previous hunk if exists
      if (currentHunk && currentFile) {
        hunks.push({
          file: currentFile,
          startLine: currentHunk.startLine || 0,
          endLine: currentHunk.endLine || 0,
          content: hunkContent.join('\n'),
          type: currentHunk.type || currentFileType,
        });
      }

      // Parse hunk header
      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (match) {
        currentHunk = {
          startLine: parseInt(match[3]),
          endLine: parseInt(match[3]) + (parseInt(match[4]) || 1) - 1,
          type: currentFileType,
        };
        hunkContent = [];
      }
    }

    // Hunk content
    else if (
      currentHunk &&
      (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))
    ) {
      hunkContent.push(line);
    }
  }

  // Save last hunk
  if (currentHunk && currentFile) {
    hunks.push({
      file: currentFile,
      startLine: currentHunk.startLine || 0,
      endLine: currentHunk.endLine || 0,
      content: hunkContent.join('\n'),
      type: currentHunk.type || currentFileType,
    });
  }

  return hunks;
}

export function extractChangesFromContents(
  oldContent: string | null,
  newContent: string | null,
  filePath: string,
): ChangeHunk[] {
  if (!oldContent && !newContent) {
    return [];
  }

  if (!oldContent && newContent) {
    // New file
    return [
      {
        file: filePath,
        startLine: 1,
        endLine: newContent.split('\n').length,
        content: newContent,
        type: 'added',
      },
    ];
  }

  if (oldContent && !newContent) {
    // Deleted file
    return [
      {
        file: filePath,
        startLine: 1,
        endLine: oldContent.split('\n').length,
        content: oldContent,
        type: 'deleted',
      },
    ];
  }

  // Modified file - simple implementation
  // In a real implementation, you'd use a diff algorithm
  return [
    {
      file: filePath,
      startLine: 1,
      endLine: newContent!.split('\n').length,
      content: newContent!,
      type: 'modified',
    },
  ];
}

export function parseGitStatus(statusOutput: string): Array<{ file: string; status: string }> {
  const files: Array<{ file: string; status: string }> = [];
  const lines = statusOutput.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    const match = line.match(/^(.{2})\s+(.+)$/);
    if (match) {
      const [, status, file] = match;
      files.push({ file, status: status.trim() });
    }
  }

  return files;
}
