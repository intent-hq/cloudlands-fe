import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import capture from '../__tests__/fixtures/store-markdown-html-lf-compacted-windows.json';
import { readNoteWindow } from '../note-window-reader';
import { NoteCanonicalProjection } from '../note-canonical-projection';
import { nativeFixtureEditor } from '../__tests__/canonical-table-fixture';
import { createNoteEditAuthority } from './note-edit-authority';
import { createNoteDocumentSession, prepareNoteDocumentEdit } from './note-document-edit-session';

// Historical actual Store closure, including original signed handles and expiry.
// This is replay evidence, not a live grant. Do not fill lexical fields, decode
// references, substitute paragraph aliases or repair the producer's response.
it('keeps a real Store markdownBlock read-only without lexical edit authority', async () => {
  const calls = capture.calls as unknown as Array<{
    request: NotePageRequest;
    response: NoteReadPage;
  }>;
  const identity = calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing captured source');
  const requests: NotePageRequest[] = [];
  const reader = new NotePageReader(async (_method, params) => {
    const q = params.page as NotePageRequest;
    requests.push(q);
    const found = calls.find(
      ({ request: r }) =>
        r.kind === q.kind &&
        r.cursor === q.cursor &&
        r.maxWireBytes === q.maxWireBytes &&
        r.maxItems === q.maxItems &&
        ('contextRef' in q
          ? 'contextRef' in r && r.contextRef === q.contextRef
          : 'ref' in q
            ? 'ref' in r && r.ref === q.ref
            : q.kind === 'source' &&
              r.kind === 'source' &&
              r.at === q.at &&
              r.maxSourceBytes === q.maxSourceBytes),
    );
    if (!found) throw new Error('Uncaptured Store edit request: ' + JSON.stringify(q));
    return found.response;
  });
  const window = await readNoteWindow(
    (q) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q),
    { ...identity, at: capture.at },
  );
  expect(window.native).toBeDefined();
  expect(window.cost.requests).toBeLessThanOrEqual(96);
  expect(window.cost.canonicalBytes).toBeLessThanOrEqual(8192);
  const projection = new NoteCanonicalProjection(window);
  const editor = nativeFixtureEditor(projection.content);
  try {
    const owners = window.context.filter((item) => item.kind === 'boundary');
    const authority = createNoteEditAuthority(window, projection, owners, editor.state.doc);
    const session = createNoteDocumentSession(
      window.scope,
      window.sourceRevision,
      window.sourceLength,
    );
    let position: number | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes('one')) position = pos + node.text.indexOf('one') + 1;
    });
    expect(position).toBeDefined();
    editor.commands.setTextSelection(position!);
    session.selection = {
      anchor: projection.sourceAt(editor.state.selection.anchor),
      head: projection.sourceAt(editor.state.selection.head),
      anchorAffinity: 1,
      headAffinity: 1,
    };
    const native = editor.state.tr.insertText('X');
    console.info('Store edit authority inputs', {
      range: window.range,
      selection: session.selection,
      owners: owners.map((o) => ({
        id: o.id,
        construct: o.construct,
        entryPath: o.entryPath,
        detailRef: o.detailRef,
      })),
      compactOwners: window.canonicalOwners?.map((o) => ({
        ownerId: o.ownerId,
        construct: o.construct,
      })),
      calls: requests.length,
      canonicalBytes: window.cost.canonicalBytes,
    });
    // Native rendering and affinity maps alone cannot authorize source edits.
    // This is the expected unsupported case, not ordinary-paragraph support.
    expect(() => prepareNoteDocumentEdit(session, native, authority)).toThrow(
      'Missing exact lexical coverage',
    );
    expect(session.history).toEqual([]);
    expect(session.dirty).toEqual([]);
    expect(authority.doc.eq(editor.state.doc)).toBe(true);
    console.info('Store paragraph edit replay', {
      calls: requests.length,
      sourceSha256: createHash('sha256').update(capture.source).digest('hex'),
      canonicalBytes: window.cost.canonicalBytes,
    });
  } finally {
    editor.destroy();
  }
});
