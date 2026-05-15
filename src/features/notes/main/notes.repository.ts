/**
 * Notes Repository
 *
 * Data access layer for notes.
 * Handles all file I/O operations for notes.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { Note, NoteId, WorkspaceId } from '../../../shared/types';
import { WorkspaceConfig } from '../../../shared/main/config';
import {
  validateNote,
  safeValidateNote,
} from '../../../shared/schemas';
import * as Errors from '../../../shared/errors';
import { Logger } from '../../../shared/logger';
import {
  fsyncFile,
  fsyncDir,
  renameWithRetry,
} from '../../../shared/main/file-sync-utils';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { FileNotFoundError, FileReadError, FileWriteError, NoteNotFoundError } = Errors;

const logger = new Logger('NotesRepository');

/**
 * Repository interface for note persistence
 */
export interface NotesRepository {
  findById(workspaceId: WorkspaceId, noteId: NoteId): Promise<Note | null>;
  findByWorkspace(workspaceId: WorkspaceId): Promise<Note[]>;
  save(note: Note): Promise<void>;
  delete(workspaceId: WorkspaceId, noteId: NoteId): Promise<void>;
  exists(workspaceId: WorkspaceId, noteId: NoteId): Promise<boolean>;
}

/**
 * File system implementation of NotesRepository
 *
 * Uses in-memory locking to prevent concurrent writes to the same note,
 * and atomic writes (temp file + rename) to prevent file corruption.
 */
export class FileSystemNotesRepository implements NotesRepository {
  // In-memory locks to prevent concurrent writes to the same note
  private locks: Map<string, Promise<void>> = new Map();

  /**
   * Execute an operation with a lock on the specified note.
   * Prevents concurrent writes to the same note file.
   */
  private async withLock<T>(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `${workspaceId}:${noteId}`;

    // Wait for any existing lock to complete
    const existingLock = this.locks.get(lockKey);
    if (existingLock) {
      await existingLock.catch(() => {}); // Ignore errors from previous operations
    }

    // Create a new lock for this operation
    let resolve: () => void;
    const lockPromise = new Promise<void>((r) => {
      resolve = r;
    });
    this.locks.set(lockKey, lockPromise);

    try {
      return await operation();
    } finally {
      resolve!();
      // Clean up the lock if it's still ours
      if (this.locks.get(lockKey) === lockPromise) {
        this.locks.delete(lockKey);
      }
    }
  }

  /**
   * Sanitize JSON string to fix invalid escape sequences.
   * Some agents (like Auggie running in shell) may escape characters like ! with \!
   * which is not a valid JSON escape sequence. This fixes those issues.
   */
  private sanitizeJsonString(data: string): string {
    // Fix invalid escape sequences: \! \# \@ etc.
    // Valid JSON escapes are: \" \\ \/ \b \f \n \r \t \uXXXX
    // Replace \X (where X is not a valid escape char) with just X
    return data.replace(/\\([^"\\\/bfnrtu])/g, '$1');
  }

  /**
   * Find note by ID
   */
  async findById(workspaceId: WorkspaceId, noteId: NoteId): Promise<Note | null> {
    try {
      const notePath = WorkspaceConfig.paths.note(workspaceId, noteId);

      // Check if file exists
      try {
        await fs.access(notePath);
      } catch {
        return null;
      }

      // Read file
      const data = await fs.readFile(notePath, 'utf-8');

      // Try to parse JSON, if it fails due to invalid escapes, sanitize and retry
      let note;
      try {
        note = JSON.parse(data);
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          // Try sanitizing invalid escape sequences
          const sanitizedData = this.sanitizeJsonString(data);
          try {
            note = JSON.parse(sanitizedData);
            logger.warn(
              'Note file had invalid escape sequences, sanitized and parsed successfully',
              {
                workspaceId,
                noteId,
                notePath,
              },
            );
            // Optionally: rewrite the file with valid JSON to fix it permanently
            // We'll do this asynchronously to not block the read
            fs.writeFile(notePath, JSON.stringify(note, null, 2), 'utf-8').catch((writeErr) => {
              logger.error('Failed to rewrite sanitized note file', writeErr as Error, {
                workspaceId,
                noteId,
              });
            });
          } catch {
            // Still failed after sanitization, throw original error
            throw parseError;
          }
        } else {
          throw parseError;
        }
      }

      // CRITICAL: Validate note belongs to workspace
      if (note.workspaceId && note.workspaceId !== workspaceId) {
        logger.error('Note from different workspace found!', undefined, {
          noteWorkspaceId: note.workspaceId,
          expectedWorkspaceId: workspaceId,
          noteId: note.id,
        });
        return null;
      }

      // Validate schema
      const validation = safeValidateNote(note);
      if (!validation.success) {
        logger.warn('Invalid note schema', {
          workspaceId,
          noteId,
          errors: validation.error.issues,
        });
      }

      return note;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new FileReadError(
          WorkspaceConfig.paths.note(workspaceId, noteId),
          new Error('Invalid JSON'),
        );
      }
      throw error;
    }
  }

  /**
   * Find all notes in a workspace
   */
  async findByWorkspace(workspaceId: WorkspaceId): Promise<Note[]> {
    try {
      const notesDir = WorkspaceConfig.paths.notes(workspaceId);

      // Ensure notes directory exists
      await fs.mkdir(notesDir, { recursive: true });

      // Read all files
      const files = await fs.readdir(notesDir);
      const notes: Note[] = [];

      for (const file of files) {
        // Only process .json files, skip metadata files
        if (
          file.endsWith('.json') &&
          !file.endsWith('.comments.json') &&
          !file.endsWith('.edits.meta.json') &&
          !file.endsWith('.line-attribution.json')
        ) {
          const noteId = file.replace('.json', '');
          const note = await this.findById(workspaceId, noteId as NoteId);
          if (note) {
            notes.push(note);
          }
        }
      }

      return notes;
    } catch (error) {
      logger.error('Failed to list notes', error as Error, { workspaceId });
      return [];
    }
  }

  /**
   * Save note with locking and atomic writes to prevent corruption
   * from concurrent agent updates.
   */
  async save(note: Note): Promise<void> {
    // Use lock to prevent concurrent writes to the same note
    return this.withLock(note.workspaceId, note.id, async () => {
      try {
        // Validate note before saving
        validateNote(note);

        // Ensure notes directory exists
        const notesDir = WorkspaceConfig.paths.notes(note.workspaceId);
        logger.debug('Creating notes directory', { notesDir });
        await fs.mkdir(notesDir, { recursive: true });

        const notePath = WorkspaceConfig.paths.note(note.workspaceId, note.id);
        const tempPath = `${notePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
        logger.debug('Writing note file atomically', { notePath, tempPath });

        // Write to temp file first
        await fs.writeFile(tempPath, JSON.stringify(note, null, 2), 'utf-8');

        // Sync temp file to disk for durability
        await fsyncFile(tempPath);

        // Atomic rename: this is atomic on most filesystems
        await renameWithRetry(tempPath, notePath);

        // Sync parent directory to ensure rename is durable
        await fsyncDir(path.dirname(notePath));

        logger.debug('Note saved successfully', {
          workspaceId: note.workspaceId,
          noteId: note.id,
        });
      } catch (error) {
        logger.error('Failed to save note', error as Error, {
          workspaceId: note.workspaceId,
          noteId: note.id,
        });
        // Don't wrap validation errors as FileWriteError - re-throw them as-is
        // so the actual validation message is preserved
        if ((error as Error)?.name === 'ZodError') {
          throw error;
        }
        if (error instanceof Error) {
          throw new FileWriteError(WorkspaceConfig.paths.note(note.workspaceId, note.id), error);
        }
        throw error;
      }
    });
  }

  /**
   * Delete note
   */
  async delete(workspaceId: WorkspaceId, noteId: NoteId): Promise<void> {
    try {
      const notePath = WorkspaceConfig.paths.note(workspaceId, noteId);

      // Check if note exists
      try {
        await fs.access(notePath);
      } catch {
        throw new NoteNotFoundError(workspaceId, noteId);
      }

      // Delete note file
      await fs.unlink(notePath);

      // Also delete comments file if it exists
      const commentsPath = WorkspaceConfig.paths.comments(workspaceId, noteId);
      try {
        await fs.unlink(commentsPath);
      } catch {
        // Comments file might not exist, that's okay
      }

      logger.info('Note deleted', { workspaceId, noteId });
    } catch (error) {
      if (error instanceof NoteNotFoundError) {
        throw error;
      }
      logger.error('Failed to delete note', error as Error, {
        workspaceId,
        noteId,
      });
      throw error;
    }
  }

  /**
   * Check if note exists
   */
  async exists(workspaceId: WorkspaceId, noteId: NoteId): Promise<boolean> {
    try {
      const notePath = WorkspaceConfig.paths.note(workspaceId, noteId);
      await fs.access(notePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * In-memory implementation for testing
 */
export class InMemoryNotesRepository implements NotesRepository {
  private notes = new Map<string, Note>();

  private getKey(workspaceId: WorkspaceId, noteId: NoteId): string {
    return `${workspaceId}:${noteId}`;
  }

  async findById(workspaceId: WorkspaceId, noteId: NoteId): Promise<Note | null> {
    return this.notes.get(this.getKey(workspaceId, noteId)) || null;
  }

  async findByWorkspace(workspaceId: WorkspaceId): Promise<Note[]> {
    return Array.from(this.notes.values()).filter((note) => note.workspaceId === workspaceId);
  }

  async save(note: Note): Promise<void> {
    // Validate before saving
    validateNote(note);
    this.notes.set(this.getKey(note.workspaceId, note.id), note);
  }

  async delete(workspaceId: WorkspaceId, noteId: NoteId): Promise<void> {
    const key = this.getKey(workspaceId, noteId);
    if (!this.notes.has(key)) {
      throw new NoteNotFoundError(workspaceId, noteId);
    }
    this.notes.delete(key);
  }

  async exists(workspaceId: WorkspaceId, noteId: NoteId): Promise<boolean> {
    return this.notes.has(this.getKey(workspaceId, noteId));
  }

  // Test helpers
  clear(): void {
    this.notes.clear();
  }

  count(): number {
    return this.notes.size;
  }

  getAll(): Note[] {
    return Array.from(this.notes.values());
  }
}
