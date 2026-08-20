import { store } from '../../store';

/** Select all unread note IDs */
export const selectUnreadNoteIds = store.createSelector((state) => {
  return Object.keys(state.noteReadTracking.unreadNoteIds);
});
