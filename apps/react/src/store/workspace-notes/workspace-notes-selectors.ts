import { store } from '../index';
import * as projections from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-projections';

export const selectWorkspaceNotesState = store.createSelector(projections.getWorkspaceNotesState);
export const selectNoteById = store.createSelector(projections.getNoteById);
export const selectNoteContentView = store.createSelector(projections.getNoteContentView);
export const selectAllNotes = store.createSelector(projections.getAllNotes);

export const selectSpec = store.createSelector(projections.getSpec);
