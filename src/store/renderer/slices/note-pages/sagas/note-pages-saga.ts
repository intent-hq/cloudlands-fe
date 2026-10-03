import { eventChannel, buffers } from 'redux-saga';
import { call, put, race, take, takeEvery } from 'typed-redux-saga';
import { rejectedNoteSave } from '$lib/client/note-page-errors';
import { appClient } from '$lib/client';
import type {
  NotePageState,
  NotePageRequest,
  NotePagingCapabilities,
} from '$lib/client/note-pages';
import { selectNotePageSession, selectPhysicalNoteReadCount } from '../note-pages-selectors';
import * as actions from '../note-pages-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  takeLeadingInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
const session = selectNotePageSession.effect;
const key = (ws: string, id: string) => JSON.stringify([ws, id]);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
          try {
            capabilities = yield* call([client, client.capabilities]);
          } catch (e) {
            if (event.epoch !== epoch) continue;
            yield* put(actions.pageReset(ws, id, message(e)));
            return;
          }
          // Every hello outcome belongs to its connection epoch, including lost support.
          if (event.epoch !== epoch) continue;
          if (!capabilities) {
            yield* put(actions.pageLegacySelected(ws, id));
            return;
          }
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
      if (after?.status === 'ready' && after.state && !Object.keys(after.pages).length)
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
  const [ws, id, request] = action.payload;
  const n = yield* session(ws, id);
  const client = appClient.notes.pages;
  const requestKey = JSON.stringify(
    Object.fromEntries(Object.entries(request).sort(([a], [b]) => a.localeCompare(b))),
  );
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
  const cached = n.pages[requestKey];
  if (cached && (!('expiresAt' in cached) || Date.parse(cached.expiresAt) > Date.now())) return;
  if ((yield* selectPhysicalNoteReadCount.effect(ws, id)) >= 4) {
    yield* put(actions.pageReadDeferred(ws, id, n.generation, request));
    return;
  }
  const live = Object.values(n.pages).find((p) => p.kind === 'noteSourcePage');
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
  yield* put(actions.pageRequestStarted(ws, id, generation, requestKey));
  try {
    const page = yield* call([client, client.read], ws, id, scopedRequest);
    yield* put(actions.sourcePageReceived(ws, id, generation, requestKey, page));
  } catch (e) {
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
    const result = yield* call([client, client.applySplices], operation);
    yield* put(actions.pageSaveSettled(ws, id, result));
    if (result.outcome === 'committed') yield* put(actions.pageRefreshRequested(ws, id));
  } catch (error) {
    const outcome = rejectedNoteSave(error, operation);
    if (outcome) yield* put(actions.pageSaveSettled(ws, id, outcome));
    else yield* put(actions.pageSaveUnknown(ws, id, operation.operationId));
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
    if (result.outcome === 'committed') yield* put(actions.pageRefreshRequested(ws, id));
  } catch {
    yield* put(actions.pageSaveUnknown(ws, id, pending.operation.operationId));
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
  yield* takeEvery(actions.pageRequested, read);
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
