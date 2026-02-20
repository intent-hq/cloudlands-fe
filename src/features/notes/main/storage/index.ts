/**
 * Note Storage Module
 *
 * Clean storage architecture for notes:
 * - {noteId}.md at notes/ root with YAML frontmatter (human-readable)
 * - .meta/{noteId}.versions.jsonl for version history (append-only, cloud-sync friendly)
 * - .meta/{noteId}.comments.json for comments
 * - .meta/.trash/ for soft-deleted notes (30-day retention)
 * - Session-only CRDT support via Yjs for concurrent editing
 */

export * from './note-storage.types';
export * from './note-storage-paths';
export { FolderBasedNotesRepository } from './folder-notes.repository';
export { CRDTDocumentManager, crdtDocumentManager } from './crdt-document-manager';
export {
  migrateWorkspaceNotes,
  workspaceNeedsMigration,
  type NoteMigrationResult,
  type WorkspaceMigrationResult,
} from './note-migration';
export { CRDTNotesService, crdtNotesService } from './crdt-notes.service';
export * from './frontmatter';
export * from './version.service';
export * from './trash.service';
export * from './version-manager';
