import type { Collection } from "../../utils/collection-utils";
import type { Note, NoteVersion } from "$shared/types";

export type NoteVersionsState = {
  versions: NoteVersion[];
  loading: boolean;
  error: string | null;
  noteId: string | null;
};

export type ReadyTasksState = {
  tasks: Note[];
  loading: boolean;
  error: string | null;
  searched: boolean;
};

export type WorkspaceNotesWorkspaceState = {
  notes: Collection<Note, "id">;
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

/**
 * Content update event dispatched via window CustomEvent.
 * Used for editor synchronization — replaces the old callback-based system.
 */
export type NoteContentUpdateEvent = {
  noteId: string;
  content: string;
  source: "agent" | "external";
  workspaceId: string;
};

