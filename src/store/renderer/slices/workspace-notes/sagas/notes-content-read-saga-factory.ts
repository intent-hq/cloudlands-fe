import type { Task } from 'redux-saga';
import {
  call,
  cancelled,
  fork,
  join,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { NotesClient } from '../../../../../lib/client/app-client';
import type { Note } from '../../../../../shared/types';
import { SPEC_NOTE_ID } from '../../../../../shared/constants/notes';
import { isNoteContentStale } from '../../../../../shared/utils/note-content';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { takeLatestInContext, takeLatestByContext } from '../../../utils/context-saga-effects';
import type { WorkspaceNotesWorkspaceState } from '../workspace-notes-types';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  ensureNoteContentLoadedRequested,
  listSlimNotesRequested,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  noteEventReceived,
  noteContentViewFinished,
  noteContentViewReleased,
  noteContentViewRequested,
  readNoteRequested,
  refreshNoteFromEventRequested,
  selectNote,
  workspaceNotesHydrationRequested,
  type NoteEventType,
} from '../workspace-notes-slice';
import { toRuntimeNote } from './note-payload-mappers';

type ObservedAction = { type: string; payload?: unknown };
type ReadAction = ReturnType<typeof readNoteRequested>;
type ReadResult = { note: ReturnType<typeof toRuntimeNote> | null } | { error: Error };
type ReadSlot = {
  generation: number;
  task: Task;
  leaderSeq: number;
  eventType?: NoteEventType;
  authority: string | null;
};
type ReadAdmission = { current?: ReadSlot; trailing?: ReadSlot };
type ReadCoordinator = {
  admissions: Map<string, ReadAdmission>;
  nextGeneration: number;
};

const NOTE_READ_CANCELLED = 'Note read cancelled';

/** Shared read owner; each renderer supplies its own transport and Store-bound selectors. */
export function createNotesContentReadSaga({
  notes,
  selectPrincipalConnectionContext,
  selectWorkspaceNotesState,
  selectNoteById,
  logger,
}: {
  notes: Pick<NotesClient, 'list' | 'get'>;
  selectPrincipalConnectionContext: { effect(): SagaGenerator<string | null> };
  selectWorkspaceNotesState: {
    effect(workspaceId: string): SagaGenerator<WorkspaceNotesWorkspaceState>;
  };
  selectNoteById: { effect(workspaceId: string, noteId: string): SagaGenerator<Note | undefined> };
  logger: { error(message: string, error: unknown): void };
}) {
  function isWorkspaceCleanup(action: ObservedAction, workspaceId: string): boolean {
    return (
      action.type === workspaceUnmounted.type &&
      Array.isArray(action.payload) &&
      action.payload[0] === workspaceId
    );
  }

  function isNoteReadCleanup(action: ObservedAction, workspaceId: string, noteId: string): boolean {
    return (
      isWorkspaceCleanup(action, workspaceId) ||
      (action.type === applyNoteDeleted.type &&
        Array.isArray(action.payload) &&
        action.payload[0] === workspaceId &&
        action.payload[1] === noteId)
    );
  }

  function releaseReadSlot(coordinator: ReadCoordinator, key: string, generation: number) {
    const admission = coordinator.admissions.get(key);
    if (!admission) return;
    if (admission.current?.generation === generation) {
      if (admission.trailing) {
        admission.current = admission.trailing;
        admission.trailing = undefined;
      } else {
        coordinator.admissions.delete(key);
      }
    } else if (admission.trailing?.generation === generation) {
      admission.trailing = undefined;
    }
  }

  function* fetchNoteSlot(
    coordinator: ReadCoordinator,
    key: string,
    workspaceId: string,
    noteId: string,
    generation: number,
    authority: string | null,
    after?: Task,
  ): SagaGenerator<ReadResult> {
    try {
      if (after) {
        const { cleanup } = yield* race({
          previous: join(after),
          cleanup: take((action: ObservedAction) => isNoteReadCleanup(action, workspaceId, noteId)),
        });
        if (cleanup) return { note: null };
      }
      if (authority !== (yield* selectPrincipalConnectionContext.effect())) return { note: null };
      const { found, cleanup } = yield* race({
        found: call([notes, notes.get], noteId, workspaceId),
        cleanup: take((action: ObservedAction) => isNoteReadCleanup(action, workspaceId, noteId)),
      });
      if (cleanup || !found) return { note: null };
      if (String(found.workspaceId) !== workspaceId || String(found.id) !== noteId) {
        return { note: null };
      }
      return { note: toRuntimeNote(found) };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error(String(error)) };
    } finally {
      releaseReadSlot(coordinator, key, generation);
    }
  }

  function* createReadSlot(
    coordinator: ReadCoordinator,
    key: string,
    workspaceId: string,
    noteId: string,
    action: ReadAction,
    authority: string | null,
    after?: Task,
  ): SagaGenerator<ReadSlot> {
    const generation = ++coordinator.nextGeneration;
    const task = yield* fork(
      fetchNoteSlot,
      coordinator,
      key,
      workspaceId,
      noteId,
      generation,
      authority,
      after,
    );
    return { generation, task, leaderSeq: action.seq, eventType: action.payload[2], authority };
  }

  function* admitNoteRead(
    coordinator: ReadCoordinator,
    action: ReadAction,
    authority: string | null,
  ): SagaGenerator<ReadSlot> {
    const [workspaceId, noteId, eventType] = action.payload;
    const key = `${authority ?? 'none'}:${workspaceId}:${noteId}`;
    let admission = coordinator.admissions.get(key);
    if (!admission?.current) {
      admission = {};
      coordinator.admissions.set(key, admission);
      const slot = yield* createReadSlot(coordinator, key, workspaceId, noteId, action, authority);
      admission.current = slot;
      return slot;
    }
    if (!eventType) return admission.current;
    if (!admission.trailing) {
      admission.trailing = yield* createReadSlot(
        coordinator,
        key,
        workspaceId,
        noteId,
        action,
        authority,
        admission.current.task,
      );
    }
    return admission.trailing;
  }

  function* hydrateWorkspaceNotes(workspaceId: string, force = false) {
    const authority = yield* selectPrincipalConnectionContext.effect();
    if (!authority) return;
    const current = yield* selectWorkspaceNotesState.effect(workspaceId);
    if (current.loading || (!force && current.initialized)) return;
    try {
      // Slim projection (§5.2): the initial hydrate does not need full bodies —
      // sidebar surfaces read titles/tags/metadata, and slim rows carry
      // contentPreview/contentLength. The spec is the one structural exception
      // (task links, ordering), so fetch it full alongside the slim list.
      // The spec fetch is fail-soft: a workspace without a spec note must not
      // fail the hydrate (its slim row, if any, is kept as-is).
      const fetchSlimListAndSpec = (id: string) =>
        Promise.all([
          notes.list(id, { projection: 'slim' }),
          notes.get(SPEC_NOTE_ID, id).catch(() => null),
        ]);
      const [response, specNote]: Awaited<ReturnType<typeof fetchSlimListAndSpec>> = yield* call(
        fetchSlimListAndSpec,
        workspaceId,
      );
      if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
      const loadedNotes = response.map((note) =>
        specNote && String(note.id) === SPEC_NOTE_ID
          ? toRuntimeNote(specNote)
          : toRuntimeNote(note),
      );
      yield* put(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: loadedNotes }));
      const spec = loadedNotes.find((note) => String(note.id) === SPEC_NOTE_ID);
      if (spec) yield* put(selectNote(workspaceId, String(spec.id)));
    } catch (error) {
      if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
      logger.error('Failed to hydrate workspace notes', error);
      yield* put(
        loadWorkspaceNotesFailed(
          [workspaceId],
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  function* applyNoteEvent(workspaceId: string, noteId: string, eventType: NoteEventType) {
    try {
      const request = readNoteRequested(workspaceId, noteId, eventType);
      yield* put(request);
      yield* call(() => request.promise);
    } catch (error) {
      logger.error('Failed to apply note event', error);
    }
  }

  function* readNoteWorker(
    coordinator: ReadCoordinator,
    action: ReturnType<typeof readNoteRequested>,
  ) {
    const [workspaceId, noteId, eventType] = action.payload;
    let settled = false;
    try {
      const authority = yield* selectPrincipalConnectionContext.effect();
      if (!authority) {
        yield* put(action.success(null));
        settled = true;
        return;
      }
      const slot = yield* call(admitNoteRead, coordinator, action, authority);
      const result = (yield* join(slot.task)) as ReadResult;
      if ('error' in result) throw result.error;
      const { note } = result;
      const authorityStillMatches =
        slot.authority === (yield* selectPrincipalConnectionContext.effect());
      if (note && authorityStillMatches && slot.leaderSeq === action.seq) {
        const existing = yield* selectNoteById.effect(workspaceId, noteId);
        if (eventType === 'note:created' && !existing) {
          yield* put(applyNoteCreated(workspaceId, note));
        } else {
          yield* put(applyNoteUpdated(workspaceId, noteId, note));
        }
      }
      yield* put(action.success(authorityStillMatches ? note : null));
      settled = true;
    } catch (error) {
      yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
      settled = true;
    } finally {
      if (!settled && (yield* cancelled())) {
        yield* put(action.failure(new Error(NOTE_READ_CANCELLED)));
      }
    }
  }

  function* noteContentViewWorker(
    action: ReturnType<typeof noteContentViewRequested | typeof noteContentViewReleased>,
  ) {
    if (action.type === noteContentViewReleased.type) return;
    const requestAction = action as ReturnType<typeof noteContentViewRequested>;
    const [consumerId, requestId, workspaceId, noteId] = requestAction.payload;
    const authority = yield* selectPrincipalConnectionContext.effect();
    try {
      const request = ensureNoteContentLoadedRequested(workspaceId, noteId);
      yield* put(request);
      const loaded = yield* call(() => request.promise);
      if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
      yield* put(
        noteContentViewFinished(
          workspaceId,
          consumerId,
          requestId,
          authority,
          loaded ? undefined : 'Unable to load note content',
        ),
      );
    } catch (error) {
      if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
      yield* put(
        noteContentViewFinished(
          workspaceId,
          consumerId,
          requestId,
          authority,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  function* ensureNoteContentWorker(action: ReturnType<typeof ensureNoteContentLoadedRequested>) {
    const [workspaceId, noteId] = action.payload;
    try {
      const cached = yield* selectNoteById.effect(workspaceId, noteId);
      if (!cached) {
        yield* put(action.success(false));
        return;
      }
      if (!isNoteContentStale(cached)) {
        yield* put(action.success(true));
        return;
      }
      const request = readNoteRequested(workspaceId, noteId);
      yield* put(request);
      const note = yield* call(() => request.promise);
      yield* put(action.success(note !== null && !isNoteContentStale(note)));
    } catch (error) {
      logger.error('Failed to load full note content', error);
      yield* put(action.success(false));
    }
  }

  function* listSlimNotesWorker(action: ReturnType<typeof listSlimNotesRequested>) {
    const [workspaceId] = action.payload;
    const authority = yield* selectPrincipalConnectionContext.effect();
    if (!authority) {
      yield* put(action.failure(new Error('Note list requires an admitted connection')));
      return;
    }
    try {
      const listedNotes = yield* call(() => notes.list(workspaceId, { projection: 'slim' }));
      if (authority !== (yield* selectPrincipalConnectionContext.effect())) {
        yield* put(action.failure(new Error('Note list authority changed')));
        return;
      }
      yield* put(action.success(listedNotes));
    } catch (error) {
      yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    }
  }

  function* hydrateWorkspaceNotesWorker(
    action: ReturnType<typeof workspaceNotesHydrationRequested>,
  ) {
    const [workspaceId, , force] = action.payload;
    if (!workspaceId) return;
    yield* race({
      hydrate: call(hydrateWorkspaceNotes, workspaceId, force),
      cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
    });
  }

  function* applyNoteEventWorker(action: ReturnType<typeof refreshNoteFromEventRequested>) {
    const [workspaceId, noteId, eventType] = action.payload;
    if (!workspaceId || !noteId || eventType === 'note:deleted') return;
    yield* race({
      apply: call(applyNoteEvent, workspaceId, noteId, eventType),
      cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
    });
  }

  function* routeNoteEventWorker(action: ReturnType<typeof noteEventReceived>) {
    const [workspaceId, noteId, eventType] = action.payload;
    if (!workspaceId || !noteId) return;
    if (eventType === 'note:deleted') {
      yield* put(applyNoteDeleted(workspaceId, noteId));
    }
    yield* put(refreshNoteFromEventRequested(workspaceId, noteId, eventType));
  }

  return function* notesContentReadSaga() {
    const coordinator: ReadCoordinator = { admissions: new Map(), nextGeneration: 0 };
    yield* takeEvery(readNoteRequested, readNoteWorker, coordinator);
    yield* takeEvery(ensureNoteContentLoadedRequested, ensureNoteContentWorker);
    yield* takeEvery(listSlimNotesRequested, listSlimNotesWorker);
    yield* takeLatestInContext(
      [noteContentViewRequested, noteContentViewReleased],
      (action) =>
        action.type === noteContentViewReleased.type ? action.payload[1] : action.payload[0],
      noteContentViewWorker,
    );
    yield* takeLatestByContext(
      workspaceNotesHydrationRequested,
      (action) => ({ context: action.payload[0], generation: action.payload[1] }),
      hydrateWorkspaceNotesWorker,
    );
    yield* takeEvery(noteEventReceived, routeNoteEventWorker);
    yield* takeEvery(refreshNoteFromEventRequested, applyNoteEventWorker);
  };
}
