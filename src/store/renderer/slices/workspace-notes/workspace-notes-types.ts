import type { NoteDeleteView, NoteDeleteRecoveryDraft } from './note-delete-state';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { Note, NoteVersion } from '$shared/types';

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
