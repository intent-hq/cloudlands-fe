import { store } from '@/store';
import {
  selectWorkspaceById,
  selectWorkspaceParticipationContext,
} from '../workspace/workspace-selectors';
import { selectAdmittedWorkspaceReadContext } from '../workspace-lifecycle/workspace-lifecycle-selectors';
import { selectPrincipalConnectionContext } from '../principal/principal-selectors';
import { selectNoteById, selectNoteContentView } from './workspace-notes-selectors';
import {
  getHostRole,
  getPrincipalSnapshot,
} from '../../../../../src/store/renderer/slices/principal/principal-projections';
import * as notes from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-projections';

/** Stable ownership for retained outcomes; transient connection generations are dispatch fences. */
export const selectNoteEditAuthority = store.createSelector(
  (state, workspaceId: string, noteId: string) => {
    const permission = selectWorkspaceParticipationContext.select(state, workspaceId);
    const workspace = selectWorkspaceById.select(state, workspaceId);
    const principal = getPrincipalSnapshot(state)?.principal;
    return permission && workspace && principal
      ? JSON.stringify([
          state.connections.windowBackendId,
          principal.id,
          principal.hostMembershipRevision,
          getHostRole(state),
          workspaceId,
          workspace.worktreePath || workspace.repositoryPath,
          noteId,
        ])
      : null;
  },
);
export const selectNoteEditContext = store.createSelector(
  (state, workspaceId: string, noteId: string) => {
    const authority = selectNoteEditAuthority.select(state, workspaceId, noteId);
    const read = selectAdmittedWorkspaceReadContext.select(state, workspaceId);
    return authority && read
      ? JSON.stringify([authority, read, state.daemonHealth.connectionGeneration])
      : null;
  },
);
export const selectNoteEditReady = store.createSelector(
  (state, workspaceId: string, noteId: string, consumerId: string) => {
    const note = selectNoteById.select(state, workspaceId, noteId);
    const view = selectNoteContentView.select(state, workspaceId, consumerId);
    return (
      view?.status === 'ready' &&
      view.noteId === noteId &&
      view.authority === selectPrincipalConnectionContext.select(state) &&
      notes.isEditableMarkdownNote(note) &&
      !!selectNoteEditContext.select(state, workspaceId, noteId)
    );
  },
);
export const selectNoteWriteReady = store.createSelector(
  (state, workspaceId: string, noteId: string) => {
    const views = state.workspaceNotes.byWorkspaceId[workspaceId]?.contentViews;
    return !!views?.ids.some((consumerId) =>
      selectNoteEditReady.select(state, workspaceId, noteId, consumerId),
    );
  },
);
export const selectExplicitNoteEditor = store.createSelector(notes.getExplicitNoteEditor);
export const selectExplicitNoteEditorCurrent = store.createSelector(
  notes.getExplicitNoteEditorCurrent,
);
export const selectExplicitNoteSaveOperations = store.createSelector(
  notes.getExplicitNoteSaveOperations,
);
export const selectNoteEditorState = store.createSelector((state, viewId: string) => {
  const editor = notes.getExplicitNoteEditor(state, viewId);
  const operations = editor
    ? notes.getExplicitNoteSaveOperations(state, editor.workspaceId, editor.noteId)
    : [];
  const own = operations.filter((operation) => operation.authority === editor?.authority);
  return {
    dirty: !!editor && editor.content !== editor.baseContent,
    bounded: !!editor && notes.isExplicitNoteContentSupported(editor.content),
    pending: own.some(
      (operation) => operation.status === 'queued' || operation.status === 'running',
    ),
    uncertain: own.some((operation) => operation.status === 'unknown'),
    blocked: operations.some((operation) =>
      ['queued', 'running', 'unknown'].includes(operation.status),
    ),
    last: own.at(-1),
  };
});
