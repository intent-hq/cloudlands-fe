/**
 * Notes read service — hydrates a workspace's notes when it becomes active
 * (`workspaceMounted`) after boot, and live-applies daemon `note:*` events.
 *
 * The boot-time notes seeder only hydrates workspaces that already exist at
 * app start; workspaces created (or first-opened) mid-session used to render
 * an empty notes panel (no Spec, no notes) until an app restart. This mirrors
 * `lifecycle-read-service.ts`: after `workspaceMounted` passes through the
 * reducer, this middleware fetches `appClient.notes.list(wsId)` and dispatches
 * `loadWorkspaceNotesSucceeded`, then selects the spec note (matching the
 * seeder). The load is guarded by `initialized || loading` so boot-seeded
 * workspaces are unaffected, and coalesced per-workspace so rapid re-mounts
 * collapse into one fetch.
 *
 * Live event handling: `applyNoteFromEvent` is called from the daemon-events
 * bridge on `note:*` events (workspace-scoped per PROTOCOL §7). `note:deleted`
 * dispatches `applyNoteDeleted` immediately (no fetch needed); `note:created`
 * and `note:updated` refetch just the target note via `notes.list` (using
 * `workspaceId` from the event envelope) and dispatch the matching
 * `applyNoteCreated` / `applyNoteUpdated` action. Fetches are coalesced.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions, and the logger (NOT selectors —
 * importing them would evaluate `store.createSelector` while the store module
 * is still mid-initialization through the middleware chain). State reads use
 * the raw `appStore.state.workspaceNotes` shape.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { getItem } from "$lib/store-shim/utils/collections/collection-utils";
import { SPEC_NOTE_ID } from "$shared/constants/notes";
import { appClient } from "$lib/client";
import type { Note } from "$shared/types";
import { NoteId } from "$shared/types/branded-ids";
import { store as appStore } from "$store/renderer/store";
import { workspaceMounted } from "$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice";
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  loadWorkspaceNotesSucceeded,
  selectNote,
} from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("NotesReadService");

/** In-flight loads keyed by `domain:wsId`; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

function coalesce(key: string, fn: () => Promise<void>): void {
  const pending = inFlight.get(key);
  if (pending) return;
  const run = (async () => {
    try {
      await fn();
    } catch (error) {
      logger.error(`Notes refresh failed for ${key}`, error);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
}

/**
 * Hydrate a workspace's notes on mount, mirroring the boot notes-seeder for
 * this workspace only. Guarded by `initialized || loading` so a re-mount of a
 * boot-seeded workspace is a no-op (leaving user-driven state like
 * `selectedNoteId` intact). Selects the spec note when found so the notes
 * panel renders content on first paint, matching the seeder.
 */
function hydrateWorkspaceNotes(wsId: string): void {
  const ws = appStore.state.workspaceNotes.byWorkspaceId[wsId];
  if (ws?.loading || ws?.initialized) return;
  coalesce(`notes:${wsId}`, async () => {
    const notes = await appClient.notes.list(wsId);
    appStore.dispatch(loadWorkspaceNotesSucceeded([wsId], { [wsId]: notes }));
    const spec = notes.find((n) => String(n.id) === SPEC_NOTE_ID);
    if (spec) appStore.dispatch(selectNote(wsId, String(spec.id)));
  });
}

/**
 * Live-apply a `note:*` daemon event to the workspace-notes slice. Called from
 * the daemon-events bridge after it has extracted the workspaceId + event.
 * `note:deleted` dispatches immediately from event data alone; `note:created`
 * and `note:updated` fetch the fresh note payload (`notes.list` returns the
 * full workspace so we pick the target id out) and dispatch the matching
 * `applyNote*` action. Fetches are coalesced per (workspaceId, noteId).
 */
export function applyNoteFromEvent(
  workspaceId: string,
  noteId: string,
  eventType: "note:created" | "note:updated" | "note:deleted",
): void {
  if (!workspaceId || !noteId) return;
  if (eventType === "note:deleted") {
    appStore.dispatch(applyNoteDeleted(workspaceId, noteId));
    return;
  }
  coalesce(`note:${workspaceId}:${noteId}:${eventType}`, async () => {
    const notes = await appClient.notes.list(workspaceId);
    const note = notes.find((n) => String(n.id) === noteId);
    if (!note) return;
    dispatchNoteApply(workspaceId, note, eventType);
  });
}

/**
 * Dispatch the correct `applyNote*` action for a fetched note. `note:created`
 * only fires when the note is absent from the workspace store (avoids the
 * duplicate-id path in `applyNoteCreated`'s `addItem` when a prior list
 * already contains the note); an already-present note is upserted via
 * `applyNoteUpdated` instead so the reducer's `upsertItem` keeps state stable.
 */
function dispatchNoteApply(
  workspaceId: string,
  note: Note,
  eventType: "note:created" | "note:updated",
): void {
  const ws = appStore.state.workspaceNotes.byWorkspaceId[workspaceId];
  const already = ws?.notes ? getItem(ws.notes, NoteId(String(note.id))) !== undefined : false;
  if (eventType === "note:created" && !already) {
    appStore.dispatch(applyNoteCreated(workspaceId, note));
    return;
  }
  appStore.dispatch(applyNoteUpdated(workspaceId, String(note.id), note));
}

/**
 * Middleware giving `workspaceMounted` a real notes hydration handler: after
 * the action passes through the reducer, it kicks off a (deduped) notes fetch
 * for the target workspace. Fire-and-forget — dispatch stays synchronous and
 * never throws. Boot-seeded workspaces skip the fetch via the initialized
 * guard in `hydrateWorkspaceNotes`.
 */
export function createNotesReadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action?.type === workspaceMounted.type && Array.isArray(action.payload)) {
      const wsId = action.payload[0];
      if (typeof wsId === "string" && wsId.length > 0) {
        hydrateWorkspaceNotes(wsId);
      }
    }
    return result;
  };
}

/** Test-only — drop any coalesced fetches between test cases. */
export function __resetNotesReadServiceForTests(): void {
  inFlight.clear();
}
