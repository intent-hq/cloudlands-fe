import { ContentType, NoteVisibility, type Note, type TaskStatus } from '../../shared/types';
import { SPEC_NOTE_ID } from '../../shared/constants/notes';

const statuses: readonly string[] = [
  'not_started',
  'waiting',
  'discussion_needed',
  'blocked',
  'in_progress',
  'review_required',
  'complete',
  'cancelled',
];
export const isTaskStatus = (value: unknown): value is TaskStatus =>
  typeof value === 'string' && statuses.includes(value);

/** Bounded status controls apply only to existing ordinary, unassigned workspace task notes. */
export const isTaskStatusEditable = (note: Note | undefined): note is Note & { rev: number } =>
  !!note &&
  note.id !== SPEC_NOTE_ID &&
  !note.isDefault &&
  !note.isArchived &&
  note.contentType === ContentType.Markdown &&
  note.visibility === NoteVisibility.Workspace &&
  isTaskStatus(note.metadata?.task?.status) &&
  !note.metadata?.task?.assignedAgentIds?.length &&
  typeof note.rev === 'number' &&
  Number.isSafeInteger(note.rev) &&
  note.rev >= 0;
