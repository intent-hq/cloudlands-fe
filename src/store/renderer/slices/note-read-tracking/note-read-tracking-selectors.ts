import type { NoteReadRecord } from '$shared/types/user-activity.types';
import { store } from '../../store';

/** Select all unread note IDs */
export const selectUnreadNoteIds = store.createSelector((state) => {
  return Object.keys(state.noteReadTracking.unreadNoteIds);
});

/** Select all local read records */
export const selectReadRecords = store.createSelector((state): Record<string, NoteReadRecord> => {
  return state.noteReadTracking.readRecords;
});
