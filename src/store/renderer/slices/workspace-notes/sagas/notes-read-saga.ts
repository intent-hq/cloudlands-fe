import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { runRecoveryRead } from '$lib/client/live/recovery-read-queue';
import { buffers, eventChannel, type EventChannel, type Task } from 'redux-saga';
import {
  actionChannel,
  setContext,
  getContext,
  call,
  cancelled,
  delay,
  flush,
  fork,
  join,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { store as appStore } from '../../../store';
import type { RendererStoreBridge } from '../../../renderer-store-bridge';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { installNoteRecoveryDispatcher, type NoteRecoveryEventJob } from './note-event-receipt';
import {
  getRecoveryAdmission,
  getRecoveryLifetime,
  withRecoveryLifetime,
} from '../../../middlewares/event-recovery';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import {
  notesRecoveryKey,
  commentsRecoveryKey,
  commitNoteAction,
  notesRecoverySaga,
  ensureNotesRecovery,
  ensureCommentsRecovery,
  attributionRecoveryKey,
  attributionEventRecoveryKey,
  ensureAttributionRecovery,
  NOTE_RECOVERY_STORE,
} from './notes-recovery';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { isNoteContentStale } from '$shared/utils/note-content';
import {
  commentLoadFinished,
  commentLoadReleased,
  commentLoadRequested,
  replaceNoteCommentsAction,
} from '../../comments/comments-slice';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import {
  paletteNoteSearchAuthorityCaptured,
  paletteNoteSearchFinished,
  paletteNoteSearchRequested,
} from '../../palette/palette-slice';
import type { PaletteNoteSearchUpdate } from '../../palette/palette-types';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  takeLatestInContext,
  takeLatestByContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import {
  selectHasVisibleNoteContent,
  selectNoteById,
  selectWorkspaceNotesState,
} from '../workspace-notes-selectors';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  commentEventReceived,
  ensureNoteContentLoadedRequested,
  listSlimNotesRequested,
  loadNoteCommentsRequested,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  noteEventReceived,
  noteMetadataPushed,
  noteContentInvalidated,
  noteContentReadApplied,
  noteAttributionInvalidated,
  noteAttributionViewFinished,
  noteAttributionViewReleased,
  noteAttributionViewRequested,
  noteContentViewFinished,
  noteContentViewReleased,
  noteContentViewRequested,
  notePresenceViewReleased,
  notePresenceViewRequested,
  notePresenceViewersReceived,
  noteWorkspaceRootFinished,
  noteWorkspaceRootReleased,
  noteWorkspaceRootRequested,
  readNoteRequested,
  refreshNoteFromEventRequested,
  searchNotesRequested,
  selectNote,
  workspaceNotesHydrationRequested,
  type NoteEventType,
} from '../workspace-notes-slice';
import {
  joinNotePresence,
  registerOwnedNotePresenceSession,
  type NotePresenceSession,
  type RemoteNoteViewer,
} from '$features/notes/note-presence/note-presence-service';
import type { Note } from '$shared/types';
import type { NotePresenceViewer } from '../workspace-notes-types';
import { takeEveryFromListenSync } from '../../../utils/ipc-channel';
import { toRuntimeNote } from './note-payload-mappers';
import { adaptNoteSearchResponse } from '$lib/utils/palette-note-search';

const logger = createLogger('NotesReadSaga');

type ObservedAction = { type: string; payload?: unknown };
type AttributionInvalidationAction = { type: string; payload?: [string, string] };
type ReadAction = ReturnType<typeof readNoteRequested>;
type ReadResult =
  { note: ReturnType<typeof toRuntimeNote> | null; contentGeneration?: number } | { error: Error };
type ReadSlot = {
  generation: number;
  task: Task;
  leaderSeq: number;
  eventType?: NoteEventType;
  authority: string | null;
  lifetime: RecoveryLifetime;
};
type ReadAdmission = { current?: ReadSlot; trailing?: ReadSlot };
type ReadCoordinator = {
  admissions: Map<string, ReadAdmission>;
  nextGeneration: number;
};

const NOTE_READ_CANCELLED = 'Note read cancelled';
const PALETTE_NOTE_SEARCH_DEBOUNCE_MS = 150;

function getWorkspaceRoot(workspaceId: string): Promise<string | null> {
  return invoke<string | null>('workspace:get-root', { workspaceId });
}

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
  lifetime: RecoveryLifetime,
  after?: Task,
  visibleOnly = false,
): SagaGenerator<ReadResult> {
  const store = yield* getContext<RendererStoreBridge>(NOTE_RECOVERY_STORE);
  try {
    if (!lifetime.commit(() => undefined)) return { note: null };
    if (after) {
      const { cleanup } = yield* race({
        previous: join(after),
        cleanup: take((action: ObservedAction) => isNoteReadCleanup(action, workspaceId, noteId)),
      });
      if (cleanup) return { note: null };
    }
    if (!lifetime.commit(() => undefined)) return { note: null };
    if (visibleOnly && !(yield* selectHasVisibleNoteContent.effect(workspaceId, noteId)))
      return { note: null };
    const contentGeneration =
      (yield* selectWorkspaceNotesState.effect(workspaceId)).staleContentByNoteId[noteId] ?? 0;
    const { found, cleanup } = yield* race({
      found: call(() =>
        runRecoveryRead(
          notesRecoveryKey(workspaceId),
          lifetime,
          'ordinary',
          `get:${noteId}`,
          () =>
            visibleOnly && !selectHasVisibleNoteContent.select(store.state, workspaceId, noteId)
              ? Promise.resolve(null)
              : appClient.notes.get(noteId, workspaceId),
          { retireOnNotFound: false },
        ),
      ),
      cleanup: take((action: ObservedAction) => isNoteReadCleanup(action, workspaceId, noteId)),
    });
    if (cleanup || !found) return { note: null };
    if (String(found.workspaceId) !== workspaceId || String(found.id) !== noteId) {
      return { note: null };
    }
    return { note: toRuntimeNote(found), contentGeneration };
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
  const lifetime =
    getRecoveryLifetime(action) ?? rendererEventRecovery.capture(notesRecoveryKey(workspaceId));
  const task = yield* fork(
    fetchNoteSlot,
    coordinator,
    key,
    workspaceId,
    noteId,
    generation,
    lifetime,
    after,
    !!action.payload[2],
  );
  return {
    generation,
    task,
    leaderSeq: action.seq,
    eventType: action.payload[2],
    authority,
    lifetime,
  };
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
  if (!admission.trailing || !admission.trailing.lifetime.commit(() => undefined)) {
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

function* hydrateWorkspaceNotes(workspaceId: string, force = false, generation = 0) {
  const store = yield* getContext<RendererStoreBridge>(NOTE_RECOVERY_STORE);
  ensureNotesRecovery(store, workspaceId);
  const current = yield* selectWorkspaceNotesState.effect(workspaceId);
  if (current.loading || (!force && current.initialized)) return;
  const lifetime = rendererEventRecovery.capture(notesRecoveryKey(workspaceId));
  const authority = rendererEventRecovery.captureAuthority(notesRecoveryKey(workspaceId));
  if (!lifetime.commit(() => undefined)) return;
  const mutations = yield* actionChannel(
    [applyNoteDeleted, noteMetadataPushed],
    buffers.expanding<ReturnType<typeof applyNoteDeleted | typeof noteMetadataPushed>>(),
  );
  try {
    // Slim projection (§5.2): the initial hydrate does not need full bodies —
    // sidebar surfaces read titles/tags/metadata, and slim rows carry
    // contentPreview/contentLength. The spec is the one structural exception
    // (task links, ordering), so fetch it full alongside the slim list.
    // The spec fetch is fail-soft: a workspace without a spec note must not
    // fail the hydrate (its slim row, if any, is kept as-is).
    const fetchSlimListAndSpec = (id: string) =>
      Promise.all([
        runRecoveryRead(notesRecoveryKey(id), lifetime, 'ordinary', `list:slim:${generation}`, () =>
          appClient.notes.list(id, { projection: 'slim' }),
        ),
        runRecoveryRead(
          notesRecoveryKey(id),
          lifetime,
          'ordinary',
          `get:${SPEC_NOTE_ID}:hydrate:${generation}`,
          () => appClient.notes.get(SPEC_NOTE_ID, id),
          { retireOnNotFound: false },
        ).catch(() => null),
      ]);
    const [response, specNote]: Awaited<ReturnType<typeof fetchSlimListAndSpec>> = yield* call(
      fetchSlimListAndSpec,
      workspaceId,
    );
    let notes = response.map((note) =>
      specNote && String(note.id) === SPEC_NOTE_ID ? toRuntimeNote(specNote) : toRuntimeNote(note),
    );
    // Pushes and local edits received during hydration win over its older snapshot.
    const latest = yield* selectWorkspaceNotesState.effect(workspaceId);
    const before = new Map(getItems(current.notes).map((note) => [String(note.id), note]));
    const after = new Map(getItems(latest.notes).map((note) => [String(note.id), note]));
    const rows = new Map(notes.map((note) => [String(note.id), note]));
    for (const [id, note] of after) {
      if (note !== before.get(id) || latest.pendingContentByNoteId[id]) rows.set(id, note);
    }
    for (const id of before.keys()) if (!after.has(id)) rows.delete(id);
    for (const mutation of yield* flush(mutations)) {
      if (mutation.payload[0] !== workspaceId) continue;
      if (mutation.type === applyNoteDeleted.type) rows.delete(mutation.payload[1] as string);
      else {
        const id = String((mutation.payload[1] as Omit<Note, 'content'>).id);
        const latestNote = after.get(id);
        if (latestNote) rows.set(id, latestNote);
      }
    }
    notes = [...rows.values()];
    if (
      !(yield* commitNoteAction(
        lifetime,
        loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }),
      ))
    ) {
      // A partial push cannot stand in for a whole-workspace snapshot. Keep
      // convergence in the shared bounded recovery lane, under the original owner.
      authority.commit(() => {
        rendererEventRecovery.invalidate(notesRecoveryKey(workspaceId));
      });
      return;
    }
    const hydrated = yield* selectWorkspaceNotesState.effect(workspaceId);
    for (const view of getItems(latest.contentViews)) {
      const note = yield* selectNoteById.effect(workspaceId, view.noteId);
      if (note && (isNoteContentStale(note) || hydrated.staleContentByNoteId[view.noteId])) {
        yield* commitNoteAction(
          authority,
          noteContentViewRequested(view.consumerId, view.requestId, workspaceId, view.noteId),
        );
      }
    }
    const spec = notes.find((note) => String(note.id) === SPEC_NOTE_ID);
    if (spec) yield* commitNoteAction(authority, selectNote(workspaceId, String(spec.id)));
  } catch (error) {
    logger.error('Failed to hydrate workspace notes', error);
    yield* commitNoteAction(
      lifetime,
      loadWorkspaceNotesFailed(
        [workspaceId],
        error instanceof Error ? error.message : String(error),
      ),
    );
  } finally {
    mutations.close();
  }
}

function* applyNoteEvent(
  workspaceId: string,
  noteId: string,
  eventType: NoteEventType,
  lifetime?: RecoveryLifetime,
) {
  try {
    const request = readNoteRequested(workspaceId, noteId, eventType);
    if (lifetime) {
      if (!lifetime.commit(() => undefined)) return;
      withRecoveryLifetime(request, lifetime);
    }
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
    const admission = getRecoveryAdmission(action, notesRecoveryKey(workspaceId));
    if (admission === null) {
      yield* put(action.success(null));
      settled = true;
      return;
    }
    if (admission) withRecoveryLifetime(action, admission);
    const authority = yield* selectPrincipalConnectionContext.effect();
    const slot = yield* call(admitNoteRead, coordinator, action, authority);
    const result = (yield* join(slot.task)) as ReadResult;
    if ('error' in result) throw result.error;
    let { note } = result;
    const authorityStillMatches =
      slot.authority === (yield* selectPrincipalConnectionContext.effect());
    if (note && authorityStillMatches && slot.leaderSeq === action.seq) {
      const existing = yield* selectNoteById.effect(workspaceId, noteId);
      if (eventType === 'note:created' && !existing) {
        if (!(yield* commitNoteAction(slot.lifetime, applyNoteCreated(workspaceId, note))))
          note = null;
      } else {
        if (!(yield* commitNoteAction(slot.lifetime, applyNoteUpdated(workspaceId, noteId, note))))
          note = null;
      }
      if (
        note &&
        (note.rev === undefined || existing?.rev === undefined || note.rev >= existing.rev)
      ) {
        yield* commitNoteAction(
          slot.lifetime,
          noteContentReadApplied(workspaceId, noteId, result.contentGeneration ?? 0),
        );
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

function* noteWorkspaceRootWorker(
  action: ReturnType<typeof noteWorkspaceRootRequested | typeof noteWorkspaceRootReleased>,
) {
  if (action.type === noteWorkspaceRootReleased.type) return;
  const requestAction = action as ReturnType<typeof noteWorkspaceRootRequested>;
  const [consumerId, requestId, workspaceId] = requestAction.payload;
  const authority = yield* selectPrincipalConnectionContext.effect();
  try {
    const path = yield* call(getWorkspaceRoot, workspaceId);
    if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
    yield* put(noteWorkspaceRootFinished(workspaceId, consumerId, requestId, authority, path));
  } catch (error) {
    if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
    yield* put(
      noteWorkspaceRootFinished(
        workspaceId,
        consumerId,
        requestId,
        authority,
        null,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

function projectPresenceViewers(viewers: RemoteNoteViewer[]): NotePresenceViewer[] {
  return viewers.map(({ principalId, login, displayName, avatarUrl, cursor, cursorSeenAt }) => ({
    principalId,
    login: login ?? null,
    displayName: displayName ?? null,
    avatarUrl: avatarUrl ?? null,
    cursor,
    cursorSeenAt,
  }));
}

function createNotePresenceChannel(session: NotePresenceSession): EventChannel<RemoteNoteViewer[]> {
  return eventChannel<RemoteNoteViewer[]>(
    (emit) => session.subscribe(emit),
    buffers.sliding<RemoteNoteViewer[]>(1),
  );
}

function* notePresenceViewWorker(
  action: ReturnType<typeof notePresenceViewRequested | typeof notePresenceViewReleased>,
) {
  if (action.type === notePresenceViewReleased.type) return;
  const [consumerId, requestId, workspaceId, noteId] = action.payload as ReturnType<
    typeof notePresenceViewRequested
  >['payload'];
  const authority = yield* selectPrincipalConnectionContext.effect();
  const session: NotePresenceSession = yield* call(joinNotePresence, workspaceId, noteId);
  const unregisterOwned = registerOwnedNotePresenceSession(workspaceId, noteId, session);
  const channel = createNotePresenceChannel(session);
  try {
    yield* put(
      notePresenceViewersReceived(
        workspaceId,
        consumerId,
        requestId,
        authority,
        projectPresenceViewers(session.getViewers()),
      ),
    );
    while (true) {
      const viewers = yield* take(channel);
      if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
      yield* put(
        notePresenceViewersReceived(
          workspaceId,
          consumerId,
          requestId,
          authority,
          projectPresenceViewers(viewers),
        ),
      );
    }
  } finally {
    channel.close();
    unregisterOwned();
    session.release();
  }
}

function* noteAttributionViewWorker(
  action: ReturnType<typeof noteAttributionViewRequested | typeof noteAttributionViewReleased>,
) {
  if (action.type === noteAttributionViewReleased.type) return;
  const [consumerId, requestId, workspaceId, noteId] = action.payload as ReturnType<
    typeof noteAttributionViewRequested
  >['payload'];
  const authority = yield* selectPrincipalConnectionContext.effect();
  const store = yield* getContext<RendererStoreBridge>(NOTE_RECOVERY_STORE);
  ensureAttributionRecovery(store, consumerId, requestId, workspaceId, noteId);
  const invalidations = yield* actionChannel(
    (next: AttributionInvalidationAction) =>
      next.type === noteAttributionInvalidated.type &&
      next.payload?.[0] === workspaceId &&
      next.payload?.[1] === noteId,
    buffers.sliding(1),
  );
  let invalidation: AttributionInvalidationAction | undefined;
  try {
    while (true) {
      const key = attributionRecoveryKey(workspaceId, noteId);
      const admission = invalidation ? getRecoveryAdmission(invalidation, key) : undefined;
      const lifetime =
        admission !== undefined
          ? admission
          : ((invalidation && getRecoveryLifetime(invalidation)) ??
            rendererEventRecovery.capture(key));
      if (!lifetime?.commit(() => undefined)) {
        invalidation = yield* take(invalidations);
        continue;
      }
      try {
        const data = yield* call(() =>
          runRecoveryRead(
            attributionRecoveryKey(workspaceId, noteId),
            lifetime,
            'ordinary',
            'load',
            () => appClient.notes.lineAttribution.load(workspaceId, noteId),
          ),
        );
        if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
        const valid =
          data === null ||
          (String(data.workspaceId) === workspaceId && String(data.noteId) === noteId);
        yield* commitNoteAction(
          lifetime,
          noteAttributionViewFinished(
            consumerId,
            requestId,
            workspaceId,
            authority,
            valid ? data : null,
            valid ? undefined : 'Attribution response did not match the requested note',
          ),
        );
      } catch (error) {
        if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
        yield* commitNoteAction(
          lifetime,
          noteAttributionViewFinished(
            consumerId,
            requestId,
            workspaceId,
            authority,
            null,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
      // The channel is registered before each load so update events received while
      // it is pending produce exactly one trailing refresh rather than being lost.
      const buffered = yield* flush(invalidations);
      invalidation = buffered.length ? buffered[buffered.length - 1] : yield* take(invalidations);
    }
  } finally {
    invalidations.close();
  }
}

type LineAttributionUpdatedPayload = { workspaceId?: unknown; noteId?: unknown };

function admittedNoteEvent(action: object, key: string): RecoveryLifetime | null {
  const admitted = getRecoveryAdmission(action, key);
  if (admitted !== undefined) return admitted;
  const inherited = getRecoveryLifetime(action);
  if (inherited) return inherited;
  return rendererEventRecovery.push(key) ? rendererEventRecovery.capture(key) : null;
}

function* routeLineAttributionUpdated(payload: LineAttributionUpdatedPayload) {
  const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : '';
  const noteId = typeof payload.noteId === 'string' ? payload.noteId : '';
  const key = attributionEventRecoveryKey(payload);
  const lifetime = key ? admittedNoteEvent(payload, key) : null;
  if (lifetime)
    yield* commitNoteAction(
      lifetime,
      withRecoveryLifetime(noteAttributionInvalidated(workspaceId, noteId), lifetime),
    );
}

function* ensureNoteContentWorker(action: ReturnType<typeof ensureNoteContentLoadedRequested>) {
  const [workspaceId, noteId] = action.payload;
  const original = rendererEventRecovery.captureAuthority(notesRecoveryKey(workspaceId));
  try {
    const authority = yield* selectPrincipalConnectionContext.effect();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!original.commit(() => undefined)) {
        yield* put(action.success(false));
        return;
      }
      const cached = yield* selectNoteById.effect(workspaceId, noteId);
      const ws = yield* selectWorkspaceNotesState.effect(workspaceId);
      if (!cached) {
        yield* put(action.success(false));
        return;
      }
      if (!isNoteContentStale(cached) && !ws.staleContentByNoteId[noteId]) {
        yield* put(action.success(true));
        return;
      }
      // Reopening can join a read started before a hidden invalidation. Recheck
      // the applied cache, and share one fresh read only while still displayed.
      if (attempt > 0 && !(yield* selectHasVisibleNoteContent.effect(workspaceId, noteId))) {
        yield* put(action.success(false));
        return;
      }
      const request = readNoteRequested(workspaceId, noteId);
      yield* put(request);
      const note = yield* call(() => request.promise);
      if (
        !original.commit(() => undefined) ||
        !note ||
        authority !== (yield* selectPrincipalConnectionContext.effect())
      ) {
        yield* put(action.success(false));
        return;
      }
    }
    const current = yield* selectNoteById.effect(workspaceId, noteId);
    const ws = yield* selectWorkspaceNotesState.effect(workspaceId);
    yield* put(
      action.success(!!current && !isNoteContentStale(current) && !ws.staleContentByNoteId[noteId]),
    );
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
    const notes = yield* call(() => appClient.notes.list(workspaceId, { projection: 'slim' }));
    if (authority !== (yield* selectPrincipalConnectionContext.effect())) {
      yield* put(action.failure(new Error('Note list authority changed')));
      return;
    }
    yield* put(action.success(notes));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* searchNotesWorker(action: ReturnType<typeof searchNotesRequested>) {
  const [query, preferWorkspaceId] = action.payload;
  try {
    const response: unknown = yield* call(backendRequest, 'search.notes', {
      query,
      limit: 10,
      includeArchived: false,
      ...(preferWorkspaceId ? { preferWorkspaceId } : {}),
    });
    yield* put(action.success(response));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* paletteNoteSearchWorker(action: ReturnType<typeof paletteNoteSearchRequested>) {
  const [consumerId, requestId, query, preferWorkspaceId] = action.payload;
  let settled = false;
  let authority: string | null = null;
  const cancelledUpdate: PaletteNoteSearchUpdate = {
    items: [],
    loading: false,
    capability: 'unknown',
    fallback: true,
  };
  try {
    authority = yield* selectPrincipalConnectionContext.effect();
    yield* put(paletteNoteSearchAuthorityCaptured(consumerId, requestId, authority));
    if (!query.trim()) {
      yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, cancelledUpdate));
      yield* put(action.success(cancelledUpdate));
      settled = true;
      return;
    }
    yield* delay(PALETTE_NOTE_SEARCH_DEBOUNCE_MS);
    if ((yield* selectPrincipalConnectionContext.effect()) !== authority) {
      yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, cancelledUpdate));
      yield* put(action.success(cancelledUpdate));
      settled = true;
      return;
    }
    const response: unknown = yield* call(backendRequest, 'search.notes', {
      query,
      limit: 10,
      includeArchived: false,
      ...(preferWorkspaceId ? { preferWorkspaceId } : {}),
    });
    const update = adaptNoteSearchResponse(response, []);
    if ((yield* selectPrincipalConnectionContext.effect()) === authority) {
      yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, update));
    } else {
      yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, cancelledUpdate));
      yield* put(action.success(cancelledUpdate));
      settled = true;
      return;
    }
    yield* put(action.success(update));
    settled = true;
  } catch (error) {
    const update: PaletteNoteSearchUpdate = {
      ...cancelledUpdate,
      error: error instanceof Error ? error.message : String(error),
    };
    authority = yield* selectPrincipalConnectionContext.effect();
    yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, update));
    yield* put(action.success(update));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, cancelledUpdate));
      yield* put(action.success(cancelledUpdate));
    }
  }
}

function* loadNoteComments(
  workspaceId: string,
  noteId: string,
  apply = true,
  lifetime = rendererEventRecovery.capture(commentsRecoveryKey(workspaceId, noteId)),
) {
  const store = yield* getContext<RendererStoreBridge>(NOTE_RECOVERY_STORE);
  const authority = selectPrincipalConnectionContext.select(store.state);
  const consumers = getItems(store.state.comments.loadsByConsumer).filter(
    (view) =>
      view.workspaceId === workspaceId && view.noteId === noteId && view.status === 'loading',
  );
  if (!lifetime.commit(() => undefined)) return [];
  const comments = yield* call(() =>
    runRecoveryRead(commentsRecoveryKey(workspaceId, noteId), lifetime, 'ordinary', 'list', () =>
      appClient.comments.list(noteId, workspaceId),
    ),
  );
  if (
    apply &&
    !(yield* commitNoteAction(lifetime, replaceNoteCommentsAction(workspaceId, noteId, comments)))
  )
    return [];
  if (!lifetime.isCurrent()) return [];
  // A fresh event read may supersede the view's initial read. Settle only the
  // requests observed at admission; the reducer rejects released/replaced views.
  if (apply && authority === selectPrincipalConnectionContext.select(store.state)) {
    for (const view of consumers) {
      yield* commitNoteAction(
        lifetime,
        commentLoadFinished(view.consumerId, view.requestId, workspaceId, authority),
      );
    }
  }
  return comments;
}

function* loadNoteCommentsWorker(action: ReturnType<typeof loadNoteCommentsRequested>) {
  const [workspaceId, noteId] = action.payload;
  try {
    const comments = yield* call(loadNoteComments, workspaceId, noteId, false);
    yield* put(action.success(comments));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* commentLoadViewWorker(
  action: ReturnType<typeof commentLoadRequested | typeof commentLoadReleased>,
) {
  if (action.type === commentLoadReleased.type) return;
  const requestAction = action as ReturnType<typeof commentLoadRequested>;
  const [consumerId, requestId, workspaceId, noteId] = requestAction.payload;
  const store = yield* getContext<RendererStoreBridge>(NOTE_RECOVERY_STORE);
  ensureCommentsRecovery(store, consumerId, requestId, workspaceId, noteId);
  const lifetime = rendererEventRecovery.capture(commentsRecoveryKey(workspaceId, noteId));
  const authority = yield* selectPrincipalConnectionContext.effect();
  let settled = false;
  try {
    const comments = yield* call(loadNoteComments, workspaceId, noteId);
    if (authority !== (yield* selectPrincipalConnectionContext.effect())) {
      yield* put(requestAction.failure(new Error('Comment load authority changed')));
      settled = true;
      return;
    }
    yield* commitNoteAction(
      lifetime,
      commentLoadFinished(consumerId, requestId, workspaceId, authority),
    );
    yield* put(requestAction.success(comments));
    settled = true;
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (authority === (yield* selectPrincipalConnectionContext.effect())) {
      yield* commitNoteAction(
        lifetime,
        commentLoadFinished(consumerId, requestId, workspaceId, authority, normalized.message),
      );
    }
    yield* put(requestAction.failure(normalized));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(requestAction.failure(new Error('Comment load cancelled')));
    }
  }
}

function* applyCommentEventWorker(action: ReturnType<typeof commentEventReceived>) {
  const [workspaceId, noteId] = action.payload;
  if (!workspaceId || !noteId) return;
  const lifetime = admittedNoteEvent(action, commentsRecoveryKey(workspaceId, noteId));
  if (!lifetime?.commit(() => {})) return;
  try {
    yield* call(loadNoteComments, workspaceId, noteId, true, lifetime);
  } catch (error) {
    logger.error('Failed to apply comment event', error);
  }
}

function* hydrateWorkspaceNotesWorker(action: ReturnType<typeof workspaceNotesHydrationRequested>) {
  const [workspaceId, generation, force] = action.payload;
  if (!workspaceId) return;
  yield* race({
    hydrate: call(hydrateWorkspaceNotes, workspaceId, force, generation),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* applyNoteEventWorker(action: ReturnType<typeof refreshNoteFromEventRequested>) {
  const [workspaceId, noteId, eventType] = action.payload;
  if (!workspaceId || !noteId || eventType === 'note:deleted') return;
  const admission = getRecoveryAdmission(action, notesRecoveryKey(workspaceId));
  if (admission === null) return;
  if (!(yield* selectHasVisibleNoteContent.effect(workspaceId, noteId))) return;
  yield* race({
    apply: call(
      applyNoteEvent,
      workspaceId,
      noteId,
      eventType,
      getRecoveryLifetime(action) ?? admission,
    ),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* routeNoteEventWorker(action: ReturnType<typeof noteEventReceived>) {
  const [workspaceId, noteId, eventType] = action.payload;
  if (!workspaceId || !noteId) return;
  const lifetime = admittedNoteEvent(action, notesRecoveryKey(workspaceId));
  if (!lifetime) return;
  if (eventType === 'note:deleted') {
    yield* commitNoteAction(lifetime, applyNoteDeleted(workspaceId, noteId));
    return;
  }
  yield* commitNoteAction(lifetime, noteContentInvalidated(workspaceId, noteId));
  yield* commitNoteAction(
    lifetime,
    withRecoveryLifetime(refreshNoteFromEventRequested(workspaceId, noteId, eventType), lifetime),
  );
}

function* processAdmittedNote(
  action: ReturnType<typeof noteEventReceived | typeof commentEventReceived>,
) {
  if (action.type === commentEventReceived.type) {
    yield* call(applyCommentEventWorker, action as ReturnType<typeof commentEventReceived>);
    return;
  }
  const [workspaceId, noteId, eventType] = (action as ReturnType<typeof noteEventReceived>).payload;
  if (!workspaceId || !noteId) return;
  const lifetime = getRecoveryAdmission(action, notesRecoveryKey(workspaceId));
  if (!lifetime?.commit(() => undefined)) return;
  if (eventType === 'note:deleted') {
    yield* commitNoteAction(lifetime, applyNoteDeleted(workspaceId, noteId));
    return;
  }
  if (!(yield* commitNoteAction(lifetime, noteContentInvalidated(workspaceId, noteId)))) return;
  if (!(yield* selectHasVisibleNoteContent.effect(workspaceId, noteId))) return;
  const store = yield* getContext<RendererStoreBridge>(NOTE_RECOVERY_STORE);
  const contentGeneration =
    (yield* selectWorkspaceNotesState.effect(workspaceId)).staleContentByNoteId[noteId] ?? 0;
  const found = yield* call(() =>
    runRecoveryRead(
      notesRecoveryKey(workspaceId),
      lifetime,
      'ordinary',
      `get:${noteId}`,
      () =>
        selectHasVisibleNoteContent.select(store.state, workspaceId, noteId)
          ? appClient.notes.get(noteId, workspaceId)
          : Promise.resolve(null),
      { retireOnNotFound: false },
    ),
  );
  if (!found || String(found.workspaceId) !== workspaceId || String(found.id) !== noteId) return;
  const note = toRuntimeNote(found);
  const existing = yield* selectNoteById.effect(workspaceId, noteId);
  const applied = yield* commitNoteAction(
    lifetime,
    eventType === 'note:created' && !existing
      ? applyNoteCreated(workspaceId, note)
      : applyNoteUpdated(workspaceId, noteId, note),
  );
  if (
    applied &&
    (note.rev === undefined || existing?.rev === undefined || note.rev >= existing.rev)
  ) {
    yield* commitNoteAction(
      lifetime,
      noteContentReadApplied(workspaceId, noteId, contentGeneration),
    );
  }
}

function* processAdmittedAttribution(payload: LineAttributionUpdatedPayload) {
  const key = attributionEventRecoveryKey(payload);
  if (!key) return;
  const lifetime = getRecoveryAdmission(payload, key);
  if (!lifetime?.commit(() => undefined)) return;
  const workspaceId = String(payload.workspaceId);
  const noteId = String(payload.noteId);
  const store = yield* getContext<RendererStoreBridge>(NOTE_RECOVERY_STORE);
  const state = selectWorkspaceNotesState.select(store.state, workspaceId);
  const consumers = getItems(state.attributionViews).filter((view) => view.noteId === noteId);
  if (!consumers.length) return;
  const authority = selectPrincipalConnectionContext.select(store.state);
  let data: Awaited<ReturnType<typeof appClient.notes.lineAttribution.load>> = null;
  let error: string | undefined;
  try {
    data = yield* call(() =>
      runRecoveryRead(key, lifetime, 'ordinary', 'load', () =>
        appClient.notes.lineAttribution.load(workspaceId, noteId),
      ),
    );
    if (data && (String(data.workspaceId) !== workspaceId || String(data.noteId) !== noteId)) {
      data = null;
      error = 'Attribution response did not match the requested note';
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  if (authority !== selectPrincipalConnectionContext.select(store.state)) return;
  for (const view of consumers) {
    yield* commitNoteAction(
      lifetime,
      noteAttributionViewFinished(
        view.consumerId,
        view.requestId,
        workspaceId,
        authority,
        data,
        error,
      ),
    );
  }
}

function* processNoteRecoveryJob(job: NoteRecoveryEventJob) {
  const workspaceId = job.kind === 'note' ? job.action.payload[0] : job.payload.workspaceId;
  const noteId = job.kind === 'note' ? job.action.payload[1] : job.payload.noteId;
  const store = yield* getContext<RendererStoreBridge>(NOTE_RECOVERY_STORE);
  const isCleanup = (action: ObservedAction) => {
    if (typeof workspaceId !== 'string' || typeof noteId !== 'string') return false;
    if (isNoteReadCleanup(action, workspaceId, noteId)) return true;
    if (job.kind === 'attribution' && action.type === noteAttributionViewReleased.type) {
      return !getItems(
        selectWorkspaceNotesState.select(store.state, workspaceId).attributionViews,
      ).some((view) => view.noteId === noteId);
    }
    if (
      job.kind === 'note' &&
      job.action.type === commentEventReceived.type &&
      action.type === commentLoadReleased.type
    ) {
      return !getItems(store.state.comments.loadsByConsumer).some(
        (view) => view.workspaceId === workspaceId && view.noteId === noteId,
      );
    }
    return false;
  };
  try {
    yield* race({
      process:
        job.kind === 'note'
          ? call(processAdmittedNote, job.action)
          : call(processAdmittedAttribution, job.payload),
      aborted: call(() => job.aborted),
      cleanup: take(isCleanup),
    });
  } catch (error) {
    logger.error('Failed to process admitted note event', error);
  } finally {
    job.complete();
  }
}

function* noteRecoveryDispatcher() {
  const channel = eventChannel<NoteRecoveryEventJob>(
    (emit) => installNoteRecoveryDispatcher(emit),
    buffers.expanding(),
  );
  try {
    yield* takeEvery(channel, processNoteRecoveryJob);
    yield* take(() => false);
  } finally {
    channel.close();
  }
}

export function* notesReadSaga(store: RendererStoreBridge = appStore) {
  yield* setContext({ [NOTE_RECOVERY_STORE]: store });
  yield* fork(notesRecoverySaga, store);
  yield* fork(noteRecoveryDispatcher);
  const coordinator: ReadCoordinator = { admissions: new Map(), nextGeneration: 0 };
  yield* takeEvery(readNoteRequested, readNoteWorker, coordinator);
  yield* takeEvery(ensureNoteContentLoadedRequested, ensureNoteContentWorker);
  yield* takeEvery(listSlimNotesRequested, listSlimNotesWorker);
  yield* takeEvery(searchNotesRequested, searchNotesWorker);
  yield* takeLatestInContext(
    paletteNoteSearchRequested,
    (action) => action.payload[0],
    paletteNoteSearchWorker,
  );
  yield* takeEvery(loadNoteCommentsRequested, loadNoteCommentsWorker);
  yield* takeLatestInContext(
    [commentLoadRequested, commentLoadReleased],
    (action) => action.payload[0],
    commentLoadViewWorker,
  );
  yield* takeLatestInContext(
    [noteContentViewRequested, noteContentViewReleased],
    (action) =>
      action.type === noteContentViewReleased.type ? action.payload[1] : action.payload[0],
    noteContentViewWorker,
  );
  yield* takeLatestInContext(
    [noteWorkspaceRootRequested, noteWorkspaceRootReleased],
    (action) =>
      action.type === noteWorkspaceRootReleased.type ? action.payload[1] : action.payload[0],
    noteWorkspaceRootWorker,
  );
  yield* takeLatestInContext(
    [notePresenceViewRequested, notePresenceViewReleased],
    (action) =>
      action.type === notePresenceViewReleased.type ? action.payload[1] : action.payload[0],
    notePresenceViewWorker,
  );
  yield* takeLatestInContext(
    [noteAttributionViewRequested, noteAttributionViewReleased],
    (action) =>
      action.type === noteAttributionViewReleased.type ? action.payload[1] : action.payload[0],
    noteAttributionViewWorker,
  );
  yield* takeEveryFromListenSync<LineAttributionUpdatedPayload>(
    'line-attribution:updated',
    routeLineAttributionUpdated,
  );
  yield* takeLatestByContext(
    workspaceNotesHydrationRequested,
    (action) => ({ context: action.payload[0], generation: action.payload[1] }),
    hydrateWorkspaceNotesWorker,
  );
  yield* takeEvery(noteEventReceived, routeNoteEventWorker);
  yield* takeEvery(refreshNoteFromEventRequested, applyNoteEventWorker);
  yield* takeSingleFlightInContext(
    commentEventReceived,
    (action) => `${action.payload[0]}:${action.payload[1]}`,
    applyCommentEventWorker,
  );
}
