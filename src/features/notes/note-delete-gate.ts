import { store } from '$store/renderer/store';
import {
  noteDeleteKey,
  noteDeleteDraftKey,
  type NoteDeleteDraftOwner,
  type NoteDeleteRecoveryDraft,
} from '$store/renderer/slices/workspace-notes/note-delete-state';
import {
  noteDeleteRecoveryRetained,
  noteDeleteRecoveryReserved,
  noteDeleteInputObserved,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';

export function isNoteDeleteHeld(workspaceId: string, noteId: string): boolean {
  const state = store.state;
  return (
    state.workspaceNotes.deleteOperations?.[
      noteDeleteKey(state.daemonHealth.connectionGeneration, workspaceId, noteId)
    ]?.held === true
  );
}
export function subscribeNoteDeleteHold(
  workspaceId: string,
  noteId: string,
  listener: (held: boolean) => void,
): () => void {
  let previous: boolean | undefined;
  let previousGeneration: number | undefined;
  return store.getReadableState().subscribe(() => {
    const held = isNoteDeleteHeld(workspaceId, noteId);
    const generation = store.state.daemonHealth.connectionGeneration;
    if (held !== previous || generation !== previousGeneration) {
      previous = held;
      previousGeneration = generation;
      listener(held);
    }
  });
}
/** Keep distinct editor drafts, never overwrite another participant's strict base. */
export function retainNoteDeleteDraft(draft: NoteDeleteRecoveryDraft): boolean {
  const drafts = store.state.workspaceNotes.deleteRecoveryDrafts ?? {};
  const key = JSON.stringify([
    draft.backendGeneration,
    draft.workspaceId,
    draft.noteId,
    draft.ownerId,
  ]);
  if (!drafts[key] && !store.state.workspaceNotes.deleteRecoveryReservations?.[key]) return false;
  store.dispatch(noteDeleteRecoveryRetained(draft));
  return true;
}

/** Reserve before an editor can accept input; unmount never needs to find a new slot. */
export function reserveNoteDeleteDraft(owner: NoteDeleteDraftOwner): (() => void) | undefined {
  const state = store.state.workspaceNotes;
  const keys = new Set([
    ...Object.keys(state.deleteRecoveryDrafts ?? {}),
    ...Object.keys(state.deleteRecoveryReservations ?? {}),
  ]);
  const key = noteDeleteDraftKey(owner);
  if (!keys.has(key) && keys.size >= 256) return undefined;
  store.dispatch(noteDeleteRecoveryReserved(owner, true));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    store.dispatch(noteDeleteRecoveryReserved(owner, false));
  };
}
export function notifyNoteDeleteInput(owner: NoteDeleteDraftOwner): void {
  store.dispatch(noteDeleteInputObserved(owner));
}
