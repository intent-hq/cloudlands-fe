/**
 * Note Storage Types
 *
 * Clean storage architecture for notes:
 * - {noteId}.md: Frontmatter + markdown content (human-readable)
 * - .meta/{noteId}.versions.jsonl: Version history (snapshots + diffs)
 * - .meta/{noteId}.comments.json: Comments
 * - .meta/{noteId}.crdt: Yjs CRDT state (session-only, for concurrent editing)
 * - .meta/.trash/: Soft-deleted notes with 30-day auto-purge
 */

import type { NoteId, TaskMetadata } from '../../../../shared/types';

/**
 * Author information for versioning
 */
export interface VersionAuthor {
  id: string;
  name: string;
  type: 'user' | 'agent' | 'system';
}

/**
 * Frontmatter stored at top of .md file
 * Contains stable metadata that rarely changes
 */
export interface NoteFrontmatter {
  id: NoteId;
  title: string;
  tags?: string[];
  pinned?: boolean;
  archived?: boolean;
  visibility?: 'private' | 'workspace' | 'public';
  parent?: NoteId; // Task orchestration uses this for dependency graph (children are subtasks)
  created: string; // ISO date
  task?: TaskMetadata;
  // Note: dependencies array removed - task orchestration now uses parent/child hierarchy
}

/**
 * Version entry in .versions.jsonl
 * Either a full snapshot or a diff from previous version
 */
export interface VersionEntry {
  type: 'snapshot' | 'diff';
  v: number; // Version number
  date: string; // ISO date
  author: VersionAuthor;
  content?: string; // Full content for snapshots
  diff?: string; // Unified diff for diff entries
  title?: string; // Title at this version (for snapshots)
}

/**
 * Trash metadata stored in .meta/.trash/{noteId}.meta.json
 */
export interface TrashMetadata {
  deletedAt: string; // ISO date
  deletedBy: string; // User/agent ID
  expiresAt: string; // ISO date (30 days after deletion)
  noteTitle: string; // For display in trash list
}

/**
 * Storage paths for a note
 */
export interface NoteStoragePaths {
  notesDir: string; // ~/intent/{wid}/.workspace/notes/
  contentFile: string; // {noteId}.md (frontmatter + content)
  metaDir: string; // .meta/
  versionsFile: string; // .meta/{noteId}.versions.jsonl
  commentsFile: string; // .meta/{noteId}.comments.json
  lineAttributionFile: string; // .meta/{noteId}.line-attribution.json
  crdtFile: string; // .meta/{noteId}.crdt
  trashDir: string; // .meta/.trash/
  trashContentFile: string; // .meta/.trash/{noteId}.md
  trashMetaFile: string; // .meta/.trash/{noteId}.meta.json
}

/**
 * File/folder names used in storage
 */
export const STORAGE_FILES = {
  META_DIR: '.meta',
  TRASH_DIR: '.trash',
  CONTENT_EXT: '.md',
  VERSIONS_EXT: '.versions.jsonl',
  COMMENTS_EXT: '.comments.json',
  CRDT_EXT: '.crdt',
  TRASH_META_EXT: '.meta.json',
  LINE_ATTRIBUTION_EXT: '.line-attribution.json',
} as const;

/**
 * Versioning configuration
 */
export const VERSION_CONFIG = {
  MAX_VERSIONS: 50, // Maximum versions to keep
  SNAPSHOT_INTERVAL: 10, // Create snapshot every N versions
  IDLE_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes idle before auto-version
  TRASH_RETENTION_DAYS: 30, // Days before auto-purge from trash
} as const;
