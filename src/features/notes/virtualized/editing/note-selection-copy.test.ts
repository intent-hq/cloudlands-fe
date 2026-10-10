/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { nativeFixtureEditor } from '../__tests__/canonical-table-fixture';
import { SourceProjection } from '../projection/source-projection';
import { NoteEditAuthority } from './note-edit-authority';
import { captureNoteSelectionMarkdown } from './note-selection-markdown-capture';
import { createNoteSelectionCopyOwner } from './note-selection-copy';
import { createNoteDocumentSession } from './note-document-edit-session';
import type { NoteWindowView } from '../note-window-view';
import type { NotePagesState } from '$store/renderer/slices/note-pages/note-pages-types';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';

const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
const rpc = vi.mocked(backendRequest);
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const cleanups: Array<() => void> = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve: () => resolve() };
}

// Controlled mapping/native lease for owner races, with the actual configured
// serializer and Live client. Native view lifetime is tested separately at its seam.
function fixture(from = 1, to = 6, source = 'alpha beta', outputChunk = 2) {
  const sourceLength = Math.max(1000, 100 + source.length);
  const editor = nativeFixtureEditor(`<p>${source}</p>`);
  cleanups.push(() => editor.destroy());
  editor.commands.setTextSelection({ from, to });
  const projection = new SourceProjection(source, 100),
    forward = new Map<number, number>();
  for (let i = 1; i <= source.length + 1; i++) forward.set(i, 99 + i);
  const authority = new NoteEditAuthority(
    scope,
    'r',
    's',
    0,
    source,
    100,
    editor.state.doc,
    [],
    { forward, backward: new Map(forward), original: projection, changes: [] },
    sourceLength,
  );
  const document = createNoteDocumentSession(scope, 'r', sourceLength);
  let state: NotePagesState = a.notePagesReducer(undefined, a.pagePanelOpened('w', 'n', 'p'));
  const note = state.byWorkspaceId.w.notes.n;
  state = {
    ...state,
    byWorkspaceId: {
      w: {
        notes: {
          n: {
            ...note,
            status: 'ready',
            document,
            state: {
              kind: 'notePageState',
              scope,
              sourceRevision: 'r',
              commentRevision: 'c',
              attributionGeneration: 'a',
              attributionState: 'ready',
              stateGeneration: '0',
              invalidation: 'all',
              deleted: false,
            },
          },
        },
      },
    },
  };
  const listeners = new Set<() => void>(),
    nativeListeners = new Set<() => void>();
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    for (const f of listeners) f();
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 5_000_000,
      stringUnits: 5_000_000,
      objectNodes: 1_000_000,
      physicalReads: 1,
      assemblies: 1,
      domNodes: 0,
    }),
  );
  let alive = true,
    epoch = 7,
    selectionGeneration = 9,
    revoked = false,
    output = '',
    published: string | undefined;
  let clock = Date.now();
  const expiry = new Date(clock + 300000).toISOString();
  const release = vi.fn(),
    borrow = vi.fn((identity, current) => {
      expect(state.resourceLedger.used.physicalReads).toBe(1);
      const capture = captureNoteSelectionMarkdown(editor.view, {
        authority,
        identity,
        selection: { anchor: 99 + from, head: 99 + to, anchorAffinity: 1, headAffinity: -1 },
        current,
        now: () => clock,
      });
      return {
        capture,
        current: () => !revoked && current(),
        release,
        subscribe: (changed: () => void) => {
          nativeListeners.add(changed);
          return () => nativeListeners.delete(changed);
        },
      };
    });
  const view = {
    window: { scope, sourceRevision: 'r', snapshotId: 's', expiresAt: expiry },
    get selectionCaptureGeneration() {
      return epoch;
    },
    borrowSelectionMarkdown: borrow,
  } as unknown as NoteWindowView;
  const sink = {
    write: vi.fn(async (s: string) => {
      output += s;
    }),
    commit: vi.fn(async () => {
      published = output;
    }),
    abort: vi.fn(async () => {}),
  };
  let identity: Record<string, any>,
    payload: unknown,
    offset = 0;
  const streams = ['text', 'dirty', 'selection', 'mutation', 'live'].map((stream) => ({
    stream,
    nextSequence: 0,
    lastDigest: null as string | null,
  }));
  const texts = new Map<string, string>(),
    selected: any[] = [],
    live: any[] = [];
  const stage = (phase: string) => ({
    kind: 'noteStageState',
    scope,
    operationId: identity.operationId,
    headerDigest: identity.headerDigest,
    baseRevision: 'r',
    expiresAt: identity.expiresAt,
    phase,
    streams: streams.map((s) => ({ ...s })),
    ...(phase === 'sealed' ? { payloadDigest: payload, viewLength: sourceLength } : {}),
  });
  const respond = async (method: string, raw: unknown): Promise<any> => {
    expect(state.resourceLedger.used.physicalReads).toBe(1);
    const p = raw as Record<string, any>;
    if (method === 'note.operation.begin') {
      const { headerDigest, ...rest } = p;
      expect(headerDigest).toBe(hash({ method, ...rest }));
      identity = p;
      expect(p.header).toEqual({
        baseRevision: 'r',
        editorSessionId: 'editor',
        localEditSequence: 0,
        liveGeneration: 7,
        selectionGeneration: 9,
        action: 'read',
        output: 'selectionMarkdown',
        selection: 'ranges',
      });
      expect(p).not.toHaveProperty('expectedOutput');
      return stage('staging');
    }
    expect(p.headerDigest).toBe(identity.headerDigest);
    if (method === 'note.operation.append') {
      const { stream, sequence, previousDigest, records, chunkDigest } = p;
      expect(chunkDigest).toBe(hash({ stream, sequence, previousDigest, records }));
      const s = streams.find((s) => s.stream === stream)!;
      expect(sequence).toBe(s.nextSequence);
      expect(previousDigest).toBe(s.lastDigest);
      for (const r of records) {
        if (stream === 'text') {
          expect(r.offset).toBe(0);
          texts.set(r.id, r.text);
          expect(r.text).toBe(canonical(JSON.parse(r.text)));
        } else (stream === 'live' ? live : selected).push(r);
      }
      s.nextSequence++;
      s.lastDigest = chunkDigest;
      return {
        kind: 'noteStageAck',
        scope,
        operationId: p.operationId,
        stream,
        sequence,
        chunkDigest,
        nextSequence: s.nextSequence,
      };
    }
    if (method === 'note.operation.seal') {
      expect(p.payloadDigest).toBe(hash({ headerDigest: p.headerDigest, manifest: p.manifest }));
      payload = p.payloadDigest;
      expect(p.manifest.map((m: any) => [m.stream, m.records])).toEqual([
        ['text', 6],
        ['dirty', 0],
        ['selection', 1],
        ['mutation', 0],
        ['live', 2],
      ]);
      for (const r of live) {
        const t = texts.get(r.detail.textId)!;
        expect(r.detail).toEqual({
          textId: r.detail.textId,
          length: t.length,
          utf8Bytes: Buffer.byteLength(t),
          sha256: createHash('sha256').update(t).digest('hex'),
        });
      }
      return stage('sealed');
    }
    if (method === 'note.operation.cancel') return stage('cancelled');
    expect(method).toBe('note.operation.read');
    expect(p.kind).toBe('selectionMarkdown');
    expect(p).not.toHaveProperty('payloadDigest');
    const expected = source.slice(Math.min(from, to) - 1, Math.max(from, to) - 1).trim();
    const text = expected.slice(offset, offset + outputChunk),
      start = offset;
    offset += text.length;
    return {
      kind: 'noteOperationPage',
      scope,
      operationId: identity.operationId,
      headerDigest: identity.headerDigest,
      payloadDigest: payload,
      viewId: 'view',
      outputKind: 'selectionMarkdown',
      sourceLength,
      expiresAt: identity.expiresAt,
      items: [{ offset: start, text }],
      nextCursor: offset === expected.length ? null : `cursor-${offset}`,
    };
  };
  rpc.mockImplementation(respond);
  const options = {
    port: {
      read: () => state,
      dispatch,
      subscribe: (f: () => void) => {
        listeners.add(f);
        return () => listeners.delete(f);
      },
    },
    client: new LiveNotePagesClient(),
    workspaceId: 'w',
    noteId: 'n',
    editorSessionId: 'editor',
    view: () => view,
    selectionGeneration: () => selectionGeneration,
    current: () => alive,
    openSink: vi.fn(async () => sink),
    now: () => clock,
  };
  const owner = createNoteSelectionCopyOwner(options);
  return {
    owner,
    options,
    sink,
    borrow,
    release,
    respond,
    texts,
    selected,
    live,
    dispatch,
    read: () => state,
    notify: () => {
      for (const f of listeners) f();
    },
    published: () => published,
    nativeLose: () => {
      revoked = true;
      epoch++;
      for (const f of nativeListeners) f();
    },
    lose: () => {
      alive = false;
      for (const f of listeners) f();
      alive = true;
      for (const f of listeners) f();
    },
    advance: () => {
      clock += 300000;
      for (const f of listeners) f();
    },
    select: () => {
      selectionGeneration++;
      for (const f of listeners) f();
    },
    debt: () => state.resourceLedger.used.physicalReads,
    listeners: () => listeners.size + nativeListeners.size,
  };
}

it.each([
  [1, 6, 'forward'],
  [6, 1, 'backward'],
] as const)(
  'uploads configured selection and explicit native descriptors (%s,%s)',
  async (from, to, direction) => {
    const f = fixture(from, to);
    expect(await f.owner.copySelection()).toBe('copied');
    expect(f.published()).toBe('alpha');
    expect(f.selected).toEqual([
      {
        kind: 'range',
        ordinal: 0,
        start: 100,
        end: 105,
        anchorAffinity: 'after',
        headAffinity: 'before',
        direction,
      },
    ]);
    expect(f.live.map((r) => [r.ordinal, r.role, r.sourceRange])).toEqual([
      [0, 'selection-owner', { start: 100, end: 110 }],
      [1, 'inline-span', { start: 100, end: 105 }],
    ]);
    expect(JSON.parse(f.texts.get('paragraph-descriptor')!)).toEqual({
      version: 1,
      nodeType: 'paragraph',
      parentOrdinal: null,
      nativeRange: { from: 0, to: 12 },
      attributesRef: 'paragraph-attrs',
    });
    expect(JSON.parse(f.texts.get('text-descriptor')!).attributesRef).toBe('text-attrs');
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.debt()).toBe(0);
    expect(f.listeners()).toBe(0);
  },
);
it.each([
  [3, 3],
  [6, 7],
])('returns noCopy for collapsed or whitespace selection before RPC/sink', async (from, to) => {
  const f = fixture(from, to);
  expect(await f.owner.copySelection()).toBe('noCopy');
  expect(rpc).not.toHaveBeenCalled();
  expect(f.options.openSink).not.toHaveBeenCalled();
  expect(f.debt()).toBe(0);
});
it('denies DATA before native capture or RPC', async () => {
  const f = fixture();
  f.dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 0,
      stringUnits: 0,
      objectNodes: 0,
      physicalReads: 0,
      assemblies: 0,
      domNodes: 0,
    }),
  );
  await expect(f.owner.copySelection()).rejects.toThrow();
  expect(f.borrow).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
  expect(f.debt()).toBe(0);
});
it.each([
  'scope',
  'header',
  'payload',
  'view',
  'kind',
  'sourceLength',
  'expiry',
  'offset',
  'text',
  'terminal',
] as const)('refuses malformed %s without publication', async (field) => {
  const f = fixture();
  rpc.mockImplementation(async (method, p) => {
    const v = await f.respond(method, p);
    if (method === 'note.operation.read') {
      if (field === 'scope') v.scope = { ...scope, noteId: 'foreign' };
      if (field === 'header') v.headerDigest = '0'.repeat(64);
      if (field === 'payload') v.payloadDigest = '0'.repeat(64);
      if (field === 'view') v.viewId = '';
      if (field === 'kind') v.outputKind = 'source';
      if (field === 'sourceLength') v.sourceLength = 5;
      if (field === 'expiry') v.expiresAt = '2099-01-01T00:00:00.000Z';
      if (field === 'offset') v.items[0].offset = 1;
      if (field === 'text') v.items[0].text = 'XX';
      if (field === 'terminal') v.nextCursor = null;
    }
    return v;
  });
  await expect(f.owner.copySelection()).rejects.toThrow();
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.debt()).toBe(0);
});
it.each(['open', 'read', 'write', 'cancel'] as const)(
  'retains DATA through held %s and irreversible owner loss',
  async (phase) => {
    const f = fixture(),
      entered = deferred(),
      held = deferred();
    if (phase === 'open')
      f.options.openSink.mockImplementation(async () => {
        entered.resolve();
        await held.promise;
        return f.sink;
      });
    if (phase === 'write')
      f.sink.write.mockImplementation(async () => {
        entered.resolve();
        await held.promise;
      });
    if (phase === 'read' || phase === 'cancel')
      rpc.mockImplementation(async (method, p) => {
        const v = await f.respond(method, p);
        if (method === `note.operation.${phase}`) {
          entered.resolve();
          await held.promise;
        }
        return v;
      });
    const pending = f.owner.copySelection();
    const result = expect(pending).rejects.toThrow();
    await entered.promise;
    f.lose();
    expect(f.debt()).toBe(1);
    held.resolve();
    await result;
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.debt()).toBe(0);
    expect(f.listeners()).toBe(0);
  },
);
it('preserves Unsupported and cancels staging with no source fallback', async () => {
  const f = fixture();
  rpc.mockImplementation(async (method, p) => {
    if (method === 'note.operation.read') throw new Error('Unsupported');
    return f.respond(method, p);
  });
  await expect(f.owner.copySelection()).rejects.toThrow('Unsupported');
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.debt()).toBe(0);
  expect(
    rpc.mock.calls
      .filter((c) => c[0] === 'note.operation.read')
      .every((c) => (c[1] as any).kind === 'selectionMarkdown'),
  ).toBe(true);
});
it('forwards native cancellation while commit preparation is pending and retains debt', async () => {
  const f = fixture(),
    entered = deferred(),
    held = deferred();
  f.sink.commit.mockImplementation(async () => {
    entered.resolve();
    await held.promise;
    throw new Error('cancelled before native');
  });
  const pending = f.owner.copySelection();
  const result = expect(pending).rejects.toThrow('cancelled before native');
  await entered.promise;
  f.nativeLose();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.debt()).toBe(1);
  held.resolve();
  await result;
  expect(f.debt()).toBe(0);
  expect(f.listeners()).toBe(0);
});

it('latches loss and revival during digest before the first RPC', async () => {
  const f = fixture(),
    entered = deferred(),
    held = deferred();
  const original = crypto.subtle.digest.bind(crypto.subtle);
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
    entered.resolve();
    await held.promise;
    return original(...args);
  });
  try {
    const pending = f.owner.copySelection(),
      result = expect(pending).rejects.toThrow();
    await entered.promise;
    f.lose();
    expect(f.debt()).toBe(1);
    held.resolve();
    await result;
    expect(rpc).not.toHaveBeenCalled();
    expect(f.debt()).toBe(0);
    expect(f.sink.abort).toHaveBeenCalledOnce();
  } finally {
    spy.mockRestore();
  }
});
it.each(['selection', 'deadline'] as const)(
  'refuses %s loss during read and settles physical DATA',
  async (reason) => {
    const f = fixture(),
      entered = deferred(),
      held = deferred();
    rpc.mockImplementation(async (method, p) => {
      const v = await f.respond(method, p);
      if (method === 'note.operation.read') {
        entered.resolve();
        await held.promise;
      }
      return v;
    });
    const pending = f.owner.copySelection(),
      result = expect(pending).rejects.toThrow();
    await entered.promise;
    if (reason === 'selection') f.select();
    else f.advance();
    expect(f.debt()).toBe(1);
    held.resolve();
    await result;
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.debt()).toBe(0);
  },
);
it('lost append acknowledgement cleans up the accepted remote tail', async () => {
  const f = fixture();
  let lost = false;
  rpc.mockImplementation(async (method, p) => {
    const v = await f.respond(method, p);
    if (method === 'note.operation.append' && !lost) {
      lost = true;
      throw new Error('Lost ACK');
    }
    return v;
  });
  await expect(f.owner.copySelection()).rejects.toThrow('Lost ACK');
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.append')).toHaveLength(1);
  expect(rpc.mock.calls.some(([m]) => m === 'note.operation.cancel')).toBe(true);
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.debt()).toBe(0);
});
it('cancel failure after output EOF prevents publication', async () => {
  const f = fixture();
  rpc.mockImplementation(async (method, p) => {
    if (method === 'note.operation.cancel') throw new Error('Cancel failed');
    return f.respond(method, p);
  });
  await expect(f.owner.copySelection()).rejects.toThrow('Cancel failed');
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.debt()).toBe(0);
});
it('unknown publication acknowledgement is not retried or reported as success', async () => {
  const f = fixture();
  f.sink.commit.mockRejectedValue(new Error('Unknown publication'));
  await expect(f.owner.copySelection()).rejects.toThrow('Unknown publication');
  expect(f.sink.commit).toHaveBeenCalledOnce();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.debt()).toBe(0);
});
it('native cancellation during acknowledged publication never retries commit', async () => {
  const f = fixture(),
    entered = deferred(),
    held = deferred();
  f.sink.commit.mockImplementation(async () => {
    entered.resolve();
    await held.promise;
  });
  const pending = f.owner.copySelection();
  await entered.promise;
  f.nativeLose();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.debt()).toBe(1);
  held.resolve();
  expect(await pending).toBe('copied');
  expect(f.sink.commit).toHaveBeenCalledOnce();
  expect(f.debt()).toBe(0);
});

it('refuses a changed document after an executable current predicate', async () => {
  const f = fixture(),
    entered = deferred(),
    held = deferred();
  f.options.openSink.mockImplementation(async () => {
    entered.resolve();
    await held.promise;
    return f.sink;
  });
  const pending = f.owner.copySelection(),
    result = expect(pending).rejects.toThrow();
  await entered.promise;
  const old = f.options.port.read();
  let state = old;
  f.options.port.read = () => state;
  f.options.current = () => {
    const n = old.byWorkspaceId.w.notes.n;
    state = {
      ...old,
      byWorkspaceId: {
        w: {
          notes: {
            n: { ...n, document: { ...n.document!, generation: n.document!.generation + 1 } },
          },
        },
      },
    };
    return true;
  };
  held.resolve();
  await result;
  expect(rpc).not.toHaveBeenCalled();
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledOnce();
  expect(f.debt()).toBe(0);
});

it.each(['draft', 'checkpoint-length', 'checkpoint-sequence', 'document-history'] as const)(
  'latches in-place %s changes while opening the sink, even after restoration',
  async (kind) => {
    const f = fixture(),
      entered = deferred(),
      held = deferred();
    const old = f.read().byWorkspaceId.w.notes.n;
    const drafts: typeof old.drafts = [],
      checkpoint = [{ sequence: 0 }] as typeof old.history;
    const history: NonNullable<typeof old.document>['history'] = [];
    const document = { ...old.document!, history };
    f.options.port.read = () => {
      const state = f.read(),
        n = state.byWorkspaceId.w.notes.n;
      return {
        ...state,
        byWorkspaceId: { w: { notes: { n: { ...n, drafts, history: checkpoint, document } } } },
      };
    };
    f.options.openSink.mockImplementation(async () => {
      entered.resolve();
      await held.promise;
      return f.sink;
    });
    const pending = f.owner.copySelection(),
      result = expect(pending).rejects.toThrow();
    await entered.promise;
    if (kind === 'draft') drafts.push({} as (typeof drafts)[number]);
    if (kind === 'checkpoint-length')
      checkpoint.push({ sequence: 1 } as (typeof checkpoint)[number]);
    if (kind === 'checkpoint-sequence') checkpoint[0].sequence = 1;
    if (kind === 'document-history') history.push({} as (typeof history)[number]);
    f.notify();
    drafts.length = 0;
    checkpoint.length = 1;
    checkpoint[0].sequence = 0;
    history.length = 0;
    f.notify();
    expect(f.debt()).toBe(1);
    held.resolve();
    await result;
    expect(rpc).not.toHaveBeenCalled();
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.sink.abort).toHaveBeenCalledOnce();
    expect(f.debt()).toBe(0);
    expect(f.listeners()).toBe(0);
  },
);

it('refuses a missing original window expiry before admission or native capture', async () => {
  const f = fixture();
  f.options.view().window!.expiresAt = undefined;
  await expect(f.owner.copySelection()).rejects.toThrow('Invalid selection capture identity');
  expect(f.borrow).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
  expect(f.options.openSink).not.toHaveBeenCalled();
  expect(f.debt()).toBe(0);
});

it('streams a supported paragraph through three exactly bounded selection requests', async () => {
  const source = 'a'.repeat(2050),
    f = fixture(1, 2051, source, 1024);
  expect(await f.owner.copySelection()).toBe('copied');
  expect(f.published()).toBe(source);
  const reads = rpc.mock.calls
    .filter(([method]) => method === 'note.operation.read')
    .map(([, p]) => p);
  expect(reads).toHaveLength(3);
  expect(reads.map((p) => (p as any).cursor)).toEqual([undefined, 'cursor-1024', 'cursor-2048']);
  for (const params of reads)
    expect(params).toMatchObject({
      kind: 'selectionMarkdown',
      maxSourceBytes: 1024,
      maxWireBytes: 8192,
      maxItems: 64,
    });
  expect(f.sink.write.mock.calls.map(([text]) => text.length)).toEqual([1024, 1024, 2]);
  expect(f.sink.commit).toHaveBeenCalledOnce();
  expect(f.debt()).toBe(0);
});
it('refuses an otherwise matching selection fragment over the actual requested byte budget', async () => {
  const f = fixture(1, 2051, 'a'.repeat(2050), 1025);
  await expect(f.owner.copySelection()).rejects.toThrow('Staged source page exceeded');
  expect(f.sink.write).not.toHaveBeenCalled();
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.debt()).toBe(0);
});
