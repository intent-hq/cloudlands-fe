import { acquireFullNoteEditLease } from '$store/renderer/slices/workspace-notes/note-full-edit-lease';
/** Compatibility façade for workspace-notes read actions. */
import { store as appStore } from '$store/renderer/store';
import {
  ensureNoteContentLoadedRequested,
  loadFullNoteEditRequested,
  fullNoteEditReleased,
  noteEventReceived,
  type NoteEventType,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';

export function applyNoteFromEvent(
  workspaceId: string,
  noteId: string,
  eventType: NoteEventType,
): void {
  appStore.dispatch(noteEventReceived(workspaceId, noteId, eventType));
}

export function ensureNoteContentLoaded(workspaceId: string, noteId: string): Promise<boolean> {
  return appStore.dispatch(ensureNoteContentLoadedRequested(workspaceId, noteId));
}

/** Retained for compatibility with service-era tests. */
export function __resetNotesReadServiceForTests(): void {}

export function beginFullNoteEdit(workspaceId: string, noteId: string) {
  const lease = acquireFullNoteEditLease(workspaceId, noteId);
  return {
    load: () => appStore.dispatch(loadFullNoteEditRequested(workspaceId, noteId, lease.id)),
    release() {
      lease.release();
      appStore.dispatch(fullNoteEditReleased(workspaceId, noteId, lease.id));
    },
  };
}

export function isPagedNoteSession(workspaceId: string, noteId: string): boolean {
  const note = appStore.state.notePages?.byWorkspaceId[workspaceId]?.notes[noteId];
  return !!note && Object.keys(note.panels).length > 0;
}
