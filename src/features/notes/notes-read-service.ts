/**
 * Notes read helper for live-applying daemon `note:*` events.
 *
 * Live event handling: `applyNoteFromEvent` is called from the daemon-events
 * bridge on `note:*` events (workspace-scoped per PROTOCOL §7). `note:deleted`
 * dispatches `applyNoteDeleted` immediately (no fetch needed); `note:created`
 * and `note:updated` refetch just the target note via `notes.list` (using
 * `workspaceId` from the event envelope) and dispatch the matching
 * `applyNoteCreated` / `applyNoteUpdated` action. Fetches are coalesced.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions, and the logger. State reads use the raw
 * `appStore.state.workspaceNotes` shape.
 */
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { appClient } from '$lib/client';
import type { Note } from '$shared/types';
import { NoteId } from '$shared/types/branded-ids';
import { store as appStore } from '$store/renderer/store';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('NotesReadService');

/**
 * In-flight loads keyed by `domain:wsId`; coalesces concurrent requests.
 * `dirty` marks that another event arrived while the fetch was in flight,
 * triggering one trailing refetch after the current one settles.
 */
const inFlight = new Map<string, { dirty: boolean }>();

function coalesce(key: string, fn: () => Promise<void>): void {
  const pending = inFlight.get(key);
  if (pending) {
    pending.dirty = true;
    return;
  }
  const entry = { dirty: false };
  inFlight.set(key, entry);
  void (async () => {
    try {
      await fn();
    } catch (error) {
      logger.error(`Notes refresh failed for ${key}`, error);
    } finally {
      inFlight.delete(key);
      if (entry.dirty) coalesce(key, fn);
    }
  })();
}

/**
 * Live-apply a `note:*` daemon event to the workspace-notes slice. Called from
 * the daemon-events bridge after it has extracted the workspaceId + event.
 * `note:deleted` dispatches immediately from event data alone; `note:created`
 * and `note:updated` fetch the fresh note payload (`notes.list` returns the
 * full workspace so we pick the target id out) and dispatch the matching
 * `applyNote*` action. Fetches are coalesced per (workspaceId, noteId):
 * single-flight with at most one trailing refetch for events that arrive
 * while a fetch is in flight.
 */
export function applyNoteFromEvent(
  workspaceId: string,
  noteId: string,
  eventType: 'note:created' | 'note:updated' | 'note:deleted',
): void {
  if (!workspaceId || !noteId) return;
  if (eventType === 'note:deleted') {
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
  eventType: 'note:created' | 'note:updated',
): void {
  const ws = appStore.state.workspaceNotes.byWorkspaceId[workspaceId];
  const already = ws?.notes ? getItem(ws.notes, NoteId(String(note.id))) !== undefined : false;
  if (eventType === 'note:created' && !already) {
    appStore.dispatch(applyNoteCreated(workspaceId, note));
    return;
  }
  appStore.dispatch(applyNoteUpdated(workspaceId, String(note.id), note));
}

/** Test-only — drop any coalesced fetches between test cases. */
export function __resetNotesReadServiceForTests(): void {
  inFlight.clear();
}
