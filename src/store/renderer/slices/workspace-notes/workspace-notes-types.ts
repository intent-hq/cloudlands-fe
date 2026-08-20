import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';
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
};

export type WorkspaceNotesState = {
  byWorkspaceId: Record<string, WorkspaceNotesWorkspaceState>;
};
