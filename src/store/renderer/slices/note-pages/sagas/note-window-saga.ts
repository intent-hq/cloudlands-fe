import { call, put, race, take, type SagaGenerator } from 'typed-redux-saga';
import { noteWindowSteps } from '$features/notes/virtualized/note-window-reader';
import { takeLatestInContext } from '../../../utils/context-saga-effects';
import { selectNotePageSession } from '../note-pages-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import * as a from '../note-pages-slice';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
type Action = { type: string; payload?: unknown };
const belongs = (event: Action, ws: string, id?: string) =>
  Array.isArray(event.payload) &&
  event.payload[0] === ws &&
  (id === undefined || event.payload[1] === id);
function* readPage(
  ws: string,
  id: string,
  generation: number,
  request: NotePageRequest,
): SagaGenerator<NoteReadPage> {
  const key = JSON.stringify(
    Object.fromEntries(Object.entries(request).sort(([a], [b]) => a.localeCompare(b))),
  );
  yield* put(a.pageRequested(ws, id, request));
  while (true) {
    const n = yield* selectNotePageSession.effect(ws, id);
    if (!n || n.generation !== generation || n.status !== 'ready')
      throw new Error('Note window superseded');
    const page = n.pages[key];
    if (page && (!('expiresAt' in page) || Date.parse(page.expiresAt) > Date.now())) return page;
    if (n.error && !n.requests[key]) throw new Error(n.error);
    const event = yield* take((event: Action) => belongs(event, ws, id));
    // The shared reader retains only the latest speculative deferred request.
    // Every mounted panel still owns its active iterator: re-admit that iterator
    // when a physical slot drains, so another panel cannot overwrite its demand.
    if (event.type === a.pageReadSettled.type) yield* put(a.pageRequested(ws, id, request));
  }
}
function* assemble(action: ReturnType<typeof a.pageWindowRequested>) {
  const [ws, id, panel] = action.payload;
  let n = yield* selectNotePageSession.effect(ws, id);
  while (n?.status === 'connecting') {
    yield* take((event: Action) => belongs(event, ws, id));
    n = yield* selectNotePageSession.effect(ws, id);
  }
  const owned = n?.windows[panel];
  if (!n?.state || n.status !== 'ready' || !owned) return;
  const generation = n.generation,
    request = owned.request;
  const live = Object.values(n.pages).find((p) => 'snapshotId' in p);
  const steps = noteWindowSteps({
    at: owned.at,
    scope: n.state.scope,
    sourceRevision: n.state.sourceRevision,
    ...(live && 'snapshotId' in live ? { snapshotId: live.snapshotId } : {}),
  });
  try {
    let next = steps.next();
    while (!next.done) {
      const page = yield* call(readPage, ws, id, generation, next.value);
      next = steps.next(page);
    }
    yield* put(a.pageWindowSettled(ws, id, panel, generation, request, next.value, null));
  } catch (error) {
    yield* put(
      a.pageWindowSettled(
        ws,
        id,
        panel,
        generation,
        request,
        null,
        error instanceof Error ? error.message : String(error),
      ),
    );
  } finally {
    steps.return(undefined as never);
  }
}
function* waitForUnmount(ws: string) {
  while (true) {
    const event = yield* take(workspaceUnmounted);
    if (event.payload[0] === ws) return;
  }
}
function* ownWindow(
  action: ReturnType<typeof a.pageWindowRequested> | ReturnType<typeof a.pagePanelClosed>,
) {
  if (action.type === a.pagePanelClosed.type) return;
  const [ws] = action.payload;
  yield* race({
    work: call(assemble, action as ReturnType<typeof a.pageWindowRequested>),
    unmount: call(waitForUnmount, ws),
  });
}
export function* noteWindowSaga() {
  yield* takeLatestInContext(
    [a.pageWindowRequested, a.pagePanelClosed],
    (event) => JSON.stringify(event.payload.slice(0, 3)),
    ownWindow,
  );
}
