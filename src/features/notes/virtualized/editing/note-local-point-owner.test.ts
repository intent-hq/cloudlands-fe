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
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';
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

const pointId = '00000000-0000-4000-8000-000000000001';
const literal = `<!--anchor:${pointId}:point-->`;
async function fixture(mode: 'normal' | 'filter' | 'append' = 'normal', underBudget = false) {
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
  const channel = stdChannel(),
    listeners = new Set<() => void>();
  let storeReads = 0;
  const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
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
        : 100_000_000,
      stringUnits: 100_000_000,
      objectNodes: 100_000_000,
      domNodes: 10000,
      physicalReads: 16,
      assemblies: 16,
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
  const port = {
    read: () => pages,
    dispatch,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
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
        return pages.resourceLedger;
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
  });
  const owner = active;
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
