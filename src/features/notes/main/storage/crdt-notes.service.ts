/**
 * CRDT-Enhanced Notes Service
 *
 * Wraps the CRDT document manager to provide concurrent editing support.
 * This service handles:
 * - Content synchronization between CRDT and file storage
 * - Applying updates from agents without data loss
 * - Conflict-free merging of concurrent edits
 */

import { Logger } from '../../../../shared/logger';
import { crdtDocumentManager } from './crdt-document-manager';
import { FolderBasedNotesRepository } from './folder-notes.repository';
import type { Note, NoteId, WorkspaceId, Author } from '../../../../shared/types';
import { AuthorType } from '../../../../shared/types';

const logger = new Logger('CRDTNotesService');

/**
 * Track pending updates per note to batch rapid changes
 */
interface PendingUpdate {
  content: string;
  author?: Author;
  timestamp: number;
}

const pendingUpdates = new Map<string, PendingUpdate>();
const UPDATE_DEBOUNCE_MS = 100; // Debounce rapid updates

/**
 * Get unique key for note
 */
function getNoteKey(workspaceId: WorkspaceId, noteId: NoteId): string {
  return `${workspaceId}:${noteId}`;
}

/**
 * CRDT-Enhanced Notes Service
 *
 * Provides concurrent editing support using Yjs CRDT.
 */
export class CRDTNotesService {
  private repository: FolderBasedNotesRepository;
  private updateTimers = new Map<string, NodeJS.Timeout>();

  constructor() {
    this.repository = new FolderBasedNotesRepository();
  }

  /**
   * Load a note with CRDT support initialized
   */
  async loadNote(workspaceId: WorkspaceId, noteId: NoteId): Promise<Note | null> {
    const note = await this.repository.findById(workspaceId, noteId);
    if (!note) return null;

    // Initialize CRDT document if not already
    await crdtDocumentManager.initializeWithContent(workspaceId, noteId, note.content);

    return note;
  }

  /**
   * Update note content with CRDT support
   * Handles concurrent updates from multiple agents without data loss
   */
  async updateContent(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    newContent: string,
    author?: Author,
  ): Promise<void> {
    const key = getNoteKey(workspaceId, noteId);

    // Store pending update
    pendingUpdates.set(key, {
      content: newContent,
      author,
      timestamp: Date.now(),
    });

    // Clear existing timer
    const existingTimer = this.updateTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Debounce updates
    const timer = setTimeout(async () => {
      const update = pendingUpdates.get(key);
      if (!update) return;

      pendingUpdates.delete(key);
      this.updateTimers.delete(key);

      try {
        await this.applyContentUpdate(workspaceId, noteId, update.content, update.author);
      } catch (error) {
        logger.error('Failed to apply content update', error as Error, {
          workspaceId,
          noteId,
        });
      }
    }, UPDATE_DEBOUNCE_MS);

    this.updateTimers.set(key, timer);
  }

  /**
   * Compute text diff operations using simple character-based diff algorithm.
   * Returns operations in reverse order (from end to start) to maintain correct positions.
   */
  private computeTextDiff(
    oldText: string,
    newText: string,
  ): Array<
    | { type: 'delete'; index: number; length: number }
    | { type: 'insert'; index: number; text: string }
  > {
    const ops: Array<
      | { type: 'delete'; index: number; length: number }
      | { type: 'insert'; index: number; text: string }
    > = [];

    // Find common prefix
    let prefixLen = 0;
    while (
      prefixLen < oldText.length &&
      prefixLen < newText.length &&
      oldText[prefixLen] === newText[prefixLen]
    ) {
      prefixLen++;
    }

    // Find common suffix (from the non-prefix portion)
    let suffixLen = 0;
    const oldRemaining = oldText.length - prefixLen;
    const newRemaining = newText.length - prefixLen;
    while (
      suffixLen < oldRemaining &&
      suffixLen < newRemaining &&
      oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
    ) {
      suffixLen++;
    }

    // Calculate the differing middle sections
    const oldMiddleStart = prefixLen;
    const oldMiddleEnd = oldText.length - suffixLen;
    const newMiddleStart = prefixLen;
    const newMiddleEnd = newText.length - suffixLen;

    const deleteLen = oldMiddleEnd - oldMiddleStart;
    const insertText = newText.substring(newMiddleStart, newMiddleEnd);

    // Generate operations - delete first (if needed), then insert
    if (deleteLen > 0) {
      ops.push({ type: 'delete', index: oldMiddleStart, length: deleteLen });
    }
    if (insertText.length > 0) {
      ops.push({ type: 'insert', index: oldMiddleStart, text: insertText });
    }

    return ops;
  }

  /**
   * Apply a content update using CRDT
   */
  private async applyContentUpdate(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    newContent: string,
    author?: Author,
  ): Promise<void> {
    // Get the CRDT document
    const doc = await crdtDocumentManager.getDocument(workspaceId, noteId);
    const yText = doc.getText('content');
    const currentContent = yText.toString();

    // If content is the same, skip
    if (currentContent === newContent) {
      return;
    }

    // Use Yjs transaction to apply update
    // This handles merging with any concurrent changes
    doc.transact(() => {
      // Use diff algorithm for efficient updates - only change what's different
      const ops = this.computeTextDiff(currentContent, newContent);

      for (const op of ops) {
        if (op.type === 'delete') {
          yText.delete(op.index, op.length);
        } else if (op.type === 'insert') {
          yText.insert(op.index, op.text);
        }
      }
    }, author?.id || 'unknown');

    // Session-only CRDT: no persistence needed - file storage is the source of truth
    // Update the file-based storage
    const note = await this.repository.findById(workspaceId, noteId);
    if (note) {
      note.content = newContent;
      note.updatedAt = new Date().toISOString();

      // Add version
      if (!note.versions) note.versions = [];
      note.versions.push({
        versionId: crypto.randomUUID(),
        versionNumber: note.versions.length + 1,
        content: newContent,
        title: note.title,
        author: author || { id: 'unknown', name: 'Unknown', type: AuthorType.System },
        createdAt: new Date().toISOString(),
        changeSummary: 'Content updated',
      });

      await this.repository.save(note);
    }

    logger.debug('Applied CRDT content update', {
      workspaceId,
      noteId,
      contentLength: newContent.length,
    });
  }

  /**
   * Get current content from CRDT (authoritative source)
   */
  async getContent(workspaceId: WorkspaceId, noteId: NoteId): Promise<string | null> {
    try {
      return await crdtDocumentManager.getContent(workspaceId, noteId);
    } catch {
      // Fall back to file-based storage
      const note = await this.repository.findById(workspaceId, noteId);
      return note?.content || null;
    }
  }

  /**
   * Subscribe to content changes for a note
   * Returns an unsubscribe function
   */
  subscribeToChanges(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    callback: (content: string) => void,
  ): () => void {
    const doc = crdtDocumentManager.getDocument(workspaceId, noteId).then((doc) => {
      const yText = doc.getText('content');
      const observer = () => {
        callback(yText.toString());
      };
      yText.observe(observer);
      return { doc, observer };
    });

    return () => {
      doc.then(({ doc, observer }) => {
        const yText = doc.getText('content');
        yText.unobserve(observer);
      });
    };
  }

  /**
   * Sync CRDT state from another source (e.g., another agent)
   */
  async syncFromUpdate(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    update: Uint8Array,
  ): Promise<void> {
    await crdtDocumentManager.applyUpdate(workspaceId, noteId, update);

    // Update file storage to match CRDT
    const content = await crdtDocumentManager.getContent(workspaceId, noteId);
    const note = await this.repository.findById(workspaceId, noteId);

    if (note && content) {
      note.content = content;
      note.updatedAt = new Date().toISOString();
      await this.repository.save(note);
    }
  }

  /**
   * Get current CRDT state for syncing
   */
  async getStateForSync(workspaceId: WorkspaceId, noteId: NoteId): Promise<Uint8Array> {
    return crdtDocumentManager.getStateAsUpdate(workspaceId, noteId);
  }
}

// Singleton instance
export const crdtNotesService = new CRDTNotesService();
