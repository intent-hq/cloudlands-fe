import { afterEach, expect, it, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { runSaga, stdChannel } from 'redux-saga';
import { createHash } from 'node:crypto';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';
import { appClient } from '$lib/client';
import type { NoteScope, NoteCommitReceipt, NoteStagedSaveOperation } from '$lib/client/note-pages';
import { notePagesSaga } from '$store/renderer/slices/note-pages/sagas/note-pages-saga';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { createNoteEditAuthority } from './note-edit-authority';
import { NoteCanonicalProjection } from '../note-canonical-projection';
import type { NoteWindow } from '../note-window-reader';
import { captureNoteNativeHistoryWitness } from './note-native-history-witness';
import {
  createNoteDocumentSession,
  prepareNoteDocumentEdit,
  moveNoteDocumentHistory,
  materializeNoteDocumentAuthority,
} from './note-document-edit-session';
// Store-produced frames are imported unchanged. The adjacent attribution file
// identifies the exact producer/test; this fixture is not a live daemon session.
import captureBytes from './fixtures/staged-store-receipt.capture.txt?raw';
interface ProducerFrame {
  normalizedRequest: {
    scope: NoteScope;
    operationId: string;
    headerDigest: string;
    payloadDigest: null;
    kind: string;
    reference: string;
    maxItems: number;
    maxWireBytes: number;
    maxSourceBytes: number;
    operationEnvelope: boolean;
    contextEnvelope: boolean;
    textId: string | null;
  };
  cursor: string | null;
  offset: number | null;
  response: Record<string, unknown> & { outputKind: string; items: Record<string, unknown>[] };
}
interface ProducerCapture {
  base: string;
  final: string;
  receipt: NoteCommitReceipt;
  begin: {
    request: NoteScope & {
      operationId: string;
      expiresAt: string;
      headerDigest: string;
      header: { liveGeneration: number; localEditSequence: number; baseRevision: string };
    };
  };
  seal: {
    request: {
      headerDigest: string;
      payloadDigest: string;
      manifest: NoteStagedSaveOperation['manifest'];
    };
  };
  uploads: {
    request: {
      stream: string;
      sequence: number;
      previousDigest: string | null;
      records: Record<string, unknown>[];
      chunkDigest: string;
    };
  }[];
  dirtyRecords: {
    kind: string;
    localSequence: number;
    ordinal: number;
    start: number;
    end: number;
    replacement: { textId: string; length: number; utf8Bytes: number; sha256: string };
  }[];
  transcript: ProducerFrame[];
}

const capture = JSON.parse(captureBytes) as ProducerCapture;
const receipt = capture.receipt;
const scope = receipt.scope;
const schema = new Schema({
  nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
});
function nativeFixture(
  raw = 'abc',
  start = 100,
  sourceLength = 1000,
  rendered = raw,
  mapping = 'identity',
  sourceRevision = receipt.beforeRevision,
) {
  const owner = {
    kind: 'boundary',
    id: 'owner',
    construct: 'paragraph',
    entryPath: 'markdown',
    sourceRange: { start, end: start + raw.length },
  } as const;
  const w = {
    scope,
    sourceRevision,
    snapshotId: 'snap1',
    sourceLength,
    range: owner.sourceRange,
    text: raw,
    documentEnd: false,
    details: { owner: { openingSource: '', closingSource: '' } },
    mapBindings: [],
    native: {
      references: { parent: ['root'], leafParent: ['paragraph'], ownerRef: ['owner'] },
      attributes: { empty: {} },
      texts: { text: rendered },
    },
    context: [
      owner,
      {
        kind: 'nativeNode',
        id: 'root',
        nodeType: 'doc',
        nodeClass: 'container',
        parentRef: null,
        childIndex: 0,
        attributesRef: 'empty',
        sourceRange: owner.sourceRange,
      },
      {
        kind: 'nativeNode',
        id: 'paragraph',
        nodeType: 'paragraph',
        nodeClass: 'container',
        parentRef: 'parent',
        childIndex: 0,
        attributesRef: 'empty',
        sourceRange: owner.sourceRange,
      },
      {
        kind: 'nativeNode',
        id: 'leaf',
        nodeType: 'text',
        nodeClass: 'text',
        parentRef: 'leafParent',
        childIndex: 0,
        sourceRange: owner.sourceRange,
      },
      {
        kind: 'sourceMap',
        id: 'map',
        ownerRef: 'ownerRef',
        textNodeId: 'leaf',
        sourceRange: owner.sourceRange,
        renderedRange: { start: 0, end: rendered.length },
        mapping,
        textRef: 'text',
      },
    ],
  } as unknown as NoteWindow;
  const projection = new NoteCanonicalProjection(w);
  const doc = schema.nodeFromJSON(projection.content);
  const authority = createNoteEditAuthority(w, projection, [owner], doc);
  const session = createNoteDocumentSession(scope, sourceRevision, sourceLength);
  session.selection = { anchor: start, head: start, anchorAffinity: 1, headAffinity: 1 };
  return { session, authority, w, projection, owner };
}

const originalClient = appClient.notes.pages;
const tasks: ReturnType<typeof runSaga>[] = [];
afterEach(() => {
  tasks.forEach((task) => task.cancel());
  tasks.length = 0;
  appClient.notes.pages = originalClient;
  vi.restoreAllMocks();
});

function setup() {
  // Only native paragraph construction is controlled here; every receipt frame
  // below must come from the registered Store producer capture.
  const native = nativeFixture(capture.base, 0, capture.base.length);
  const ws = scope.workspaceId,
    id = scope.noteId;
  let state = a.notePagesReducer(undefined, a.pagePanelOpened(ws, id, 'panel'));
  const initial = state.byWorkspaceId[ws].notes[id];
  state = {
    ...state,
    byWorkspaceId: {
      [ws]: {
        notes: {
          [id]: {
            ...initial,
            status: 'ready',
            document: native.session,
            state: {
              kind: 'notePageState',
              scope,
              sourceRevision: receipt.beforeRevision,
              stateGeneration: '1',
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
  const listeners = new Set<() => void>(),
    channel = stdChannel();
  const read = () => state.byWorkspaceId[ws].notes[id];
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    state = a.notePagesReducer(state, action);
    for (const listener of [...listeners]) listener();
    channel.put(action);
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 10_000_000,
      stringUnits: 10_000_000,
      objectNodes: 400_000,
      physicalReads: 2,
      assemblies: 2,
      domNodes: 0,
    }),
  );
  let authority = native.authority;
  const edit = (from: number, to: number, text: string, appendTo?: number, terminal = false) => {
    const before = read().document!;
    const tr = EditorState.create({ doc: authority.doc }).tr.insertText(text, from, to);
    if (terminal) tr.insertText('Z', 9);
    const result = prepareNoteDocumentEdit(
      before,
      tr,
      authority,
      appendTo === undefined ? {} : { appendTo },
    );
    dispatch(
      a.pageDocumentPublished(ws, id, read().generation, before, result.state, result.splices),
    );
    expect(read().document).toBe(result.state);
    authority = result.authority;
    return result;
  };
  edit(2, 3, 'BB');
  edit(4, 4, 'B', 1);
  edit(7, 8, 'C', undefined, true);
  const document = read().document!;
  expect(document.history.map((g) => g.id)).toEqual([1, 3]);
  expect(authority.source).toBe(capture.final);
  expect(document.history.map((g) => g.forward)).toEqual([
    [{ start: 1, end: 2, text: 'BBB' }],
    [
      { start: 6, end: 7, text: 'C' },
      { start: 8, end: 8, text: 'Z' },
    ],
  ]);
  const witnessOwner = 'captured-native-witness';
  dispatch(
    a.pageResourcesRequested(
      witnessOwner,
      [
        {
          id: witnessOwner,
          cost: {
            payloadBytes: 8 * 262144,
            stringUnits: 8 * 262144,
            objectNodes: 4 * 32768,
            physicalReads: 0,
            assemblies: 0,
            domNodes: 0,
          },
        },
      ],
      1,
    ),
  );
  expect(state.resourceLedger.owners).toHaveProperty(witnessOwner);
  const client = new LiveNotePagesClient();
  vi.spyOn(client, 'capabilities').mockResolvedValue(null);
  const start = (operation: NoteStagedSaveOperation) => {
    dispatch(a.pageSaveStarted(ws, id, operation, read().drafts.at(-1)!.sequence));
    expect(read().pending?.document).toBeDefined();
    dispatch(a.pageSaveSettled(ws, id, receipt));
    expect(read().committedDocumentSave?.operation).toBe(operation);
    appClient.notes.pages = client;
    tasks.push(
      runSaga(
        {
          channel,
          dispatch,
          getState: () => ({ notePages: state }),
          context: {
            reduxStore: {
              getState: () => ({ notePages: state }),
              dispatch,
              subscribe(fn: () => void) {
                listeners.add(fn);
                return () => {
                  listeners.delete(fn);
                };
              },
            },
          },
        },
        notePagesSaga,
      ),
    );
    dispatch(
      a.pageStateReceived(ws, id, read().generation, {
        ...read().state!,
        sourceRevision: receipt.afterRevision,
        stateGeneration: '2',
      }),
    );
  };
  return {
    read,
    dispatch,
    document,
    witnessOwner,
    start,
    nativeWitness: captureNoteNativeHistoryWitness(document),
    ledger: () => state.resourceLedger,
    clean() {
      dispatch(a.pageSessionDiscarded(ws, id));
      dispatch(a.pageResourcesReleased(witnessOwner));
      expect(state.resourceLedger.used.payloadBytes).toBe(0);
      expect(state.resourceLedger.used.physicalReads).toBe(0);
      expect(listeners.size).toBe(0);
    },
  };
}

// ReceiptDetailQuery is an internal Store DTO. Reconstruct its public selector
// spelling only; response frames and opaque cursors are never re-encoded.
function wire(frame: (typeof capture.transcript)[number]) {
  const q = frame.normalizedRequest;
  expect(q.operationEnvelope).toBe(true);
  expect(q.contextEnvelope).toBe(false);
  expect(q.payloadDigest).toBeNull();
  return {
    ...q.scope,
    operationId: q.operationId,
    headerDigest: q.headerDigest,
    kind: q.kind,
    ref: q.reference,
    maxItems: q.maxItems,
    maxWireBytes: q.maxWireBytes,
    ...(frame.cursor === null ? {} : { cursor: frame.cursor }),
    ...(q.kind === 'inverseText'
      ? {
          textId: q.textId,
          maxSourceBytes: q.maxSourceBytes,
          ...(frame.offset === null ? {} : { offset: frame.offset }),
        }
      : {}),
  };
}

function replay(f: ReturnType<typeof setup>, mutate?: (page: Record<string, unknown>) => void) {
  const used = new Set<number>();
  const failures: unknown[] = [];
  vi.mocked(backendRequest).mockImplementation(async (method, params) => {
    try {
      expect(method).toBe('note.operation.read');
      const p = params as Record<string, unknown>;
      const index = capture.transcript.findIndex((frame) => {
        const q = frame.normalizedRequest;
        return (
          q.kind === p.kind &&
          q.reference === p.ref &&
          q.textId === (p.textId ?? null) &&
          frame.cursor === (p.cursor ?? null) &&
          frame.offset === (p.offset ?? null)
        );
      });
      expect(index).toBeGreaterThanOrEqual(0);
      expect(used.has(index)).toBe(false);
      expect(params).toEqual(wire(capture.transcript[index]));
      expect(f.ledger().used.physicalReads).toBe(1);
      expect(f.ledger().used.payloadBytes).toBeGreaterThan(0);
      used.add(index);
      const page = structuredClone(capture.transcript[index].response);
      mutate?.(page);
      return page;
    } catch (error) {
      failures.push(error);
      throw error;
    }
  });
  return { used, failures };
}
function admitted(f: ReturnType<typeof setup>): NoteStagedSaveOperation {
  const canonical = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.map(canonical).join(',')}]`
      : v && typeof v === 'object'
        ? `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
            .join(',')}}`
        : JSON.stringify(v);
  const digest = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
  const { headerDigest, ...begin } = capture.begin.request;
  expect(digest({ method: 'note.operation.begin', ...begin })).toBe(headerDigest);
  expect(digest({ headerDigest, manifest: capture.seal.request.manifest })).toBe(
    receipt.payloadDigest,
  );
  expect(capture.seal.request.headerDigest).toBe(receipt.headerDigest);
  expect(capture.seal.request.payloadDigest).toBe(receipt.payloadDigest);
  expect(capture.begin.request.header.liveGeneration).toBe(f.document.generation);
  expect(capture.begin.request.header.localEditSequence).toBe(f.document.history.at(-1)!.id);
  expect(capture.begin.request.header.baseRevision).toBe(f.document.baseRevision);
  expect(headerDigest).toBe(receipt.headerDigest);
  expect(begin.operationId).toBe(receipt.operationId);
  for (const key of ['backendId', 'workspaceId', 'noteId', 'noteInstanceId'] as const)
    expect(begin[key]).toBe(scope[key]);
  const text = new Map<string, string>();
  for (const manifest of capture.seal.request.manifest) {
    const chunks = capture.uploads.filter((u) => u.request.stream === manifest.stream);
    let previous: string | null = null,
      count = 0;
    chunks.forEach(({ request }, sequence) => {
      expect(request.sequence).toBe(sequence);
      expect(request.previousDigest).toBe(previous);
      expect(
        digest({
          stream: request.stream,
          sequence,
          previousDigest: previous,
          records: request.records,
        }),
      ).toBe(request.chunkDigest);
      previous = request.chunkDigest;
      count += request.records.length;
      if (request.stream === 'text')
        for (const r of request.records) {
          expect(r.kind).toBe('text');
          const old = text.get(String(r.id)) ?? '';
          expect(r.offset).toBe(old.length);
          expect(typeof r.text).toBe('string');
          text.set(String(r.id), old + String(r.text));
        }
    });
    expect(manifest).toEqual({
      stream: manifest.stream,
      chunks: chunks.length,
      records: count,
      lastDigest: previous,
    });
  }
  expect(
    capture.uploads.filter((u) => u.request.stream === 'dirty').flatMap((u) => u.request.records),
  ).toEqual(capture.dirtyRecords);
  const expected = f.document.history.flatMap((g) =>
    g.forward.map((s, ordinal) => ({ localSequence: g.id, ordinal, ...s })),
  );
  expect(
    capture.dirtyRecords.map((r) => {
      expect(r.kind).toBe('splice');
      const value = text.get(r.replacement.textId);
      expect(value).toBeDefined();
      expect(r.replacement).toEqual({
        textId: r.replacement.textId,
        length: value!.length,
        utf8Bytes: Buffer.byteLength(value!),
        sha256: createHash('sha256').update(value!).digest('hex'),
      });
      return {
        localSequence: r.localSequence,
        ordinal: r.ordinal,
        start: r.start,
        end: r.end,
        text: value,
      };
    }),
  ).toEqual(expected);

  return Object.freeze({
    scope,
    baseRevision: receipt.beforeRevision,
    operationId: receipt.operationId,
    expiresAt: capture.begin.request.expiresAt,
    headerDigest: receipt.headerDigest!,
    payloadDigest: receipt.payloadDigest,
    manifest: capture.seal.request.manifest,
    splices: f.document.dirty,
    viewLength: f.document.length,
    nativeWitness: f.nativeWitness,
    witnessOwner: f.witnessOwner,
    documentGeneration: f.document.generation,
    documentCursor: f.document.cursor,
    baseLength: f.document.baseLength,
    nativeFence: 3,
  });
}

it('adopts actual Store inverse and complete provenance frames, preserving native groups through saved-base undo and redo', async () => {
  // Retain both literal expiries. FE replay runs after the stage deadline but
  // within the original receipt lifetime; this does not rerun Store authorization.
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(capture.begin.request.expiresAt) + 1000);
  expect(createHash('sha256').update(captureBytes).digest('hex')).toBe(
    '0b9927c182f736f73ca9ac4450602cba168292f2f7d2b92ea2ee516df0ba300a',
  );
  expect(Date.now()).toBeLessThan(Date.parse(receipt.receiptExpiresAt));
  const f = setup(),
    r = replay(f);
  const before = f.document;
  f.start(admitted(f));
  await vi.waitFor(() => expect(f.ledger().used.physicalReads).toBe(0));
  expect(r.failures).toEqual([]);
  expect(r.used.size).toBe(capture.transcript.length);
  expect(f.read().needsReconcile).toBe(false);
  const saved = f.read().document!;
  expect(saved.history).toBe(before.history);
  expect(saved.cursor).toBe(before.cursor);
  expect(saved.selection).toEqual(before.selection);
  expect(saved.baseRevision).toBe(receipt.afterRevision);
  expect(saved.dirty).toEqual([]);
  expect(saved.replay).toEqual([]);
  expect(f.read().receipts).toEqual([]);
  const base = nativeFixture(
    capture.final,
    0,
    capture.final.length,
    capture.final,
    'identity',
    receipt.afterRevision,
  ).authority;
  const one = moveNoteDocumentHistory(saved, 'undo')!.state;
  expect(materializeNoteDocumentAuthority(one, base).source).toBe('aBBB😀cd');
  const two = moveNoteDocumentHistory(one, 'undo')!.state;
  expect(materializeNoteDocumentAuthority(two, base).source).toBe(capture.base);
  const redoOne = moveNoteDocumentHistory(two, 'redo')!.state;
  const redoTwo = moveNoteDocumentHistory(redoOne, 'redo')!.state;
  expect(materializeNoteDocumentAuthority(redoTwo, base).source).toBe(capture.final);
  f.clean();
});

it.each(['group-relative-provenance', 'missing-older-group'] as const)(
  'retains captured native work when the Store transcript is tampered: %s',
  async (failure) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(capture.begin.request.expiresAt) + 1000);
    const f = setup();
    let altered = false;
    const entries = capture.transcript.flatMap((frame) =>
      frame.response.outputKind === 'detail'
        ? (frame.response.items as Array<Record<string, unknown>>)
        : [],
    );
    const baseRange = entries.find(
      (entry) =>
        entry.key === 'baseRange' &&
        entries.some(
          (child) => child.parentId === entry.id && child.key === 'start' && child.value === 8,
        ) &&
        entries.some(
          (child) => child.parentId === entry.id && child.key === 'end' && child.value === 8,
        ),
    );
    expect(baseRange).toBeDefined();
    const r = replay(f, (page) => {
      const items = page.items as Array<Record<string, unknown>>;
      if (failure === 'missing-older-group' && page.outputKind === 'inverse') {
        expect(items.some((item) => item.historyGroup === '1')).toBe(true);
        page.items = items.filter((item) => item.historyGroup !== '1');
        altered = true;
      }
      if (failure === 'group-relative-provenance' && page.outputKind === 'detail' && !altered) {
        const fields = items.filter((item) => item.parentId === baseRange!.id);
        if (fields.length) {
          expect(fields.map((item) => [item.key, item.value])).toEqual([
            ['end', 8],
            ['start', 8],
          ]);
          for (const value of fields) value.value = 6;
          altered = true;
        }
      }
    });
    const doc = f.document,
      operation = admitted(f);
    f.start(operation);
    const drafts = f.read().drafts,
      checkpoint = f.read().history;
    await vi.waitFor(() => expect(f.ledger().used.physicalReads).toBe(0));
    expect(r.failures).toEqual([]);
    expect(altered).toBe(true);
    expect(f.read().needsReconcile).toBe(true);
    expect(f.read().document).toBe(doc);
    expect(f.read().document!.history).toBe(doc.history);
    expect(f.read().document!.dirty).toBe(doc.dirty);
    expect(f.read().committedDocumentSave?.operation).toBe(operation);
    expect(f.read().receipts).toEqual([receipt]);
    expect(f.read().drafts).toBe(drafts);
    expect(f.read().history).toBe(checkpoint);
    expect(f.ledger().owners).toHaveProperty(f.witnessOwner);
    f.clean();
  },
);
