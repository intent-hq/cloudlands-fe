import { createSelector } from "../../utils/create-selector";

/** Select all unread note IDs */
export const selectUnreadNoteIds = createSelector((state) => {
  return state.noteReadTracking.unreadNoteIds;
});

/** Check if a specific note has unread changes */
export const selectHasUnreadChanges = createSelector((state, noteId: string) => {
  return state.noteReadTracking.unreadNoteIds.includes(noteId);
});

/** Select the count of unread notes */
export const selectUnreadCount = createSelector((state) => {
  return state.noteReadTracking.unreadNoteIds.length;
});

/** Select the loading state */
export const selectIsNoteReadTrackingLoading = createSelector((state) => {
  return state.noteReadTracking.isLoading;
});

/** Select the currently viewed note ID */
export const selectCurrentlyViewedNoteId = createSelector((state) => {
  return state.noteReadTracking.currentlyViewedNoteId;
});

/** Select a cached read record for a specific note */
export const selectReadRecord = createSelector((state, noteId: string) => {
  return state.noteReadTracking.readRecords[noteId] ?? null;
});

/** Select all read records */
export const selectReadRecords = createSelector((state): Record<string, import("$shared/types/user-activity.types").NoteReadRecord> => {
  return state.noteReadTracking.readRecords;
});

/** Select the current workspace ID */
export const selectNoteReadTrackingWorkspaceId = createSelector((state) => {
  return state.noteReadTracking.currentWorkspaceId;
});

