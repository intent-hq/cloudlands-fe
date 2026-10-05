import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  createNoteParagraphEditAuthority,
  noteParagraphEditContextSteps,
} from './note-paragraph-edit-authority';
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
async function capturedWindow() {
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
  return { window, identity, requests };
}

it('keeps a real Store markdownBlock read-only without lexical edit authority', async () => {
  const { window, requests } = await capturedWindow();
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

it('refuses canonical owners before requesting ordinary paragraph details', async () => {
  const { window, identity } = await capturedWindow();
  const steps = noteParagraphEditContextSteps(
    window,
    identity,
    () => true,
    () => Date.parse(identity.expiresAt) - 1,
  );
  expect(() => steps.next()).toThrow('Unsupported canonical paragraph edit context');
});

it('rejects expired, replaced and cancelled paragraph contexts before reading', async () => {
  const { window, identity } = await capturedWindow();
  expect(() =>
    noteParagraphEditContextSteps(
      window,
      identity,
      () => true,
      () => Date.parse(identity.expiresAt),
    ).next(),
  ).toThrow('Stale paragraph');
  expect(() =>
    noteParagraphEditContextSteps(
      window,
      { ...identity, snapshotId: 'different' },
      () => true,
      () => Date.parse(identity.expiresAt) - 1,
    ).next(),
  ).toThrow('Stale paragraph');
  expect(() =>
    noteParagraphEditContextSteps(
      window,
      identity,
      () => false,
      () => Date.parse(identity.expiresAt) - 1,
    ).next(),
  ).toThrow('superseded');
});

it('does not accept a caller-invented lexical receipt', async () => {
  const { window } = await capturedWindow();
  const projection = new NoteCanonicalProjection(window);
  const editor = nativeFixtureEditor(projection.content);
  try {
    expect(() =>
      createNoteParagraphEditAuthority(
        window,
        projection,
        { cost: { requests: 0, wireBytes: 0, retainedBytes: 0 } },
        editor.state.doc,
      ),
    ).toThrow('Unresolved paragraph');
  } finally {
    editor.destroy();
  }
});

// Controlled protocol-boundary inputs, NOT Store captures or product evidence.
// Ordinary Store success tests are added separately when the producer supplies
// its exact responses. These controls exercise failures after a yielded read.
function controlledDetails() {
  const identity = {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    sourceRevision: 'revision',
    snapshotId: 'snapshot',
    expiresAt: '2030-01-01T00:00:00Z',
  };
  let time = Date.parse(identity.expiresAt) - 1,
    current = true;
  const window: import('../note-window-reader').NoteWindow = {
    ...identity,
    sourceLength: 5,
    range: { start: 0, end: 5 },
    text: 'abc\r\n',
    documentEnd: true,
    mapBindings: [],
    details: {},
    context: [
      {
        kind: 'boundary',
        id: 'owner',
        construct: 'paragraph',
        entryPath: 'markdown',
        sourceRange: { start: 0, end: 5 },
        detailRef: 'opaque-directory',
      },
    ],
    cost: {
      requests: 2,
      wireBytes: 1000,
      contextBytes: 300,
      sourceBytes: 5,
      assemblyPeakBytes: 1000,
    },
  };
  type ContextPage = Extract<NoteReadPage, { kind: 'noteContextPage' }>;
  const page = (items: ContextPage['items']): ContextPage => ({
    ...identity,
    kind: 'noteContextPage',
    items,
    nextCursor: null,
  });
  const fragment = (field: string, text: string, offset = 0, nextRef: string | null = null) => ({
    kind: 'fragment' as const,
    id: field + offset,
    field,
    text,
    offset,
    nextRef,
  });
  const replies: Record<string, ContextPage> = {
    'opaque-directory': page([
      fragment('openingSource', '', 0, 'prefix-fragment'),
      fragment('closingSource', '', 0, 'suffix-fragment'),
    ]),
    'prefix-fragment': page([fragment('openingSource', '')]),
    'suffix-fragment': page([fragment('closingSource', '\r', 0, 'suffix-continuation')]),
    'suffix-continuation': page([fragment('closingSource', '\n', 1)]),
  };
  const steps = () =>
    noteParagraphEditContextSteps(
      window,
      identity,
      () => current,
      () => time,
    );
  const finish = (iterator: ReturnType<typeof steps>) => {
    let next = iterator.next();
    while (!next.done) {
      if (next.value.kind !== 'context') throw new Error('Unexpected noncontext request');
      const reply = replies[next.value.contextRef];
      if (!reply) throw new Error('Unexpected reference');
      next = iterator.next(reply);
    }
    return next.value;
  };
  return {
    window,
    identity,
    replies,
    steps,
    finish,
    cancel: () => {
      current = false;
    },
    expire: () => {
      time = Date.parse(identity.expiresAt);
    },
  };
}

it.each(['cancel', 'expire'] as const)(
  'checks %s immediately after a yielded detail read',
  (kind) => {
    const f = controlledDetails(),
      iterator = f.steps();
    expect(iterator.next().value).toMatchObject({
      kind: 'context',
      contextRef: 'opaque-directory',
    });
    f[kind]();
    expect(() => iterator.next(f.replies['opaque-directory'])).toThrow(
      kind === 'cancel' ? 'superseded' : 'Stale paragraph',
    );
  },
);

it.each(['scope', 'sourceRevision', 'snapshotId', 'expiresAt'] as const)(
  'rejects a detail response with changed %s',
  (field) => {
    const f = controlledDetails(),
      iterator = f.steps();
    iterator.next();
    const page = {
      ...f.replies['opaque-directory'],
      [field]:
        field === 'scope' ? { ...f.identity.scope, noteInstanceId: 'replacement' } : 'different',
    } as NoteReadPage;
    expect(() => iterator.next(page)).toThrow('response identity mismatch');
  },
);

it('resolves exact fragmented delimiters without inferring an empty suffix', () => {
  const f = controlledDetails();
  const receipt = f.finish(f.steps());
  expect(receipt.cost.requests).toBe(4);
  expect(receipt.cost.retainedBytes).toBeGreaterThan(0);
  expect(f.window.details).toEqual({});
  expect(f.window.text).toBe('abc\r\n');
});

it.each(['offset', 'cycle', 'empty'] as const)(
  'rejects malformed %s fragment continuations',
  (kind) => {
    const f = controlledDetails();
    const item = f.replies['suffix-continuation'].items[0];
    if (item.kind !== 'fragment') throw new Error('Missing controlled fragment');
    if (kind === 'offset') item.offset = 0;
    if (kind === 'cycle') item.nextRef = 'suffix-fragment';
    if (kind === 'empty') {
      item.text = '';
      item.nextRef = 'suffix-fragment';
    }
    expect(() => f.finish(f.steps())).toThrow(
      kind === 'cycle' ? 'reference cycle' : 'Noncontiguous',
    );
  },
);

it.each(['requests', 'bytes', 'descriptors'] as const)(
  'enforces the cumulative %s limit during detail resolution',
  (kind) => {
    const f = controlledDetails();
    if (kind === 'requests') f.window.cost.requests = 96;
    if (kind === 'bytes') f.window.cost.contextBytes = 8192;
    if (kind === 'descriptors')
      f.window.context.push(
        ...Array.from({ length: 127 }, (_, i) => ({
          kind: 'span' as const,
          id: 'span' + i,
          role: 'text',
          sourceRange: { start: 0, end: 1 },
        })),
      );
    expect(() => f.finish(f.steps())).toThrow(/budget exceeded/);
  },
);

it('rejects a source window changed while its lexical context was loading', () => {
  const f = controlledDetails(),
    iterator = f.steps();
  iterator.next();
  f.window.text = 'xyz\r\n';
  expect(() => iterator.next(f.replies['opaque-directory'])).toThrow('source window changed');
});
