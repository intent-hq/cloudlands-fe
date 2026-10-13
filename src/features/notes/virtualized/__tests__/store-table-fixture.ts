import halfopenTd from './fixtures/store-table-td-halfopen.json';
import halfopenTh from './fixtures/store-table-th-halfopen.json';
import td from './fixtures/store-table-td.json';
import th from './fixtures/store-table-th.json';
import correctedTd from './fixtures/store-table-td-corrected.json';
import correctedTh from './fixtures/store-table-th-corrected.json';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import { readNoteWindow } from '../note-window-reader';

/** Replay real captured Store responses without constructing the original 2 MB
 * source in the browser. Test transport only; no response contents are repaired. */
export function storeTableFixture(
  role: 'td' | 'th',
  version: 'original' | 'corrected' | 'halfopen' = 'halfopen',
) {
  const captures =
    version === 'original'
      ? { td, th }
      : version === 'corrected'
        ? { td: correctedTd, th: correctedTh }
        : { td: halfopenTd, th: halfopenTh };
  const transcript = captures[role] as unknown as {
    at: number;
    sourceLength: number;
    calls: Array<{ request: Record<string, unknown>; response: NoteReadPage }>;
  };
  const identity = transcript.calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing source capture');
  const requests: NotePageRequest[] = [];
  const reader = new NotePageReader(async (_method, params) => {
    const q = params.page as NotePageRequest;
    requests.push(q);
    const match = transcript.calls.find(
      ({ request: r }) =>
        r.kind === q.kind &&
        ('contextRef' in q
          ? r.contextRef === q.contextRef
          : 'ref' in q
            ? r.ref === q.ref
            : q.kind === 'source' && r.at === q.at && r.maxSourceBytes === q.maxSourceBytes) &&
        r.cursor === q.cursor,
    );
    if (!match) throw new Error('Uncaptured Store request: ' + JSON.stringify(q));
    if (q.kind === 'source' && q.maxSourceBytes !== 4096)
      throw new Error('Uncaptured source budget');
    return match.response;
  });
  return {
    identity,
    requests,
    at: transcript.at,
    sourceLength: transcript.sourceLength,
    read: () =>
      readNoteWindow((q) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q), {
        ...identity,
        at: transcript.at,
      }),
  };
}
