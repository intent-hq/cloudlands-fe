/**
 * User Activity Types
 *
 * Types for tracking user activity on notes (e.g., last read time).
 * Stored separately from notes to support future multi-user scenarios.
 */


/**
 * Record of when a user last read a note
 */
export interface NoteReadRecord {
  /** ISO timestamp of when the note was last read */
  lastReadAt: string;
  /** Optional: number of times the note has been opened */
  readCount?: number;
}

/**
 * User activity data stored per workspace
 * File location: ~/intent/{workspace-id}/.workspace/user-activity.json
 */
export interface UserActivityData {
  /** Schema version for future migrations */
  version: 1;
  /** User identifier - 'local-user' for now, multi-user ready */
  userId: string;
  /** Map of noteId -> read record */
  noteReads: Record<string, NoteReadRecord>;
  /** ISO timestamp of last update to this file */
  lastUpdated: string;
}

/**
 * Default user ID for single-user mode
 */
export const LOCAL_USER_ID = 'local-user';

/**
 * Current schema version
 */
export const USER_ACTIVITY_VERSION = 1 as const;

/**
 * Create empty user activity data
 */
export function createEmptyUserActivityData(userId: string = LOCAL_USER_ID): UserActivityData {
  return {
    version: USER_ACTIVITY_VERSION,
    userId,
    noteReads: {},
    lastUpdated: new Date().toISOString(),
  };
}
