import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
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
  /** Current workspace ID for tracking workspace switches */
  currentWorkspaceId: string | null;
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: NoteReadTrackingState = {
  readRecords: {},
  unreadNoteIds: {},
  isLoading: false,
  currentlyViewedNoteId: null,
  currentWorkspaceId: null,
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

function toUnreadNoteIdRecord(unreadIds: string[]): Record<string, boolean> {
  return unreadIds.reduce<Record<string, boolean>>((acc, unreadId) => {
    acc[unreadId] = true;
    return acc;
  }, {});
}

// ============================================================================
// Actions
// ============================================================================

/** Mark a note as currently being viewed — clears its unread status */
export const markAsViewed = createAction<[noteId: string]>(
  "noteReadTracking/markAsViewed"
);

/** Clear the currently viewed note */
export const clearCurrentlyViewed = createAction(
  "noteReadTracking/clearCurrentlyViewed"
);

/** Optimistically mark a note as read (reducer handles state, saga handles IPC) */
export const markNoteRead = createAction<[workspaceId: string, noteId: string]>(
  "noteReadTracking/markNoteRead"
);

/** Result of markNoteRead IPC — currently unused but kept for extensibility */
export const markNoteReadSuccess = createAction<[noteId: string]>(
  "noteReadTracking/markNoteReadSuccess"
);

/** Trigger debounced refresh of unread notes */
export const refreshUnreadNotes = createAction<
  [workspaceId: string, notes: Array<{ id: string; updatedAt: string; createdAt?: string }>]
>("noteReadTracking/refreshUnreadNotes");

/** Result of computeUnreadNotes IPC */
export const computeUnreadNotesSuccess = createAction<[unreadIds: string[]]>(
  "noteReadTracking/computeUnreadNotesSuccess"
);

/** Set loading state */
export const setLoading = createAction<[isLoading: boolean]>(
  "noteReadTracking/setLoading"
);

/** Clear all cached state (e.g., workspace switch) */
export const clearCache = createAction(
  "noteReadTracking/clearCache"
);

/** Clear unread status for a specific note */
export const clearUnread = createAction<[noteId: string]>(
  "noteReadTracking/clearUnread"
);

/** Request to create a new note (handled by saga) */
export const createNoteRequested = createAction<[wsId: string]>(
  "noteReadTracking/createNoteRequested"
);

/** Load note read status from IPC (trigger saga) */
export const loadNoteReadStatus = createAction<[workspaceId: string, noteId: string]>(
  "noteReadTracking/loadNoteReadStatus"
);

/** Cache a read record from IPC result */
export const loadNoteReadStatusSuccess = createAction<[noteId: string, record: NoteReadRecord]>(
  "noteReadTracking/loadNoteReadStatusSuccess"
);

/** Clear stale data when workspace changes (before compute) */
export const workspaceChanged = createAction<[workspaceId: string]>(
  "noteReadTracking/workspaceChanged"
);

// ============================================================================
// Reducer
// ============================================================================

export const noteReadTrackingReducer = createReducer<NoteReadTrackingState>(initialState)
  .with(markAsViewed, (state, { payload: [noteId] }) => {
    if (!noteId) return state;
    return {
      ...state,
      currentlyViewedNoteId: noteId,
      unreadNoteIds: withoutUnreadNoteId(state.unreadNoteIds, noteId),
    };
  })
  .with(clearCurrentlyViewed, (state) => {
    if (!state.currentlyViewedNoteId) return state;
    return { ...state, currentlyViewedNoteId: null };
  })
  .with(markNoteRead, (state, { payload: [_workspaceId, noteId] }) => {
    const now = new Date().toISOString();
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
  })
  .with(computeUnreadNotesSuccess, (state, { payload: [unreadIds] }) => ({
    ...state,
    unreadNoteIds: toUnreadNoteIdRecord(unreadIds),
    isLoading: false,
  }))
  .with(setLoading, (state, { payload: [isLoading] }) => ({
    ...state,
    isLoading,
  }))
  .with(clearCache, () => ({ ...initialState }))
  .with(clearUnread, (state, { payload: [noteId] }) => ({
    ...state,
    unreadNoteIds: withoutUnreadNoteId(state.unreadNoteIds, noteId),
    currentlyViewedNoteId:
      state.currentlyViewedNoteId === noteId ? null : state.currentlyViewedNoteId,
  }))
  .with(loadNoteReadStatusSuccess, (state, { payload: [noteId, record] }) => ({
    ...state,
    readRecords: { ...state.readRecords, [noteId]: record },
  }))
  .with(workspaceChanged, (state, { payload: [workspaceId] }) => ({
    ...initialState,
    currentWorkspaceId: workspaceId,
  }));

