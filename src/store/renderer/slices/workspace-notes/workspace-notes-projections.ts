import { MAX_CODE_EDITOR_CONTENT_SIZE } from '../../../../lib/utils/code-editor-policy';
import type {
  ExplicitNoteEditorIdentity,
  ExplicitNoteCreatorIdentity,
} from './workspace-notes-types';
import { ContentType, NoteVisibility, type CreateNoteRequest } from '../../../../shared/types';
import { SPEC_NOTE_ID } from '../../../../shared/constants/notes';
import { isNoteContentStale } from '../../../../shared/utils/note-content';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { Note } from '../../../../shared/types';
import { emptyWorkspaceNotesState } from './workspace-notes-slice';
import type { WorkspaceNotesState, WorkspaceNotesWorkspaceState } from './workspace-notes-types';

type WorkspaceNotesProjectionState = { workspaceNotes: WorkspaceNotesState };

export const getWorkspaceNotesState = (
  state: WorkspaceNotesProjectionState,
  workspaceId: string,
): WorkspaceNotesWorkspaceState =>
  state.workspaceNotes.byWorkspaceId[workspaceId] ?? emptyWorkspaceNotesState;

export const getNoteContentView = (
  state: WorkspaceNotesProjectionState,
  workspaceId: string,
  consumerId: string,
) =>
  getItem(
    state.workspaceNotes.byWorkspaceId[workspaceId]?.contentViews ??
      emptyWorkspaceNotesState.contentViews,
    consumerId,
  );

export const getNoteById = (
  state: WorkspaceNotesProjectionState,
  workspaceId: string | null | undefined,
  noteId: string | null | undefined,
): Note | undefined => {
  if (!workspaceId || !noteId) return undefined;
  const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
  if (!ws) return undefined;
  return getItem(ws.notes, noteId as Note['id']);
};

export const getAllNotes = (
  state: WorkspaceNotesProjectionState,
  workspaceId?: string | null,
): Note[] => {
  if (!workspaceId) return [];
  const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
  if (!ws) return [];
  return getItems(ws.notes);
};

export const getExplicitNoteEditor = (state: WorkspaceNotesProjectionState, viewId: string) =>
  getItem(state.workspaceNotes.explicitEditors, viewId);

export const getExplicitNoteCreator = (state: WorkspaceNotesProjectionState, viewId: string) =>
  getItem(state.workspaceNotes.explicitCreators, viewId);

/** Omit authority only for conservative workspace-wide admission; UI receipts require it. */
export const getExplicitNoteCreateOperations = (
  state: WorkspaceNotesProjectionState,
  workspaceId: string,
  authority?: string,
) =>
  getItems(state.workspaceNotes.explicitCreateOperations).filter(
    (operation) =>
      operation.workspaceId === workspaceId &&
      (authority === undefined || operation.authority === authority),
  );

export const getExplicitNoteCreatorCurrent = (
  state: WorkspaceNotesProjectionState,
  identity: ExplicitNoteCreatorIdentity,
) => {
  const creator = getExplicitNoteCreator(state, identity.viewId);
  return (
    !!creator &&
    !state.workspaceNotes.revokedCreatorViews[identity.viewId] &&
    creator.workspaceId === identity.workspaceId &&
    creator.authority === identity.authority &&
    creator.context === identity.context
  );
};

/** The explicit creation flow creates only an ordinary, initially empty Markdown note. */
export function isExplicitNoteCreationSupported(
  data: Omit<CreateNoteRequest, 'workspaceId'>,
): boolean {
  return (
    typeof data.title === 'string' &&
    data.title.trim().length > 0 &&
    isExplicitNoteContentSupported(data.title) &&
    data.content === '' &&
    (data.contentType === undefined || data.contentType === ContentType.Markdown) &&
    (data.tags === undefined || (Array.isArray(data.tags) && data.tags.length === 0)) &&
    data.parentId === undefined &&
    (data.visibility === undefined || data.visibility === NoteVisibility.Workspace)
  );
}

export const getExplicitNoteSaveOperations = (
  state: WorkspaceNotesProjectionState,
  workspaceId: string,
  noteId: string,
) =>
  getItems(state.workspaceNotes.explicitSaveOperations).filter(
    (operation) => operation.workspaceId === workspaceId && operation.noteId === noteId,
  );

export const getExplicitNoteEditorCurrent = (
  state: WorkspaceNotesProjectionState,
  identity: ExplicitNoteEditorIdentity,
) => {
  const editor = getExplicitNoteEditor(state, identity.viewId);
  return (
    !!editor &&
    !editor.retired &&
    !state.workspaceNotes.revokedEditorViews[identity.viewId] &&
    editor.workspaceId === identity.workspaceId &&
    editor.noteId === identity.noteId &&
    editor.authority === identity.authority &&
    editor.context === identity.context
  );
};

/** The bounded explicit editor excludes structural/task/rich notes and unloaded slim rows. */
export const isEditableMarkdownNote = (note: Note | undefined): note is Note & { rev: number } =>
  !!note &&
  note.id !== SPEC_NOTE_ID &&
  !note.metadata?.task &&
  !note.isDefault &&
  note.contentType === ContentType.Markdown &&
  isExplicitNoteContentSupported(note.content) &&
  !isNoteContentStale(note) &&
  typeof note.rev === 'number' &&
  Number.isSafeInteger(note.rev) &&
  note.rev >= 0;

/** Bound the source editor and prevent note.setContent's task-conversion side effect. */
export function isExplicitNoteContentSupported(content: string): boolean {
  if (
    typeof content !== 'string' ||
    content.includes(String.fromCharCode(0)) ||
    /@@@tasks?\b/u.test(content)
  )
    return false;
  const encoded = new TextEncoder().encode(content);
  return (
    encoded.byteLength <= MAX_CODE_EDITOR_CONTENT_SIZE &&
    new TextDecoder().decode(encoded) === content
  );
}
