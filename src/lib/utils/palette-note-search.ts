/** Indexed global note queries for the palette (search.notes, PROTOCOL §5.15). */
import { buildMessageTitleSegments } from '$store/renderer/slices/command-palette/command-palette-utils';
import { store as appStore } from '$store/renderer/store';
import { searchNotesRequested } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';

const NOTE_QUERY_DEBOUNCE_MS = 150;
const NOTE_RESULT_LIMIT = 10;

/** Required fields on an indexed daemon hit; preview is text, never trusted HTML. */
export interface IndexedNoteMatch {
  noteId: string;
  workspaceId: string;
  title: string;
  preview: string;
  score: number;
  updatedAt: string;
  isArchived: boolean;
  workspaceArchived: boolean;
}

export interface IndexedNoteSearchResponse {
  requestId: string;
  indexed: true;
  matches: IndexedNoteMatch[];
}

export type NoteSearchWorkspace = NonNullable<Parameters<typeof buildMessageTitleSegments>[0]>;

/** Presentation data only: navigation must use workspaceId + noteId, never id. */
interface NoteQueryItem {
  id: string;
  type: 'note';
  noteId: string;
  workspaceId: string;
  label: string;
  /** Plain text; render with text interpolation, not {@html}. */
  description: string;
  score: number;
  updatedAt: string;
  isArchived: boolean;
  isArchivedWorkspace: boolean;
  workspaceName?: string;
  repoLabel?: string;
}

export interface NoteQueryUpdate {
  items: NoteQueryItem[];
  loading: boolean;
  capability: 'unknown' | 'indexed' | 'legacy';
  /** Local title/tag discovery remains available when indexed results cannot be used. */
  fallback: boolean;
  error?: unknown;
}

function isIndexedNoteMatch(value: unknown): value is IndexedNoteMatch {
  if (!value || typeof value !== 'object') return false;
  const hit = value as Record<string, unknown>;
  return (
    typeof hit.noteId === 'string' &&
    hit.noteId.length > 0 &&
    typeof hit.workspaceId === 'string' &&
    hit.workspaceId.length > 0 &&
    typeof hit.title === 'string' &&
    typeof hit.preview === 'string' &&
    typeof hit.score === 'number' &&
    Number.isFinite(hit.score) &&
    typeof hit.updatedAt === 'string' &&
    typeof hit.isArchived === 'boolean' &&
    typeof hit.workspaceArchived === 'boolean'
  );
}

/**
 * Detect capability even for zero hits. Never infer ownership for legacy hits.
 * An indexed response violating its required hit shape is an error, not a legacy hit.
 */
export function adaptNoteSearchResponse(
  response: unknown,
  workspaceItems: readonly NoteSearchWorkspace[],
): NoteQueryUpdate {
  if (
    !response ||
    typeof response !== 'object' ||
    !('indexed' in response) ||
    response.indexed !== true
  ) {
    return { items: [], loading: false, capability: 'legacy', fallback: true };
  }
  if (
    !('matches' in response) ||
    !Array.isArray(response.matches) ||
    !response.matches.every(isIndexedNoteMatch)
  ) {
    throw new TypeError('Invalid indexed search.notes response');
  }
  const workspaces = new Map(workspaceItems.map((workspace) => [workspace.id, workspace]));
  return {
    loading: false,
    capability: 'indexed',
    fallback: false,
    // Keep backend rank order; the cap also bounds an unexpectedly oversized response.
    items: response.matches.slice(0, NOTE_RESULT_LIMIT).map((hit: IndexedNoteMatch) => ({
      // Tuple encoding avoids collisions even when either identifier contains a colon.
      id: JSON.stringify([hit.workspaceId, hit.noteId]),
      type: 'note',
      noteId: hit.noteId,
      workspaceId: hit.workspaceId,
      label: hit.title,
      description: hit.preview,
      score: hit.score,
      updatedAt: hit.updatedAt,
      isArchived: hit.isArchived,
      ...buildMessageTitleSegments(workspaces.get(hit.workspaceId)),
      // The search response owns archive state, including when metadata is missing/stale.
      isArchivedWorkspace: hit.workspaceArchived,
    })),
  };
}

export interface NoteQueryController {
  /** Global search with a soft active-workspace preference. Empty terms clear immediately. */
  query(
    term: string,
    preferWorkspaceId: string | undefined,
    workspaceItems: readonly NoteSearchWorkspace[],
  ): void;
  /** Invalidate queued and in-flight work, then emit empty idle state. */
  clear(): void;
  /** Invalidate queued and in-flight work without emitting (effect cleanup/unmount). */
  cancel(): void;
  /** Palette close: clear state and invalidate work. The controller may be reused on reopen. */
  close(): void;
}

/**
 * Full snapshots are emitted on query/clear/close and after the current request settles.
 * A new query immediately discards prior rows, including on a workspace switch.
 * Cancellation is logical: transport requests may finish but can no longer publish.
 */
export function createNoteQuery(onUpdate: (update: NoteQueryUpdate) => void): NoteQueryController {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const cancel = () => {
    ++generation;
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
  };
  const clear = () => {
    cancel();
    onUpdate({ items: [], loading: false, capability: 'unknown', fallback: true });
  };

  return {
    query(term, preferWorkspaceId, workspaceItems) {
      if (!term.trim()) {
        clear();
        return;
      }
      cancel();
      const id = generation;
      const workspaces = workspaceItems.map((workspace) => ({ ...workspace }));
      onUpdate({ items: [], loading: true, capability: 'unknown', fallback: true });
      timeout = setTimeout(async () => {
        timeout = null;
        let update: NoteQueryUpdate;
        try {
          const response = await appStore.dispatch(searchNotesRequested(term, preferWorkspaceId));
          if (id !== generation) return;
          update = adaptNoteSearchResponse(response, workspaces);
        } catch (error) {
          update = { items: [], loading: false, capability: 'unknown', fallback: true, error };
        }
        if (id === generation) onUpdate(update);
      }, NOTE_QUERY_DEBOUNCE_MS);
    },
    clear,
    cancel,
    close: clear,
  };
}
