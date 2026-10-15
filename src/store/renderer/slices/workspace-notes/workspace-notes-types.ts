import type { SagaGenerator } from 'typed-redux-saga';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { Note, NoteVersion } from '$shared/types';
import type { LineAttributionData } from '../../../../lib/client/app-client';

export type NoteUiRequestState = {
  consumerId: string;
  requestId: string;
  workspaceId: string;
  noteId: string;
  authority: string | null;
  status: 'loading' | 'ready' | 'error';
  error?: string;
};

type NoteContentViewState = NoteUiRequestState;

type NoteWorkspaceRootState = Omit<NoteUiRequestState, 'noteId'> & {
  path: string | null;
};

export type NotePresenceViewer = {
  principalId: string;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  cursor: { rev: number; anchor: number; head: number } | null;
  cursorSeenAt: number | null;
};

type NotePresenceViewState = NoteUiRequestState & {
  viewers: Collection<NotePresenceViewer, 'principalId'>;
};

export type NoteAttributionViewState = NoteUiRequestState & {
  data: LineAttributionData | null;
};

export type NoteVersionsState = {
  versions: NoteVersion[];
  loading: boolean;
  error: string | null;
  noteId: string | null;
};

type ReadyTasksState = {
  tasks: Note[];
  loading: boolean;
  error: string | null;
  searched: boolean;
};

export type WorkspaceNotesWorkspaceState = {
  notes: Collection<Note, 'id'>;
  loading: boolean;
  error: string | null;
  initialized: boolean;
  selectedNoteId: string | null;
  isUserTyping: boolean;
  lastUserInputTime: number;
  editorHasFocus: boolean;
  newlyCreatedNoteId: string | null;
  notesVersion: number;
  noteVersions: NoteVersionsState | null;
  readyTasks: ReadyTasksState | null;
  pendingContentByNoteId: Record<string, true>;
  contentViews: Collection<NoteContentViewState, 'consumerId'>;
  workspaceRoots: Collection<NoteWorkspaceRootState, 'consumerId'>;
  presenceViews: Collection<NotePresenceViewState, 'consumerId'>;
  attributionViews: Collection<NoteAttributionViewState, 'consumerId'>;
};

export type WorkspaceNotesState = {
  byWorkspaceId: Record<string, WorkspaceNotesWorkspaceState>;
  /** Draft/base history survives reconnects, but is discarded on genuine view departure. */
  explicitEditors: Collection<ExplicitNoteEditor, 'viewId'>;
  /** Unresolved operations survive departure; known retired receipts compact to one per note. */
  explicitSaveOperations: Collection<ExplicitNoteSaveOperation, 'requestId'>;
  /** Permanent ID-only tombstones fence departed views without retaining their bodies. */
  revokedEditorViews: Record<string, true>;
};

/** The source writer contributes sibling commands to the same per-note FIFO. */
export type NotesWriteQueue = {
  enqueue(
    workspaceId: string,
    noteId: string,
    run: () => SagaGenerator<unknown>,
  ): SagaGenerator<unknown>;
  flush(workspaceId: string, noteId: string): SagaGenerator<unknown>;
};

export type ExplicitNoteEditorIdentity = {
  workspaceId: string;
  noteId: string;
  viewId: string;
  authority: string;
  context: string;
};
export type ExplicitNoteEditor = ExplicitNoteEditorIdentity & {
  baseContent: string;
  baseRev: number;
  content: string;
  draftSeq: number;
  retired: boolean;
  retiredContexts: string[];
};
export type ExplicitNoteSaveRequest = ExplicitNoteEditorIdentity & {
  requestId: string;
  draftSeq: number;
};
export type ExplicitNoteSaveOperation = ExplicitNoteSaveRequest & {
  baseRev: number;
  status: 'queued' | 'running' | 'confirmed' | 'failed' | 'unknown';
  echoedRev?: number;
  /** Necessary merge history while a confirmed receipt cannot yet be applied to its surviving draft. */
  deferredRebase?: { sentContent: string; content: string; rev: number };
  error?: string;
};
