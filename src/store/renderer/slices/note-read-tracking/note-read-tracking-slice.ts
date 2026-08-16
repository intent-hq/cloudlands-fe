import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import type { NoteReadRecord } from "$shared/types/user-activity.types";

// ============================================================================
// Types
// ============================================================================

export type NoteReadTrackingState = {
  /** Map of noteId -> read record (serializable Record instead of Map) */
  readRecords: Record<string, NoteReadRecord>;
  /** Record of unread note IDs for O(1) membership checks/removal */
  unreadNoteIds: Record<string, boolean>;
  /** Loading state for compute operations */
  isLoading: boolean;
  /** Currently viewed note ID (main panel is showing this note) */
  currentlyViewedNoteId: string | null;
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: NoteReadTrackingState = {
  readRecords: {},
  unreadNoteIds: {},
  isLoading: false,
  currentlyViewedNoteId: null,
};

function withoutUnreadNoteId(
  unreadNoteIds: Record<string, boolean>,
  noteId: string
): Record<string, boolean> {
  if (!noteId || !unreadNoteIds[noteId]) {
    return unreadNoteIds;
  }

   
  const { [noteId]: _removed, ...rest } = unreadNoteIds;
  return rest;
}

/** Clear the currently viewed note */
export const clearCurrentlyViewed = createAction(
  "noteReadTracking/clearCurrentlyViewed"
);

/** Optimistically mark a note as read (reducer handles state, saga handles IPC) */
export const markNoteRead = createAction(
  "noteReadTracking/markNoteRead",
  (workspaceId: string, noteId: string) => ({
    workspaceId,
    noteId,
    now: new Date().toISOString(),
  }),
);

/** Trigger debounced refresh of unread notes */
export const refreshUnreadNotes = createAction<
  [workspaceId: string, notes: Array<{ id: string; updatedAt: string; createdAt?: string }>]
>("noteReadTracking/refreshUnreadNotes");

/** Clear all cached state (e.g., workspace switch) */
export const clearCache = createAction(
  "noteReadTracking/clearCache"
);

/** Request to create a new note (handled by saga) */
export const createNoteRequested = createAction<[wsId: string]>(
  "noteReadTracking/createNoteRequested"
);

// ============================================================================
// Reducer
// ============================================================================

export const noteReadTrackingReducer = createReducer<NoteReadTrackingState>(initialState);
noteReadTrackingReducer.with(clearCurrentlyViewed, (state) => {
    if (!state.currentlyViewedNoteId) return state;
    return { ...state, currentlyViewedNoteId: null };
  });
noteReadTrackingReducer.with(markNoteRead, (state, { payload }) => {
    const { noteId, now } = payload;
    const existing = state.readRecords[noteId];
    return {
      ...state,
      readRecords: {
        ...state.readRecords,
        [noteId]: {
          lastReadAt: now,
          readCount: (existing?.readCount ?? 0) + 1,
        },
      },
      unreadNoteIds: withoutUnreadNoteId(state.unreadNoteIds, noteId),
    };
  });
noteReadTrackingReducer.with(clearCache, () => ({ ...initialState }));

