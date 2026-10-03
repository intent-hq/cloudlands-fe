import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type {
  NotePageState,
  NotePageRequest,
  NoteReadPage,
  NoteSaveOutcome,
  NoteSpliceOperation,
  SourceRange,
} from '$lib/client/note-pages';
import { sameNoteScope } from '$lib/client/note-pages';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import type {
  NoteDraft,
  NotePageSession,
  NotePagesState,
  NotePagesWorkspaceState,
} from './note-pages-types';
const emptyWorkspace: NotePagesWorkspaceState = { notes: {} };
const { getWorkspaceState, setWorkspaceState } = createWorkspaceScopedHelpers(emptyWorkspace);
export const initialNotePagesState: NotePagesState = {
  byWorkspaceId: {},
  nextGeneration: 0,
  physicalReads: {},
};
const newSession = (): NotePageSession => ({
  panels: {},
  generation: 0,
  state: null,
  status: 'connecting',
  error: null,
  pages: {},
  pageOrder: [],
  requests: {},
  deferredRead: null,
  drafts: [],
  history: [],
  receipts: [],
  pending: null,
  needsReconcile: false,
  readRecoveryAttempted: false,
});
export const pagePanelOpened =
  createAction<[workspaceId: string, noteId: string, panelId: string]>('notePages/panelOpened');
export const pagePanelClosed =
  createAction<[workspaceId: string, noteId: string, panelId: string]>('notePages/panelClosed');
export const pageVisibleRangesChanged = createAction<
  [workspaceId: string, noteId: string, panelId: string, ranges: SourceRange[]]
>('notePages/visibleRangesChanged');
export const pageStateReceived =
  createAction<[workspaceId: string, noteId: string, generation: number, state: NotePageState]>(
    'notePages/stateReceived',
  );
export const pageRefreshRequested = createAction<
  [workspaceId: string, noteId: string, automatic?: boolean]
>('notePages/refreshRequested');
export const pageReset =
  createAction<[workspaceId: string, noteId: string, error?: string]>('notePages/reset');
export const pageLegacySelected = createAction<[workspaceId: string, noteId: string]>(
  'notePages/legacySelected',
);
export const pageRequested =
  createAction<[workspaceId: string, noteId: string, request: NotePageRequest]>(
    'notePages/requested',
  );
export const pageRequestStarted = createAction<
  [workspaceId: string, noteId: string, generation: number, key: string]
>('notePages/requestStarted');
export const physicalReadKey = (ws: string, id: string, generation: number, key: string) =>
  JSON.stringify([ws, id, generation, key]);
export const pageReadSettled =
  createAction<[workspaceId: string, noteId: string, generation: number, key: string]>(
    'notePages/readSettled',
  );
export const pageReadDeferred =
  createAction<[workspaceId: string, noteId: string, generation: number, request: NotePageRequest]>(
    'notePages/readDeferred',
  );
export const sourcePageReceived = createAction<
  [workspaceId: string, noteId: string, generation: number, key: string, page: NoteReadPage]
>('notePages/sourceReceived');
export const pageRequestFailed =
  createAction<
    [workspaceId: string, noteId: string, generation: number, key: string, error: string]
  >('notePages/requestFailed');
export const pageDraftChanged =
  createAction<[workspaceId: string, noteId: string, draft: NoteDraft]>('notePages/draftChanged');
export const pageSaveRequested =
  createAction<
    [workspaceId: string, noteId: string, operation: NoteSpliceOperation, throughSequence: number]
  >('notePages/saveRequested');
export const pageSaveStarted =
  createAction<
    [workspaceId: string, noteId: string, operation: NoteSpliceOperation, throughSequence: number]
  >('notePages/saveStarted');
export const pageSaveSettled =
  createAction<[workspaceId: string, noteId: string, outcome: NoteSaveOutcome]>(
    'notePages/saveSettled',
  );
export const pageSaveUnknown =
  createAction<[workspaceId: string, noteId: string, operationId: string]>('notePages/saveUnknown');
export const pageSaveRetryRequested = createAction<[workspaceId: string, noteId: string]>(
  'notePages/saveRetryRequested',
);
export const pageSessionDiscarded = createAction<[workspaceId: string, noteId: string]>(
  'notePages/sessionDiscarded',
);
export const pageMappingAccepted = createAction<
  [workspaceId: string, noteId: string, operationId: string, drafts: NoteDraft[]]
>('notePages/mappingAccepted');
export const notePagesReducer = createReducer<NotePagesState>(initialNotePagesState);
function update(
  state: NotePagesState,
  ws: string,
  note: string,
  fn: (n: NotePageSession) => NotePageSession,
): NotePagesState {
  const w = getWorkspaceState(state, ws);
  const n = w.notes[note];
  if (!n) return state;
  let next = fn(n);
  let owner = state;
  if (next.generation !== n.generation) {
    next = { ...next, generation: state.nextGeneration };
    owner = { ...state, nextGeneration: state.nextGeneration + 1 };
  }
  return setWorkspaceState(owner, ws, { ...w, notes: { ...w.notes, [note]: next } });
}
function invalidate(n: NotePageSession): NotePageSession {
  return {
    ...n,
    generation: n.generation + 1,
    pages: {},
    pageOrder: [],
    requests: {},
    deferredRead: null,
    needsReconcile: n.needsReconcile,
  };
}
const sameTuple = (a: NotePageState, b: NotePageState) =>
  a.sourceRevision === b.sourceRevision &&
  a.attributionGeneration === b.attributionGeneration &&
  a.attributionState === b.attributionState &&
  a.commentRevision === b.commentRevision &&
  a.deleted === b.deleted;
notePagesReducer.with(pagePanelOpened, (s, { payload: [ws, id, panel] }) => {
  const w = getWorkspaceState(s, ws);
  const existing = w.notes[id];
  const n = existing ?? { ...newSession(), generation: s.nextGeneration };
  return setWorkspaceState(existing ? s : { ...s, nextGeneration: s.nextGeneration + 1 }, ws, {
    ...w,
    notes: { ...w.notes, [id]: { ...n, panels: { ...n.panels, [panel]: [] } } },
  });
});
notePagesReducer.with(pagePanelClosed, (s, { payload: [ws, id, panel] }) =>
  update(s, ws, id, (n) => {
    const panels = { ...n.panels };
    delete panels[panel];
    return Object.keys(panels).length ? { ...n, panels } : { ...invalidate(n), panels };
  }),
);
notePagesReducer.with(pageVisibleRangesChanged, (s, { payload: [ws, id, panel, ranges] }) =>
  update(s, ws, id, (n) =>
    panel in n.panels ? { ...n, panels: { ...n.panels, [panel]: ranges.slice(0, 32) } } : n,
  ),
);
notePagesReducer.with(pageRefreshRequested, (s, { payload: [ws, id, automatic] }) =>
  update(s, ws, id, (n) => ({ ...n, readRecoveryAttempted: automatic === true })),
);
notePagesReducer.with(pageReset, (s, { payload: [ws, id, error] }) =>
  update(s, ws, id, (n) => ({
    ...invalidate(n),
    status: error ? 'error' : 'connecting',
    error: error ?? null,
  })),
);
notePagesReducer.with(pageLegacySelected, (s, { payload: [ws, id] }) =>
  update(s, ws, id, (n) => {
    const retained = n.drafts.length || n.history.length || n.pending || n.receipts.length;
    return {
      ...invalidate(n),
      status: retained ? 'error' : 'legacy',
      error: retained ? 'Note paging support lost; retained edits require recovery' : null,
    };
  }),
);
notePagesReducer.with(pageStateReceived, (s, { payload: [ws, id, generation, state] }) =>
  update(s, ws, id, (n) => {
    if (generation !== n.generation || state.scope.workspaceId !== ws || state.scope.noteId !== id)
      return n;
    if (n.state) {
      if (!sameNoteScope(n.state.scope, state.scope)) {
        if (!n.drafts.length && !n.history.length && !n.pending && !n.receipts.length)
          return {
            ...invalidate(n),
            state,
            status: state.deleted ? 'deleted' : 'ready',
            error: null,
          };
        return {
          ...invalidate(n),
          status: 'error',
          error: 'Note incarnation changed; retained drafts require recovery',
          needsReconcile: true,
        };
      }
      const incoming = BigInt(state.stateGeneration),
        current = BigInt(n.state.stateGeneration);
      if (incoming < current) return n;
      if (incoming === current) {
        if (!sameTuple(state, n.state))
          return { ...invalidate(n), status: 'error', error: 'Conflicting note state generation' };
        return { ...n, status: state.deleted ? 'deleted' : 'ready', error: null };
      }
    }
    const changed = n.state !== null && !sameTuple(n.state, state);
    return {
      ...(changed ? invalidate(n) : n),
      needsReconcile:
        n.needsReconcile ||
        (n.drafts.length > 0 &&
          n.state !== null &&
          n.state.sourceRevision !== state.sourceRevision),
      state,
      status: state.deleted ? 'deleted' : 'ready',
      error: null,
    };
  }),
);
notePagesReducer.with(pageReadDeferred, (s, { payload: [ws, id, generation, request] }) =>
  update(s, ws, id, (n) => (generation === n.generation ? { ...n, deferredRead: request } : n)),
);
notePagesReducer.with(pageReadSettled, (s, { payload: [ws, id, generation, key] }) => {
  const physicalReads = { ...s.physicalReads };
  delete physicalReads[physicalReadKey(ws, id, generation, key)];
  return { ...s, physicalReads };
});
notePagesReducer.with(pageRequestStarted, (s, { payload: [ws, id, generation, key] }) => {
  const updated = update(s, ws, id, (n) =>
    generation === n.generation
      ? { ...n, requests: { ...n.requests, [key]: true }, deferredRead: null }
      : n,
  );
  return {
    ...updated,
    physicalReads: {
      ...updated.physicalReads,
      [physicalReadKey(ws, id, generation, key)]: { workspaceId: ws, noteId: id },
    },
  };
});
notePagesReducer.with(sourcePageReceived, (s, { payload: [ws, id, generation, key, page] }) =>
  update(s, ws, id, (n) => {
    if (
      generation !== n.generation ||
      !n.requests[key] ||
      (n.status !== 'ready' &&
        page.kind !== 'noteMappingPage' &&
        page.kind !== 'noteEffectsPage') ||
      !n.state ||
      !sameNoteScope(n.state.scope, page.scope)
    )
      return n;
    const requests = { ...n.requests };
    delete requests[key];
    if (
      'operationId' in page &&
      !n.receipts.some(
        (r) =>
          r.operationId === page.operationId &&
          sameNoteScope(r.scope, page.scope) &&
          r.beforeRevision === page.beforeRevision &&
          r.afterRevision === page.afterRevision,
      )
    )
      return { ...n, requests, error: 'Unmatched note receipt page' };
    if ('sourceRevision' in page && page.sourceRevision !== n.state.sourceRevision)
      return { ...n, requests };
    // One live snapshot per session: a new snapshot can be admitted only after reset.
    const live = Object.values(n.pages).find((p) => 'snapshotId' in p);
    if ('snapshotId' in page && live && 'snapshotId' in live && live.snapshotId !== page.snapshotId)
      return { ...n, requests, error: 'Note snapshot changed; refresh required' };
    const pages = { ...n.pages, [key]: page },
      pageOrder = [...n.pageOrder.filter((k) => k !== key), key];
    while (pageOrder.length > 4) {
      const oldest = pageOrder.shift();
      if (oldest !== undefined) delete pages[oldest];
    }
    return { ...n, pages, pageOrder, requests, error: null, readRecoveryAttempted: false };
  }),
);
notePagesReducer.with(pageRequestFailed, (s, { payload: [ws, id, generation, key, error] }) =>
  update(s, ws, id, (n) => {
    if (generation !== n.generation) return n;
    const requests = { ...n.requests };
    delete requests[key];
    return { ...n, requests, error };
  }),
);
notePagesReducer.with(pageDraftChanged, (s, { payload: [ws, id, draft] }) =>
  update(s, ws, id, (n) => {
    if (!n.state || !sameNoteScope(draft.scope, n.state.scope)) return n;
    if (n.history.length && draft.sequence <= n.history[n.history.length - 1].sequence) return n;
    return { ...n, drafts: [...n.drafts, draft], history: [...n.history, draft] };
  }),
);
notePagesReducer.with(pageSaveStarted, (s, { payload: [ws, id, operation, throughSequence] }) =>
  update(s, ws, id, (n) => {
    if (
      n.pending ||
      n.status !== 'ready' ||
      n.needsReconcile ||
      !n.state ||
      !sameNoteScope(operation.scope, n.state.scope) ||
      operation.baseRevision !== n.state.sourceRevision
    )
      return n;
    return { ...n, pending: { operation, throughSequence, status: 'saving' } };
  }),
);
notePagesReducer.with(pageSaveUnknown, (s, { payload: [ws, id, operationId] }) =>
  update(s, ws, id, (n) =>
    n.pending?.operation.operationId === operationId
      ? { ...n, pending: { ...n.pending, status: 'unknown' } }
      : n,
  ),
);
notePagesReducer.with(pageSaveSettled, (s, { payload: [ws, id, outcome] }) =>
  update(s, ws, id, (n) => {
    const pending = n.pending;
    if (
      !pending ||
      !sameNoteScope(pending.operation.scope, outcome.scope) ||
      pending.operation.operationId !== outcome.operationId ||
      pending.operation.payloadDigest !== outcome.payloadDigest
    )
      return n;
    if (outcome.outcome !== 'committed')
      return { ...n, pending: { ...pending, status: outcome.outcome } };
    if (outcome.beforeRevision !== pending.operation.baseRevision) return n;
    // Receipts never regress the live tuple: an event may already describe a newer revision.
    return {
      ...invalidate(n),
      pending: null,
      drafts: n.drafts.filter((d) => d.sequence > pending.throughSequence),
      receipts: [...n.receipts, outcome],
      needsReconcile: true,
    };
  }),
);
notePagesReducer.with(pageMappingAccepted, (s, { payload: [ws, id, operationId, drafts] }) =>
  update(s, ws, id, (n) => {
    const receipt = n.receipts.find((r) => r.operationId === operationId);
    if (
      !receipt ||
      n.state?.sourceRevision !== receipt.afterRevision ||
      drafts.length !== n.drafts.length ||
      drafts.some(
        (d, i) =>
          d.sequence !== n.drafts[i].sequence ||
          d.baseRevision !== receipt.afterRevision ||
          !sameNoteScope(d.scope, receipt.scope),
      )
    )
      return n;
    return { ...n, drafts, needsReconcile: false };
  }),
);
notePagesReducer.with(pageSessionDiscarded, (s, { payload: [ws, id] }) => {
  const w = getWorkspaceState(s, ws);
  const notes = { ...w.notes };
  delete notes[id];
  return setWorkspaceState(s, ws, { ...w, notes });
});
notePagesReducer.with(workspaceUnmounted, (s, { payload: [ws] }) => {
  const w = getWorkspaceState(s, ws);
  const notes: Record<string, NotePageSession> = {};
  let nextGeneration = s.nextGeneration;
  for (const [id, n] of Object.entries(w.notes)) {
    if (n.drafts.length || n.history.length || n.pending)
      notes[id] = { ...invalidate(n), generation: nextGeneration++, panels: {} };
  }
  return setWorkspaceState({ ...s, nextGeneration }, ws, { ...w, notes });
});
