/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { appClient } from '$lib/client';
import { MockNotePagesClient } from '$lib/client/mock/mock-note-pages-client';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { notePagesSaga } from '$store/renderer/slices/note-pages/sagas/note-pages-saga';
import { readNoteWindow } from '../note-window-reader';
import { noteAssemblyResources } from '../note-assembly-reservation';
import { NoteWindowView } from '../note-window-view';
import { prepareNoteParagraphContext } from './note-paragraph-edit-context';
import { createNoteDocumentTransactionOwner } from './note-document-transaction-owner';
import { createNoteRenderedSearchOwner } from './note-rendered-search';
import capture from './__fixtures__/note-paragraph/plain-paragraph-far.json';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';

const original = appClient.notes.pages;
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  appClient.notes.pages = original;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
// Original Store page objects feed the actual reader, prepared context, configured
// view and capture. Staged output responses below are controlled transport, not
// daemon execution or an OS clipboard test.
async function fixture() {
  const calls = capture.calls as unknown as { request: NotePageRequest; response: NoteReadPage }[];
  const identity = calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing source');
  const now = Date.parse(identity.expiresAt) - 10_000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const reader = new NotePageReader(async (_method, params) => {
    const q = params.page as NotePageRequest;
    const found = calls.find(
      ({ request: r }) =>
        r.kind === q.kind &&
        r.cursor === q.cursor &&
        r.maxWireBytes === q.maxWireBytes &&
        r.maxItems === q.maxItems &&
        (q.kind === 'context'
          ? r.kind === 'context' && r.contextRef === q.contextRef
          : q.kind === 'source' &&
            r.kind === 'source' &&
            r.at === q.at &&
            r.maxSourceBytes === q.maxSourceBytes),
    );
    if (!found) throw new Error('Uncaptured Store request');
    return found.response;
  });
  const { workspaceId: ws, noteId: id } = identity.scope;
  const window = await readNoteWindow((q) => reader.read(ws, id, q), {
    ...identity,
    at: capture.at,
  });
  let state = a.initialNotePagesState,
    started = false;
  const listeners = new Set<() => void>(),
    channel = stdChannel();
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    for (const f of [...listeners]) f();
    if (started) channel.put(action);
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 100_000_000,
      stringUnits: 100_000_000,
      objectNodes: 100_000_000,
      domNodes: 100000,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  dispatch(a.pagePanelOpened(ws, id, 'p'));
  dispatch(
    a.pageStateReceived(ws, id, 0, {
      kind: 'notePageState',
      scope: identity.scope,
      sourceRevision: identity.sourceRevision,
      stateGeneration: '1',
      attributionGeneration: 'a',
      attributionState: 'ready',
      commentRevision: 'c',
      deleted: false,
      invalidation: 'all',
    }),
  );
  dispatch(a.pageWindowRequested(ws, id, 'p', capture.at));
  const seed = { owner: 'seed', data: 'seed-data', control: 'seed-control' };
  dispatch(a.pageResourcesRequested(seed.owner, noteAssemblyResources(seed), 12));
  expect(Object.hasOwn(state.resourceLedger.owners, seed.owner)).toBe(true);
  dispatch(
    a.pageWindowSettled(ws, id, 'p', 0, 1, window, null, {
      sponsor: seed.owner,
      resource: seed.data,
      owner: 'window-seed',
    }),
  );
  dispatch(a.pageResourcesReleased(seed.owner));
  const port = {
    read: () => state,
    dispatch,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
  };
  appClient.notes.pages = new MockNotePagesClient({
    capabilities: { backendId: identity.scope.backendId, annotations: false },
    read: (w, n, q) => reader.read(w, n, q),
  });
  started = true;
  const task = runSaga(
    { channel, dispatch, getState: () => ({ notePages: state }) },
    notePagesSaga,
  );
  const offer = prepareNoteParagraphContext(port, window, 'p', undefined, () => now);
  const ready = await offer.ready;
  let sequence = 0,
    selectionGeneration = 0;
  const scroller = document.createElement('div');
  document.body.append(scroller);
  const view = new NoteWindowView(scroller, {
    seek: () => {},
    fullOperation: () => {},
    selectionChanged(selection) {
      selectionGeneration++;
      const n = state.byWorkspaceId[ws].notes[id];
      dispatch(a.pageDocumentSelectionChanged(ws, id, n.generation, n.document!, selection));
    },
    retainWindow(w) {
      const owner = `selection-view:${sequence++}`;
      dispatch(a.pageWindowRetained(ws, id, 'p', 0, w, owner));
      return () => dispatch(a.pageResourcesReleased(owner));
    },
    editing: {
      bind() {
        throw new Error('Expected owned context borrow');
      },
      undo() {},
      redo() {},
      borrow() {
        const lease = ready.borrow();
        return {
          release: lease.release,
          bind(w, p, doc) {
            return createNoteDocumentTransactionOwner(
              lease.create(p, doc),
              () => state.byWorkspaceId[ws].notes[id].document!,
              () => {
                throw new Error('Read-only capture');
              },
            );
          },
        };
      },
    },
  });
  expect(view.show(window)).toBe(true);
  view.setSelection({
    anchor: capture.at + 2,
    head: capture.at,
    anchorAffinity: 1,
    headAffinity: -1,
  });
  let wire: any,
    payload = '',
    serial = 0;
  const resources = new Map<string, unknown[]>();
  const entry = (value: any, parentId: string | null, key?: string): any => {
    const id = `m${serial++}`;
    const common = { id, parentId, ...(key === undefined ? {} : { key }) };
    if (value && typeof value === 'object') {
      const childrenRef = `children-${id}`;
      resources.set(
        childrenRef,
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => entry(v, id, k)),
      );
      return { ...common, type: 'object', childrenRef };
    }
    if (key === 'renderedText' && typeof value === 'string') {
      let offset = 0;
      for (const scalar of value) {
        const next = offset + scalar.length;
        resources.set(`text-${id}-${offset}`, [
          {
            kind: 'fragment',
            id: `value-${id}`,
            field: 'renderedText',
            offset,
            text: scalar,
            nextRef: next === value.length ? null : `text-${id}-${next}`,
          },
        ]);
        offset = next;
      }
      return { ...common, type: 'string', valueRef: `text-${id}-0` };
    }
    return { ...common, type: value === null ? 'null' : typeof value, value };
  };
  const streams = ['text', 'dirty', 'selection', 'mutation', 'live'].map((stream) => ({
    stream,
    nextSequence: 0,
    lastDigest: null as string | null,
  }));
  const records = new Map<string, any[]>();
  const stage = (phase: string) => ({
    kind: 'noteStageState',
    scope: identity.scope,
    operationId: wire.operationId,
    headerDigest: wire.headerDigest,
    baseRevision: identity.sourceRevision,
    expiresAt: wire.expiresAt,
    phase,
    streams: streams.map((s) => ({ ...s })),
    ...(phase === 'sealed' ? { payloadDigest: payload, viewLength: window.sourceLength } : {}),
  });
  const respond = async (method: string, p: any): Promise<any> => {
    if (method === 'note.operation.begin') {
      wire = p;
      return stage('staging');
    }
    if (method === 'note.operation.append') {
      records.set(p.stream, [...(records.get(p.stream) ?? []), ...p.records]);
      const s = streams.find((s) => s.stream === p.stream)!;
      s.nextSequence++;
      s.lastDigest = p.chunkDigest;
      return {
        kind: 'noteStageAck',
        scope: identity.scope,
        operationId: wire.operationId,
        stream: p.stream,
        sequence: p.sequence,
        chunkDigest: p.chunkDigest,
        nextSequence: s.nextSequence,
        expiresAt: wire.expiresAt,
      };
    }
    if (method === 'note.operation.seal') {
      payload = p.payloadDigest;
      const texts = new Map((records.get('text') ?? []).map((r) => [r.id, r.text]));
      const native = texts.get('rendered-leaf');
      expect(native).toBe('abc');
      const parent = JSON.parse(texts.get('paragraph-descriptor'));
      const leaf = JSON.parse(texts.get('text-descriptor'));
      const live = records.get('live')!;
      const range = { start: capture.at, end: capture.at + 1 };
      resources.set('root', [
        entry(
          {
            kind: 'stagedRenderedHit',
            mapping: 'identity',
            sourceRange: range,
            renderedRange: { start: 0, end: 1 },
            parent: {
              ordinal: 0,
              sourceRange: live[0].sourceRange,
              descriptor: parent,
              attributes: {},
            },
            leaf: {
              ordinal: 1,
              sourceRange: live[1].sourceRange,
              descriptor: leaf,
              attributes: {},
              renderedText: native,
            },
          },
          null,
        ),
      ]);
      return stage('sealed');
    }
    if (method === 'note.operation.cancel') return stage('cancelled');
    expect(method).toBe('note.operation.read');
    expect(p.maxItems).toBe(16);
    expect(p.maxSourceBytes).toBe(1024);
    expect(p.maxWireBytes).toBe(8192);
    let items: unknown[],
      nextCursor: string | null = null;
    if (p.kind === 'search') {
      items =
        wire.header.query.text === 'a' &&
        records.get('selection')![0].start !== records.get('selection')![0].end
          ? [
              {
                hitId: 'h',
                sourceRange: { start: capture.at, end: capture.at + 1 },
                detailRef: 'root',
              },
            ]
          : [];
    } else {
      expect(p.kind).toBe('detail');
      const all = resources.get(p.ref);
      if (!all) throw new Error('Unknown view-owned detail');
      const offset = p.cursor ? Number(p.cursor.split(':').at(-1)) : 0;
      items = all.slice(offset, offset + 2);
      nextCursor = offset + 2 < all.length ? `${p.ref}:${offset + 2}` : null;
    }
    return {
      kind: 'noteOperationPage',
      scope: identity.scope,
      operationId: wire.operationId,
      headerDigest: wire.headerDigest,
      payloadDigest: payload,
      viewId: 'controlled-selection-view',
      outputKind: p.kind,
      sourceLength: window.sourceLength,
      expiresAt: wire.expiresAt,
      items,
      nextCursor,
      ...(p.kind === 'search'
        ? { scannedThrough: window.sourceLength, count: { value: items.length, exact: true } }
        : {}),
    };
  };
  vi.mocked(backendRequest).mockImplementation(respond);
  let ownerCheck = () => true;
  const owner = createNoteRenderedSearchOwner({
    port,
    client: new LiveNotePagesClient(),
    workspaceId: ws,
    noteId: id,
    editorSessionId: 'selection-editor',
    view: () => view,
    selectionGeneration: () => selectionGeneration,
    current: () => ownerCheck(),
    now: () => now,
  });
  return {
    owner,
    setCurrent(check: () => boolean) {
      ownerCheck = check;
    },
    view,
    records,
    resources,
    port,
    respond,
    state: () => state,
    async close() {
      view.destroy();
      await offer.release();
      task.cancel();
    },
  };
}

it('binds an actual native whole leaf, v2 upload and paged view-owned hit details', async () => {
  const f = await fixture(),
    pages: any[] = [];
  try {
    await f.owner.searchRendered('a', async (page) => {
      pages.push(page);
      expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    });
    expect(pages).toHaveLength(1);
    expect(pages[0].hits).toEqual([
      {
        hitId: 'h',
        sourceRange: { start: capture.at, end: capture.at + 1 },
        renderedRange: { start: 0, end: 1 },
      },
    ]);
    const texts = new Map(f.records.get('text')!.map((r) => [r.id, r.text]));
    expect(texts.get('rendered-leaf')).toBe('abc');
    expect(JSON.parse(texts.get('text-descriptor')).version).toBe(2);
    expect(f.records.get('live')![1].sourceRange).toEqual({
      start: capture.at,
      end: capture.at + 3,
    });
    expect(f.records.get('selection')![0]).toMatchObject({
      start: capture.at,
      end: capture.at + 2,
      direction: 'backward',
    });
    expect(
      vi.mocked(backendRequest).mock.calls.filter(([m]) => m === 'note.operation.cancel'),
    ).toHaveLength(1);
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    await f.close();
  }
});
for (const query of ['', '\ud800'])
  it('rejects invalid query before RPC: ' + JSON.stringify(query), async () => {
    const f = await fixture();
    vi.mocked(backendRequest).mockClear();
    try {
      await expect(f.owner.searchRendered(query, async () => {})).rejects.toThrow();
      expect(backendRequest).not.toHaveBeenCalled();
      expect(f.state().resourceLedger.used.physicalReads).toBe(0);
    } finally {
      await f.close();
    }
  });
it('treats whitespace as a literal query and collapsed native range as an empty domain', async () => {
  const f = await fixture(),
    pages: any[] = [];
  try {
    f.view.setSelection({
      anchor: capture.at,
      head: capture.at,
      anchorAffinity: 1,
      headAffinity: -1,
    });
    await f.owner.searchRendered(' ', async (p) => {
      pages.push(p);
    });
    expect(pages[0]).toMatchObject({ hits: [], count: { value: 0, exact: true } });
    expect(f.records.get('selection')![0]).toMatchObject({ start: capture.at, end: capture.at });
    expect(
      vi.mocked(backendRequest).mock.calls.find(([m]) => m === 'note.operation.begin')![1],
    ).toMatchObject({
      header: { query: { text: ' ', mode: 'renderedText', caseSensitive: false } },
    });
  } finally {
    await f.close();
  }
});
for (const [name, mutate] of [
  [
    'wrong view',
    (p: any) => {
      p.viewId = 'foreign';
    },
  ],
  [
    'wrong extent',
    (p: any) => {
      p.sourceLength++;
    },
  ],
  [
    'renewed expiry',
    (p: any) => {
      p.expiresAt = '2099-01-01T00:00:00.000Z';
    },
  ],
  [
    'wrong payload',
    (p: any) => {
      p.payloadDigest = '0'.repeat(64);
    },
  ],
] as const)
  it('refuses ' + name + ' in reached detail before delivering a page', async () => {
    const f = await fixture(),
      consume = vi.fn(async () => {});
    vi.mocked(backendRequest).mockImplementation(async (m, p: any) => {
      const r = await f.respond(m, p);
      if (m === 'note.operation.read' && p.kind === 'detail') mutate(r);
      return r;
    });
    try {
      await expect(f.owner.searchRendered('a', consume)).rejects.toThrow();
      expect(consume).not.toHaveBeenCalled();
      expect(f.state().resourceLedger.used.physicalReads).toBe(0);
    } finally {
      await f.close();
    }
  });
for (const [name, mutate] of [
  [
    'outside domain',
    (p: any) => {
      p.items[0].sourceRange.end += 10;
    },
  ],
  [
    'false exact count',
    (p: any) => {
      p.count.value = 2;
    },
  ],
  [
    'nonterminal exact',
    (p: any) => {
      p.nextCursor = 'next';
    },
  ],
  [
    'short frontier',
    (p: any) => {
      p.scannedThrough = 0;
    },
  ],
  [
    'extra hit field',
    (p: any) => {
      p.items[0].nativeNode = 'invented';
    },
  ],
] as const)
  it('refuses ' + name + ' search metadata', async () => {
    const f = await fixture(),
      consume = vi.fn(async () => {});
    vi.mocked(backendRequest).mockImplementation(async (m, p: any) => {
      const r = await f.respond(m, p);
      if (m === 'note.operation.read' && p.kind === 'search') mutate(r);
      return r;
    });
    try {
      await expect(f.owner.searchRendered('a', consume)).rejects.toThrow();
      expect(consume).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
for (const fault of ['inline text', 'wrong text', 'foreign parent', 'cycle', 'missing attrs'])
  it('refuses ' + fault + ' in actual consumer traversal', async () => {
    const f = await fixture(),
      consume = vi.fn(async () => {});
    vi.mocked(backendRequest).mockImplementation(async (m, p: any) => {
      const r = await f.respond(m, p);
      if (m === 'note.operation.read' && p.kind === 'detail')
        for (const item of r.items) {
          if (fault === 'inline text' && item.key === 'renderedText' && item.type === 'string') {
            delete item.valueRef;
            item.value = 'abc';
          }
          if (fault === 'wrong text' && item.field === 'renderedText') item.text = 'x';
          if (fault === 'foreign parent' && item.key === 'mapping') item.parentId = 'foreign';
          if (fault === 'cycle' && item.type === 'object') item.childrenRef = 'root';
          if (fault === 'missing attrs' && item.key === 'attributes') item.key = 'missing';
        }
      return r;
    });
    try {
      await expect(f.owner.searchRendered('a', consume)).rejects.toThrow();
      expect(consume).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
it('retains actual context and read debt through native loss during a held detail read', async () => {
  const f = await fixture(),
    entered = deferred(),
    held = deferred(),
    consume = vi.fn(async () => {});
  vi.mocked(backendRequest).mockImplementation(async (m, p: any) => {
    const r = await f.respond(m, p);
    if (m === 'note.operation.read' && p.kind === 'detail') {
      entered.resolve();
      await held.promise;
    }
    return r;
  });
  try {
    const result = expect(f.owner.searchRendered('a', consume)).rejects.toThrow();
    await entered.promise;
    f.view.destroy();
    expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    expect(
      Object.keys(f.state().resourceLedger.owners).some((x) => x.startsWith('edit-context:')),
    ).toBe(true);
    held.resolve();
    await result;
    expect(consume).not.toHaveBeenCalled();
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    held.resolve();
    await f.close();
  }
});
it('retains debt through a held page consumer, then cancels without a second page', async () => {
  const f = await fixture(),
    entered = deferred(),
    held = deferred();
  try {
    const result = expect(
      f.owner.searchRendered('a', async () => {
        entered.resolve();
        await held.promise;
      }),
    ).rejects.toThrow();
    await entered.promise;
    f.owner.cancelRenderedSearch();
    expect(f.state().resourceLedger.used.physicalReads).toBe(1);
    held.resolve();
    await result;
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
    expect(
      vi.mocked(backendRequest).mock.calls.filter(([m]) => m === 'note.operation.cancel'),
    ).toHaveLength(1);
  } finally {
    held.resolve();
    await f.close();
  }
});

for (const when of ['postcapture', 'later'])
  it('refuses map mutation from ' + when + ' native borrow callback', async () => {
    const f = await fixture();
    const n =
      f.state().byWorkspaceId[f.view.window!.scope.workspaceId].notes[f.view.window!.scope.noteId];
    const authority = f.view.projection! as any,
      original = authority.sourceAt;
    let checks = 0,
      mutate = false;
    let lease: ReturnType<NoteWindowView['borrowRenderedSearch']> | undefined;
    const borrow = () =>
      f.view.borrowRenderedSearch(
        {
          scope: authority.scope,
          sourceRevision: authority.sourceRevision,
          snapshotId: authority.snapshotId,
          documentGeneration: n.document!.generation,
          liveGeneration: f.view.selectionCaptureGeneration,
          selectionGeneration: 0,
          expiresAt: f.view.window!.expiresAt!,
        },
        { text: 'a', caseSensitive: false, mode: 'renderedText' },
        () => {
          checks++;
          if ((when === 'postcapture' && checks === 4) || mutate) authority.sourceAt = () => 999;
          return true;
        },
      );
    try {
      if (when === 'postcapture') {
        expect(borrow).toThrow();
        expect(checks).toBeGreaterThanOrEqual(4);
      } else {
        lease = borrow();
        mutate = true;
        expect(lease.current()).toBe(false);
        authority.sourceAt = original;
        mutate = false;
        expect(lease.current()).toBe(false);
      }
    } finally {
      authority.sourceAt = original;
      lease?.release();
      await f.close();
    }
  });
it('queued DATA admission performs zero upload RPC and leaves no queued owner', async () => {
  const f = await fixture();
  f.port.dispatch(
    a.pageResourcesRequested(
      'busy-read',
      [
        {
          id: 'busy-read',
          cost: {
            payloadBytes: 0,
            stringUnits: 0,
            objectNodes: 0,
            domNodes: 0,
            physicalReads: 1,
            assemblies: 0,
          },
        },
      ],
      1,
    ),
  );
  expect(f.state().resourceLedger.used.physicalReads).toBe(1);
  vi.mocked(backendRequest).mockClear();
  try {
    await expect(f.owner.searchRendered('a', async () => {})).rejects.toThrow();
    expect(backendRequest).not.toHaveBeenCalled();
    expect(f.state().resourceLedger.pending).toHaveLength(0);
  } finally {
    f.port.dispatch(a.pageResourcesReleased('busy-read'));
    await f.close();
  }
});

it('continues an empty work-limited page before a validated terminal hit', async () => {
  const f = await fixture(),
    pages: any[] = [];
  vi.mocked(backendRequest).mockImplementation(async (m, p: any) => {
    const r = await f.respond(m, p);
    if (m === 'note.operation.read' && p.kind === 'search' && !p.cursor) {
      r.items = [];
      r.nextCursor = 'work-next';
      r.scannedThrough = capture.at;
      r.count = { value: 0, exact: false };
    }
    return r;
  });
  try {
    await f.owner.searchRendered('a', async (p) => {
      pages.push(p);
    });
    expect(pages.map((p) => [p.hits.length, p.count.exact])).toEqual([
      [0, false],
      [1, true],
    ]);
    expect(
      vi
        .mocked(backendRequest)
        .mock.calls.filter(([m, p]: any) => m === 'note.operation.read' && p.kind === 'search')
        .map(([, p]: any) => p.cursor),
    ).toEqual([undefined, 'work-next']);
  } finally {
    await f.close();
  }
});
for (const field of ['drafts', 'history'] as const)
  it('latches in-place ' + field + ' loss and restoration during current predicate', async () => {
    const f = await fixture();
    let checks = 0;
    f.setCurrent(() => {
      if (++checks === 2) {
        f.setCurrent(() => true);
        const n =
          f.state().byWorkspaceId[f.view.window!.scope.workspaceId].notes[
            f.view.window!.scope.noteId
          ];
        (n[field] as any[]).push({ sequence: 1 });
        f.port.dispatch(a.pageResourcesReleased('notify-only'));
        (n[field] as any[]).pop();
      }
      return true;
    });
    vi.mocked(backendRequest).mockClear();
    try {
      await expect(f.owner.searchRendered('a', async () => {})).rejects.toThrow();
      expect(backendRequest).not.toHaveBeenCalled();
      expect(f.state().resourceLedger.used.physicalReads).toBe(0);
    } finally {
      await f.close();
    }
  });
it('lost append acknowledgement cancels the exact operation without stale manifest assumptions', async () => {
  const f = await fixture(),
    consume = vi.fn(async () => {});
  vi.mocked(backendRequest).mockImplementation(async (m, p: any) => {
    const result = await f.respond(m, p);
    if (m === 'note.operation.append') throw new Error('lost ack');
    return result;
  });
  try {
    await expect(f.owner.searchRendered('a', consume)).rejects.toThrow('lost ack');
    expect(consume).not.toHaveBeenCalled();
    expect(
      vi.mocked(backendRequest).mock.calls.filter(([m]) => m === 'note.operation.cancel'),
    ).toHaveLength(1);
    expect(f.state().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    await f.close();
  }
});
