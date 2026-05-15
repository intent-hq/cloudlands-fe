/**
 * Comments Repository
 *
 * Data access layer for comments.
 * Handles all file I/O operations for comments.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { WorkspaceId, NoteId, NoteComment } from '../../../shared/types';
import { WorkspaceConfig } from '../../../shared/main/config';
import {
  validateCommentsData,
  safeValidateCommentsData,
} from '../../../shared/schemas';
import * as Errors from '../../../shared/errors';
import { Logger } from '../../../shared/logger';
import { STORAGE_FILES } from '../../notes/main/storage/note-storage.types';
import {
  fsyncFile,
  fsyncDir,
} from '../../../shared/main/file-sync-utils';

const { FileReadError, FileWriteError, CommentNotFoundError } = Errors;

/**
 * Get the new comments path in the .meta directory
 */
function getNewCommentsPath(workspaceId: WorkspaceId, noteId: NoteId): string {
  const notesDir = WorkspaceConfig.paths.notes(workspaceId);
  const metaDir = path.join(notesDir, STORAGE_FILES.META_DIR);
  return path.join(metaDir, `${noteId}${STORAGE_FILES.COMMENTS_EXT}`);
}

/**
 * Get the legacy comments path in the notes directory
 */
function getLegacyCommentsPath(workspaceId: WorkspaceId, noteId: NoteId): string {
  return WorkspaceConfig.paths.comments(workspaceId, noteId);
}

const logger = new Logger('CommentsRepository');

interface NoteCommentsData {
  version: string;
  comments: NoteComment[];
  lastUpdated: string;
}

/**
 * Repository interface for comment persistence
 */
export interface CommentsRepository {
  findByNote(workspaceId: WorkspaceId, noteId: NoteId): Promise<NoteComment[]>;
  findById(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    commentId: string,
  ): Promise<NoteComment | null>;
  save(workspaceId: WorkspaceId, noteId: NoteId, comments: NoteComment[]): Promise<void>;
  add(workspaceId: WorkspaceId, noteId: NoteId, comment: NoteComment): Promise<void>;
  update(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    commentId: string,
    updates: Partial<NoteComment>,
  ): Promise<void>;
  delete(workspaceId: WorkspaceId, noteId: NoteId, commentId: string): Promise<void>;
}

/**
 * File system implementation of CommentsRepository
 */
export class FileSystemCommentsRepository implements CommentsRepository {
  /**
   * Find all comments for a note
   * Checks new .meta location first, then falls back to legacy location
   */
  async findByNote(workspaceId: WorkspaceId, noteId: NoteId): Promise<NoteComment[]> {
    try {
      // Try new location first (.meta directory)
      const newPath = getNewCommentsPath(workspaceId, noteId);
      let commentsPath = newPath;

      try {
        await fs.access(newPath);
      } catch {
        // Try legacy location
        const legacyPath = getLegacyCommentsPath(workspaceId, noteId);
        try {
          await fs.access(legacyPath);
          commentsPath = legacyPath;
        } catch {
          // No comments file in either location
          return [];
        }
      }

      // Read file
      const data = await fs.readFile(commentsPath, 'utf-8');
      const commentsData: NoteCommentsData = JSON.parse(data);

      // Validate schema
      const validation = safeValidateCommentsData(commentsData);
      if (!validation.success) {
        logger.warn('Invalid comments schema', {
          workspaceId,
          noteId,
          errors: validation.error.issues,
        });
      }

      return commentsData.comments || [];
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new FileReadError(getNewCommentsPath(workspaceId, noteId), new Error('Invalid JSON'));
      }
      logger.error('Failed to read comments', error as Error, {
        workspaceId,
        noteId,
      });
      return [];
    }
  }

  /**
   * Find specific comment by ID
   */
  async findById(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    commentId: string,
  ): Promise<NoteComment | null> {
    const comments = await this.findByNote(workspaceId, noteId);
    return comments.find((c) => c.id === commentId) || null;
  }

  /**
   * Save all comments for a note
   * Writes to new .meta location
   */
  async save(workspaceId: WorkspaceId, noteId: NoteId, comments: NoteComment[]): Promise<void> {
    try {
      const commentsData: NoteCommentsData = {
        version: '1.0.0',
        comments,
        lastUpdated: new Date().toISOString(),
      };

      // Validate before saving
      validateCommentsData(commentsData);

      // Ensure .meta directory exists
      const notesDir = WorkspaceConfig.paths.notes(workspaceId);
      const metaDir = path.join(notesDir, STORAGE_FILES.META_DIR);
      await fs.mkdir(metaDir, { recursive: true });

      // Write comments file to new location
      const commentsPath = getNewCommentsPath(workspaceId, noteId);
      await fs.writeFile(commentsPath, JSON.stringify(commentsData, null, 2), 'utf-8');

      // Sync file and directory to disk for durability
      await fsyncFile(commentsPath);
      await fsyncDir(path.dirname(commentsPath));

      logger.debug('Comments saved', {
        workspaceId,
        noteId,
        count: comments.length,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new FileWriteError(WorkspaceConfig.paths.comments(workspaceId, noteId), error);
      }
      throw error;
    }
  }

  /**
   * Add a new comment
   */
  async add(workspaceId: WorkspaceId, noteId: NoteId, comment: NoteComment): Promise<void> {
    const comments = await this.findByNote(workspaceId, noteId);
    comments.push(comment);
    await this.save(workspaceId, noteId, comments);
  }

  /**
   * Update an existing comment
   */
  async update(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    commentId: string,
    updates: Partial<NoteComment>,
  ): Promise<void> {
    const comments = await this.findByNote(workspaceId, noteId);
    const index = comments.findIndex((c) => c.id === commentId);

    if (index === -1) {
      throw new CommentNotFoundError(workspaceId, noteId, commentId);
    }

    // Update comment
    comments[index] = {
      ...comments[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.save(workspaceId, noteId, comments);
  }

  /**
   * Delete a comment
   */
  async delete(workspaceId: WorkspaceId, noteId: NoteId, commentId: string): Promise<void> {
    const comments = await this.findByNote(workspaceId, noteId);
    const filtered = comments.filter((c) => c.id !== commentId);

    if (filtered.length === comments.length) {
      throw new CommentNotFoundError(workspaceId, noteId, commentId);
    }

    await this.save(workspaceId, noteId, filtered);
    logger.info('Comment deleted', { workspaceId, noteId, commentId });
  }
}

/**
 * In-memory implementation for testing
 */
export class InMemoryCommentsRepository implements CommentsRepository {
  private comments = new Map<string, NoteComment[]>();

  private getKey(workspaceId: WorkspaceId, noteId: NoteId): string {
    return `${workspaceId}:${noteId}`;
  }

  async findByNote(workspaceId: WorkspaceId, noteId: NoteId): Promise<NoteComment[]> {
    return this.comments.get(this.getKey(workspaceId, noteId)) || [];
  }

  async findById(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    commentId: string,
  ): Promise<NoteComment | null> {
    const comments = await this.findByNote(workspaceId, noteId);
    return comments.find((c) => c.id === commentId) || null;
  }

  async save(workspaceId: WorkspaceId, noteId: NoteId, comments: NoteComment[]): Promise<void> {
    this.comments.set(this.getKey(workspaceId, noteId), comments);
  }

  async add(workspaceId: WorkspaceId, noteId: NoteId, comment: NoteComment): Promise<void> {
    const comments = await this.findByNote(workspaceId, noteId);
    comments.push(comment);
    await this.save(workspaceId, noteId, comments);
  }

  async update(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    commentId: string,
    updates: Partial<NoteComment>,
  ): Promise<void> {
    const comments = await this.findByNote(workspaceId, noteId);
    const index = comments.findIndex((c) => c.id === commentId);

    if (index === -1) {
      throw new CommentNotFoundError(workspaceId, noteId, commentId);
    }

    comments[index] = { ...comments[index], ...updates };
    await this.save(workspaceId, noteId, comments);
  }

  async delete(workspaceId: WorkspaceId, noteId: NoteId, commentId: string): Promise<void> {
    const comments = await this.findByNote(workspaceId, noteId);
    const filtered = comments.filter((c) => c.id !== commentId);

    if (filtered.length === comments.length) {
      throw new CommentNotFoundError(workspaceId, noteId, commentId);
    }

    await this.save(workspaceId, noteId, filtered);
  }

  // Test helpers
  clear(): void {
    this.comments.clear();
  }

  count(): number {
    return this.comments.size;
  }
}
