/**
 * Flat Notes Repository
 *
 * Clean storage implementation:
 * - {noteId}.md with YAML frontmatter + content
 * - .meta/{noteId}.versions.jsonl for version history (snapshots + diffs)
 * - .meta/{noteId}.comments.json for comments
 * - .meta/{noteId}.crdt for CRDT state (session-only)
 * - .meta/.trash/ for soft-deleted notes
 *
 * Benefits:
 * - Notes are plain .md files with embedded metadata
 * - Version history uses efficient diffs
 * - Cloud-sync friendly (no SQLite, append-only versioning)
 * - Soft delete with 30-day recovery
 */

import * as path from 'path';
import type {
  Note,
  NoteId,
  WorkspaceId,
  NoteVersion,
  NoteMetadata,
} from '../../../../shared/types';
import {
  ContentType,
  NoteVisibility,
  AuthorType,
} from '../../../../shared/types';
import type { NotesRepository } from '../notes.repository';
import { Logger } from '../../../../shared/logger';
import { WorkspaceConfig } from '../../../../shared/main/config';
import {
  getNoteStoragePaths,
  getLegacyNotePath,
  getLegacyFolderPath,
} from './note-storage-paths';
import type { NoteFrontmatter, VersionEntry, VersionAuthor } from './note-storage.types';
import { STORAGE_FILES } from './note-storage.types';
import {
  parseFrontmatter,
  serializeFrontmatter,
} from './frontmatter';
import {
  readVersions,
  getContentAtVersion,
} from './version.service';
import {
  trackChange,
  flushPendingVersion,
  clearVersionState,
} from './version-manager';
import { moveToTrash } from './trash.service';
import type { IMetadataFS } from '../../../metadata-fs/main/metadata-fs';
import { LocalMetadataFS } from '../../../metadata-fs/main/local-metadata-fs';

const logger = new Logger('FlatNotesRepository');

/**
 * Convert frontmatter + content + versions to Note
 */
function toNote(
  workspaceId: WorkspaceId,
  frontmatter: NoteFrontmatter,
  content: string,
  versions?: VersionEntry[],
  fileMtime?: Date,
): Note {
  // Convert version entries to NoteVersion format
  const noteVersions: NoteVersion[] = (versions || []).map((v) => ({
    versionId: String(v.v),
    versionNumber: v.v,
    content: v.content || '', // Only populated for snapshots
    title: v.title || frontmatter.title,
    author: {
      id: v.author.id,
      name: v.author.name,
      type: v.author.type as AuthorType,
    },
    createdAt: v.date,
    changeSummary: `Version ${v.v}`,
  }));

  // Use file mtime for updatedAt if available, otherwise fall back to created date
  // This ensures notes don't appear as "updated" just because they were loaded
  const updatedAt = fileMtime
    ? fileMtime.toISOString()
    : frontmatter.created || new Date().toISOString();

  return {
    id: frontmatter.id,
    workspaceId,
    title: frontmatter.title,
    content,
    contentType: ContentType.Markdown,
    tags: frontmatter.tags || [],
    isPinned: frontmatter.pinned || false,
    isArchived: frontmatter.archived || false,
    isDefault: false,
    parentId: frontmatter.parent, // Task orchestration uses this for dependency graph
    visibility: (frontmatter.visibility as NoteVisibility) || NoteVisibility.Workspace,
    metadata: {
      task: frontmatter.task,
    },
    versions: noteVersions,
    createdAt: frontmatter.created,
    updatedAt,
  };
}

/**
 * Convert Note to frontmatter
 */
function toFrontmatter(note: Note): NoteFrontmatter {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags.length > 0 ? note.tags : undefined,
    pinned: note.isPinned || undefined,
    archived: note.isArchived || undefined,
    visibility:
      note.visibility !== NoteVisibility.Workspace
        ? (note.visibility as 'private' | 'workspace' | 'public')
        : undefined,
    parent: note.parentId, // Task orchestration uses this for dependency graph
    created: note.createdAt,
    task: note.metadata?.task,
  };
}

export class FolderBasedNotesRepository implements NotesRepository {
  // In-memory locks to prevent concurrent writes
  // Uses a queue-based approach to properly serialize operations
  private lockQueues: Map<string, Promise<void>> = new Map();

  constructor(
    private readonly metadataFSResolver: (workspaceId: string) => IMetadataFS = () => new LocalMetadataFS(),
  ) {}

  private async withLock<T>(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `${workspaceId}:${noteId}`;

    // Get the current tail of the queue (if any)
    const currentTail = this.lockQueues.get(lockKey) ?? Promise.resolve();

    // Create a new promise that will be resolved when this operation completes
    let releaseLock: () => void;
    const myLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // Atomically set ourselves as the new tail BEFORE awaiting
    // This ensures any subsequent calls will wait for us
    this.lockQueues.set(lockKey, myLock);

    // Wait for all previous operations to complete
    await currentTail;

    try {
      return await fn();
    } finally {
      releaseLock!();
      // Only delete from map if we're still the tail
      // (prevents removing a newer operation's promise)
      if (this.lockQueues.get(lockKey) === myLock) {
        this.lockQueues.delete(lockKey);
      }
    }
  }

  async exists(workspaceId: WorkspaceId, noteId: NoteId): Promise<boolean> {
    const fs = this.metadataFSResolver(workspaceId);
    const paths = getNoteStoragePaths(workspaceId, noteId);
    try {
      await fs.access(paths.contentFile);
      return true;
    } catch {
      // Check legacy formats
      try {
        await fs.access(getLegacyNotePath(workspaceId, noteId));
        return true;
      } catch {
        try {
          await fs.access(path.join(getLegacyFolderPath(workspaceId, noteId), 'content.md'));
          return true;
        } catch {
          return false;
        }
      }
    }
  }

  async findById(workspaceId: WorkspaceId, noteId: NoteId): Promise<Note | null> {
    const fs = this.metadataFSResolver(workspaceId);
    const paths = getNoteStoragePaths(workspaceId, noteId);

    try {
      // Try new frontmatter format: {noteId}.md with YAML frontmatter
      // Get file stats for mtime to use as updatedAt
      const [fileContent, stats] = await Promise.all([
        fs.readFile(paths.contentFile, 'utf-8'),
        fs.stat(paths.contentFile),
      ]);
      const fileMtime = stats.mtime;
      const { frontmatter, content } = parseFrontmatter(fileContent);

      if (frontmatter) {
        // CRITICAL: If spec.md has frontmatter but empty content, check if legacy JSON has content
        // This handles the case where an empty spec.md was created before migration
        const contentIsEmpty = !content || content.trim().length === 0;
        if (contentIsEmpty) {
          const legacyNote = await this.loadLegacyJsonNote(workspaceId, noteId);
          if (legacyNote && legacyNote.content && legacyNote.content.trim().length > 0) {
            logger.warn('Found empty .md but legacy .json has content - using legacy content', {
              noteId,
              legacyContentLength: legacyNote.content.length,
            });
            // Return the note with content from legacy JSON but preserve new frontmatter metadata
            const versions = await readVersions(paths.versionsFile);
            const note = toNote(workspaceId, frontmatter, legacyNote.content, versions, fileMtime);
            return note;
          }
        }

        // Load versions
        const versions = await readVersions(paths.versionsFile);
        return toNote(workspaceId, frontmatter, content, versions, fileMtime);
      }

      // File exists but no frontmatter - might be legacy format
      // Try to load from legacy meta file
      return this.loadLegacyFlatNote(workspaceId, noteId, content);
    } catch {
      // Try intermediate folder format: {noteId}/content.md
      try {
        const folderPath = getLegacyFolderPath(workspaceId, noteId);
        const [metaRaw, content] = await Promise.all([
          fs.readFile(path.join(folderPath, 'meta.json'), 'utf-8'),
          fs.readFile(path.join(folderPath, 'content.md'), 'utf-8'),
        ]);
        const meta = JSON.parse(metaRaw);
        return this.legacyMetaToNote(workspaceId, meta, content);
      } catch {
        // Try legacy JSON format
        return this.loadLegacyJsonNote(workspaceId, noteId);
      }
    }
  }

  private async loadLegacyFlatNote(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    content: string,
  ): Promise<Note | null> {
    const fs = this.metadataFSResolver(workspaceId);
    const paths = getNoteStoragePaths(workspaceId, noteId);
    try {
      // Try old .meta/{noteId}.json format
      const metaPath = path.join(paths.metaDir, `${noteId}.json`);
      const metaRaw = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw);
      return this.legacyMetaToNote(workspaceId, meta, content);
    } catch {
      return null;
    }
  }

  private async loadLegacyJsonNote(workspaceId: WorkspaceId, noteId: NoteId): Promise<Note | null> {
    const fs = this.metadataFSResolver(workspaceId);
    try {
      const raw = await fs.readFile(getLegacyNotePath(workspaceId, noteId), 'utf-8');
      return JSON.parse(raw) as Note;
    } catch {
      return null;
    }
  }

  private legacyMetaToNote(
    workspaceId: WorkspaceId,
    meta: Record<string, unknown>,
    content: string,
  ): Note {
    return {
      id: meta.id as NoteId,
      workspaceId,
      title: (meta.title as string) || '',
      content,
      contentType: ContentType.Markdown,
      tags: (meta.tags as string[]) || [],
      isPinned: (meta.isPinned as boolean) || false,
      isArchived: (meta.isArchived as boolean) || false,
      isDefault: (meta.isDefault as boolean) || false,
      parentId: meta.parentId as NoteId | undefined,
      visibility: (meta.visibility as NoteVisibility) || NoteVisibility.Workspace,
      metadata: meta.task ? { task: meta.task as NoteMetadata['task'] } : undefined,
      versions: [],
      createdAt: (meta.createdAt as string) || new Date().toISOString(),
      updatedAt: (meta.updatedAt as string) || new Date().toISOString(),
    };
  }

  async findByWorkspace(workspaceId: WorkspaceId): Promise<Note[]> {
    const fs = this.metadataFSResolver(workspaceId);
    const notesDir = WorkspaceConfig.paths.notes(workspaceId);
    const metaDir = path.join(notesDir, STORAGE_FILES.META_DIR);

    try {
      await fs.mkdir(notesDir, { recursive: true });
      await fs.mkdir(metaDir, { recursive: true });

      const entries = await fs.readdir(notesDir, { withFileTypes: true });
      const notes: Note[] = [];
      const loadedNoteIds = new Set<string>();
      const loadPromises: Promise<void>[] = [];

      for (const entry of entries) {
        let noteId: NoteId | null = null;

        // New flat format: .md files at root
        if (entry.isFile() && entry.name.endsWith('.md')) {
          noteId = entry.name.replace('.md', '') as NoteId;
        }
        // Intermediate folder format
        else if (
          entry.isDirectory() &&
          entry.name !== STORAGE_FILES.META_DIR &&
          entry.name !== '.git'
        ) {
          noteId = entry.name as NoteId;
        }
        // Legacy JSON format
        else if (
          entry.isFile() &&
          entry.name.endsWith('.json') &&
          !entry.name.endsWith('.comments.json') &&
          !entry.name.endsWith('.edits.meta.json')
        ) {
          noteId = entry.name.replace('.json', '') as NoteId;
        }

        // Use findById for all formats to ensure we get the best version
        // (handles case where .md is empty but .json has content)
        if (noteId && !loadedNoteIds.has(noteId)) {
          loadedNoteIds.add(noteId);
          loadPromises.push(
            this.findById(workspaceId, noteId).then((note) => {
              if (note) notes.push(note);
            }),
          );
        }
      }

      await Promise.all(loadPromises);
      return notes;
    } catch (error) {
      logger.error('Failed to find notes by workspace', error as Error, { workspaceId });
      return [];
    }
  }

  async save(note: Note): Promise<void> {
    logger.info('save called', { noteId: note.id, workspaceId: note.workspaceId });
    return this.withLock(note.workspaceId, note.id, async () => {
      const fs = this.metadataFSResolver(note.workspaceId);
      const paths = getNoteStoragePaths(note.workspaceId, note.id);
      logger.info('save - paths', {
        noteId: note.id,
        contentFile: paths.contentFile,
        notesDir: paths.notesDir,
      });

      // Ensure directories exist
      await fs.mkdir(paths.notesDir, { recursive: true });
      await fs.mkdir(paths.metaDir, { recursive: true });

      // Build frontmatter + content
      const frontmatter = toFrontmatter(note);
      const fileContent = serializeFrontmatter(frontmatter, note.content);

      // Write {noteId}.md (atomic)
      const contentTmp = `${paths.contentFile}.tmp.${Date.now()}`;
      logger.info('save - writing temp file', {
        noteId: note.id,
        contentTmp,
        contentLength: fileContent.length,
      });
      await fs.writeFile(contentTmp, fileContent, 'utf-8');
      await fs.rename(contentTmp, paths.contentFile);
      logger.info('save - file written', { noteId: note.id, contentFile: paths.contentFile });

      // Track version (debounced - creates version on author change or idle)
      const author: VersionAuthor = note.metadata?.author
        ? {
          id: note.metadata.author.id,
          name: note.metadata.author.name,
          type: note.metadata.author.type as 'user' | 'agent' | 'system',
        }
        : { id: 'user', name: 'User', type: 'user' };

      await trackChange(
        note.workspaceId,
        note.id,
        paths.versionsFile,
        note.content,
        author,
        note.title,
      );

      // Clean up legacy formats (pass content so we don't accidentally delete legacy files with content)
      await this.cleanupLegacyFormats(note.workspaceId, note.id, note.content);

      logger.debug('Saved note', { noteId: note.id, contentLength: note.content.length });
    });
  }

  private async cleanupLegacyFormats(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    savedContent?: string,
  ): Promise<void> {
    const fs = this.metadataFSResolver(workspaceId);
    const paths = getNoteStoragePaths(workspaceId, noteId);

    // Remove legacy JSON file (only log if it actually existed)
    // CRITICAL: Do NOT delete if saved content is empty but legacy JSON has content
    const legacyJsonPath = getLegacyNotePath(workspaceId, noteId);
    try {
      await fs.access(legacyJsonPath);

      // Safety check: don't delete legacy file if it has content and we're saving empty
      if (savedContent !== undefined && savedContent.trim().length === 0) {
        try {
          const legacyRaw = await fs.readFile(legacyJsonPath, 'utf-8');
          const legacyNote = JSON.parse(legacyRaw);
          if (legacyNote.content && legacyNote.content.trim().length > 0) {
            logger.warn('NOT removing legacy JSON - it has content but saved note is empty', {
              noteId,
              legacyContentLength: legacyNote.content.length,
            });
            return; // Don't delete ANY legacy formats if we're saving empty but legacy has content
          }
        } catch {
          // If we can't read the legacy file, proceed with deletion
        }
      }

      await fs.unlink(legacyJsonPath);
      logger.info('Removed legacy JSON note', { noteId });
    } catch {
      /* doesn't exist */
    }

    // Remove intermediate folder format (only log if it actually existed)
    const legacyFolderPath = getLegacyFolderPath(workspaceId, noteId);
    try {
      await fs.access(legacyFolderPath);
      await fs.rm(legacyFolderPath, { recursive: true, force: true });
      logger.info('Removed legacy folder note', { noteId });
    } catch {
      /* doesn't exist */
    }

    // Remove old .meta/{noteId}.json format (only log if it actually existed)
    const legacyMetaPath = path.join(paths.metaDir, `${noteId}.json`);
    try {
      await fs.access(legacyMetaPath);
      await fs.unlink(legacyMetaPath);
      logger.info('Removed legacy meta JSON', { noteId });
    } catch {
      /* doesn't exist */
    }

    // Remove legacy associated files
    const notesDir = WorkspaceConfig.paths.notes(workspaceId);
    const legacyFiles = [
      `${noteId}.comments.json`,
      `${noteId}.edits.jsonl`,
      `${noteId}.edits.meta.json`,
      `${noteId}.line-attribution.json`,
    ];
    for (const file of legacyFiles) {
      try {
        await fs.unlink(path.join(notesDir, file));
      } catch {
        /* doesn't exist */
      }
    }
  }

  async delete(workspaceId: WorkspaceId, noteId: NoteId): Promise<void> {
    return this.withLock(workspaceId, noteId, async () => {
      const fs = this.metadataFSResolver(workspaceId);
      const paths = getNoteStoragePaths(workspaceId, noteId);

      // Get note title for trash metadata
      let noteTitle: string = noteId;
      try {
        const fileContent = await fs.readFile(paths.contentFile, 'utf-8');
        const { frontmatter } = parseFrontmatter(fileContent);
        if (frontmatter?.title) {
          noteTitle = frontmatter.title;
        }
      } catch {
        /* use noteId as title */
      }

      // Move to trash instead of hard delete
      await moveToTrash(paths, noteTitle, 'user');

      // Clear version state
      clearVersionState(workspaceId, noteId);

      // Clean up legacy formats
      await this.cleanupLegacyFormats(workspaceId, noteId);

      logger.info('Moved note to trash', { workspaceId, noteId });
    });
  }

  /**
   * Get version history for a note
   */
  async getVersionHistory(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    limit = 50,
  ): Promise<VersionEntry[]> {
    const paths = getNoteStoragePaths(workspaceId, noteId);
    const versions = await readVersions(paths.versionsFile);
    return versions.slice(-limit);
  }

  /**
   * Get note content at a specific version
   */
  async getVersionContent(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    version: number,
  ): Promise<string | null> {
    const paths = getNoteStoragePaths(workspaceId, noteId);
    return getContentAtVersion(paths.versionsFile, version);
  }

  /**
   * Flush pending version when closing a note
   */
  async flushVersion(workspaceId: WorkspaceId, noteId: NoteId): Promise<void> {
    const paths = getNoteStoragePaths(workspaceId, noteId);
    const note = await this.findById(workspaceId, noteId);
    await flushPendingVersion(workspaceId, noteId, paths.versionsFile, note?.title);
  }
}
