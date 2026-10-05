import { v4 as uuid } from 'uuid';
import { notePageRequestKey } from '$features/notes/virtualized/note-assembly-reservation';
import { noteWindowSaga } from './note-window-saga';
import {
  composeNoteEdits,
  prepareNoteSave,
} from '$features/notes/virtualized/editing/note-edit-plan';
import { readNoteLocalReceiptResult } from '$features/notes/virtualized/editing/note-receipt-local-result';
import { currentNoteDocumentSave } from '../note-document-publication';
import type { NotePagesState } from '../note-pages-types';
import type { NotePageSession } from '../note-pages-types';
import { eventChannel, buffers } from 'redux-saga';
import { call, put, race, take, takeEvery, fork, getContext } from 'typed-redux-saga';
import { rejectedNoteSave } from '$lib/client/note-page-errors';
import { appClient } from '$lib/client';
import type {
  NotePageState,
  NotePageRequest,
  NoteReadPage,
  NotePagingCapabilities,
} from '$lib/client/note-pages';
import { sameNoteScope } from '$lib/client/note-pages';
import {
  selectNotePageSession,
  selectPhysicalNoteReadCount,
  selectPhysicalNoteReadTicket,
  selectNoteReadCurrent,
  selectNoteReadAdmitted,
  selectNoteResourceHeld,
  selectNoteWindowNeedsLoad,
} from '../note-pages-selectors';
import * as actions from '../note-pages-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  takeLeadingInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
const session = selectNotePageSession.effect;
const key = (ws: string, id: string) => JSON.stringify([ws, id]);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
// A predicate for admission changes across all notes, not an action creator's
// `.type` string. Every ownership action may release the next global slot.
const isNotePageEvent = (event: ObservedAction) => event.type.startsWith('notePages/');

type StreamEvent = { epoch: number } & ({ state: NotePageState } | { reset: true; error?: string });
function* stream(ws: string, id: string) {
  const client = appClient.notes.pages;
  let capabilities: NotePagingCapabilities | null;
  try {
    capabilities = client ? yield* call([client, client.capabilities]) : null;
  } catch (e) {
    yield* put(actions.pageReset(ws, id, message(e)));
    return;
  }
  if (!client || !capabilities) {
    yield* put(actions.pageLegacySelected(ws, id));
    return;
  }
  let epoch = 0,
    admittedEpoch = -1;
  const channel = eventChannel<StreamEvent>(
    (emit) =>
      client.subscribe(
        ws,
        id,
        (state) => emit({ state, epoch }),
        (error) => emit({ reset: true, error, epoch: ++epoch }),
      ),
    buffers.sliding(2),
  );
  try {
    while (true) {
      const event = yield* take(channel);
      if (event.epoch !== admittedEpoch) {
        // Release old page ownership before any asynchronous reconnect negotiation.
        yield* put(actions.pageReset(ws, id, 'reset' in event ? event.error : undefined));
        if (admittedEpoch >= 0 || event.epoch > 1) {
          let received: NotePagingCapabilities | null;
          try {
            received = yield* call([client, client.capabilities]);
          } catch (e) {
            if (event.epoch !== epoch) continue;
            yield* put(actions.pageReset(ws, id, message(e)));
            return;
          }
          // Every hello outcome belongs to its connection epoch, including lost support.
          if (event.epoch !== epoch) continue;
          if (!received) {
            yield* put(actions.pageLegacySelected(ws, id));
            return;
          }
          capabilities = received;
        }
        admittedEpoch = event.epoch;
      }
      if ('reset' in event) continue;
      const n = yield* session(ws, id);
      if (!n) continue;
      if (event.state.scope.backendId !== capabilities.backendId) {
        yield* put(actions.pageReset(ws, id, 'Note backend changed; reconnect required'));
        continue;
      }
      yield* put(actions.pageStateReceived(ws, id, n.generation, event.state));
      const after = yield* session(ws, id);
      if (after?.status === 'ready') {
        for (const panel of Object.keys(after.windows)) {
          const demand = yield* selectNoteWindowNeedsLoad.effect(ws, id, panel);
          if (demand) yield* put(actions.pageWindowRequested(ws, id, panel, demand.at));
        }
      }
      if (after?.status === 'ready' && after.state && !Object.keys(after.pages).length)
        if (!Object.keys(after.windows).length)
          yield* put(
            actions.pageRequested(ws, id, {
              kind: 'source',
              at: Object.values(after.panels).flat()[0]?.start ?? 0,
              sourceRevision: after.state.sourceRevision,
              noteInstanceId: after.state.scope.noteInstanceId,
            }),
          );
    }
  } finally {
    channel.close();
  }
}
function* read(action: ReturnType<typeof actions.pageRequested>) {
  const [ws, id, request, assembly] = action.payload;
  let n: NotePageSession | undefined = yield* session(ws, id);
  const client = appClient.notes.pages;
  const requestKey = notePageRequestKey(request, assembly);
  if (!client || !n || !Object.keys(n.panels).length || n.requests[requestKey]) return;
  const receiptRead = request.kind === 'mapping' || request.kind === 'effects';
  if (receiptRead) {
    if (
      !n.receipts.some(
        (r) =>
          r.operationId === request.operationId &&
          (request.kind === 'mapping' ? r.mappingRef : r.effectsRef) === request.ref,
      )
    )
      return;
  } else if (n.status !== 'ready') return;
  let cached: NoteReadPage | undefined = n.pages[requestKey];
  if (cached && (!('expiresAt' in cached) || Date.parse(cached.expiresAt) > Date.now())) return;
  if (!assembly && (yield* selectPhysicalNoteReadCount.effect(ws, id)) >= 4) {
    yield* put(actions.pageReadDeferred(ws, id, n.generation, request));
    return;
  }
  let live = Object.values(n.pages).find((p) => p.kind === 'noteSourcePage');
  const scopedRequest: NotePageRequest =
    request.kind === 'source' &&
    request.cursor === undefined &&
    !request.snapshotId &&
    live?.kind === 'noteSourcePage'
      ? {
          ...request,
          snapshotId: live.snapshotId,
          sourceRevision: live.sourceRevision,
          noteInstanceId: live.scope.noteInstanceId,
        }
      : request;
  const generation = n.generation;
  // A physical read can settle after cache invalidation. Retain only its scalar
  // identity/request across IO, not an old session and all of its pages/windows.
  n = undefined;
  cached = undefined;
  live = undefined;
  const ticket = uuid();
  yield* put(
    actions.pageRequestStarted(
      ws,
      id,
      generation,
      requestKey,
      ticket,
      request.maxWireBytes ?? 65536,
      assembly,
    ),
  );
  if ((yield* selectPhysicalNoteReadTicket.effect(ws, id, generation, requestKey)) !== ticket) {
    if (assembly) return;
    const current = yield* session(ws, id);
    if (current?.generation === generation && !current.requests[requestKey] && !current.error)
      yield* put(actions.pageReadDeferred(ws, id, generation, request));
    return;
  }
  try {
    while (!(yield* selectNoteReadAdmitted.effect(ticket))) {
      if (!(yield* selectNoteReadCurrent.effect(ws, id, generation))) return;
      // Any note may release the next global slot. Never wait only for this note.
      yield* take([workspaceUnmounted, isNotePageEvent]);
    }
    if (!(yield* selectNoteReadCurrent.effect(ws, id, generation))) return;
    const page = yield* call([client, client.read], ws, id, scopedRequest);
    yield* put(actions.sourcePageReceived(ws, id, generation, requestKey, page));
  } catch (e) {
    if (assembly && !(yield* selectNoteResourceHeld.effect(assembly.owner))) return;
    const current = yield* session(ws, id);
    if (current?.generation !== generation) return;
    const code = e && typeof e === 'object' && 'code' in e ? e.code : null;
    if (code === 'note-page-stale' || code === 'note-page-expired') {
      yield* put(actions.pageReset(ws, id, message(e)));
      if (!current.readRecoveryAttempted) yield* put(actions.pageRefreshRequested(ws, id, true));
    } else yield* put(actions.pageRequestFailed(ws, id, generation, requestKey, message(e)));
  } finally {
    yield* put(actions.pageReadSettled(ws, id, generation, requestKey));
    const current = yield* session(ws, id);
    if (current?.deferredRead && Object.keys(current.panels).length)
      yield* put(actions.pageRequested(ws, id, current.deferredRead));
  }
}
function* save(action: ReturnType<typeof actions.pageSaveRequested>) {
  const [ws, id, operation, through] = action.payload;
  const n = yield* session(ws, id);
  const client = appClient.notes.pages;
  if (!client || n?.pending || n?.status !== 'ready' || n.needsReconcile) return;
  yield* put(actions.pageSaveStarted(ws, id, operation, through));
  const pending = (yield* session(ws, id))?.pending;
  if (pending?.operation.operationId !== operation.operationId) return;
  try {
    const result = yield* call([client, client.applySplices], pending.operation);
    yield* put(actions.pageSaveSettled(ws, id, result));
    if (
      result.outcome === 'committed' &&
      (yield* session(ws, id))?.state?.sourceRevision !== result.afterRevision
    )
      yield* put(actions.pageRefreshRequested(ws, id));
  } catch (error) {
    const outcome = rejectedNoteSave(error, pending.operation);
    if (outcome) yield* put(actions.pageSaveSettled(ws, id, outcome));
    else yield* put(actions.pageSaveUnknown(ws, id, pending.operation.operationId));
  }
}
function* saveDrafts(action: ReturnType<typeof actions.pageSaveDraftsRequested>) {
  const [ws, id] = action.payload;
  let before: NotePageSession | undefined = yield* session(ws, id);
  if (
    !before?.state ||
    before.status !== 'ready' ||
    before.pending ||
    before.needsReconcile ||
    !before.drafts.length
  )
    return;
  const { generation, state } = before;
  const drafts = before.drafts.slice();
  const through = drafts[drafts.length - 1].sequence;
  try {
    let window = Object.values(before.windows).find(
      (w) =>
        w.value?.sourceRevision === state.sourceRevision &&
        sameNoteScope(w.value.scope, state.scope),
    )?.value;
    if (!window) throw new Error('Saving needs the current note source identity');
    const sourceLength = window.sourceLength;
    window = undefined;
    before = undefined;
    if (
      drafts.some(
        (d) => d.baseRevision !== state.sourceRevision || !sameNoteScope(d.scope, state.scope),
      )
    )
      throw new Error('Note drafts require reconciliation before saving');
    const splices = composeNoteEdits(sourceLength, drafts);
    if (!splices.length) {
      yield* put(actions.pageDraftsUnchanged(ws, id, generation, state.sourceRevision, through));
      return;
    }
    const now = Date.now();
    const operation = yield* call(
      prepareNoteSave,
      {
        scope: state.scope,
        sourceLength,
        baseRevision: state.sourceRevision,
        operationId: uuid(),
        expiresAt: new Date(now + 86_400_000).toISOString(),
        splices,
      },
      now,
    );
    const current = yield* session(ws, id);
    // Hashing is asynchronous. Later typing may remain dirty, but a replaced
    // document, rebase or recovered save must never adopt this captured plan.
    if (
      !current?.state ||
      current.generation !== generation ||
      current.state.sourceRevision !== state.sourceRevision ||
      !sameNoteScope(current.state.scope, state.scope) ||
      current.pending ||
      current.needsReconcile ||
      drafts.some((d, i) => current.drafts[i] !== d)
    )
      return;
    yield* put(actions.pageSaveRequested(ws, id, operation, through));
  } catch (error) {
    yield* put(actions.pageSavePreparationFailed(ws, id, generation, message(error)));
  }
}
function* retry(action: ReturnType<typeof actions.pageSaveRetryRequested>) {
  const [ws, id] = action.payload;
  const pending = (yield* session(ws, id))?.pending;
  const client = appClient.notes.pages;
  if (!client || !pending) return;
  // Status first, never mint a replacement operation ID after a lost acknowledgement.
  try {
    const result = yield* call([client, client.operationStatus], pending.operation);
    yield* put(actions.pageSaveSettled(ws, id, result));
    if (
      result.outcome === 'committed' &&
      (yield* session(ws, id))?.state?.sourceRevision !== result.afterRevision
    )
      yield* put(actions.pageRefreshRequested(ws, id));
  } catch {
    yield* put(actions.pageSaveUnknown(ws, id, pending.operation.operationId));
  }
}
/** Receipt traversal owns physical settlement even if the saga is cancelled.
 * Redux subscription observation remains live until the promise's outer finally. */
function* reconcileSave(
  action: ReturnType<typeof actions.pageSaveSettled | typeof actions.pageStateReceived>,
) {
  const [ws, id] = action.payload;
  const capture = (yield* session(ws, id))?.committedDocumentSave;
  const client = appClient.notes.pages;
  if (!capture || !client) return;
  const redux = yield* getContext<
    | {
        getState(): { notePages: NotePagesState };
        dispatch: (
          action: ReturnType<
            typeof actions.pageResourcesRequested | typeof actions.pageResourcesReleased
          >,
        ) => unknown;
        subscribe(listener: () => void): () => void;
      }
    | undefined
  >('reduxStore');
  if (!redux) return;
  const read = () => redux.getState().notePages.byWorkspaceId[ws]?.notes[id];
  const current = () => currentNoteDocumentSave(read(), capture);
  if (!current()) return;
  const abort = new AbortController();
  try {
    const proof = yield* call(
      readNoteLocalReceiptResult,
      {
        read: () => redux.getState().notePages,
        dispatch: (action: Parameters<typeof redux.dispatch>[0]) => {
          redux.dispatch(action);
        },
        subscribe: (changed: () => void) => redux.subscribe(changed),
      },
      client,
      capture.receipt,
      capture.operation,
      capture.document.baseLength,
      current,
      abort.signal,
    );
    // No async cleanup remains. The reducer repeats this CAS after middleware.
    const before = (yield* session(ws, id))?.document;
    if (!before || !current()) return;
    yield* put(actions.pageDocumentSaveReconciled(ws, id, capture, before, proof, Date.now()));
    const after = yield* session(ws, id);
    if (after?.document?.baseRevision !== capture.receipt.afterRevision || after.needsReconcile)
      return;
    for (const panel of Object.keys(after.windows))
      yield* put(actions.pageWindowRequested(ws, id, panel, after.document.selection.head));
  } catch {
    // Unsupported effects, later edits, stale ownership and IO failure retain the
    // receipt, document/history and reconciliation gate for a supported retry.
  } finally {
    abort.abort();
  }
}
type ObservedAction = { type: string; payload?: unknown };
function matches(
  action: ObservedAction,
  creator: { type: string },
  ws: string,
  id?: string,
): boolean {
  return (
    action.type === creator.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === ws &&
    (id === undefined || action.payload[1] === id)
  );
}
function* lastPanelClosed(ws: string, id: string) {
  while (true) {
    yield* take((action: ObservedAction) => matches(action, actions.pagePanelClosed, ws, id));
    const n = yield* session(ws, id);
    if (!n || !Object.keys(n.panels).length) return;
  }
}
function* ownSession(
  action:
    ReturnType<typeof actions.pagePanelOpened> | ReturnType<typeof actions.pageRefreshRequested>,
) {
  const [ws, id] = action.payload;
  while (true) {
    const n = yield* session(ws, id);
    if (!n || !Object.keys(n.panels).length) return;
    const result = yield* race({
      stream: call(stream, ws, id),
      refresh: take((a: ObservedAction) => matches(a, actions.pageRefreshRequested, ws, id)),
      close: call(lastPanelClosed, ws, id),
      unmount: take((a: ObservedAction) => matches(a, workspaceUnmounted, ws)),
      discard: take((a: ObservedAction) => matches(a, actions.pageSessionDiscarded, ws, id)),
    });
    if (!result.refresh) return;
  }
}
export function* notePagesSaga() {
  yield* fork(noteWindowSaga);
  yield* takeSingleFlightInContext(
    [actions.pageSaveSettled, actions.pageStateReceived],
    (a) => key(a.payload[0], a.payload[1]),
    reconcileSave,
  );
  yield* takeEvery(actions.pageRequested, read);
  yield* takeSingleFlightInContext(
    actions.pageSaveDraftsRequested,
    (a) => key(a.payload[0], a.payload[1]),
    saveDrafts,
  );
  yield* takeSingleFlightInContext(
    actions.pageSaveRequested,
    (a) => key(a.payload[0], a.payload[1]),
    save,
  );
  yield* takeSingleFlightInContext(
    actions.pageSaveRetryRequested,
    (a) => key(a.payload[0], a.payload[1]),
    retry,
  );
  yield* takeLeadingInContext(
    [actions.pagePanelOpened, actions.pageRefreshRequested],
    (a) => key(a.payload[0], a.payload[1]),
    ownSession,
  );
}
