/**
 * Notes write service — the sanctioned post-saga note-mutation mechanism.
 *
 * Components call these functions from event handlers instead of dispatching the
 * (now dead) saga-trigger actions. Each operation: (1) applies an optional
 * optimistic store update for instant UI feedback, (2) awaits the matching
 * `appClient.notes.*` mutation (which forwards to intentd and never throws —
 * it returns a `MutationResult`), and (3) reconciles: on success the live
 * `note:*` subscribe→refetch loop converges the store; on failure the optimistic
 * change is rolled back (or the workspace is refetched).
 *
 * Optimistic-concurrency rev threading (§11.4-D): note mutations are serialized
 * per noteId (`enqueueNoteMutation`) so a rename never reads the store `rev`
 * while a content save is still in flight, and every successful conditional
 * mutation advances the stored `rev` to `sentRev + 1` immediately
 * (`advanceNoteRev`) instead of waiting for the async `note:*`
 * subscribe→refetch loop. The daemon's success responses don't echo the entity,
 * but the advancement is authoritative: a conditional write succeeds only when
 * the stored rev equals `expectedVersion`, and every write bumps `rev` by
 * exactly one (intent-store `update_note_versioned`).
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions/empty-state, collection-utils, and the
 * logger. State reads use the raw `appStore.state.workspaceNotes` shape via
 * the `readWorkspaceNotes` / `readNoteById` helpers below.
 */
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { appClient } from '$lib/client';
import type { MutationResult } from '$lib/client';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { ContentType, NoteVisibility } from '$shared/types';
import type { CreateNoteRequest, Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { store as appStore } from '$store/renderer/store';
import {
  addOptimisticNote,
  applyLocalNoteUpdate,
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  emptyWorkspaceNotesState,
  loadWorkspaceNotesSucceeded,
  removeOptimisticNote,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { withPreservedUnmetDependsOn } from '$store/renderer/slices/workspace-notes/workspace-notes-normalization';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('NotesWriteService');

function noteKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}:${noteId}`;
}

// Per-note mutation queues (§11.4-D): chain each note's mutations so a rename
// issued while a content save is in flight waits for it — and therefore reads
// the advanced `rev` — instead of racing it with a stale `expectedVersion`.
const noteMutationQueues = new Map<string, Promise<void>>();

function enqueueNoteMutation<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prior = noteMutationQueues.get(key) ?? Promise.resolve();
  const result = prior.then(run);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  noteMutationQueues.set(key, tail);
  void tail.then(() => {
    if (noteMutationQueues.get(key) === tail) noteMutationQueues.delete(key);
  });
  return result;
}

function genTempNoteId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return `optimistic-${c.randomUUID()}`;
  return `optimistic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Read state directly via raw slice shape (NOT via the workspace-notes-selectors
// module) — once registered in `middleware.ts`, statically importing a
// `*-selectors.ts` module would evaluate `store.createSelector` while the store
// module is still mid-initialization through the middleware chain. See
// `git-read-service.ts` / `files-write-service.ts` for the same pattern.
function readWorkspaceNotes(workspaceId: string): Note[] {
  const ws = appStore.state.workspaceNotes.byWorkspaceId[workspaceId] ?? emptyWorkspaceNotesState;
  return getItems(ws.notes);
}

function readNoteById(workspaceId: string, noteId: string): Note | undefined {
  const ws = appStore.state.workspaceNotes.byWorkspaceId[workspaceId] ?? emptyWorkspaceNotesState;
  return getItem(ws.notes, NoteId(noteId));
}

/**
 * Advance a note's stored `rev` after a successful conditional mutation
 * (§11.4-D): the daemon accepted `expectedVersion === sentRev` and bumped the
 * row's rev by exactly one, so `sentRev + 1` is authoritative. Guarded so a
 * concurrent refetch that already landed a newer rev is never regressed.
 */
function advanceNoteRev(workspaceId: string, noteId: string, sentRev: number): void {
  setNoteRevIfNewer(workspaceId, noteId, sentRev + 1);
}

/**
 * Set a note's stored `rev` to an authoritative value (an echoed daemon rev,
 * #638, or an `advanceNoteRev` inference), guarded so a concurrent refetch
 * that already landed a newer rev is never regressed.
 */
function setNoteRevIfNewer(workspaceId: string, noteId: string, nextRev: number): void {
  const current = readNoteById(workspaceId, noteId)?.rev;
  if (current !== undefined && current >= nextRev) return;
  appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { rev: nextRev }));
}

async function refetchWorkspaceNotes(workspaceId: string): Promise<void> {
  try {
    const notes = await appClient.notes.list(workspaceId);
    appStore.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
  } catch (error) {
    logger.error('Failed to refetch notes after a mutation error', error);
  }
}

/**
 * Handle an optimistic-concurrency conflict (§11.4-D): the daemon rejected the
 * mutation because the note changed on the server. Reload-to-latest — replace
 * the stale note with the authoritative `conflict.current` (advancing the
 * threaded `rev`), falling back to a workspace refetch when no entity is
 * supplied — and surface a non-destructive prompt. Returns `true` when a
 * conflict was handled so the caller skips the generic rollback/refetch path.
 */
function reconcileNoteConflict(
  workspaceId: string,
  noteId: string,
  result: MutationResult,
): boolean {
  if (!result.conflict) return false;
  const current = result.conflict.current as Note | undefined;
  if (current && typeof current === 'object') {
    const canonicalId = String(current.id ?? noteId);
    // Mutation-response notes omit the transient `unmetDependsOn` projection
    // (monorepo#2001); keep the cached value so "Waits on" doesn't flicker.
    const cached = readNoteById(workspaceId, canonicalId);
    appStore.dispatch(
      applyNoteUpdated(workspaceId, canonicalId, withPreservedUnmetDependsOn(current, cached)),
    );
  } else {
    void refetchWorkspaceNotes(workspaceId);
  }
  logger.warn('Note mutation conflicted; reloaded the latest version', { noteId });
  notify.warning(m.notes_writeService_noteChanged_label(), {
    description: m.notes_writeService_noteChanged_description(),
  });
  return true;
}

/** Create a note with optimistic insert; reconciles to the canonical id on success. */
export async function createNote(
  workspaceId: string,
  data: Omit<CreateNoteRequest, 'workspaceId'>,
): Promise<string | undefined> {
  const tempId = genTempNoteId();
  const now = new Date().toISOString();
  const optimistic: Note = {
    id: NoteId(tempId),
    workspaceId: WorkspaceId(workspaceId),
    title: data.title,
    content: data.content,
    contentType: data.contentType ?? ContentType.Markdown,
    tags: data.tags ?? [],
    isPinned: false,
    isArchived: false,
    visibility: data.visibility ?? NoteVisibility.Workspace,
    ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
    createdAt: now,
    updatedAt: now,
  };

  const before = new Set(readWorkspaceNotes(workspaceId).map((n) => String(n.id)));
  appStore.dispatch(addOptimisticNote(workspaceId, optimistic));

  const result = await appClient.notes.create({ workspaceId: WorkspaceId(workspaceId), ...data });
  if (!result.success) {
    appStore.dispatch(removeOptimisticNote(workspaceId, tempId));
    logger.error('Failed to create note', result.error);
    return undefined;
  }

  try {
    const notes = await appClient.notes.list(workspaceId);
    appStore.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
    const created = notes.find((n) => !before.has(String(n.id)));
    if (created) {
      appStore.dispatch(addOptimisticNote(workspaceId, created));
      return String(created.id);
    }
  } catch (error) {
    // The create succeeded but the reconcile refetch threw. Keep the optimistic
    // note rather than dropping it — the live note:* subscribe→refetch loop will
    // converge it to the canonical id — so the user's note is neither orphaned nor duplicated.
    logger.error('Failed to refetch notes after creating a note', error);
  }
  return undefined;
}

/** Update a note's title optimistically; rolls back to the prior title on failure. */
export async function updateNoteTitle(
  workspaceId: string,
  noteId: string,
  title: string,
): Promise<void> {
  const previous = readNoteById(workspaceId, noteId)?.title;
  appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { title }));

  await enqueueNoteMutation(noteKey(workspaceId, noteId), async () => {
    const rev = readNoteById(workspaceId, noteId)?.rev;
    const result = await appClient.notes.updateMetadata(noteId, { title }, rev, workspaceId);
    if (!result.success) {
      if (reconcileNoteConflict(workspaceId, noteId, result)) return;
      logger.error('Failed to update note title', result.error);
      notify.error(m.notes_writeService_updateTitleFailed_error(), {
        description: result.error ?? m.notes_writeService_unknown_error(),
      });
      if (previous !== undefined) {
        appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { title: previous }));
      }
      return;
    }
    if (rev !== undefined) advanceNoteRev(workspaceId, noteId, rev);
  });
}

/** Delete a note optimistically; restores it from a snapshot on failure. */
export async function deleteNote(workspaceId: string, noteId: string): Promise<void> {
  const snapshot = readNoteById(workspaceId, noteId);
  appStore.dispatch(applyNoteDeleted(workspaceId, noteId));

  await enqueueNoteMutation(noteKey(workspaceId, noteId), async () => {
    const rev = snapshot?.rev;
    const result = await appClient.notes.delete(noteId, rev, workspaceId);
    if (!result.success) {
      if (reconcileNoteConflict(workspaceId, noteId, result)) return;
      logger.error('Failed to delete note', result.error);
      notify.error(m.notes_writeService_deleteFailed_error(), {
        description: result.error ?? m.notes_writeService_unknown_error(),
      });
      if (snapshot) appStore.dispatch(applyNoteCreated(workspaceId, snapshot));
    }
  });
}
