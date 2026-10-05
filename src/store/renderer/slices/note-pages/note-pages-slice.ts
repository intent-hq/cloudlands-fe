import type { NoteAssemblyLease } from '$features/notes/virtualized/note-assembly-reservation';
import {
  createNoteDocumentSession,
  type NoteDocumentSession,
} from '$features/notes/virtualized/editing/note-document-edit-session';
import { prepareNoteDocumentPublication } from './note-document-publication';
import type { NoteWindow } from '$features/notes/virtualized/note-window-reader';
import {
  createNoteResourceLedger,
  requestNoteResources,
  releaseNoteResources,
  transferNoteResources,
  settleNoteResource,
  retainNoteResourcesFrom,
  type NoteResourceCost,
  type NoteResourceReservation,
} from '$features/notes/virtualized/note-resource-ledger';
import { measureNotePageCost } from '$features/notes/virtualized/note-page-cost';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  addItem,
  createCollection,
  getItem,
  getItems,
  removeItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type {
  NotePageState,
  NotePageRequest,
  NoteReadPage,
  NoteSaveOutcome,
  NoteSpliceOperation,
  NoteSplice,
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
  // The prepared surface requires an explicit admission policy before ownership.
  // Zero defaults never turn an absent reservation policy into unlimited credit.
  resourceLedger: createNoteResourceLedger({
    payloadBytes: 0,
    stringUnits: 0,
    objectNodes: 0,
    domNodes: 0,
    physicalReads: 0,
    assemblies: 0,
  }),
  byWorkspaceId: {},
  cleanPages: createCollection('owner'),
  nextGeneration: 0,
  physicalReads: {},
};
const newSession = (): NotePageSession => ({
  panels: {},
  windows: {},
  generation: 0,
  state: null,
  status: 'connecting',
  error: null,
  pages: {},
  pageAllocations: {},
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
export const pageResourceLimitsConfigured = createAction<[limit: NoteResourceCost]>(
  'notePages/resourceLimitsConfigured',
);
export const pageResourcesRequested = createAction<
  [owner: string, resources: NoteResourceReservation[], ownerSlots?: number]
>('notePages/resourcesRequested');
export const pageResourcesReleased = createAction<[owner: string]>('notePages/resourcesReleased');
export const pageCachedRetained = createAction<
  [
    workspaceId: string,
    noteId: string,
    generation: number,
    key: string,
    owner: string,
    page: NoteReadPage,
  ]
>('notePages/cachedRetained');
export const pageResourcesTransferred = createAction<[from: string, to: string]>(
  'notePages/resourcesTransferred',
);
export const pagePanelClosed =
  createAction<[workspaceId: string, noteId: string, panelId: string]>('notePages/panelClosed');
export const pageWindowRequested = createAction<
  [workspaceId: string, noteId: string, panelId: string, at: number]
>('notePages/windowRequested');
export const pageWindowRetained = createAction<
  [
    workspaceId: string,
    noteId: string,
    panelId: string,
    generation: number,
    value: NoteWindow,
    owner: string,
  ]
>('notePages/windowRetained');
export const pageWindowAssemblyStarted = createAction<
  [workspaceId: string, noteId: string, panelId: string, generation: number, request: number]
>('notePages/windowAssemblyStarted');
export const pageWindowSettled =
  createAction<
    [
      workspaceId: string,
      noteId: string,
      panelId: string,
      generation: number,
      request: number,
      value: NoteWindow | null,
      error: string | null,
      allocation?: { sponsor: string; resource: string; owner: string },
    ]
  >('notePages/windowSettled');
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
  createAction<
    [workspaceId: string, noteId: string, request: NotePageRequest, assembly?: NoteAssemblyLease]
  >('notePages/requested');
export const pageRequestStarted = createAction<
  [
    workspaceId: string,
    noteId: string,
    generation: number,
    key: string,
    ticket?: string,
    wireBytes?: number,
    assembly?: NoteAssemblyLease,
  ]
>('notePages/requestStarted');
const physicalReadKey = (ws: string, id: string, generation: number, key: string) =>
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
export const pageDocumentSelectionChanged = createAction<
  [
    workspaceId: string,
    noteId: string,
    generation: number,
    before: NoteDocumentSession,
    selection: NoteDocumentSession['selection'],
  ]
>('notePages/documentSelectionChanged');
export const pageDocumentPublished = createAction<
  [
    workspaceId: string,
    noteId: string,
    generation: number,
    before: NoteDocumentSession,
    after: NoteDocumentSession,
    splices: NoteSplice[],
  ]
>('notePages/documentPublished');
export const pageSaveDraftsRequested = createAction<[workspaceId: string, noteId: string]>(
  'notePages/saveDraftsRequested',
);
export const pageSavePreparationFailed = createAction<
  [workspaceId: string, noteId: string, generation: number, error: string]
>('notePages/savePreparationFailed');
export const pageDraftsUnchanged = createAction<
  [
    workspaceId: string,
    noteId: string,
    generation: number,
    baseRevision: string,
    throughSequence: number,
  ]
>('notePages/draftsUnchanged');
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
notePagesReducer.with(pageResourceLimitsConfigured, (state, { payload: [limit] }) => {
  if (Object.keys(state.resourceLedger.owners).length || state.resourceLedger.pending.length)
    return state;
  return { ...state, resourceLedger: createNoteResourceLedger(limit) };
});
notePagesReducer.with(
  pageResourcesRequested,
  (state, { payload: [owner, resources, ownerSlots] }) =>
    reclaimCleanPages({
      ...state,
      resourceLedger: requestNoteResources(state.resourceLedger, owner, resources, ownerSlots)
        .ledger,
    }),
);
notePagesReducer.with(pageResourcesReleased, (state, { payload: [owner] }) =>
  reclaimCleanPages({
    ...state,
    resourceLedger: releaseNoteResources(state.resourceLedger, owner),
  }),
);
notePagesReducer.with(pageResourcesTransferred, (state, { payload: [from, to] }) => ({
  ...state,
  resourceLedger: transferNoteResources(state.resourceLedger, from, to),
}));
notePagesReducer.with(
  pageCachedRetained,
  (state, { payload: [ws, id, generation, key, owner, page] }) => {
    const note = getWorkspaceState(state, ws).notes[id];
    if (!note || note.generation !== generation || note.pages[key] !== page) return state;
    const allocation = note.pageAllocations[key];
    const resource = allocation && state.resourceLedger.resources[allocation.resource];
    if (!resource) return state;
    return {
      ...state,
      resourceLedger: requestNoteResources(state.resourceLedger, owner, [
        { id: allocation.resource, cost: resource.cost },
      ]).ledger,
    };
  },
);
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
  for (const [key, allocation] of Object.entries(n.pageAllocations)) {
    if (next.pages[key] === n.pages[key]) continue;
    const pageAllocations = { ...next.pageAllocations };
    delete pageAllocations[key];
    next = { ...next, pageAllocations };
    owner = {
      ...owner,
      resourceLedger: releaseNoteResources(owner.resourceLedger, allocation.owner),
      cleanPages: removeItem(owner.cleanPages, allocation.owner),
    };
  }
  for (const [panel, window] of Object.entries(n.windows)) {
    if (!window.resourceOwner || next.windows[panel]?.resourceOwner === window.resourceOwner)
      continue;
    owner = {
      ...owner,
      resourceLedger: releaseNoteResources(owner.resourceLedger, window.resourceOwner),
    };
  }
  return setWorkspaceState(owner, ws, { ...w, notes: { ...w.notes, [note]: next } });
}
/** Reclaim only cache leases, never physical/assembly/runtime owners. The bounded
 * index avoids scanning all workspace notes for an ordinary read admission. */
function reclaimCleanPages(initial: NotePagesState): NotePagesState {
  let state = initial;
  while (state.resourceLedger.pending.length && state.cleanPages.ids.length) {
    const next = state.resourceLedger.pending[0];
    const physical = next.resources.reduce(
      (sum, resource) =>
        sum + (state.resourceLedger.resources[resource.id] ? 0 : resource.cost.physicalReads),
      0,
    );
    // A cache eviction cannot finish an outstanding physical promise.
    if (
      state.resourceLedger.used.physicalReads + physical >
      state.resourceLedger.limit.physicalReads
    )
      break;
    const oldest = getItem(state.cleanPages, state.cleanPages.ids[0]);
    if (!oldest) throw new Error('Invalid clean note cache index');
    state = update(state, oldest.workspaceId, oldest.noteId, (note) => {
      if (note.pageAllocations[oldest.key]?.owner !== oldest.owner) return note;
      const pages = { ...note.pages };
      delete pages[oldest.key];
      return { ...note, pages, pageOrder: note.pageOrder.filter((key) => key !== oldest.key) };
    });
    state = { ...state, cleanPages: removeItem(state.cleanPages, oldest.owner) };
  }
  return state;
}
function hasRetainedDocumentWork(n: NotePageSession): boolean {
  return !!(
    n.drafts.length ||
    n.history.length ||
    n.pending ||
    n.receipts.length ||
    n.document?.history.length ||
    n.document?.dirty.length ||
    n.document?.replay.length ||
    (n.document && n.document.length !== n.document.baseLength)
  );
}
function invalidate(n: NotePageSession): NotePageSession {
  return {
    ...n,
    generation: n.generation + 1,
    windows: Object.fromEntries(
      Object.entries(n.windows).map(([id, w]) => [
        id,
        { ...w, value: null, resourceOwner: undefined, loading: false },
      ]),
    ),
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
    const windows = { ...n.windows };
    delete windows[panel];
    return Object.keys(panels).length
      ? { ...n, panels, windows }
      : { ...invalidate(n), panels, windows };
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
    const retained = hasRetainedDocumentWork(n);
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
        if (!hasRetainedDocumentWork(n))
          return {
            ...invalidate(n),
            document: undefined,
            needsReconcile: false,
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
    const sourceChanged = n.state !== null && n.state.sourceRevision !== state.sourceRevision;
    const retained = hasRetainedDocumentWork(n);
    return {
      ...(changed ? invalidate(n) : n),
      document: sourceChanged && !retained ? undefined : n.document,
      needsReconcile: sourceChanged ? retained : n.needsReconcile,
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
  const owner = physicalReads[physicalReadKey(ws, id, generation, key)]?.resourceOwner;
  delete physicalReads[physicalReadKey(ws, id, generation, key)];
  return reclaimCleanPages({
    ...s,
    physicalReads,
    resourceLedger: owner ? releaseNoteResources(s.resourceLedger, owner) : s.resourceLedger,
  });
});
notePagesReducer.with(
  pageRequestStarted,
  (s, { payload: [ws, id, generation, key, ticket, wireBytes, assembly] }) => {
    if (ticket) {
      const n = getWorkspaceState(s, ws).notes[id];
      if (
        !n ||
        n.generation !== generation ||
        !Object.keys(n.panels).length ||
        n.requests[key] ||
        (!assembly &&
          Object.values(s.physicalReads).filter((r) => r.workspaceId === ws && r.noteId === id)
            .length >= 4)
      )
        return s;
    }
    const resourceOwner = ticket && wireBytes !== undefined ? `read:${ticket}` : undefined;
    if (resourceOwner && assembly) {
      if (
        !wireBytes ||
        !Object.hasOwn(s.resourceLedger.owners, assembly.owner) ||
        Object.values(s.physicalReads).some((read) => read.assembly?.owner === assembly.owner)
      )
        return s;
      s = {
        ...s,
        resourceLedger: retainNoteResourcesFrom(s.resourceLedger, assembly.owner, resourceOwner, [
          assembly.data,
          assembly.control,
        ]),
      };
    } else if (resourceOwner && wireBytes !== undefined) {
      if (!Number.isSafeInteger(wireBytes) || wireBytes < 4096 || wireBytes > 65536) return s;
      const admission = requestNoteResources(s.resourceLedger, resourceOwner, [
        {
          id: `frame:${ticket}`,
          cost: {
            // Separate logical representations: received JSON, decoded strings, and
            // validator JSON text. This is a worst-case length allowance, not heap.
            payloadBytes: wireBytes,
            stringUnits: wireBytes * 3,
            objectNodes: wireBytes,
            domNodes: 0,
            physicalReads: 0,
            assemblies: 0,
          },
        },
        {
          id: `slot:${ticket}`,
          cost: {
            payloadBytes: 0,
            stringUnits: 0,
            objectNodes: 0,
            domNodes: 0,
            physicalReads: 1,
            assemblies: 0,
          },
        },
      ]);
      if (admission.status === 'impossible' || admission.status === 'capacity')
        return update(s, ws, id, (n) => ({
          ...n,
          error: 'Note read admission budget unavailable',
        }));
      s = reclaimCleanPages({ ...s, resourceLedger: admission.ledger });
    }
    const updated = update(s, ws, id, (n) =>
      generation === n.generation
        ? { ...n, requests: { ...n.requests, [key]: true }, deferredRead: null }
        : n,
    );
    return {
      ...updated,
      physicalReads: {
        ...updated.physicalReads,
        [physicalReadKey(ws, id, generation, key)]: {
          workspaceId: ws,
          noteId: id,
          ...(ticket ? { ticket } : {}),
          ...(resourceOwner ? { resourceOwner } : {}),
          ...(assembly ? { assembly } : {}),
          ...(wireBytes !== undefined ? { wireBytes } : {}),
        },
      },
    };
  },
);
notePagesReducer.with(sourcePageReceived, (s, { payload: [ws, id, generation, key, page] }) => {
  const read = s.physicalReads[physicalReadKey(ws, id, generation, key)];
  if (read?.assembly && !Object.hasOwn(s.resourceLedger.owners, read.assembly.owner))
    return update(s, ws, id, (n) => {
      if (n.generation !== generation) return n;
      const requests = { ...n.requests };
      delete requests[key];
      return { ...n, requests };
    });
  let updated = update(s, ws, id, (n) => {
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
  });
  if (!read?.resourceOwner || getWorkspaceState(updated, ws).notes[id]?.pages[key] !== page)
    return updated;
  const resource = read.assembly?.data ?? `frame:${read.ticket}`,
    owner = `cache:${read.ticket}`;
  const reserved = updated.resourceLedger.resources[resource];
  if (!reserved) throw new Error('Decoded note page has no physical reservation');
  const measured = measureNotePageCost(
    page,
    read.assembly
      ? {
          payloadBytes: read.wireBytes!,
          stringUnits: read.wireBytes! * 3,
          objectNodes: read.wireBytes!,
          domNodes: 0,
          physicalReads: 0,
          assemblies: 0,
        }
      : reserved.cost,
  );
  const cost = read.assembly ? reserved.cost : measured;
  const settled = read.assembly
    ? updated.resourceLedger
    : settleNoteResource(updated.resourceLedger, resource, cost);
  const admission = read.assembly
    ? {
        status: 'admitted' as const,
        ledger: retainNoteResourcesFrom(settled, read.assembly.owner, owner, [resource]),
      }
    : requestNoteResources(settled, owner, [{ id: resource, cost }]);
  updated = { ...updated, resourceLedger: admission.ledger };
  if (admission.status !== 'admitted')
    return update(updated, ws, id, (n) => {
      const pages = { ...n.pages };
      delete pages[key];
      return {
        ...n,
        pages,
        pageOrder: n.pageOrder.filter((k) => k !== key),
        error: 'Note cache ownership budget unavailable',
      };
    });
  return update(
    {
      ...updated,
      cleanPages: addItem(removeItem(updated.cleanPages, owner), {
        workspaceId: ws,
        noteId: id,
        key,
        owner,
      }),
    },
    ws,
    id,
    (n) => ({
      ...n,
      pageAllocations: { ...n.pageAllocations, [key]: { owner, resource } },
    }),
  );
});
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
    return {
      ...n,
      drafts: [...n.drafts, draft],
      history: [...n.history, draft],
      needsReconcile: n.needsReconcile || !!n.document,
    };
  }),
);
notePagesReducer.with(
  pageDocumentSelectionChanged,
  (s, { payload: [ws, id, generation, before, selection] }) =>
    update(s, ws, id, (n) => {
      if (
        n.generation !== generation ||
        n.document !== before ||
        n.status !== 'ready' ||
        n.needsReconcile ||
        n.state?.sourceRevision !== before.baseRevision ||
        !sameNoteScope(n.state.scope, before.scope) ||
        ![selection.anchor, selection.head].every(
          (p) => Number.isSafeInteger(p) && p >= 0 && p <= before.length,
        ) ||
        ![-1, 1].includes(selection.anchorAffinity) ||
        ![-1, 1].includes(selection.headAffinity)
      )
        return n;
      if (
        Object.entries(selection).every(
          ([key, value]) => before.selection[key as keyof typeof selection] === value,
        )
      )
        return n;
      return { ...n, document: { ...before, selection: { ...selection } } };
    }),
);
notePagesReducer.with(
  pageDocumentPublished,
  (s, { payload: [ws, id, generation, before, after, splices] }) =>
    update(s, ws, id, (n) => {
      if (n.generation !== generation) return n;
      const admitted = prepareNoteDocumentPublication(n, before, after, splices);
      if (!admitted) return n;
      return {
        ...n,
        document: after,
        drafts: admitted.draft ? [...n.drafts, admitted.draft] : n.drafts,
        // The document session owns undo. This journal keeps only the monotonic
        // sequence checkpoint; pending drafts retain their chronological batches.
        history: admitted.draft ? [admitted.draft] : n.history,
      };
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
    return { ...n, error: null, pending: { operation, throughSequence, status: 'saving' } };
  }),
);
notePagesReducer.with(pageSavePreparationFailed, (s, { payload: [ws, id, generation, error] }) =>
  update(s, ws, id, (n) => (n.generation === generation ? { ...n, error } : n)),
);
notePagesReducer.with(
  pageDraftsUnchanged,
  (s, { payload: [ws, id, generation, revision, through] }) =>
    update(s, ws, id, (n) => {
      if (
        n.generation !== generation ||
        n.state?.sourceRevision !== revision ||
        n.pending ||
        n.needsReconcile
      )
        return n;
      // The captured edit prefix only inserted and removed its own text. No
      // remote write happened; chronological history still belongs to the note.
      return { ...n, drafts: n.drafts.filter((d) => d.sequence > through), error: null };
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
  let resourceLedger = s.resourceLedger;
  for (const allocation of Object.values(notes[id]?.pageAllocations ?? {}))
    resourceLedger = releaseNoteResources(resourceLedger, allocation.owner);
  for (const window of Object.values(notes[id]?.windows ?? {}))
    if (window.resourceOwner)
      resourceLedger = releaseNoteResources(resourceLedger, window.resourceOwner);
  delete notes[id];
  return setWorkspaceState(
    {
      ...s,
      resourceLedger,
      cleanPages: createCollection(
        'owner',
        getItems(s.cleanPages).filter((entry) => entry.workspaceId !== ws || entry.noteId !== id),
      ),
    },
    ws,
    { ...w, notes },
  );
});
notePagesReducer.with(workspaceUnmounted, (s, { payload: [ws] }) => {
  const w = getWorkspaceState(s, ws);
  const notes: Record<string, NotePageSession> = {};
  let nextGeneration = s.nextGeneration;
  let resourceLedger = s.resourceLedger;
  for (const [id, n] of Object.entries(w.notes)) {
    for (const allocation of Object.values(n.pageAllocations))
      resourceLedger = releaseNoteResources(resourceLedger, allocation.owner);
    for (const window of Object.values(n.windows))
      if (window.resourceOwner)
        resourceLedger = releaseNoteResources(resourceLedger, window.resourceOwner);
    if (hasRetainedDocumentWork(n))
      notes[id] = {
        ...invalidate(n),
        generation: nextGeneration++,
        panels: {},
        pageAllocations: {},
      };
  }
  return setWorkspaceState(
    {
      ...s,
      nextGeneration,
      resourceLedger,
      cleanPages: createCollection(
        'owner',
        getItems(s.cleanPages).filter((entry) => entry.workspaceId !== ws),
      ),
    },
    ws,
    { ...w, notes },
  );
});

notePagesReducer.with(pageWindowRequested, (s, { payload: [ws, id, panel, at] }) =>
  update(s, ws, id, (n) => {
    if (!(panel in n.panels) || !Number.isSafeInteger(at) || at < 0) return n;
    const prior = n.windows[panel];
    return {
      ...n,
      windows: {
        ...n.windows,
        [panel]: {
          at,
          request: (prior?.request ?? 0) + 1,
          value: prior?.value ?? null,
          resourceOwner: prior?.resourceOwner,
          error: null,
          loading: true,
        },
      },
    };
  }),
);
notePagesReducer.with(
  pageWindowRetained,
  (s, { payload: [ws, id, panel, generation, value, owner] }) => {
    const note = getWorkspaceState(s, ws).notes[id];
    const window = note?.windows[panel];
    if (!note || note.generation !== generation || window?.value !== value || !window.resourceOwner)
      return s;
    const resources = s.resourceLedger.owners[window.resourceOwner];
    if (!resources) return s;
    return {
      ...s,
      resourceLedger: retainNoteResourcesFrom(
        s.resourceLedger,
        window.resourceOwner,
        owner,
        resources,
      ),
    };
  },
);
notePagesReducer.with(
  pageWindowAssemblyStarted,
  (s, { payload: [ws, id, panel, generation, request] }) =>
    update(s, ws, id, (n) => {
      const w = n.windows[panel];
      if (n.generation !== generation || !w || w.request !== request) return n;
      return { ...n, windows: { ...n.windows, [panel]: { ...w, loading: true } } };
    }),
);
notePagesReducer.with(
  pageWindowSettled,
  (s, { payload: [ws, id, panel, generation, request, value, error, allocation] }) => {
    const n = getWorkspaceState(s, ws).notes[id];
    const w = n?.windows[panel];
    if (!n || !w || generation !== n.generation || request !== w.request) return s;
    if (
      value &&
      (!n.state ||
        value.sourceRevision !== n.state.sourceRevision ||
        !sameNoteScope(value.scope, n.state.scope))
    )
      return s;
    if (value && allocation)
      s = {
        ...s,
        resourceLedger: retainNoteResourcesFrom(
          s.resourceLedger,
          allocation.sponsor,
          allocation.owner,
          [allocation.resource],
          3,
        ),
      };
    return update(s, ws, id, (note) => ({
      ...note,
      ...(value?.native &&
      note.status === 'ready' &&
      !note.needsReconcile &&
      !note.document &&
      !hasRetainedDocumentWork(note)
        ? {
            document: {
              ...createNoteDocumentSession(value.scope, value.sourceRevision, value.sourceLength),
              selection: {
                anchor: value.range.start,
                head: value.range.start,
                anchorAffinity: 1,
                headAffinity: 1,
              },
            },
          }
        : {}),
      windows: {
        ...note.windows,
        [panel]: {
          ...w,
          value,
          error,
          loading: false,
          resourceOwner: value ? allocation?.owner : undefined,
        },
      },
    }));
  },
);
