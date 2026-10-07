/** Compatibility façade for workspace-notes read actions. */
import { store as appStore } from '$store/renderer/store';
import {
  ensureNoteContentLoadedRequested,
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
