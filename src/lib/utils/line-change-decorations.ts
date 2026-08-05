/**
 * Line Change Decorations Utility
 *
 * Parses git diff information and creates Monaco editor decorations
 * to highlight added, modified, and deleted lines in the gutter.
 * Similar to VS Code's line change indicators.
 */

import type { DiffHunk } from '$features/git-tracking/types';
import { m } from '$shared/paraglide/messages.js';

export type LineChangeType = 'added' | 'modified' | 'deleted';

export interface LineChange {
  line: number;
  type: LineChangeType;
}

/**
 * Parse diff hunks to extract line-level change information
 * Returns an array of line changes for the NEW version of the file
 */
export function parseHunksToLineChanges(hunks: DiffHunk[]): LineChange[] {
  const changes: LineChange[] = [];

  for (const hunk of hunks) {
    let newLineNum = hunk.newStart;

    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        // Added line
        changes.push({ line: newLineNum, type: 'added' });
        newLineNum++;
      } else if (line.startsWith('-')) {
        // Deleted line - we track the position in new file where deletion occurred
        // but we don't increment newLineNum since this line doesn't exist in new file
        // We'll mark the previous or next line as having a deletion indicator
      } else if (line.startsWith(' ')) {
        // Context line (unchanged)
        newLineNum++;
      }
    }
  }

  return changes;
}

/**
 * Merge adjacent changes of the same type for cleaner visualization
 */
export function mergeAdjacentChanges(changes: LineChange[]): LineChange[] {
  if (changes.length === 0) return [];

  // Sort by line number
  const sorted = [...changes].sort((a, b) => a.line - b.line);

  // Remove duplicates (keep the first occurrence)
  const unique: LineChange[] = [];
  const seen = new Set<number>();

  for (const change of sorted) {
    if (!seen.has(change.line)) {
      seen.add(change.line);
      unique.push(change);
    }
  }

  return unique;
}

/**
 * Create Monaco decoration options for line changes
 * These decorations show colored indicators in the gutter
 */
export function createLineChangeDecorations(
  monaco: typeof import('monaco-editor'),
  changes: LineChange[],
): import('monaco-editor').editor.IModelDeltaDecoration[] {
  return changes.map((change) => {
    const color = getChangeColor(change.type);
    const hoverMessage = getChangeHoverMessage(change.type);

    return {
      range: new monaco.Range(change.line, 1, change.line, 1),
      options: {
        isWholeLine: false,
        linesDecorationsClassName: `line-change-indicator line-change-${change.type}`,
        overviewRuler: {
          color,
          position: monaco.editor.OverviewRulerLane.Left,
        },
        glyphMarginHoverMessage: { value: hoverMessage },
      },
    };
  });
}

function getChangeColor(type: LineChangeType): string {
  switch (type) {
    case 'added':
      return '#22c55e'; // green-500
    case 'modified':
      return '#3b82f6'; // blue-500
    case 'deleted':
      return '#ef4444'; // red-500
    default:
      return '#6b7280'; // gray-500
  }
}

function getChangeHoverMessage(type: LineChangeType): string {
  switch (type) {
    case 'added':
      return m.editor_lineChanges_added_tooltip();
    case 'modified':
      return m.editor_lineChanges_modified_tooltip();
    case 'deleted':
      return m.editor_lineChanges_deleted_tooltip();
    default:
      return m.editor_lineChanges_changed_tooltip();
  }
}

/**
 * CSS styles for line change indicators
 * These should be added to global styles
 */
export const lineChangeDecorationStyles = `
  /* Line change indicator container in the gutter */
  .line-change-indicator {
    width: 3px !important;
    margin-left: 3px;
  }

  /* Added lines - green indicator */
  .line-change-added {
    background-color: #22c55e !important;
  }

  /* Modified lines - blue indicator */
  .line-change-modified {
    background-color: #3b82f6 !important;
  }

  /* Deleted lines - red triangle/indicator */
  .line-change-deleted {
    background-color: #ef4444 !important;
  }
`;
