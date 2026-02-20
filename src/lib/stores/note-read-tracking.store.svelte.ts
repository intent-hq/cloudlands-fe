/**
 * Note Read Tracking Store
 *
 * Frontend store for tracking when notes were last read by the user.
 * Uses IPC to communicate with the backend UserActivityService.
 *
 * OPTIMIZATION: This store handles debouncing and deduplication of computeUnreadNotes
 * calls. Components should NOT call computeUnreadNotes directly in effects - instead,
 * use refreshUnreadNotes which handles deduplication automatically.
 *
 * KEY FEATURE: Tracks which note is currently being viewed. Notes that are currently
 * being viewed will NOT be marked as unread when they receive updates. This prevents
 * the common issue of a note being marked "unread" while the user is actively looking at it.
 */

import { invoke } from '$lib/electron-bridge';
import { USER_ACTIVITY_CHANNELS } from '$shared/ipc/channels';
import type { NoteReadRecord } from '$shared/types/user-activity.types';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('NoteReadTrackingStore');

// Debounce delay in milliseconds
const COMPUTE_DEBOUNCE_MS = 50;

interface NoteReadState {
  // Map of noteId -> read record
  readRecords: Map<string, NoteReadRecord>;
  // Set of noteIds that have unread changes
  unreadNoteIds: Set<string>;
  // Loading state
  isLoading: boolean;
  // Currently viewed note ID (main panel is showing this note)
  currentlyViewedNoteId: string | null;
}

function createNoteReadTrackingStore() {
  // State
  const state = $state<NoteReadState>({
    readRecords: new Map(),
    unreadNoteIds: new Set(),
    isLoading: false,
    currentlyViewedNoteId: null,
  });

  // Current workspace ID
  let currentWorkspaceId: string | null = null;

  // Request ID for cancellation - increment to invalidate pending requests
  let computeRequestId = 0;

  // Debounce timer for computeUnreadNotes
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Pending refresh params (for debounced execution)
  let pendingRefreshParams: {
    workspaceId: string;
    notes: Array<{ id: string; updatedAt: string; createdAt?: string }>;
  } | null = null;

  // Listeners for unread state changes
  const listeners = new Set<(unreadIds: Set<string>) => void>();

  /**
   * Notify all listeners of unread state changes
   */
  function notifyListeners(): void {
    for (const listener of listeners) {
      try {
        listener(state.unreadNoteIds);
      } catch (err) {
        logger.error('Error in unread listener', err);
      }
    }
  }

  /**
   * Mark a note as currently being viewed (main panel is showing this note).
   * This clears the unread status for that note and prevents it from being
   * marked as unread while the user is viewing it.
   */
  function markAsViewed(noteId: string): void {
    if (!noteId) return;

    state.currentlyViewedNoteId = noteId;

    // Clear unread status for this note
    if (state.unreadNoteIds.has(noteId)) {
      const newUnread = new Set(state.unreadNoteIds);
      newUnread.delete(noteId);
      state.unreadNoteIds = newUnread;
      logger.debug('Note marked as viewed, cleared unread status', { noteId });
      notifyListeners();
    }
  }

  /**
   * Mark that no note is currently being viewed (e.g., panel closed or showing different content).
   */
  function clearCurrentlyViewed(): void {
    if (state.currentlyViewedNoteId) {
      logger.debug('Cleared currently viewed note', { noteId: state.currentlyViewedNoteId });
      state.currentlyViewedNoteId = null;
    }
  }

  /**
   * Get the currently viewed note ID
   */
  function getCurrentlyViewedNoteId(): string | null {
    return state.currentlyViewedNoteId;
  }

  /**
   * Check if a specific note is currently being viewed
   */
  function isCurrentlyViewing(noteId: string): boolean {
    return state.currentlyViewedNoteId === noteId;
  }

  /**
   * Mark a note as read
   */
  async function markNoteRead(workspaceId: string, noteId: string): Promise<void> {
    // Invalidate any pending computeUnreadNotes requests
    // This ensures that stale results don't overwrite our optimistic update
    computeRequestId++;

    // Optimistically update local state IMMEDIATELY before async call
    // This prevents race conditions with computeUnreadNotes
    const now = new Date().toISOString();
    const existing = state.readRecords.get(noteId);
    state.readRecords = new Map(state.readRecords).set(noteId, {
      lastReadAt: now,
      readCount: (existing?.readCount ?? 0) + 1,
    });

    // Remove from unread set immediately and notify listeners
    if (state.unreadNoteIds.has(noteId)) {
      const newUnread = new Set(state.unreadNoteIds);
      newUnread.delete(noteId);
      state.unreadNoteIds = newUnread;
      notifyListeners();
    }

    try {
      const result = await invoke<{ success: boolean; error?: string }>(
        USER_ACTIVITY_CHANNELS.MARK_NOTE_READ,
        { workspaceId, noteId },
      );

      if (!result.success) {
        logger.error('Failed to mark note as read on backend', { error: result.error });
      }
    } catch (error) {
      logger.error('Error marking note as read', { error });
    }
  }

  /**
   * Get read status for a specific note
   */
  async function getNoteReadStatus(
    workspaceId: string,
    noteId: string,
  ): Promise<NoteReadRecord | null> {
    // Check cache first
    const cached = state.readRecords.get(noteId);
    if (cached) {
      return cached;
    }

    try {
      const result = await invoke<{
        success: boolean;
        data?: NoteReadRecord | null;
        error?: string;
      }>(USER_ACTIVITY_CHANNELS.GET_NOTE_READ_STATUS, { workspaceId, noteId });

      if (!result.success) {
        logger.error('Failed to get note read status', { error: result.error });
        return null;
      }

      // Cache the result
      if (result.data) {
        state.readRecords = new Map(state.readRecords).set(noteId, result.data);
      }

      return result.data ?? null;
    } catch (error) {
      logger.error('Error getting note read status', { error });
      return null;
    }
  }

  /**
   * Compute which notes have unread changes.
   * Notes are only considered unread if they've been updated after creation.
   *
   * IMPORTANT: Notes that are currently being viewed are excluded from the unread set.
   * This prevents the common issue of a note being marked "unread" while the user
   * is actively looking at it.
   */
  async function computeUnreadNotes(
    workspaceId: string,
    notes: Array<{ id: string; updatedAt: string; createdAt?: string }>,
  ): Promise<string[]> {
    // Capture the current request ID to detect if this request becomes stale
    const thisRequestId = ++computeRequestId;

    state.isLoading = true;
    currentWorkspaceId = workspaceId;

    try {
      const result = await invoke<{ success: boolean; data?: string[]; error?: string }>(
        USER_ACTIVITY_CHANNELS.GET_UNREAD_NOTE_IDS,
        { workspaceId, notes },
      );

      // Check if this request is stale (a newer request was made, or markNoteRead was called)
      if (thisRequestId !== computeRequestId) {
        logger.debug('Ignoring stale computeUnreadNotes response', {
          thisRequestId,
          currentRequestId: computeRequestId,
        });
        return [];
      }

      if (!result.success) {
        logger.error('Failed to compute unread notes', { error: result.error });
        return [];
      }

      const unreadIdsFromBackend = result.data ?? [];

      // Get the currently viewed note to exclude from unread set
      const currentlyViewedId = state.currentlyViewedNoteId;

      // Filter out notes that have been locally marked as read OR are currently being viewed
      // This respects optimistic updates from markNoteRead and the currently-viewing state
      const notesMap = new Map(notes.map((n) => [n.id, n.updatedAt]));
      const filteredUnreadIds = unreadIdsFromBackend.filter((noteId) => {
        // Never mark the currently viewed note as unread
        if (currentlyViewedId && noteId === currentlyViewedId) {
          logger.debug('Excluding currently viewed note from unread set', { noteId });
          return false;
        }

        const localReadRecord = state.readRecords.get(noteId);
        if (!localReadRecord) return true; // Not locally read, keep as unread

        const noteUpdatedAt = notesMap.get(noteId);
        if (!noteUpdatedAt) return true; // Note not in provided list, keep as unread

        // If local read is after note update, it's been read
        const localReadTime = new Date(localReadRecord.lastReadAt).getTime();
        const noteUpdateTime = new Date(noteUpdatedAt).getTime();
        return noteUpdateTime > localReadTime; // Only unread if note was updated after our last read
      });

      const prevUnreadSet = state.unreadNoteIds;
      const newUnreadSet = new Set(filteredUnreadIds);
      state.unreadNoteIds = newUnreadSet;

      logger.debug('Computed unread notes', {
        workspaceId,
        totalNotes: notes.length,
        unreadFromBackend: unreadIdsFromBackend.length,
        unreadAfterLocalFilter: filteredUnreadIds.length,
        currentlyViewedId,
      });

      // Notify listeners if unread state changed (compare actual sets, not just size)
      const setsAreEqual =
        prevUnreadSet.size === newUnreadSet.size &&
        [...prevUnreadSet].every((id) => newUnreadSet.has(id));
      if (!setsAreEqual) {
        notifyListeners();
      }

      return filteredUnreadIds;
    } catch (error) {
      logger.error('Error computing unread notes', { error });
      return [];
    } finally {
      // Only clear loading state if this is still the current request
      if (thisRequestId === computeRequestId) {
        state.isLoading = false;
      }
    }
  }

  /**
   * Check if a specific note has unread changes
   */
  function hasUnreadChanges(noteId: string): boolean {
    return state.unreadNoteIds.has(noteId);
  }

  /**
   * Clear cached state (e.g., when switching workspaces)
   */
  function clearCache(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pendingRefreshParams = null;
    state.readRecords = new Map();
    state.unreadNoteIds = new Set();
    state.currentlyViewedNoteId = null;
    currentWorkspaceId = null;
    notifyListeners();
  }

  /**
   * Clear unread status for a specific note (e.g., when note is deleted)
   */
  function clearUnread(noteId: string): void {
    if (state.unreadNoteIds.has(noteId)) {
      const newUnread = new Set(state.unreadNoteIds);
      newUnread.delete(noteId);
      state.unreadNoteIds = newUnread;
      notifyListeners();
    }
    if (state.currentlyViewedNoteId === noteId) {
      state.currentlyViewedNoteId = null;
    }
  }

  /**
   * Subscribe to unread state changes.
   * Returns an unsubscribe function.
   */
  function subscribe(listener: (unreadIds: Set<string>) => void): () => void {
    listeners.add(listener);
    // Immediately notify with current state
    listener(state.unreadNoteIds);
    return () => listeners.delete(listener);
  }

  /**
   * Get the count of notes with unread changes
   */
  function getUnreadCount(): number {
    return state.unreadNoteIds.size;
  }

  /**
   * Debounced refresh of unread notes.
   * This is the preferred method for components to trigger a refresh.
   * Multiple rapid calls will be coalesced into a single backend request.
   *
   * Components should call this when notes change, rather than calling
   * computeUnreadNotes directly.
   *
   * Note: When switching workspaces, the unread set is cleared immediately
   * to prevent stale indicators from the previous workspace showing briefly.
   */
  function refreshUnreadNotes(
    workspaceId: string,
    notes: Array<{ id: string; updatedAt: string; createdAt?: string }>,
  ): void {
    // If workspace changed, clear stale data immediately to prevent wrong indicators
    if (currentWorkspaceId !== null && currentWorkspaceId !== workspaceId) {
      logger.debug('Workspace changed, clearing stale unread data', {
        from: currentWorkspaceId,
        to: workspaceId,
      });
      state.unreadNoteIds = new Set();
      state.readRecords = new Map();
      state.currentlyViewedNoteId = null;
      notifyListeners();
    }

    // Store params for debounced execution
    pendingRefreshParams = { workspaceId, notes };

    // Clear existing timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Set new debounced timer
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (pendingRefreshParams) {
        const params = pendingRefreshParams;
        pendingRefreshParams = null;
        // Fire and forget - we don't need the result, state updates reactively
        computeUnreadNotes(params.workspaceId, params.notes);
      }
    }, COMPUTE_DEBOUNCE_MS);
  }

  return {
    // Getters
    get readRecords() {
      return state.readRecords;
    },
    get unreadNoteIds() {
      return state.unreadNoteIds;
    },
    get isLoading() {
      return state.isLoading;
    },
    get currentWorkspaceId() {
      return currentWorkspaceId;
    },
    get currentlyViewedNoteId() {
      return state.currentlyViewedNoteId;
    },

    // Actions
    markNoteRead,
    getNoteReadStatus,
    computeUnreadNotes,
    refreshUnreadNotes,
    hasUnreadChanges,
    clearCache,

    // Currently viewing state
    markAsViewed,
    clearCurrentlyViewed,
    getCurrentlyViewedNoteId,
    isCurrentlyViewing,

    // Subscription
    subscribe,
    getUnreadCount,
    clearUnread,
  };
}

export const noteReadTrackingStore = createNoteReadTrackingStore();
