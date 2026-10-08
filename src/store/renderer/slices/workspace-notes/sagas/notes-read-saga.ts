import {
  captureNotePublicationOwner,
  isNotePublicationOwnerCurrent,
  isNotePublicationLifetimeCurrent,
} from './note-publication-owner';
import { buffers } from 'redux-saga';
import { ownedActionChannel } from '$store/renderer/utils/owned-action-channel';
import {
  hasFullNoteEditLease,
  isFullNoteEditLeaseCurrent,
  invalidateFullNoteEditLeases,
} from '../note-full-edit-lease';
import { isMissingNote } from '$lib/client/note-page-errors';
import { isNoteContentStale } from '$shared/utils/note-content';
import { pageReset } from '../../note-pages/note-pages-slice';
import { selectNotePageSession } from '../../note-pages/note-pages-selectors';
import { call, cancelled, put, race, take, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { replaceNoteCommentsAction } from '../../comments/comments-slice';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import {
  workspaceUnmounted,
  backendReconnected,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  takeLatestByContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import {
  selectNoteById,
  selectWorkspaceNotesState,
  selectRetainedNoteDraft,
  selectHasPendingNoteContent,
} from '../workspace-notes-selectors';
import {
  applyNoteCreated,
  applyLocalNoteUpdate,
  loadFullNoteEditRequested,
  fullNoteEditReleased,
  applyNoteDeleted,
  applyNoteUpdated,
  commentEventReceived,
  ensureNoteContentLoadedRequested,
  loadNoteCommentsRequested,
  loadWorkspaceNotesFailed,
  setWorkspaceNotesLoading,
  loadWorkspaceNotesSucceeded,
  noteEventReceived,
  readNoteRequested,
  refreshNoteFromEventRequested,
  searchNotesRequested,
  selectNote,
  specTaskLinksReceived,
  workspaceNotesHydrationRequested,
  type NoteEventType,
} from '../workspace-notes-slice';
import { toRuntimeNote } from './note-payload-mappers';

const logger = createLogger('NotesReadSaga');

type ObservedAction = { type: string; payload?: unknown };
const latestNoteReadSeq = new Map<string, number>();

function clearWorkspaceNoteReadSeq(action: ReturnType<typeof workspaceUnmounted>) {
  const [workspaceId] = action.payload;
  invalidateFullNoteEditLeases(workspaceId);
  for (const key of latestNoteReadSeq.keys()) {
    if (key.startsWith(`${workspaceId}:`)) latestNoteReadSeq.delete(key);
  }
}

function isWorkspaceCleanup(action: ObservedAction, workspaceId: string): boolean {
  return (
    action.type === backendReconnected.type ||
    (action.type === workspaceUnmounted.type &&
      Array.isArray(action.payload) &&
      action.payload[0] === workspaceId)
  );
}

function isDeletedNote(action: ObservedAction, workspaceId: string, noteId: string): boolean {
  return (
    action.type === applyNoteDeleted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId &&
    action.payload[1] === noteId
  );
}

function* hydrateWorkspaceNotes(workspaceId: string, force = false) {
  const current = yield* selectWorkspaceNotesState.effect(workspaceId);
  if (current.loading || (!force && current.initialized)) return;
  const publicationOwner = yield* captureNotePublicationOwner(workspaceId);
  try {
    const fetchSlimListAndLinks = async (id: string) => {
      const [rows, links] = await Promise.all([
        appClient.notes.list(id, { projection: 'slim' }),
        (appClient.notes.listTaskLinks?.(id, SPEC_NOTE_ID) ?? Promise.resolve(null)).catch(
          (error) => {
            if (isMissingNote(error)) return [];
            throw error;
          },
        ),
      ]);
      // Viewing never hydrates a complete body as an unsupported-capability fallback.
      return { rows, links };
    };
    const { rows, links } = yield* call(fetchSlimListAndLinks, workspaceId);
    const latest = yield* selectWorkspaceNotesState.effect(workspaceId);
    if (!(yield* isNotePublicationOwnerCurrent(publicationOwner))) {
      if (yield* isNotePublicationLifetimeCurrent(publicationOwner))
        yield* put(setWorkspaceNotesLoading([workspaceId], false));
      return;
    }
    const summaryCurrent = latest.specTaskLinksGeneration === current.specTaskLinksGeneration;
    const acceptedRows = summaryCurrent
      ? rows
      : rows.flatMap((n) => {
          if (String(n.id) !== SPEC_NOTE_ID) return [n];
          if (latest.specDeleted) return [];
          return [latest.notes.map[SPEC_NOTE_ID] ?? n];
        });
    const notes = acceptedRows.map(toRuntimeNote);
    if (links !== null || current.specTaskLinks !== null)
      yield* put(specTaskLinksReceived(workspaceId, links, current.specTaskLinksGeneration));
    yield* put(
      loadWorkspaceNotesSucceeded(
        [workspaceId],
        { [workspaceId]: notes },
        ...(current.deleteReadAuthority
          ? ([{ [workspaceId]: current.deleteReadAuthority }] as const)
          : ([] as const)),
      ),
    );
    const spec = notes.find((note) => String(note.id) === SPEC_NOTE_ID);
    if (spec) yield* put(selectNote(workspaceId, String(spec.id)));
  } catch (error) {
    if (!(yield* isNotePublicationOwnerCurrent(publicationOwner))) return;
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
  const owner = yield* selectWorkspaceNotesState.effect(workspaceId);
  if (noteId === SPEC_NOTE_ID && eventType !== 'note:deleted' && appClient.notes.listTaskLinks) {
    try {
      const links = yield* call(
        [appClient.notes, appClient.notes.listTaskLinks],
        workspaceId,
        noteId,
      );
      if (links !== null) {
        yield* put(specTaskLinksReceived(workspaceId, links, owner.specTaskLinksGeneration));
        const latest = yield* selectWorkspaceNotesState.effect(workspaceId);
        if (latest.specTaskLinksGeneration !== owner.specTaskLinksGeneration) return;
        const complete = yield* selectNoteById.effect(workspaceId, noteId);
        if (!complete || isNoteContentStale(complete)) return;
      }
    } catch (error) {
      if (isMissingNote(error))
        yield* put(specTaskLinksReceived(workspaceId, [], owner.specTaskLinksGeneration));
      else logger.error('Failed to refresh task links', error);
      return;
    }
  }
  const paged = yield* selectNotePageSession.effect(workspaceId, noteId);
  if (paged && Object.keys(paged.panels).length && !hasFullNoteEditLease(workspaceId, noteId)) {
    // The bounded state subscription is authoritative; legacy events contain no page epochs.
    if (eventType === 'note:deleted') yield* put(pageReset(workspaceId, noteId, 'Note deleted'));
    return;
  }
  if (eventType === 'note:deleted') {
    yield* put(applyNoteDeleted(workspaceId, noteId));
    return;
  }
  try {
    const request = readNoteRequested(workspaceId, noteId, eventType);
    yield* put(request);
    yield* call(() => request.promise);
  } catch (error) {
    logger.error('Failed to apply note event', error);
  }
}

function* blocksFullRead(workspaceId: string, noteId: string) {
  const paged = yield* selectNotePageSession.effect(workspaceId, noteId);
  return (
    !!paged && Object.keys(paged.panels).length > 0 && !hasFullNoteEditLease(workspaceId, noteId)
  );
}

function isReleasedEdit(
  action: ObservedAction,
  workspaceId: string,
  noteId: string,
  leaseId: number,
): boolean {
  return (
    action.type === fullNoteEditReleased.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId &&
    action.payload[1] === noteId &&
    action.payload[2] === leaseId
  );
}

function* loadFullNoteEditWorker(action: ReturnType<typeof loadFullNoteEditRequested>) {
  const [workspaceId, noteId, leaseId] = action.payload;
  const current = () => isFullNoteEditLeaseCurrent(workspaceId, noteId, leaseId);
  const publicationOwner = yield* captureNotePublicationOwner(workspaceId);
  const readAuthority = publicationOwner.readAuthority;
  const ended = yield* ownedActionChannel(
    [
      backendReconnected.type,
      workspaceUnmounted.type,
      applyNoteDeleted.type,
      fullNoteEditReleased.type,
    ],
    (a: ObservedAction) =>
      isWorkspaceCleanup(a, workspaceId) ||
      isDeletedNote(a, workspaceId, noteId) ||
      isReleasedEdit(a, workspaceId, noteId, leaseId),
    buffers.sliding(1),
  );
  try {
    if (!current()) {
      yield* put(action.success(false));
      return;
    }
    const retained = yield* selectRetainedNoteDraft.effect(workspaceId, noteId);
    const existing = yield* selectNoteById.effect(workspaceId, noteId);
    if (retained?.error && existing) {
      yield* put(
        applyLocalNoteUpdate(workspaceId, noteId, {
          content: retained.content,
          contentLength: undefined,
          contentPreview: undefined,
        }),
      );
      yield* put(action.success(true));
      return;
    }
    const { found, cleanup } = yield* race({
      found: call([appClient.notes, appClient.notes.get], noteId, workspaceId),
      cleanup: take(ended),
    });
    const cached = yield* selectNoteById.effect(workspaceId, noteId);
    const pending = yield* selectHasPendingNoteContent.effect(workspaceId, noteId);
    if (
      cleanup ||
      !(yield* isNotePublicationOwnerCurrent(publicationOwner)) ||
      !current() ||
      !found ||
      String(found.id) !== noteId ||
      String(found.workspaceId) !== workspaceId ||
      isNoteContentStale(found) ||
      !Number.isSafeInteger(found.rev) ||
      found.rev === undefined ||
      found.rev < 0 ||
      pending ||
      !cached ||
      (cached.rev !== undefined && found.rev < cached.rev)
    ) {
      yield* put(action.success(false));
      return;
    }
    yield* put(
      applyNoteUpdated(
        workspaceId,
        noteId,
        toRuntimeNote(found),
        ...(readAuthority ? ([readAuthority] as const) : ([] as const)),
      ),
    );
    yield* put(action.success(current()));
  } catch (error) {
    logger.error('Failed to load complete note for editing', error);
    yield* put(action.success(false));
  } finally {
    ended.close();
    if (yield* cancelled()) yield* put(action.success(false));
  }
}

function* readNoteWorker(action: ReturnType<typeof readNoteRequested>) {
  const [workspaceId, noteId, eventType] = action.payload;
  const key = `${workspaceId}:${noteId}`;
  const publicationOwner = yield* captureNotePublicationOwner(workspaceId);
  const readAuthority = publicationOwner.readAuthority;
  latestNoteReadSeq.set(key, Math.max(latestNoteReadSeq.get(key) ?? 0, action.seq));
  try {
    if (yield* call(blocksFullRead, workspaceId, noteId)) {
      yield* put(action.success(null));
      return;
    }
    const { found, cleanup } = yield* race({
      found: call([appClient.notes, appClient.notes.get], noteId, workspaceId),
      cleanup: take(
        (candidate: ObservedAction) =>
          isWorkspaceCleanup(candidate, workspaceId) ||
          isDeletedNote(candidate, workspaceId, noteId),
      ),
    });
    const note =
      !cleanup &&
      (yield* isNotePublicationOwnerCurrent(publicationOwner)) &&
      found &&
      String(found.id) === noteId &&
      String(found.workspaceId) === workspaceId &&
      !(yield* call(blocksFullRead, workspaceId, noteId))
        ? toRuntimeNote(found)
        : null;
    if (note && latestNoteReadSeq.get(key) === action.seq) {
      const existing = yield* selectNoteById.effect(workspaceId, noteId);
      if (eventType === 'note:created' && !existing) {
        yield* put(
          applyNoteCreated(
            workspaceId,
            note,
            ...(readAuthority ? ([readAuthority] as const) : ([] as const)),
          ),
        );
      } else {
        yield* put(
          applyNoteUpdated(
            workspaceId,
            noteId,
            note,
            ...(readAuthority ? ([readAuthority] as const) : ([] as const)),
          ),
        );
      }
    }
    yield* put(action.success(note));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* ensureNoteContentWorker(action: ReturnType<typeof ensureNoteContentLoadedRequested>) {
  const [workspaceId, noteId] = action.payload;
  try {
    const cached = yield* selectNoteById.effect(workspaceId, noteId);
    if (!cached || (yield* call(blocksFullRead, workspaceId, noteId))) {
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

function* loadNoteComments(workspaceId: string, noteId: string, apply = true) {
  const before = yield* selectNotePageSession.effect(workspaceId, noteId);
  if (before && before.status !== 'legacy' && Object.keys(before.panels).length) return [];
  const comments: Awaited<ReturnType<typeof appClient.comments.list>> = yield* call(
    [appClient.comments, appClient.comments.list],
    noteId,
    workspaceId,
  );
  const after = yield* selectNotePageSession.effect(workspaceId, noteId);
  if (after && after.status !== 'legacy' && Object.keys(after.panels).length) return [];
  if (apply) yield* put(replaceNoteCommentsAction(workspaceId, noteId, comments));
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

function* applyCommentEventWorker(action: ReturnType<typeof commentEventReceived>) {
  const [workspaceId, noteId] = action.payload;
  if (!workspaceId || !noteId) return;
  try {
    yield* call(loadNoteComments, workspaceId, noteId);
  } catch (error) {
    logger.error('Failed to apply comment event', error);
  }
}

function* hydrateWorkspaceNotesWorker(action: ReturnType<typeof workspaceNotesHydrationRequested>) {
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
    cleanup: take(
      (cleanup: ObservedAction) =>
        isWorkspaceCleanup(cleanup, workspaceId) || isDeletedNote(cleanup, workspaceId, noteId),
    ),
  });
}

function* routeNoteEventWorker(action: ReturnType<typeof noteEventReceived>) {
  const [workspaceId, noteId, eventType] = action.payload;
  if (!workspaceId || !noteId) return;
  if (eventType === 'note:deleted') {
    latestNoteReadSeq.delete(`${workspaceId}:${noteId}`);
    yield* put(applyNoteDeleted(workspaceId, noteId));
    const paged = yield* selectNotePageSession.effect(workspaceId, noteId);
    if (paged && Object.keys(paged.panels).length)
      yield* put(pageReset(workspaceId, noteId, 'Note deleted'));
  }
  yield* put(refreshNoteFromEventRequested(workspaceId, noteId, eventType));
}

export function* notesReadSaga() {
  yield* takeEvery(backendReconnected, function* () {
    invalidateFullNoteEditLeases();
    latestNoteReadSeq.clear();
  });
  yield* takeEvery(workspaceUnmounted, clearWorkspaceNoteReadSeq);
  yield* takeEvery(applyNoteDeleted, function* (action) {
    const [workspaceId, noteId] = action.payload;
    invalidateFullNoteEditLeases(workspaceId, noteId);
  });
  yield* takeEvery(readNoteRequested, readNoteWorker);
  yield* takeEvery(loadFullNoteEditRequested, loadFullNoteEditWorker);
  yield* takeEvery(ensureNoteContentLoadedRequested, ensureNoteContentWorker);
  yield* takeEvery(searchNotesRequested, searchNotesWorker);
  yield* takeEvery(loadNoteCommentsRequested, loadNoteCommentsWorker);
  yield* takeLatestByContext(
    workspaceNotesHydrationRequested,
    (action) => ({ context: action.payload[0], generation: action.payload[1] }),
    hydrateWorkspaceNotesWorker,
  );
  yield* takeEvery(noteEventReceived, routeNoteEventWorker);
  yield* takeSingleFlightInContext(
    refreshNoteFromEventRequested,
    (action) => {
      const context = `${action.payload[0]}:${action.payload[1]}`;
      return action.payload[2] === 'note:deleted' ? { context, cancel: true } : context;
    },
    applyNoteEventWorker,
  );
  yield* takeSingleFlightInContext(
    commentEventReceived,
    (action) => `${action.payload[0]}:${action.payload[1]}`,
    applyCommentEventWorker,
  );
}
