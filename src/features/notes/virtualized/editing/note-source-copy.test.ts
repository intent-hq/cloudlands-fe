import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceClipboard } from '$features/system/main/source-clipboard';
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn(), isElectron: () => true }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';
import { createNoteSourceOperation } from '$lib/client/note-source-operation';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import type { NotePagesState } from '$store/renderer/slices/note-pages/note-pages-types';
import { createNoteDocumentSession, moveNoteDocumentHistory } from './note-document-edit-session';
import { composeNoteEdits } from './note-edit-plan';
import { createNoteSourceCopyOwner } from './note-source-copy';

const scope = { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' };
const rpc = vi.mocked(backendRequest);
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
};
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const rawHash = (v: string) => createHash('sha256').update(v).digest('hex');
function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((r) => {
      resolve = r;
    }),
    resolve: () => resolve(),
  };
}
beforeEach(() => vi.clearAllMocks());
function fixture(text = 'X', pages = 1) {
  let state: NotePagesState = a.notePagesReducer(undefined, a.pagePanelOpened('w', 'n', 'panel'));
  const draft = {
    scope,
    sequence: 7,
    baseRevision: 'r1',
    splices: [{ start: 1, end: 1, text }],
    selection: {
      anchor: 2,
      head: 2,
      anchorAffinity: 'after' as const,
      headAffinity: 'after' as const,
    },
  };
  const second = {
    ...draft,
    sequence: 8,
    splices: [{ start: 2 + text.length, end: 2 + text.length, text: 'Y' }],
  };
  const doc = createNoteDocumentSession(scope, 'r1', 3);
  doc.generation = 2;
  doc.length += text.length + 1;
  doc.dirty = composeNoteEdits(3, [draft, second]);
  doc.history = [
    {
      id: 7,
      beforeLength: 3,
      forward: draft.splices,
      inverse: [{ start: 1, end: 1 + text.length, text: '' }],
      forwardReplay: [],
      inverseReplay: [],
      before: doc.selection,
      after: doc.selection,
    },
    {
      id: 8,
      beforeLength: 3 + text.length,
      forward: second.splices,
      inverse: [{ start: 2 + text.length, end: 3 + text.length, text: '' }],
      forwardReplay: [],
      inverseReplay: [],
      before: doc.selection,
      after: doc.selection,
    },
  ];
  doc.cursor = 2;
  state = {
    ...state,
    byWorkspaceId: {
      w: {
        notes: {
          n: {
            ...state.byWorkspaceId.w.notes.n,
            status: 'ready',
            document: doc,
            drafts: [draft, second],
            history: [second],
            state: {
              kind: 'notePageState',
              scope,
              stateGeneration: '1',
              sourceRevision: 'r1',
              attributionGeneration: '1',
              commentRevision: '1',
              attributionState: 'ready',
              deleted: false,
              invalidation: 'all',
            },
          },
        },
      },
    },
  };
  const listeners = new Set<() => void>();
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    listeners.forEach((f) => f());
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 10_000_000,
      stringUnits: 10_000_000,
      objectNodes: 100_000,
      domNodes: 0,
      physicalReads: 1,
      assemblies: 1,
    }),
  );
  let external = true,
    output = '',
    visible: string | undefined;
  let identity: Record<string, unknown>, payloadDigest: unknown;
  let offset = 0,
    readCalls = 0;
  const streams = ['text', 'dirty', 'selection', 'mutation', 'live'].map((stream) => ({
    stream,
    nextSequence: 0,
    lastDigest: null as string | null,
  }));
  const dirty: unknown[] = [],
    uploaded = new Map<string, string>();
  const complete = `a${text}bYc`;
  const stage = (phase: string) => ({
    kind: 'noteStageState',
    scope,
    operationId: identity.operationId,
    headerDigest: identity.headerDigest,
    baseRevision: 'r1',
    expiresAt: identity.expiresAt,
    phase,
    streams: streams.map((s) => ({ ...s })),
    ...(phase === 'sealed' ? { payloadDigest, viewLength: complete.length } : {}),
  });
  rpc.mockImplementation(async (method, raw) => {
    expect(state.resourceLedger.used.physicalReads).toBe(1);
    expect(state.resourceLedger.used.payloadBytes).toBeGreaterThan(0);
    const p = raw as Record<string, unknown>;
    expect(p).not.toHaveProperty('viewId');
    if (method === 'note.operation.begin') {
      const { headerDigest, ...rest } = p;
      expect(headerDigest).toBe(hash({ method, ...rest }));
      identity = p;
      expect(p.header).toMatchObject({
        action: 'read',
        output: 'source',
        selection: 'all',
        localEditSequence: state.byWorkspaceId.w.notes.n.history.at(-1)?.sequence ?? 0,
      });
      return stage('staging');
    }
    expect(p.headerDigest).toBe(identity.headerDigest);
    if (method === 'note.operation.append') {
      const { stream, sequence, previousDigest, records, chunkDigest } = p;
      expect(chunkDigest).toBe(hash({ stream, sequence, previousDigest, records }));
      const s = streams.find((s) => s.stream === stream)!;
      expect(sequence).toBe(s.nextSequence);
      expect(previousDigest).toBe(s.lastDigest);
      for (const r of records as Array<Record<string, unknown>>) {
        if (stream === 'text') {
          const old = uploaded.get(r.id as string) ?? '';
          expect(r.offset).toBe(old.length);
          uploaded.set(r.id as string, old + r.text);
        } else {
          const ref = r.replacement as {
            textId: string;
            sha256: string;
            length: number;
            utf8Bytes: number;
          };
          const text = uploaded.get(ref.textId)!;
          expect(ref).toEqual({
            textId: ref.textId,
            sha256: rawHash(text),
            length: text.length,
            utf8Bytes: Buffer.byteLength(text),
          });
          dirty.push(r);
        }
      }
      s.nextSequence++;
      s.lastDigest = chunkDigest as string;
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
      payloadDigest = p.payloadDigest;
      expect(
        (p.manifest as Array<{ records: number }>).slice(2).every((m) => m.records === 0),
      ).toBe(true);
      return stage('sealed');
    }
    if (method === 'note.operation.cancel') return stage('cancelled');
    expect(method).toBe('note.operation.read');
    expect(p).toEqual({
      backendId: 'b',
      workspaceId: 'w',
      noteId: 'n',
      noteInstanceId: 'i',
      operationId: identity.operationId,
      headerDigest: identity.headerDigest,
      kind: 'source',
      ...(readCalls ? { cursor: `cursor-${readCalls}` } : {}),
      maxItems: 64,
      maxSourceBytes: 4096,
      maxWireBytes: 8192,
    });
    const end = Math.min(
      complete.length,
      offset + Math.min(1024, Math.ceil(complete.length / pages)),
    );
    const items = [{ offset, text: complete.slice(offset, end) }];
    offset = end;
    readCalls++;
    return {
      kind: 'noteOperationPage',
      scope,
      operationId: identity.operationId,
      headerDigest: identity.headerDigest,
      payloadDigest,
      viewId: 'frozen',
      outputKind: 'source',
      sourceLength: complete.length,
      expiresAt: identity.expiresAt,
      items,
      nextCursor: end === complete.length ? null : `cursor-${readCalls}`,
    };
  });
  const sink = {
    write: vi.fn(async (s: string) => {
      output += s;
    }),
    commit: vi.fn(async () => {
      visible = output;
    }),
    abort: vi.fn(async () => {
      output = '';
    }),
  };
  const options = {
    workspaceId: 'w',
    noteId: 'n',
    editorSessionId: 'editor',
    selectionGeneration: () => 19,
    current: () => external,
    port: {
      read: () => state,
      dispatch,
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
    },
    client: new LiveNotePagesClient(),
    openSink: vi.fn(async () => sink),
  };
  const owner = createNoteSourceCopyOwner(options);
  return {
    owner,
    options,
    sink,
    dirty,
    complete,
    listeners,
    read: () => state,
    dispatch,
    replaceNote(n: typeof state.byWorkspaceId.w.notes.n) {
      state = { ...state, byWorkspaceId: { w: { notes: { n } } } };
      listeners.forEach((f) => f());
    },
    visible: () => visible,
    transition(v: boolean) {
      external = v;
      listeners.forEach((f) => f());
    },
  };
}
it('connects the document-copy callback through real live transport and Redux DATA, retaining chronological captured transaction batches', async () => {
  const f = fixture('x'.repeat(17000));
  const before = f.read().byWorkspaceId.w.notes.n;
  await f.owner.copyDocument();
  expect(f.visible()).toBe(f.complete);
  expect(f.dirty).toMatchObject([
    { localSequence: 7, ordinal: 0 },
    { localSequence: 8, ordinal: 0 },
  ]);
  expect(f.read().byWorkspaceId.w.notes.n).toBe(before);
  expect(f.read().resourceLedger.used.payloadBytes).toBe(0);
  expect(f.listeners.size).toBe(0);
  expect(rpc.mock.calls.some(([m]) => m === 'note.operation.commit')).toBe(false);
});
it('drains more than 96 pages without a retained output collection in the owner', async () => {
  const f = fixture('x'.repeat(600), 300);
  await f.owner.copyDocument();
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.read').length).toBeGreaterThan(96);
  expect(f.visible()).toBe(f.complete);
});
it('holds DATA and the exclusive copy owner until asynchronous publication acknowledges', async () => {
  const f = fixture(),
    entered = deferred(),
    held = deferred();
  const publish = f.sink.commit.getMockImplementation();
  if (!publish) throw new Error('Missing fixture publisher');
  f.sink.commit.mockImplementation(async () => {
    entered.resolve();
    await held.promise;
    await publish();
  });
  let settled = false;
  const pending = f.owner.copyDocument().then(() => {
    settled = true;
  });
  await entered.promise;
  expect(settled).toBe(false);
  expect(f.visible()).toBeUndefined();
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  expect(f.listeners.size).toBe(1);
  await expect(f.owner.copyDocument()).rejects.toThrow('already in progress');
  f.owner.cancelCopy();
  f.transition(false);
  f.transition(true);
  expect(f.sink.abort).not.toHaveBeenCalled();
  held.resolve();
  await pending;
  expect(f.visible()).toBe(f.complete);
  expect(f.sink.commit).toHaveBeenCalledOnce();
  expect(f.sink.abort).not.toHaveBeenCalled();
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
  expect(f.listeners.size).toBe(0);
});
it('observes asynchronous publication failure and holds DATA through private staging cleanup', async () => {
  const f = fixture(),
    entered = deferred(),
    held = deferred(),
    cleanupEntered = deferred(),
    cleanupHeld = deferred();
  f.sink.commit.mockImplementation(async () => {
    entered.resolve();
    await held.promise;
    throw new Error('Publication acknowledgement lost');
  });
  f.sink.abort.mockImplementation(async () => {
    cleanupEntered.resolve();
    await cleanupHeld.promise;
    throw new Error('Private staging cleanup failed');
  });
  const pending = f.owner.copyDocument();
  const refused = expect(pending).rejects.toThrow('Publication acknowledgement lost');
  await entered.promise;
  expect(f.sink.abort).not.toHaveBeenCalled();
  held.resolve();
  await cleanupEntered.promise;
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  expect(f.listeners.size).toBe(1);
  cleanupHeld.resolve();
  await refused;
  expect(f.visible()).toBeUndefined();
  expect(f.sink.commit).toHaveBeenCalledOnce();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
  expect(f.listeners.size).toBe(0);
});
it('does not retract published output after a lost acknowledgement', async () => {
  const f = fixture();
  const publish = f.sink.commit.getMockImplementation();
  if (!publish) throw new Error('Missing fixture publisher');
  f.sink.commit.mockImplementation(async () => {
    await publish();
    throw new Error('Publication acknowledgement lost');
  });
  await expect(f.owner.copyDocument()).rejects.toThrow('Publication acknowledgement lost');
  expect(f.visible()).toBe(f.complete);
  expect(f.sink.commit).toHaveBeenCalledOnce();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
  expect(f.listeners.size).toBe(0);
});
it('retains DATA through a held sink and refuses ownership revival without publishing', async () => {
  const f = fixture(),
    entered = deferred(),
    held = deferred();
  f.sink.write.mockImplementation(async () => {
    entered.resolve();
    await held.promise;
  });
  const pending = f.owner.copyDocument();
  const refused = expect(pending).rejects.toThrow(/superseded/);
  await entered.promise;
  f.transition(false);
  f.transition(true);
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await refused;
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
  expect(f.listeners.size).toBe(0);
});
it('refuses an unavailable atomic sink before the first RPC', async () => {
  const f = fixture();
  f.options.openSink.mockRejectedValue(new Error('Unsupported clipboard sink'));
  await expect(f.owner.copyDocument()).rejects.toThrow('Unsupported');
  expect(rpc).not.toHaveBeenCalled();
  expect(f.read().resourceLedger.used.payloadBytes).toBe(0);
});
it.each(['wrong-kind', 'wrong-offset', 'wrong-view', 'early-terminal'])(
  'discards output on %s without note mutation',
  async (failure) => {
    const f = fixture('xxx', 5),
      original = rpc.getMockImplementation()!;
    let reads = 0;
    rpc.mockImplementation(async (...args) => {
      const result = (await original(...args)) as Record<string, unknown>;
      if (args[0] === 'note.operation.read') {
        reads++;
        if (failure === 'wrong-kind') result.outputKind = 'selectionMarkdown';
        if (failure === 'wrong-offset') result.items = [{ offset: 1, text: 'a' }];
        if (failure === 'wrong-view' && reads === 2) result.viewId = 'other';
        if (failure === 'early-terminal') result.nextCursor = null;
      }
      return result;
    });
    await expect(f.owner.copyDocument()).rejects.toThrow();
    expect(f.visible()).toBeUndefined();
    expect(f.sink.abort).toHaveBeenCalledOnce();
    expect(f.read().resourceLedger.used.payloadBytes).toBe(0);
  },
);
it('rejects selected output instead of silently uploading a source header', () => {
  expect(() =>
    createNoteSourceOperation(
      rpc,
      {
        scope,
        operationId: '00000000-0000-0000-0000-000000000000',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        header: {
          baseRevision: 'r1',
          editorSessionId: 'e',
          localEditSequence: 0,
          liveGeneration: 0,
          selectionGeneration: 0,
          action: 'read',
          output: 'selectionMarkdown' as 'source',
          selection: 'all',
        },
      },
      () => true,
    ),
  ).toThrow('Unsupported');
  expect(rpc).not.toHaveBeenCalled();
});

it('uploads scalar-safe chunk seams and empty replacement IDs without losing exact bytes', async () => {
  const f = fixture('x'.repeat(4095) + '😀');
  await f.owner.copyDocument();
  expect(f.visible()).toBe(f.complete);
  const chunks = rpc.mock.calls.filter(
    ([m, p]) => m === 'note.operation.append' && (p as { stream: string }).stream === 'text',
  );
  expect((chunks[0][1] as { records: { text: string }[] }).records[0].text).toHaveLength(4095);
  const empty = fixture('');
  await empty.owner.copyDocument();
  expect(empty.visible()).toBe(empty.complete);
});
it('keeps DATA until uncertain begin acknowledgement and cancellation settle', async () => {
  const f = fixture(),
    entered = deferred(),
    held = deferred(),
    cancelEntered = deferred(),
    cancelHeld = deferred();
  const original = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0] === 'note.operation.begin') {
      entered.resolve();
      await held.promise;
      throw new Error('Lost begin ack');
    }
    if (args[0] === 'note.operation.cancel') {
      cancelEntered.resolve();
      await cancelHeld.promise;
    }
    return result;
  });
  const refusal = expect(f.owner.copyDocument()).rejects.toThrow('Lost begin ack');
  await entered.promise;
  f.owner.cancelCopy();
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await cancelEntered.promise;
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  cancelHeld.resolve();
  await refusal;
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.begin')).toHaveLength(1);
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
});
it('rechecks original ownership after remote cleanup before sink publication', async () => {
  const f = fixture(),
    original = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0] === 'note.operation.cancel') {
      f.transition(false);
      f.transition(true);
    }
    return result;
  });
  await expect(f.owner.copyDocument()).rejects.toThrow(/superseded/);
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.listeners.size).toBe(0);
});
it('preserves the primary failure when remote cancellation also fails', async () => {
  const f = fixture(),
    original = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0] === 'note.operation.append') throw new Error('Lost append ack');
    if (args[0] === 'note.operation.cancel') throw new Error('Cancel disconnected');
    return result;
  });
  await expect(f.owner.copyDocument()).rejects.toThrow('Lost append ack');
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
});

it('retains the actual nonzero edit fence and selection generation with an empty dirty journal', async () => {
  const f = fixture();
  const n = f.read().byWorkspaceId.w.notes.n,
    doc = n.document!;
  f.replaceNote({
    ...n,
    drafts: [],
    history: [{ ...n.history[0], splices: [] }],
    document: { ...doc, baseLength: doc.length, dirty: [], replay: [] },
  });
  await f.owner.copyDocument();
  const begin = rpc.mock.calls.find(([m]) => m === 'note.operation.begin')![1] as {
    header: unknown;
  };
  expect(begin.header).toMatchObject({
    localEditSequence: 8,
    selectionGeneration: 19,
    liveGeneration: 2,
  });
  expect(rpc.mock.calls.filter(([m]) => m === 'note.operation.append')).toHaveLength(0);
  expect(f.visible()).toBe(f.complete);
});
it('refuses a dirty prefix that does not reach the captured journal fence before opening a sink', async () => {
  const f = fixture(),
    n = f.read().byWorkspaceId.w.notes.n;
  f.replaceNote({ ...n, history: [{ ...n.history[0], sequence: 9 }] });
  await expect(f.owner.copyDocument()).rejects.toThrow('fence');
  expect(f.options.openSink).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

it.each(['denied', 'queued'])(
  'refuses %s DATA admission before sink allocation or RPC',
  async (mode) => {
    const f = fixture();
    if (mode === 'denied') {
      f.options.port.dispatch(
        a.pageResourceLimitsConfigured({ ...f.read().resourceLedger.limit, physicalReads: 0 }),
      );
    } else {
      f.options.port.dispatch(
        a.pageResourcesRequested(
          'other-owner',
          [
            {
              id: 'other-io',
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
    }
    await expect(f.owner.copyDocument()).rejects.toThrow(/unadmitted/);
    expect(rpc).not.toHaveBeenCalled();
    expect(f.options.openSink).not.toHaveBeenCalled();
    expect(f.read().resourceLedger.pending).toHaveLength(0);
    expect(Object.keys(f.read().resourceLedger.owners)).toEqual(
      mode === 'queued' ? ['other-owner'] : [],
    );
    expect(f.listeners.size).toBe(0);
  },
);
it('latches loss and revival while the captured begin digest is held, dispatching zero RPCs', async () => {
  const f = fixture(),
    entered = deferred(),
    held = deferred();
  const original = crypto.subtle.digest.bind(crypto.subtle);
  const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
    entered.resolve();
    await held.promise;
    return original(...args);
  });
  try {
    const refusal = expect(f.owner.copyDocument()).rejects.toThrow(/superseded/);
    await entered.promise;
    expect(digest).toHaveBeenCalledOnce();
    f.transition(false);
    f.transition(true);
    expect(f.read().resourceLedger.used.physicalReads).toBe(1);
    held.resolve();
    await refusal;
    expect(rpc).not.toHaveBeenCalled();
    expect(f.sink.abort).toHaveBeenCalledOnce();
    expect(f.read().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    digest.mockRestore();
  }
});
it('latches loss and revival while opening the external sink before dispatch', async () => {
  const f = fixture(),
    entered = deferred(),
    held = deferred();
  f.options.openSink.mockImplementation(async () => {
    entered.resolve();
    await held.promise;
    return f.sink;
  });
  const refusal = expect(f.owner.copyDocument()).rejects.toThrow(/superseded/);
  await entered.promise;
  f.transition(false);
  f.transition(true);
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  held.resolve();
  await refusal;
  expect(rpc).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledOnce();
});
it('settles a held read before cancellation and never delivers its page after owner revival', async () => {
  const f = fixture(),
    entered = deferred(),
    held = deferred(),
    original = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0] === 'note.operation.read') {
      entered.resolve();
      await held.promise;
    }
    return result;
  });
  const refusal = expect(f.owner.copyDocument()).rejects.toThrow(/superseded/);
  await entered.promise;
  f.transition(false);
  f.transition(true);
  expect(f.read().resourceLedger.used.physicalReads).toBe(1);
  expect(rpc.mock.calls.some(([m]) => m === 'note.operation.cancel')).toBe(false);
  held.resolve();
  await refusal;
  expect(f.sink.write).not.toHaveBeenCalled();
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
});
it.each(['scope', 'phase', 'headerDigest', 'payloadDigest', 'ackDigest', 'length', 'expiry'])(
  'refuses malformed %s envelopes and aborts unpublished output',
  async (field) => {
    const f = fixture(),
      original = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (...args) => {
      const result = (await original(...args)) as Record<string, unknown>;
      if (args[0] === 'note.operation.begin') {
        if (field === 'scope') result.scope = { ...scope, noteInstanceId: 'other' };
        if (field === 'phase') result.phase = 'sealed';
        if (field === 'headerDigest') result.headerDigest = 'b'.repeat(64);
      }
      if (args[0] === 'note.operation.seal' && field === 'payloadDigest')
        result.payloadDigest = 'c'.repeat(64);
      if (args[0] === 'note.operation.append' && field === 'ackDigest')
        result.chunkDigest = 'd'.repeat(64);
      if (args[0] === 'note.operation.read') {
        if (field === 'length') result.sourceLength = 300000;
        if (field === 'expiry') result.expiresAt = new Date(Date.now() + 86000000).toISOString();
      }
      return result;
    });
    await expect(f.owner.copyDocument()).rejects.toThrow();
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.sink.abort).toHaveBeenCalledOnce();
    expect(f.read().resourceLedger.used.physicalReads).toBe(0);
    expect(f.listeners.size).toBe(0);
  },
);
it('refuses publication when cancellation fails after complete source output', async () => {
  const f = fixture(),
    original = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0] === 'note.operation.cancel') throw new Error('Cleanup unavailable');
    return result;
  });
  await expect(f.owner.copyDocument()).rejects.toThrow('Cleanup unavailable');
  expect(f.sink.write).toHaveBeenCalled();
  expect(f.sink.commit).not.toHaveBeenCalled();
  expect(f.sink.abort).toHaveBeenCalledOnce();
  expect(f.read().resourceLedger.used.physicalReads).toBe(0);
});
it.each(['dirty', 'pristine'])(
  'finishes an already sealed %s source read across a real remote revision notification',
  async (mode) => {
    const f = fixture(),
      original = rpc.getMockImplementation()!;
    if (mode === 'pristine') {
      const n = f.read().byWorkspaceId.w.notes.n,
        doc = n.document!;
      f.replaceNote({
        ...n,
        drafts: [],
        history: [],
        document: {
          ...doc,
          baseLength: doc.length,
          generation: 0,
          dirty: [],
          replay: [],
          history: [],
          cursor: 0,
        },
      });
    }
    const captured = f.read().byWorkspaceId.w.notes.n.document;
    let notified = false;
    rpc.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[0] === 'note.operation.read' && !notified) {
        notified = true;
        const n = f.read().byWorkspaceId.w.notes.n;
        f.dispatch(
          a.pageStateReceived('w', 'n', n.generation, {
            ...n.state!,
            sourceRevision: 'r2',
            stateGeneration: '2',
          }),
        );
        const next = f.read().byWorkspaceId.w.notes.n;
        expect(next.state!.sourceRevision).toBe('r2');
        expect(next.generation).not.toBe(n.generation);
        expect(next.document).toBe(mode === 'dirty' ? captured : undefined);
      }
      return result;
    });
    await f.owner.copyDocument();
    expect(notified).toBe(true);
    expect(f.visible()).toBe(f.complete);
    expect(f.read().byWorkspaceId.w.notes.n.needsReconcile).toBe(mode === 'dirty');
    expect(f.read().resourceLedger.used.physicalReads).toBe(0);
  },
);
it.each(['edit', 'undo'])(
  'permanently refuses a local %s and revival during a held sealed read',
  async (kind) => {
    const f = fixture(),
      original = rpc.getMockImplementation()!;
    const entered = deferred(),
      held = deferred();
    rpc.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[0] === 'note.operation.read') {
        entered.resolve();
        await held.promise;
      }
      return result;
    });
    const refused = expect(f.owner.copyDocument()).rejects.toThrow(/superseded/);
    await entered.promise;
    const n = f.read().byWorkspaceId.w.notes.n,
      before = n.document!;
    const undo = moveNoteDocumentHistory(before, 'undo');
    expect(undo).toBeDefined();
    const splices = kind === 'edit' ? [{ start: 0, end: 0, text: 'Z' }] : undo!.splices;
    const after =
      kind === 'undo'
        ? undo!.state
        : {
            ...before,
            generation: before.generation + 1,
            length: before.length + 1,
            dirty: composeNoteEdits(before.baseLength, [{ splices: before.dirty }, { splices }]),
          };
    f.dispatch(a.pageDocumentPublished('w', 'n', n.generation, before, after, splices));
    expect(f.read().byWorkspaceId.w.notes.n.document).toBe(after);
    f.replaceNote(n); // Restoring old values cannot undo the subscribed loss latch.
    held.resolve();
    await refused;
    expect(f.sink.write).not.toHaveBeenCalled();
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.read().resourceLedger.used.physicalReads).toBe(0);
  },
);
it('checks the original deadline after cancellation settlement before publication handoff', async () => {
  let time = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => time);
  try {
    const f = fixture(),
      original = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[0] === 'note.operation.cancel') time += 600000;
      return result;
    });
    await expect(f.owner.copyDocument()).rejects.toThrow(/superseded/);
    expect(f.sink.commit).not.toHaveBeenCalled();
    expect(f.sink.abort).toHaveBeenCalledOnce();
    expect(f.read().resourceLedger.used.physicalReads).toBe(0);
  } finally {
    clock.mockRestore();
  }
});

it('drains actual Live/Redux capture through the default platform adapter into main-owned disk staging', async () => {
  const f = fixture('z'.repeat(17000));
  const directory = await fs.mkdtemp(join(tmpdir(), 'source-copy-platform-'));
  const publish = vi.fn(async (_text: string) => {});
  const errors = vi.fn();
  const main = createSourceClipboard({
    directory,
    publish,
    maxNativeBytes: 1024 * 1024,
    cleanupError: errors,
  });
  const mainOwner = { key: {}, current: () => true, subscribe: () => () => {} };
  const c = IPC_CHANNELS.SYSTEM;
  vi.mocked(invoke).mockImplementation(async (channel, params) => {
    const p = params as never;
    if (channel === c.SOURCE_CLIPBOARD_BEGIN)
      return { success: true, data: await main.begin(mainOwner, p) };
    if (channel === c.SOURCE_CLIPBOARD_WRITE)
      return { success: true, data: await main.write(mainOwner, p) };
    if (channel === c.SOURCE_CLIPBOARD_COMMIT)
      return { success: true, data: await main.commit(mainOwner, p) };
    if (channel === c.SOURCE_CLIPBOARD_ABORT) {
      await main.abort(mainOwner, p);
      return { success: true, data: {} };
    }
    throw new Error('Unexpected sink IPC');
  });
  const owner = createNoteSourceCopyOwner({ ...f.options, openSink: undefined });
  const before = f.read().byWorkspaceId.w.notes.n;
  try {
    await owner.copyDocument();
    expect(publish).toHaveBeenCalledExactlyOnceWith(f.complete);
    expect(f.options.openSink).not.toHaveBeenCalled();
    expect(f.read().byWorkspaceId.w.notes.n).toBe(before);
    expect(f.read().resourceLedger.used.physicalReads).toBe(0);
    expect(f.listeners.size).toBe(0);
    expect(main.usage()).toEqual({ owners: 0, admittedBytes: 0 });
    expect(await fs.readdir(directory)).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
