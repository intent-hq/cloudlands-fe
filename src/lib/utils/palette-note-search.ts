/** Indexed global note queries for the palette (search.notes, PROTOCOL §5.15). */
import { buildMessageTitleSegments } from '$store/renderer/slices/command-palette/command-palette-utils';
import type { PaletteNoteSearchUpdate } from '$store/renderer/slices/palette/palette-types';

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

export type NoteQueryUpdate = PaletteNoteSearchUpdate;

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
