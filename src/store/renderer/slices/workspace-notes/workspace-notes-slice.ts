import type { Note, NoteVersion, TaskStatus } from '$shared/types';
import { isNoteContentStale } from '$shared/utils/note-content';
import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';
import type { CommentAddParams, CommentRespondParams } from '../../../../lib/client/app-client';
import type { CommentV2 } from '../../../../features/comments/comment-types-v2';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  addItem,
  createCollection,
  getItem,
  getItems,
  removeItem,
  replaceItem,
  updateItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import {
  workspaceUnmounted,
  workspaceDeleted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import type { WorkspaceNotesWorkspaceState, WorkspaceNotesState } from './workspace-notes-types';
import type {
  NoteAttributionViewState,
  NotePresenceViewer,
  NoteUiRequestState,
} from './workspace-notes-types';
import type {
  ExplicitNoteEditorIdentity,
  ExplicitNoteEditor,
  ExplicitNoteSaveRequest,
  ExplicitNoteSaveOperation,
  ExplicitNoteCreatorIdentity,
  ExplicitNoteCreateRequest,
  ExplicitNoteCreateOperation,
} from './workspace-notes-types';
import type { LineAttributionData } from '../../../../lib/client/app-client';
import { normalizeNoteUpdatePatch } from './workspace-notes-normalization';

export type { WorkspaceNotesWorkspaceState, WorkspaceNotesState };

export type NoteEventType = 'note:created' | 'note:updated' | 'note:deleted';
export const NOTE_CONTENT_SAVE_DEBOUNCE_MS = 800;

export const emptyWorkspaceNotesState: WorkspaceNotesWorkspaceState = {
  notes: createCollection<Note, 'id'>('id'),
  deletedNoteIds: {},
  loading: false,
  error: null,
  initialized: false,
  selectedNoteId: null,
  isUserTyping: false,
  lastUserInputTime: 0,
  editorHasFocus: false,
  newlyCreatedNoteId: null,
  notesVersion: 0,
  noteVersions: null,
  readyTasks: null,
  pendingContentByNoteId: {},
  contentViews: createCollection('consumerId'),
  workspaceRoots: createCollection('consumerId'),
  presenceViews: createCollection('consumerId'),
  attributionViews: createCollection('consumerId'),
};

export const initialState: WorkspaceNotesState = {
  byWorkspaceId: {},
  explicitEditors: createCollection('viewId'),
  explicitSaveOperations: createCollection('requestId'),
  revokedEditorViews: {},
  explicitCreators: createCollection('viewId'),
  explicitCreateOperations: createCollection('requestId'),
  revokedCreatorViews: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceNotesState);

export const clearWorkspaceNotesForWorkspaces = createAction<[workspaceIds: string[]]>(
  'workspaceNotes/clearWorkspaceNotesForWorkspaces',
);
export const setWorkspaceNotesLoading = createAction<[workspaceIds: string[], isLoading: boolean]>(
  'workspaceNotes/setWorkspaceNotesLoading',
);
export const loadWorkspaceNotesSucceeded = createAction<
  [workspaceIds: string[], notesByWorkspace: Record<string, Note[]>]
>('workspaceNotes/loadWorkspaceNotesSucceeded');
export const loadWorkspaceNotesFailed = createAction<[workspaceIds: string[], error: string]>(
  'workspaceNotes/loadWorkspaceNotesFailed',
);
export const workspaceNotesHydrationRequested = createAction<
  [workspaceId: string, generation: number, force: boolean]
>('workspaceNotes/hydrationRequested');
export const applyTaskStatusChanged = createAction<
  [workspaceId: string, noteId: string, newStatus: TaskStatus]
>('workspaceNotes/applyTaskStatusChanged');
export const applyNoteCreated = createAction<[workspaceId: string, note: Note]>(
  'workspaceNotes/applyNoteCreated',
);
export const applyNoteDeleted = createAction<[workspaceId: string, noteId: string]>(
  'workspaceNotes/applyNoteDeleted',
);
export const applyNoteUpdated = createAction<[workspaceId: string, noteId: string, note: Note]>(
  'workspaceNotes/applyNoteUpdated',
);
export const noteEventReceived = createAction<
  [workspaceId: string, noteId: string, eventType: NoteEventType]
>('workspaceNotes/noteEventReceived');
export const refreshNoteFromEventRequested = createAction<
  [workspaceId: string, noteId: string, eventType: NoteEventType]
>('workspaceNotes/refreshNoteFromEventRequested');

// ---- New actions from notes.store.svelte.ts migration ----

/** Select a note in a workspace */
export const selectNote = createAction<[workspaceId: string, noteId: string | null]>(
  'workspaceNotes/selectNote',
);

/** Set the user typing state */
const setIsUserTyping = createAction<[workspaceId: string, isTyping: boolean]>(
  'workspaceNotes/setIsUserTyping',
);

/** Record the last user input timestamp */
const setLastUserInputTime = createAction<[workspaceId: string, timestamp: number]>(
  'workspaceNotes/setLastUserInputTime',
);

/** Clear the newly created note ID (called after focusing) */
export const clearNewlyCreatedNoteId = createAction<[workspaceId: string]>(
  'workspaceNotes/clearNewlyCreatedNoteId',
);

/** Apply a local note content/title update (optimistic, user-driven) */
export const applyLocalNoteUpdate = createAction(
  'workspaceNotes/applyLocalNoteUpdate',
  (workspaceId: string, noteId: string, updates: Partial<Note>) => {
    const normalizedUpdates = normalizeNoteUpdatePatch(updates);
    return {
      workspaceId,
      noteId,
      updates: normalizedUpdates,
      timestamp:
        typeof normalizedUpdates.updatedAt === 'string'
          ? normalizedUpdates.updatedAt
          : new Date().toISOString(),
    };
  },
);

/** Add an optimistic note (for immediate UI feedback before server confirms) */
export const addOptimisticNote = createAction<[workspaceId: string, note: Note]>(
  'workspaceNotes/addOptimisticNote',
);

/** Remove an optimistic note (on error/rollback) */
export const removeOptimisticNote = createAction<[workspaceId: string, noteId: string]>(
  'workspaceNotes/removeOptimisticNote',
);

/** Saga trigger: update note content (from user input, will debounce) */
export const updateNoteContent = createAction<
  [
    workspaceId: string,
    noteId: string,
    content: string,
    options?: boolean | { immediate?: boolean; baseRev?: number; baseContent?: string },
  ]
>('workspaceNotes/updateNoteContent');

export interface AppliedNoteContent {
  content: string;
  rev?: number;
}

export const flushNoteContentRequested = createAsyncAction<
  [workspaceId: string, noteId: string],
  AppliedNoteContent | undefined
>('workspaceNotes/flushNoteContentRequested', 'workspaceNotes/flushNoteContentSettled');
export const settleNoteContentRequested = createAsyncAction<
  [workspaceId: string, noteId: string],
  void
>('workspaceNotes/settleNoteContentRequested', 'workspaceNotes/settleNoteContentSettled');
export const ensureNoteContentLoadedRequested = createAsyncAction<
  [workspaceId: string, noteId: string],
  boolean
>(
  'workspaceNotes/ensureNoteContentLoadedRequested',
  'workspaceNotes/ensureNoteContentLoadedSettled',
);
export const readNoteRequested = createAsyncAction<
  [workspaceId: string, noteId: string, eventType?: NoteEventType],
  Note | null
>('workspaceNotes/readNoteRequested', 'workspaceNotes/readNoteSettled');
export const listSlimNotesRequested = createAsyncAction<[workspaceId: string], Note[]>(
  'workspaceNotes/listSlimNotesRequested',
  'workspaceNotes/listSlimNotesSettled',
);
export const searchNotesRequested = createAsyncAction<
  [query: string, preferWorkspaceId?: string],
  unknown
>('workspaceNotes/searchNotesRequested', 'workspaceNotes/searchNotesSettled');

export const addCommentRequested = createAsyncAction<
  [noteId: string, optimistic: CommentV2, params: CommentAddParams],
  boolean
>('workspaceNotes/addCommentRequested', 'workspaceNotes/addCommentSettled');
export const respondToCommentRequested = createAsyncAction<
  [noteId: string, optimistic: CommentV2, params: CommentRespondParams],
  boolean
>('workspaceNotes/respondToCommentRequested', 'workspaceNotes/respondToCommentSettled');
export const deleteCommentRequested = createAsyncAction<
  [noteId: string, commentId: string, workspaceId?: string],
  { existed: boolean; success: boolean }
>('workspaceNotes/deleteCommentRequested', 'workspaceNotes/deleteCommentSettled');
export const resolveCommentRequested = createAsyncAction<
  [workspaceId: string, noteId: string, commentId: string],
  boolean
>('workspaceNotes/resolveCommentRequested', 'workspaceNotes/resolveCommentSettled');
export const loadNoteCommentsRequested = createAsyncAction<
  [workspaceId: string, noteId: string],
  CommentV2[]
>('workspaceNotes/loadNoteCommentsRequested', 'workspaceNotes/loadNoteCommentsSettled');
export const commentEventReceived = createAction<
  [workspaceId: string, noteId: string, kind: 'added' | 'resolved']
>('workspaceNotes/commentEventReceived');
export const setNoteContentPending = createAction<
  [workspaceId: string, noteId: string, pending: boolean]
>('workspaceNotes/setNoteContentPending');

export const noteContentViewRequested = createAction<
  [consumerId: string, requestId: string, workspaceId: string, noteId: string]
>('workspaceNotes/noteContentViewRequested');
export const noteContentViewFinished = createAction<
  [
    workspaceId: string,
    consumerId: string,
    requestId: string,
    authority: string | null,
    error?: string,
  ]
>('workspaceNotes/noteContentViewFinished');
export const noteContentViewReleased = createAction<[workspaceId: string, consumerId: string]>(
  'workspaceNotes/noteContentViewReleased',
);
export const noteWorkspaceRootRequested = createAction<
  [consumerId: string, requestId: string, workspaceId: string]
>('workspaceNotes/noteWorkspaceRootRequested');
export const noteWorkspaceRootFinished = createAction<
  [
    workspaceId: string,
    consumerId: string,
    requestId: string,
    authority: string | null,
    path: string | null,
    error?: string,
  ]
>('workspaceNotes/noteWorkspaceRootFinished');
export const noteWorkspaceRootReleased = createAction<[workspaceId: string, consumerId: string]>(
  'workspaceNotes/noteWorkspaceRootReleased',
);
export const notePresenceViewRequested = createAction<
  [consumerId: string, requestId: string, workspaceId: string, noteId: string]
>('workspaceNotes/notePresenceViewRequested');
export const notePresenceViewersReceived = createAction<
  [
    workspaceId: string,
    consumerId: string,
    requestId: string,
    authority: string | null,
    viewers: NotePresenceViewer[],
  ]
>('workspaceNotes/notePresenceViewersReceived');
export const notePresenceViewReleased = createAction<[workspaceId: string, consumerId: string]>(
  'workspaceNotes/notePresenceViewReleased',
);
export const noteAttributionViewRequested = createAction<
  [consumerId: string, requestId: string, workspaceId: string, noteId: string]
>('workspaceNotes/noteAttributionViewRequested');
export const noteAttributionViewFinished = createAction<
  [
    consumerId: string,
    requestId: string,
    workspaceId: string,
    authority: string | null,
    data: LineAttributionData | null,
    error?: string,
  ]
>('workspaceNotes/noteAttributionViewFinished');
export const noteAttributionViewReleased = createAction<[workspaceId: string, consumerId: string]>(
  'workspaceNotes/noteAttributionViewReleased',
);
export const noteAttributionInvalidated = createAction<[workspaceId: string, noteId: string]>(
  'workspaceNotes/noteAttributionInvalidated',
);

/** Saga trigger: update note title */
export const updateNoteTitle = createAction<[workspaceId: string, noteId: string, title: string]>(
  'workspaceNotes/updateNoteTitle',
);
export const updateNoteTitlePersistRequested = createAsyncAction<
  [workspaceId: string, noteId: string, title: string],
  void
>('workspaceNotes/updateNoteTitlePersistRequested', 'workspaceNotes/updateNoteTitlePersistSettled');

/** Saga trigger: create a new note */
export const createNote = createAction<
  [workspaceId: string, data: Omit<import('$shared/types').CreateNoteRequest, 'workspaceId'>]
>('workspaceNotes/createNote');
export const createNotePersistRequested = createAsyncAction<
  [
    workspaceId: string,
    data: Omit<import('$shared/types').CreateNoteRequest, 'workspaceId'>,
    explicit?: ExplicitNoteCreateRequest,
  ],
  string | undefined
>('workspaceNotes/createNotePersistRequested', 'workspaceNotes/createNotePersistSettled');

/** Saga trigger: delete a note */
export const deleteNote = createAction<[workspaceId: string, noteId: string]>(
  'workspaceNotes/deleteNote',
);
export const deleteNotePersistRequested = createAsyncAction<
  [workspaceId: string, noteId: string],
  void
>('workspaceNotes/deleteNotePersistRequested', 'workspaceNotes/deleteNotePersistSettled');

/** Saga trigger: update note (metadata like pin, archive, etc.) */
export const updateNote = createAction<
  [
    workspaceId: string,
    noteId: string,
    updates: Omit<import('$shared/types').UpdateNoteRequest, 'id'>,
  ]
>('workspaceNotes/updateNote');

export const restoreNoteVersion = createAction<
  [workspaceId: string, noteId: string, versionId: string]
>('workspaceNotes/restoreNoteVersion');

/** Saga trigger: fetch note version history */
export const fetchNoteVersions = createAction<[workspaceId: string, noteId: string]>(
  'workspaceNotes/fetchNoteVersions',
);

/** Apply fetched note versions to state */
export const applyNoteVersions = createAction<
  [workspaceId: string, noteId: string, versions: NoteVersion[]]
>('workspaceNotes/applyNoteVersions');

/** Apply note versions fetch error to state */
export const applyNoteVersionsError = createAction<[workspaceId: string, error: string]>(
  'workspaceNotes/applyNoteVersionsError',
);

/** Saga trigger: fetch ready tasks for a workspace */
export const fetchReadyTasks = createAction<[workspaceId: string]>(
  'workspaceNotes/fetchReadyTasks',
);

/** Apply fetched ready tasks to state */
export const applyReadyTasks = createAction<[workspaceId: string, tasks: Note[]]>(
  'workspaceNotes/applyReadyTasks',
);

/** Apply ready tasks fetch error to state */
const applyReadyTasksError = createAction<[workspaceId: string, error: string]>(
  'workspaceNotes/applyReadyTasksError',
);

/** Opt-in explicit editor lifecycle. Unique view IDs are permanently revoked on departure. */
export const explicitNoteEditorOpened = createAction<[identity: ExplicitNoteEditorIdentity]>(
  'workspaceNotes/explicitEditorOpened',
);
export const explicitNoteEditorAdmitted = createAction<[editor: ExplicitNoteEditor]>(
  'workspaceNotes/explicitEditorAdmitted',
);
export const explicitNoteEditorRebound = createAction<[identity: ExplicitNoteEditorIdentity]>(
  'workspaceNotes/explicitEditorRebound',
);
export const explicitNoteDraftChanged = createAction<[viewId: string, content: string]>(
  'workspaceNotes/explicitDraftChanged',
);
export const explicitNoteEditorReleased = createAction<[viewId: string]>(
  'workspaceNotes/explicitEditorReleased',
);
export const explicitNoteEditorsRetired = createAction<[]>('workspaceNotes/explicitEditorsRetired');
export const explicitNoteSaveRequested = createAction<[request: ExplicitNoteSaveRequest]>(
  'workspaceNotes/explicitSaveRequested',
);
export const explicitNoteSaveQueued = createAction<[operation: ExplicitNoteSaveOperation]>(
  'workspaceNotes/explicitSaveQueued',
);
export const explicitNoteSaveStarted = createAction<[requestId: string]>(
  'workspaceNotes/explicitSaveStarted',
);
export const explicitNoteSaveSettled = createAction<
  [
    requestId: string,
    status: 'confirmed' | 'failed' | 'unknown',
    echoedRev?: number,
    error?: string,
    deferredRebase?: ExplicitNoteSaveOperation['deferredRebase'],
  ]
>('workspaceNotes/explicitSaveSettled');
export const explicitNoteContentAccepted = createAction<
  [workspaceId: string, noteId: string, content: string, rev: number]
>('workspaceNotes/explicitContentAccepted');
export const explicitNoteSaveReconciled = createAction<[requestId: string]>(
  'workspaceNotes/explicitSaveReconciled',
);
export const explicitNoteDraftRebased = createAction<
  [viewId: string, expectedSeq: number, content: string, baseContent: string, baseRev: number]
>('workspaceNotes/explicitDraftRebased');

export const explicitNoteCreatorOpened = createAction<[identity: ExplicitNoteCreatorIdentity]>(
  'workspaceNotes/explicitCreatorOpened',
);
export const explicitNoteCreatorAdmitted = createAction<[identity: ExplicitNoteCreatorIdentity]>(
  'workspaceNotes/explicitCreatorAdmitted',
);
export const explicitNoteCreatorReleased = createAction<[viewId: string]>(
  'workspaceNotes/explicitCreatorReleased',
);
export const explicitNoteCreatorsRetired = createAction<[]>(
  'workspaceNotes/explicitCreatorsRetired',
);
export const explicitNoteCreateQueued = createAction<[operation: ExplicitNoteCreateOperation]>(
  'workspaceNotes/explicitCreateQueued',
);
export const explicitNoteCreateStarted = createAction<[requestId: string]>(
  'workspaceNotes/explicitCreateStarted',
);
export const explicitNoteCreateSettled = createAction<
  [
    requestId: string,
    status: 'confirmed' | 'failed' | 'unknown',
    noteId?: string,
    echoedRev?: number,
    error?: string,
  ]
>('workspaceNotes/explicitCreateSettled');
export const noteCreationAccepted = createAction<
  [workspaceId: string, note: Note, focus?: boolean]
>('workspaceNotes/noteCreationAccepted');

function retireExplicitCreators(
  state: WorkspaceNotesState,
  matches: (creator: ExplicitNoteCreatorIdentity) => boolean,
): WorkspaceNotesState {
  let creators = state.explicitCreators;
  let operations = state.explicitCreateOperations;
  let revoked = state.revokedCreatorViews;
  for (const creator of getItems(creators)) {
    if (!matches(creator)) continue;
    creators = removeItem(creators, creator.viewId);
    revoked = { ...revoked, [creator.viewId]: true };
    for (const operation of getItems(operations)) {
      if (operation.viewId !== creator.viewId) continue;
      if (operation.status === 'queued' || operation.status === 'running')
        operations = updateItem(operations, {
          ...operation,
          status: operation.status === 'queued' ? 'failed' : 'unknown',
        });
    }
  }
  return creators === state.explicitCreators
    ? state
    : {
        ...state,
        explicitCreators: creators,
        explicitCreateOperations: operations,
        revokedCreatorViews: revoked,
      };
}

/** Retain one known departed-view receipt per note, plus every unresolved operation. */
function compactRetiredExplicitReceipts(state: WorkspaceNotesState): WorkspaceNotesState {
  let operations = state.explicitSaveOperations;
  const latest = new Map<string, string>();
  for (const operation of getItems(operations)) {
    if (
      !state.revokedEditorViews[operation.viewId] ||
      (operation.status !== 'confirmed' && operation.status !== 'failed') ||
      operation.deferredRebase
    )
      continue;
    const key = JSON.stringify([operation.workspaceId, operation.noteId]);
    const previous = latest.get(key);
    if (previous) operations = removeItem(operations, previous);
    latest.set(key, operation.requestId);
  }
  return operations === state.explicitSaveOperations
    ? state
    : { ...state, explicitSaveOperations: operations };
}

function retireExplicitEditors(
  state: WorkspaceNotesState,
  matches: (editor: ExplicitNoteEditor) => boolean,
): WorkspaceNotesState {
  let editors = state.explicitEditors;
  let operations = state.explicitSaveOperations;
  let revokedEditorViews = state.revokedEditorViews;
  for (const editor of getItems(editors)) {
    if (editor.retired || !matches(editor)) continue;
    editors = removeItem(editors, editor.viewId);
    // The ID alone fences all old contexts; departed draft/base bodies are no longer needed.
    revokedEditorViews = { ...revokedEditorViews, [editor.viewId]: true };
    for (const operation of getItems(operations)) {
      if (operation.viewId !== editor.viewId) continue;
      const { deferredRebase: _history, ...retired } = operation;
      const status =
        operation.status === 'queued'
          ? 'failed'
          : operation.status === 'running'
            ? 'unknown'
            : operation.status;
      if (status !== operation.status || operation.deferredRebase)
        operations = replaceItem(operations, operation.requestId, { ...retired, status });
    }
  }
  return editors === state.explicitEditors
    ? state
    : compactRetiredExplicitReceipts({
        ...state,
        explicitEditors: editors,
        explicitSaveOperations: operations,
        revokedEditorViews,
      });
}

export const workspaceNotesReducer = createReducer<WorkspaceNotesState>(initialState);
workspaceNotesReducer.with(explicitNoteCreatorAdmitted, (state, { payload: [identity] }) => {
  if (
    state.revokedCreatorViews[identity.viewId] ||
    getItem(state.explicitCreators, identity.viewId)
  )
    return state;
  return { ...state, explicitCreators: addItem(state.explicitCreators, identity) };
});
workspaceNotesReducer.with(explicitNoteCreatorReleased, (state, { payload: [viewId] }) => {
  const retired = retireExplicitCreators(state, (creator) => creator.viewId === viewId);
  return retired.revokedCreatorViews[viewId]
    ? retired
    : {
        ...retired,
        revokedCreatorViews: { ...retired.revokedCreatorViews, [viewId]: true },
      };
});
workspaceNotesReducer.with(explicitNoteCreatorsRetired, (state) =>
  retireExplicitCreators(state, () => true),
);
workspaceNotesReducer.with(explicitNoteCreateQueued, (state, { payload: [operation] }) => {
  if (getItem(state.explicitCreateOperations, operation.requestId)) return state;
  return { ...state, explicitCreateOperations: addItem(state.explicitCreateOperations, operation) };
});
workspaceNotesReducer.with(explicitNoteCreateStarted, (state, { payload: [requestId] }) => {
  const operation = getItem(state.explicitCreateOperations, requestId);
  if (operation?.status !== 'queued') return state;
  return {
    ...state,
    explicitCreateOperations: updateItem(state.explicitCreateOperations, {
      ...operation,
      status: 'running',
    }),
  };
});
workspaceNotesReducer.with(
  explicitNoteCreateSettled,
  (state, { payload: [requestId, status, noteId, echoedRev, error] }) => {
    const operation = getItem(state.explicitCreateOperations, requestId);
    if (
      !operation ||
      operation.status === 'confirmed' ||
      operation.status === 'failed' ||
      (operation.status === status &&
        operation.noteId === noteId &&
        operation.echoedRev === echoedRev &&
        operation.error === error)
    )
      return state;
    return {
      ...state,
      explicitCreateOperations: updateItem(state.explicitCreateOperations, {
        ...operation,
        status,
        noteId,
        echoedRev,
        error,
      }),
    };
  },
);
workspaceNotesReducer.with(
  noteCreationAccepted,
  (state, { payload: [workspaceId, note, focus] }) => {
    if (note.workspaceId !== workspaceId) return state;
    const ws = getWorkspaceState(state, workspaceId);
    if (ws.deletedNoteIds[note.id]) return state;
    const existing = getItem(ws.notes, note.id);
    const keepExisting =
      existing?.rev !== undefined && note.rev !== undefined && existing.rev >= note.rev;
    if (keepExisting && (!focus || ws.newlyCreatedNoteId === note.id)) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      notes: keepExisting ? ws.notes : upsertItem(ws.notes, note),
      newlyCreatedNoteId: focus ? note.id : ws.newlyCreatedNoteId,
      notesVersion: keepExisting ? ws.notesVersion : ws.notesVersion + 1,
    });
  },
);
workspaceNotesReducer.with(explicitNoteEditorAdmitted, (state, { payload: [editor] }) => {
  if (state.revokedEditorViews[editor.viewId] || getItem(state.explicitEditors, editor.viewId))
    return state;
  return { ...state, explicitEditors: addItem(state.explicitEditors, editor) };
});
workspaceNotesReducer.with(explicitNoteEditorRebound, (state, { payload: [identity] }) => {
  const editor = getItem(state.explicitEditors, identity.viewId);
  if (
    !editor ||
    editor.retired ||
    editor.context === identity.context ||
    !identity.context ||
    editor.workspaceId !== identity.workspaceId ||
    editor.noteId !== identity.noteId ||
    editor.authority !== identity.authority ||
    editor.retiredContexts.includes(identity.context)
  )
    return state;
  let operations = state.explicitSaveOperations;
  for (const operation of getItems(operations)) {
    if (operation.viewId === editor.viewId && operation.status === 'queued')
      operations = updateItem(operations, { ...operation, status: 'failed' });
  }
  return {
    ...state,
    explicitSaveOperations: operations,
    explicitEditors: updateItem(state.explicitEditors, {
      ...editor,
      context: identity.context,
      retiredContexts: [...editor.retiredContexts, editor.context],
    }),
  };
});
workspaceNotesReducer.with(explicitNoteDraftChanged, (state, { payload: [viewId, content] }) => {
  const editor = getItem(state.explicitEditors, viewId);
  if (!editor || editor.retired || editor.content === content) return state;
  return {
    ...state,
    explicitEditors: updateItem(state.explicitEditors, {
      ...editor,
      content,
      draftSeq: editor.draftSeq + 1,
    }),
  };
});
workspaceNotesReducer.with(explicitNoteEditorReleased, (state, { payload: [viewId] }) => {
  const retired = retireExplicitEditors(state, (editor) => editor.viewId === viewId);
  return getItem(retired.explicitEditors, viewId) || retired.revokedEditorViews[viewId]
    ? retired
    : { ...retired, revokedEditorViews: { ...retired.revokedEditorViews, [viewId]: true } };
});
workspaceNotesReducer.with(explicitNoteEditorsRetired, (state) =>
  retireExplicitEditors(state, () => true),
);
workspaceNotesReducer.with(workspaceDeleted, (state, { payload: [workspaceId] }) =>
  retireExplicitCreators(
    retireExplicitEditors(state, (editor) => editor.workspaceId === workspaceId),
    (creator) => creator.workspaceId === workspaceId,
  ),
);
workspaceNotesReducer.with(explicitNoteSaveQueued, (state, { payload: [operation] }) => {
  if (getItem(state.explicitSaveOperations, operation.requestId)) return state;
  return { ...state, explicitSaveOperations: addItem(state.explicitSaveOperations, operation) };
});
workspaceNotesReducer.with(explicitNoteSaveStarted, (state, { payload: [requestId] }) => {
  const operation = getItem(state.explicitSaveOperations, requestId);
  if (operation?.status !== 'queued') return state;
  return {
    ...state,
    explicitSaveOperations: updateItem(state.explicitSaveOperations, {
      ...operation,
      status: 'running',
    }),
  };
});
workspaceNotesReducer.with(
  explicitNoteSaveSettled,
  (state, { payload: [requestId, status, echoedRev, error, deferredRebase] }) => {
    const operation = getItem(state.explicitSaveOperations, requestId);
    if (
      !operation ||
      operation.status === 'confirmed' ||
      operation.status === 'failed' ||
      (operation.status === status &&
        operation.echoedRev === echoedRev &&
        operation.error === error)
    )
      return state;
    const editor = getItem(state.explicitEditors, operation.viewId);
    return compactRetiredExplicitReceipts({
      ...state,
      explicitSaveOperations: updateItem(state.explicitSaveOperations, {
        ...operation,
        status,
        echoedRev,
        error,
        ...(deferredRebase && editor && !editor.retired ? { deferredRebase } : {}),
      }),
    });
  },
);
workspaceNotesReducer.with(
  explicitNoteContentAccepted,
  (state, { payload: [workspaceId, noteId, content, rev] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    const note = ws ? getItem(ws.notes, noteId as Note['id']) : undefined;
    if (
      !ws ||
      !note ||
      (note.rev !== undefined && note.rev > rev) ||
      (note.content === content && note.rev === rev)
    )
      return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      notes: updateItem(ws.notes, { ...note, content, rev }),
      notesVersion: ws.notesVersion + 1,
    });
  },
);
workspaceNotesReducer.with(explicitNoteSaveReconciled, (state, { payload: [requestId] }) => {
  const operation = getItem(state.explicitSaveOperations, requestId);
  if (!operation?.deferredRebase) return state;
  const { deferredRebase: _history, ...settled } = operation;
  return {
    ...state,
    explicitSaveOperations: replaceItem(state.explicitSaveOperations, requestId, settled),
  };
});
workspaceNotesReducer.with(
  explicitNoteDraftRebased,
  (state, { payload: [viewId, expectedSeq, content, baseContent, baseRev] }) => {
    const editor = getItem(state.explicitEditors, viewId);
    if (!editor || editor.retired || editor.draftSeq !== expectedSeq || editor.baseRev > baseRev)
      return state;
    if (
      editor.content === content &&
      editor.baseContent === baseContent &&
      editor.baseRev === baseRev
    )
      return state;
    return {
      ...state,
      explicitEditors: updateItem(state.explicitEditors, {
        ...editor,
        content,
        baseContent,
        baseRev,
      }),
    };
  },
);
workspaceNotesReducer.with(
  clearWorkspaceNotesForWorkspaces,
  (state, { payload: [workspaceIds] }) => {
    return workspaceIds.reduce((nextState, workspaceId) => {
      return clearWorkspaceState(
        retireExplicitCreators(
          retireExplicitEditors(nextState, (editor) => editor.workspaceId === workspaceId),
          (creator) => creator.workspaceId === workspaceId,
        ),
        workspaceId,
      );
    }, state);
  },
);
workspaceNotesReducer.with(
  setWorkspaceNotesLoading,
  (state, { payload: [workspaceIds, isLoading] }) => {
    return workspaceIds.reduce((nextState, workspaceId) => {
      const workspaceState = getWorkspaceState(nextState, workspaceId);
      if (workspaceState.loading === isLoading) {
        return nextState;
      }
      return setWorkspaceState(nextState, workspaceId, {
        ...workspaceState,
        loading: isLoading,
        error: isLoading ? null : workspaceState.error,
      });
    }, state);
  },
);
workspaceNotesReducer.with(
  loadWorkspaceNotesSucceeded,
  (state, { payload: [workspaceIds, notesByWorkspace] }) => {
    return workspaceIds.reduce((nextState, workspaceId) => {
      const workspaceState = getWorkspaceState(nextState, workspaceId);
      // Slim-projection merge (§5.2): a slim row carries no content, so when
      // the cache already holds the full body at the same rev, keep it — a
      // re-list must never clobber loaded content. A slim row with a newer
      // rev — or with either rev missing, since without both revs the cached
      // body cannot be proven current — wins as-is: the stale marker makes
      // content surfaces refetch on demand, which is safer than silently
      // keeping a possibly-outdated body whose contentPreview/contentLength
      // markers describe the new server content.
      const merged = (notesByWorkspace[workspaceId] ?? []).map((note) => {
        if (!isNoteContentStale(note)) return note;
        const existing = getItem(workspaceState.notes, note.id);
        if (!existing?.content) return note;
        if (note.rev === undefined || existing.rev === undefined || note.rev > existing.rev) {
          return note;
        }
        return { ...note, content: existing.content };
      });
      return setWorkspaceState(nextState, workspaceId, {
        ...workspaceState,
        notes: createCollection<Note, 'id'>('id', merged),
        loading: false,
        error: null,
        initialized: true,
        notesVersion: workspaceState.notesVersion + 1,
      });
    }, state);
  },
);
workspaceNotesReducer.with(
  loadWorkspaceNotesFailed,
  (state, { payload: [workspaceIds, error] }) => {
    return workspaceIds.reduce((nextState, workspaceId) => {
      const workspaceState = getWorkspaceState(nextState, workspaceId);
      return setWorkspaceState(nextState, workspaceId, {
        ...workspaceState,
        loading: false,
        error,
      });
    }, state);
  },
);
workspaceNotesReducer.with(
  applyTaskStatusChanged,
  (state, { payload: [workspaceId, noteId, newStatus] }) => {
    const workspaceState = state.byWorkspaceId[workspaceId];
    if (!workspaceState?.initialized) return state;

    const normalizedNoteId = noteId as Note['id'];
    const note = getItem(workspaceState.notes, normalizedNoteId);
    if (!note?.metadata?.task) return state;

    return setWorkspaceState(state, workspaceId, {
      ...workspaceState,
      notes: updateItem(workspaceState.notes, {
        id: note.id,
        metadata: {
          ...note.metadata,
          task: {
            ...note.metadata.task,
            status: newStatus,
          },
        },
      }),
      notesVersion: workspaceState.notesVersion + 1,
    });
  },
);
workspaceNotesReducer.with(applyNoteCreated, (state, { payload: [workspaceId, note] }) => {
  const workspaceState = state.byWorkspaceId[workspaceId];
  if (!workspaceState?.initialized) return state;

  const { [note.id]: _deleted, ...remainingDeletedIds } = workspaceState.deletedNoteIds;
  return setWorkspaceState(state, workspaceId, {
    ...workspaceState,
    notes: addItem(workspaceState.notes, note),
    deletedNoteIds: _deleted ? remainingDeletedIds : workspaceState.deletedNoteIds,
    notesVersion: workspaceState.notesVersion + 1,
  });
});
workspaceNotesReducer.with(applyNoteDeleted, (state, { payload: [workspaceId, noteId] }) => {
  state = retireExplicitEditors(
    state,
    (editor) => editor.workspaceId === workspaceId && editor.noteId === noteId,
  );
  const workspaceState = state.byWorkspaceId[workspaceId];
  if (!workspaceState?.initialized) return state;

  const notes = removeItem(workspaceState.notes, noteId as Note['id']);
  if (notes === workspaceState.notes && workspaceState.deletedNoteIds[noteId]) return state;

  return setWorkspaceState(state, workspaceId, {
    ...workspaceState,
    notes,
    deletedNoteIds: { ...workspaceState.deletedNoteIds, [noteId]: true },
    notesVersion: workspaceState.notesVersion + (notes === workspaceState.notes ? 0 : 1),
  });
});
workspaceNotesReducer.with(applyNoteUpdated, (state, { payload: [workspaceId, noteId, note] }) => {
  if (note.workspaceId !== workspaceId) return state;

  const workspaceState = getWorkspaceState(state, workspaceId);
  const existingNote = getItem(workspaceState.notes, noteId as Note['id']);

  // Rev gate (monorepo#533): a refetch triggered by an older `note:updated`
  // event can land after a newer state was already applied (or after
  // `advanceNoteRev` recorded a daemon ack). A strictly-lower rev is
  // definitively stale — dropping it prevents reverting newer content.
  if (existingNote?.rev !== undefined && note.rev !== undefined && note.rev < existingNote.rev) {
    return state;
  }

  return setWorkspaceState(state, workspaceId, {
    ...workspaceState,
    notes: upsertItem(workspaceState.notes, {
      ...note,
      id: existingNote?.id ?? (noteId as Note['id']),
    }),
    notesVersion: workspaceState.notesVersion + 1,
  });
});
// ---- New reducers from notes.store.svelte.ts migration ----
workspaceNotesReducer.with(selectNote, (state, { payload: [workspaceId, noteId] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  if (ws.selectedNoteId === noteId) return state;
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    selectedNoteId: noteId,
    isUserTyping: false,
    editorHasFocus: false,
  });
});
workspaceNotesReducer.with(setIsUserTyping, (state, { payload: [workspaceId, isTyping] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  if (ws.isUserTyping === isTyping) return state;
  return setWorkspaceState(state, workspaceId, { ...ws, isUserTyping: isTyping });
});
workspaceNotesReducer.with(setLastUserInputTime, (state, { payload: [workspaceId, timestamp] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, { ...ws, lastUserInputTime: timestamp });
});
workspaceNotesReducer.with(clearNewlyCreatedNoteId, (state, { payload: [workspaceId] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  if (ws.newlyCreatedNoteId === null) return state;
  return setWorkspaceState(state, workspaceId, { ...ws, newlyCreatedNoteId: null });
});
workspaceNotesReducer.with(applyLocalNoteUpdate, (state, { payload }) => {
  const { workspaceId, noteId, updates, timestamp } = payload;
  const ws = getWorkspaceState(state, workspaceId);
  const existing = getItem(ws.notes, noteId as Note['id']);
  if (!existing) return state;
  const updatedNote = { ...existing, ...updates, updatedAt: timestamp };
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    notes: updateItem(ws.notes, updatedNote),
    notesVersion: ws.notesVersion + 1,
  });
});
workspaceNotesReducer.with(addOptimisticNote, (state, { payload: [workspaceId, note] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    notes: upsertItem(ws.notes, note),
    newlyCreatedNoteId: note.id,
    notesVersion: ws.notesVersion + 1,
  });
});
workspaceNotesReducer.with(removeOptimisticNote, (state, { payload: [workspaceId, noteId] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  const notes = removeItem(ws.notes, noteId as Note['id']);
  if (notes === ws.notes) return state;
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    notes,
    newlyCreatedNoteId: ws.newlyCreatedNoteId === noteId ? null : ws.newlyCreatedNoteId,
    notesVersion: ws.notesVersion + 1,
  });
});
workspaceNotesReducer.with(
  setNoteContentPending,
  (state, { payload: [workspaceId, noteId, pending] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    const currentlyPending = ws.pendingContentByNoteId[noteId] === true;
    if (currentlyPending === pending) return state;
    const pendingContentByNoteId = { ...ws.pendingContentByNoteId };
    if (pending) pendingContentByNoteId[noteId] = true;
    else delete pendingContentByNoteId[noteId];
    return setWorkspaceState(state, workspaceId, { ...ws, pendingContentByNoteId });
  },
);

workspaceNotesReducer.with(
  noteContentViewRequested,
  (state, { payload: [consumerId, requestId, workspaceId, noteId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    const next: NoteUiRequestState = {
      consumerId,
      requestId,
      workspaceId,
      noteId,
      authority: null,
      status: 'loading',
    };
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      contentViews: upsertItem(ws.contentViews, next),
    });
  },
);
workspaceNotesReducer.with(
  noteContentViewFinished,
  (state, { payload: [workspaceId, consumerId, requestId, authority, error] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    const current = ws ? getItem(ws.contentViews, consumerId) : undefined;
    if (!ws || !current || current.requestId !== requestId) return state;
    const next: NoteUiRequestState = {
      ...current,
      authority,
      status: error ? 'error' : 'ready',
    };
    if (error) next.error = error;
    else delete next.error;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      contentViews: replaceItem(ws.contentViews, consumerId, next),
    });
  },
);
workspaceNotesReducer.with(
  noteContentViewReleased,
  (state, { payload: [workspaceId, consumerId] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    if (!ws || !getItem(ws.contentViews, consumerId)) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      contentViews: removeItem(ws.contentViews, consumerId),
    });
  },
);
workspaceNotesReducer.with(
  noteWorkspaceRootRequested,
  (state, { payload: [consumerId, requestId, workspaceId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      workspaceRoots: upsertItem(ws.workspaceRoots, {
        consumerId,
        requestId,
        workspaceId,
        authority: null,
        status: 'loading',
        path: null,
      }),
    });
  },
);
workspaceNotesReducer.with(
  noteWorkspaceRootFinished,
  (state, { payload: [workspaceId, consumerId, requestId, authority, path, error] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    const current = ws ? getItem(ws.workspaceRoots, consumerId) : undefined;
    if (!ws || !current || current.requestId !== requestId) return state;
    const next = {
      ...current,
      authority,
      path,
      status: error ? ('error' as const) : ('ready' as const),
    };
    if (error) next.error = error;
    else delete next.error;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      workspaceRoots: replaceItem(ws.workspaceRoots, consumerId, next),
    });
  },
);
workspaceNotesReducer.with(
  noteWorkspaceRootReleased,
  (state, { payload: [workspaceId, consumerId] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    if (!ws || !getItem(ws.workspaceRoots, consumerId)) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      workspaceRoots: removeItem(ws.workspaceRoots, consumerId),
    });
  },
);
workspaceNotesReducer.with(
  notePresenceViewRequested,
  (state, { payload: [consumerId, requestId, workspaceId, noteId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      presenceViews: upsertItem(ws.presenceViews, {
        consumerId,
        requestId,
        workspaceId,
        noteId,
        authority: null,
        status: 'loading',
        viewers: createCollection('principalId'),
      }),
    });
  },
);
workspaceNotesReducer.with(
  notePresenceViewersReceived,
  (state, { payload: [workspaceId, consumerId, requestId, authority, viewers] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    const current = ws ? getItem(ws.presenceViews, consumerId) : undefined;
    if (!ws || !current || current.requestId !== requestId) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      presenceViews: upsertItem(ws.presenceViews, {
        ...current,
        authority,
        status: 'ready',
        viewers: createCollection('principalId', viewers),
      }),
    });
  },
);
workspaceNotesReducer.with(
  notePresenceViewReleased,
  (state, { payload: [workspaceId, consumerId] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    if (!ws || !getItem(ws.presenceViews, consumerId)) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      presenceViews: removeItem(ws.presenceViews, consumerId),
    });
  },
);
workspaceNotesReducer.with(
  noteAttributionViewRequested,
  (state, { payload: [consumerId, requestId, workspaceId, noteId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      attributionViews: upsertItem(ws.attributionViews, {
        consumerId,
        requestId,
        workspaceId,
        noteId,
        authority: null,
        status: 'loading',
        data: null,
      }),
    });
  },
);
workspaceNotesReducer.with(
  noteAttributionViewFinished,
  (state, { payload: [consumerId, requestId, workspaceId, authority, data, error] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    const current = ws ? getItem(ws.attributionViews, consumerId) : undefined;
    if (!ws || !current || current.requestId !== requestId) return state;
    const next: NoteAttributionViewState = {
      ...current,
      authority,
      data,
      status: error ? 'error' : 'ready',
    };
    if (error) next.error = error;
    else delete next.error;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      attributionViews: replaceItem(ws.attributionViews, consumerId, next),
    });
  },
);
workspaceNotesReducer.with(
  noteAttributionViewReleased,
  (state, { payload: [workspaceId, consumerId] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    if (!ws || !getItem(ws.attributionViews, consumerId)) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      attributionViews: removeItem(ws.attributionViews, consumerId),
    });
  },
);
workspaceNotesReducer.with(fetchNoteVersions, (state, { payload: [workspaceId, noteId] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    noteVersions: {
      versions: ws.noteVersions?.noteId === noteId ? ws.noteVersions.versions : [],
      loading: true,
      error: null,
      noteId,
    },
  });
});
workspaceNotesReducer.with(
  applyNoteVersions,
  (state, { payload: [workspaceId, noteId, versions] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      noteVersions: {
        versions,
        loading: false,
        error: null,
        noteId,
      },
    });
  },
);
workspaceNotesReducer.with(applyNoteVersionsError, (state, { payload: [workspaceId, error] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    noteVersions: {
      versions: ws.noteVersions?.versions ?? [],
      loading: false,
      error,
      noteId: ws.noteVersions?.noteId ?? null,
    },
  });
});
workspaceNotesReducer.with(fetchReadyTasks, (state, { payload: [workspaceId] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  if (ws.readyTasks?.loading) return state; // Already loading, no change
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    readyTasks: {
      tasks: ws.readyTasks?.tasks ?? [],
      loading: true,
      error: null,
      searched: ws.readyTasks?.searched ?? false,
    },
  });
});
workspaceNotesReducer.with(applyReadyTasks, (state, { payload: [workspaceId, tasks] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    readyTasks: {
      tasks,
      loading: false,
      error: null,
      searched: true,
    },
  });
});
workspaceNotesReducer.with(applyReadyTasksError, (state, { payload: [workspaceId, error] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    readyTasks: {
      tasks: [],
      loading: false,
      error,
      searched: true,
    },
  });
});
workspaceNotesReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(
    retireExplicitCreators(
      retireExplicitEditors(state, (editor) => editor.workspaceId === wsId),
      (creator) => creator.workspaceId === wsId,
    ),
    wsId,
  ),
);
