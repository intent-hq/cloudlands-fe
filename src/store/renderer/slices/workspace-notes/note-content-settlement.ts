// Seam between the notes write service (which owns debounced drafts and the
// per-note mutation queue) and store sagas that must be ordered after every
// content save of a note on the daemon (note.restoreVersion). Sagas stay inside
// the store directory, so the service registers its settle function here.

export type NoteContentSettler = (workspaceId: string, noteId: string) => Promise<void>;

let settler: NoteContentSettler | undefined;

export function registerNoteContentSettler(fn: NoteContentSettler | undefined): void {
  settler = fn;
}

/**
 * Resolve once every content save the write service holds for this note —
 * debounced or already in flight — has been acknowledged. Resolves at once
 * when no service has registered (nothing can be pending then).
 */
export function settleRegisteredNoteContent(workspaceId: string, noteId: string): Promise<void> {
  return settler ? settler(workspaceId, noteId) : Promise.resolve();
}
