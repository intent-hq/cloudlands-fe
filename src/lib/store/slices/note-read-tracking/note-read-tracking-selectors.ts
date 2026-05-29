import { store } from "../../store";

/** Select all unread note IDs */
export const selectUnreadNoteIds = store.createSelector((state) => {
  return Object.keys(state.noteReadTracking.unreadNoteIds);
});

/** Check if a specific note has unread changes */
export const selectHasUnreadChanges = store.createSelector((state, noteId: string) => {
  return !!state.noteReadTracking.unreadNoteIds[noteId];
});

/** Select the count of unread notes */
export const selectUnreadCount = store.createSelector((state) => {
  return Object.keys(state.noteReadTracking.unreadNoteIds).length;
});

/** Select the loading state */
export const selectIsNoteReadTrackingLoading = store.createSelector((state) => {
  return state.noteReadTracking.isLoading;
});

/** Select the currently viewed note ID */
export const selectCurrentlyViewedNoteId = store.createSelector((state) => {
  return state.noteReadTracking.currentlyViewedNoteId;
});

/** Select a cached read record for a specific note */
export const selectReadRecord = store.createSelector((state, noteId: string) => {
  return state.noteReadTracking.readRecords[noteId] ?? null;
});

/** Select all read records */
export const selectReadRecords = store.createSelector((state): Record<string, import("$shared/types/user-activity.types").NoteReadRecord> => {
  return state.noteReadTracking.readRecords;
});
