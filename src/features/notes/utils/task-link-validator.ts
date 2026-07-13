/**
 * Task Link Validator
 *
 * Validates intent://local/task/ links in note content.
 * Detects invalid task IDs (non-UUID) that agents sometimes write incorrectly.
 */

import {
  UUID_REGEX,
  RESERVED_NOTE_IDS,
  TASK_LINK_REGEX_FLEXIBLE,
} from '$shared/constants/intent-links';

/**
 * Information about an invalid task link found in content
 */
export interface InvalidTaskLink {
  /** The full matched text */
  fullMatch: string;
  /** The link text (task title) */
  linkText: string;
  /** The invalid note ID */
  noteId: string;
  /** Position in the content */
  index: number;
  /** Why this link is invalid */
  reason: 'non-uuid' | 'empty';
}

/**
 * Result of validating task links in content
 */
export interface TaskLinkValidationResult {
  /** Whether all task links are valid */
  valid: boolean;
  /** List of invalid links found */
  invalidLinks: InvalidTaskLink[];
}

/**
 * Check if a note ID is valid
 * Valid IDs are: UUIDs or reserved IDs like 'spec'
 */
export function isValidTaskNoteId(id: string): boolean {
  if (!id || id.trim().length === 0) {
    return false;
  }
  return UUID_REGEX.test(id) || RESERVED_NOTE_IDS.has(id);
}

/**
 * Find all invalid task links in markdown content
 */
export function findInvalidTaskLinks(content: string): TaskLinkValidationResult {
  const invalidLinks: InvalidTaskLink[] = [];
  // Use fresh regex instance to avoid lastIndex issues
  const taskLinkRegex = new RegExp(TASK_LINK_REGEX_FLEXIBLE.source, 'g');

  let match;
  while ((match = taskLinkRegex.exec(content)) !== null) {
    const [fullMatch, linkText, noteId] = match;

    if (!noteId || noteId.trim().length === 0) {
      invalidLinks.push({
        fullMatch,
        linkText,
        noteId: noteId || '',
        index: match.index,
        reason: 'empty',
      });
    } else if (!isValidTaskNoteId(noteId)) {
      invalidLinks.push({
        fullMatch,
        linkText,
        noteId,
        index: match.index,
        reason: 'non-uuid',
      });
    }
  }

  return {
    valid: invalidLinks.length === 0,
    invalidLinks,
  };
}
