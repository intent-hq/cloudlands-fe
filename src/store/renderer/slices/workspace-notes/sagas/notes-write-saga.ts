import type { Task } from 'redux-saga';
import {
  call,
  cancel,
  cancelled,
  delay,
  fork,
  join,
  put,
  take,
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
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectNoteById, selectWorkspaceNotesState } from '../workspace-notes-selectors';
import {
  addOptimisticNote,
  applyLocalNoteUpdate,
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  createNote,
  deleteNote,
  loadWorkspaceNotesSucceeded,
  removeOptimisticNote,
  updateNote,
  updateNoteContent,
  updateNoteTitle,
} from '../workspace-notes-slice';
import { toRuntimeNote } from './note-payload-mappers';

const logger = createLogger('NotesWriteSaga');
export const NOTE_CONTENT_SAVE_DEBOUNCE_MS = 800;

type PendingContent = { workspaceId: string; noteId: string; content: string };
type DebounceSlot = { workspaceId: string; task?: Task; token: symbol };
type MutationSlot = { workspaceId: string; task?: Task; token: symbol };
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

const pendingContent = new Map<string, PendingContent>();
const debounceSlots = new Map<string, DebounceSlot>();
const mutationSlots = new Map<string, MutationSlot>();
const mutationTasks = new Map<string, Set<Task>>();

function noteKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}:${noteId}`;
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
    yield* put(applyNoteUpdated(workspaceId, String(note.id || noteId), note));
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
      logger.error(titleOnly ? 'Failed to update note title' : 'Failed to update note metadata', result.error);
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

function* queueMutation(command: MutationCommand, waitForCompletion = false) {
  const key = noteKey(command.workspaceId, command.noteId);
  const previous = mutationSlots.get(key)?.task;
  const token = Symbol(key);
  mutationSlots.set(key, { workspaceId: command.workspaceId, token });
  const holder: { task?: Task } = {};
  const task = yield* fork(function* () {
    try {
      if (previous) yield* join(previous);
      yield* call(runMutation, command);
    } finally {
      if (mutationSlots.get(key)?.token === token) mutationSlots.delete(key);
      if (holder.task) mutationTasks.get(command.workspaceId)?.delete(holder.task);
    }
  });
  holder.task = task;
  const tasks = mutationTasks.get(command.workspaceId) ?? new Set<Task>();
  tasks.add(task);
  mutationTasks.set(command.workspaceId, tasks);
  if (mutationSlots.get(key)?.token === token) {
    mutationSlots.set(key, { workspaceId: command.workspaceId, task, token });
  }
  if (waitForCompletion) yield* join(task);
}

export function* flushPendingNoteContent(workspaceId: string, noteId: string) {
  const key = noteKey(workspaceId, noteId);
  const debounce = debounceSlots.get(key);
  if (debounce?.task) yield* cancel(debounce.task);
  debounceSlots.delete(key);

  const pending = pendingContent.get(key);
  if (pending) {
    pendingContent.delete(key);
    yield* queueMutation({ kind: 'content', ...pending }, true);
    return;
  }
  const running = mutationSlots.get(key)?.task;
  if (running) yield* join(running);
}

export function hasPendingNoteContentInSaga(workspaceId: string, noteId: string): boolean {
  const key = noteKey(workspaceId, noteId);
  return pendingContent.has(key) || mutationSlots.has(key);
}

function* scheduleContentSave(pending: PendingContent) {
  const key = noteKey(pending.workspaceId, pending.noteId);
  const token = Symbol(key);
  debounceSlots.set(key, { workspaceId: pending.workspaceId, token });
  const task = yield* fork(function* () {
    try {
      yield* delay(NOTE_CONTENT_SAVE_DEBOUNCE_MS);
      if (debounceSlots.get(key)?.token === token) debounceSlots.delete(key);
      yield* call(flushPendingNoteContent, pending.workspaceId, pending.noteId);
    } finally {
      if (debounceSlots.get(key)?.token === token) debounceSlots.delete(key);
    }
  });
  if (debounceSlots.get(key)?.token === token) {
    debounceSlots.set(key, { workspaceId: pending.workspaceId, task, token });
  }
}

function* handleContentAction(action: ReturnType<typeof updateNoteContent>) {
  const [workspaceId, noteId, content, immediate] = action.payload;
  if (!workspaceId || !noteId || typeof content !== 'string') return;
  yield* put(applyLocalNoteUpdate(workspaceId, noteId, { content }));
  const key = noteKey(workspaceId, noteId);
  const pending = { workspaceId, noteId, content };
  pendingContent.set(key, pending);
  const prior = debounceSlots.get(key);
  if (prior?.task) yield* cancel(prior.task);
  debounceSlots.delete(key);
  if (immediate) yield* call(flushPendingNoteContent, workspaceId, noteId);
  else yield* call(scheduleContentSave, pending);
}

function* handleTitleAction(action: ReturnType<typeof updateNoteTitle>) {
  const [workspaceId, noteId, title] = action.payload;
  if (!workspaceId || !noteId || typeof title !== 'string') return;
  const before = yield* selectNoteById.effect(workspaceId, noteId);
  yield* put(applyLocalNoteUpdate(workspaceId, noteId, { title }));
  yield* call(flushPendingNoteContent, workspaceId, noteId);
  yield* queueMutation(
    {
      kind: 'metadata',
      workspaceId,
      noteId,
      patch: { title },
      rollback: { title: before?.title ?? '' },
      titleOnly: true,
    },
    true,
  );
}

function* handleMetadataAction(action: ReturnType<typeof updateNote>) {
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
  yield* queueMutation(
    { kind: 'metadata', workspaceId, noteId, patch, rollback, titleOnly: false },
    true,
  );
}

function* handleDeleteAction(action: ReturnType<typeof deleteNote>) {
  const [workspaceId, noteId] = action.payload;
  if (!workspaceId || !noteId) return;
  yield* call(flushPendingNoteContent, workspaceId, noteId);
  const snapshot = yield* selectNoteById.effect(workspaceId, noteId);
  yield* put(applyNoteDeleted(workspaceId, noteId));
  yield* queueMutation({ kind: 'delete', workspaceId, noteId, snapshot }, true);
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
  yield* call(createNewNote, workspaceId, data);
}

function* handleCreateRequested(action: ReturnType<typeof createNoteRequested>) {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
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

function* cleanupWorkspace(workspaceId: string) {
  for (const [key, slot] of debounceSlots) {
    if (slot.workspaceId !== workspaceId) continue;
    debounceSlots.delete(key);
    pendingContent.delete(key);
    if (slot.task) yield* cancel(slot.task);
  }
  for (const key of pendingContent.keys()) {
    if (key.startsWith(`${workspaceId}:`)) pendingContent.delete(key);
  }
  for (const task of mutationTasks.get(workspaceId) ?? []) yield* cancel(task);
  mutationTasks.delete(workspaceId);
  for (const [key, slot] of mutationSlots) {
    if (slot.workspaceId === workspaceId) mutationSlots.delete(key);
  }
}

export function* notesWriteSaga() {
  try {
    while (true) {
      const action: { type: string; payload: unknown } = yield* take([
        updateNoteContent,
        updateNoteTitle,
        updateNote,
        deleteNote,
        createNote,
        createNoteRequested,
        workspaceDeleted,
        workspaceUnmounted,
      ]);
      if (action.type === updateNoteContent.type) {
        yield* fork(handleContentAction, action as ReturnType<typeof updateNoteContent>);
      } else if (action.type === updateNoteTitle.type) {
        yield* fork(handleTitleAction, action as ReturnType<typeof updateNoteTitle>);
      } else if (action.type === updateNote.type) {
        yield* fork(handleMetadataAction, action as ReturnType<typeof updateNote>);
      } else if (action.type === deleteNote.type) {
        yield* fork(handleDeleteAction, action as ReturnType<typeof deleteNote>);
      } else if (action.type === createNote.type) {
        yield* fork(handleCreateAction, action as ReturnType<typeof createNote>);
      } else if (action.type === createNoteRequested.type) {
        yield* fork(handleCreateRequested, action as ReturnType<typeof createNoteRequested>);
      } else {
        const [workspaceId] = action.payload as [string];
        yield* call(cleanupWorkspace, workspaceId);
      }
    }
  } finally {
    for (const slot of debounceSlots.values()) {
      if (slot.task) yield* cancel(slot.task);
    }
    for (const tasks of mutationTasks.values()) {
      for (const task of tasks) yield* cancel(task);
    }
    pendingContent.clear();
    debounceSlots.clear();
    mutationSlots.clear();
    mutationTasks.clear();
  }
}