/**
 * Note Storage Paths
 *
 * Generates paths for the flat note storage structure:
 * - {noteId}.md at notes/ root (frontmatter + content)
 * - .meta/{noteId}.versions.jsonl for version history
 * - .meta/{noteId}.comments.json for comments
 * - .meta/{noteId}.crdt for CRDT state (session-only)
 * - .meta/.trash/ for soft-deleted notes
 */

import * as path from 'path';
import { WorkspaceConfig } from '../../../../shared/main/config';
import type { NoteStoragePaths } from './note-storage.types';
import { STORAGE_FILES } from './note-storage.types';

/**
 * Get all storage paths for a note
 */
export function getNoteStoragePaths(workspaceId: string, noteId: string): NoteStoragePaths {
  const notesDir = WorkspaceConfig.paths.notes(workspaceId);
  const metaDir = path.join(notesDir, STORAGE_FILES.META_DIR);
  const trashDir = path.join(metaDir, STORAGE_FILES.TRASH_DIR);

  return {
    notesDir,
    contentFile: path.join(notesDir, `${noteId}${STORAGE_FILES.CONTENT_EXT}`),
    metaDir,
    versionsFile: path.join(metaDir, `${noteId}${STORAGE_FILES.VERSIONS_EXT}`),
    commentsFile: path.join(metaDir, `${noteId}${STORAGE_FILES.COMMENTS_EXT}`),
    lineAttributionFile: path.join(metaDir, `${noteId}${STORAGE_FILES.LINE_ATTRIBUTION_EXT}`),
    crdtFile: path.join(metaDir, `${noteId}${STORAGE_FILES.CRDT_EXT}`),
    trashDir,
    trashContentFile: path.join(trashDir, `${noteId}${STORAGE_FILES.CONTENT_EXT}`),
    trashMetaFile: path.join(trashDir, `${noteId}${STORAGE_FILES.TRASH_META_EXT}`),
  };
}

/**
 * Legacy path for old .json note files (original format)
 */
export function getLegacyNotePath(workspaceId: string, noteId: string): string {
  const notesDir = WorkspaceConfig.paths.notes(workspaceId);
  return path.join(notesDir, `${noteId}${WorkspaceConfig.LEGACY_NOTE_FILE_EXTENSION}`);
}

/**
 * Legacy folder path for intermediate format (folder-per-note)
 */
export function getLegacyFolderPath(workspaceId: string, noteId: string): string {
  const notesDir = WorkspaceConfig.paths.notes(workspaceId);
  return path.join(notesDir, noteId);
}

/**
 * Get paths for listing trash contents
 */
export function getTrashDir(workspaceId: string): string {
  const notesDir = WorkspaceConfig.paths.notes(workspaceId);
  return path.join(notesDir, STORAGE_FILES.META_DIR, STORAGE_FILES.TRASH_DIR);
}
