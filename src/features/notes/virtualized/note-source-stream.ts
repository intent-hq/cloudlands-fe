import {
  sameNoteScope,
  type NotePageRequest,
  type NoteReadPage,
  type NoteScope,
} from '$lib/client/note-pages';
import type { NoteSourceSink } from './editing/note-source-copy';

export interface NoteSourceSnapshot {
  scope: NoteScope;
  sourceRevision: string;
  snapshotId: string;
  sourceLength: number;
  expiresAt: string;
}

/** One pinned page and one sink write at a time. No document-size accumulator.
 * The caller owns resource admission, immediate sink cancellation, and acknowledged
 * cleanup. This iterator must not swallow cleanup failures or release those credits. */
export async function streamNoteSource(
  snapshot: NoteSourceSnapshot,
  read: (request: NotePageRequest) => Promise<NoteReadPage>,
  sink: NoteSourceSink,
  current: () => boolean,
): Promise<void> {
  let at = 0;
  let cursor: string | undefined;
  const check = () => {
    if (!current() || Date.now() >= Date.parse(snapshot.expiresAt))
      throw new Error('Note source copy expired');
  };
  do {
    check();
    const page = await read({
      kind: 'source',
      maxWireBytes: 8192,
      maxSourceBytes: 4096,
      ...(cursor
        ? { cursor }
        : {
            at: 0,
            sourceRevision: snapshot.sourceRevision,
            snapshotId: snapshot.snapshotId,
            noteInstanceId: snapshot.scope.noteInstanceId,
          }),
    });
    check();
    if (
      page.kind !== 'noteSourcePage' ||
      !sameNoteScope(page.scope, snapshot.scope) ||
      page.sourceRevision !== snapshot.sourceRevision ||
      page.snapshotId !== snapshot.snapshotId ||
      page.expiresAt !== snapshot.expiresAt ||
      page.sourceLength !== snapshot.sourceLength ||
      page.range.start !== at ||
      page.range.end !== at + page.text.length ||
      page.range.end > snapshot.sourceLength ||
      (page.range.end === at && at !== snapshot.sourceLength)
    )
      throw new Error('Note source copy changed or made no progress');
    if (new TextEncoder().encode(page.text).byteLength > 4096)
      throw new Error('Note source page exceeded its budget');
    await sink.write(page.text);
    check();
    at = page.range.end;
    cursor = page.nextCursor ?? undefined;
    if (!!cursor !== at < snapshot.sourceLength)
      throw new Error('Note source copy ended before the complete document');
  } while (cursor);
  check();
  await sink.commit();
}
