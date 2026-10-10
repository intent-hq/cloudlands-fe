import type { NoteDeleteView, NoteDeleteRecoveryDraft } from './note-delete-state';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { Note, NoteVersion } from '$shared/types';
import type { LineAttributionData } from '$lib/client';

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
  /** Unique within this store; renewed after workspace removal/reuse. */
  publicationLifetime?: number;
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
  /** Fences responses issued before a confirmed deletion; no per-note tombstone history. */
  deleteReadAuthority?: string;
  noteVersions: NoteVersionsState | null;
  readyTasks: ReadyTasksState | null;
  specDeleted: boolean;
  specTaskLinksGeneration: number;
  specTaskLinks: string[] | null;
  pendingContentByNoteId: Record<string, true>;
  contentViews: Collection<NoteContentViewState, 'consumerId'>;
  workspaceRoots: Collection<NoteWorkspaceRootState, 'consumerId'>;
  presenceViews: Collection<NotePresenceViewState, 'consumerId'>;
  attributionViews: Collection<NoteAttributionViewState, 'consumerId'>;
};

export type RetainedNoteDraft = {
  workspaceId: string;
  noteId: string;
  content: string;
  rev?: number;
  error?: string;
};

export type WorkspaceNotesState = {
  /** Exhausted authority must never be recycled into a publishable owner. */
  publicationAuthorityExhausted?: boolean;
  /** Monotone allocator for absence boundaries, independent of retained operation owners. */
  deleteReadAuthoritySequence?: number;
  /** Bounded allocator, not a map of retired workspace IDs. */
  nextPublicationLifetime?: number;
  deleteObservationErrors?: Record<string, string>;
  deleteObservationPaused?: Record<string, number>;
  deleteObservationChecking?: Record<string, number>;
  deleteOperations?: Record<string, NoteDeleteView>;
  deleteRecoveryReservations?: Record<string, true>;
  deleteRecoveryDrafts?: Record<string, NoteDeleteRecoveryDraft>;
  retainedDrafts: Record<string, RetainedNoteDraft>;
  byWorkspaceId: Record<string, WorkspaceNotesWorkspaceState>;
};
