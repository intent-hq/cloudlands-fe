/**
 * CRDT Document Manager
 *
 * Manages Yjs documents for concurrent note editing.
 * Each note has a Yjs document that can be edited by multiple agents simultaneously.
 *
 * Session-only approach:
 * - CRDT initialized from .md content when note is opened
 * - CRDT handles concurrent edits during active session
 * - On save/close, .md file is updated from CRDT content
 * - CRDT state is NOT persisted long-term (or auto-cleaned after 24h)
 *
 * This avoids CRDT storage overhead while still enabling concurrent editing.
 */

import { promises as fs } from 'fs';
import * as Y from 'yjs';
import { Logger } from '../../../../shared/logger';
import { getNoteStoragePaths } from './note-storage-paths';
import type { NoteId, WorkspaceId } from '../../../../shared/types';

const logger = new Logger('CRDTDocumentManager');

/**
 * Session state for a CRDT document
 */
interface CRDTSession {
  doc: Y.Doc;
  lastAccess: Date;
  isDirty: boolean;
}

/**
 * In-memory cache of Yjs documents (session-only)
 */
const documentCache = new Map<string, CRDTSession>();

/**
 * Session timeout: auto-cleanup after 24 hours of inactivity
 */
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * Get the cache key for a note
 */
function getCacheKey(workspaceId: WorkspaceId, noteId: NoteId): string {
  return `${workspaceId}:${noteId}`;
}

/**
 * CRDT Document Manager
 *
 * Manages Yjs documents for notes, enabling concurrent editing without conflicts.
 * Uses session-only approach: CRDT is initialized from .md content and not persisted long-term.
 */
export class CRDTDocumentManager {
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Start periodic cleanup of stale sessions
   */
  private startCleanupInterval(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupStaleSessions();
      },
      60 * 60 * 1000,
    );
  }

  /**
   * Clean up sessions that haven't been accessed in 24 hours
   */
  private cleanupStaleSessions(): void {
    const now = new Date();
    const keysToDelete: string[] = [];

    for (const [key, session] of documentCache.entries()) {
      const elapsed = now.getTime() - session.lastAccess.getTime();
      if (elapsed > SESSION_TIMEOUT_MS) {
        session.doc.destroy();
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      documentCache.delete(key);
    }

    if (keysToDelete.length > 0) {
      logger.debug('Cleaned up stale CRDT sessions', { count: keysToDelete.length });
    }
  }

  /**
   * Get or create a Yjs document for a note
   * If no session exists, creates an empty document (must be initialized with content)
   */
  async getDocument(workspaceId: WorkspaceId, noteId: NoteId): Promise<Y.Doc> {
    const cacheKey = getCacheKey(workspaceId, noteId);

    // Return cached document if available
    const existing = documentCache.get(cacheKey);
    if (existing) {
      existing.lastAccess = new Date();
      return existing.doc;
    }

    // Create new document (session-only, no persistence loading)
    const doc = new Y.Doc();

    documentCache.set(cacheKey, {
      doc,
      lastAccess: new Date(),
      isDirty: false,
    });

    logger.debug('Created new CRDT session', { workspaceId, noteId });
    return doc;
  }

  /**
   * Initialize a document with markdown content
   * Called when opening a note - loads content from .md file into CRDT
   */
  async initializeWithContent(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    markdownContent: string,
  ): Promise<Y.Doc> {
    const cacheKey = getCacheKey(workspaceId, noteId);
    const doc = await this.getDocument(workspaceId, noteId);
    const yText = doc.getText('content');

    // Replace content (handles both empty and existing)
    doc.transact(() => {
      if (yText.length > 0) {
        yText.delete(0, yText.length);
      }
      yText.insert(0, markdownContent);
    });

    // Mark as clean since we just loaded from disk
    const session = documentCache.get(cacheKey);
    if (session) {
      session.isDirty = false;
    }

    logger.debug('Initialized CRDT document with content', {
      workspaceId,
      noteId,
      contentLength: markdownContent.length,
    });

    return doc;
  }

  /**
   * Apply an update to a document
   * Used when receiving edits from agents
   */
  async applyUpdate(workspaceId: WorkspaceId, noteId: NoteId, update: Uint8Array): Promise<void> {
    const cacheKey = getCacheKey(workspaceId, noteId);
    const doc = await this.getDocument(workspaceId, noteId);
    Y.applyUpdate(doc, update);

    // Mark as dirty
    const session = documentCache.get(cacheKey);
    if (session) {
      session.isDirty = true;
    }

    logger.debug('Applied CRDT update', { workspaceId, noteId, updateSize: update.length });
  }

  /**
   * Get the current content as markdown
   */
  async getContent(workspaceId: WorkspaceId, noteId: NoteId): Promise<string> {
    const doc = await this.getDocument(workspaceId, noteId);
    const yText = doc.getText('content');
    return yText.toString();
  }

  /**
   * Check if the document has unsaved changes
   */
  isDirty(workspaceId: WorkspaceId, noteId: NoteId): boolean {
    const cacheKey = getCacheKey(workspaceId, noteId);
    const session = documentCache.get(cacheKey);
    return session?.isDirty ?? false;
  }

  /**
   * Update content with new markdown
   * Marks document as dirty (needs to be saved to .md file)
   */
  async updateContent(workspaceId: WorkspaceId, noteId: NoteId, newContent: string): Promise<void> {
    const cacheKey = getCacheKey(workspaceId, noteId);
    const doc = await this.getDocument(workspaceId, noteId);
    const yText = doc.getText('content');

    doc.transact(() => {
      // Clear and replace (simple approach)
      yText.delete(0, yText.length);
      yText.insert(0, newContent);
    });

    // Mark as dirty
    const session = documentCache.get(cacheKey);
    if (session) {
      session.isDirty = true;
    }
  }

  /**
   * Mark document as clean (after saving to .md file)
   */
  markClean(workspaceId: WorkspaceId, noteId: NoteId): void {
    const cacheKey = getCacheKey(workspaceId, noteId);
    const session = documentCache.get(cacheKey);
    if (session) {
      session.isDirty = false;
    }
  }

  /**
   * Get the full state as an update (for syncing)
   */
  async getStateAsUpdate(workspaceId: WorkspaceId, noteId: NoteId): Promise<Uint8Array> {
    const doc = await this.getDocument(workspaceId, noteId);
    return Y.encodeStateAsUpdate(doc);
  }

  /**
   * Remove a document from cache (session-only, no persistence)
   */
  async removeDocument(workspaceId: WorkspaceId, noteId: NoteId): Promise<void> {
    const cacheKey = getCacheKey(workspaceId, noteId);
    const session = documentCache.get(cacheKey);

    if (session) {
      session.doc.destroy();
      documentCache.delete(cacheKey);
    }

    // Also clean up any old persisted CRDT files
    const paths = getNoteStoragePaths(workspaceId, noteId);
    try {
      await fs.unlink(paths.crdtFile);
    } catch {
      // File doesn't exist
    }
  }

  /**
   * Check if a session exists for a note
   */
  hasSession(workspaceId: WorkspaceId, noteId: NoteId): boolean {
    const cacheKey = getCacheKey(workspaceId, noteId);
    return documentCache.has(cacheKey);
  }

  /**
   * Clear all cached documents
   */
  clearCache(): void {
    for (const session of documentCache.values()) {
      session.doc.destroy();
    }
    documentCache.clear();
  }

  /**
   * Drop CRDT sessions for workspaces that no longer have an open window/tab.
   */
  trimCachesToOpenWorkspaces(openWorkspaceIds: Iterable<string>): void {
    const openWorkspaceIdSet = new Set(openWorkspaceIds);

    for (const [key, session] of documentCache.entries()) {
      const separatorIndex = key.indexOf(':');
      const workspaceId = separatorIndex >= 0 ? key.slice(0, separatorIndex) : key;
      if (openWorkspaceIdSet.has(workspaceId)) continue;

      session.doc.destroy();
      documentCache.delete(key);
    }
  }

  /**
   * Stop the cleanup interval (for testing/shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Singleton instance
export const crdtDocumentManager = new CRDTDocumentManager();
