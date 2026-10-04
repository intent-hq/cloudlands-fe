import { call, put, race, take, type SagaGenerator } from 'typed-redux-saga';
import { v4 as uuid } from 'uuid';
import { noteWindowSteps } from '$features/notes/virtualized/note-window-reader';
import { takeLatestInContext } from '../../../utils/context-saga-effects';
import {
  selectNotePageSession,
  selectNotePageInput,
  selectNoteResourceHeld,
} from '../note-pages-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import * as a from '../note-pages-slice';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import type { NotePageSession } from '../note-pages-types';
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
  owner: string,
): SagaGenerator<NoteReadPage> {
  const key = JSON.stringify(
    Object.fromEntries(Object.entries(request).sort(([a], [b]) => a.localeCompare(b))),
  );
  yield* put(a.pageRequested(ws, id, request));
  while (true) {
    let input:
      { current: boolean; page: NoteReadPage | undefined; error: string | null } | undefined;
    input = yield* selectNotePageInput.effect(ws, id, generation, key);
    if (!input.current) throw new Error('Note window superseded');
    let page = input.page;
    if (page && (!('expiresAt' in page) || Date.parse(page.expiresAt) > Date.now())) {
      yield* put(a.pageCachedRetained(ws, id, generation, key, owner, page));
      if (yield* selectNoteResourceHeld.effect(owner)) return page;
      throw new Error('Note assembly input ownership unavailable');
    }
    if (input.error) throw new Error(input.error);
    input = undefined;
    page = undefined;
    const event = yield* take((event: Action) => belongs(event, ws, id));
    // The shared reader retains only the latest speculative deferred request.
    // Every mounted panel still owns its active iterator: re-admit that iterator
    // when a physical slot drains, so another panel cannot overwrite its demand.
    if (event.type === a.pageReadSettled.type) yield* put(a.pageRequested(ws, id, request));
  }
}
function* assemble(action: ReturnType<typeof a.pageWindowRequested>) {
  const [ws, id, panel] = action.payload;
  let n: NotePageSession | undefined = yield* selectNotePageSession.effect(ws, id);
  while (n?.status === 'connecting') {
    yield* take((event: Action) => belongs(event, ws, id));
    n = yield* selectNotePageSession.effect(ws, id);
  }
  let owned: NotePageSession['windows'][string] | undefined = n?.windows[panel];
  if (!n?.state || n.status !== 'ready' || !owned) return;
  const generation = n.generation,
    request = owned.request;
  let live = Object.values(n.pages).find((p) => 'snapshotId' in p);
  const steps = noteWindowSteps({
    at: owned.at,
    scope: n.state.scope,
    sourceRevision: n.state.sourceRevision,
    ...(live && 'snapshotId' in live ? { snapshotId: live.snapshotId } : {}),
  });
  // The iterator owns its admitted inputs. Do not keep the entire session (or
  // previous panel window) reachable while waiting for the next physical read.
  n = undefined;
  owned = undefined;
  live = undefined;
  const assemblyId = `assembly:${uuid()}`;
  const inputOwners: string[] = [];
  try {
    let next = steps.next();
    while (!next.done) {
      const owner = `${assemblyId}:${inputOwners.length}`;
      inputOwners.push(owner);
      let page: NoteReadPage | undefined = yield* call(
        readPage,
        ws,
        id,
        generation,
        next.value,
        owner,
      );
      next = steps.next(page);
      page = undefined;
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
    for (const owner of inputOwners) yield* put(a.pageResourcesReleased(owner));
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
