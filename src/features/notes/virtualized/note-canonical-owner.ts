import { sameNoteScope, type NotePageRequest, type NoteReadPage } from '$lib/client/note-pages';
import { NOTE_WINDOW_LIMITS, type NoteWindow } from './note-window-reader';
type Boundary = Extract<NoteWindow['context'][number], { kind: 'boundary' }>;

/** Operation-owner seam: drive through the same admitted page state as window
 * assembly. This generator neither owns a transport nor fetches a complete note.
 * A compact source hull never substitutes for its original lexical descriptor. */
export function* noteCanonicalOwnerSteps(
  window: NoteWindow,
  ownerId: string,
  current: () => boolean,
): Generator<NotePageRequest, Boundary, NoteReadPage> {
  const assertCurrent = () => {
    if (!current()) throw new Error('Note owner resolution superseded');
  };
  assertCurrent();
  const compact = window.canonicalOwners?.find((owner) => owner.ownerId === ownerId);
  const local = window.context.find(
    (item): item is Boundary => item.kind === 'boundary' && item.id === ownerId,
  );
  if (local && !compact) return local;
  const binding = window.mapBindings.find((item) => item.ownerId === ownerId);
  if (!compact || !binding) throw new Error('Note owner has no scoped window binding');
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let descriptors = 0;
  for (let reads = 0; reads < NOTE_WINDOW_LIMITS.requests; reads++) {
    assertCurrent();
    const page = yield {
      kind: 'context',
      contextRef: binding.contextRef,
      ...(cursor ? { cursor } : {}),
      maxWireBytes: NOTE_WINDOW_LIMITS.wireBytes,
      maxItems: 64,
    };
    assertCurrent();
    if (
      page.kind !== 'noteContextPage' ||
      !sameNoteScope(page.scope, window.scope) ||
      page.sourceRevision !== window.sourceRevision ||
      page.snapshotId !== window.snapshotId
    )
      throw new Error('Note owner snapshot mismatch');
    descriptors += page.items.length;
    if (descriptors > NOTE_WINDOW_LIMITS.descriptors)
      throw new Error('Note owner descriptor budget exceeded');
    const owner = page.items.find((item) => item.id === ownerId);
    if (owner) {
      if (
        owner.kind !== 'boundary' ||
        owner.nativeRef !== compact.nativeRef ||
        owner.construct !== compact.construct ||
        owner.sourceRange.start !== compact.sourceRange.start ||
        owner.sourceRange.end !== compact.sourceRange.end ||
        JSON.stringify(owner.htmlSource) !== JSON.stringify(compact.htmlSource)
      )
        throw new Error('Note owner identity changed');
      return owner;
    }
    if (!page.nextCursor) throw new Error('Missing scoped note owner');
    if (!page.items.length || cursors.has(page.nextCursor))
      throw new Error('Note owner cursor made no progress');
    cursor = page.nextCursor;
    cursors.add(cursor);
  }
  throw new Error('Note owner request budget exceeded');
}
