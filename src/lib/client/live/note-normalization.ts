import { ContentType, NoteVisibility, type Note } from '../../../shared/types';
import { NoteId, WorkspaceId } from '../../../shared/types/branded-ids';

/** Coerce a raw daemon note object into the renderer `Note` shape. */
export function normalizeNote(raw: Record<string, unknown>, workspaceId: string): Note {
  const now = new Date().toISOString();
  const id = String(raw.id ?? '');
  return {
    ...(raw as Partial<Note>),
    id: NoteId(id),
    workspaceId: WorkspaceId(String(raw.workspaceId ?? workspaceId)),
    title: String(raw.title ?? ''),
    content: String(raw.content ?? ''),
    contentType: (typeof raw.contentType === 'string'
      ? raw.contentType
      : ContentType.Markdown) as ContentType,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    isPinned: Boolean(raw.isPinned ?? raw.is_pinned ?? false),
    isArchived: Boolean(raw.isArchived ?? raw.is_archived ?? false),
    visibility: (typeof raw.visibility === 'string'
      ? raw.visibility
      : NoteVisibility.Workspace) as NoteVisibility,
    // Optimistic-concurrency revision (§11.4-D): carried through when the daemon
    // returns a number, forced to undefined otherwise (overriding the raw spread)
    // so a malformed value can never leak — no behavior change → last-writer-wins.
    rev: typeof raw.rev === 'number' ? raw.rev : undefined,
    // Slim-projection fields (§5.2 `projection: "slim"`): carried through only
    // when the daemon returned them, undefined otherwise (overriding the raw
    // spread) so full rows never carry stale slim markers.
    contentPreview: typeof raw.contentPreview === 'string' ? raw.contentPreview : undefined,
    contentLength: typeof raw.contentLength === 'number' ? raw.contentLength : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? now),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? now),
  } as Note;
}
