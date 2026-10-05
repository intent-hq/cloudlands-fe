import plainFar from './__fixtures__/note-paragraph/plain-paragraph-far.json';
import plainOne from './__fixtures__/note-paragraph/plain-paragraph-one.json';
import plainTwo from './__fixtures__/note-paragraph/plain-paragraph-two.json';
import htmlTail from './__fixtures__/note-paragraph/plain-paragraph-html-tail.json';
import { projectNoteWindow } from '../note-window-projection';
import { EditorState } from '@tiptap/pm/state';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  createNoteParagraphEditAuthority,
  noteParagraphEditContextSteps,
  type NoteParagraphEditGrant,
} from './note-paragraph-edit-authority';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import capture from '../__tests__/fixtures/store-markdown-html-lf-compacted-windows.json';
import { readNoteWindow } from '../note-window-reader';
import { NoteCanonicalProjection } from '../note-canonical-projection';
import { nativeFixtureEditor } from '../__tests__/canonical-table-fixture';
import { createNoteEditAuthority } from './note-edit-authority';
import {
  createNoteDocumentSession,
  prepareNoteDocumentEdit,
  materializeNoteDocumentAuthority,
  moveNoteDocumentHistory,
  overlayNoteDocumentSource,
} from './note-document-edit-session';

// Controlled resource-owner seam only: live DATA admission/release is tested
// by its driver. These grants do not turn captured responses into live leases.
function controlledGrant(
  window: NoteParagraphEditGrant['window'],
  identity: NoteParagraphEditGrant['identity'],
): NoteParagraphEditGrant {
  let claimed = false;
  return {
    window,
    identity,
    allowance: { retainedBytes: 8192, requests: 96, descriptors: 128, wireBytes: 8192 },
    claim: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    current: () => true,
  };
}

// Historical actual Store closure, including original signed handles and expiry.
// This is replay evidence, not a live grant. Do not fill lexical fields, decode
// references, substitute paragraph aliases or repair the producer's response.
async function capturedWindow(raw: { at: number; calls: unknown[] } = capture) {
  const calls = raw.calls as unknown as Array<{
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
    { ...identity, at: raw.at },
  );
  expect(window.cost.requests).toBeLessThanOrEqual(96);
  expect(window.cost.canonicalBytes ?? 0).toBeLessThanOrEqual(8192);
  return {
    window,
    identity,
    requests,
    read: (q: NotePageRequest) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q),
  };
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
    controlledGrant(window, identity),
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
      controlledGrant(window, identity),
      () => Date.parse(identity.expiresAt),
    ).next(),
  ).toThrow('Stale paragraph');
  const replaced = { ...identity, snapshotId: 'different' };
  expect(() =>
    noteParagraphEditContextSteps(
      window,
      replaced,
      () => true,
      controlledGrant(window, replaced),
      () => Date.parse(identity.expiresAt) - 1,
    ).next(),
  ).toThrow('Stale paragraph');
  expect(() =>
    noteParagraphEditContextSteps(
      window,
      identity,
      () => false,
      controlledGrant(window, identity),
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
  const grant = controlledGrant(window, identity);
  const steps = () =>
    noteParagraphEditContextSteps(
      window,
      identity,
      () => current,
      grant,
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
    grant,
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

async function realPlain(raw: { at: number; calls: unknown[] }) {
  const f = await capturedWindow(raw);
  const projection = projectNoteWindow(f.window);
  const editor = nativeFixtureEditor(projection.content);
  const iterator = noteParagraphEditContextSteps(
    f.window,
    f.identity,
    () => true,
    controlledGrant(f.window, f.identity),
    () => Date.parse(f.identity.expiresAt) - 1,
  );
  try {
    let next = iterator.next();
    while (!next.done) next = iterator.next(await f.read(next.value));
    const authority = createNoteParagraphEditAuthority(
      f.window,
      projection,
      next.value,
      editor.state.doc,
    );
    return { ...f, authority, editor };
  } catch (error) {
    editor.destroy();
    throw error;
  } finally {
    iterator.return(undefined as never);
  }
}

it.each([
  ['one', plainOne],
  ['two', plainTwo],
] as const)(
  'edits ordinary Store %s paragraph source and restores it after reload and undo',
  async (_name, raw) => {
    const f = await realPlain(raw);
    try {
      expect(f.window.native).toBeUndefined();
      const session = createNoteDocumentSession(
        f.window.scope,
        f.window.sourceRevision,
        f.window.sourceLength,
      );
      session.selection = { anchor: 2, head: 1, anchorAffinity: -1, headAffinity: 1 };
      const first = prepareNoteDocumentEdit(
        session,
        EditorState.create({ doc: f.authority.doc }).tr.insertText('X', 2),
        f.authority,
      );
      const second = prepareNoteDocumentEdit(
        first.state,
        EditorState.create({ doc: first.authority.doc }).tr.insertText(
          'Y',
          raw === plainTwo ? 8 : 3,
        ),
        first.authority,
      );
      const expected = raw === plainTwo ? 'aXbc\n\ndYef' : 'aXYbc';
      expect(second.authority.source).toBe(expected);
      expect(
        overlayNoteDocumentSource(second.state, 0, raw.source, f.window.sourceRevision).text,
      ).toBe(expected);
      f.editor.destroy();
      // A fresh actual Store reader/projection/native editor replaces the old mount.
      const fresh = await realPlain(raw);
      try {
        const reloaded = materializeNoteDocumentAuthority(second.state, fresh.authority);
        expect(reloaded.source).toBe(expected);
        expect(reloaded.doc.textContent).toBe(raw === plainTwo ? 'aXbcdYef' : 'aXYbc');
        const undoSecond = moveNoteDocumentHistory(second.state, 'undo')!;
        expect(materializeNoteDocumentAuthority(undoSecond.state, fresh.authority).source).toBe(
          'aXbc' + raw.source.slice(3),
        );
        const undoFirst = moveNoteDocumentHistory(undoSecond.state, 'undo')!;
        expect(materializeNoteDocumentAuthority(undoFirst.state, fresh.authority).source).toBe(
          raw.source,
        );
        expect(undoFirst.state.selection).toEqual(session.selection);
        const redoFirst = moveNoteDocumentHistory(undoFirst.state, 'redo')!;
        const redoSecond = moveNoteDocumentHistory(redoFirst.state, 'redo')!;
        expect(materializeNoteDocumentAuthority(redoSecond.state, fresh.authority).source).toBe(
          expected,
        );
        expect(f.requests.filter((q) => q.kind === 'source')).toHaveLength(1);
      } finally {
        fresh.editor.destroy();
      }
    } finally {
      f.editor.destroy();
    }
  },
);

it('rejects actual Store HTML-entry paragraph text', async () => {
  const f = await capturedWindow(htmlTail);
  expect(
    f.window.context.some(
      (item) =>
        item.kind === 'boundary' && item.construct === 'paragraph' && item.entryPath === 'html',
    ),
  ).toBe(true);
  expect(() =>
    noteParagraphEditContextSteps(
      f.window,
      f.identity,
      () => true,
      controlledGrant(f.window, f.identity),
      () => Date.parse(f.identity.expiresAt) - 1,
    ).next(),
  ).toThrow(/Unsupported/);
});

it.each([
  'window',
  'identity',
  'retainedBytes',
  'requests',
  'descriptors',
  'wireBytes',
  'released',
] as const)('requires an admitted exact-window grant before reading: %s', (kind) => {
  const f = controlledDetails();
  if (kind === 'window') Object.assign(f.grant, { window: { ...f.window } });
  else if (kind === 'identity') Object.assign(f.grant, { identity: { ...f.identity } });
  else if (kind === 'released') f.grant.current = () => false;
  else Object.assign(f.grant.allowance, { [kind]: 0 });
  expect(() => f.steps().next()).toThrow('resource grant unavailable');
  expect(f.window.details).toEqual({});
});

it('checks resource grant liveness after a yielded read', () => {
  const f = controlledDetails(),
    iterator = f.steps();
  expect(iterator.next().done).toBe(false);
  f.grant.current = () => false;
  expect(() => iterator.next(f.replies['opaque-directory'])).toThrow('resource grant unavailable');
});

it('refuses a completed receipt after its resource grant is released', () => {
  const f = controlledDetails(),
    receipt = f.finish(f.steps());
  const projection = projectNoteWindow(f.window),
    editor = nativeFixtureEditor(projection.content);
  try {
    f.grant.current = () => false;
    expect(() =>
      createNoteParagraphEditAuthority(f.window, projection, receipt, editor.state.doc),
    ).toThrow('resource grant unavailable');
  } finally {
    editor.destroy();
  }
});

it('edits the actual Store far paragraph without fetching its untouched prefix', async () => {
  const f = await realPlain(plainFar);
  const original =
    plainFar.sourceRecipe.prefix.repeat(plainFar.sourceRecipe.prefixRepeatCount) +
    plainFar.sourceRecipe.suffix;
  const start = plainFar.at;
  // Test-only reconstruction walks bounded original windows; production never
  // hydrates or passes the large prefix to an edit authority.
  const reconstruct = (state: ReturnType<typeof createNoteDocumentSession>) => {
    const pieces: string[] = [];
    for (let at = 0; at < original.length; at += 16384)
      pieces.push(
        overlayNoteDocumentSource(
          state,
          at,
          original.slice(at, at + 16384),
          f.window.sourceRevision,
        ).text,
      );
    return pieces.join('');
  };
  try {
    expect(f.window.range).toEqual({ start, end: original.length });
    expect(f.window.text).toBe('abc');
    const session = createNoteDocumentSession(
      f.window.scope,
      f.window.sourceRevision,
      f.window.sourceLength,
    );
    session.selection = { anchor: start + 2, head: start + 1, anchorAffinity: -1, headAffinity: 1 };
    const first = prepareNoteDocumentEdit(
      session,
      EditorState.create({ doc: f.authority.doc }).tr.insertText('X', 2),
      f.authority,
    );
    const second = prepareNoteDocumentEdit(
      first.state,
      EditorState.create({ doc: first.authority.doc }).tr.insertText('Y', 3),
      first.authority,
    );
    const expected = original.slice(0, start) + 'aXYbc';
    expect(second.authority.start).toBe(start);
    expect(second.authority.source).toBe('aXYbc');
    expect(reconstruct(second.state)).toBe(expected);
    f.editor.destroy();
    const fresh = await realPlain(plainFar);
    try {
      const mounted = materializeNoteDocumentAuthority(second.state, fresh.authority);
      expect(mounted.start).toBe(start);
      expect(mounted.source).toBe('aXYbc');
      expect(mounted.doc.textContent).toBe('aXYbc');
      const undoSecond = moveNoteDocumentHistory(second.state, 'undo')!;
      const undoFirst = moveNoteDocumentHistory(undoSecond.state, 'undo')!;
      expect(materializeNoteDocumentAuthority(undoFirst.state, fresh.authority).source).toBe('abc');
      expect(reconstruct(undoFirst.state)).toBe(original);
      expect(undoFirst.state.selection).toEqual(session.selection);
      const redoFirst = moveNoteDocumentHistory(undoFirst.state, 'redo')!;
      const redoSecond = moveNoteDocumentHistory(redoFirst.state, 'redo')!;
      expect(materializeNoteDocumentAuthority(redoSecond.state, fresh.authority).source).toBe(
        'aXYbc',
      );
      expect(reconstruct(redoSecond.state)).toBe(expected);
      expect(redoSecond.state.selection).toEqual(second.state.selection);
      for (const replay of [f, fresh]) {
        const reads = replay.requests.filter((q) => q.kind === 'source');
        expect(reads).toHaveLength(1);
        expect(reads[0]).toMatchObject({ at: 65538, maxSourceBytes: 4096 });
        expect(replay.requests).toHaveLength(plainFar.calls.length);
      }
    } finally {
      fresh.editor.destroy();
    }
  } finally {
    f.editor.destroy();
  }
});

it('claims a resource grant once before the first detail read', () => {
  const f = controlledDetails();
  let claims = 0;
  const claim = f.grant.claim;
  f.grant.claim = () => {
    claims++;
    return claim();
  };
  const first = f.steps();
  expect(first.next().done).toBe(false);
  expect(claims).toBe(1);
  expect(() => f.steps().next()).toThrow('resource grant already claimed');
  expect(claims).toBe(2);
  expect(first.next(f.replies['opaque-directory']).done).toBe(false);
  expect(claims).toBe(2);
});

it('does not refund the resource grant after resolver cancellation', () => {
  const f = controlledDetails(),
    iterator = f.steps();
  expect(iterator.next().done).toBe(false);
  iterator.return(undefined as never);
  expect(() => f.steps().next()).toThrow('resource grant already claimed');
});

it('does not claim again when constructing an authority from the completed receipt', () => {
  const f = controlledDetails();
  let claims = 0;
  const claim = f.grant.claim;
  f.grant.claim = () => {
    claims++;
    return claim();
  };
  const receipt = f.finish(f.steps());
  const projection = projectNoteWindow(f.window),
    editor = nativeFixtureEditor(projection.content);
  try {
    expect(
      createNoteParagraphEditAuthority(f.window, projection, receipt, editor.state.doc).source,
    ).toBe('abc\r\n');
    expect(claims).toBe(1);
  } finally {
    editor.destroy();
  }
});
