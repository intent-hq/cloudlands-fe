import { store } from '../../store';
export const selectNoteResourceLedger = store.createSelector((s) => s.notePages.resourceLedger);
export const selectNoteResourceHeld = store.createSelector((s, owner: string) =>
  Object.hasOwn(s.notePages.resourceLedger.owners, owner),
);
/** A reader waiting for IO must not retain the whole session graph. */
export const selectNotePageInput = store.createSelector(
  (s, ws: string, id: string, generation: number, key: string) => {
    const note = s.notePages.byWorkspaceId[ws]?.notes[id];
    return {
      current: note?.generation === generation && note.status === 'ready',
      page: note?.pages[key],
      error: note?.error && !note.requests[key] ? note.error : null,
    };
  },
);
export const selectNoteReadCurrent = store.createSelector(
  (s, ws: string, id: string, generation: number) => {
    const note = s.notePages.byWorkspaceId[ws]?.notes[id];
    return !!note && note.generation === generation && Object.keys(note.panels).length > 0;
  },
);
export const selectNoteReadAdmitted = store.createSelector((s, ticket: string) =>
  Object.hasOwn(s.notePages.resourceLedger.owners, `read:${ticket}`),
);
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
