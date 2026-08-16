import { buffers, channel, type Channel } from 'redux-saga';
import {
  call,
  cancelled,
  flush,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { MutationResult, NoteMetadataPatch } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { ContentType, NoteVisibility } from '$shared/types';
import type { CreateNoteRequest, Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { toast } from 'svelte-sonner';
import {
  createNoteRequested,
  markNoteRead,
} from '../../note-read-tracking/note-read-tracking-slice';
import { openTab } from '../../panel-layout/panel-layout-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { withPreservedUnmetDependsOn } from '../workspace-notes-normalization';
import { selectNoteById, selectWorkspaceNotesState } from '../workspace-notes-selectors';
import { addOptimisticNote, applyLocalNoteUpdate, applyNoteCreated, applyNoteUpdated, createNote, loadWorkspaceNotesSucceeded, removeOptimisticNote, updateNote } from '../workspace-notes-slice';
import { toRuntimeNote } from './note-payload-mappers';

const logger = createLogger('NotesWriteSaga');
export const NOTE_CONTENT_SAVE_DEBOUNCE_MS = 800;

type PendingContent = { workspaceId: string; noteId: string; content: string };
type ContentCommand = PendingContent & { kind: 'content' };
type MetadataCommand = {
  kind: 'metadata';
  workspaceId: string;
  noteId: string;
  patch: NoteMetadataPatch;
  rollback: NoteMetadataPatch;
  titleOnly: boolean;
};
type DeleteCommand = { kind: 'delete'; workspaceId: string; noteId: string; snapshot?: Note };
type MutationCommand = ContentCommand | MetadataCommand | DeleteCommand;
type MutationEnvelope = { command: MutationCommand; completion?: Channel<boolean> };
type WorkspaceCleanupAction = ReturnType<typeof workspaceUnmounted>;
type ObservedAction = { type: string; payload?: unknown };

const pendingContent = new Map<string, PendingContent>();
let noteMutationQueue: Channel<MutationEnvelope> | undefined;

function noteKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}:${noteId}`;
}

function isWorkspaceCleanup(action: ObservedAction, workspaceId: string): boolean {
  return (
    action.type === workspaceUnmounted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId
  );
}

function temporaryNoteId(): string {
  const crypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof crypto?.randomUUID === 'function') return `optimistic-${crypto.randomUUID()}`;
  return `optimistic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createRequest(
  workspaceId: string,
  data: Omit<CreateNoteRequest, 'workspaceId'>,
): CreateNoteRequest {
  return {
    workspaceId: WorkspaceId(workspaceId),
    title: data.title,
    content: data.content,
    ...(data.contentType !== undefined ? { contentType: data.contentType } : {}),
    ...(data.tags !== undefined ? { tags: [...data.tags] } : {}),
    ...(data.parentId !== undefined ? { parentId: NoteId(String(data.parentId)) } : {}),
    ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
  };
}

function optimisticNote(
  workspaceId: string,
  tempId: string,
  data: Omit<CreateNoteRequest, 'workspaceId'>,
): Note {
  const now = new Date().toISOString();
  return {
    id: NoteId(tempId),
    workspaceId: WorkspaceId(workspaceId),
    title: data.title,
    content: data.content,
    contentType: data.contentType ?? ContentType.Markdown,
    tags: data.tags ? [...data.tags] : [],
    isPinned: false,
    isArchived: false,
    ...(data.parentId !== undefined ? { parentId: NoteId(String(data.parentId)) } : {}),
    visibility: data.visibility ?? NoteVisibility.Workspace,
    createdAt: now,
    updatedAt: now,
  };
}

function* refetchWorkspaceNotes(workspaceId: string) {
  try {
    const response: Awaited<ReturnType<typeof appClient.notes.list>> = yield* call(
      [appClient.notes, appClient.notes.list],
      workspaceId,
    );
    const notes = response.map(toRuntimeNote);
    yield* put(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
  } catch (error) {
    logger.error('Failed to refetch notes after a mutation error', error);
  }
}

function* reconcileConflict(
  workspaceId: string,
  noteId: string,
  result: MutationResult,
): SagaGenerator<boolean> {
  if (!result.conflict) return false;
  const current = result.conflict.current;
  if (current && typeof current === 'object') {
    const note = toRuntimeNote(current as Note);
    const canonicalId = String(note.id || noteId);
    // Mutation-response notes omit the transient `unmetDependsOn` projection
    // (monorepo#2001); keep the cached value so "Waits on" doesn't flicker.
    const cached = yield* selectNoteById.effect(workspaceId, canonicalId);
    yield* put(
      applyNoteUpdated(workspaceId, canonicalId, withPreservedUnmetDependsOn(note, cached)),
    );
  } else {
    yield* call(refetchWorkspaceNotes, workspaceId);
  }
  logger.warn('Note mutation conflicted; reloaded the latest version', { noteId });
  toast.warning(m.notes_writeService_noteChanged_label(), {
    description: m.notes_writeService_noteChanged_description(),
  });
  return true;
}

function* advanceRevision(workspaceId: string, noteId: string, sentRev: number) {
  const current = yield* selectNoteById.effect(workspaceId, noteId);
  if (current?.rev !== undefined && current.rev >= sentRev + 1) return;
  yield* put(applyLocalNoteUpdate(workspaceId, noteId, { rev: sentRev + 1 }));
}

function* saveContent(command: ContentCommand) {
  const { workspaceId, noteId, content } = command;
  const note = yield* selectNoteById.effect(workspaceId, noteId);
  const rev = note?.rev;
  try {
    const result: MutationResult = yield* call(
      [appClient.notes, appClient.notes.setContent],
      noteId,
      content,
      rev,
      workspaceId,
    );
    if (!result.success) {
      if (yield* call(reconcileConflict, workspaceId, noteId, result)) return;
      logger.error('Failed to save note content', result.error);
      toast.error(m.notes_writeService_saveFailed_error(), {
        description: result.error ?? m.notes_writeService_unknown_error(),
      });
      yield* call(refetchWorkspaceNotes, workspaceId);
      return;
    }
    if (rev !== undefined) yield* call(advanceRevision, workspaceId, noteId, rev);
  } catch (error) {
    logger.error('Failed to save note content', error);
    yield* call(refetchWorkspaceNotes, workspaceId);
  }
}

function* saveMetadata(command: MetadataCommand) {
  const { workspaceId, noteId, patch, rollback, titleOnly } = command;
  const note = yield* selectNoteById.effect(workspaceId, noteId);
  const rev = note?.rev;
  try {
    const result: MutationResult = yield* call(
      [appClient.notes, appClient.notes.updateMetadata],
      noteId,
      patch,
      rev,
      workspaceId,
    );
    if (!result.success) {
      if (yield* call(reconcileConflict, workspaceId, noteId, result)) return;
      logger.error(
        titleOnly ? 'Failed to update note title' : 'Failed to update note metadata',
        result.error,
      );
      toast.error(
        titleOnly
          ? m.notes_writeService_updateTitleFailed_error()
          : m.notes_writeService_updateFailed_error(),
        { description: result.error ?? m.notes_writeService_unknown_error() },
      );
      yield* put(applyLocalNoteUpdate(workspaceId, noteId, rollback));
      return;
    }
    if (rev !== undefined) yield* call(advanceRevision, workspaceId, noteId, rev);
  } catch (error) {
    logger.error('Failed to update note metadata', error);
    yield* put(applyLocalNoteUpdate(workspaceId, noteId, rollback));
  }
}

function* removeNote(command: DeleteCommand) {
  const { workspaceId, noteId, snapshot } = command;
  try {
    const result: MutationResult = yield* call(
      [appClient.notes, appClient.notes.delete],
      noteId,
      snapshot?.rev,
      workspaceId,
    );
    if (result.success) return;
    if (yield* call(reconcileConflict, workspaceId, noteId, result)) return;
    logger.error('Failed to delete note', result.error);
    toast.error(m.notes_writeService_deleteFailed_error(), {
      description: result.error ?? m.notes_writeService_unknown_error(),
    });
    if (snapshot) yield* put(applyNoteCreated(workspaceId, snapshot));
  } catch (error) {
    logger.error('Failed to delete note', error);
    if (snapshot) yield* put(applyNoteCreated(workspaceId, snapshot));
  }
}

function* runMutation(command: MutationCommand) {
  if (command.kind === 'content') yield* call(saveContent, command);
  else if (command.kind === 'metadata') yield* call(saveMetadata, command);
  else yield* call(removeNote, command);
}

function* enqueueMutation(
  queue: Channel<MutationEnvelope>,
  command: MutationCommand,
  waitForCompletion = false,
) {
  if (!waitForCompletion) {
    yield* put(queue, { command });
    return;
  }
  const completion = channel<boolean>(buffers.fixed(1));
  try {
    yield* put(queue, { command, completion });
    yield* take(completion);
  } finally {
    completion.close();
  }
}

export function* flushPendingNoteContent(workspaceId: string, noteId: string) {
  const key = noteKey(workspaceId, noteId);
  const pending = pendingContent.get(key);
  if (!pending) return;
  pendingContent.delete(key);
  const command: ContentCommand = { kind: 'content', ...pending };
  if (noteMutationQueue) yield* enqueueMutation(noteMutationQueue, command, true);
  else yield* call(runMutation, command);
}

function* handleMetadataAction(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof updateNote>,
) {
  const [workspaceId, noteId, updates] = action.payload;
  if (!workspaceId || !noteId) return;
  const patch: NoteMetadataPatch = {
    ...(updates.title !== undefined ? { title: updates.title } : {}),
    ...(updates.tags !== undefined ? { tags: [...updates.tags] } : {}),
  };
  if (patch.title === undefined && patch.tags === undefined) return;
  const before = yield* selectNoteById.effect(workspaceId, noteId);
  const rollback: NoteMetadataPatch = {
    ...(patch.title !== undefined ? { title: before?.title ?? '' } : {}),
    ...(patch.tags !== undefined ? { tags: before?.tags ? [...before.tags] : [] } : {}),
  };
  yield* put(applyLocalNoteUpdate(workspaceId, noteId, patch));
  yield* call(flushPendingNoteContent, workspaceId, noteId);
  yield* enqueueMutation(
    queue,
    { kind: 'metadata', workspaceId, noteId, patch, rollback, titleOnly: false },
    true,
  );
}

function* createNewNote(
  workspaceId: string,
  data: Omit<CreateNoteRequest, 'workspaceId'>,
): SagaGenerator<string | undefined> {
  const tempId = temporaryNoteId();
  const state = yield* selectWorkspaceNotesState.effect(workspaceId);
  const before = new Set(state.notes.ids.map(String));
  const optimistic = optimisticNote(workspaceId, tempId, data);
  let keepOptimistic = true;
  yield* put(addOptimisticNote(workspaceId, optimistic));

  try {
    const result: MutationResult = yield* call(
      [appClient.notes, appClient.notes.create],
      createRequest(workspaceId, data),
    );
    if (!result.success) {
      yield* put(removeOptimisticNote(workspaceId, tempId));
      keepOptimistic = false;
      logger.error('Failed to create note', result.error);
      return undefined;
    }

    try {
      const response: Awaited<ReturnType<typeof appClient.notes.list>> = yield* call(
        [appClient.notes, appClient.notes.list],
        workspaceId,
      );
      const notes = response.map(toRuntimeNote);
      yield* put(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
      keepOptimistic = false;
      const created = notes.find((note) => !before.has(String(note.id)));
      if (!created) return undefined;
      yield* put(addOptimisticNote(workspaceId, created));
      return String(created.id);
    } catch (error) {
      keepOptimistic = false;
      logger.error('Failed to refetch notes after creating a note', error);
      return undefined;
    }
  } finally {
    if (keepOptimistic && (yield* cancelled())) {
      yield* put(removeOptimisticNote(workspaceId, tempId));
    }
  }
}

function* handleCreateAction(action: ReturnType<typeof createNote>) {
  const [workspaceId, data] = action.payload;
  if (!workspaceId) return;
  yield* race({
    create: call(createNewNote, workspaceId, data),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* handleCreateRequested(action: ReturnType<typeof createNoteRequested>) {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* race({
    create: call(createRequestedNote, workspaceId),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* createRequestedNote(workspaceId: string) {
  const title = m.notes_writeService_newNote_title();
  const noteId = yield* call(createNewNote, workspaceId, { title, content: '', tags: [] });
  if (!noteId) return;
  yield* put(markNoteRead(workspaceId, noteId));
  yield* put(
    openTab(workspaceId, {
      type: 'note',
      title,
      closable: true,
      noteId,
      workspaceId,
    }),
  );
}

function* cleanupWorkspace(queue: Channel<MutationEnvelope>, action: WorkspaceCleanupAction) {
  const [workspaceId] = action.payload;
  for (const key of pendingContent.keys()) {
    if (key.startsWith(`${workspaceId}:`)) pendingContent.delete(key);
  }
  const queued = yield* flush(queue);
  for (const envelope of queued) {
    if (envelope.command.workspaceId === workspaceId) {
      if (envelope.completion) yield* put(envelope.completion, false);
    } else {
      yield* put(queue, envelope);
    }
  }
}

function* consumeMutations(queue: Channel<MutationEnvelope>) {
  while (true) {
    const envelope = yield* take(queue);
    const { command, completion } = envelope;
    const { mutation } = yield* race({
      mutation: call(runMutation, command),
      cleanup: take((action: ObservedAction) => isWorkspaceCleanup(action, command.workspaceId)),
    });
    if (completion) yield* put(completion, mutation !== undefined);
  }
}

export function* notesWriteSaga() {
  const queue = channel<MutationEnvelope>(buffers.expanding());
  noteMutationQueue = queue;
  try {
    yield* takeEvery(updateNote, handleMetadataAction, queue);
    yield* takeEvery(createNote, handleCreateAction);
    yield* takeEvery(createNoteRequested, handleCreateRequested);
    yield* takeEvery(workspaceUnmounted, cleanupWorkspace, queue);
    yield* call(consumeMutations, queue);
  } finally {
    const queued = yield* flush(queue);
    for (const envelope of queued) {
      if (envelope.completion) yield* put(envelope.completion, false);
    }
    pendingContent.clear();
    queue.close();
    if (noteMutationQueue === queue) noteMutationQueue = undefined;
  }
}
