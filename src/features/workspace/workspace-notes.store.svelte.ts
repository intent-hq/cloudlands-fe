/**
 * Workspace Notes Store
 *
 * Manages notes across multiple workspaces for the homepage.
 * Provides batch loading and real-time updates via event subscription.
 */

import type { Note, WorkspaceId, NoteId, TaskStatus } from '$shared/types';
import { Logger } from '../../shared/logger';
import { notesClient } from '$features/notes/notes.client';
import { listenSync, extractEventData, isWorkspaceEvent } from '$lib/electron-bridge';

const logger = new Logger('WorkspaceNotesStore');

// Track unsubscribe functions for cleanup
type UnsubscribeFn = () => void;

class WorkspaceNotesStore {
  // State: Record of workspaceId -> notes array (using Record for better Svelte 5 reactivity)
  // Exposed directly as a public property for Svelte 5 reactivity to work properly
  notesByWorkspace: Record<string, Note[]> = $state({});
  #loading = $state(false);
  #error: string | null = $state(null);
  #initialized = $state(false);
  #eventUnsubscribers: UnsubscribeFn[] = [];

  // Getters
  get loading() {
    return this.#loading;
  }
  get error() {
    return this.#error;
  }
  get initialized() {
    return this.#initialized;
  }

  constructor() {
    // Setup event listeners synchronously for proper cleanup
    this.setupEventListeners();
  }

  /**
   * Get notes for a specific workspace
   * Note: For reactive access in Svelte 5 components, access notesByWorkspace[id] directly
   */
  getNotes(workspaceId: WorkspaceId | string): Note[] {
    return this.notesByWorkspace[workspaceId as string] ?? [];
  }

  /**
   * Check if we have notes loaded for a workspace
   */
  hasNotes(workspaceId: WorkspaceId | string): boolean {
    return workspaceId in this.notesByWorkspace;
  }

  /**
   * Load notes for multiple workspaces at once
   */
  async loadForWorkspaces(workspaceIds: (WorkspaceId | string)[]): Promise<void> {
    if (workspaceIds.length === 0) return;

    this.#loading = true;
    this.#error = null;

    try {
      const result = await notesClient.batchList(workspaceIds as WorkspaceId[]);

      if (result.ok) {
        // Update the record with new data (spread to ensure reactivity)
        this.notesByWorkspace = {
          ...this.notesByWorkspace,
          ...result.data,
        };
        this.#initialized = true;
        logger.info('Loaded notes for workspaces', {
          count: workspaceIds.length,
          totalNotes: Object.values(result.data).reduce((sum, notes) => sum + notes.length, 0),
        });
      } else {
        this.#error = result.error;
        logger.error('Failed to batch load notes', { error: result.error });
      }
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error loading notes', { error });
    } finally {
      this.#loading = false;
    }
  }

  /**
   * Setup event listeners for real-time updates
   * Uses listenSync for synchronous cleanup - no race conditions on unmount
   */
  private setupEventListeners(): void {
    // Listen for task status changes
    this.#eventUnsubscribers.push(
      listenSync('task:status-changed', (event) => {
        const payload = (event as any).payload || event;
        this.handleTaskStatusChanged(payload);
      }),
    );

    // Listen for note creation
    this.#eventUnsubscribers.push(
      listenSync('note:created', (event) => {
        const payload = (event as any).payload || event;
        this.handleNoteCreated(payload);
      }),
    );

    // Listen for note deletion
    this.#eventUnsubscribers.push(
      listenSync('note:deleted', (event) => {
        const payload = (event as any).payload || event;
        this.handleNoteDeleted(payload);
      }),
    );

    // Listen for note updates (title, content, etc.)
    this.#eventUnsubscribers.push(
      listenSync('note:updated', (event) => {
        const payload = (event as any).payload || event;
        this.handleNoteUpdated(payload);
      }),
    );

    logger.info('Event listeners setup complete');
  }

  /**
   * Handle task status change event
   * Payload can be: { workspaceId, noteId, newStatus } or { workspaceId, data: { noteId, newStatus } }
   */
  private handleTaskStatusChanged(payload: any): void {
    const workspaceId = payload.workspaceId;
    const noteId = payload.noteId || payload.data?.noteId;
    const newStatus = payload.newStatus || payload.data?.newStatus;

    if (!workspaceId || !noteId || !newStatus) return;

    const notes = this.notesByWorkspace[workspaceId];
    if (!notes) return;

    // Find and update the note
    const noteIndex = notes.findIndex((n) => n.id === noteId);
    if (noteIndex === -1) return;

    // Create new array to trigger reactivity
    const updatedNotes = [...notes];
    const note = { ...updatedNotes[noteIndex] };

    // Update task status in metadata
    if (note.metadata?.task) {
      note.metadata = {
        ...note.metadata,
        task: { ...note.metadata.task, status: newStatus },
      };
    }

    updatedNotes[noteIndex] = note;

    // Update the record (spread to trigger reactivity)
    this.notesByWorkspace = {
      ...this.notesByWorkspace,
      [workspaceId]: updatedNotes,
    };

    logger.debug('Task status updated', { workspaceId, noteId, newStatus });
  }

  /**
   * Handle note created event
   * Payload can be: { workspaceId, note } or { workspaceId, noteId, note }
   */
  private handleNoteCreated(payload: any): void {
    const workspaceId = payload.workspaceId;
    const note = payload.note;

    if (!workspaceId || !note) return;
    if (!(workspaceId in this.notesByWorkspace)) return; // Only update if we're tracking this workspace

    const notes = this.notesByWorkspace[workspaceId] ?? [];
    this.notesByWorkspace = {
      ...this.notesByWorkspace,
      [workspaceId]: [...notes, note],
    };

    logger.debug('Note added', { workspaceId, noteId: note.id });
  }

  /**
   * Handle note deleted event
   * Payload can be: { workspaceId, noteId } or { workspaceId, data: { noteId } }
   */
  private handleNoteDeleted(payload: any): void {
    const workspaceId = payload.workspaceId;
    const noteId = payload.noteId || payload.data?.noteId;

    if (!workspaceId || !noteId) return;

    const notes = this.notesByWorkspace[workspaceId];
    if (!notes) return;

    this.notesByWorkspace = {
      ...this.notesByWorkspace,
      [workspaceId]: notes.filter((n) => n.id !== noteId),
    };

    logger.debug('Note removed', { workspaceId, noteId });
  }

  /**
   * Handle note updated event (for title, content changes)
   * Payload can be: { workspaceId, note } or { workspaceId, noteId, note }
   */
  private handleNoteUpdated(payload: any): void {
    const workspaceId = payload.workspaceId;
    const note = payload.note as Note | undefined;
    const noteId = payload.noteId || note?.id;

    if (!workspaceId || !noteId) return;

    const notes = this.notesByWorkspace[workspaceId];
    if (!notes) return;

    const noteIndex = notes.findIndex((n) => n.id === noteId);
    if (noteIndex === -1) return;

    // If we have a full note object, use it; otherwise just log the update
    if (note) {
      const updatedNotes = [...notes];
      updatedNotes[noteIndex] = note;

      this.notesByWorkspace = {
        ...this.notesByWorkspace,
        [workspaceId]: updatedNotes,
      };

      logger.debug('Note updated', { workspaceId, noteId });
    }
  }

  /**
   * Clear all cached notes (useful when navigating away from homepage)
   */
  clear(): void {
    this.notesByWorkspace = {};
    this.#initialized = false;
    logger.debug('Store cleared');
  }

  /**
   * Force refresh notes for specific workspaces
   */
  async refresh(workspaceIds: (WorkspaceId | string)[]): Promise<void> {
    // Remove existing entries to force reload
    const updated = { ...this.notesByWorkspace };
    for (const wsId of workspaceIds) {
      delete updated[wsId as string];
    }
    this.notesByWorkspace = updated;

    await this.loadForWorkspaces(workspaceIds);
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    for (const unsubscribe of this.#eventUnsubscribers) {
      unsubscribe();
    }
    this.#eventUnsubscribers = [];
    this.clear();
    logger.debug('Store destroyed');
  }
}

// Export singleton instance
export const workspaceNotesStore = new WorkspaceNotesStore();
