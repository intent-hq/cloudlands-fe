/** Note view reads (§5.2 "Truncated note reads"), shared by the read and write sagas. */
import { appClient } from '$lib/client';
import type { NoteGetOptions } from '$lib/client/app-client';
import { NOTE_VIEW_MAX_CONTENT_BYTES } from '$shared/constants/notes';

/** The truncated-read limit when the daemon supports it; otherwise an unbounded read. */
export async function viewReadOptions(): Promise<NoteGetOptions | undefined> {
  return (await appClient.notes.supportsTruncatedRead())
    ? { maxContentBytes: NOTE_VIEW_MAX_CONTENT_BYTES }
    : undefined;
}
