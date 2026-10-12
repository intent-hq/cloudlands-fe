import { isProjectionRejected } from '../../../shared/utils/note-content';
import type { BackendTransport } from './backend-transport-types';

/** One note-discovery owner shared by all note-scoped clients in a renderer. */
export function createNoteWorkspaceDiscovery({
  backendRequest,
  listWorkspaceIdsOrThrow,
}: {
  backendRequest: BackendTransport['request'];
  listWorkspaceIdsOrThrow: (tag: string) => Promise<string[]>;
}) {
  /** noteId → workspaceId, populated as notes are listed so note-scoped reads resolve. */
  const noteWorkspaceIndex = new Map<string, string>();

  /**
   * Record the workspace a note belongs to (called from `LiveNotesClient.list`).
   * Discovering a note also clears any negative-cache entry for it so a note
   * that appears within the negative TTL resolves immediately.
   */
  function rememberNoteWorkspace(noteId: string, workspaceId: string): void {
    if (noteId && workspaceId) {
      noteWorkspaceIndex.set(noteId, workspaceId);
      noteResolveNegativeCache.delete(noteId);
    }
  }

  /**
   * Negative-cache TTL for `resolveNoteWorkspaceId`: a noteId no workspace
   * claimed is remembered for this long so repeated resolution attempts (e.g.
   * a component retrying a dangling note reference) don't re-scan every
   * workspace's `note.list` back to back (intent-hq/monorepo#1716).
   */
  const NOTE_RESOLVE_NEGATIVE_TTL_MS = 5_000;

  /** noteId → time the last COMPLETE full scan found NO owning workspace. */
  const noteResolveNegativeCache = new Map<string, number>();

  /** noteId → in-flight full scan, so concurrent resolutions coalesce onto one. */
  const noteResolveScansInFlight = new Map<string, Promise<string | null>>();

  /**
   * Full workspace scan for one noteId: walks each workspace's `note.list`
   * (caching every note it sees) until the note is found. A miss is
   * negative-cached ONLY when the scan actually established it: the workspace
   * enumeration succeeded, at least one workspace was scanned, and every
   * `note.list` call succeeded. A vacuous scan (failed `workspace.list`) or one
   * with a failed workspace has not proven that no workspace claims the note,
   * so the next resolution retries instead of serving a stale `null`.
   */
  async function scanForNoteWorkspace(noteId: string): Promise<string | null> {
    let workspaceIds: string[];
    try {
      workspaceIds = await listWorkspaceIdsOrThrow('resolver');
    } catch {
      return null;
    }
    let scanComplete = true;
    for (const workspaceId of workspaceIds) {
      try {
        // Only ids are needed — request the slim projection (§5.2), falling back
        // to a plain full list on daemons that reject the unknown param (-32602).
        let result: { notes?: unknown[] };
        try {
          result = await backendRequest<{ notes?: unknown[] }>('note.list', {
            workspaceId,
            projection: 'slim',
          });
        } catch (error) {
          if (!isProjectionRejected(error)) throw error;
          result = await backendRequest<{ notes?: unknown[] }>('note.list', { workspaceId });
        }
        const notes = Array.isArray(result?.notes) ? result.notes : [];
        let found = false;
        for (const note of notes) {
          const id = String((note as { id?: unknown }).id ?? '');
          if (id) rememberNoteWorkspace(id, workspaceId);
          if (id === noteId) found = true;
        }
        if (found) return workspaceId;
      } catch {
        // Skip workspaces whose notes cannot be listed — but remember the scan
        // is incomplete so the miss is not negative-cached.
        scanComplete = false;
      }
    }
    if (scanComplete && workspaceIds.length > 0) noteResolveNegativeCache.set(noteId, Date.now());
    return null;
  }

  /**
   * Resolve the workspace a note belongs to. Returns the cached value when known,
   * otherwise scans each workspace's `note.list` (caching every note it sees)
   * until the note is found. Concurrent resolutions of the same noteId coalesce
   * onto ONE in-flight scan. Returns `null` when no workspace claims the note;
   * a COMPLETE-scan miss is negative-cached for
   * {@link NOTE_RESOLVE_NEGATIVE_TTL_MS} so a burst of retries for the same
   * unknown note performs one scan, not many.
   */
  async function resolveNoteWorkspaceId(noteId: string): Promise<string | null> {
    const cached = noteWorkspaceIndex.get(noteId);
    if (cached) return cached;

    const missedAt = noteResolveNegativeCache.get(noteId);
    if (missedAt !== undefined) {
      if (Date.now() - missedAt < NOTE_RESOLVE_NEGATIVE_TTL_MS) return null;
      noteResolveNegativeCache.delete(noteId);
    }

    const inFlight = noteResolveScansInFlight.get(noteId);
    if (inFlight) return inFlight;

    const scan = scanForNoteWorkspace(noteId).finally(() => {
      noteResolveScansInFlight.delete(noteId);
    });
    noteResolveScansInFlight.set(noteId, scan);
    return scan;
  }

  /** Preserve the source test hook: positive discoveries intentionally survive. */
  function resetTransientCachesForTests(): void {
    noteResolveNegativeCache.clear();
    noteResolveScansInFlight.clear();
  }

  return { rememberNoteWorkspace, resolveNoteWorkspaceId, resetTransientCachesForTests };
}
