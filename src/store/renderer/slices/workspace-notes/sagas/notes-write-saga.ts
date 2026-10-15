import { call, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { MutationResult, NoteMetadataPatch } from '$lib/client';
import type { NoteCreateResult } from '$lib/client/app-client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { ContentType, NoteVisibility } from '$shared/types';
import type { CreateNoteRequest, Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { notify } from '$lib/components/patterns/notify';
import {
  addCommentAction,
  removeCommentAction,
  updateCommentAction,
} from '../../comments/comments-slice';
import { selectCommentById } from '../../comments/comments-selectors';
import {
  createNoteRequested,
  markNoteRead,
} from '../../note-read-tracking/note-read-tracking-slice';
import { openTab, openTabInRightmostColumnRequested } from '../../panel-layout/panel-layout-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { withPreservedUnmetDependsOn } from '../workspace-notes-normalization';
import { selectNoteById } from '../workspace-notes-selectors';
import {
  addOptimisticNote,
  addCommentRequested,
  applyLocalNoteUpdate,
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  createNote,
  noteCreationAccepted,
  deleteCommentRequested,
  deleteNote,
  deleteNotePersistRequested,
  loadWorkspaceNotesSucceeded,
  removeOptimisticNote,
  respondToCommentRequested,
  resolveCommentRequested,
  updateNote,
  updateNoteTitle,
  updateNoteTitlePersistRequested,
  NOTE_CONTENT_SAVE_DEBOUNCE_MS,
} from '../workspace-notes-slice';
import { createNotesWriteSaga } from './notes-write-saga-factory';
import type { NotesWriteQueue } from '../workspace-notes-types';
import { toRuntimeNote } from './note-payload-mappers';

const logger = createLogger('NotesWriteSaga');
export { NOTE_CONTENT_SAVE_DEBOUNCE_MS };

type MetadataCommand = {
  kind: 'metadata';
  workspaceId: string;
  noteId: string;
  patch: NoteMetadataPatch;
  rollback: NoteMetadataPatch;
  titleOnly: boolean;
};
type DeleteCommand = { kind: 'delete'; workspaceId: string; noteId: string; snapshot?: Note };
type AddCommentCommand = {
  kind: 'add-comment';
  workspaceId: string;
  noteId: string;
  params: Parameters<typeof appClient.comments.add>[1];
};
type RespondCommentCommand = {
  kind: 'respond-comment';
  workspaceId: string;
  noteId: string;
  params: Parameters<typeof appClient.comments.respond>[1];
};
type DeleteCommentCommand = {
  kind: 'delete-comment';
  workspaceId: string;
  noteId: string;
  commentId: string;
};
type ResolveCommentCommand = {
  kind: 'resolve-comment';
  workspaceId: string;
  noteId: string;
  commentId: string;
};
type MutationCommand =
  | MetadataCommand
  | DeleteCommand
  | AddCommentCommand
  | RespondCommentCommand
  | DeleteCommentCommand
  | ResolveCommentCommand;
type ObservedAction = { type: string; payload?: unknown };
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
  notify.warning(m.notes_writeService_noteChanged_label(), {
    description: m.notes_writeService_noteChanged_description(),
  });
  return true;
}

function* setRevisionIfNewer(workspaceId: string, noteId: string, nextRev: number) {
  const current = yield* selectNoteById.effect(workspaceId, noteId);
  if (current?.rev !== undefined && current.rev >= nextRev) return;
  yield* put(applyLocalNoteUpdate(workspaceId, noteId, { rev: nextRev }));
}

function* advanceRevision(workspaceId: string, noteId: string, sentRev: number) {
  yield* call(setRevisionIfNewer, workspaceId, noteId, sentRev + 1);
}

function* addComment(command: AddCommentCommand): SagaGenerator<boolean> {
  const { workspaceId, noteId, params } = command;
  const rev = (yield* selectNoteById.effect(workspaceId, noteId))?.rev;
  const result: MutationResult = yield* call(
    [appClient.comments, appClient.comments.add],
    noteId,
    params,
  );
  if (!result.success) return false;
  if (result.noteRev !== undefined)
    yield* call(setRevisionIfNewer, workspaceId, noteId, result.noteRev);
  else if (rev !== undefined) yield* call(advanceRevision, workspaceId, noteId, rev);
  return true;
}

function* respondToComment(command: RespondCommentCommand): SagaGenerator<boolean> {
  const result: MutationResult = yield* call(
    [appClient.comments, appClient.comments.respond],
    command.noteId,
    command.params,
  );
  return result.success;
}

function* deleteComment(command: DeleteCommentCommand): SagaGenerator<boolean> {
  const result: MutationResult = yield* call(
    [appClient.comments, appClient.comments.delete],
    command.noteId,
    command.commentId,
    command.workspaceId,
  );
  return result.success;
}

function* resolveComment(command: ResolveCommentCommand): SagaGenerator<boolean> {
  try {
    yield* call(backendRequest, 'comment.resolveThread', {
      workspaceId: command.workspaceId,
      noteId: command.noteId,
      commentId: command.commentId,
      resolved: true,
    });
    return true;
  } catch (error) {
    logger.error('Failed to resolve comment', error);
    return false;
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
      notify.error(
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
    notify.error(m.notes_writeService_deleteFailed_error(), {
      description: result.error ?? m.notes_writeService_unknown_error(),
    });
    if (snapshot) yield* put(applyNoteCreated(workspaceId, snapshot));
  } catch (error) {
    logger.error('Failed to delete note', error);
    if (snapshot) yield* put(applyNoteCreated(workspaceId, snapshot));
  }
}

function* runMutation(command: MutationCommand) {
  if (command.kind === 'metadata') return yield* call(saveMetadata, command);
  if (command.kind === 'delete') return yield* call(removeNote, command);
  if (command.kind === 'add-comment') return yield* call(addComment, command);
  if (command.kind === 'respond-comment') return yield* call(respondToComment, command);
  if (command.kind === 'delete-comment') return yield* call(deleteComment, command);
  if (command.kind === 'resolve-comment') return yield* call(resolveComment, command);
  return undefined;
}

function* enqueueMutation(queue: NotesWriteQueue, command: MutationCommand) {
  return yield* call(queue.enqueue, command.workspaceId, command.noteId, function* () {
    return yield* call(runMutation, command);
  });
}
function* handleAddComment(queue: NotesWriteQueue, action: ReturnType<typeof addCommentRequested>) {
  const [noteId, optimistic, params] = action.payload;
  const workspaceId = params.workspaceId ?? optimistic.workspaceId;
  yield* put(addCommentAction(optimistic));
  if (!workspaceId) {
    yield* put(removeCommentAction(optimistic.id));
    yield* put(action.success(false));
    return;
  }
  try {
    const command: AddCommentCommand = {
      kind: 'add-comment',
      workspaceId,
      noteId,
      params: { ...params, workspaceId },
    };
    const success = (yield* call(enqueueMutation, queue, command)) as boolean;
    if (!success) {
      yield* put(removeCommentAction(optimistic.id));
      notify.error(m.comments_writeService_addFailed_error());
    }
    yield* put(action.success(success));
  } catch (error) {
    yield* put(removeCommentAction(optimistic.id));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleRespondComment(
  queue: NotesWriteQueue,
  action: ReturnType<typeof respondToCommentRequested>,
) {
  const [noteId, optimistic, params] = action.payload;
  const workspaceId = params.workspaceId ?? optimistic.workspaceId;
  yield* put(addCommentAction(optimistic));
  if (!workspaceId) {
    yield* put(removeCommentAction(optimistic.id));
    yield* put(action.success(false));
    return;
  }
  try {
    const command: RespondCommentCommand = {
      kind: 'respond-comment',
      workspaceId,
      noteId,
      params: { ...params, workspaceId },
    };
    const success = (yield* call(enqueueMutation, queue, command)) as boolean;
    if (!success) {
      yield* put(removeCommentAction(optimistic.id));
      notify.error(m.comments_writeService_replyFailed_error());
    }
    yield* put(action.success(success));
  } catch (error) {
    yield* put(removeCommentAction(optimistic.id));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleDeleteComment(
  queue: NotesWriteQueue,
  action: ReturnType<typeof deleteCommentRequested>,
) {
  const [noteId, commentId, explicitWorkspaceId] = action.payload;
  const snapshot = yield* selectCommentById.effect(commentId);
  const workspaceId = explicitWorkspaceId ?? snapshot?.workspaceId;
  yield* put(removeCommentAction(commentId));
  if (!workspaceId) {
    if (snapshot) yield* put(addCommentAction(snapshot));
    yield* put(action.success({ existed: !!snapshot, success: false }));
    return;
  }
  try {
    const command: DeleteCommentCommand = {
      kind: 'delete-comment',
      workspaceId,
      noteId,
      commentId,
    };
    const success = (yield* call(enqueueMutation, queue, command)) as boolean;
    if (!success && snapshot) yield* put(addCommentAction(snapshot));
    if (!success) notify.error(m.comments_writeService_deleteFailed_error());
    yield* put(action.success({ existed: !!snapshot, success }));
  } catch (error) {
    if (snapshot) yield* put(addCommentAction(snapshot));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleResolveComment(
  queue: NotesWriteQueue,
  action: ReturnType<typeof resolveCommentRequested>,
) {
  const [workspaceId, noteId, commentId] = action.payload;
  const snapshot = yield* selectCommentById.effect(commentId);
  if (!snapshot) {
    yield* put(action.success(false));
    return;
  }
  yield* put(updateCommentAction(commentId, { status: 'resolved' }));
  try {
    const command: ResolveCommentCommand = {
      kind: 'resolve-comment',
      workspaceId,
      noteId,
      commentId,
    };
    const success = (yield* call(enqueueMutation, queue, command)) as boolean;
    if (!success) yield* put(updateCommentAction(commentId, { status: snapshot.status }));
    yield* put(action.success(success));
  } catch (error) {
    yield* put(updateCommentAction(commentId, { status: snapshot.status }));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleTitleAction(queue: NotesWriteQueue, action: ReturnType<typeof updateNoteTitle>) {
  const [workspaceId, noteId, title] = action.payload;
  if (!workspaceId || !noteId || typeof title !== 'string') return;
  const before = yield* selectNoteById.effect(workspaceId, noteId);
  yield* put(applyLocalNoteUpdate(workspaceId, noteId, { title }));
  yield* call(queue.flush, workspaceId, noteId);
  yield* enqueueMutation(queue, {
    kind: 'metadata',
    workspaceId,
    noteId,
    patch: { title },
    rollback: { title: before?.title ?? '' },
    titleOnly: true,
  });
}

function* handleTitleRequested(
  queue: NotesWriteQueue,
  action: ReturnType<typeof updateNoteTitlePersistRequested>,
) {
  try {
    yield* call(handleTitleAction, queue, updateNoteTitle(...action.payload));
    yield* put(action.success(undefined as never));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleMetadataAction(queue: NotesWriteQueue, action: ReturnType<typeof updateNote>) {
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
  yield* call(queue.flush, workspaceId, noteId);
  yield* enqueueMutation(queue, {
    kind: 'metadata',
    workspaceId,
    noteId,
    patch,
    rollback,
    titleOnly: false,
  });
}

function* handleDeleteAction(queue: NotesWriteQueue, action: ReturnType<typeof deleteNote>) {
  const [workspaceId, noteId] = action.payload;
  if (!workspaceId || !noteId) return;
  yield* call(queue.flush, workspaceId, noteId);
  const snapshot = yield* selectNoteById.effect(workspaceId, noteId);
  yield* put(applyNoteDeleted(workspaceId, noteId));
  yield* enqueueMutation(queue, { kind: 'delete', workspaceId, noteId, snapshot });
}

function* handleDeleteRequested(
  queue: NotesWriteQueue,
  action: ReturnType<typeof deleteNotePersistRequested>,
) {
  try {
    yield* call(handleDeleteAction, queue, deleteNote(...action.payload));
    yield* put(action.success(undefined as never));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* createNewNote(
  workspaceId: string,
  data: Omit<CreateNoteRequest, 'workspaceId'>,
): SagaGenerator<string | undefined> {
  const tempId = temporaryNoteId();
  const optimistic = optimisticNote(workspaceId, tempId, data);
  yield* put(addOptimisticNote(workspaceId, optimistic));

  try {
    const result: NoteCreateResult = yield* call(
      [appClient.notes, appClient.notes.create],
      createRequest(workspaceId, data),
    );
    if (
      !result.success ||
      !result.note ||
      result.note.workspaceId !== workspaceId ||
      !result.note.id
    ) {
      logger.error('Failed to create note', result.error);
      return undefined;
    }

    yield* put(noteCreationAccepted(workspaceId, result.note, true));
    const accepted = yield* selectNoteById.effect(workspaceId, String(result.note.id));
    return accepted ? String(result.note.id) : undefined;
  } finally {
    yield* put(removeOptimisticNote(workspaceId, tempId));
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
  const [workspaceId, options] = action.payload;
  if (!workspaceId) return;
  yield* race({
    create: call(createRequestedNote, workspaceId, options),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* createRequestedNote(
  workspaceId: string,
  options?: { panelLayoutId?: string; panelId?: string },
) {
  const title = m.notes_writeService_newNote_title();
  const noteId = yield* call(createNewNote, workspaceId, { title, content: '', tags: [] });
  if (!noteId) return;
  yield* put(markNoteRead(workspaceId, noteId));
  const panelLayoutId = options?.panelLayoutId ?? workspaceId;
  const tab = {
    type: 'note' as const,
    title,
    closable: true,
    noteId,
    workspaceId,
  };
  yield* put(
    options?.panelId
      ? openTab(panelLayoutId, tab, options.panelId)
      : openTabInRightmostColumnRequested(panelLayoutId, tab),
  );
}

export const notesWriteSaga = createNotesWriteSaga({
  notes: appClient.notes,
  selectNoteById,
  source: {
    create: createNewNote,
    *onContentFailure(workspaceId, error, reported) {
      logger.error('Failed to save note content', error);
      if (reported)
        notify.error(m.notes_writeService_saveFailed_error(), {
          description: typeof error === 'string' ? error : m.notes_writeService_unknown_error(),
        });
      yield* call(refetchWorkspaceNotes, workspaceId);
    },
    *register(queue) {
      yield* takeEvery(updateNoteTitle, handleTitleAction, queue);
      yield* takeEvery(updateNoteTitlePersistRequested, handleTitleRequested, queue);
      yield* takeEvery(updateNote, handleMetadataAction, queue);
      yield* takeEvery(deleteNote, handleDeleteAction, queue);
      yield* takeEvery(deleteNotePersistRequested, handleDeleteRequested, queue);
      yield* takeEvery(createNote, handleCreateAction);
      yield* takeEvery(createNoteRequested, handleCreateRequested);
      yield* takeEvery(addCommentRequested, handleAddComment, queue);
      yield* takeEvery(respondToCommentRequested, handleRespondComment, queue);
      yield* takeEvery(deleteCommentRequested, handleDeleteComment, queue);
      yield* takeEvery(resolveCommentRequested, handleResolveComment, queue);
    },
  },
});
