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
  retainedDrafts: Record<string, RetainedNoteDraft>;
  byWorkspaceId: Record<string, WorkspaceNotesWorkspaceState>;
};
