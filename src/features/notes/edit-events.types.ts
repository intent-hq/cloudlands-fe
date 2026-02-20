/**
 * Edit Events Types
 *
 * Data structures for tracking note edits over time.
 * These events form an append-only log that can be used to:
 * - Render "pheromone trails" of recent changes
 * - Transform historical positions to current positions
 * - Provide edit history visualization
 */

import type { NoteId, WorkspaceId } from '../../shared/types';

/**
 * A single edit event representing a change to a note
 */
export interface NoteEditEvent {
  /** Unique ID for this edit event */
  id: string;

  /** Note that was edited */
  noteId: NoteId;

  /** Workspace containing the note */
  workspaceId: WorkspaceId;

  /** When this edit occurred */
  timestamp: string;

  /** Who made this edit */
  author: {
    id: string;
    name: string;
    type: 'user' | 'agent' | 'system';
  };

  /**
   * Document version number at the time of this edit
   * Monotonically increasing counter for this note
   */
  documentVersion: number;

  /**
   * The actual changes made in this edit
   * Multiple hunks can exist if changes were made in different parts of the document
   */
  hunks: EditHunk[];
}

/**
 * A contiguous region of changes within an edit
 */
export interface EditHunk {
  /** Type of change */
  type: 'addition' | 'deletion' | 'modification';

  /**
   * Line positions AT THE TIME OF THIS EDIT
   * These are "frozen" positions relative to documentVersion
   *
   * For additions: lineStart is where new content begins
   * For deletions: lineStart is where deleted content was
   * For modifications: lineStart is where changed content begins
   */
  lineStart: number;
  lineEnd: number;

  /**
   * For deletions, how many lines were removed
   * This is needed to transform positions of subsequent edits
   */
  deletedLineCount?: number;

  /**
   * Optional: Store actual content for debugging/reconstruction
   * We might not need this for rendering, but useful for verification
   */
  oldContent?: string[];
  newContent?: string[];
}

/**
 * Metadata stored alongside edit events
 */
export interface EditEventMetadata {
  /** Current document version (highest version number) */
  currentVersion: number;

  /** When this metadata was last updated */
  lastUpdated: string;

  /** Total number of edit events */
  totalEvents: number;
}
