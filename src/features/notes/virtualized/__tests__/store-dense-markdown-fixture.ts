import capture from './fixtures/store-dense-markdown.json';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import { readNoteWindow } from '../note-window-reader';

/** Unmodified responses from the released daemon's disposable 2 MB Markdown index.
 * The capture includes both the failing original reads and the admitted retry. */
export function storeDenseMarkdownFixture(
  transform: (page: NoteReadPage, request: NotePageRequest) => NoteReadPage = (page) => page,
) {
  const calls = capture.calls as unknown as Array<{
    request: NotePageRequest;
    response: NoteReadPage;
  }>;
  const identity = calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing source capture');
  const requests: NotePageRequest[] = [];
  const reader = new NotePageReader(async (method, params) => {
    if (
      method !== 'note.get' ||
      params.workspaceId !== identity.scope.workspaceId ||
      params.noteId !== identity.scope.noteId
    )
      throw new Error('Unexpected note transport scope');
    const q = params.page as NotePageRequest;
    requests.push(q);
    const match = calls.find(({ request: r }) => {
      if (r.kind !== q.kind || r.cursor !== q.cursor) return false;
      if (q.kind === 'source' && r.kind === 'source')
        return r.at === q.at && r.maxSourceBytes === q.maxSourceBytes;
      if (q.kind === 'context' && r.kind === 'context') return r.contextRef === q.contextRef;
      if (q.kind === 'metadata' && r.kind === 'metadata') return r.ref === q.ref;
      return false;
    });
    if (!match) throw new Error('Uncaptured bounded Store request');
    return transform(structuredClone(match.response), q);
  });
  return {
    identity,
    at: 0,
    sourceLength: identity.sourceLength,
    requests,
    read: (current: () => boolean = () => true, at = 0, minimumEnd?: number) =>
      readNoteWindow(
        (q) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q),
        {
          ...identity,
          at,
          minimumEnd,
        },
        current,
      ),
  };
}
