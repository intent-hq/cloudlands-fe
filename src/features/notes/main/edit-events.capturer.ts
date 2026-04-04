/**
 * Edit Events Capturer
 *
 * Computes edit hunks by diffing old and new content.
 * Converts text diffs into structured EditHunk data.
 */

import { diffLines } from 'diff';
import { randomUUID } from 'crypto';
import { Logger } from '../../../shared/logger';
import type { NoteId, WorkspaceId } from '../../../shared/types';
import type { NoteEditEvent, EditHunk } from '../edit-events.types';

const logger = new Logger('EditEventsCapturer');

export class EditEventsCapturer {
  /**
   * Capture an edit event by diffing old and new content
   */
  captureEdit(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    oldContent: string,
    newContent: string,
    author: { id: string; name: string; type: 'user' | 'agent' | 'system' },
    documentVersion: number,
  ): NoteEditEvent {
    const hunks = this.computeHunks(oldContent, newContent);

    const event: NoteEditEvent = {
      id: randomUUID(),
      noteId,
      workspaceId,
      timestamp: new Date().toISOString(),
      author,
      documentVersion,
      hunks,
    };

    logger.debug('Captured edit event', {
      noteId,
      eventId: event.id,
      version: documentVersion,
      hunks: hunks.length,
      author: author.name,
    });

    return event;
  }

  /**
   * Compute edit hunks from content diff
   */
  private computeHunks(oldContent: string, newContent: string): EditHunk[] {
    // Use diffLines to get line-level changes
    const changes = diffLines(oldContent, newContent);

    const hunks: EditHunk[] = [];
    let oldLineNumber = 1;
    let newLineNumber = 1;

    for (const change of changes) {
      const lineCount = change.count || 0;

      if (change.added) {
        // Addition: new lines were added
        hunks.push({
          type: 'addition',
          lineStart: newLineNumber,
          lineEnd: newLineNumber + lineCount - 1,
          newContent: this.splitLines(change.value),
        });
        newLineNumber += lineCount;
      } else if (change.removed) {
        // Deletion: lines were removed
        hunks.push({
          type: 'deletion',
          lineStart: oldLineNumber,
          lineEnd: oldLineNumber + lineCount - 1,
          deletedLineCount: lineCount,
          oldContent: this.splitLines(change.value),
        });
        oldLineNumber += lineCount;
      } else {
        // Unchanged: advance both line counters
        oldLineNumber += lineCount;
        newLineNumber += lineCount;
      }
    }

    // Merge adjacent additions and deletions into modifications
    const mergedHunks = this.mergeAdjacentChanges(hunks);

    logger.debug('Computed hunks', {
      rawHunks: hunks.length,
      mergedHunks: mergedHunks.length,
    });

    return mergedHunks;
  }

  /**
   * Merge adjacent additions and deletions into modifications
   * This gives us cleaner "this section was modified" semantics
   */
  private mergeAdjacentChanges(hunks: EditHunk[]): EditHunk[] {
    const merged: EditHunk[] = [];
    let i = 0;

    while (i < hunks.length) {
      const current = hunks[i];
      const next = hunks[i + 1];

      // Check if we have a deletion followed by an addition
      // These should be merged into a modification
      if (
        current.type === 'deletion' &&
        next &&
        next.type === 'addition' &&
        this.areAdjacent(current, next)
      ) {
        // Merge into modification
        merged.push({
          type: 'modification',
          lineStart: current.lineStart,
          lineEnd: next.lineEnd,
          deletedLineCount: current.deletedLineCount,
          oldContent: current.oldContent,
          newContent: next.newContent,
        });
        i += 2; // Skip both hunks
      } else {
        // Keep as-is
        merged.push(current);
        i += 1;
      }
    }

    return merged;
  }

  /**
   * Check if two hunks are adjacent (should be merged)
   */
  private areAdjacent(deletion: EditHunk, addition: EditHunk): boolean {
    // They're adjacent if the addition starts right after the deletion
    // In practice, deletion is at oldLineNumber and addition is at newLineNumber
    // We consider them adjacent if they're in the same general area
    return Math.abs(deletion.lineStart - addition.lineStart) <= 2;
  }

  /**
   * Split text into lines, preserving empty lines
   */
  private splitLines(text: string): string[] {
    // Remove trailing newline if present (diffLines includes it)
    const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
    return trimmed.split('\n');
  }
}

// Export singleton instance
export const editEventsCapturer = new EditEventsCapturer();
