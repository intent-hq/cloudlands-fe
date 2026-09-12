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
 * Content saves are debounced HERE (keyed by noteId) so the mechanism — not the
 * component — owns the timing the removed saga used to provide. Pass
 * `{ immediate: true }` (or call `flushNoteContent`) to bypass the debounce on
 * teardown so no edit is lost.
 *
 * Optimistic-concurrency rev threading (§11.4-D): note mutations are serialized
 * per noteId (`enqueueNoteMutation`) so a rename never reads the store `rev`
 * while a content save is still in flight, and every successful conditional
 * mutation advances the stored `rev` to `sentRev + 1` immediately
 * (`advanceNoteRev`) instead of waiting for the async `note:*`
 * subscribe→refetch loop. Metadata/delete responses don't echo the entity, but
 * the advancement is authoritative: a conditional write succeeds only when the
 * stored rev equals `expectedVersion`, and every write bumps `rev` by exactly
 * one (intent-store `update_note_versioned`).
 *
 * Content saves are different: every save carries the loaded note's `rev` as
 * `expectedVersion` (omitted only when the note was never loaded — plain
 * last-writer-wins), and the daemon merges the write against concurrent edits
 * instead of rejecting it. Its `note.setContent` response is therefore the
 * authoritative local state: `newContent` replaces the store content and
 * `rev` (when the daemon reports it; older daemons omit it and the
 * `sentRev + 1` inference applies) replaces the stored rev. The reload+toast
 * conflict path (`reconcileNoteConflict`) is kept for metadata and delete only.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions/empty-state, collection-utils, and the
 * logger. State reads use the raw `appStore.state.workspaceNotes` shape via
 * the `readWorkspaceNotes` / `readNoteById` helpers below.
 */
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { appClient } from '$lib/client';
import type { MutationResult } from '$lib/client';
import { toast } from 'svelte-sonner';
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
import { rebaseText } from '$lib/notes/text-rebase';

const logger = createLogger('NotesWriteService');

/** Debounce window for content saves (the removed saga debounced ~1s). */
export const NOTE_CONTENT_SAVE_DEBOUNCE_MS = 800;

interface PendingContent {
  workspaceId: string;
  content: string;
  /** Position in the note's local edit sequence (see `latestEditSeq`). */
  seq: number;
}

// Debounce/queue state is keyed by `${workspaceId}:${noteId}` — note ids are
// not globally unique (every workspace has a `spec` note), so keying by
// noteId alone would let same-id notes across workspaces clobber each other's
// pending saves and share a mutation queue.
const contentTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingContent = new Map<string, PendingContent>();
// Content saves currently awaiting the daemon's response, as a per-key count
// (overlapping flushes for the same key are possible). Together with
// `pendingContent` this spans the whole unacknowledged-save window: debounced
// (pre-flush) saves live in `pendingContent`, flushed-but-unacked saves here.
const inFlightContentSaves = new Map<string, number>();
// Sequence number of the most recent local edit per key. A save's echo is
// authoritative only when no later local edit exists — whether that edit is
// still debounced, queued behind this save, or itself in flight — so the check
// cannot rely on `pendingContent` alone (a flush removes the entry) nor on
// comparing echoed text against sent text.
const latestEditSeq = new Map<string, number>();
// Every draft not yet acknowledged by the daemon, per key, in edit order —
// the debounced one (also in `pendingContent`) plus those flushed and queued
// or in flight. When a superseded save's echo lands, the later drafts are
// rebased in place onto the echo (see `applyContentSaveResult`), so the object
// a queued flush captured carries the rebased text by the time it is sent.
const unackedDrafts = new Map<string, PendingContent[]>();
// Rev of the daemon text the current local edit chain is based on, per key.
// Set when a chain starts from a clean (in-sync) state, advanced to each echo's
// rev as the pending draft is rebased onto that echo, and cleared once nothing
// is pending or in flight. A save sends this as `expectedVersion`.
const draftBaseRev = new Map<string, number>();

function noteKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}:${noteId}`;
}

/**
 * Whether a content save for this note is still unacknowledged — either
 * debounced (waiting out `NOTE_CONTENT_SAVE_DEBOUNCE_MS`) or in flight to the
 * daemon. While true, a `note:updated` refetch can return content that
 * predates the save, so external-update consumers must not treat Redux as
 * authoritative for this note (monorepo#533).
 */
export function hasPendingNoteContent(workspaceId: string, noteId: string): boolean {
  const key = noteKey(workspaceId, noteId);
  return pendingContent.has(key) || (inFlightContentSaves.get(key) ?? 0) > 0;
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

/**
 * Serialize an out-of-module mutation that rewrites the note's content
 * daemon-side (e.g. `comment.add`, which embeds anchor markers into the
 * markdown via an unconditional `update_note`) on this note's mutation queue,
 * and advance the stored `rev` on success. The daemon emits no `note:updated`
 * for these rewrites; newer daemons echo the authoritative post-mutation rev
 * on the result (`noteRev`, #638), which is applied verbatim (guarded against
 * regressing a newer refetched rev). When the echo is absent (older daemons),
 * fall back to the `rev + 1` inference — valid because the queue excludes
 * FE-originated races; if another client bumped the note concurrently the
 * stored rev stays stale and the next conditional save conflicts
 * legitimately. Queueing guarantees ordering with any in-flight or debounced
 * `setContent`, so the next save reads the advanced rev instead of racing it
 * with a stale `expectedVersion`.
 */
export function enqueueRevBumpingNoteMutation(
  workspaceId: string,
  noteId: string,
  run: () => Promise<MutationResult>,
): Promise<MutationResult> {
  return enqueueNoteMutation(noteKey(workspaceId, noteId), async () => {
    const rev = readNoteById(workspaceId, noteId)?.rev;
    const result = await run();
    if (result.success) {
      if (result.noteRev !== undefined) setNoteRevIfNewer(workspaceId, noteId, result.noteRev);
      else if (rev !== undefined) advanceNoteRev(workspaceId, noteId, rev);
    }
    return result;
  });
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
 * Metadata and delete only: content saves are merged daemon-side and never
 * route here.
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
  toast.warning(m.notes_writeService_noteChanged_label(), {
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

/**
 * Update note content optimistically; the network save is debounced per note.
 *
 * `baseRev` is the rev of the daemon text `content` was derived from. It is
 * honoured only when it starts a new edit chain (nothing pending or in
 * flight); a chain already under way keeps the base it was rebased onto. The
 * store rev is the fallback, but it is not authoritative for the caller's
 * text: a `note:updated` refetch can advance it before the first staging of a
 * draft the editor derived from the older rev, and sending the newer rev as
 * `expectedVersion` makes the daemon treat the draft as an exact write and
 * delete the refetched change.
 *
 * `baseContent` is the text `content` was derived from. While a chain is
 * under way its newest draft may have been rebased onto an echo the editor
 * has not shown yet; a draft typed on the pre-rebase text would then read,
 * relative to that newest draft, as deleting the rebased-in change. When
 * `baseContent` differs from the newest draft, the caller's edits are replayed
 * onto that draft instead. Without it the caller's text is taken to be derived
 * from the newest draft.
 */
export function updateNoteContent(
  workspaceId: string,
  noteId: string,
  content: string,
  options?: { immediate?: boolean; baseRev?: number; baseContent?: string },
): void {
  const key = noteKey(workspaceId, noteId);
  if (!draftBaseRev.has(key)) {
    const baseRev = options?.baseRev ?? readNoteById(workspaceId, noteId)?.rev;
    if (baseRev !== undefined) draftBaseRev.set(key, baseRev);
  }
  const newest = (unackedDrafts.get(key) ?? []).at(-1);
  if (newest && options?.baseContent !== undefined && options.baseContent !== newest.content) {
    content = rebaseText(options.baseContent, newest.content, content);
  }
  appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { content }));
  const seq = (latestEditSeq.get(key) ?? 0) + 1;
  latestEditSeq.set(key, seq);
  const draft: PendingContent = { workspaceId, content, seq };
  // A still-debounced draft is replaced, never sent.
  const replaced = pendingContent.get(key);
  const drafts = (unackedDrafts.get(key) ?? []).filter((d) => d !== replaced);
  drafts.push(draft);
  unackedDrafts.set(key, drafts);
  pendingContent.set(key, draft);

  const existing = contentTimers.get(key);
  if (existing) clearTimeout(existing);

  if (options?.immediate) {
    contentTimers.delete(key);
    void flushContent(key, noteId);
    return;
  }
  contentTimers.set(
    key,
    setTimeout(() => {
      contentTimers.delete(key);
      void flushContent(key, noteId);
    }, NOTE_CONTENT_SAVE_DEBOUNCE_MS),
  );
}

/**
 * Outcome of an applied content save: the content and rev now in the store.
 * When a newer local edit superseded the save's echo, this is that newer local
 * text rebased onto the echo (the echo was not applied verbatim), not the
 * daemon's merge of the older text. When a refetch had already landed a rev
 * newer than the echo, the store keeps showing the refetch, and this is still
 * the rebased local text at the echo's rev — what the editor must show.
 */
export interface AppliedNoteContent {
  content: string;
  rev?: number;
}

/**
 * Flush any debounced content for this note immediately (no debounce wait)
 * and resolve with the applied result once the daemon has answered. Resolves
 * `undefined` when nothing was pending or the save failed. Serialized on the
 * note's mutation queue like every other save.
 */
export function flushNoteContent(
  workspaceId: string,
  noteId: string,
): Promise<AppliedNoteContent | undefined> {
  return flushContent(noteKey(workspaceId, noteId), noteId);
}

/**
 * Flush any debounced content for this note and resolve once every content
 * save for it has been acknowledged — including saves already in flight,
 * which `flushNoteContent` does not wait for (a flush removes the debounced
 * entry before its RPC settles, so a second flush finds nothing). For an
 * operation that must be ordered after the user's typing on the daemon
 * (note.restoreVersion): requests are dispatched concurrently on the daemon
 * side, so being behind a save on the wire does not order it after the save.
 */
export async function settleNoteContent(workspaceId: string, noteId: string): Promise<void> {
  const key = noteKey(workspaceId, noteId);
  while (hasPendingNoteContent(workspaceId, noteId)) {
    await flushContent(key, noteId);
    const tail = noteMutationQueues.get(key);
    if (tail) await tail;
    else await Promise.resolve();
  }
}

async function flushContent(key: string, noteId: string): Promise<AppliedNoteContent | undefined> {
  const pending = pendingContent.get(key);
  if (!pending) return undefined;
  pendingContent.delete(key);
  const timer = contentTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    contentTimers.delete(key);
  }
  inFlightContentSaves.set(key, (inFlightContentSaves.get(key) ?? 0) + 1);
  try {
    return await enqueueNoteMutation(key, async () => {
      // Forward the rev the draft is based on as `expectedVersion` — the
      // daemon merges against it. It is omitted only when the note was never
      // loaded (no rev known), which degrades to last-writer-wins. The explicit
      // workspaceId pins the save to THIS workspace's note — shared ids like
      // `spec` exist in every workspace and the fallback resolver cache is
      // last-writer-wins across them. `pending.content` is read here, not at
      // flush time: an earlier save's echo may have rebased it while queued.
      const rev = draftBaseRev.get(key) ?? readNoteById(pending.workspaceId, noteId)?.rev;
      const result = await appClient.notes.setContent(
        noteId,
        pending.content,
        rev,
        pending.workspaceId,
      );
      if (!result.success) {
        logger.error('Failed to save note content', result.error);
        toast.error(m.notes_writeService_saveFailed_error(), {
          description: result.error ?? m.notes_writeService_unknown_error(),
        });
        await refetchWorkspaceNotes(pending.workspaceId);
        return undefined;
      }
      return applyContentSaveResult(noteId, pending, rev, result);
    });
  } finally {
    const remaining = (unackedDrafts.get(key) ?? []).filter((d) => d !== pending);
    if (remaining.length > 0) unackedDrafts.set(key, remaining);
    else unackedDrafts.delete(key);
    const count = (inFlightContentSaves.get(key) ?? 1) - 1;
    if (count <= 0) {
      inFlightContentSaves.delete(key);
      // Nothing left that could compare against the sequence, and the store
      // is back in sync with the daemon: the next edit chain starts fresh.
      if (!pendingContent.has(key)) {
        latestEditSeq.delete(key);
        draftBaseRev.delete(key);
      }
    } else {
      inFlightContentSaves.set(key, count);
    }
  }
}

/**
 * A superseded save's echo has landed: replay the later drafts' edits
 * (relative to the sent text) onto the echoed text so the next save neither
 * re-applies intent the daemon already persisted nor swallows a local undo,
 * and re-base the chain on the echo's rev. The newest draft is what the user
 * sees, so it also replaces the store content — unless a refetch already
 * landed a rev newer than the echo (`storeIsNewer`): that content is the
 * daemon state the editor still has to apply, and an older echo's draft must
 * not hide it while the store keeps the newer rev. The drafts are still
 * rebased onto the echo and sent against its rev, so the daemon merges the
 * newer change in rather than treating the draft as an exact write over it.
 * Returns the newest draft's rebased text, if any.
 */
function rebasePendingDrafts(
  key: string,
  noteId: string,
  sent: PendingContent,
  echoed: string,
  echoedRev: number | undefined,
  storeIsNewer: boolean,
): string | undefined {
  const later = (unackedDrafts.get(key) ?? []).filter((d) => d.seq > sent.seq);
  if (echoed !== sent.content) {
    for (const draft of later) draft.content = rebaseText(sent.content, echoed, draft.content);
  }
  if (echoedRev !== undefined) draftBaseRev.set(key, echoedRev);
  const newest = later[later.length - 1];
  if (!newest) return undefined;
  if (!storeIsNewer && readNoteById(sent.workspaceId, noteId)?.content !== newest.content) {
    appStore.dispatch(applyLocalNoteUpdate(sent.workspaceId, noteId, { content: newest.content }));
  }
  return newest.content;
}

/**
 * Apply the daemon's `note.setContent` response as the authoritative local
 * state: the merged `newContent` replaces the store content, and the rev is
 * set from the echoed `rev` when the daemon reports one, else inferred as
 * `sentRev + 1` (older daemons). When a newer local edit exists (debounced,
 * queued behind this save, or in flight) the echo is not applied verbatim —
 * that would overwrite a keystroke — but the later drafts are rebased onto it
 * (`rebasePendingDrafts`) so their save carries only the not-yet-persisted
 * edits against the echo's rev. A concurrent refetch that already landed a
 * newer rev keeps its content on both paths; the rebased draft is then
 * resolved without replacing it, so the editor still receives every pending
 * edit rather than a text that lacks them.
 */
function applyContentSaveResult(
  noteId: string,
  sent: PendingContent,
  sentRev: number | undefined,
  result: MutationResult,
): AppliedNoteContent {
  const { workspaceId, seq } = sent;
  const key = noteKey(workspaceId, noteId);
  const echoed = result.newContent ?? sent.content;
  const nextRev = result.noteRev ?? (sentRev !== undefined ? sentRev + 1 : undefined);
  const stored = readNoteById(workspaceId, noteId);
  const superseded = latestEditSeq.get(key) !== seq;
  const storeIsNewer = stored?.rev !== undefined && nextRev !== undefined && stored.rev > nextRev;
  let rebased: string | undefined;
  if (superseded) {
    rebased = rebasePendingDrafts(key, noteId, sent, echoed, nextRev, storeIsNewer);
  } else if (!storeIsNewer && stored?.content !== echoed) {
    appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { content: echoed }));
  }
  if (nextRev !== undefined) setNoteRevIfNewer(workspaceId, noteId, nextRev);
  if (storeIsNewer && rebased !== undefined) {
    return nextRev !== undefined ? { content: rebased, rev: nextRev } : { content: rebased };
  }
  const applied = readNoteById(workspaceId, noteId);
  if (!applied) return { content: echoed };
  return applied.rev !== undefined
    ? { content: applied.content, rev: applied.rev }
    : { content: applied.content };
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
      toast.error(m.notes_writeService_updateTitleFailed_error(), {
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
      toast.error(m.notes_writeService_deleteFailed_error(), {
        description: result.error ?? m.notes_writeService_unknown_error(),
      });
      if (snapshot) appStore.dispatch(applyNoteCreated(workspaceId, snapshot));
    }
  });
}
