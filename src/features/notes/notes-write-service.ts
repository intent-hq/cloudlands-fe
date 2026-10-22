/** Compatibility façade for the workspace-notes persistence saga. */
import type { CreateNoteRequest } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import {
  createNotePersistRequested,
  deleteNotePersistRequested,
  flushNoteContentRequested,
  settleNoteContentRequested,
  updateNoteContent as updateNoteContentAction,
  updateNoteTitlePersistRequested,
  type AppliedNoteContent,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { selectHasPendingNoteContent } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';

export type { AppliedNoteContent };

export function hasPendingNoteContent(workspaceId: string, noteId: string): boolean {
  return selectHasPendingNoteContent.select(appStore.state, workspaceId, noteId);
}

export function createNote(
  workspaceId: string,
  data: Omit<CreateNoteRequest, 'workspaceId'>,
): Promise<string | undefined> {
  return appStore.dispatch(createNotePersistRequested(workspaceId, data));
}

export function updateNoteContent(
  workspaceId: string,
  noteId: string,
  content: string,
  options?: { immediate?: boolean; baseRev?: number; baseContent?: string },
): void {
  appStore.dispatch(updateNoteContentAction(workspaceId, noteId, content, options));
}

export function flushNoteContent(
  workspaceId: string,
  noteId: string,
): Promise<AppliedNoteContent | undefined> {
  return appStore.dispatch(flushNoteContentRequested(workspaceId, noteId));
}

export function settleNoteContent(workspaceId: string, noteId: string): Promise<void> {
  return appStore.dispatch(settleNoteContentRequested(workspaceId, noteId));
}

export function updateNoteTitle(workspaceId: string, noteId: string, title: string): Promise<void> {
  return appStore.dispatch(updateNoteTitlePersistRequested(workspaceId, noteId, title));
}

export function deleteNote(workspaceId: string, noteId: string): Promise<void> {
  return appStore.dispatch(deleteNotePersistRequested(workspaceId, noteId));
}
