import type { Note } from '../../../shared/types';
import { isProjectionRejected } from '../../../shared/utils/note-content';
import type { NotesClient } from '../app-client';
import type { BackendTransport } from './backend-transport-types';
import { normalizeNote } from './note-normalization';

/** Canonical note reads, with transport and workspace discovery owned by the renderer. */
export function createBackendNotesReadClient({
  backendRequest,
  rememberNoteWorkspace,
  resolveNoteWorkspaceId,
}: {
  backendRequest: BackendTransport['request'];
  rememberNoteWorkspace: (noteId: string, workspaceId: string) => void;
  resolveNoteWorkspaceId: (noteId: string) => Promise<string | null>;
}): Pick<NotesClient, 'list' | 'get'> {
  return {
    async list(workspaceId: string, options?: { projection?: 'full' | 'slim' }): Promise<Note[]> {
      // §5.2 `projection`: only ride the wire when "slim" is requested so older
      // daemons see an unchanged request. If a daemon rejects the unknown param
      // (-32602 Invalid params), fall back once to the plain full list; other
      // failures (transport, workspace not found) propagate unchanged.
      let result: { notes?: unknown[] } | null;
      if (options?.projection === 'slim') {
        try {
          result = await backendRequest<{ notes?: unknown[] }>('note.list', {
            workspaceId,
            projection: 'slim',
          });
        } catch (error) {
          if (!isProjectionRejected(error)) throw error;
          result = await backendRequest<{ notes?: unknown[] }>('note.list', { workspaceId });
        }
      } else {
        result = await backendRequest<{ notes?: unknown[] }>('note.list', { workspaceId });
      }
      const notes = Array.isArray(result?.notes) ? result.notes : [];
      return notes.map((n) => {
        const note = normalizeNote(n as Record<string, unknown>, workspaceId);
        rememberNoteWorkspace(String(note.id), workspaceId);
        return note;
      });
    },

    async get(noteId: string, explicitWorkspaceId?: string): Promise<Note | null> {
      // The caller's workspaceId wins over the resolver cache — note ids are not
      // globally unique (every workspace has a `spec` note) and the cache is
      // last-writer-wins across workspaces (monorepo#621).
      const workspaceId = explicitWorkspaceId ?? (await resolveNoteWorkspaceId(noteId));
      if (!workspaceId) return null;
      try {
        const result = await backendRequest<{ note?: unknown } | unknown>('note.get', {
          workspaceId,
          noteId,
        });
        const raw =
          result && typeof result === 'object' && 'note' in result
            ? (result as { note?: unknown }).note
            : result;
        if (!raw || typeof raw !== 'object') return null;
        return normalizeNote(raw as Record<string, unknown>, workspaceId);
      } catch {
        return null;
      }
    },
  };
}
