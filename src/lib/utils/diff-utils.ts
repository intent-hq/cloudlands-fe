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
