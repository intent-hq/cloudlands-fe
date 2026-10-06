import * as pointPublication from '$store/renderer/slices/note-pages/note-local-point-save-publication';
import * as livePages from '$lib/client/live/live-note-pages-client';
import { takeNoteLocalPointUploadOwner } from './note-local-point-owner';
import { openPointSaveUpload } from './note-local-point-save-sponsor';
import { createNoteLocalPointUpload } from './note-local-point-staged-save';
/** @vitest-environment jsdom */
import { Editor, Extension } from '@tiptap/core';
import { EditorState, Plugin, TextSelection } from '@tiptap/pm/state';
import { expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
import { backendRequest, onBackendReconnected } from '$lib/client/live/backend-transport';
import {
  LiveNotePagesClient,
  loadLiveNoteSaveDispatch,
  claimLiveNoteStagedSave,
  retainLiveNoteSaveLoss,
} from '$lib/client/live/live-note-pages-client';
import { appClient } from '$lib/client';
import { MockNotePagesClient } from '$lib/client/mock/mock-note-pages-client';
import { noteAssemblyResources } from '../note-assembly-reservation';
import { prepareNoteParagraphContext } from './note-paragraph-edit-context';
import { notePagesSaga } from '$store/renderer/slices/note-pages/sagas/note-pages-saga';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import { readNoteWindow } from '../note-window-reader';
import { projectNoteWindow } from '../note-window-projection';
import { createNoteTransactionRelay } from '../note-transaction-relay';
import { validateNoteNativeOutput } from '../note-native-output-validation';
import { createNoteLocalPointOwner } from './note-local-point-owner';
import { prepareNoteSave } from './note-edit-plan';
import { captureNoteNativeHistoryWitness } from './note-native-history-witness';
import {
  materializeNoteDocumentAuthority,
  moveNoteDocumentHistory,
  reconcileNoteDocumentSave,
} from './note-document-edit-session';
import { prepareNoteDocumentPublication } from '$store/renderer/slices/note-pages/note-document-publication';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import plainLocal from './__fixtures__/note-local-point/plain-paragraph-ab.json';
import {
  createNoteLocalPointSaveSponsor,
  currentPointCanonicalCertificate,
} from './note-local-point-save-sponsor';
import { stageTextDigest, createNoteStagedSaveOperation } from '$lib/client/note-source-operation';

const pointId = '00000000-0000-4000-8000-000000000001';
const literal = `<!--anchor:${pointId}:point-->`;

/** Controlled NEW operation via the actual Live client entry point. These mock
 * responses are not the historical Services receipt and prove no live commit. */
async function controlledSeal(
  sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor>,
  suppliedText = `X${literal}`,
  live = true,
  onStageCheck: () => void = () => {},
) {
  const streams = ['text', 'dirty', 'selection', 'mutation', 'live'].map((stream) => ({
    stream,
    nextSequence: 0,
    lastDigest: null as string | null,
  }));
  let headerDigest = '';
  vi.mocked(backendRequest).mockImplementation(async (method, params) => {
    const p = params as Record<string, unknown>;
    const envelope = { scope: sponsor.input.scope, operationId: sponsor.input.operationId };
    if (method === 'note.operation.begin') {
      headerDigest = String(p.headerDigest);
      return {
        ...envelope,
        kind: 'noteStageState',
        phase: 'staging',
        headerDigest,
        baseRevision: sponsor.input.header.baseRevision,
        expiresAt: sponsor.input.expiresAt,
        streams: streams.map((s) => ({ ...s })),
      };
    }
    if (method === 'note.operation.append') {
      const s = streams.find((s) => s.stream === p.stream)!;
      s.nextSequence++;
      s.lastDigest = String(p.chunkDigest);
      return {
        ...envelope,
        kind: 'noteStageAck',
        stream: p.stream,
        sequence: p.sequence,
        nextSequence: s.nextSequence,
        chunkDigest: p.chunkDigest,
      };
    }
    if (method === 'note.operation.seal')
      return {
        ...envelope,
        kind: 'noteStageState',
        phase: 'sealed',
        headerDigest,
        payloadDigest: p.payloadDigest,
        viewLength: 59,
        baseRevision: sponsor.input.header.baseRevision,
        expiresAt: sponsor.input.expiresAt,
        streams: streams.map((s) => ({ ...s })),
      };
    throw new Error(`Unconfigured controlled operation ${method}`);
  });
  const stage = live
    ? new LiveNotePagesClient().createSaveOperation(sponsor.input, () => {
        onStageCheck();
        return sponsor.precommitCurrent();
      })
    : createNoteStagedSaveOperation(
        (m, p) => backendRequest(m, p),
        sponsor.input,
        sponsor.precommitCurrent,
      );
  const group = sponsor.input.header.localEditSequence,
    textId = `group:${group}:0`,
    text = suppliedText;
  await stage.begin();
  await stage.append('text', [{ kind: 'text', id: textId, offset: 0, text }]);
  await stage.append('dirty', [
    {
      kind: 'splice',
      localSequence: group,
      ordinal: 0,
      start: 1,
      end: 1,
      replacement: { textId, length: 57, utf8Bytes: 57, sha256: await stageTextDigest(text) },
    },
  ]);
  await stage.seal();
  return stage;
}
/** Entirely controlled NEW backend responses for a NEW actually sealed operation.
 * Geometry is independently expected; historical transcript IDs are never reused. */
async function controlledReceipt(stage: Awaited<ReturnType<typeof controlledSeal>>, group: number) {
  const sealed = stage.sealedSave();
  const receipt = {
    kind: 'noteCommitReceipt' as const,
    outcome: 'committed' as const,
    scope: sealed.scope,
    operationId: sealed.operationId,
    headerDigest: sealed.headerDigest,
    payloadDigest: sealed.payloadDigest,
    beforeRevision: sealed.baseRevision,
    afterRevision: 'controlled-after',
    sourceLength: 3,
    mappingRef: 'mapping',
    effectsRef: 'effects',
    inverseRef: 'inverse',
    viewId: 'controlled-view',
    receiptExpiresAt: sealed.expiresAt,
    invalidation: 'all' as const,
  };
  const empty = await stageTextDigest(''),
    removed = await stageTextDigest(literal);
  const replacement = { textId: 'empty', length: 0, utf8Bytes: 0, sha256: empty };
  const detail = new Map<string, unknown[]>();
  let nodeId = 0;
  const tree = (
    value: Record<string, unknown>,
    ref: string,
    parentId: string | null = null,
    key?: string,
  ) => {
    const id = `n${++nodeId}`,
      childrenRef = `children-${id}`;
    const node = { id, parentId, ...(key ? { key } : {}), type: 'object', childrenRef };
    if (parentId === null) detail.set(ref, [node]);
    const children: unknown[] = [];
    detail.set(childrenRef, children);
    for (const [k, v] of Object.entries(value)) {
      if (v && typeof v === 'object') children.push(tree(v as Record<string, unknown>, ref, id, k));
      else children.push({ id: `n${++nodeId}`, parentId: id, key: k, type: typeof v, value: v });
    }
    return node;
  };
  tree(
    {
      inputState: 'caller-phase',
      outputState: 'scrub-phase',
      range: { start: 2, end: 58 },
      removed: literal,
      inserted: '',
    },
    'effect-detail',
  );
  tree(
    {
      kind: 'sourceProvenance',
      inputState: receipt.afterRevision,
      outputState: receipt.beforeRevision,
      baseRange: { start: 1, end: 1 },
      finalRange: { start: 1, end: 2 },
      replacement,
    },
    'provenance',
  );
  const roots: Record<string, unknown[]> = {
    mapping: [{ start: 1, end: 1, insertedLength: 1 }],
    effects: [
      {
        kind: 'sourceEffect',
        reason: 'phantom-scrub',
        inputState: 'caller-phase',
        outputState: 'scrub-phase',
        range: { start: 2, end: 58 },
        insertedLength: 0,
        beforeDigest: removed,
        afterDigest: empty,
        detailRef: 'effect-detail',
      },
      {
        kind: 'annotationInvalidation',
        sourceRevision: receipt.afterRevision,
        attributionGeneration: 'attr',
        commentRevision: 'comments',
      },
    ],
    inverse: [
      {
        ordinal: 0,
        historyGroup: String(group),
        inputState: receipt.afterRevision,
        outputState: receipt.beforeRevision,
        start: 1,
        end: 2,
        replacement,
        provenanceRef: 'provenance',
      },
    ],
    inverseText: [{ textId: 'empty', offset: 0, text: '' }],
  };
  return {
    receipt,
    roots,
    detail,
    respond: async (method: string, params: unknown) => {
      if (method === 'note.operationStatus') return structuredClone(receipt);
      if (method !== 'note.operation.read') throw new Error('Unexpected controlled RPC');
      const p = params as Record<string, unknown>,
        kind = String(p.kind);
      const items = kind === 'detail' ? detail.get(String(p.ref)) : roots[kind];
      if (!items) throw new Error('Unknown controlled reference');
      return structuredClone({
        kind: 'noteOperationPage',
        scope: receipt.scope,
        operationId: receipt.operationId,
        headerDigest: receipt.headerDigest,
        payloadDigest: receipt.payloadDigest,
        viewId: receipt.viewId,
        expiresAt: receipt.receiptExpiresAt,
        sourceLength: ['inverse', 'inverseText'].includes(kind) ? 3 : 2,
        outputKind: kind,
        items,
        nextCursor: null,
        ...(kind === 'effects' ? { convertedCount: 0 } : {}),
      });
    },
  };
}
async function fixture(
  mode: 'normal' | 'filter' | 'append' = 'normal',
  underBudget = false,
  sponsor = false,
  upload = false,
) {
  const calls = plainLocal.calls as unknown as Array<{
    request: NotePageRequest;
    response: NoteReadPage;
  }>;
  const identity = calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing source');
  const reader = new NotePageReader(async (_method, params) => {
    const q = params.page as NotePageRequest;
    const found = calls.find(
      ({ request: r }) =>
        r.kind === q.kind &&
        r.cursor === q.cursor &&
        r.maxItems === q.maxItems &&
        r.maxWireBytes === q.maxWireBytes &&
        ('contextRef' in q
          ? 'contextRef' in r && r.contextRef === q.contextRef
          : 'ref' in q
            ? 'ref' in r && r.ref === q.ref
            : q.kind === 'source' &&
              r.kind === 'source' &&
              r.at === q.at &&
              r.maxSourceBytes === q.maxSourceBytes),
    );
    if (q.kind === 'source') {
      expect(q.snapshotId).toBe(identity.snapshotId);
      expect(q.sourceRevision).toBe(identity.sourceRevision);
      expect(q.noteInstanceId).toBe(identity.scope.noteInstanceId);
    }
    if (!found) throw new Error('Uncaptured request');
    return found.response;
  });
  const readPage = (q: NotePageRequest) =>
    reader.read(identity.scope.workspaceId, identity.scope.noteId, q);
  const window = await readNoteWindow(readPage, { ...identity, at: plainLocal.at });
  const projection = projectNoteWindow(window);
  const ws = identity.scope.workspaceId,
    id = identity.scope.noteId;
  let pages = a.notePagesReducer(undefined, a.pagePanelOpened(ws, id, 'panel'));
  let observationSnapshot: typeof pages | undefined;
  let subscriptionFailure = false;
  const channel = stdChannel(),
    listeners = new Set<() => void>();
  let storeReads = 0;
  let beforeDispatch: ((action: Parameters<typeof a.notePagesReducer>[1]) => void) | undefined;
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
    beforeDispatch?.(action);
    pages = a.notePagesReducer(pages, action);
    for (const fn of listeners) fn();
    channel.put(action);
  };
  dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: underBudget
        ? 2 *
            noteAssemblyResources({
              owner: 'probe',
              data: 'probe-data',
              control: 'probe-control',
            })[0].cost.payloadBytes +
          100
        : upload
          ? 21_827_584
          : sponsor
            ? 19_140_608
            : 100_000_000,
      stringUnits: upload ? 21_827_584 : sponsor ? 19_140_608 : 100_000_000,
      objectNodes: upload ? 13_705_216 : sponsor ? 13_692_928 : 100_000_000,
      domNodes: 10000,
      physicalReads: upload ? 5 : sponsor ? 4 : 16,
      assemblies: upload ? 10 : sponsor ? 8 : 16,
    }),
  );
  dispatch(
    a.pageStateReceived(ws, id, 0, {
      kind: 'notePageState',
      scope: identity.scope,
      stateGeneration: '1',
      sourceRevision: identity.sourceRevision,
      attributionGeneration: '1',
      attributionState: 'ready',
      commentRevision: '1',
      deleted: false,
      invalidation: 'all',
    }),
  );
  dispatch(a.pageWindowRequested(ws, id, 'panel', plainLocal.at));
  const note = () => pages.byWorkspaceId[ws].notes[id];
  const seed = { owner: 'local-seed', data: 'local-seed-data', control: 'local-seed-control' };
  dispatch(a.pageResourcesRequested(seed.owner, noteAssemblyResources(seed), 12));
  dispatch(
    a.pageWindowSettled(
      ws,
      id,
      'panel',
      note().generation,
      note().windows.panel.request,
      window,
      null,
      { sponsor: seed.owner, resource: seed.data, owner: 'local-window' },
    ),
  );
  dispatch(a.pageResourcesReleased(seed.owner));
  let active: ReturnType<typeof createNoteLocalPointOwner> | undefined;
  const relay = createNoteTransactionRelay(() => active);
  const config = createEditorConfig({
    element: document.createElement('div'),
    content: '',
    editable: true,
    useMarkdown: true,
    workspace: { id: ws },
    enableNotePrimitives: true,
    enableMentions: true,
    enableComments: false,
    onUpdate: () => {},
  });
  const editor = new Editor({
    ...config,
    extensions: [
      ...(config.extensions ?? []),
      CommentAnchor,
      Extension.create({
        name: 'localPointRelay',
        priority: 2000,
        addProseMirrorPlugins: () => [
          relay.plugin,
          new Plugin({
            filterTransaction: (tr) => mode !== 'filter' || !tr.docChanged,
            appendTransaction: (transactions, _old, state) =>
              mode === 'append' && transactions.some((tr) => tr.docChanged)
                ? state.tr.setSelection(state.selection)
                : null,
          }),
        ],
        dispatchTransaction({ transaction, next }) {
          relay.dispatch(transaction, next, this.editor);
        },
      }),
    ],
    content: await processMarkdownToHTML(window.text, { workspaceId: ws, preserveAnchors: true }),
    onTransaction({ transaction, appendedTransactions, editor: e }) {
      if (active) relay.adopt([transaction, ...appendedTransactions], e.state);
    },
  });
  editor.commands.setTextSelection(2);
  let live = true,
    refs = 0,
    time = plainLocal.capturedAtMs;
  let observationReads = 0;
  let onObservationRead = () => {};
  const port = {
    read: () => {
      observationReads++;
      onObservationRead();
      return observationSnapshot ?? pages;
    },
    dispatch,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      if (subscriptionFailure) throw new Error('controlled observation registration failure');
      return () => listeners.delete(fn);
    },
  };
  const previousClient = appClient.notes.pages;
  appClient.notes.pages = new MockNotePagesClient({
    capabilities: { backendId: identity.scope.backendId, annotations: false },
    read: (_w, _n, q) => readPage(q),
  });
  const readTask = runSaga(
    { channel, dispatch, getState: () => ({ notePages: pages }) },
    notePagesSaga,
  );
  const offer = prepareNoteParagraphContext(port, window, 'panel', undefined, () => time);
  const context = await offer.ready;
  const baseBorrow = context.borrow();
  const base = baseBorrow.create(projection, editor.state.doc);
  const baselineBytes = pages.resourceLedger.used.payloadBytes;
  let resourceSnapshot: typeof pages.resourceLedger | undefined;
  const d = note().document!;
  dispatch(
    a.pageDocumentSelectionChanged(ws, id, note().generation, d, {
      anchor: 1,
      head: 1,
      anchorAffinity: 1,
      headAffinity: 1,
    }),
  );
  let onRead: () => void = () => {},
    onClock: () => void = () => {},
    onResource: () => void = () => {};
  let resourceReads = 0,
    clockReads = 0;
  active = createNoteLocalPointOwner({
    base,
    initialState: editor.state,
    identity: {
      scope: identity.scope,
      sourceRevision: identity.sourceRevision,
      snapshotId: identity.snapshotId,
      documentGeneration: 0,
      liveGeneration: 0,
      selectionGeneration: 0,
      expiresAt: identity.expiresAt,
    },
    read: () => {
      onRead();
      return note().document;
    },
    publish: (before, after, splices) =>
      dispatch(a.pageDocumentPublished(ws, id, note().generation, before, after, splices)),
    admit: (before, after, splices) =>
      !!prepareNoteDocumentPublication(note(), before, after, splices),
    resources: {
      read: () => {
        resourceReads++;
        onResource();
        return resourceSnapshot ?? pages.resourceLedger;
      },
      dispatch,
    },
    context: {
      current: () => live && context.current(),
      retain: () => {
        const borrowed = context.borrow();
        refs++;
        let released = false;
        return () => {
          if (!released) {
            released = true;
            refs--;
            borrowed.release();
          }
        };
      },
    },
    now: () => {
      clockReads++;
      onClock();
      return time;
    },
    ...(sponsor ? { sponsorObservation: { ...port, panel: 'panel' } } : {}),
  });
  const owner = active;
  if (upload) owner.saveAdmission!.bind(editor.view, () => !relay.busy);
  const problems: unknown[] = [];
  const nativeValidation: unknown[] = [];
  let preparations = 0;
  const prepare = owner.prepare.bind(owner);
  owner.prepare = (...args) => {
    try {
      const candidate = prepare(...args);
      if (!candidate) problems.push('prepare refused');
      else {
        preparations++;
        try {
          validateNoteNativeOutput(editor.schema, candidate.projection.content, {
            current: () => owner.current(),
          });
        } catch (error) {
          nativeValidation.push(error instanceof Error ? error.message : error);
          try {
            validateNoteNativeOutput(
              editor.schema,
              JSON.parse(JSON.stringify(candidate.projection.content)),
              { current: () => owner.current() },
            );
          } catch (treeError) {
            nativeValidation.push(treeError instanceof Error ? treeError.message : treeError);
          }
        }
      }
      return candidate;
    } catch (error) {
      problems.push(error instanceof Error ? error.stack : error);
      throw error;
    }
  };
  return {
    port,
    beforeDispatch(fn?: typeof beforeDispatch) {
      beforeDispatch = fn;
    },
    setObservationSnapshot: (value?: typeof pages) => {
      observationSnapshot = value;
    },
    failObservationRegistration: () => {
      subscriptionFailure = true;
    },
    clearTestListeners: () => listeners.clear(),
    observationReads: () => observationReads,
    armObservationRead(count: number, action: () => void) {
      onObservationRead = () => {
        if (--count === 0) {
          onObservationRead = () => {};
          action();
        }
      };
    },
    now: () => time,
    setTime: (value: number) => {
      time = value;
    },
    owner,
    editor,
    base,
    note,
    problems,
    nativeValidation,
    preparations: () => preparations,
    armRead(fn: () => void) {
      onRead = () => {
        onRead = () => {};
        fn();
      };
    },
    clockReads: () => clockReads,
    armClockAfter(count: number, fn: () => void) {
      onClock = () => {
        if (--count === 0) {
          onClock = () => {};
          fn();
        }
      };
    },
    armClock(fn: () => void) {
      onClock = () => {
        onClock = () => {};
        fn();
      };
    },
    replaceAtFinalResourceRead() {
      const saved = pages,
        start = resourceReads;
      expect(owner.current()).toBe(true);
      const count = resourceReads - start;
      expect(count).toBeGreaterThan(0);
      let remaining = count;
      onResource = () => {
        if (--remaining === 0) {
          onResource = () => {};
          const d = note().document!;
          dispatch(
            a.pageDocumentSelectionChanged(ws, id, note().generation, d, {
              ...d.selection,
              anchor: 0,
              head: 0,
            }),
          );
        }
      };
      return () => {
        onResource = () => {};
        pages = saved;
      };
    },
    replaceAtFinalClockRead() {
      const saved = pages,
        start = clockReads;
      expect(owner.current()).toBe(true);
      const count = clockReads - start;
      expect(count).toBeGreaterThan(0);
      let remaining = count;
      onClock = () => {
        if (--remaining === 0) {
          onClock = () => {};
          const d = note().document!;
          dispatch(
            a.pageDocumentSelectionChanged(ws, id, note().generation, d, {
              ...d.selection,
              anchor: 0,
              head: 0,
            }),
          );
        }
      };
      return () => {
        onClock = () => {};
        pages = saved;
      };
    },
    async save(staged: boolean | 'direct' | 'pending' | 'unchanged') {
      const getState = () => {
        storeReads++;
        return { notePages: pages };
      };
      const previous = appClient.notes.pages;
      appClient.notes.pages = new LiveNotePagesClient();
      const rpc = vi.mocked(backendRequest);
      rpc.mockClear();
      const task = runSaga(
        {
          channel,
          dispatch,
          getState,
          context: {
            reduxStore: {
              getState,
              dispatch,
              subscribe: (fn: () => void) => {
                listeners.add(fn);
                return () => listeners.delete(fn);
              },
            },
          },
        },
        notePagesSaga,
      );
      try {
        const reads = storeReads;
        if (typeof staged === 'boolean')
          dispatch(
            a.pageSaveDraftsRequested(
              ws,
              id,
              staged
                ? { editorSessionId: 'local-point', selectionGeneration: 0, panelId: 'panel' }
                : undefined,
            ),
          );
        else if (staged === 'unchanged')
          dispatch(
            a.pageDraftsUnchanged(
              ws,
              id,
              note().generation,
              note().document!.baseRevision,
              note().history.at(-1)!.sequence,
            ),
          );
        else {
          const d = note().document!,
            now = Date.now();
          const operation = await prepareNoteSave(
            {
              scope: d.scope,
              sourceLength: d.baseLength,
              baseRevision: d.baseRevision,
              operationId: '00000000-0000-4000-8000-000000000042',
              expiresAt: new Date(now + 60000).toISOString(),
              splices: d.history[0].forward,
            },
            now,
          );
          dispatch(
            (staged === 'direct' ? a.pageSaveRequested : a.pageSaveStarted)(
              ws,
              id,
              operation,
              note().history.at(-1)!.sequence,
            ),
          );
        }
        await Promise.resolve();
        if (staged !== 'pending' && staged !== 'unchanged')
          expect(storeReads).toBeGreaterThan(reads);
        expect(note().pending).toBeNull();
        expect(rpc).not.toHaveBeenCalled();
      } finally {
        task.cancel();
        await task.toPromise();
        appClient.notes.pages = previous;
      }
    },
    baselineBytes,
    retireContext() {
      baseBorrow.release();
      return offer.release();
    },
    ledger: () => pages.resourceLedger,
    setResourceSnapshot: (value?: typeof pages.resourceLedger) => {
      resourceSnapshot = value;
    },
    refs: () => refs,
    insert: () => editor.chain().insertContent('X').insertPointAnchor(pointId).run(),
    invalidate: () => {
      live = false;
    },
    expire: () => {
      time = Date.parse(identity.expiresAt);
    },
    traverse(direction: 'undo' | 'redo') {
      const h = owner.history?.(direction);
      expect(h).toBeDefined();
      if (!h) throw new Error('No history');
      expect(h.current()).toBe(true);
      const doc = h.initial.doc;
      const projection = h.initial.projection;
      editor.view.updateState(
        EditorState.create({
          plugins: editor.state.plugins,
          doc,
          selection: TextSelection.create(
            doc,
            projection.pmAt(h.selection.anchor, h.selection.anchorAffinity),
            projection.pmAt(h.selection.head, h.selection.headAffinity),
          ),
        }),
      );
      h.commit();
      expect(h.adopted()).toBe(true);
    },
    async destroyWithUnknownDebt() {
      owner.dispose();
      editor.destroy();
      baseBorrow.release();
      let released = false;
      void offer.release().then(() => {
        released = true;
      });
      readTask.cancel();
      await readTask.toPromise();
      dispatch(a.pagePanelClosed(ws, id, 'panel'));
      dispatch(a.pageResourcesReleased('local-window'));
      appClient.notes.pages = previousClient;
      await Promise.resolve();
      expect(released).toBe(false);
      expect(refs).toBe(1);
      expect(pages.resourceLedger.used.payloadBytes).toBeGreaterThan(0);
      // Unknown dependent cleanup is deliberately still charged, never timed out
      // into a claimed settlement. No native Editor or running saga remains.
    },
    async destroy() {
      owner.dispose();
      editor.destroy();
      baseBorrow.release();
      await offer.release();
      readTask.cancel();
      await readTask.toPromise();
      dispatch(a.pagePanelClosed(ws, id, 'panel'));
      dispatch(a.pageResourcesReleased('local-window'));
      appClient.notes.pages = previousClient;
      expect(listeners.size).toBe(0);
    },
  };
}

it('publishes a genuine local point group through configured relay and Redux then locally undoes/redoes it', async () => {
  const f = await fixture();
  try {
    const original = f.note().document!;
    expect(f.insert()).toBe(true);
    expect(f.problems).toEqual([]);
    expect(f.preparations()).toBe(1);
    expect(f.nativeValidation).toEqual([
      'Native output must be a tree',
      'Native attribute has no configured validator',
    ]);
    const d = f.note().document!;
    expect(d).not.toBe(original);
    expect(d.history).toHaveLength(1);
    const g = d.history[0];
    expect(g.kind).toBe('local-point');
    expect(g.id).toBe(original.generation + 1);
    expect(g.forward).toEqual([{ start: 1, end: 1, text: `X${literal}` }]);
    expect(g.inverse).toEqual([{ start: 1, end: 58, text: '' }]);
    expect(g.before).toEqual({ anchor: 1, head: 1, anchorAffinity: 1, headAffinity: 1 });
    expect(g.after).toEqual({ anchor: 58, head: 58, anchorAffinity: 1, headAffinity: 1 });
    expect(JSON.parse(JSON.stringify(d)).history[0].kind).toBe('local-point');
    expect(d.length).toBe(59);
    expect(f.owner.initial.projection.source).toBe(`aX${literal}b`);
    expect(f.editor.state.doc.nodeAt(3)?.type.name).toBe('commentAnchor');
    expect(f.note().drafts).toHaveLength(1);
    expect(f.refs()).toBe(1);
    f.traverse('undo');
    expect(f.note().document!.length).toBe(2);
    expect(f.owner.initial.projection.source).toBe('ab');
    f.traverse('redo');
    expect(f.note().document!.history[0]).toBe(g);
    expect(f.owner.initial.projection.source).toBe(`aX${literal}b`);
    expect(f.editor.state.doc.nodeAt(3)?.type.name).toBe('commentAnchor');
  } finally {
    await f.destroy();
  }
  expect(f.refs()).toBe(0);
  expect(f.ledger().used.payloadBytes).toBe(0);
});

it.each(['filter', 'append'] as const)(
  'retires unpromoted proof after %s rejection without publishing a group',
  async (mode) => {
    const f = await fixture(mode);
    try {
      const before = f.note().document;
      f.insert();
      expect(f.problems).toEqual([]);
      expect(f.preparations()).toBe(1);
      expect(f.note().document).toBe(before);
      expect(f.note().drafts).toEqual([]);
      expect(f.editor.state.doc.textContent).toBe('ab');
      expect(f.refs()).toBe(0);
      expect(f.ledger().used.payloadBytes).toBe(f.baselineBytes);
    } finally {
      await f.destroy();
    }
  },
);

it('refuses ordinary text history/witness/reconciliation for the typed group', async () => {
  const f = await fixture();
  try {
    f.insert();
    const d = f.note().document!;
    expect(() => captureNoteNativeHistoryWitness(d)).toThrow();
    expect(() => moveNoteDocumentHistory(d, 'undo')).toThrow('Unsupported local point history');
    expect(() => materializeNoteDocumentAuthority(d, f.base)).toThrow(
      'Unsupported local point history',
    );
    expect(() =>
      reconcileNoteDocumentSave(d, {
        generation: d.generation,
        baseRevision: d.baseRevision,
        sourceRevision: 'next',
        sourceLength: d.length,
        exactLocalResult: true,
      }),
    ).toThrow('Unsupported local point history');
    expect(f.note().document).toBe(d);
  } finally {
    await f.destroy();
  }
});

it.each(['loss', 'expiry'] as const)(
  'retains physical debt after %s until the borrower settles',
  async (kind) => {
    const f = await fixture();
    let release: (() => void) | undefined;
    try {
      f.insert();
      const before = f.note().document!;
      release = f.owner.retain();
      const bytes = f.ledger().used.payloadBytes;
      expect(bytes).toBeGreaterThan(0);
      if (kind === 'loss') f.invalidate();
      else f.expire();
      expect(f.owner.current()).toBe(false);
      expect(f.note().document).toBe(before);
      expect(f.ledger().used.payloadBytes).toBe(bytes);
      expect(f.refs()).toBe(1);
      release();
      expect(f.ledger().used.payloadBytes).toBe(f.baselineBytes);
      expect(f.refs()).toBe(0);
      expect(f.owner.current()).toBe(false);
    } finally {
      release?.();
      await f.destroy();
    }
  },
);

it.each([false, true])('refuses the actual save saga before RPC (staged=%s)', async (staged) => {
  const f = await fixture();
  try {
    f.insert();
    expect(f.note().document!.history[0]?.kind).toBe('local-point');
    const before = f.note();
    await f.save(staged);
    expect(f.note()).toBe(before);
  } finally {
    await f.destroy();
  }
});
it('denies allocation before native local proof construction', async () => {
  const f = await fixture('normal', true);
  try {
    const before = f.note();
    f.insert();
    expect(f.preparations()).toBe(0);
    expect(f.note().document).toBe(before.document);
    expect(f.refs()).toBe(0);
    expect(f.ledger().used.payloadBytes).toBe(f.baselineBytes);
  } finally {
    await f.destroy();
  }
});
it('refuses a later local edit and keeps the original group', async () => {
  const f = await fixture();
  try {
    f.insert();
    const before = f.note().document!;
    expect(before.history[0]?.kind).toBe('local-point');
    const doc = f.editor.state.doc;
    f.editor.commands.insertContent('later');
    expect(f.note().document).toBe(before);
    expect(f.editor.state.doc).toBe(doc);
    expect(f.owner.current()).toBe(true);
  } finally {
    await f.destroy();
  }
});

it('keeps the real prepared context allocation through held dependent work', async () => {
  const f = await fixture();
  let release: (() => void) | undefined;
  try {
    f.insert();
    expect(f.note().document!.history[0]?.kind).toBe('local-point');
    release = f.owner.retain();
    const key = Object.keys(f.ledger().owners).find((id) => id.startsWith('edit-context:'))!;
    expect(key).toBeTruthy();
    const allocation = f.ledger().owners[key];
    let retired = false;
    const retiring = f.retireContext().then(() => {
      retired = true;
    });
    expect(f.owner.current()).toBe(false);
    await Promise.resolve();
    expect(retired).toBe(false);
    expect(f.ledger().owners[key]).toEqual(allocation);
    release();
    await retiring;
    expect(f.ledger().owners[key]).toBeUndefined();
    expect(f.refs()).toBe(0);
  } finally {
    release?.();
    await f.destroy();
  }
});

it.each(['read', 'clock'] as const)(
  'permanently loses the local owner on %s callback output mutation',
  async (kind) => {
    const f = await fixture();
    try {
      f.insert();
      expect(f.note().document!.history[0]?.kind).toBe('local-point');
      const before = f.note().document;
      const p = f.owner.initial.projection,
        prior = p.positions.get(2)!;
      const mutate = () => {
        Map.prototype.set.call(p.positions, 2, prior + 1);
      };
      if (kind === 'read') f.armRead(mutate);
      else f.armClock(mutate);
      expect(f.owner.current()).toBe(false);
      Map.prototype.set.call(p.positions, 2, prior);
      expect(f.owner.current()).toBe(false);
      expect(f.note().document).toBe(before);
      expect(f.refs()).toBe(0);
    } finally {
      await f.destroy();
    }
  },
);
it('refuses a mutated pending candidate before native and domain publication', async () => {
  const f = await fixture();
  try {
    const before = f.note().document;
    const validate = f.owner.nativeOutput!.bind(f.owner);
    f.owner.nativeOutput = (candidate, tr) => {
      const p = candidate.projection;
      f.armRead(() => {
        Map.prototype.set.call(p.positions, 2, 999);
      });
      return validate(candidate, tr);
    };
    f.insert();
    expect(f.preparations()).toBe(1);
    expect(f.note().document).toBe(before);
    expect(f.editor.state.doc.textContent).toBe('ab');
    expect(f.refs()).toBe(0);
    expect(f.owner.current()).toBe(false);
  } finally {
    await f.destroy();
  }
});

it.each(['direct', 'pending', 'unchanged'] as const)(
  'refuses %s save admission with a retained local group even after undo',
  async (path) => {
    const f = await fixture();
    try {
      f.insert();
      expect(f.note().document!.history[0]?.kind).toBe('local-point');
      for (const undone of [false, true]) {
        if (undone) f.traverse('undo');
        const before = f.note();
        await f.save(path);
        expect(f.note()).toBe(before);
        expect(f.note().document!.history).toHaveLength(1);
      }
    } finally {
      await f.destroy();
    }
  },
);

it('rereads the document after the final resource callback and latches loss', async () => {
  const f = await fixture();
  let restore: (() => void) | undefined;
  try {
    f.insert();
    expect(f.note().document!.history[0]?.kind).toBe('local-point');
    const group = f.note().document!.history[0];
    restore = f.replaceAtFinalResourceRead();
    expect(f.owner.current()).toBe(false);
    restore();
    expect(f.owner.current()).toBe(false);
    expect(f.note().document!.history[0]).toBe(group);
  } finally {
    restore?.();
    await f.destroy();
  }
});

it('rereads the document after the last helper clock callback', async () => {
  const f = await fixture();
  let restore: (() => void) | undefined;
  try {
    f.insert();
    expect(f.note().document!.history[0]?.kind).toBe('local-point');
    const before = f.note().document!;
    restore = f.replaceAtFinalClockRead();
    expect(f.owner.current()).toBe(false);
    expect(f.note().document).not.toBe(before);
    restore();
    expect(f.owner.current()).toBe(false);
  } finally {
    restore?.();
    await f.destroy();
  }
});

it('releases abandoned and replaced native outputs across repeated local history', async () => {
  const f = await fixture();
  try {
    f.insert();
    const group = f.note().document!.history[0],
      bytes = f.ledger().used.payloadBytes;
    const abandoned = f.owner.history!('undo')!;
    expect(abandoned.current()).toBe(true);
    const newer = f.owner.history!('undo')!;
    expect(abandoned.current()).toBe(false);
    expect(newer.current()).toBe(true);
    for (let i = 0; i < 4; i++) {
      f.traverse('undo');
      f.traverse('redo');
      expect(f.note().document!.history[0]).toBe(group);
      expect(f.ledger().used.payloadBytes).toBe(bytes);
    }
  } finally {
    await f.destroy();
  }
});

it('refuses another allocation while an abandoned prepared borrow is physically retained', async () => {
  const f = await fixture();
  let drop: (() => void) | undefined;
  try {
    const before = f.owner.initial;
    const transaction = f.editor.state.tr.insertText('X', 2).insert(
      3,
      f.editor.schema.nodes.commentAnchor.create({
        id: `${pointId}:point`,
        type: 'point',
        commentId: pointId,
      }),
    );
    const candidate = f.owner.prepare(transaction, before)!;
    expect(candidate).toBeDefined();
    drop = f.owner.retainPrepared(candidate, transaction);
    const bytes = f.ledger().used.payloadBytes;
    f.owner.settled?.();
    expect(f.ledger().used.payloadBytes).toBe(bytes);
    expect(f.refs()).toBe(1);
    expect(f.owner.prepare(transaction, before)).toBeUndefined();
    expect(f.ledger().used.payloadBytes).toBe(bytes);
    drop();
    expect(f.refs()).toBe(0);
    expect(f.ledger().used.payloadBytes).toBe(f.baselineBytes);
  } finally {
    drop?.();
    await f.destroy();
  }
});

it('issues one bounded sponsor from the actually accepted group and refuses copied owner authority', async () => {
  const f = await fixture('normal', false, true);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(() => createNoteLocalPointSaveSponsor({ ...f.owner })).toThrow();
    expect(f.insert()).toBe(true);
    const before = f.ledger().used.payloadBytes;
    sponsor = f.owner.saveSponsor();
    expect(sponsor.precommitCurrent()).toBe(true);
    expect(sponsor.input.header.localEditSequence).toBe(f.note().document!.history[0].id);
    expect(f.ledger().used.payloadBytes).toBe(before + 1048576);
    expect(() => f.owner.saveSponsor()).toThrow();
    await sponsor.release();
    expect(sponsor.precommitCurrent()).toBe(false);
    expect(f.ledger().used.payloadBytes).toBe(before);
  } finally {
    await sponsor?.release();
    await f.destroy();
  }
});

it('retains independent evidence after original proof release and real reducer invalidation', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    const stage = await controlledSeal(sponsor);
    await sponsor.bindSealed(stage);
    const sealed = stage.sealedSave();
    const d = f.note().document!,
      state = f.note().state!,
      scope = d.scope;
    sponsor.handoffForOutcomeObservation();
    // Advance unrelated state so the actual reducer generation is not old+1.
    f.port.dispatch(a.pagePanelOpened(scope.workspaceId, 'unrelated', 'other'));
    const oldGeneration = f.note().generation;
    f.port.dispatch(
      a.pageStateReceived(scope.workspaceId, scope.noteId, oldGeneration, {
        ...state,
        stateGeneration: '2',
        sourceRevision: 'controlled-after',
      }),
    );
    expect(f.note().generation).not.toBe(oldGeneration + 1);
    expect(f.note().needsReconcile).toBe(true);
    expect(f.note().document).toBe(d);
    f.owner.dispose();
    expect(f.owner.current()).toBe(false);
    vi.mocked(backendRequest).mockResolvedValue({
      kind: 'noteCommitReceipt',
      outcome: 'committed',
      scope,
      operationId: sealed.operationId,
      headerDigest: sealed.headerDigest,
      payloadDigest: sealed.payloadDigest,
      beforeRevision: sealed.baseRevision,
      afterRevision: 'controlled-after',
      sourceLength: 3,
      mappingRef: 'mapping',
      effectsRef: 'effects',
      inverseRef: 'inverse',
      viewId: 'controlled-view',
      receiptExpiresAt: sealed.expiresAt,
      invalidation: 'all',
    });
    expect(await sponsor.observeOutcome()).toBe('committed');
    expect(f.refs()).toBe(1);
    await sponsor.release();
    expect(f.refs()).toBe(0);
    expect(f.note().document).toBe(d);
  } finally {
    await sponsor?.release();
    clock.mockRestore();
    await f.destroy();
  }
});

it('refuses a reentrant callback handoff before any nested transition can publish', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    await sponsor.bindSealed(await controlledSeal(sponsor));
    let nestedAccepted = false;
    f.armClock(() => {
      try {
        sponsor!.handoffForOutcomeObservation();
        nestedAccepted = true;
      } catch {}
    });
    sponsor.handoffForOutcomeObservation();
    expect(nestedAccepted).toBe(false);
  } finally {
    await sponsor?.release();
    clock.mockRestore();
    await f.destroy();
  }
});

it('rechecks the final observer clock after the last callbackful Redux read', async () => {
  const f = await fixture('normal', false, true);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    const before = f.observationReads();
    expect(sponsor.precommitCurrent()).toBe(true);
    const count = f.observationReads() - before;
    expect(count).toBeGreaterThan(0);
    let reached = false;
    const expired = Date.parse(sponsor.input.expiresAt) + 1;
    f.armObservationRead(count, () => {
      reached = true;
      f.setTime(expired);
    });
    expect(sponsor.precommitCurrent()).toBe(false);
    expect(reached).toBe(true);
    expect(f.now()).toBe(expired);
    f.setTime(plainLocal.capturedAtMs);
    expect(sponsor.precommitCurrent()).toBe(false);
  } finally {
    await sponsor?.release();
    await f.destroy();
  }
});

it('mints one private DATA certificate for a controlled NEW operation after complete bound receipt traversal', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    const stage = await controlledSeal(sponsor);
    await sponsor.bindSealed(stage);
    const controlled = await controlledReceipt(stage, sponsor.input.header.localEditSequence);
    let rawMutations = 0;
    vi.mocked(backendRequest).mockImplementation(async (method, params) => {
      const raw = await controlled.respond(method, params);
      f.armClock(() => {
        // The private transport snapshot must already exist before this callback.
        Object.assign(raw, { viewId: 'mutated-alias', scope: {}, items: [] });
        rawMutations++;
      });
      return raw;
    });
    sponsor.handoffForOutcomeObservation();
    // Receipt-first is valid DATA; it cannot certify before the real invalidation.
    expect(await sponsor.observeOutcome()).toBe('committed');
    const note = f.note(),
      document = note.document!;
    f.port.dispatch(
      a.pageStateReceived(document.scope.workspaceId, document.scope.noteId, note.generation, {
        ...note.state!,
        stateGeneration: '2',
        sourceRevision: controlled.receipt.afterRevision,
      }),
    );
    f.owner.dispose();
    expect(f.owner.current()).toBe(false);
    const certificate = await sponsor.certificate();
    expect(rawMutations).toBeGreaterThan(1);
    expect(currentPointCanonicalCertificate(certificate)).toBe(true);
    expect(currentPointCanonicalCertificate({ ...certificate })).toBe(false);
    expect(currentPointCanonicalCertificate(controlled.receipt)).toBe(false);
    expect(() => captureNoteNativeHistoryWitness(document)).toThrow();
    expect(() => moveNoteDocumentHistory(document, 'undo')).toThrow(
      'Unsupported local point history',
    );
    expect(f.note().document).toBe(document);
    expect(f.note().needsReconcile).toBe(true);
    expect(f.refs()).toBe(1);
    await sponsor.release();
    expect(currentPointCanonicalCertificate(certificate)).toBe(false);
    expect(f.refs()).toBe(0);
  } finally {
    await sponsor?.release();
    clock.mockRestore();
    await f.destroy();
  }
});

it('refuses status when the exact admitted receipt allocation is removed', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    await sponsor.bindSealed(await controlledSeal(sponsor));
    sponsor.handoffForOutcomeObservation();
    const io = Object.keys(f.ledger().owners).find((key) => key.startsWith('point-receipt:'))!;
    expect(io).toBeTruthy();
    f.port.dispatch(a.pageResourcesReleased(io));
    const before = vi.mocked(backendRequest).mock.calls.length;
    await expect(sponsor.observeOutcome()).rejects.toThrow();
    expect(vi.mocked(backendRequest).mock.calls.length).toBe(before);
  } finally {
    await sponsor?.release();
    clock.mockRestore();
    await f.destroy();
  }
});

it.each(['after-capture', 'during-registration'] as const)(
  'irreversibly loses sponsor on reconnect %s',
  async (when) => {
    const f = await fixture('normal', false, true);
    let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
    let reconnect = () => {};
    const off = vi.fn();
    vi.mocked(onBackendReconnected).mockImplementation((fn) => {
      reconnect = fn;
      if (when === 'during-registration') fn();
      return off;
    });
    try {
      expect(f.insert()).toBe(true);
      if (when === 'during-registration') expect(() => f.owner.saveSponsor()).toThrow();
      else {
        sponsor = f.owner.saveSponsor();
        expect(sponsor.precommitCurrent()).toBe(true);
        reconnect();
        expect(sponsor.precommitCurrent()).toBe(false);
        expect(() => f.owner.saveSponsor()).toThrow();
        await sponsor.release();
        reconnect();
        expect(sponsor.precommitCurrent()).toBe(false);
      }
      expect(off).toHaveBeenCalledOnce();
    } finally {
      await sponsor?.release();
      vi.mocked(onBackendReconnected).mockImplementation(() => () => {});
      await f.destroy();
    }
  },
);

it('checks reconnect at the decoder pre-send clock and sends zero receipt RPCs', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  let observer: ReturnType<typeof claimLiveNoteStagedSave> | undefined;
  let loss: ReturnType<typeof retainLiveNoteSaveLoss> | undefined;
  let reconnect = () => {};
  vi.mocked(onBackendReconnected).mockImplementation((fn) => {
    reconnect = fn;
    return () => {};
  });
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    const stage = await controlledSeal(sponsor);
    const controlled = await controlledReceipt(stage, sponsor.input.header.localEditSequence);
    vi.mocked(backendRequest).mockImplementation(controlled.respond);
    let samples = 0,
      armed = false,
      reached = false;
    loss = retainLiveNoteSaveLoss();
    observer = claimLiveNoteStagedSave(
      stage,
      loss,
      () => true,
      () => {
        if (armed && ++samples === 2) {
          reached = true;
          reconnect();
        }
        return f.now();
      },
    );
    await observer.observeOutcome();
    const count = vi.mocked(backendRequest).mock.calls.length;
    armed = true;
    await expect(
      observer.readReceipt({ kind: 'mapping', baseLength: 2, maxItems: 64, maxWireBytes: 8192 }),
    ).rejects.toThrow();
    expect(reached).toBe(true);
    expect(vi.mocked(backendRequest).mock.calls.length).toBe(count);
  } finally {
    await observer?.release();
    loss?.release();
    await sponsor?.release();
    vi.mocked(onBackendReconnected).mockImplementation(() => () => {});
    clock.mockRestore();
    await f.destroy();
  }
});

it('holds native and receipt credit through cancelled outstanding status until actual resolution', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    const stage = await controlledSeal(sponsor);
    await sponsor.bindSealed(stage);
    const controlled = await controlledReceipt(stage, sponsor.input.header.localEditSequence);
    sponsor.handoffForOutcomeObservation();
    let settle!: (value: unknown) => void;
    vi.mocked(backendRequest).mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const pending = sponsor.observeOutcome();
    const refused = expect(pending).rejects.toThrow();
    expect(settle).toBeTypeOf('function');
    const held = f.ledger().used.payloadBytes;
    f.owner.dispose();
    const release = sponsor.release();
    let released = false;
    void release.then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    expect(f.refs()).toBe(1);
    expect(f.ledger().used.payloadBytes).toBe(held);
    settle(controlled.receipt);
    await refused;
    await release;
    expect(f.refs()).toBe(0);
    expect(f.ledger().used.payloadBytes).toBeLessThan(held);
  } finally {
    await sponsor?.release();
    clock.mockRestore();
    await f.destroy();
  }
});

it('retains unknown observer cleanup after a transport rejection and still unsubscribes', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  const off = vi.fn();
  vi.mocked(onBackendReconnected).mockImplementation(() => off);
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    const stage = await controlledSeal(sponsor);
    const loss = retainLiveNoteSaveLoss();
    const observer = claimLiveNoteStagedSave(stage, loss, () => true, f.now);
    vi.mocked(backendRequest).mockRejectedValue(
      new Error('controlled transport settlement unknown'),
    );
    await expect(observer.observeOutcome()).rejects.toThrow('controlled transport');
    expect(observer.current()).toBe(false);
    await expect(observer.release()).rejects.toThrow('cleanup unknown');
    loss.release();
    expect(off).toHaveBeenCalled();
    // This tests the observer primitive: no sponsor receipt allocation was bound.
  } finally {
    await sponsor?.release();
    vi.mocked(onBackendReconnected).mockImplementation(() => () => {});
    clock.mockRestore();
    await f.destroy();
  }
});

it.each(['changes', 'forward', 'backward'] as const)(
  'pins independent navigation %s after original proof disposal',
  async (key) => {
    const f = await fixture('normal', false, true);
    const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
    let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
    try {
      expect(f.insert()).toBe(true);
      sponsor = f.owner.saveSponsor();
      const stage = await controlledSeal(sponsor);
      await sponsor.bindSealed(stage);
      const controlled = await controlledReceipt(stage, sponsor.input.header.localEditSequence);
      sponsor.handoffForOutcomeObservation();
      vi.mocked(backendRequest).mockImplementation(controlled.respond);
      const note = f.note(),
        doc = note.document!;
      f.port.dispatch(
        a.pageStateReceived(doc.scope.workspaceId, doc.scope.noteId, note.generation, {
          ...note.state!,
          stateGeneration: '2',
          sourceRevision: controlled.receipt.afterRevision,
        }),
      );
      f.owner.dispose();
      const navigation = Object.getOwnPropertyDescriptor(f.base, 'navigation')!.value;
      const collection = Object.getOwnPropertyDescriptor(navigation, key)!.value;
      if (key === 'changes') collection.push({ shift: 1 });
      else Map.prototype.set.call(collection, 999, 999);
      const count = vi.mocked(backendRequest).mock.calls.length;
      await expect(sponsor.observeOutcome()).rejects.toThrow();
      if (key === 'changes') collection.pop();
      else Map.prototype.delete.call(collection, 999);
      await expect(sponsor.observeOutcome()).rejects.toThrow();
      expect(vi.mocked(backendRequest).mock.calls.length).toBe(count);
    } finally {
      await sponsor?.release();
      clock.mockRestore();
      await f.destroy();
    }
  },
);

it.each(['panel', 'generation', 'document'] as const)(
  'refuses later %s changes without reviving unsaved history',
  async (kind) => {
    const f = await fixture('normal', false, true);
    let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
    try {
      expect(f.insert()).toBe(true);
      sponsor = f.owner.saveSponsor();
      const note = f.note(),
        doc = note.document!;
      if (kind === 'panel')
        f.port.dispatch(a.pagePanelClosed(doc.scope.workspaceId, doc.scope.noteId, 'panel'));
      else if (kind === 'generation')
        f.port.dispatch(
          a.pageStateReceived(doc.scope.workspaceId, doc.scope.noteId, note.generation, {
            ...note.state!,
            stateGeneration: '2',
            sourceRevision: 'different',
          }),
        );
      else f.traverse('undo');
      expect(sponsor.precommitCurrent()).toBe(false);
      if (kind === 'document') f.traverse('redo');
      expect(sponsor.precommitCurrent()).toBe(false);
    } finally {
      await sponsor?.release();
      await f.destroy();
    }
  },
);

it('refuses a final-clock replacement of the captured ledger parent association', async () => {
  const f = await fixture('normal', false, true);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    const ledger = structuredClone(f.ledger());
    f.setResourceSnapshot(ledger);
    const owner = Object.keys(ledger.owners).find((k) => k.startsWith('point-sponsor:'))!;
    const prior = ledger.owners[owner];
    let reached = false;
    f.armClock(() => {
      delete ledger.owners[owner];
      reached = true;
    });
    expect(sponsor.precommitCurrent()).toBe(false);
    expect(reached).toBe(true);
    ledger.owners[owner] = prior;
    expect(sponsor.precommitCurrent()).toBe(false);
  } finally {
    f.setResourceSnapshot();
    await sponsor?.release();
    await f.destroy();
  }
});

it('rechecks observer receipt expiry after its current callback advances the clock', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  let observer: ReturnType<typeof claimLiveNoteStagedSave> | undefined;
  let loss: ReturnType<typeof retainLiveNoteSaveLoss> | undefined;
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    const stage = await controlledSeal(sponsor);
    const c = await controlledReceipt(stage, sponsor.input.header.localEditSequence);
    vi.mocked(backendRequest).mockImplementation(c.respond);
    let time = f.now(),
      armed = false,
      reached = false;
    loss = retainLiveNoteSaveLoss();
    observer = claimLiveNoteStagedSave(
      stage,
      loss,
      () => {
        if (armed) {
          time = Date.parse(c.receipt.receiptExpiresAt);
          reached = true;
        }
        return true;
      },
      () => time,
    );
    await observer.observeOutcome();
    armed = true;
    expect(observer.current()).toBe(false);
    expect(reached).toBe(true);
    time = f.now();
    armed = false;
    expect(observer.current()).toBe(false);
  } finally {
    await observer?.release();
    loss?.release();
    await sponsor?.release();
    clock.mockRestore();
    await f.destroy();
  }
});

it.each(['copied', 'standalone', 'operation', 'generation', 'source'] as const)(
  'refuses %s stage correspondence without invoking outcome RPC',
  async (kind) => {
    const f = await fixture('normal', false, true);
    const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
    let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
    try {
      expect(f.insert()).toBe(true);
      sponsor = f.owner.saveSponsor();
      const input =
        kind === 'operation'
          ? { ...sponsor.input, operationId: '00000000-0000-4000-8000-000000000002' }
          : kind === 'generation'
            ? { ...sponsor.input, header: { ...sponsor.input.header, liveGeneration: 999 } }
            : sponsor.input;
      const stage = await controlledSeal(
        { ...sponsor, input },
        kind === 'source' ? `Y${literal}` : `X${literal}`,
        kind !== 'standalone',
      );
      const count = vi.mocked(backendRequest).mock.calls.length;
      await expect(sponsor.bindSealed(kind === 'copied' ? { ...stage } : stage)).rejects.toThrow();
      expect(vi.mocked(backendRequest).mock.calls.length).toBe(count);
      expect(sponsor.precommitCurrent()).toBe(false);
    } finally {
      await sponsor?.release();
      clock.mockRestore();
      await f.destroy();
    }
  },
);

it('refuses sponsor admission before copying when its dedicated budget cannot fit', async () => {
  const f = await fixture('normal', false, true);
  let accidental: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(f.insert()).toBe(true);
    const before = f.ledger().used.payloadBytes,
      refs = f.refs();
    const cost = {
      payloadBytes: f.ledger().limit.payloadBytes - before,
      stringUnits: 0,
      objectNodes: 0,
      domNodes: 0,
      physicalReads: 0,
      assemblies: 0,
    };
    f.port.dispatch(a.pageResourcesRequested('budget-block', [{ id: 'budget-block', cost }]));
    expect(f.ledger().used.payloadBytes).toBe(f.ledger().limit.payloadBytes);
    expect(() => {
      accidental = f.owner.saveSponsor();
    }).toThrow();
    expect(f.refs()).toBe(refs);
    expect(
      Object.keys(f.ledger().owners).filter((k) => k.startsWith('point-sponsor:')),
    ).toHaveLength(0);
  } finally {
    await accidental?.release();
    f.port.dispatch(a.pageResourcesReleased('budget-block'));
    await f.destroy();
  }
});

it('keeps the original allocation charged when early registration throws after a side effect', async () => {
  const f = await fixture('normal', false, true);
  let reconnect = () => {};
  vi.mocked(onBackendReconnected).mockImplementation((fn) => {
    reconnect = fn;
    throw new Error('registered then threw');
  });
  try {
    expect(f.insert()).toBe(true);
    const bytes = f.ledger().used.payloadBytes;
    expect(() => f.owner.saveSponsor()).toThrow('cleanup unknown');
    reconnect();
    f.owner.dispose();
    expect(f.refs()).toBe(1);
    expect(f.ledger().used.payloadBytes).toBe(bytes);
    expect(() => f.owner.saveSponsor()).toThrow();
  } finally {
    vi.mocked(onBackendReconnected).mockImplementation(() => () => {});
    await f.destroyWithUnknownDebt();
  }
});

it('retains bound sponsor IO and native debt after a transport rejection while removing known listeners', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  const off = vi.fn();
  vi.mocked(onBackendReconnected).mockImplementation(() => off);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    const stage = await controlledSeal(sponsor);
    await sponsor.bindSealed(stage);
    sponsor.handoffForOutcomeObservation();
    vi.mocked(backendRequest).mockRejectedValue(new Error('controlled unknown transport'));
    await expect(sponsor.observeOutcome()).rejects.toThrow('controlled unknown');
    const held = f.ledger().used.payloadBytes;
    f.owner.dispose();
    await expect(sponsor.release()).rejects.toThrow('cleanup incomplete');
    expect(off).toHaveBeenCalledOnce();
    expect(f.ledger().used.payloadBytes).toBe(held);
    expect(f.refs()).toBe(1);
    expect(sponsor.precommitCurrent()).toBe(false);
  } finally {
    vi.mocked(onBackendReconnected).mockImplementation(() => () => {});
    clock.mockRestore();
    await f.destroyWithUnknownDebt();
  }
});

it.each(['reentrant', 'throw'] as const)('owns loss disposer %s exactly once', (mode) => {
  let lease: ReturnType<typeof retainLiveNoteSaveLoss>;
  const dispose = vi.fn(() => {
    if (mode === 'throw') throw new Error('controlled disposer failure');
    expect(() => lease.release()).toThrow('cleanup unknown');
  });
  vi.mocked(onBackendReconnected).mockImplementation(() => dispose);
  try {
    lease = retainLiveNoteSaveLoss();
    expect(lease.current()).toBe(true);
    if (mode === 'throw') {
      expect(() => lease.release()).toThrow('controlled disposer');
      expect(() => lease.release()).toThrow('cleanup unknown');
    } else {
      lease.release();
      lease.release();
    }
    expect(dispose).toHaveBeenCalledOnce();
    expect(lease.current()).toBe(false);
  } finally {
    vi.mocked(onBackendReconnected).mockImplementation(() => () => {});
  }
});

it('cannot replace a captured final checkpoint by reentering during the last observer clock', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    // Measure genuine sponsor callback count, then target the separate observer
    // final clock immediately after the same precommit-current invocation.
    let readCount = 0,
      snapshot = 0,
      armed = false,
      reached = false;
    const stage = await controlledSeal(sponsor);
    const loss = retainLiveNoteSaveLoss();
    const observer = claimLiveNoteStagedSave(
      stage,
      loss,
      () => {
        const before = f.clockReads();
        const valid = sponsor!.precommitCurrent();
        readCount = f.clockReads() - before;
        snapshot++;
        return valid;
      },
      () => {
        if (armed) {
          armed = false;
          reached = true;
          expect(sponsor!.precommitCurrent()).toBe(true);
          snapshot++;
        }
        return f.now();
      },
      () => {
        const exact = snapshot;
        return () => snapshot === exact;
      },
    );
    try {
      expect(readCount).toBeGreaterThan(0);
      armed = true;
      expect(observer.current()).toBe(false);
      expect(reached).toBe(true);
      expect(observer.current()).toBe(false);
    } finally {
      await observer.release();
      loss.release();
    }
  } finally {
    await sponsor?.release();
    clock.mockRestore();
    await f.destroy();
  }
});

it('keeps allocation debt when Redux subscribe registers and then throws', async () => {
  const f = await fixture('normal', false, true);
  try {
    expect(f.insert()).toBe(true);
    f.failObservationRegistration();
    expect(() => f.owner.saveSponsor()).toThrow('controlled observation');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    f.owner.dispose();
    expect(f.refs()).toBe(1);
    expect(Object.keys(f.ledger().owners).some((k) => k.startsWith('point-sponsor:'))).toBe(true);
  } finally {
    // Only the controlled test harness can remove its deliberately escaped callback.
    // This never returns unknown production allocation credit.
    f.clearTestListeners();
    if (f.refs()) await f.destroyWithUnknownDebt();
    else await f.destroy();
  }
});

it.each(['root', 'workspace', 'notes', 'note'] as const)(
  'pins Redux %s parent link at the final clock',
  async (kind) => {
    const f = await fixture('normal', false, true);
    let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
    try {
      expect(f.insert()).toBe(true);
      sponsor = f.owner.saveSponsor();
      const original = f.port.read(),
        scope = f.note().document!.scope;
      const workspace = {
        ...original.byWorkspaceId[scope.workspaceId],
        notes: { ...original.byWorkspaceId[scope.workspaceId].notes },
      };
      const root = {
        ...original,
        byWorkspaceId: { ...original.byWorkspaceId, [scope.workspaceId]: workspace },
      };
      f.setObservationSnapshot(root);
      const before = f.clockReads();
      expect(sponsor.precommitCurrent()).toBe(true);
      const count = f.clockReads() - before;
      let reached = false;
      f.armClockAfter(count, () => {
        reached = true;
        if (kind === 'root') root.byWorkspaceId = {};
        else if (kind === 'workspace') delete root.byWorkspaceId[scope.workspaceId];
        else if (kind === 'notes') workspace.notes = {};
        else delete workspace.notes[scope.noteId];
      });
      expect(sponsor.precommitCurrent()).toBe(false);
      expect(reached).toBe(true);
      f.setObservationSnapshot();
      expect(sponsor.precommitCurrent()).toBe(false);
    } finally {
      f.setObservationSnapshot();
      await sponsor?.release();
      await f.destroy();
    }
  },
);

it('binds the actual sponsor checkpoint across the final claim clock reentry', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  try {
    expect(f.insert()).toBe(true);
    sponsor = f.owner.saveSponsor();
    let armed = false,
      reached = false,
      nestedAccepted = false,
      count = 0;
    const stage = await controlledSeal(sponsor, `X${literal}`, true, () => {
      if (!armed) return;
      armed = false;
      // The private registry invokes the original sealedSave check, then live
      // claim checks sponsor current once and samples its separate final clock.
      f.armClockAfter(2 * count + 1, () => {
        reached = true;
        nestedAccepted = sponsor!.precommitCurrent();
      });
    });
    const before = f.clockReads();
    expect(sponsor.precommitCurrent()).toBe(true);
    count = f.clockReads() - before;
    expect(count).toBeGreaterThan(0);
    armed = true;
    await expect(sponsor.bindSealed(stage)).rejects.toThrow();
    expect(reached).toBe(true);
    expect(nestedAccepted).toBe(true);
    expect(sponsor.precommitCurrent()).toBe(false);
  } finally {
    await sponsor?.release();
    clock.mockRestore();
    await f.destroy();
  }
});

it.each(['copied', 'closed'] as const)(
  'rejects %s nominal loss lease before claim callbacks or IO',
  async (kind) => {
    const f = await fixture('normal', false, true);
    const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
    let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
    const lease = retainLiveNoteSaveLoss();
    try {
      expect(f.insert()).toBe(true);
      sponsor = f.owner.saveSponsor();
      const stage = await controlledSeal(sponsor);
      if (kind === 'closed') lease.release();
      const supplied = kind === 'copied' ? { ...lease } : lease;
      const current = vi.fn(() => true),
        before = vi.mocked(backendRequest).mock.calls.length;
      expect(() => claimLiveNoteStagedSave(stage, supplied, current, f.now)).toThrow();
      expect(current).not.toHaveBeenCalled();
      expect(vi.mocked(backendRequest).mock.calls.length).toBe(before);
    } finally {
      lease.release();
      await sponsor?.release();
      clock.mockRestore();
      await f.destroy();
    }
  },
);

/** NEW controlled transport. No historical receipt identity is attached to this issuer. */
function configurePointUpload(
  input: ReturnType<typeof createNoteLocalPointUpload>['input'],
  hook?: (method: string) => void,
) {
  const streams = ['text', 'dirty', 'selection', 'mutation', 'live'].map((stream) => ({
    stream,
    nextSequence: 0,
    lastDigest: null as string | null,
  }));
  let headerDigest = '',
    payloadDigest = '';
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  vi.mocked(backendRequest).mockImplementation(async (method, supplied) => {
    const params = supplied as Record<string, unknown>;
    calls.push({ method, params });
    hook?.(method);
    const envelope = { scope: input.scope, operationId: input.operationId };
    if (method === 'note.operation.begin') headerDigest = String(params.headerDigest);
    if (method === 'note.operation.seal') payloadDigest = String(params.payloadDigest);
    if (method === 'note.operation.append') {
      const stream = streams.find((s) => s.stream === params.stream)!;
      stream.nextSequence++;
      stream.lastDigest = String(params.chunkDigest);
      return {
        ...envelope,
        kind: 'noteStageAck',
        stream: params.stream,
        sequence: params.sequence,
        nextSequence: stream.nextSequence,
        chunkDigest: params.chunkDigest,
      };
    }
    if (['note.operation.begin', 'note.operation.seal', 'note.operation.cancel'].includes(method))
      return {
        ...envelope,
        kind: 'noteStageState',
        phase: method.endsWith('seal')
          ? 'sealed'
          : method.endsWith('cancel')
            ? 'cancelled'
            : 'staging',
        headerDigest,
        baseRevision: input.header.baseRevision,
        expiresAt: input.expiresAt,
        streams: streams.map((s) => ({ ...s })),
        ...(payloadDigest ? { payloadDigest, viewLength: 59 } : {}),
      };
    if (method === 'note.operation.commit')
      return {
        ...envelope,
        kind: 'noteCommitReceipt',
        outcome: 'committed',
        headerDigest,
        payloadDigest,
        beforeRevision: input.header.baseRevision,
        afterRevision: 'controlled-upload-after',
        sourceLength: 3,
        mappingRef: 'mapping',
        effectsRef: 'effects',
        inverseRef: 'inverse',
        viewId: 'controlled-upload-view',
        receiptExpiresAt: input.expiresAt,
        invalidation: 'all',
      };
    throw new Error('Unexpected upload RPC');
  });
  return calls;
}
async function uploadFixture() {
  const f = await fixture('normal', false, true, true);
  f.insert();
  expect(f.note().document?.history[0].kind).toBe('local-point');
  return f;
}
it('uploads the genuine local group through the fixed live path and preserves unreconciled journals', async () => {
  const f = await uploadFixture();
  const document = f.note().document,
    drafts = f.note().drafts;
  const upload = f.owner.prepareUpload();
  const calls = configurePointUpload(upload.input);
  try {
    const receipt = await upload.run();
    expect(receipt.outcome).toBe('committed');
    expect(calls.map((c) => c.method)).toEqual([
      'note.operation.begin',
      'note.operation.append',
      'note.operation.append',
      'note.operation.seal',
      'note.operation.commit',
    ]);
    expect(calls[2].params.records).toMatchObject([
      { localSequence: document!.history[0].id, start: 1, end: 1 },
    ]);
    expect(f.note().document).toBe(document);
    expect(f.note().drafts).toBe(drafts);
    expect(f.note().needsReconcile).toBe(true);
    expect(f.note().pending).toBeNull();
    expect(f.note().committedDocumentSave).toBeUndefined();
    expect(f.note().localPointSave?.phase).toBe('committed');
    f.port.dispatch(
      a.pageSessionDiscarded(upload.input.scope.workspaceId, upload.input.scope.noteId),
    );
    expect(f.note().localPointSave?.receipt).toEqual(receipt);
    await expect(upload.run()).rejects.toThrow();
    await upload.release();
    expect(f.port.read().resourceLedger.owners[f.note().localPointSave!.controlOwner]).toHaveLength(
      1,
    );
  } finally {
    await upload.release();
    await f.destroy();
  }
});
it('refuses copied local upload owners and fences native selection and domain history', async () => {
  const f = await uploadFixture();
  expect(() => createNoteLocalPointUpload({ ...f.owner })).toThrow();
  const upload = f.owner.prepareUpload();
  const state = f.editor.state;
  try {
    f.editor.commands.setTextSelection(1);
    expect(f.editor.state.selection).toBe(state.selection);
    expect(f.owner.history!('undo')).toBeUndefined();
    expect(f.owner.prepareUpload).toBeDefined();
    expect(() => f.owner.prepareUpload()).toThrow();
    upload.cancel();
    await expect(upload.run()).rejects.toThrow();
  } finally {
    await upload.release();
    await f.destroy();
  }
});
it('rejects save issuance inside a native installation callback', async () => {
  const f = await uploadFixture();
  const leave = f.owner.saveAdmission!.enter();
  try {
    expect(() => f.owner.prepareUpload()).toThrow();
  } finally {
    leave();
    await f.destroy();
  }
});
it('owns commit before synchronous transport reentry and retains one known ACK', async () => {
  const f = await uploadFixture();
  const upload = f.owner.prepareUpload();
  let nested: Promise<unknown> | undefined;
  const calls = configurePointUpload(upload.input, (method) => {
    if (method === 'note.operation.commit') nested = upload.run().catch((e) => e);
  });
  try {
    expect((await upload.run()).outcome).toBe('committed');
    expect(await nested).toBeInstanceOf(Error);
    expect(calls.filter((c) => c.method === 'note.operation.commit')).toHaveLength(1);
  } finally {
    await upload.release();
    await f.destroy();
  }
});

it('does not turn a genuine read-only observer into an upload commit arm', async () => {
  const f = await fixture('normal', false, true);
  const clock = vi.spyOn(Date, 'now').mockImplementation(f.now);
  let sponsor: ReturnType<typeof createNoteLocalPointSaveSponsor> | undefined;
  let observer: ReturnType<typeof claimLiveNoteStagedSave> | undefined;
  const loss = retainLiveNoteSaveLoss();
  try {
    f.insert();
    sponsor = f.owner.saveSponsor();
    const stage = await controlledSeal(sponsor);
    observer = claimLiveNoteStagedSave(stage, loss, () => true, f.now);
    const calls = vi.mocked(backendRequest).mock.calls.length;
    const createDispatch = await loadLiveNoteSaveDispatch();
    expect(() => createDispatch(observer)).toThrow('Unknown local point dispatch arm');
    expect(() => createDispatch({ ...observer! })).toThrow();
    expect(vi.mocked(backendRequest).mock.calls.length).toBe(calls);
  } finally {
    await observer?.release();
    loss.release();
    await sponsor?.release();
    clock.mockRestore();
    await f.destroy();
  }
});
it.each(['preparing', 'sealed', 'invoked', 'committed'] as const)(
  'preserves actual pending installation when subscriber throws at %s',
  async (phase) => {
    const f = await uploadFixture(),
      upload = f.owner.prepareUpload();
    const document = f.note().document;
    const calls = configurePointUpload(upload.input);
    let reached = false;
    const off = f.port.subscribe(() => {
      if (!reached && f.note().localPointSave?.phase === phase) {
        reached = true;
        throw new Error('controlled subscriber after install');
      }
    });
    try {
      await expect(upload.run()).rejects.toThrow('controlled subscriber after install');
      expect(reached).toBe(true);
      const commit = calls.filter((c) => c.method === 'note.operation.commit');
      expect(commit).toHaveLength(phase === 'invoked' || phase === 'committed' ? 1 : 0);
      expect(f.note().document).toBe(document);
      if (commit.length) expect(f.note().localPointSave?.phase).toBe('committed');
      else expect(f.note().localPointSave).toBeUndefined();
    } finally {
      off();
      await upload.release();
      await f.destroy();
    }
  },
);
it.each(['note.operation.begin', 'note.operation.append', 'note.operation.seal'])(
  'cancels before commit when actual %s callback revokes upload',
  async (method) => {
    const f = await uploadFixture(),
      upload = f.owner.prepareUpload();
    let reached = false;
    const calls = configurePointUpload(upload.input, (m) => {
      if (!reached && m === method) {
        reached = true;
        upload.cancel();
      }
    });
    try {
      await expect(upload.run()).rejects.toThrow();
      expect(reached).toBe(true);
      expect(calls.some((c) => c.method === 'note.operation.commit')).toBe(false);
      expect(calls.filter((c) => c.method === 'note.operation.cancel')).toHaveLength(1);
      expect(f.note().localPointSave).toBeUndefined();
    } finally {
      await upload.release();
      await f.destroy();
    }
  },
);
it.each(['note.operation.begin', 'note.operation.commit'])(
  'retains charged unknown IO and recovery record after actual %s rejects',
  async (method) => {
    const f = await uploadFixture(),
      upload = f.owner.prepareUpload();
    const calls = configurePointUpload(upload.input, (m) => {
      if (m === method) throw new Error('controlled transport unknown');
    });
    try {
      await expect(upload.run()).rejects.toThrow('controlled transport unknown');
      expect(calls.filter((c) => c.method === method)).toHaveLength(1);
      expect(f.note().localPointSave?.phase).toBe('unknown');
      const held = f.ledger().used.payloadBytes;
      await expect(upload.release()).rejects.toThrow();
      expect(f.ledger().used.payloadBytes).toBeGreaterThanOrEqual(2621440 + 65536);
      expect(f.ledger().used.payloadBytes).toBeLessThanOrEqual(held);
      await expect(upload.run()).rejects.toThrow();
    } finally {
      await upload.release().catch(() => {});
      await f.destroy();
      expect(f.ledger().used.payloadBytes).toBeGreaterThanOrEqual(2621440 + 65536);
    }
  },
);
it.each(['event-before', 'event-after', 'panel-loss', 'expiry-after-entry'] as const)(
  'keeps authenticated ACK DATA and original journals through %s',
  async (when) => {
    const f = await uploadFixture(),
      upload = f.owner.prepareUpload();
    const document = f.note().document,
      drafts = f.note().drafts;
    const event = () => {
      const n = f.note();
      f.port.dispatch(
        a.pageStateReceived(
          upload.input.scope.workspaceId,
          upload.input.scope.noteId,
          n.generation,
          { ...n.state!, stateGeneration: '2', sourceRevision: 'controlled-upload-after' },
        ),
      );
    };
    const calls = configurePointUpload(upload.input, (method) => {
      if (method !== 'note.operation.commit') return;
      if (when === 'event-before') event();
      if (when === 'panel-loss')
        f.port.dispatch(
          a.pagePanelClosed(upload.input.scope.workspaceId, upload.input.scope.noteId, 'panel'),
        );
      if (when === 'expiry-after-entry') f.setTime(Date.parse(upload.input.expiresAt) + 1);
    });
    try {
      expect((await upload.run()).outcome).toBe('committed');
      if (when === 'event-after') event();
      expect(f.note().localPointSave?.receipt).toBe(upload.outcome());
      expect(f.note().document).toBe(document);
      expect(f.note().drafts).toBe(drafts);
      expect(f.note().needsReconcile).toBe(true);
      expect(calls.filter((c) => c.method === 'note.operation.commit')).toHaveLength(1);
      if (when === 'panel-loss' || when === 'expiry-after-entry')
        await expect(upload.certificate()).rejects.toThrow();
    } finally {
      await upload.release();
      await f.destroy();
    }
  },
);
it('holds upload IO until the exact issued commit settles after cancellation', async () => {
  const f = await uploadFixture(),
    upload = f.owner.prepareUpload();
  configurePointUpload(upload.input);
  const original = vi.mocked(backendRequest).getMockImplementation()!;
  let settle!: (v: unknown) => void;
  let raw: unknown;
  vi.mocked(backendRequest).mockImplementation(async (m, p) => {
    const result = await original(m, p);
    if (m !== 'note.operation.commit') return result;
    raw = result;
    return new Promise((resolve) => {
      settle = resolve;
    });
  });
  const running = upload.run();
  await vi.waitFor(() => expect(settle).toBeTypeOf('function'));
  const held = f.ledger().used.payloadBytes;
  upload.cancel();
  const release = upload.release();
  let released = false;
  void release.then(() => {
    released = true;
  });
  await Promise.resolve();
  expect(released).toBe(false);
  expect(f.ledger().used.payloadBytes).toBe(held);
  settle(raw);
  expect((await running).outcome).toBe('committed');
  await release;
  expect(f.note().localPointSave?.phase).toBe('committed');
  await f.destroy();
});
it('recovers a pending operation through status only with no second commit', async () => {
  const f = await uploadFixture(),
    upload = f.owner.prepareUpload();
  const calls = configurePointUpload(upload.input);
  const original = vi.mocked(backendRequest).getMockImplementation()!;
  let receipt: unknown;
  vi.mocked(backendRequest).mockImplementation(async (m, p) => {
    if (m === 'note.operationStatus') return receipt;
    const result = await original(m, p);
    if (m !== 'note.operation.commit') return result;
    receipt = result;
    const r = result as Record<string, unknown>;
    return {
      kind: 'noteOperationStatus',
      outcome: 'pending',
      scope: r.scope,
      operationId: r.operationId,
      headerDigest: r.headerDigest,
      payloadDigest: r.payloadDigest,
    };
  });
  try {
    expect((await upload.run()).outcome).toBe('pending');
    expect(f.note().localPointSave?.phase).toBe('pending');
    expect((await upload.observe()).outcome).toBe('committed');
    expect(f.note().localPointSave?.phase).toBe('committed');
    expect(calls.filter((c) => c.method === 'note.operation.commit')).toHaveLength(1);
    await expect(upload.run()).rejects.toThrow();
  } finally {
    await upload.release();
    await f.destroy();
  }
});
it.each(['operationId', 'payloadDigest', 'beforeRevision', 'scope'])(
  'retains unknown debt instead of adopting foreign %s in a commit response',
  async (key) => {
    const f = await uploadFixture(),
      upload = f.owner.prepareUpload();
    configurePointUpload(upload.input);
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    vi.mocked(backendRequest).mockImplementation(async (m, p) => {
      const result = await original(m, p);
      return m === 'note.operation.commit'
        ? { ...(result as object), [key]: key === 'scope' ? {} : 'foreign' }
        : result;
    });
    try {
      await expect(upload.run()).rejects.toThrow();
      expect(upload.outcome()).toBeUndefined();
      expect(f.note().localPointSave?.phase).toBe('unknown');
      await expect(upload.release()).rejects.toThrow();
    } finally {
      await upload.release().catch(() => {});
      await f.destroy();
    }
  },
);
it('refuses the last stage-send clock after a callback cancels the uploader', async () => {
  const f = await uploadFixture(),
    upload = f.owner.prepareUpload();
  const calls = configurePointUpload(upload.input);
  let reached = false;
  const off = f.port.subscribe(() => {
    if (!reached && f.note().localPointSave?.phase === 'preparing') {
      reached = true;
      f.armClock(() => upload.cancel());
    }
  });
  try {
    await expect(upload.run()).rejects.toThrow();
    expect(reached).toBe(true);
    expect(calls.some((c) => c.method === 'note.operation.begin')).toBe(false);
    expect(calls.some((c) => c.method === 'note.operation.commit')).toBe(false);
  } finally {
    off();
    await upload.release();
    await f.destroy();
  }
});

it('replays a genuine immutable publication proof deterministically and refuses stale aliases', async () => {
  const f = await uploadFixture(),
    upload = f.owner.prepareUpload();
  configurePointUpload(upload.input);
  let reached = false;
  f.beforeDispatch((action) => {
    if (action.type !== a.pageLocalPointSavePublished.type || reached) return;
    reached = true;
    const before = f.port.read(),
      note = f.note();
    const first = a.notePagesReducer(before, action),
      second = a.notePagesReducer(before, action);
    expect(first).toEqual(second);
    const saved = note.document;
    note.document = { ...saved!, generation: saved!.generation + 1 };
    expect(a.notePagesReducer(before, action)).toEqual(before);
    note.document = saved;
    let mutable = 0;
    for (const [object, key, changed] of [
      [note.drafts[0].splices[0], 'text', 'foreign'],
      [note.drafts[0], 'sequence', 999],
      [note.document!.history[0], 'id', 999],
    ] as const) {
      const original = Reflect.get(object, key);
      if (Reflect.set(object, key, changed)) {
        mutable++;
        expect(a.notePagesReducer(before, action)).toEqual(before);
        Reflect.set(object, key, original);
      } else {
        expect(Object.getOwnPropertyDescriptor(object, key)?.writable).toBe(false);
        expect(Reflect.get(object, key)).toBe(original);
      }
    }
    expect(mutable).toBeGreaterThan(0);
    const old = note.localPointSave;
    note.localPointSave = {
      ...first.byWorkspaceId[upload.input.scope.workspaceId].notes[upload.input.scope.noteId]
        .localPointSave!,
    };
    expect(a.notePagesReducer(before, action)).toEqual(before);
    note.localPointSave = old;
    // Preserve absence as well as value in the original captured object.
    if (old === undefined) delete note.localPointSave;
    const cost =
      f.ledger().resources[
        first.byWorkspaceId[upload.input.scope.workspaceId].notes[upload.input.scope.noteId]
          .localPointSave!.controlResource
      ].cost;
    cost.payloadBytes--;
    expect(a.notePagesReducer(before, action)).toEqual(before);
    cost.payloadBytes++;
    const payload = (action as ReturnType<typeof a.pageLocalPointSavePublished>).payload;
    const forged = a.pageLocalPointSavePublished(payload[0], payload[1], { ...payload[2] });
    expect(a.notePagesReducer(before, forged)).toEqual(before);
    expect(a.notePagesReducer(first, action)).toEqual(first);
  });
  let primary: unknown;
  try {
    await upload.run();
    expect(reached).toBe(true);
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    f.beforeDispatch();
    try {
      await upload.release();
    } catch (error) {
      if (!primary) throw error;
    } finally {
      await f.destroy();
    }
  }
});
it('does not acknowledge removal when the actual note disappeared during publication', async () => {
  const f = await uploadFixture(),
    upload = f.owner.prepareUpload();
  configurePointUpload(upload.input, (m) => {
    if (m === 'note.operation.begin') upload.cancel();
  });
  const scope = upload.input.scope;
  let removed: ReturnType<typeof f.note> | undefined,
    publishes = 0;
  f.beforeDispatch((action) => {
    if (action.type === a.pageLocalPointSavePublished.type && ++publishes === 2) {
      removed = f.note();
      delete f.port.read().byWorkspaceId[scope.workspaceId].notes[scope.noteId];
    }
  });
  try {
    await expect(upload.run()).rejects.toThrow();
    expect(removed).toBeDefined();
    await expect(upload.release()).rejects.toThrow();
    expect(f.ledger().used.payloadBytes).toBeGreaterThanOrEqual(2621440 + 65536);
  } finally {
    f.beforeDispatch();
    if (removed) f.port.read().byWorkspaceId[scope.workspaceId].notes[scope.noteId] = removed;
    await upload.release().catch(() => {});
    await f.destroy();
  }
});
it('releases known provisional upload allocations when initial journal admission fails', async () => {
  const f = await uploadFixture(),
    note = f.note(),
    drafts = note.drafts,
    originalRefs = f.refs();
  note.drafts = [];
  try {
    expect(() => f.owner.prepareUpload()).toThrow();
    await vi.waitFor(() =>
      expect(
        Object.keys(f.ledger().owners).filter((k) => /^point-(upload|pending|sponsor):/.test(k)),
      ).toEqual([]),
    );
    expect(f.refs()).toBe(originalRefs);
  } finally {
    note.drafts = drafts;
    await f.destroy();
  }
});
it('serializes certificate traversal against status and retires it before held IO releases', async () => {
  const f = await uploadFixture(),
    upload = f.owner.prepareUpload();
  let stage: ReturnType<LiveNotePagesClient['createGuardedSaveOperation']> | undefined;
  const create = LiveNotePagesClient.prototype.createGuardedSaveOperation;
  const spy = vi
    .spyOn(LiveNotePagesClient.prototype, 'createGuardedSaveOperation')
    .mockImplementation(function (...args) {
      stage = create.apply(this, args);
      return stage;
    });
  configurePointUpload(upload.input);
  const original = vi.mocked(backendRequest).getMockImplementation()!;
  let controlled: Awaited<ReturnType<typeof controlledReceipt>> | undefined;
  let settle!: (value: unknown) => void, heldRaw: unknown;
  vi.mocked(backendRequest).mockImplementation(async (m, p) => {
    if (m === 'note.operation.commit') {
      controlled = await controlledReceipt(stage!, upload.input.header.localEditSequence);
      return controlled.receipt;
    }
    if (m === 'note.operation.read') {
      const raw = await controlled!.respond(m, p);
      if (!settle) {
        heldRaw = raw;
        return new Promise((resolve) => {
          settle = resolve;
        });
      }
      return raw;
    }
    return original(m, p);
  });
  try {
    await upload.run();
    const n = f.note();
    f.port.dispatch(
      a.pageStateReceived(upload.input.scope.workspaceId, upload.input.scope.noteId, n.generation, {
        ...n.state!,
        stateGeneration: '2',
        sourceRevision: controlled!.receipt.afterRevision,
      }),
    );
    const certificate = upload.certificate();
    const failed = expect(certificate).rejects.toThrow();
    await vi.waitFor(() => expect(settle).toBeTypeOf('function'));
    const count = vi.mocked(backendRequest).mock.calls.length;
    await expect(upload.observe()).rejects.toThrow();
    expect(vi.mocked(backendRequest).mock.calls.length).toBe(count);
    const held = f.ledger().used.payloadBytes;
    const release = upload.release();
    let done = false;
    void release.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    expect(f.ledger().used.payloadBytes).toBe(held);
    settle(heldRaw);
    await failed;
    await release;
    expect(f.note().localPointSave?.phase).toBe('committed');
  } finally {
    spy.mockRestore();
    await upload.release();
    await f.destroy();
  }
});

it('refuses another genuine dispatch both before and after its own observer binding', async () => {
  const first = await uploadFixture(),
    upload = first.owner.prepareUpload();
  let dispatch:
    ReturnType<Awaited<ReturnType<typeof livePages.loadLiveNoteSaveDispatch>>> | undefined;
  const load = livePages.loadLiveNoteSaveDispatch;
  const spy = vi.spyOn(livePages, 'loadLiveNoteSaveDispatch').mockImplementation(async () => {
    const create = await load();
    return (key) => {
      dispatch = create(key);
      return dispatch;
    };
  });
  configurePointUpload(upload.input);
  await upload.run();
  const second = await uploadFixture(),
    capture = takeNoteLocalPointUploadOwner(second.owner);
  const access = openPointSaveUpload(capture);
  const clock = vi.spyOn(Date, 'now').mockImplementation(second.now);
  try {
    expect(() => access.receive(dispatch!)).toThrow();
    await capture.sponsor.bindSealed(await controlledSeal(capture.sponsor));
    expect(() => access.receive(dispatch!)).toThrow('Foreign live save dispatch');
  } finally {
    clock.mockRestore();
    spy.mockRestore();
    await capture.sponsor.release();
    capture.upload.release();
    capture.control.release();
    capture.releaseFence();
    await second.destroy();
    await upload.release();
    await first.destroy();
  }
});
it('covers direct malformed journal access with acquired preparation cleanup', async () => {
  const f = await uploadFixture(),
    draft = f.note().drafts[0];
  const descriptor = Object.getOwnPropertyDescriptor(draft, 'splices')!;
  Object.defineProperty(draft, 'splices', {
    configurable: true,
    get() {
      throw new Error('controlled journal getter');
    },
  });
  try {
    expect(() => f.owner.prepareUpload()).toThrow('controlled journal getter');
    await vi.waitFor(() =>
      expect(
        Object.keys(f.ledger().owners).filter((k) => /^point-(upload|pending|sponsor):/.test(k)),
      ).toEqual([]),
    );
  } finally {
    Object.defineProperty(draft, 'splices', descriptor);
    await f.destroy();
  }
});
it('releases the independent control ticket when provisional upload release throws', async () => {
  const f = await uploadFixture(),
    n = f.note(),
    drafts = n.drafts;
  n.drafts = [];
  let reached = false;
  f.beforeDispatch((action) => {
    if (
      action.type === a.pageResourcesReleased.type &&
      String(action.payload).startsWith('point-upload:')
    ) {
      reached = true;
      throw new Error('controlled upload release failure');
    }
  });
  try {
    expect(() => f.owner.prepareUpload()).toThrow();
    await vi.waitFor(() => expect(reached).toBe(true));
    await vi.waitFor(() =>
      expect(Object.keys(f.ledger().owners).filter((k) => k.startsWith('point-pending:'))).toEqual(
        [],
      ),
    );
    expect(
      Object.keys(f.ledger().owners).filter((k) => k.startsWith('point-upload:')),
    ).toHaveLength(1);
  } finally {
    f.beforeDispatch();
    n.drafts = drafts;
    await f.destroy();
  }
});
it.each([false, true])(
  'refuses denied upload admission with one cleanup attempt per ticket (releaseThrows=%s)',
  async (releaseThrows) => {
    const f = await uploadFixture();
    // Leave exactly one byte less than both provisional reservations require.
    const remaining = 2621440 + 65536 - 1;
    const cost = {
      payloadBytes: f.ledger().limit.payloadBytes - f.ledger().used.payloadBytes - remaining,
      stringUnits: 0,
      objectNodes: 0,
      domNodes: 0,
      physicalReads: 0,
      assemblies: 0,
    };
    f.port.dispatch(
      a.pageResourcesRequested('upload-budget-block', [{ id: 'upload-budget-block', cost }]),
    );
    expect(f.ledger().limit.payloadBytes - f.ledger().used.payloadBytes).toBe(remaining);
    const before = vi.mocked(backendRequest).mock.calls.length;
    const releases = new Map<string, number>();
    f.beforeDispatch((action) => {
      if (
        action.type !== a.pageResourcesReleased.type ||
        !/^point-(upload|pending):/.test(String(action.payload))
      )
        return;
      const id = String(action.payload);
      releases.set(id, (releases.get(id) ?? 0) + 1);
      if (releaseThrows && id.startsWith('point-upload:'))
        throw new Error('controlled denied release');
    });
    try {
      expect(() => f.owner.prepareUpload()).toThrow();
      expect(vi.mocked(backendRequest).mock.calls.length).toBe(before);
      expect(releases.size).toBe(2);
      expect([...releases.values()]).toEqual([1, 1]);
      expect(Object.keys(f.ledger().owners).filter((k) => k.startsWith('point-pending:'))).toEqual(
        [],
      );
      expect(
        Object.keys(f.ledger().owners).filter((k) => k.startsWith('point-upload:')),
      ).toHaveLength(releaseThrows ? 1 : 0);
      if (releaseThrows) expect(f.owner.saveAdmission.mutable()).toBe(false);
      expect(() => f.owner.prepareUpload()).toThrow();
      expect([...releases.values()]).toEqual([1, 1]);
    } finally {
      f.beforeDispatch();
      f.port.dispatch(a.pageResourcesReleased('upload-budget-block'));
      await f.destroy();
    }
  },
);
it.each([
  'root-array',
  'flat-object',
  'nested-array',
  'nested-object',
  'sparse-array',
  'escaped-string',
])('bounds rejected %s commit copies before exceeding prepaid control nodes', async (shape) => {
  const f = await uploadFixture(),
    upload = f.owner.prepareUpload();
  configurePointUpload(upload.input);
  const original = vi.mocked(backendRequest).getMockImplementation()!;
  // This wire-small invalid response formerly copied >1024 empty objects before decoding.
  const array = Array.from({ length: 1100 }, () => ({}));
  const flat = Object.fromEntries(array.map((_, i) => [`k${i}`, null]));
  let getters = 0;
  Object.defineProperty(flat, 'trap', {
    enumerable: true,
    get() {
      getters++;
      throw new Error('must not invoke');
    },
  });
  const sparse = new Array(500);
  sparse[499] = 'X'.repeat(2000);
  const raw =
    shape === 'root-array'
      ? array
      : shape === 'flat-object'
        ? flat
        : {
            extra:
              shape === 'nested-array'
                ? array
                : shape === 'sparse-array'
                  ? sparse
                  : shape === 'escaped-string'
                    ? '\u0000'.repeat(1024)
                    : flat,
          };
  let serializedCandidate = 0;
  let restoreSerialization = () => {};
  vi.mocked(backendRequest).mockImplementation(async (m, p) => {
    if (m !== 'note.operation.commit') return original(m, p);
    // Install at the actual controlled response, after stage hashing. A late
    // bytes check would serialize the copied candidate before refusing it.
    const stringify = JSON.stringify;
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
      if (value && typeof value === 'object' && Object.hasOwn(value, 'extra'))
        serializedCandidate++;
      return stringify(value, replacer, space);
    });
    restoreSerialization = () => spy.mockRestore();
    return raw;
  });
  try {
    await expect(upload.run()).rejects.toThrow('Save data');
    expect(getters).toBe(0);
    expect(serializedCandidate).toBe(0);
    expect(upload.outcome()).toBeUndefined();
    expect(f.note().localPointSave?.phase).toBe('unknown');
    expect(
      Object.keys(f.ledger().owners).filter((k) => k.startsWith('point-pending:')),
    ).toHaveLength(1);
    await expect(upload.release()).rejects.toThrow();
  } finally {
    restoreSerialization();
    await upload.release().catch(() => {});
    await f.destroy();
  }
});
it('refuses certificate during an owned held status and preserves completion through retirement', async () => {
  const f = await uploadFixture(),
    upload = f.owner.prepareUpload();
  configurePointUpload(upload.input);
  const receipt = await upload.run();
  if (receipt.kind !== 'noteCommitReceipt') throw new Error('Missing committed control');
  const n = f.note();
  f.port.dispatch(
    a.pageStateReceived(upload.input.scope.workspaceId, upload.input.scope.noteId, n.generation, {
      ...n.state!,
      stateGeneration: '2',
      sourceRevision: receipt.afterRevision,
    }),
  );
  let settle!: (value: unknown) => void;
  vi.mocked(backendRequest).mockImplementation((m) => {
    if (m !== 'note.operationStatus') throw new Error('Unexpected concurrent receipt request');
    return new Promise((resolve) => {
      settle = resolve;
    });
  });
  const status = upload.observe();
  expect(settle).toBeTypeOf('function');
  await expect(upload.certificate()).rejects.toThrow('Certificate unavailable');
  const count = vi.mocked(backendRequest).mock.calls.length;
  await expect(upload.observe()).rejects.toThrow();
  expect(vi.mocked(backendRequest).mock.calls.length).toBe(count);
  const release = upload.release();
  let released = false;
  void release.then(() => {
    released = true;
  });
  await Promise.resolve();
  expect(released).toBe(false);
  settle(receipt);
  expect((await status).outcome).toBe('committed');
  await release;
  expect(f.note().localPointSave?.receipt).toEqual(receipt);
  await f.destroy();
});

it.each(['cancel', 'panel-loss', 'loader-rejection'])(
  'owns lazy factory loading through %s before any publication or RPC',
  async (mode) => {
    const f = await uploadFixture(),
      upload = f.owner.prepareUpload();
    const realLoad = livePages.loadLiveNoteSaveDispatch;
    let settle!: (value: Awaited<ReturnType<typeof realLoad>>) => void;
    const load = vi.spyOn(livePages, 'loadLiveNoteSaveDispatch').mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const publication =
      mode === 'loader-rejection'
        ? vi
            .spyOn(pointPublication, 'loadLocalPointSavePublication')
            .mockRejectedValue(new Error('controlled loader failure'))
        : undefined;
    const before = vi.mocked(backendRequest).mock.calls.length;
    const held = f.ledger().used.payloadBytes;
    const running = upload.run();
    const outcome = running.catch((error) => error);
    expect(settle).toBeTypeOf('function');
    await expect(upload.run()).rejects.toThrow('consumed');
    if (mode === 'panel-loss')
      f.port.dispatch(
        a.pagePanelClosed(upload.input.scope.workspaceId, upload.input.scope.noteId, 'panel'),
      );
    else if (mode === 'cancel') upload.cancel();
    const releasing = upload.release();
    let released = false;
    void releasing.then(() => {
      released = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(released).toBe(false);
    expect(f.ledger().used.payloadBytes).toBe(held);
    expect(f.note().localPointSave).toBeUndefined();
    expect(vi.mocked(backendRequest).mock.calls.length).toBe(before);
    settle(await realLoad());
    expect(await outcome).toBeInstanceOf(Error);
    await releasing;
    expect(vi.mocked(backendRequest).mock.calls.length).toBe(before);
    expect(f.note().localPointSave).toBeUndefined();
    load.mockRestore();
    publication?.mockRestore();
    await f.destroy();
  },
);
