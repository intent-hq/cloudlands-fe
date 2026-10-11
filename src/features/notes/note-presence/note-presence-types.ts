export interface NoteViewerCursor {
  rev: number;
  anchor: number;
  head: number;
}

/** One viewer of a note (snapshot row and delta `viewer`). */
export interface NoteViewer {
  principalId: string;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** `null` until the principal's first `note.presence.update` on the note. */
  cursor: NoteViewerCursor | null;
}

/** A peer viewing the note; `cursor` is `null` until seen or once expired. */
export interface RemoteNoteViewer extends NoteViewer {
  /** `Date.now()` of the last delta that carried this viewer's cursor. */
  cursorSeenAt: number | null;
}
