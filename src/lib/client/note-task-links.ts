import { sameNoteScope, type NotePagesClient, type NoteReadPage } from './note-pages';

type Snapshot = Extract<NoteReadPage, { kind: 'noteTaskIdsPage' }>;
/** Collect only ordered IDs, never the full spec body. A failed chain publishes no partial result. */
export async function readNoteTaskLinks(
  reader: Pick<NotePagesClient, 'capabilities' | 'read'>,
  workspaceId: string,
  noteId: string,
): Promise<string[] | null> {
  const capabilities = await reader.capabilities();
  if (!capabilities) return null;
  let snapshot: Snapshot | undefined;
  const ids: string[] = [],
    seenIds = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await reader.read(workspaceId, noteId, {
      kind: 'taskIds',
      ...(cursor ? { cursor } : {}),
      maxWireBytes: 65536,
      maxItems: 128,
    });
    if (page.kind !== 'noteTaskIdsPage' || page.scope.backendId !== capabilities.backendId)
      throw new Error('Invalid task link page');
    if (
      snapshot &&
      (!sameNoteScope(page.scope, snapshot.scope) ||
        page.sourceRevision !== snapshot.sourceRevision ||
        page.snapshotId !== snapshot.snapshotId ||
        page.totalItems !== snapshot.totalItems)
    )
      throw new Error('Task link snapshot changed');
    if (page.startIndex !== ids.length) throw new Error('Task link page starts at wrong ordinal');
    snapshot ??= page;
    for (const item of page.items) {
      if (item.index !== ids.length) throw new Error('Task link order has a gap');
      let id = item.taskNoteId;
      if (id === undefined) {
        id = '';
        let ref = item.taskNoteIdRef;
        const refs = new Set<string>();
        while (ref) {
          if (refs.has(ref)) throw new Error('Task link fragment did not advance');
          refs.add(ref);
          const fragment = await reader.read(workspaceId, noteId, {
            kind: 'context',
            contextRef: ref,
            maxWireBytes: 65536,
            maxItems: 1,
          });
          if (
            fragment.kind !== 'noteContextPage' ||
            !sameNoteScope(fragment.scope, snapshot.scope) ||
            fragment.snapshotId !== snapshot.snapshotId ||
            fragment.sourceRevision !== snapshot.sourceRevision ||
            fragment.items.length !== 1 ||
            fragment.nextCursor !== null
          )
            throw new Error('Task link fragment snapshot changed');
          const value = fragment.items[0];
          if (
            value.kind !== 'fragment' ||
            value.field !== 'taskNoteId' ||
            value.offset !== id.length ||
            !value.text.length
          )
            throw new Error('Invalid task link fragment offset');
          id += value.text;
          if (id.length > item.sourceRange.end - item.sourceRange.start)
            throw new Error('Task link exceeds source range');
          ref = value.nextRef ?? undefined;
        }
      }
      if (!id || id.length !== item.sourceRange.end - item.sourceRange.start || seenIds.has(id))
        throw new Error('Invalid task link identity');
      seenIds.add(id);
      ids.push(id);
    }
    if (
      ids.length > page.totalItems ||
      (page.nextCursor === null && ids.length !== page.totalItems)
    )
      throw new Error('Incomplete task link summary');
    cursor = page.nextCursor ?? undefined;
    if (cursor) {
      if (!page.items.length || cursors.has(cursor))
        throw new Error('Task link page did not advance');
      cursors.add(cursor);
    }
  } while (cursor);
  return ids;
}
