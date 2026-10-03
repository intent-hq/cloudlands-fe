/**
 * Notes read helper for live-applying daemon `note:*` events.
 *
 * Live event handling: `applyNoteFromEvent` is called from the daemon-events
 * bridge on `note:*` events (workspace-scoped per PROTOCOL §7). `note:deleted`
 * dispatches `applyNoteDeleted` immediately (no fetch needed); `note:created`
 * and `note:updated` refetch just the target note via `notes.get` (using
 * `workspaceId` from the event envelope) and dispatch the matching
 * `applyNoteCreated` / `applyNoteUpdated` action. Fetches are coalesced.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions, and the logger. State reads use the raw
 * `appStore.state.workspaceNotes` shape.
 */
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { appClient } from '$lib/client';
import type { Note } from '$shared/types';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { NoteId } from '$shared/types/branded-ids';
import { isNoteContentStale } from '$shared/utils/note-content';
import { store as appStore } from '$store/renderer/store';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  noteEventReceived,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('NotesReadService');

export function isPagedNoteSession(workspaceId: string, noteId: string): boolean {
  const n = appStore.state.notePages?.byWorkspaceId[workspaceId]?.notes[noteId];
  return !!n && n.status !== 'legacy' && Object.keys(n.panels).length > 0;
}
const generations = new Map<string, number>();

/**
 * In-flight loads keyed by `note:{workspaceId}:{noteId}`; coalesces
 * concurrent requests. The key deliberately excludes the event type so a
 * `note:created` immediately followed by `note:updated` (or an editor-open
 * `ensureNoteContentLoaded`) never runs two concurrent `note.get` calls for
 * the same note — an older response could otherwise apply after a newer one
 * and regress the cached row. `dirty` marks that another event arrived while
 * the fetch was in flight, triggering one trailing refetch after the current
 * one settles.
 */
const inFlight = new Map<
  string,
  { dirty: boolean; settled: Promise<void>; run: () => Promise<void> }
>();

function coalesce(key: string, fn: () => Promise<void>): Promise<void> {
  const pending = inFlight.get(key);
  if (pending) {
    pending.dirty = true;
    pending.run = fn;
    return pending.settled;
  }
  const entry = { dirty: false, settled: Promise.resolve(), run: fn };
  inFlight.set(key, entry);
  entry.settled = (async () => {
    try {
      await fn();
    } catch (error) {
      logger.error(`Notes refresh failed for ${key}`, error);
    } finally {
      if (inFlight.get(key) === entry) {
        inFlight.delete(key);
        // Use the newest owner: deletion/recreation can supersede the leading request.
        if (entry.dirty) await coalesce(key, entry.run);
      }
    }
  })();
  return entry.settled;
}

/**
 * Live-apply a `note:*` daemon event to the workspace-notes slice. Called from
 * the daemon-events bridge after it has extracted the workspaceId + event.
 * `note:deleted` dispatches immediately from event data alone; `note:created`
 * and `note:updated` fetch the fresh note payload via a targeted `notes.get`
 * (one note, full content — not a whole-workspace list) and dispatch the
 * matching `applyNote*` action. Fetches are coalesced per (workspaceId,
 * noteId): single-flight with at most one trailing refetch for events that
 * arrive while a fetch is in flight.
 */
export function applyNoteFromEvent(
  workspaceId: string,
  noteId: string,
  eventType: 'note:created' | 'note:updated' | 'note:deleted',
): void {
  if (!workspaceId || !noteId) return;
  const key = JSON.stringify([workspaceId, noteId]);
  if (eventType === 'note:deleted') {
    generations.set(key, (generations.get(key) ?? 0) + 1);
    appStore.dispatch(applyNoteDeleted(workspaceId, noteId));
    return;
  }
  if (noteId === SPEC_NOTE_ID) {
    appStore.dispatch(noteEventReceived(workspaceId, noteId, eventType));
    return;
  }
  const generation = generations.get(key) ?? 0;
  coalesce(`note:${workspaceId}:${noteId}`, async () => {
    if (generation !== (generations.get(key) ?? 0)) return;
    if (isPagedNoteSession(workspaceId, noteId)) return;
    const note = await appClient.notes.get(noteId, workspaceId);
    if (
      !note ||
      String(note.workspaceId) !== workspaceId ||
      isPagedNoteSession(workspaceId, noteId) ||
      generation !== (generations.get(key) ?? 0)
    )
      return;
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

/**
 * Ensure a note's full content is in the store. No-op unless the cached row is
 * a stale slim-projection row (`contentLength > 0` with empty `content`, per
 * `isNoteContentStale`) — then a targeted full `notes.get` is fetched and
 * upserted. Content surfaces (note editor) call this on open; loads coalesce
 * with the event-refetch path via the shared single-flight map.
 *
 * Resolves after the fetch settles with whether the cached row now carries its
 * full content — `false` means the fetch failed (`notes.get` swallows errors
 * and returns null) and the row is still stale, so callers can surface an
 * error/retry state instead of waiting on a store change that never comes.
 */
export function ensureNoteContentLoaded(workspaceId: string, noteId: string): Promise<boolean> {
  if (!workspaceId || !noteId || isPagedNoteSession(workspaceId, noteId))
    return Promise.resolve(false);
  const ws = appStore.state.workspaceNotes.byWorkspaceId[workspaceId];
  const cached = ws?.notes ? getItem(ws.notes, NoteId(String(noteId))) : undefined;
  if (!cached) return Promise.resolve(false);
  if (!isNoteContentStale(cached)) return Promise.resolve(true);
  const key = JSON.stringify([workspaceId, noteId]);
  const generation = generations.get(key) ?? 0;
  return coalesce(`note:${workspaceId}:${noteId}`, async () => {
    if (isPagedNoteSession(workspaceId, noteId) || generation !== (generations.get(key) ?? 0))
      return;
    const note = await appClient.notes.get(noteId, workspaceId);
    if (
      !note ||
      String(note.workspaceId) !== workspaceId ||
      isPagedNoteSession(workspaceId, noteId) ||
      generation !== (generations.get(key) ?? 0)
    )
      return;
    dispatchNoteApply(workspaceId, note, 'note:updated');
  }).then(() => {
    const after = appStore.state.workspaceNotes.byWorkspaceId[workspaceId];
    const row = after?.notes ? getItem(after.notes, NoteId(String(noteId))) : undefined;
    return row !== undefined && !isNoteContentStale(row);
  });
}

/** Test-only — drop any coalesced fetches between test cases. */
export function __resetNotesReadServiceForTests(): void {
  inFlight.clear();
  generations.clear();
}
