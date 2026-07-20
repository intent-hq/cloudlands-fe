/**
 * Notes versions service — the sanctioned post-saga handler for the two
 * orphaned version-history triggers dispatched by `NoteVersionHistory.svelte`
 * (on mount / visibility) and `NoteWithComments.svelte` (on Restore).
 *
 * These triggers (`fetchNoteVersions`, `restoreNoteVersion`) lost their
 * handlers when the saga runtime was removed (they lived in
 * `slices/workspace-notes/sagas/notes-crud-saga.ts`), so the dispatch became a
 * no-op: the version list stayed empty and Restore did nothing. This restores
 * the wire path WITHOUT re-adding a saga and WITHOUT changing the dispatch
 * site: `createNotesVersionsMiddleware()` observes each action and, after the
 * (no-op) reducer runs, calls `appClient.notes.listVersions` /
 * `appClient.notes.restoreVersion` and dispatches the store updates.
 *
 * On restore we (1) dispatch `applyNoteUpdated` with the daemon's returned
 * note so the editor reflects the restored content immediately, and (2)
 * refetch the versions list so the newly-appended restored version appears.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions, and the logger — no selectors (which
 * would evaluate `store.createSelector` during middleware-chain construction).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  applyNoteUpdated,
  applyNoteVersions,
  applyNoteVersionsError,
  fetchNoteVersions,
  restoreNoteVersion,
} from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("NotesVersionsService");

/**
 * Fetch a note's version list via `appClient.notes.listVersions` and dispatch
 * `applyNoteVersions` / `applyNoteVersionsError`. Fire-and-forget; failures
 * are surfaced via the error action rather than thrown.
 */
async function handleFetchNoteVersions(workspaceId: string, noteId: string): Promise<void> {
  if (!workspaceId || !noteId) return;
  try {
    const versions = await appClient.notes.listVersions(workspaceId, noteId);
    appStore.dispatch(applyNoteVersions(workspaceId, noteId, versions));
  } catch (error) {
    logger.error("Failed to fetch note versions", error);
    appStore.dispatch(
      applyNoteVersionsError(workspaceId, error instanceof Error ? error.message : String(error)),
    );
  }
}

/**
 * Restore a note to a specific version via `appClient.notes.restoreVersion`.
 * On success dispatch `applyNoteUpdated` with the returned note (so the
 * editor refreshes) and re-fetch the versions list (so the newly-appended
 * restored version appears). Failures are logged only — the reducer state
 * for the list is unchanged.
 */
async function handleRestoreNoteVersion(
  workspaceId: string,
  noteId: string,
  versionId: string,
): Promise<void> {
  if (!workspaceId || !noteId || !versionId) return;
  try {
    const result = await appClient.notes.restoreVersion(workspaceId, noteId, versionId);
    if (!result.success) {
      logger.error("Failed to restore note version", {
        workspaceId,
        noteId,
        versionId,
        error: result.error,
      });
      return;
    }
    if (result.note && result.note.workspaceId === workspaceId) {
      appStore.dispatch(applyNoteUpdated(workspaceId, noteId, result.note));
    }
    await handleFetchNoteVersions(workspaceId, noteId);
  } catch (error) {
    logger.error("Error restoring note version", error);
  }
}

/**
 * Middleware that gives the (post-saga) `fetchNoteVersions` and
 * `restoreNoteVersion` triggers real handlers: after each action passes
 * through the reducer, it forwards to the matching `appClient.notes.*` call.
 * Fire-and-forget — dispatch stays synchronous and never throws.
 */
export function createNotesVersionsMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof action !== "object") return result;
    const type = (action as { type?: unknown }).type;
    if (type === fetchNoteVersions.type) {
      const payload = (action as ReturnType<typeof fetchNoteVersions>).payload;
      if (Array.isArray(payload)) {
        const [wsId, noteId] = payload;
        if (typeof wsId === "string" && typeof noteId === "string") {
          void handleFetchNoteVersions(wsId, noteId);
        }
      }
    } else if (type === restoreNoteVersion.type) {
      const payload = (action as ReturnType<typeof restoreNoteVersion>).payload;
      if (Array.isArray(payload)) {
        const [wsId, noteId, versionId] = payload;
        if (
          typeof wsId === "string" &&
          typeof noteId === "string" &&
          typeof versionId === "string"
        ) {
          void handleRestoreNoteVersion(wsId, noteId, versionId);
        }
      }
    }
    return result;
  };
}
