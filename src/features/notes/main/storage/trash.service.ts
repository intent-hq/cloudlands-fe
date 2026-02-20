/**
 * Trash Service
 *
 * Manages soft-deleted notes in .meta/.trash/
 * - Moves deleted notes to trash folder
 * - Auto-purges notes older than 30 days
 * - Allows restoration of deleted notes
 * - Uses atomic writes for crash safety
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from '../../../../shared/logger';
import type { TrashMetadata, NoteStoragePaths } from './note-storage.types';
import { VERSION_CONFIG, STORAGE_FILES } from './note-storage.types';
import { getNoteStoragePaths, getTrashDir } from './note-storage-paths';
import type { NoteId, WorkspaceId } from '../../../../shared/types';
import { writeFileAtomic, readFileSafe, deleteFileSafe, fileExists } from './atomic-file';

const logger = new Logger('TrashService');

/**
 * Move a note to trash
 */
export async function moveToTrash(
  paths: NoteStoragePaths,
  noteTitle: string,
  deletedBy: string,
): Promise<void> {
  // Ensure trash directory exists
  await fs.mkdir(paths.trashDir, { recursive: true });

  // Read current content
  const content = await readFileSafe(paths.contentFile);

  // Write content to trash (atomic)
  if (content) {
    await writeFileAtomic(paths.trashContentFile, content);
  }

  // Write trash metadata (atomic)
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + VERSION_CONFIG.TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const trashMeta: TrashMetadata = {
    deletedAt: now.toISOString(),
    deletedBy,
    expiresAt: expiresAt.toISOString(),
    noteTitle,
  };

  await writeFileAtomic(paths.trashMetaFile, JSON.stringify(trashMeta, null, 2));

  // Delete original files
  await deleteFileSafe(paths.contentFile);
  await deleteFileSafe(paths.versionsFile);
  await deleteFileSafe(paths.crdtFile);
  await deleteFileSafe(paths.commentsFile);
  await deleteFileSafe(paths.lineAttributionFile);

  logger.info('Moved note to trash', { noteTitle, expiresAt: trashMeta.expiresAt });
}

/**
 * Restore a note from trash
 */
export async function restoreFromTrash(workspaceId: WorkspaceId, noteId: NoteId): Promise<boolean> {
  const paths = getNoteStoragePaths(workspaceId, noteId);

  try {
    // Check if note exists in trash
    const trashMetaExists = await fileExists(paths.trashMetaFile);
    if (!trashMetaExists) {
      return false;
    }

    // Read trash content
    const content = await readFileSafe(paths.trashContentFile);

    // Write back to original location (atomic)
    if (content) {
      await fs.mkdir(paths.notesDir, { recursive: true });
      await writeFileAtomic(paths.contentFile, content);
    }

    // Remove from trash
    await deleteFileSafe(paths.trashContentFile);
    await deleteFileSafe(paths.trashMetaFile);

    logger.info('Restored note from trash', { noteId });
    return true;
  } catch (error) {
    logger.error('Failed to restore from trash', error as Error, { noteId });
    return false;
  }
}

/**
 * List all notes in trash
 */
export async function listTrash(workspaceId: WorkspaceId): Promise<
  Array<{
    noteId: NoteId;
    metadata: TrashMetadata;
  }>
> {
  const trashDir = getTrashDir(workspaceId);
  const result: Array<{ noteId: NoteId; metadata: TrashMetadata }> = [];

  try {
    const entries = await fs.readdir(trashDir);

    for (const entry of entries) {
      if (entry.endsWith(STORAGE_FILES.TRASH_META_EXT)) {
        const noteId = entry.replace(STORAGE_FILES.TRASH_META_EXT, '') as NoteId;
        const metaPath = path.join(trashDir, entry);

        const metaContent = await readFileSafe(metaPath);
        if (metaContent) {
          try {
            const metadata = JSON.parse(metaContent) as TrashMetadata;
            result.push({ noteId, metadata });
          } catch {
            // Skip invalid JSON entries
            logger.warn('Skipping invalid trash metadata', { noteId });
          }
        }
      }
    }
  } catch {
    // Trash directory doesn't exist
  }

  return result;
}

/**
 * Purge expired notes from trash
 */
export async function purgeExpiredTrash(workspaceId: WorkspaceId): Promise<number> {
  const trashedNotes = await listTrash(workspaceId);
  const now = new Date();
  let purgedCount = 0;

  for (const { noteId, metadata } of trashedNotes) {
    const expiresAt = new Date(metadata.expiresAt);
    if (now > expiresAt) {
      const paths = getNoteStoragePaths(workspaceId, noteId);
      await deleteFileSafe(paths.trashContentFile);
      await deleteFileSafe(paths.trashMetaFile);
      purgedCount++;
      logger.debug('Purged expired note from trash', { noteId });
    }
  }

  if (purgedCount > 0) {
    logger.info('Purged expired notes from trash', { workspaceId, purgedCount });
  }

  return purgedCount;
}
