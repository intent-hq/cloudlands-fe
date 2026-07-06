/**
 * Note Storage Module
 *
 * Retained (P3-3) subset of the legacy flat-note storage — kept alive solely
 * because `line-attribution.service.ts` still depends on it. All CRDT,
 * migration, notes-service, and IPC wiring were retired in D6.
 */

export * from './note-storage.types';
export * from './note-storage-paths';
export { FolderBasedNotesRepository } from './folder-notes.repository';
export * from './frontmatter';
export * from './version.service';
export * from './trash.service';
export * from './version-manager';
