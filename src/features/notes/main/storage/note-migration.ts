/**
 * Note Migration Utility
 *
 * Migrates notes from legacy formats to the new frontmatter format:
 * - Legacy JSON: {noteId}.json → {noteId}.md (with frontmatter)
 * - Intermediate folder: {noteId}/content.md → {noteId}.md (with frontmatter)
 * - Old flat format: {noteId}.md + .meta/{noteId}.json → {noteId}.md (with frontmatter)
 *
 * New format:
 *   - {noteId}.md (frontmatter + content, human-readable)
 *   - .meta/{noteId}.versions.jsonl (version history)
 *   - .meta/{noteId}.comments.json (comments)
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { Note, WorkspaceId, NoteId } from '../../../../shared/types';
import { WorkspaceConfig } from '../../../../shared/main/config';
import { Logger } from '../../../../shared/logger';
import { FolderBasedNotesRepository } from './folder-notes.repository';
import { getNoteStoragePaths } from './note-storage-paths';
import {
  STORAGE_FILES,
  type NoteFrontmatter,
} from './note-storage.types';
import {
  parseFrontmatter,
  serializeFrontmatter,
} from './frontmatter';

const logger = new Logger('NoteMigration');

/**
 * Migration result for a single note
 */
export interface NoteMigrationResult {
  noteId: NoteId;
  success: boolean;
  error?: string;
}

/**
 * Migration result for a workspace
 */
export interface WorkspaceMigrationResult {
  workspaceId: WorkspaceId;
  totalNotes: number;
  migratedNotes: number;
  skippedNotes: number;
  failedNotes: number;
  results: NoteMigrationResult[];
}

type MigrationType = 'json' | 'folder' | 'old-flat' | 'recovery' | false;

/**
 * Check if a legacy JSON file has content that should be recovered
 */
async function hasLegacyJsonContent(notesDir: string, noteId: string): Promise<boolean> {
  const legacyJsonPath = path.join(notesDir, `${noteId}.json`);
  try {
    const raw = await fs.readFile(legacyJsonPath, 'utf-8');
    const note = JSON.parse(raw);
    return note.content && note.content.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if a note needs migration
 */
async function needsMigration(notesDir: string, noteId: string): Promise<MigrationType> {
  const mdPath = path.join(notesDir, `${noteId}.md`);
  const metaDir = path.join(notesDir, STORAGE_FILES.META_DIR);

  // Check if .md file exists
  try {
    await fs.access(mdPath);
    // File exists - check if it has frontmatter
    const fileContent = await fs.readFile(mdPath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(fileContent);
    if (frontmatter) {
      // CRITICAL: Even if spec.md exists with frontmatter, check if it's empty
      // and there's a spec.json with content that should be recovered
      const mdContentIsEmpty = !content || content.trim().length === 0;
      if (mdContentIsEmpty && (await hasLegacyJsonContent(notesDir, noteId))) {
        logger.warn(
          'Found empty .md with frontmatter but legacy .json has content - needs recovery',
          {
            noteId,
          },
        );
        return 'recovery'; // Need to recover content from legacy JSON
      }
      return false; // Already in new format with content
    }
    // Has .md but no frontmatter - check for old .meta/{noteId}.json
    const oldMetaPath = path.join(metaDir, `${noteId}.json`);
    try {
      await fs.access(oldMetaPath);
      return 'old-flat'; // Old flat format with separate meta file
    } catch {
      return false; // Just a plain .md file, no migration needed
    }
  } catch {
    // No .md file - check for legacy formats
  }

  // Check for legacy JSON format
  const legacyJsonPath = path.join(notesDir, `${noteId}.json`);
  try {
    await fs.access(legacyJsonPath);
    return 'json';
  } catch {
    // Check for intermediate folder format
  }

  // Check for intermediate folder format
  const folderPath = path.join(notesDir, noteId, 'content.md');
  try {
    await fs.access(folderPath);
    return 'folder';
  } catch {
    return false;
  }
}

/**
 * Migrate a single note from legacy to new frontmatter format
 */
async function migrateNote(
  workspaceId: WorkspaceId,
  noteId: NoteId,
  migrationType: 'json' | 'folder' | 'old-flat' | 'recovery',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  repository: FolderBasedNotesRepository,
): Promise<NoteMigrationResult> {
  const notesDir = WorkspaceConfig.paths.notes(workspaceId);
  const paths = getNoteStoragePaths(workspaceId, noteId);

  try {
    let content: string;
    let frontmatter: NoteFrontmatter;

    if (migrationType === 'json') {
      // Read from legacy JSON format
      const legacyPath = path.join(notesDir, `${noteId}.json`);
      const raw = await fs.readFile(legacyPath, 'utf-8');
      const note = JSON.parse(raw) as Note;
      content = note.content;
      frontmatter = noteToFrontmatter(note);
    } else if (migrationType === 'recovery') {
      // RECOVERY: spec.md exists but is empty, recover content from spec.json
      // Keep the existing frontmatter from spec.md but replace empty content with JSON content
      const legacyPath = path.join(notesDir, `${noteId}.json`);
      const raw = await fs.readFile(legacyPath, 'utf-8');
      const legacyNote = JSON.parse(raw) as Note;

      // Read existing frontmatter from the .md file
      const existingMd = await fs.readFile(paths.contentFile, 'utf-8');
      const { frontmatter: existingFrontmatter } = parseFrontmatter(existingMd);

      // Use existing frontmatter if available, otherwise create from legacy note
      frontmatter = existingFrontmatter || noteToFrontmatter(legacyNote);
      content = legacyNote.content;

      logger.warn('Recovering note content from legacy JSON', {
        workspaceId,
        noteId,
        recoveredContentLength: content.length,
      });
    } else if (migrationType === 'folder') {
      // Read from intermediate folder format
      const folderPath = path.join(notesDir, noteId);
      const [metaRaw, contentRaw] = await Promise.all([
        fs.readFile(path.join(folderPath, 'meta.json'), 'utf-8'),
        fs.readFile(path.join(folderPath, 'content.md'), 'utf-8'),
      ]);
      const meta = JSON.parse(metaRaw);
      content = contentRaw;
      frontmatter = metaToFrontmatter(meta, noteId);
    } else {
      // old-flat: .md file + .meta/{noteId}.json
      const [contentRaw, metaRaw] = await Promise.all([
        fs.readFile(paths.contentFile, 'utf-8'),
        fs.readFile(path.join(paths.metaDir, `${noteId}.json`), 'utf-8'),
      ]);
      content = contentRaw;
      const meta = JSON.parse(metaRaw);
      frontmatter = metaToFrontmatter(meta, noteId);
    }

    // Write new format with frontmatter
    const fileContent = serializeFrontmatter(frontmatter, content);
    await fs.mkdir(paths.notesDir, { recursive: true });
    await fs.writeFile(paths.contentFile, fileContent, 'utf-8');

    // Migrate comments if they exist
    await migrateComments(notesDir, noteId, paths);

    // Clean up old files (for recovery, this will remove the now-redundant .json file)
    await cleanupOldFiles(
      notesDir,
      noteId,
      migrationType === 'recovery' ? 'json' : migrationType,
      paths,
    );

    logger.info('Migrated note', { workspaceId, noteId, from: migrationType });
    return { noteId, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to migrate note', error as Error, { workspaceId, noteId });
    return { noteId, success: false, error: message };
  }
}

/**
 * Convert Note to NoteFrontmatter
 */
function noteToFrontmatter(note: Note): NoteFrontmatter {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags?.length ? note.tags : undefined,
    pinned: note.isPinned || undefined,
    archived: note.isArchived || undefined,
    parent: note.parentId,
    created: note.createdAt || new Date().toISOString(),
    task: note.metadata?.task,
  };
}

/**
 * Convert legacy meta object to NoteFrontmatter
 */
function metaToFrontmatter(meta: Record<string, unknown>, noteId: NoteId): NoteFrontmatter {
  return {
    id: (meta.id as NoteId) || noteId,
    title: (meta.title as string) || noteId,
    tags: (meta.tags as string[])?.length ? (meta.tags as string[]) : undefined,
    pinned: (meta.isPinned as boolean) || undefined,
    archived: (meta.isArchived as boolean) || undefined,
    parent: meta.parentId as NoteId | undefined,
    created: (meta.createdAt as string) || new Date().toISOString(),
    task: meta.task as NoteFrontmatter['task'],
  };
}

/**
 * Migrate comments from old locations to new location
 */
async function migrateComments(
  notesDir: string,
  noteId: NoteId,
  paths: ReturnType<typeof getNoteStoragePaths>,
): Promise<void> {
  const commentPaths = [
    path.join(notesDir, `${noteId}.comments.json`),
    path.join(notesDir, noteId, 'comments.json'),
  ];

  for (const commentsPath of commentPaths) {
    try {
      const commentsRaw = await fs.readFile(commentsPath, 'utf-8');
      await fs.mkdir(paths.metaDir, { recursive: true });
      await fs.writeFile(paths.commentsFile, commentsRaw, 'utf-8');
      await fs.unlink(commentsPath);
      break;
    } catch {
      // Try next path
    }
  }
}

/**
 * Clean up old format files after migration
 */
async function cleanupOldFiles(
  notesDir: string,
  noteId: NoteId,
  migrationType: 'json' | 'folder' | 'old-flat',
  paths: ReturnType<typeof getNoteStoragePaths>,
): Promise<void> {
  if (migrationType === 'json') {
    await safeUnlink(path.join(notesDir, `${noteId}.json`));
  } else if (migrationType === 'folder') {
    await safeRm(path.join(notesDir, noteId));
  } else if (migrationType === 'old-flat') {
    await safeUnlink(path.join(paths.metaDir, `${noteId}.json`));
  }

  // Clean up legacy associated files
  const legacyFiles = [
    `${noteId}.edits.jsonl`,
    `${noteId}.edits.meta.json`,
    `${noteId}.line-attribution.json`,
  ];
  for (const file of legacyFiles) {
    await safeUnlink(path.join(notesDir, file));
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // File doesn't exist
  }
}

async function safeRm(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Directory doesn't exist
  }
}

/**
 * Migrate all notes in a workspace to the new format
 */
export async function migrateWorkspaceNotes(
  workspaceId: WorkspaceId,
): Promise<WorkspaceMigrationResult> {
  const notesDir = WorkspaceConfig.paths.notes(workspaceId);
  const repository = new FolderBasedNotesRepository();
  const results: NoteMigrationResult[] = [];

  let migratedNotes = 0;
  let skippedNotes = 0;
  let failedNotes = 0;

  try {
    await fs.mkdir(notesDir, { recursive: true });
    const entries = await fs.readdir(notesDir, { withFileTypes: true });

    // Find all notes needing migration
    // Use a Map to deduplicate by noteId (same note can appear as both .md and .json)
    const toMigrateMap = new Map<
      string,
      { noteId: NoteId; type: 'json' | 'folder' | 'old-flat' | 'recovery' }
    >();
    const checkedNoteIds = new Set<string>();

    for (const entry of entries) {
      let noteId: string | null = null;

      if (entry.isFile() && entry.name.endsWith('.md')) {
        // Check if .md file needs migration (old-flat format)
        noteId = entry.name.replace('.md', '');
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.json') &&
        !entry.name.endsWith('.comments.json') &&
        !entry.name.endsWith('.edits.meta.json')
      ) {
        noteId = entry.name.replace('.json', '');
      } else if (
        entry.isDirectory() &&
        entry.name !== STORAGE_FILES.META_DIR &&
        entry.name !== '.git'
      ) {
        noteId = entry.name;
      }

      // Skip if we've already checked this noteId (deduplication)
      if (noteId && !checkedNoteIds.has(noteId)) {
        checkedNoteIds.add(noteId);
        const migrationNeeded = await needsMigration(notesDir, noteId);
        if (migrationNeeded) {
          toMigrateMap.set(noteId, { noteId: noteId as NoteId, type: migrationNeeded });
        } else {
          skippedNotes++;
        }
      }
    }

    const toMigrate = Array.from(toMigrateMap.values());

    // Migrate each note
    for (const { noteId, type } of toMigrate) {
      const result = await migrateNote(workspaceId, noteId, type, repository);
      results.push(result);
      if (result.success) {
        migratedNotes++;
      } else {
        failedNotes++;
      }
    }

    logger.info('Workspace migration complete', {
      workspaceId,
      migratedNotes,
      skippedNotes,
      failedNotes,
    });
  } catch (error) {
    logger.error('Workspace migration failed', error as Error, { workspaceId });
  }

  return {
    workspaceId,
    totalNotes: migratedNotes + skippedNotes + failedNotes,
    migratedNotes,
    skippedNotes,
    failedNotes,
    results,
  };
}

/**
 * Check if a workspace needs migration
 */
export async function workspaceNeedsMigration(workspaceId: WorkspaceId): Promise<boolean> {
  const notesDir = WorkspaceConfig.paths.notes(workspaceId);

  try {
    const entries = await fs.readdir(notesDir, { withFileTypes: true });
    for (const entry of entries) {
      let noteId: string | null = null;

      if (entry.isFile() && entry.name.endsWith('.md')) {
        noteId = entry.name.replace('.md', '');
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.json') &&
        !entry.name.endsWith('.comments.json') &&
        !entry.name.endsWith('.edits.meta.json')
      ) {
        noteId = entry.name.replace('.json', '');
      } else if (
        entry.isDirectory() &&
        entry.name !== STORAGE_FILES.META_DIR &&
        entry.name !== '.git'
      ) {
        noteId = entry.name;
      }

      if (noteId && (await needsMigration(notesDir, noteId))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
