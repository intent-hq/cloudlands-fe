import { store } from '../../store';
/** Page/session data never masquerades as complete Note content. */
export const selectNotePageSession = store.createSelector(
  (s, ws: string, id: string) => s.notePages?.byWorkspaceId[ws]?.notes[id],
);
export const selectNoteVisibleRanges = store.createSelector((s, ws: string, id: string) =>
  Object.values(s.notePages?.byWorkspaceId[ws]?.notes[id]?.panels ?? {}).flat(),
);

export const selectPhysicalNoteReadCount = store.createSelector(
  (s, ws: string, id: string) =>
    Object.values(s.notePages.physicalReads).filter((r) => r.workspaceId === ws && r.noteId === id)
      .length,
);

export const selectPhysicalNoteReadTicket = store.createSelector(
  (s, ws: string, id: string, generation: number, key: string) =>
    s.notePages.physicalReads[JSON.stringify([ws, id, generation, key])]?.ticket,
);
