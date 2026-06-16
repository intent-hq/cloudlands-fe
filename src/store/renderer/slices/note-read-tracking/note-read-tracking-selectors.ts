import { store } from "../../store";

/** Select all unread note IDs */
export const selectUnreadNoteIds = store.createSelector((state) => {
  return Object.keys(state.noteReadTracking.unreadNoteIds);
});

/** Select the currently viewed note ID */
export const selectCurrentlyViewedNoteId = store.createSelector((state) => {
  return state.noteReadTracking.currentlyViewedNoteId;
});

/** Select all read records */
export const selectReadRecords = store.createSelector((state): Record<string, import("$shared/types/user-activity.types").NoteReadRecord> => {
  return state.noteReadTracking.readRecords;
});
