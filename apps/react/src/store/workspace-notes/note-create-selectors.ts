import { store } from '@/store';
import { selectNoteEditAuthority, selectNoteEditContext } from './note-edit-selectors';
import { selectWorkspaceNotesState } from './workspace-notes-selectors';
import * as notes from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-projections';

// The same workspace participation policy admits editing and ordinary-note creation.
export const selectNoteCreateAuthority = store.createSelector((state, workspaceId: string) =>
  selectNoteEditAuthority.select(state, workspaceId, ''),
);
export const selectNoteCreateContext = store.createSelector((state, workspaceId: string) => {
  const notes = selectWorkspaceNotesState.select(state, workspaceId);
  return notes.initialized && !notes.error
    ? selectNoteEditContext.select(state, workspaceId, '')
    : null;
});
export const selectExplicitNoteCreatorCurrent = store.createSelector(
  notes.getExplicitNoteCreatorCurrent,
);
export const selectExplicitNoteCreateOperations = store.createSelector(
  notes.getExplicitNoteCreateOperations,
);
export const selectNoteCreationState = store.createSelector((state, workspaceId: string) => {
  const authority = selectNoteCreateAuthority.select(state, workspaceId);
  const operations = notes.getExplicitNoteCreateOperations(state, workspaceId);
  const own = operations.filter((operation) => operation.authority === authority);
  return {
    blocked: operations.some((operation) =>
      ['queued', 'running', 'unknown'].includes(operation.status),
    ),
    pending: own.some((operation) => ['queued', 'running'].includes(operation.status)),
    unknown: own.some((operation) => operation.status === 'unknown'),
    last: own.at(-1),
  };
});

export const selectExplicitNoteCreator = store.createSelector(notes.getExplicitNoteCreator);
