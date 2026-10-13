import { buffers, channel } from 'redux-saga';
import { call, put, race, take, takeEvery, join, type SagaGenerator } from 'typed-redux-saga';
import { v4 as uuid } from 'uuid';
import {
  noteWindowSteps,
  type NoteWindowAddress,
} from '$features/notes/virtualized/note-window-reader';
import {
  noteAssemblyResources,
  notePageRequestKey,
  NOTE_ASSEMBLY_OWNER_SLOTS,
  type NoteAssemblyLease,
} from '$features/notes/virtualized/note-assembly-reservation';
import { takeLatestInContext } from '../../../utils/context-saga-effects';
import {
  selectNotePageSession,
  selectNotePageInput,
  selectNoteAssemblyStatus,
  selectNoteAssemblyReadBusy,
} from '../note-pages-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import * as a from '../note-pages-slice';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import type { NotePageSession } from '../note-pages-types';
type Action = { type: string; payload?: unknown };
const isNotePageEvent = (event: Action) => event.type.startsWith('notePages/');
const belongs = (event: Action, ws: string, id?: string) =>
  Array.isArray(event.payload) &&
  event.payload[0] === ws &&
  (id === undefined || event.payload[1] === id);
function* readPage(
  ws: string,
  id: string,
  generation: number,
  request: NotePageRequest,
  assembly: NoteAssemblyLease,
): SagaGenerator<NoteReadPage> {
  const key = notePageRequestKey(request, assembly);
  const isReadSettled = (event: Action) =>
    event.type === a.pageReadSettled.type && belongs(event, ws, id);
  yield* put(a.pageRequested(ws, id, request, assembly));
  while (true) {
    let input:
      | {
          current: boolean;
          page: NoteReadPage | undefined;
          resource: string | undefined;
          error: string | null;
        }
      | undefined = yield* selectNotePageInput.effect(ws, id, generation, key);
    if (!input.current) throw new Error('Note window superseded');
    let page = input.page;
    if (page && (!('expiresAt' in page) || Date.parse(page.expiresAt) > Date.now())) {
      if (input.resource !== assembly.data)
        throw new Error('Note assembly input has another sponsor');
      input = undefined;
      // The DATA reservation covers the retained page even if its cache lease is
      // evicted here. CONTROL cannot back the next read before this one settles.
      while (yield* selectNoteAssemblyReadBusy.effect(assembly.owner)) yield* take(isReadSettled);
      return page;
    }
    if (input.error) throw new Error(input.error);
    input = undefined;
    page = undefined;
    yield* take((event: Action) => belongs(event, ws, id));
  }
}
function* assemble(action: ReturnType<typeof a.pageWindowRequested>) {
  const [ws, id, panel] = action.payload;
  let n: NotePageSession | undefined = yield* selectNotePageSession.effect(ws, id);
  while (n?.status === 'connecting') {
    n = undefined;
    yield* take((event: Action) => belongs(event, ws, id));
    n = yield* selectNotePageSession.effect(ws, id);
  }
  let owned: NotePageSession['windows'][string] | undefined = n?.windows[panel];
  if (!n?.state || n.status !== 'ready' || !owned) return;
  const generation = n.generation,
    request = owned.request;
  let live = Object.values(n.pages).find((p) => 'snapshotId' in p);
  const address: NoteWindowAddress = {
    at: owned.at,
    scope: n.state.scope,
    sourceRevision: n.state.sourceRevision,
    ...(owned.growth
      ? { snapshotId: owned.growth.snapshotId, minimumEnd: owned.growth.minimumEnd }
      : live && 'snapshotId' in live
        ? { snapshotId: live.snapshotId }
        : {}),
  };
  const prefixExpiresAt = owned.growth ? owned.value?.expiresAt : undefined;
  n = undefined;
  owned = undefined;
  live = undefined;
  const token = uuid();
  const assembly: NoteAssemblyLease = {
    owner: `assembly:${token}`,
    data: `assembly-data:${token}`,
    control: `assembly-control:${token}`,
  };
  let steps: ReturnType<typeof noteWindowSteps> | undefined;
  try {
    if (address.minimumEnd !== undefined && !(Date.parse(prefixExpiresAt ?? '') > Date.now()))
      throw new Error('Note growth snapshot expired');
    yield* put(a.pageWindowAssemblyStarted(ws, id, panel, generation, request));
    yield* put(
      a.pageResourcesRequested(
        assembly.owner,
        noteAssemblyResources(assembly),
        NOTE_ASSEMBLY_OWNER_SLOTS,
      ),
    );
    while (true) {
      const status = yield* selectNoteAssemblyStatus.effect(
        ws,
        id,
        panel,
        generation,
        request,
        assembly.owner,
      );
      if (status === 'admitted') break;
      if (status !== 'queued')
        throw new Error(
          status === 'stale' ? 'Note window superseded' : 'Note assembly reservation unavailable',
        );
      yield* take([workspaceUnmounted, isNotePageEvent]);
    }
    // Reservation pressure may outlive the pinned snapshot. Refuse before any
    // source IO, while the old window and DATA lease remain published.
    if (address.minimumEnd !== undefined && !(Date.parse(prefixExpiresAt ?? '') > Date.now()))
      throw new Error('Note growth snapshot expired');
    steps = noteWindowSteps(address);
    let next = steps.next();
    while (!next.done) {
      let page: NoteReadPage | undefined = yield* call(
        readPage,
        ws,
        id,
        generation,
        next.value,
        assembly,
      );
      next = steps.next(page);
      page = undefined;
    }
    if (address.minimumEnd !== undefined && !(Date.parse(next.value.expiresAt ?? '') > Date.now()))
      throw new Error('Note growth snapshot expired');
    yield* put(
      a.pageWindowSettled(ws, id, panel, generation, request, next.value, null, {
        sponsor: assembly.owner,
        resource: assembly.data,
        owner: `window:${token}`,
      }),
    );
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
    steps?.return(undefined as never);
    yield* put(a.pageResourcesReleased(assembly.owner));
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
function* grow(action: ReturnType<typeof a.pageWindowGrowthRequested>) {
  const [ws, id, panel, generation, request, minimumEnd] = action.payload;
  const note: NotePageSession | undefined = yield* selectNotePageSession.effect(ws, id);
  const window = note?.windows[panel],
    value = window?.value;
  // Ignored resize intents never reach takeLatest, so they cannot cancel a newer
  // explicit navigation or an already-running growth assembly.
  if (
    !note ||
    note.status !== 'ready' ||
    note.generation !== generation ||
    !window ||
    window.loading ||
    window.error ||
    window.request !== request ||
    !value ||
    !Number.isSafeInteger(minimumEnd) ||
    minimumEnd <= value.range.end ||
    minimumEnd > value.sourceLength ||
    !(Date.parse(value.expiresAt ?? '') > Date.now())
  )
    return;
  yield* put(
    a.pageWindowRequested(ws, id, panel, value.range.start, {
      generation,
      request,
      snapshotId: value.snapshotId,
      sourceRevision: value.sourceRevision,
      start: value.range.start,
      end: value.range.end,
      minimumEnd,
    }),
  );
}
export function* noteWindowSaga() {
  yield* takeEvery(a.pageWindowGrowthRequested, grow);
  type WindowAction =
    ReturnType<typeof a.pageWindowRequested> | ReturnType<typeof a.pagePanelClosed>;
  // Intake and forwarding are synchronous: no queued requests or extra context
  // registry. Only reducer-accepted growth may cancel a current window worker.
  const accepted = channel<WindowAction>(buffers.none());
  const forwarded = new WeakSet<object>();
  yield* takeLatestInContext(
    accepted,
    (event) => JSON.stringify(event.payload.slice(0, 3)),
    ownWindow,
  );
  try {
    yield* takeEvery(a.pagePanelClosed, function* forwardClose(action) {
      yield* put(accepted, action);
    });
    const intake = yield* takeEvery(a.pageWindowRequested, function* forwardRequest(action) {
      const [ws, id, panel, , growth] = action.payload;
      if (growth) {
        const note: NotePageSession | undefined = yield* selectNotePageSession.effect(ws, id);
        const window = note?.windows[panel];
        if (
          !note ||
          !window?.loading ||
          note.generation !== growth.generation ||
          window.request !== growth.request + 1 ||
          window.growth !== growth ||
          forwarded.has(growth)
        )
          return;
        forwarded.add(growth);
      }
      yield* put(accepted, action);
    });
    yield* join(intake);
  } finally {
    accepted.close();
  }
}
