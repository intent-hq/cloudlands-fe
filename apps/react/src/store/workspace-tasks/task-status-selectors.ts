import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '@/store';
import {
  selectNoteEditAuthority,
  selectNoteEditContext,
} from '../workspace-notes/note-edit-selectors';
import {
  selectNoteById,
  selectNoteContentView,
} from '../workspace-notes/workspace-notes-selectors';
import { selectPrincipalConnectionContext } from '../principal/principal-selectors';
import { isTaskStatusEditable } from '../../../../../src/features/tasks/task-status-policy';
import * as tasks from '../../../../../src/store/renderer/slices/workspace-tasks/workspace-tasks-projections';
import type { ExplicitTaskStatusIdentity } from '../../../../../src/store/renderer/slices/workspace-tasks/workspace-tasks-types';

export const selectTaskStatusReady = store.createSelector(
  (state, workspaceId: string, noteId: string, consumerId: string) => {
    const note = selectNoteById.select(state, workspaceId, noteId);
    const view = selectNoteContentView.select(state, workspaceId, consumerId);
    return (
      view?.status === 'ready' &&
      view.noteId === noteId &&
      view.authority === selectPrincipalConnectionContext.select(state) &&
      isTaskStatusEditable(note) &&
      !!selectNoteEditContext.select(state, workspaceId, noteId)
    );
  },
);
export const selectTaskStatusHostCurrent = store.createSelector(
  (state, identity: ExplicitTaskStatusIdentity) =>
    selectTaskStatusReady.select(
      state,
      identity.workspaceId,
      identity.noteId,
      identity.consumerId,
    ) &&
    selectNoteEditAuthority.select(state, identity.workspaceId, identity.noteId) ===
      identity.authority &&
    selectNoteEditContext.select(state, identity.workspaceId, identity.noteId) === identity.context,
);
export const selectTaskStatusCurrent = store.createSelector(
  (state, identity: ExplicitTaskStatusIdentity) =>
    tasks.getExplicitTaskStatusCurrent(state, identity) &&
    selectTaskStatusHostCurrent.select(state, identity),
);
export const selectTaskStatusOperations = store.createSelector(
  tasks.getExplicitTaskStatusOperations,
);
export const selectTaskStatusBlocked = store.createSelector(tasks.getExplicitTaskStatusBlocked);

export const selectTaskStatusRefreshing = store.createSelector(
  tasks.getExplicitTaskStatusRefreshing,
);

/** Synchronous Redux observation permanently retires a view before authority can return. */
export const selectInvalidTaskStatusViews = store.createSelector((state) =>
  getItems(state.workspaceTasks.explicitStatusViews)
    .filter((identity) => !selectTaskStatusHostCurrent.select(state, identity))
    .map((identity) => identity.viewId),
);

export const selectTaskStatusRevokedViews = store.createSelector(
  (state) => state.workspaceTasks.revokedStatusViews,
);
