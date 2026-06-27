/**
 * Utility functions for ChangeSet Visualization
 */

import type { TrackedChange } from '$features/file-tracking/types';
import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';
import type { FileColumn, VisualizationLine, LineType } from './types';

/**
 * Maximum combined content size for LCS diff computation (in characters).
 * Files larger than this will fall back to simple diff rendering to prevent OOM.
 * The LCS algorithm uses O(m*n) space which can quickly exhaust memory for large files.
 */
const MAX_LCS_CONTENT_SIZE = 100_000; // ~100KB combined

/**
 * Maximum number of lines for LCS diff computation.
 * Even with smaller content, many lines can cause O(m*n) memory issues.
 */
const MAX_LCS_LINE_COUNT = 5_000;

/**
 * Extract file name from path
 */
export function getFileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/**
 * Detect language from file extension for syntax highlighting
 */
export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    svelte: 'html',
    vue: 'html',
    html: 'html',
    css: 'css',
    scss: 'scss',
    json: 'json',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    rb: 'ruby',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
  };
  return languageMap[ext] || 'plaintext';
}

/**
 * Parse diff content to extract lines with their types
 */
export function parseDiffLines(change: TrackedChange): VisualizationLine[] {
  const lines: VisualizationLine[] = [];
  const hasNewContent = !isEmptyContent(change.content?.newContent);

  // If we have hunks AND full file content, show the full file with changes highlighted
  // This gives a better visualization than just showing the diff hunks
  if (change.hunks && change.hunks.length > 0 && hasNewContent) {
    // Convert hunks to the format expected by computeFullFileVisualization
    const chunks = change.hunks.map((hunk) => ({
      oldStart: hunk.oldStart || 1,
      oldLines: hunk.oldLines || 0,
      newStart: hunk.newStart || 1,
      newLines: hunk.newLines || 0,
      lines: (hunk.lines || []).map((line) => {
        // Convert lowercase types to capitalized for computeFullFileVisualization
        let type: 'Addition' | 'Deletion' | 'Context' = 'Context';
        const lineType = line.type as string;
        if (lineType === 'Addition' || lineType === 'add') {
          type = 'Addition';
        } else if (lineType === 'Deletion' || lineType === 'remove') {
          type = 'Deletion';
        }
        return {
          type,
          content: line.content,
          oldLineNumber: line.oldLineNumber,
          newLineNumber: line.newLineNumber,
        };
      }),
    }));

    return computeFullFileVisualization(
      change.content?.newContent ?? '',
      change.content?.oldContent || '',
      chunks,
    );
  }

  // If we have hunks but no full content, use hunks directly
  if (change.hunks && change.hunks.length > 0) {
    for (const hunk of change.hunks) {
      for (const line of hunk.lines) {
        // Convert capitalized types from git:diff ('Addition', 'Deletion', 'Context')
        // to lowercase types used internally ('add', 'remove', 'context')
        let type: LineType = 'context';
        const lineType = line.type as string;
        if (lineType === 'Addition' || lineType === 'add') {
          type = 'add';
        } else if (lineType === 'Deletion' || lineType === 'remove') {
          type = 'remove';
        } else if (lineType === 'Context' || lineType === 'context') {
          type = 'context';
        }

        lines.push({
          lineNumber: lines.length,
          type,
          content: line.content,
          oldLineNumber: line.oldLineNumber,
          newLineNumber: line.newLineNumber,
        });
      }
    }
    return lines;
  }

  // If we have raw diff content, parse it
  if (change.content?.diff) {
    const diffLines = change.content.diff.split('\n');
    let lineNumber = 0;

    for (const line of diffLines) {
      // Skip diff headers
      if (
        line.startsWith('@@') ||
        line.startsWith('diff ') ||
        line.startsWith('index ') ||
        line.startsWith('---') ||
        line.startsWith('+++')
      ) {
        continue;
      }

      let type: LineType = 'context';
      let content = line;

      if (line.startsWith('+')) {
        type = 'add';
        content = line.slice(1);
      } else if (line.startsWith('-')) {
        type = 'remove';
        content = line.slice(1);
      } else if (line.startsWith(' ')) {
        content = line.slice(1);
      }

      lines.push({
        lineNumber: lineNumber++,
        type,
        content,
      });
    }
    return lines;
  }

  // Fallback: compare old and new content if available using LCS diff
  if (change.content?.oldContent !== undefined || change.content?.newContent !== undefined) {
    const oldLines = (change.content?.oldContent || '').split('\n');
    const newLines = (change.content?.newContent || '').split('\n');
    return computeDiffLines(oldLines, newLines);
  }

  // No content available - create synthetic lines from stats
  if (change.stats) {
    for (let i = 0; i < (change.stats.deletions || 0); i++) {
      lines.push({
        lineNumber: lines.length,
        type: 'remove',
        content: '',
        oldLineNumber: i + 1,
      });
    }
    for (let i = 0; i < (change.stats.additions || 0); i++) {
      lines.push({
        lineNumber: lines.length,
        type: 'add',
        content: '',
        newLineNumber: i + 1,
      });
    }
  }

  // Ensure at least one line for visibility
  if (lines.length === 0) {
    lines.push({
      lineNumber: 0,
      type: 'add',
      content: '',
      newLineNumber: 1,
    });
  }

  return lines;
}

/**
 * Convert TrackedChange to FileColumn for visualization
 */
export function changeToFileColumn(change: TrackedChange): FileColumn {
  const filePath = change.relativePath || change.file || '';
  const lines = parseDiffLines(change);

  return {
    id: change.id,
    filePath,
    fileName: getFileName(filePath),
    lines,
    totalLines: lines.length,
    additions: change.stats?.additions || lines.filter((l) => l.type === 'add').length,
    deletions: change.stats?.deletions || lines.filter((l) => l.type === 'remove').length,
    change,
  };
}

export interface ContextLinesResult {
  lines: VisualizationLine[];
  startIndex: number;
}

/**
 * Get context lines around a specific line, keeping the hovered line centered.
 * When near boundaries, adjusts to show more lines on the other side.
 * Returns both the lines and the start index so the caller knows which line is hovered.
 */
export function getContextLines(
  lines: VisualizationLine[],
  lineIndex: number,
  contextCount: number,
): ContextLinesResult {
  // Calculate ideal start (centered)
  let start = lineIndex - contextCount;
  let end = lineIndex + contextCount + 1;

  // If near the start of the file, shift window forward
  if (start < 0) {
    const shift = -start;
    start = 0;
    end = Math.min(lines.length, end + shift);
  }

  // If near the end of the file, shift window backward
  if (end > lines.length) {
    const shift = end - lines.length;
    end = lines.length;
    start = Math.max(0, start - shift);
  }

  return {
    lines: lines.slice(start, end),
    startIndex: start,
  };
}
/**
 * Simple fallback diff when content is too large for LCS.
 * Shows all old lines as deletions followed by all new lines as additions.
 * This is less accurate but prevents OOM crashes.
 */
function computeSimpleDiffLines(oldLines: string[], newLines: string[]): VisualizationLine[] {
  const result: VisualizationLine[] = [];

  // Show all old lines as deletions
  for (let i = 0; i < oldLines.length; i++) {
    result.push({
      lineNumber: result.length,
      type: 'remove',
      content: oldLines[i],
      oldLineNumber: i + 1,
    });
  }

  // Show all new lines as additions
  for (let i = 0; i < newLines.length; i++) {
    result.push({
      lineNumber: result.length,
      type: 'add',
      content: newLines[i],
      newLineNumber: i + 1,
    });
  }

  return result;
}

/**
 * Simple LCS-based diff to properly match changes like a real diff view
 * Returns visualization lines in proper unified diff order.
 *
 * For very large files, falls back to simple diff to prevent OOM crashes.
 * The LCS algorithm uses O(m*n) space which can exhaust memory quickly.
 */
function computeDiffLines(oldLines: string[], newLines: string[]): VisualizationLine[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Check if content is too large for LCS computation
  // LCS uses O(m*n) space which can cause OOM for large files
  const totalLines = m + n;
  const totalChars = oldLines.join('\n').length + newLines.join('\n').length;

  if (totalLines > MAX_LCS_LINE_COUNT || totalChars > MAX_LCS_CONTENT_SIZE) {
    // Fall back to simple diff for large files
    return computeSimpleDiffLines(oldLines, newLines);
  }

  const result: VisualizationLine[] = [];

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  let i = m;
  let j = n;
  const diffOps: Array<{ type: 'context' | 'remove' | 'add'; oldIdx?: number; newIdx?: number }> =
    [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffOps.unshift({ type: 'context', oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffOps.unshift({ type: 'add', newIdx: j - 1 });
      j--;
    } else {
      diffOps.unshift({ type: 'remove', oldIdx: i - 1 });
      i--;
    }
  }

  // Convert to visualization lines
  for (const op of diffOps) {
    if (op.type === 'context' && op.oldIdx !== undefined && op.newIdx !== undefined) {
      result.push({
        lineNumber: result.length,
        type: 'context',
        content: newLines[op.newIdx],
        oldLineNumber: op.oldIdx + 1,
        newLineNumber: op.newIdx + 1,
      });
    } else if (op.type === 'remove' && op.oldIdx !== undefined) {
      result.push({
        lineNumber: result.length,
        type: 'remove',
        content: oldLines[op.oldIdx],
        oldLineNumber: op.oldIdx + 1,
      });
    } else if (op.type === 'add' && op.newIdx !== undefined) {
      result.push({
        lineNumber: result.length,
        type: 'add',
        content: newLines[op.newIdx],
        newLineNumber: op.newIdx + 1,
      });
    }
  }

  return result;
}

/**
 * Check if content is empty or whitespace-only
 */
function isEmptyContent(content: string | undefined): boolean {
  return !content || content.trim() === '';
}

/**
 * Create synthetic visualization lines when actual content is unavailable
 */
function createSyntheticLines(count: number, type: LineType): VisualizationLine[] {
  // Ensure at least 1 line for visibility
  const lineCount = Math.max(1, count);
  return Array.from({ length: lineCount }, (_, i) => ({
    lineNumber: i,
    type,
    content: '',
    ...(type === 'remove' ? { oldLineNumber: i + 1 } : { newLineNumber: i + 1 }),
  }));
}

/**
 * Split content by separator pattern (handles various separator formats)
 * Matches: // ─────────────────────────────────────
 * With optional whitespace/newlines around it
 */
function splitBySnippetSeparator(content: string): string[] {
  // Match separator line with optional surrounding whitespace
  const separatorPattern = /\n*\s*\/\/\s*─{10,}\s*\n*/g;
  return content.split(separatorPattern);
}

/**
 * Extended ChatFileChange with optional chunks from git:diff and full file content
 */
interface ChatFileChangeWithChunks extends ChatFileChange {
  chunks?: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: Array<{
      type: 'Addition' | 'Deletion' | 'Context';
      content: string;
      oldLineNumber?: number;
      newLineNumber?: number;
    }>;
  }>;
  /** Full file content from disk (for agent changes) */
  fullFileContent?: string;
}

/**
 * Parse diff lines from git diff chunks (with proper context lines)
 * Computes line numbers from hunk headers since they're not on individual lines
 */
function parseChunksToVisualizationLines(
  chunks: ChatFileChangeWithChunks['chunks'],
): VisualizationLine[] {
  if (!chunks || chunks.length === 0) return [];

  const result: VisualizationLine[] = [];

  for (const chunk of chunks) {
    // Track current line numbers based on hunk header
    let oldLineNum = chunk.oldStart;
    let newLineNum = chunk.newStart;

    for (const line of chunk.lines) {
      let type: LineType;
      let oldLineNumber: number | undefined;
      let newLineNumber: number | undefined;

      switch (line.type) {
        case 'Addition':
          type = 'add';
          newLineNumber = newLineNum;
          newLineNum++;
          break;
        case 'Deletion':
          type = 'remove';
          oldLineNumber = oldLineNum;
          oldLineNum++;
          break;
        case 'Context':
        default:
          type = 'context';
          oldLineNumber = oldLineNum;
          newLineNumber = newLineNum;
          oldLineNum++;
          newLineNum++;
          break;
      }

      result.push({
        lineNumber: result.length,
        type,
        content: line.content,
        oldLineNumber,
        newLineNumber,
      });
    }
  }

  return result;
}

/**
 * Compute full file visualization with changes highlighted using chunks
 * Shows the entire new file content, marking lines as additions/context based on chunks
 */
function computeFullFileVisualization(
  newContent: string,
  oldContent: string,
  chunks: ChatFileChangeWithChunks['chunks'],
): VisualizationLine[] {
  const result: VisualizationLine[] = [];
  const newLines = newContent.split('\n');

  // Build a map of which new line numbers are additions from chunks
  const additionLineNumbers = new Set<number>();
  const deletionsByNewLineNumber = new Map<number, string[]>(); // deletions to show before this new line

  if (chunks && chunks.length > 0) {
    for (const chunk of chunks) {
      let newLineNum = chunk.newStart;
      let pendingDeletions: string[] = [];

      for (const line of chunk.lines) {
        if (line.type === 'Deletion') {
          pendingDeletions.push(line.content);
        } else if (line.type === 'Addition') {
          additionLineNumbers.add(newLineNum);
          // Attach any pending deletions to show before this addition
          if (pendingDeletions.length > 0) {
            const existing = deletionsByNewLineNumber.get(newLineNum) || [];
            deletionsByNewLineNumber.set(newLineNum, [...existing, ...pendingDeletions]);
            pendingDeletions = [];
          }
          newLineNum++;
        } else {
          // Context line
          // If we have pending deletions, attach them before this context line
          if (pendingDeletions.length > 0) {
            const existing = deletionsByNewLineNumber.get(newLineNum) || [];
            deletionsByNewLineNumber.set(newLineNum, [...existing, ...pendingDeletions]);
            pendingDeletions = [];
          }
          newLineNum++;
        }
      }

      // Any remaining deletions at end of chunk (deleted lines at end of file)
      if (pendingDeletions.length > 0) {
        const lineNum = newLineNum; // After the last line
        const existing = deletionsByNewLineNumber.get(lineNum) || [];
        deletionsByNewLineNumber.set(lineNum, [...existing, ...pendingDeletions]);
      }
    }
  }

  // Build the full visualization
  for (let i = 0; i < newLines.length; i++) {
    const lineNum = i + 1; // 1-based line number

    // Add any deletions that come before this line
    const deletions = deletionsByNewLineNumber.get(lineNum);
    if (deletions) {
      for (const content of deletions) {
        result.push({
          lineNumber: result.length,
          type: 'remove',
          content,
          oldLineNumber: undefined, // We don't track old line numbers precisely here
        });
      }
    }

    // Add the actual line
    result.push({
      lineNumber: result.length,
      type: additionLineNumbers.has(lineNum) ? 'add' : 'context',
      content: newLines[i],
      newLineNumber: lineNum,
    });
  }

  // Handle deletions at the very end (after all new content)
  const endDeletions = deletionsByNewLineNumber.get(newLines.length + 1);
  if (endDeletions) {
    for (const content of endDeletions) {
      result.push({
        lineNumber: result.length,
        type: 'remove',
        content,
        oldLineNumber: undefined,
      });
    }
  }

  return result;
}

/**
 * Compute visualization for agent changes with full file content
 * Shows the full file with deleted snippets and added sections highlighted
 */
function computeAgentChangeVisualization(
  fullFileContent: string,
  oldSnippetsContent: string,
  newSnippetsContent: string,
): VisualizationLine[] {
  const result: VisualizationLine[] = [];
  const fullLines = fullFileContent.split('\n');

  // Split snippets by separator (used when multiple replacements in one tool call)
  const separatorPattern = /\n*\s*\/\/\s*─{10,}\s*\n*/g;

  // Get new snippets to find which lines in full file are additions
  const newSnippets = newSnippetsContent.split(separatorPattern).filter((s) => s.trim());

  // Build a set of line indices that are part of added content
  const additionLineIndices = new Set<number>();

  for (const snippet of newSnippets) {
    const snippetLines = snippet.split('\n');
    if (snippetLines.length === 0) continue;

    // Find where this snippet appears in the full file
    // Use a simple approach: find first line, then verify consecutive lines match
    for (let startIdx = 0; startIdx <= fullLines.length - snippetLines.length; startIdx++) {
      let matches = true;
      for (let i = 0; i < snippetLines.length; i++) {
        if (fullLines[startIdx + i] !== snippetLines[i]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        // Mark these lines as additions
        for (let i = 0; i < snippetLines.length; i++) {
          additionLineIndices.add(startIdx + i);
        }
        break; // Found the match, move to next snippet
      }
    }
  }

  // First, show the deleted content (old snippets)
  const oldSnippets = oldSnippetsContent.split(separatorPattern).filter((s) => s.trim());
  for (const snippet of oldSnippets) {
    const oldLines = snippet.split('\n');
    for (let i = 0; i < oldLines.length; i++) {
      result.push({
        lineNumber: result.length,
        type: 'remove',
        content: oldLines[i],
        oldLineNumber: i + 1,
      });
    }
  }

  // Then show the full file with additions highlighted
  for (let i = 0; i < fullLines.length; i++) {
    const isAddition = additionLineIndices.has(i);
    result.push({
      lineNumber: result.length,
      type: isAddition ? 'add' : 'context',
      content: fullLines[i],
      newLineNumber: i + 1,
    });
  }

  return result;
}

/**
 * Parse diff lines from ChatFileChange (old/new content comparison)
 */
export function parseChatFileChangeLines(
  change: ChatFileChange | ChatFileChangeWithChunks,
): VisualizationLine[] {
  const changeWithChunks = change as ChatFileChangeWithChunks;
  const hasOldContent = !isEmptyContent(change.oldContent);
  const hasNewContent = !isEmptyContent(change.newContent);
  const hasChunks = changeWithChunks.chunks && changeWithChunks.chunks.length > 0;

  // For deleted files, show all old content as deletions
  if (change.action === 'delete') {
    if (!hasOldContent) {
      return createSyntheticLines(change.deletions || 1, 'remove');
    }
    const oldLines = (change.oldContent ?? '').split('\n');
    return oldLines.map((content, i) => ({
      lineNumber: i,
      type: 'remove' as LineType,
      content,
      oldLineNumber: i + 1,
    }));
  }

  // For created files, show all new content as additions
  if (change.action === 'create') {
    if (!hasNewContent) {
      return createSyntheticLines(change.additions || 1, 'add');
    }
    const newLines = (change.newContent ?? '').split('\n');
    return newLines.map((content, i) => ({
      lineNumber: i,
      type: 'add' as LineType,
      content,
      newLineNumber: i + 1,
    }));
  }

  // For modified files with full content and chunks, show the entire file with changes highlighted
  if (hasNewContent && hasChunks) {
    return computeFullFileVisualization(
      change.newContent ?? '',
      change.oldContent || '',
      changeWithChunks.chunks,
    );
  }

  // For agent changes with snippet-based content and full file content
  // Show the full file with changed sections highlighted
  const hasFullFile = !isEmptyContent(changeWithChunks.fullFileContent);

  if (hasFullFile && (hasOldContent || hasNewContent) && !hasChunks) {
    return computeAgentChangeVisualization(
      changeWithChunks.fullFileContent ?? '',
      change.oldContent || '',
      change.newContent || '',
    );
  }

  // For committed changes or full file comparisons where we have both old and new content
  // Use LCS-based diff to properly show actual changes, not just all-red then all-green
  if (hasOldContent && hasNewContent && !hasChunks) {
    // Check if this looks like full file content (no snippet separators)
    const separatorPattern = /\n*\s*\/\/\s*─{10,}\s*\n*/g;
    const oldContent = change.oldContent ?? '';
    const newContent = change.newContent ?? '';
    const hasOldSeparators = separatorPattern.test(oldContent);
    const hasNewSeparators = separatorPattern.test(newContent);

    // If neither has separators, treat as full file content and compute proper diff
    if (!hasOldSeparators && !hasNewSeparators) {
      const oldLines = oldContent.split('\n');
      const newLines = newContent.split('\n');
      return computeDiffLines(oldLines, newLines);
    }

    // Has snippet separators - fall through to snippet-based handling
  }

  // For agent changes with snippet-based content but no full file (fallback)
  // Just show the snippets as deletions and additions
  if ((hasOldContent || hasNewContent) && !hasChunks) {
    const result: VisualizationLine[] = [];

    // Split by snippet separator (used when multiple replacements in one tool call)
    const separatorPattern = /\n*\s*\/\/\s*─{10,}\s*\n*/g;

    // Show deleted content (what was replaced)
    if (hasOldContent) {
      const oldSnippets = (change.oldContent ?? '').split(separatorPattern).filter((s) => s.trim());
      for (const snippet of oldSnippets) {
        const oldLines = snippet.split('\n');
        for (let i = 0; i < oldLines.length; i++) {
          result.push({
            lineNumber: result.length,
            type: 'remove',
            content: oldLines[i],
            oldLineNumber: i + 1,
          });
        }
      }
    }

    // Show added content (what it was replaced with)
    if (hasNewContent) {
      const newSnippets = (change.newContent ?? '').split(separatorPattern).filter((s) => s.trim());
      for (const snippet of newSnippets) {
        const newLines = snippet.split('\n');
        for (let i = 0; i < newLines.length; i++) {
          result.push({
            lineNumber: result.length,
            type: 'add',
            content: newLines[i],
            newLineNumber: i + 1,
          });
        }
      }
    }

    return result;
  }

  // Fallback: If we only have chunks (no full content), use chunks directly
  if (hasChunks) {
    const linesFromChunks = parseChunksToVisualizationLines(changeWithChunks.chunks);
    if (linesFromChunks.length > 0) {
      return linesFromChunks;
    }
  }

  // No chunks - handle based on content availability
  if (!hasOldContent && !hasNewContent) {
    // No content at all - create synthetic lines based on counts
    const result: VisualizationLine[] = [];
    for (let i = 0; i < (change.deletions || 0); i++) {
      result.push({
        lineNumber: result.length,
        type: 'remove',
        content: '',
        oldLineNumber: i + 1,
      });
    }
    for (let i = 0; i < (change.additions || 0); i++) {
      result.push({
        lineNumber: result.length,
        type: 'add',
        content: '',
        newLineNumber: i + 1,
      });
    }
    if (result.length === 0) {
      result.push({ lineNumber: 0, type: 'add', content: '', newLineNumber: 1 });
    }
    return result;
  }

  // Handle snippet-based content (from str-replace-editor with multiple replacements)
  const oldParts = hasOldContent ? splitBySnippetSeparator(change.oldContent ?? '') : [''];
  const newParts = hasNewContent ? splitBySnippetSeparator(change.newContent ?? '') : [''];

  const result: VisualizationLine[] = [];
  const numParts = Math.max(oldParts.length, newParts.length);

  for (let p = 0; p < numParts; p++) {
    const oldSnippet = (oldParts[p] || '').trim();
    const newSnippet = (newParts[p] || '').trim();

    if (!oldSnippet && !newSnippet) continue;

    const oldLines = oldSnippet ? oldSnippet.split('\n') : [];
    const newLines = newSnippet ? newSnippet.split('\n') : [];

    // Add deletions first, then additions (unified diff style)
    for (const line of oldLines) {
      result.push({
        lineNumber: result.length,
        type: 'remove',
        content: line,
        oldLineNumber: result.length + 1,
      });
    }
    for (const line of newLines) {
      result.push({
        lineNumber: result.length,
        type: 'add',
        content: line,
        newLineNumber: result.length + 1,
      });
    }
  }

  // If still empty, use synthetic lines
  if (result.length === 0) {
    for (let i = 0; i < (change.deletions || 0); i++) {
      result.push({ lineNumber: result.length, type: 'remove', content: '', oldLineNumber: i + 1 });
    }
    for (let i = 0; i < (change.additions || 0); i++) {
      result.push({ lineNumber: result.length, type: 'add', content: '', newLineNumber: i + 1 });
    }
  }

  // Always return at least one line so the column is visible
  if (result.length === 0) {
    result.push({ lineNumber: 0, type: 'add', content: '', newLineNumber: 1 });
  }

  return result;
}

/**
 * Convert ChatFileChange to FileColumn for visualization
 */
export function chatChangeToFileColumn(change: ChatFileChange): FileColumn {
  const filePath = change.filePath;
  const lines = parseChatFileChangeLines(change);

  return {
    id: `chat-${filePath}`,
    filePath,
    fileName: getFileName(filePath),
    lines,
    totalLines: lines.length,
    additions: change.additions || lines.filter((l) => l.type === 'add').length,
    deletions: change.deletions || lines.filter((l) => l.type === 'remove').length,
    chatChange: change,
  };
}
