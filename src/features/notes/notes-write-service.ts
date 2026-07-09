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
 * subscribe→refetch loop. The daemon's success responses don't echo the entity,
 * but the advancement is authoritative: a conditional write succeeds only when
 * the stored rev equals `expectedVersion`, and every write bumps `rev` by
 * exactly one (intent-store `update_note_versioned`).
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions/empty-state, collection-utils, and the
 * logger (NOT selectors — once registered in `middleware.ts`, statically
 * importing a `*-selectors.ts` module would evaluate `store.createSelector`
 * while the store module is still mid-initialization through the middleware
 * chain). State reads use the raw `appStore.state.workspaceNotes` shape via
 * the `readWorkspaceNotes` / `readNoteById` helpers below.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import {
  getItem,
  getItems,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import { appClient } from "$lib/client";
import type { MutationResult, NoteMetadataPatch } from "$lib/client";
import { toast } from "svelte-sonner";
import { ContentType, NoteVisibility } from "$shared/types";
import type { CreateNoteRequest, Note } from "$shared/types";
import { NoteId, WorkspaceId } from "$shared/types/branded-ids";
import { store as appStore } from "$store/renderer/store";
import {
  addOptimisticNote,
  applyLocalNoteUpdate,
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  emptyWorkspaceNotesState,
  loadWorkspaceNotesSucceeded,
  removeOptimisticNote,
} from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
import {
  createNoteRequested,
  markNoteRead,
} from "$store/renderer/slices/note-read-tracking/note-read-tracking-slice";
import { openTab } from "$store/renderer/slices/panel-layout/panel-layout-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("NotesWriteService");

/** Debounce window for content saves (the removed saga debounced ~1s). */
export const NOTE_CONTENT_SAVE_DEBOUNCE_MS = 800;

interface PendingContent {
  workspaceId: string;
  content: string;
}

const contentTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingContent = new Map<string, PendingContent>();

// Per-note mutation queues (§11.4-D): chain each note's mutations so a rename
// issued while a content save is in flight waits for it — and therefore reads
// the advanced `rev` — instead of racing it with a stale `expectedVersion`.
const noteMutationQueues = new Map<string, Promise<void>>();

function enqueueNoteMutation<T>(noteId: string, run: () => Promise<T>): Promise<T> {
  const prior = noteMutationQueues.get(noteId) ?? Promise.resolve();
  const result = prior.then(run);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  noteMutationQueues.set(noteId, tail);
  void tail.then(() => {
    if (noteMutationQueues.get(noteId) === tail) noteMutationQueues.delete(noteId);
  });
  return result;
}

function genTempNoteId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === "function") return `optimistic-${c.randomUUID()}`;
  return `optimistic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Read state directly via raw slice shape (NOT via the workspace-notes-selectors
// module) — once registered in `middleware.ts`, statically importing a
// `*-selectors.ts` module would evaluate `store.createSelector` while the store
// module is still mid-initialization through the middleware chain. See
// `git-read-service.ts` / `files-write-service.ts` for the same pattern.
function readWorkspaceNotes(workspaceId: string): Note[] {
  const ws =
    appStore.state.workspaceNotes.byWorkspaceId[workspaceId] ?? emptyWorkspaceNotesState;
  return getItems(ws.notes);
}

function readNoteById(workspaceId: string, noteId: string): Note | undefined {
  const ws =
    appStore.state.workspaceNotes.byWorkspaceId[workspaceId] ?? emptyWorkspaceNotesState;
  return getItem(ws.notes, NoteId(noteId));
}

/**
 * Advance a note's stored `rev` after a successful conditional mutation
 * (§11.4-D): the daemon accepted `expectedVersion === sentRev` and bumped the
 * row's rev by exactly one, so `sentRev + 1` is authoritative. Guarded so a
 * concurrent refetch that already landed a newer rev is never regressed.
 */
function advanceNoteRev(workspaceId: string, noteId: string, sentRev: number): void {
  const current = readNoteById(workspaceId, noteId)?.rev;
  const nextRev = sentRev + 1;
  if (current !== undefined && current >= nextRev) return;
  appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { rev: nextRev }));
}

async function refetchWorkspaceNotes(workspaceId: string): Promise<void> {
  try {
    const notes = await appClient.notes.list(workspaceId);
    appStore.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
  } catch (error) {
    logger.error("Failed to refetch notes after a mutation error", error);
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
  if (current && typeof current === "object") {
    appStore.dispatch(applyNoteUpdated(workspaceId, String(current.id ?? noteId), current));
  } else {
    void refetchWorkspaceNotes(workspaceId);
  }
  logger.warn("Note mutation conflicted; reloaded the latest version", { noteId });
  toast.warning("This note changed on the server", {
    description: "Your change was not applied; reloaded the latest version.",
  });
  return true;
}

/** Create a note with optimistic insert; reconciles to the canonical id on success. */
export async function createNote(
  workspaceId: string,
  data: Omit<CreateNoteRequest, "workspaceId">,
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
    logger.error("Failed to create note", result.error);
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
    logger.error("Failed to refetch notes after creating a note", error);
  }
  return undefined;
}

/**
 * Handle the (post-saga) `createNoteRequested` action: forward to the
 * `appClient.notes.create` seam with the same defaults the legacy
 * "Add new note" saga used (title `"New Note"`, empty content, no tags), then
 * mark the new note read and open it as a real panel-layout tab so it appears
 * in its own focused tab without a manual reload. Mirrors the sidebar's
 * `handleOpenNoteInPanel` path (`openTab` + `markNoteRead`); the panel-layout
 * reducer dedupes by `noteId` so a repeat dispatch focuses the existing tab.
 */
async function handleCreateNoteRequested(workspaceId: string): Promise<void> {
  if (!workspaceId) return;
  const newNoteId = await createNote(workspaceId, {
    title: "New Note",
    content: "",
    tags: [],
  });
  if (!newNoteId) return;
  appStore.dispatch(markNoteRead(workspaceId, newNoteId));
  appStore.dispatch(
    openTab(workspaceId, {
      type: "note",
      title: "New Note",
      closable: true,
      noteId: newNoteId,
      workspaceId,
    }),
  );
}

/**
 * Middleware that gives the (post-saga) `createNoteRequested` trigger a real
 * handler: after the (no-op) reducer passes the action through, it forwards to
 * `appClient.notes.create` and reconciles by opening the new note.
 * Fire-and-forget — dispatch stays synchronous and never throws.
 */
export function createNotesWriteMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action?.type === createNoteRequested.type && Array.isArray(action.payload)) {
      const [wsId] = action.payload as [unknown];
      if (typeof wsId === "string" && wsId.length > 0) {
        void handleCreateNoteRequested(wsId);
      }
    }
    return result;
  };
}

/** Update note content optimistically; the network save is debounced per note. */
export function updateNoteContent(
  workspaceId: string,
  noteId: string,
  content: string,
  options?: { immediate?: boolean },
): void {
  appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { content }));
  pendingContent.set(noteId, { workspaceId, content });

  const existing = contentTimers.get(noteId);
  if (existing) clearTimeout(existing);

  if (options?.immediate) {
    contentTimers.delete(noteId);
    void flushContent(noteId);
    return;
  }
  contentTimers.set(
    noteId,
    setTimeout(() => {
      contentTimers.delete(noteId);
      void flushContent(noteId);
    }, NOTE_CONTENT_SAVE_DEBOUNCE_MS),
  );
}

async function flushContent(noteId: string): Promise<void> {
  const pending = pendingContent.get(noteId);
  if (!pending) return;
  pendingContent.delete(noteId);
  const timer = contentTimers.get(noteId);
  if (timer) {
    clearTimeout(timer);
    contentTimers.delete(noteId);
  }
  await enqueueNoteMutation(noteId, async () => {
    // Forward the current known `rev` as `expectedVersion` (§11.4-D) when it is
    // known; omit it entirely otherwise so behavior is unchanged (last-writer-wins).
    const rev = readNoteById(pending.workspaceId, noteId)?.rev;
    const result =
      rev !== undefined
        ? await appClient.notes.setContent(noteId, pending.content, rev)
        : await appClient.notes.setContent(noteId, pending.content);
    if (!result.success) {
      if (reconcileNoteConflict(pending.workspaceId, noteId, result)) return;
      logger.error("Failed to save note content", result.error);
      await refetchWorkspaceNotes(pending.workspaceId);
      return;
    }
    if (rev !== undefined) advanceNoteRev(pending.workspaceId, noteId, rev);
  });
}

/** Flush a pending debounced content save immediately (e.g. on editor teardown). */
export function flushNoteContent(noteId: string): void {
  if (pendingContent.has(noteId)) void flushContent(noteId);
}

/** Update a note's title optimistically; rolls back to the prior title on failure. */
export async function updateNoteTitle(
  workspaceId: string,
  noteId: string,
  title: string,
): Promise<void> {
  const previous = readNoteById(workspaceId, noteId)?.title;
  appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { title }));

  await enqueueNoteMutation(noteId, async () => {
    const rev = readNoteById(workspaceId, noteId)?.rev;
    const result =
      rev !== undefined
        ? await appClient.notes.updateMetadata(noteId, { title }, rev)
        : await appClient.notes.updateMetadata(noteId, { title });
    if (!result.success) {
      if (reconcileNoteConflict(workspaceId, noteId, result)) return;
      if (previous !== undefined) {
        appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { title: previous }));
      }
      logger.error("Failed to update note title", result.error);
      return;
    }
    if (rev !== undefined) advanceNoteRev(workspaceId, noteId, rev);
  });
}

/** Update a note's title/tags metadata optimistically; rolls back the touched fields on failure. */
export async function updateNoteMetadata(
  workspaceId: string,
  noteId: string,
  metadata: NoteMetadataPatch,
): Promise<void> {
  const existing = readNoteById(workspaceId, noteId);
  const rollback: NoteMetadataPatch = {};
  if (metadata.title !== undefined) rollback.title = existing?.title ?? "";
  if (metadata.tags !== undefined) rollback.tags = existing?.tags ?? [];
  appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, metadata));

  await enqueueNoteMutation(noteId, async () => {
    const rev = readNoteById(workspaceId, noteId)?.rev;
    const result =
      rev !== undefined
        ? await appClient.notes.updateMetadata(noteId, metadata, rev)
        : await appClient.notes.updateMetadata(noteId, metadata);
    if (!result.success) {
      if (reconcileNoteConflict(workspaceId, noteId, result)) return;
      appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, rollback));
      logger.error("Failed to update note metadata", result.error);
      return;
    }
    if (rev !== undefined) advanceNoteRev(workspaceId, noteId, rev);
  });
}

/** Delete a note optimistically; restores it from a snapshot on failure. */
export async function deleteNote(workspaceId: string, noteId: string): Promise<void> {
  const snapshot = readNoteById(workspaceId, noteId);
  appStore.dispatch(applyNoteDeleted(workspaceId, noteId));

  await enqueueNoteMutation(noteId, async () => {
    const rev = snapshot?.rev;
    const result =
      rev !== undefined
        ? await appClient.notes.delete(noteId, rev)
        : await appClient.notes.delete(noteId);
    if (!result.success) {
      if (reconcileNoteConflict(workspaceId, noteId, result)) return;
      if (snapshot) appStore.dispatch(applyNoteCreated(workspaceId, snapshot));
      logger.error("Failed to delete note", result.error);
    }
  });
}
