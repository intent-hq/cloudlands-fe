import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { buffers, channel, type Channel } from 'redux-saga';
import {
  call,
  cancelled,
  delay,
  flush,
  join,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { MutationResult, NoteMetadataPatch } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { NoteCapabilityUnknownError } from '$lib/client/live/live-notes-client';
import { rebaseText } from '$lib/notes/text-rebase';
import { exceedsNoteViewLimit, isNoteContentStale } from '$shared/utils/note-content';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { ContentType, NoteVisibility } from '$shared/types';
import type { CreateNoteRequest, Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { notify } from '$lib/components/patterns/notify';
import {
  addCommentAction,
  removeCommentAction,
  updateCommentAction,
} from '../../comments/comments-slice';
import { selectCommentById } from '../../comments/comments-selectors';
import {
  createNoteRequested,
  markNoteRead,
} from '../../note-read-tracking/note-read-tracking-slice';
import { openTab, openTabInRightmostColumnRequested } from '../../panel-layout/panel-layout-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { takeEveryByContextFIFO } from '../../../utils/context-saga-effects';
import { withPreservedUnmetDependsOn } from '../workspace-notes-normalization';
import { selectNoteById, selectWorkspaceNotesState } from '../workspace-notes-selectors';
import {
  addOptimisticNote,
  addCommentRequested,
  applyLocalNoteUpdate,
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  createNote,
  createNotePersistRequested,
  deleteCommentRequested,
  deleteNote,
  deleteNotePersistRequested,
  flushNoteContentRequested,
  loadWorkspaceNotesSucceeded,
  noteContentViewRequested,
  readNoteRequested,
  removeOptimisticNote,
  respondToCommentRequested,
  resolveCommentRequested,
  setNoteContentPending,
  settleNoteContentRequested,
  updateNote,
  updateNoteContent,
  updateNoteTitle,
  updateNoteTitlePersistRequested,
  type AppliedNoteContent,
  NOTE_CONTENT_SAVE_DEBOUNCE_MS,
} from '../workspace-notes-slice';
import {
  clearDaemonTexts,
  daemonTextAt,
  forgetWorkspaceDaemonTexts,
  recordDaemonNote,
  recordDaemonText,
  type DaemonText,
} from './note-daemon-text';
import { toRuntimeNote } from './note-payload-mappers';
import { viewReadOptions } from './note-view-read';

const logger = createLogger('NotesWriteSaga');
export { NOTE_CONTENT_SAVE_DEBOUNCE_MS };

// A draft is enqueued as the very same object that `unackedDrafts` holds, so
// an in-place rebase reaches a command already waiting on the queue.
type PendingContent = {
  kind: 'content';
  workspaceId: string;
  noteId: string;
  content: string;
  seq: number;
};
type ContentCommand = PendingContent;
type MetadataCommand = {
  kind: 'metadata';
  workspaceId: string;
  noteId: string;
  patch: NoteMetadataPatch;
  rollback: NoteMetadataPatch;
  titleOnly: boolean;
};
type DeleteCommand = { kind: 'delete'; workspaceId: string; noteId: string; snapshot?: Note };
type AddCommentCommand = {
  kind: 'add-comment';
  workspaceId: string;
  noteId: string;
  params: Parameters<typeof appClient.comments.add>[1];
};
type RespondCommentCommand = {
  kind: 'respond-comment';
  workspaceId: string;
  noteId: string;
  params: Parameters<typeof appClient.comments.respond>[1];
};
type DeleteCommentCommand = {
  kind: 'delete-comment';
  workspaceId: string;
  noteId: string;
  commentId: string;
};
type ResolveCommentCommand = {
  kind: 'resolve-comment';
  workspaceId: string;
  noteId: string;
  commentId: string;
};
type BarrierCommand = { kind: 'barrier'; workspaceId: string; noteId: string };
type MutationCommand =
  | ContentCommand
  | MetadataCommand
  | DeleteCommand
  | AddCommentCommand
  | RespondCommentCommand
  | DeleteCommentCommand
  | ResolveCommentCommand
  | BarrierCommand;
type MutationCompletion = { value: unknown };
type MutationEnvelope = {
  command: MutationCommand;
  generation: number;
  completion?: Channel<MutationCompletion>;
};
type WorkspaceCleanupAction = ReturnType<typeof workspaceUnmounted>;
type ObservedAction = { type: string; payload?: unknown };

const pendingContent = new Map<string, PendingContent>();
// Sequence number of the most recent local edit per key (mirrors
// `notes-write-service.ts`): a save's echo is authoritative only when no later
// local edit exists — debounced, queued behind it, or in flight.
const latestEditSeq = new Map<string, number>();
// Every draft not yet acknowledged by the daemon, per key, in edit order
// (mirrors `notes-write-service.ts`): the debounced one plus those queued or
// in flight. A superseded save's echo rebases the later drafts in place, so a
// queued command's content is the rebased text by the time it is sent.
const unackedDrafts = new Map<string, PendingContent[]>();
// Rev of the daemon text the current local edit chain is based on (mirrors
// `notes-write-service.ts`): set when a chain starts from a clean state,
// advanced to each echo's rev as the pending drafts are rebased onto it, and
// sent as `expectedVersion`.
const draftBaseRev = new Map<string, number>();
// The daemon text at `draftBaseRev` (see `note-daemon-text.ts`), or `null` when
// it is unknown. Its UTF-8 size is the truncated-read write guard's
// `baseContentBytes` (§5.2 "Truncated note reads"); never an editor baseline,
// a re-serialization, an unsent draft or a size copied from a response. An
// unknown base sends an unguarded write, as before the guard existed.
const draftBase = new Map<string, DaemonText | null>();
// The text the chain's drafts were typed on (the editor baseline, else the
// synced store text): the origin for rebasing them onto a re-read note when the
// guard base is unknown or refused. Never sent as a size.
const draftOrigin = new Map<string, string>();
// Notes whose draft was already rebased once after a `content-base-mismatch`;
// a second refusal offers the text to the user instead of looping.
const mismatchRebased = new Set<string>();
// Notes whose save echo was over the view limit (the note grew past 500 KB
// while a draft was pending): the echo is never put in the editor cache, and a
// bounded view re-read runs once the drafts settle (§5.2 "Truncated note reads").
const boundedRefreshAfterSettle = new Set<string>();
const utf8 = new TextEncoder();
const workspaceMutationGenerations = new Map<string, number>();
let noteMutationQueue: Channel<MutationEnvelope> | undefined;

function noteKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}:${noteId}`;
}

function workspaceMutationGeneration(workspaceId: string): number {
  return workspaceMutationGenerations.get(workspaceId) ?? 0;
}

function isWorkspaceCleanup(action: ObservedAction, workspaceId: string): boolean {
  return (
    action.type === workspaceUnmounted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId
  );
}

function temporaryNoteId(): string {
  const crypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof crypto?.randomUUID === 'function') return `optimistic-${crypto.randomUUID()}`;
  return `optimistic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createRequest(
  workspaceId: string,
  data: Omit<CreateNoteRequest, 'workspaceId'>,
): CreateNoteRequest {
  return {
    workspaceId: WorkspaceId(workspaceId),
    title: data.title,
    content: data.content,
    ...(data.contentType !== undefined ? { contentType: data.contentType } : {}),
    ...(data.tags !== undefined ? { tags: [...data.tags] } : {}),
    ...(data.parentId !== undefined ? { parentId: NoteId(String(data.parentId)) } : {}),
    ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
  };
}

function optimisticNote(
  workspaceId: string,
  tempId: string,
  data: Omit<CreateNoteRequest, 'workspaceId'>,
): Note {
  const now = new Date().toISOString();
  return {
    id: NoteId(tempId),
    workspaceId: WorkspaceId(workspaceId),
    title: data.title,
    content: data.content,
    contentType: data.contentType ?? ContentType.Markdown,
    tags: data.tags ? [...data.tags] : [],
    isPinned: false,
    isArchived: false,
    ...(data.parentId !== undefined ? { parentId: NoteId(String(data.parentId)) } : {}),
    visibility: data.visibility ?? NoteVisibility.Workspace,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Re-list a workspace on the bounded path: slim rows (§5.2 `projection: "slim"`)
 * keep any cached body and its truncation markers at the same rev, and a body
 * that went stale is re-read through the view read (capability-gated
 * `maxContentBytes`) for every consumer still showing it. A full list would
 * load large notes whole and drop their render-only markers.
 */
function* relistWorkspaceNotes(workspaceId: string): SagaGenerator<Note[]> {
  const response: Awaited<ReturnType<typeof appClient.notes.list>> = yield* call(() =>
    appClient.notes.list(workspaceId, { projection: 'slim' }),
  );
  const notes = response.map(toRuntimeNote);
  for (const row of notes) recordDaemonNote(workspaceId, row);
  yield* put(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
  const ws = yield* selectWorkspaceNotesState.effect(workspaceId);
  for (const view of getItems(ws.contentViews)) {
    const note = yield* selectNoteById.effect(workspaceId, view.noteId);
    if (note && (isNoteContentStale(note) || ws.staleContentByNoteId[view.noteId])) {
      yield* put(
        noteContentViewRequested(view.consumerId, view.requestId, workspaceId, view.noteId),
      );
    }
  }
  return notes;
}

function* refetchWorkspaceNotes(workspaceId: string) {
  try {
    yield* call(relistWorkspaceNotes, workspaceId);
  } catch (error) {
    logger.error('Failed to refetch notes after a mutation error', error);
  }
}

function* reconcileConflict(
  workspaceId: string,
  noteId: string,
  result: MutationResult,
): SagaGenerator<boolean> {
  if (!result.conflict) return false;
  const current = result.conflict.current;
  if (current && typeof current === 'object') {
    const note = toRuntimeNote(current as Note);
    const canonicalId = String(note.id || noteId);
    // Mutation-response notes omit the transient `unmetDependsOn` projection
    // (monorepo#2001); keep the cached value so "Waits on" doesn't flicker.
    const cached = yield* selectNoteById.effect(workspaceId, canonicalId);
    if (cached?.contentTruncated || exceedsNoteViewLimit(note.content)) {
      // `current` is the full note; a large one goes through the bounded view read.
      const read = readNoteRequested(workspaceId, canonicalId);
      read.promise.catch((error: unknown) => logger.error('Failed to re-read a large note', error));
      yield* put(read);
    } else {
      recordDaemonNote(workspaceId, note);
      yield* put(
        applyNoteUpdated(workspaceId, canonicalId, withPreservedUnmetDependsOn(note, cached)),
      );
    }
  } else {
    yield* call(refetchWorkspaceNotes, workspaceId);
  }
  logger.warn('Note mutation conflicted; reloaded the latest version', { noteId });
  notify.warning(m.notes_writeService_noteChanged_label(), {
    description: m.notes_writeService_noteChanged_description(),
  });
  return true;
}

function* setRevisionIfNewer(workspaceId: string, noteId: string, nextRev: number) {
  const current = yield* selectNoteById.effect(workspaceId, noteId);
  if (current?.rev !== undefined && current.rev >= nextRev) return;
  yield* put(applyLocalNoteUpdate(workspaceId, noteId, { rev: nextRev }));
}

function* advanceRevision(workspaceId: string, noteId: string, sentRev: number) {
  yield* call(setRevisionIfNewer, workspaceId, noteId, sentRev + 1);
}

/**
 * A superseded save's echo has landed (mirrors `notes-write-service.ts`):
 * replay the later drafts' edits (relative to the sent text) onto the echoed
 * text so the next save neither re-applies persisted intent nor swallows a
 * local undo, re-base the chain on the echo's rev, and show the newest
 * (rebased) draft in the store — unless a refetch already landed a rev newer
 * than the echo (`storeIsNewer`), whose content must stay visible rather than
 * be hidden by an older echo's draft while the store keeps the newer rev.
 */
function* rebasePendingDrafts(
  command: ContentCommand,
  echoed: string,
  echoedRev: number | undefined,
  storeIsNewer: boolean,
  echoTooLarge = false,
) {
  const { workspaceId, noteId } = command;
  const key = noteKey(workspaceId, noteId);
  const later = (unackedDrafts.get(key) ?? []).filter((d) => d.seq > command.seq);
  if (echoed !== command.content) {
    for (const draft of later) draft.content = rebaseText(command.content, echoed, draft.content);
  }
  if (echoedRev !== undefined) {
    draftBaseRev.set(key, echoedRev);
    draftBase.set(key, { rev: echoedRev, content: echoed, truncated: false });
    draftOrigin.set(key, echoed);
  }
  const newest = later[later.length - 1];
  if (!newest) return undefined;
  const stored = yield* selectNoteById.effect(workspaceId, noteId);
  if (!storeIsNewer && !echoTooLarge && stored?.content !== newest.content) {
    yield* put(applyLocalNoteUpdate(workspaceId, noteId, { content: newest.content }));
  }
  return newest.content;
}

/**
 * Apply the daemon's `note.setContent` response as the authoritative local
 * state (mirrors `notes-write-service.ts`): the merged `newContent` replaces
 * the store content and the rev comes from the echoed `rev` when present, else
 * `sentRev + 1` (older daemons). When a newer local edit exists the echo is
 * not applied verbatim; the later drafts are rebased onto it instead
 * (`rebasePendingDrafts`). A refetch that already landed a newer rev keeps its
 * content on both paths.
 */
function* applyContentSaveResult(
  command: ContentCommand,
  sentRev: number | undefined,
  result: MutationResult,
): SagaGenerator<AppliedNoteContent> {
  const { workspaceId, noteId, seq } = command;
  const echoed = result.newContent ?? command.content;
  const nextRev = result.noteRev ?? (sentRev !== undefined ? sentRev + 1 : undefined);
  // An echo with its rev is daemon text: a later chain may be based on it.
  if (result.newContent !== undefined && result.noteRev !== undefined) {
    recordDaemonText(workspaceId, noteId, {
      rev: result.noteRev,
      content: result.newContent,
      truncated: false,
    });
  }
  const stored = yield* selectNoteById.effect(workspaceId, noteId);
  const superseded = latestEditSeq.get(noteKey(workspaceId, noteId)) !== seq;
  const storeIsNewer = stored?.rev !== undefined && nextRev !== undefined && stored.rev > nextRev;
  // A merged echo over the view limit never enters the editor cache; it only
  // settles the rev, and a bounded re-read follows once the drafts settle.
  const echoTooLarge = exceedsNoteViewLimit(echoed);
  if (echoTooLarge) boundedRefreshAfterSettle.add(noteKey(workspaceId, noteId));
  let rebased: string | undefined;
  if (superseded) {
    rebased = yield* call(
      rebasePendingDrafts,
      command,
      echoed,
      nextRev,
      storeIsNewer,
      echoTooLarge,
    );
  } else if (!storeIsNewer && !echoTooLarge && stored?.content !== echoed) {
    yield* put(applyLocalNoteUpdate(workspaceId, noteId, { content: echoed }));
  }
  if (nextRev !== undefined) yield* call(setRevisionIfNewer, workspaceId, noteId, nextRev);
  if (storeIsNewer && rebased !== undefined) {
    return nextRev !== undefined ? { content: rebased, rev: nextRev } : { content: rebased };
  }
  const applied = yield* selectNoteById.effect(workspaceId, noteId);
  if (!applied) return { content: echoed };
  return applied.rev !== undefined
    ? { content: applied.content, rev: applied.rev }
    : { content: applied.content };
}

/** The truncated-read capability: `'unknown'` while no hello is acknowledged. */
function* truncatedReadSupport(): SagaGenerator<boolean | 'unknown'> {
  try {
    return yield* call([appClient.notes, appClient.notes.supportsTruncatedRead]);
  } catch (error) {
    if (error instanceof NoteCapabilityUnknownError) return 'unknown';
    throw error;
  }
}

/** The newest text the user typed for a note, saved or not. */
function newestDraftText(key: string, fallback: string): string {
  return (unackedDrafts.get(key) ?? []).at(-1)?.content ?? fallback;
}

/** Drop every draft and the chain state for a note; the caller keeps the text. */
function* dropDrafts(workspaceId: string, noteId: string) {
  const key = noteKey(workspaceId, noteId);
  pendingContent.delete(key);
  unackedDrafts.delete(key);
  latestEditSeq.delete(key);
  draftBaseRev.delete(key);
  draftBase.delete(key);
  draftOrigin.delete(key);
  yield* put(setNoteContentPending(workspaceId, noteId, false));
}

/**
 * Text that cannot be saved is never dropped silently: a persistent warning
 * offers to copy it.
 */
function offerUnsavedText(text: string, reason: 'too-large' | 'not-applied'): void {
  notify.warning(m.notes_writeService_unsavedEdits_label(), {
    description:
      reason === 'too-large'
        ? m.notes_writeService_unsavedEditsTooLarge_description()
        : m.notes_writeService_unsavedEditsNotApplied_description(),
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: m.notes_writeService_copyUnsavedText_label(),
      onClick: () => {
        void navigator.clipboard
          ?.writeText(text)
          .catch((error: unknown) => logger.error('Failed to copy unsaved note text', error));
      },
    },
  });
}

/**
 * A whole-content write cannot go out guarded as built: the daemon refused its
 * base (§5.2 `content-base-mismatch`), or the base's daemon text is unknown so
 * its size cannot be sent. Every draft on that base is dropped — queued saves
 * included (see `saveContent`) — and the note is re-read through the view read.
 * Still editable: rebase the newest draft from `origin` onto the fresh text and
 * return it for one resubmission on the fresh rev, whose daemon text is now
 * known. Now truncated (or a second attempt, or no fresh read): keep the text
 * for the user to copy.
 */
function* recoverDraftOnFreshRead(
  command: ContentCommand,
  origin: string,
): SagaGenerator<{ content: string; rev: number } | undefined> {
  const { workspaceId, noteId } = command;
  const key = noteKey(workspaceId, noteId);
  // The chain stays open during the read: edits typed meanwhile join it and are
  // part of the newest draft taken below; the queue is held by this command.
  let fresh: Note | null = null;
  try {
    const options = yield* call(viewReadOptions);
    fresh = yield* call([appClient.notes, appClient.notes.get], noteId, workspaceId, options);
  } catch (error) {
    logger.error('Failed to re-read a note after a content base mismatch', error);
  }
  if (fresh && (String(fresh.workspaceId) !== workspaceId || String(fresh.id) !== noteId)) {
    fresh = null;
  }
  // The newest text, including edits typed during the read. Dropping the drafts
  // also retires every queued save built on the old base (see `saveContent`).
  const draft = newestDraftText(key, command.content);
  yield* call(dropDrafts, workspaceId, noteId);
  if (fresh) {
    const note = toRuntimeNote(fresh);
    recordDaemonNote(workspaceId, note);
    yield* put(applyNoteUpdated(workspaceId, noteId, note));
  }
  const alreadyRebased = mismatchRebased.has(key);
  if (!fresh || fresh.contentTruncated || fresh.rev === undefined || alreadyRebased) {
    mismatchRebased.delete(key);
    logger.warn('Note save base unverifiable; kept the unsaved text for the user', { noteId });
    offerUnsavedText(draft, fresh?.contentTruncated ? 'too-large' : 'not-applied');
    return undefined;
  }
  mismatchRebased.add(key);
  logger.warn('Note save base unverifiable; rebased the draft onto the latest text', { noteId });
  return { content: rebaseText(origin, fresh.content, draft), rev: fresh.rev };
}

function forgetDraft(key: string, draft: PendingContent): void {
  const remaining = (unackedDrafts.get(key) ?? []).filter((d) => d !== draft);
  if (remaining.length > 0) unackedDrafts.set(key, remaining);
  else unackedDrafts.delete(key);
}

function* saveContent(command: ContentCommand): SagaGenerator<AppliedNoteContent | undefined> {
  const { workspaceId, noteId } = command;
  const key = noteKey(workspaceId, noteId);
  const note = yield* selectNoteById.effect(workspaceId, noteId);
  // The rev the draft is based on is always sent; it is absent only when the
  // note was never loaded (last-writer-wins). The daemon merges rather than
  // conflicts, so a failure here is a generic failure — no reload+toast
  // conflict path. `command.content` is read here, not at enqueue time: an
  // earlier save's echo may have rebased it while queued.
  // A queued save whose draft was dropped (a recovery rebased its text into a
  // resubmission) must not reach the wire: written at the fresh rev it would
  // replace the note and delete the concurrent change.
  if (!(unackedDrafts.get(key) ?? []).includes(command)) return undefined;
  const rev = draftBaseRev.get(key) ?? note?.rev;
  const base = draftBase.get(key) ?? null;
  const origin = draftOrigin.get(key) ?? base?.content ?? note?.content ?? '';
  let resubmit: { content: string; rev: number } | undefined;
  try {
    // A draft built on a truncated read (§5.2 "Truncated note reads") holds only
    // a prefix: replacing the whole note with it would drop everything after
    // the cut. Decided by the draft's base, not the current row — a draft based
    // on the full text stays safe to send, guarded, after the note grows.
    // An unknown base on a truncated row cannot be verified either.
    if (base?.truncated || (base === null && note?.contentTruncated)) {
      const draft = newestDraftText(key, command.content);
      yield* call(dropDrafts, workspaceId, noteId);
      logger.warn('Kept a draft built on a truncated note read for the user', { noteId });
      offerUnsavedText(draft, 'too-large');
      return undefined;
    }
    // A client that reads with `maxContentBytes` must guard every whole-content
    // write with the size of its base; older daemons never see the param.
    const support = yield* call(truncatedReadSupport);
    // Every whole-content write is guarded: with no known base size, re-read and
    // rebase rather than send an unguarded write.
    if (support === true && (base === null || base.rev !== rev)) {
      resubmit = yield* call(recoverDraftOnFreshRead, command, origin);
      return undefined;
    }
    // Capability unknown (no acknowledged hello yet): a known base is still sent
    // guarded — a daemon without the capability may ignore the param (§5.2) —
    // and with no base the save fails like a dropped connection; the text stays.
    if (support === 'unknown' && base === null) throw new NoteCapabilityUnknownError();
    const guarded = support !== false && base !== null;
    const result: MutationResult = yield* call(
      [appClient.notes, appClient.notes.setContent],
      noteId,
      command.content,
      rev,
      workspaceId,
      ...(guarded && base ? [{ baseContentBytes: utf8.encode(base.content).length }] : []),
    );
    if (result.contentBaseMismatch) {
      resubmit = yield* call(recoverDraftOnFreshRead, command, origin);
      return undefined;
    }
    if (!result.success) {
      logger.error('Failed to save note content', result.error);
      notify.error(m.notes_writeService_saveFailed_error(), {
        description: result.error ?? m.notes_writeService_unknown_error(),
      });
      yield* call(refetchWorkspaceNotes, workspaceId);
      return undefined;
    }
    mismatchRebased.delete(key);
    return yield* call(applyContentSaveResult, command, rev, result);
  } catch (error) {
    logger.error('Failed to save note content', error);
    yield* call(refetchWorkspaceNotes, workspaceId);
    return undefined;
  } finally {
    forgetDraft(key, command);
    // This was the latest edit and nothing later can compare against it; the
    // next edit chain starts from the store's (now in-sync) rev.
    if (latestEditSeq.get(key) === command.seq) {
      latestEditSeq.delete(key);
      draftBaseRev.delete(key);
      draftBase.delete(key);
      draftOrigin.delete(key);
    }
    if ((unackedDrafts.get(key)?.length ?? 0) === 0) {
      yield* put(setNoteContentPending(workspaceId, noteId, false));
      if (boundedRefreshAfterSettle.delete(key)) {
        // The note grew past the limit: re-read it bounded (it comes back
        // truncated, so the view switches to render-only).
        const read = readNoteRequested(workspaceId, noteId);
        read.promise.catch((error: unknown) =>
          logger.error('Failed to re-read a note that grew past the view limit', error),
        );
        yield* put(read);
      }
    }
    // After this command's cleanup, so the new chain's state is not cleared.
    if (resubmit) {
      yield* put(
        updateNoteContent(workspaceId, noteId, resubmit.content, {
          immediate: true,
          baseRev: resubmit.rev,
        }),
      );
    }
  }
}

function* addComment(command: AddCommentCommand): SagaGenerator<boolean> {
  const { workspaceId, noteId, params } = command;
  const rev = (yield* selectNoteById.effect(workspaceId, noteId))?.rev;
  const result: MutationResult = yield* call(
    [appClient.comments, appClient.comments.add],
    noteId,
    params,
  );
  if (!result.success) return false;
  if (result.noteRev !== undefined)
    yield* call(setRevisionIfNewer, workspaceId, noteId, result.noteRev);
  else if (rev !== undefined) yield* call(advanceRevision, workspaceId, noteId, rev);
  return true;
}

function* respondToComment(command: RespondCommentCommand): SagaGenerator<boolean> {
  const result: MutationResult = yield* call(
    [appClient.comments, appClient.comments.respond],
    command.noteId,
    command.params,
  );
  return result.success;
}

function* deleteComment(command: DeleteCommentCommand): SagaGenerator<boolean> {
  const result: MutationResult = yield* call(
    [appClient.comments, appClient.comments.delete],
    command.noteId,
    command.commentId,
    command.workspaceId,
  );
  return result.success;
}

function* resolveComment(command: ResolveCommentCommand): SagaGenerator<boolean> {
  try {
    yield* call(backendRequest, 'comment.resolveThread', {
      workspaceId: command.workspaceId,
      noteId: command.noteId,
      commentId: command.commentId,
      resolved: true,
    });
    return true;
  } catch (error) {
    logger.error('Failed to resolve comment', error);
    return false;
  }
}

function* saveMetadata(command: MetadataCommand) {
  const { workspaceId, noteId, patch, rollback, titleOnly } = command;
  const note = yield* selectNoteById.effect(workspaceId, noteId);
  const rev = note?.rev;
  try {
    const result: MutationResult = yield* call(
      [appClient.notes, appClient.notes.updateMetadata],
      noteId,
      patch,
      rev,
      workspaceId,
    );
    if (!result.success) {
      if (yield* call(reconcileConflict, workspaceId, noteId, result)) return;
      logger.error(
        titleOnly ? 'Failed to update note title' : 'Failed to update note metadata',
        result.error,
      );
      notify.error(
        titleOnly
          ? m.notes_writeService_updateTitleFailed_error()
          : m.notes_writeService_updateFailed_error(),
        { description: result.error ?? m.notes_writeService_unknown_error() },
      );
      yield* put(applyLocalNoteUpdate(workspaceId, noteId, rollback));
      return;
    }
    if (rev !== undefined) yield* call(advanceRevision, workspaceId, noteId, rev);
  } catch (error) {
    logger.error('Failed to update note metadata', error);
    yield* put(applyLocalNoteUpdate(workspaceId, noteId, rollback));
  }
}

function* removeNote(command: DeleteCommand) {
  const { workspaceId, noteId, snapshot } = command;
  try {
    const result: MutationResult = yield* call(
      [appClient.notes, appClient.notes.delete],
      noteId,
      snapshot?.rev,
      workspaceId,
    );
    if (result.success) return;
    if (yield* call(reconcileConflict, workspaceId, noteId, result)) return;
    logger.error('Failed to delete note', result.error);
    notify.error(m.notes_writeService_deleteFailed_error(), {
      description: result.error ?? m.notes_writeService_unknown_error(),
    });
    if (snapshot) yield* put(applyNoteCreated(workspaceId, snapshot));
  } catch (error) {
    logger.error('Failed to delete note', error);
    if (snapshot) yield* put(applyNoteCreated(workspaceId, snapshot));
  }
}

function* runMutation(command: MutationCommand) {
  if (command.kind === 'content') return yield* call(saveContent, command);
  if (command.kind === 'metadata') return yield* call(saveMetadata, command);
  if (command.kind === 'delete') return yield* call(removeNote, command);
  if (command.kind === 'add-comment') return yield* call(addComment, command);
  if (command.kind === 'respond-comment') return yield* call(respondToComment, command);
  if (command.kind === 'delete-comment') return yield* call(deleteComment, command);
  if (command.kind === 'resolve-comment') return yield* call(resolveComment, command);
  return undefined;
}

function* enqueueMutation(
  queue: Channel<MutationEnvelope>,
  command: MutationCommand,
  waitForCompletion = false,
) {
  const envelope = { command, generation: workspaceMutationGeneration(command.workspaceId) };
  if (!waitForCompletion) {
    yield* put(queue, envelope);
    return;
  }
  const completion = channel<MutationCompletion>(buffers.fixed(1));
  try {
    yield* put(queue, { ...envelope, completion });
    const result = yield* take(completion);
    return result.value;
  } finally {
    completion.close();
  }
}

function* flushPendingNoteContent(workspaceId: string, noteId: string) {
  const key = noteKey(workspaceId, noteId);
  const pending = pendingContent.get(key);
  if (!pending) return undefined;
  pendingContent.delete(key);
  if (noteMutationQueue) return yield* enqueueMutation(noteMutationQueue, pending, true);
  return yield* call(runMutation, pending);
}

function* settlePendingNoteContent(workspaceId: string, noteId: string) {
  yield* call(flushPendingNoteContent, workspaceId, noteId);
  if (noteMutationQueue) {
    const barrier: BarrierCommand = { kind: 'barrier', workspaceId, noteId };
    yield* call(enqueueMutation, noteMutationQueue, barrier, true);
  }
}

function* handleContentAction(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof updateNoteContent>,
) {
  const [workspaceId, noteId, initialContent, rawOptions] = action.payload;
  const options = typeof rawOptions === 'boolean' ? { immediate: rawOptions } : (rawOptions ?? {});
  let content = initialContent;
  if (!workspaceId || !noteId || typeof content !== 'string') return;
  const key = noteKey(workspaceId, noteId);
  if (!draftBaseRev.has(key)) {
    const baseRev = options.baseRev ?? (yield* selectNoteById.effect(workspaceId, noteId))?.rev;
    if (baseRev !== undefined) draftBaseRev.set(key, baseRev);
  }
  if (!draftBase.has(key)) {
    // The guard base is the daemon's own text at the chain's base rev.
    draftBase.set(key, daemonTextAt(workspaceId, noteId, draftBaseRev.get(key)) ?? null);
    const origin =
      options.baseContent ?? (yield* selectNoteById.effect(workspaceId, noteId))?.content;
    if (origin !== undefined) draftOrigin.set(key, origin);
  }
  const newest = (unackedDrafts.get(key) ?? []).at(-1);
  if (newest && options.baseContent !== undefined && options.baseContent !== newest.content) {
    content = rebaseText(options.baseContent, newest.content, content);
  }
  // A truncated row is render-only: never show a draft as if it were the prefix.
  if (!(yield* selectNoteById.effect(workspaceId, noteId))?.contentTruncated) {
    yield* put(applyLocalNoteUpdate(workspaceId, noteId, { content }));
  }
  const seq = (latestEditSeq.get(key) ?? 0) + 1;
  latestEditSeq.set(key, seq);
  const pending: PendingContent = { kind: 'content', workspaceId, noteId, content, seq };
  // A still-debounced draft is replaced, never sent.
  const replaced = pendingContent.get(key);
  if (replaced) forgetDraft(key, replaced);
  unackedDrafts.set(key, [...(unackedDrafts.get(key) ?? []), pending]);
  pendingContent.set(key, pending);
  yield* put(setNoteContentPending(workspaceId, noteId, true));
  try {
    if (!options.immediate) yield* delay(NOTE_CONTENT_SAVE_DEBOUNCE_MS);
    if (pendingContent.get(key) !== pending) return;
    pendingContent.delete(key);
    yield* enqueueMutation(queue, pending, true);
  } finally {
    if ((yield* cancelled()) && pendingContent.get(key) === pending) {
      pendingContent.delete(key);
      forgetDraft(key, pending);
      if ((unackedDrafts.get(key)?.length ?? 0) === 0) {
        yield* put(setNoteContentPending(workspaceId, noteId, false));
      }
    }
  }
}

function* handleFlushRequested(action: ReturnType<typeof flushNoteContentRequested>) {
  const [workspaceId, noteId] = action.payload;
  try {
    const result = yield* call(flushPendingNoteContent, workspaceId, noteId);
    yield* put(action.success(result as AppliedNoteContent | undefined));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleSettleRequested(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof settleNoteContentRequested>,
) {
  const [workspaceId, noteId] = action.payload;
  try {
    yield* call(settlePendingNoteContent, workspaceId, noteId);
    yield* put(action.success(undefined as void));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleAddComment(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof addCommentRequested>,
) {
  const [noteId, optimistic, params] = action.payload;
  const workspaceId = params.workspaceId ?? optimistic.workspaceId;
  yield* put(addCommentAction(optimistic));
  if (!workspaceId) {
    yield* put(removeCommentAction(optimistic.id));
    yield* put(action.success(false));
    return;
  }
  try {
    const command: AddCommentCommand = {
      kind: 'add-comment',
      workspaceId,
      noteId,
      params: { ...params, workspaceId },
    };
    const success = (yield* call(enqueueMutation, queue, command, true)) as boolean;
    if (!success) {
      yield* put(removeCommentAction(optimistic.id));
      notify.error(m.comments_writeService_addFailed_error());
    }
    yield* put(action.success(success));
  } catch (error) {
    yield* put(removeCommentAction(optimistic.id));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleRespondComment(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof respondToCommentRequested>,
) {
  const [noteId, optimistic, params] = action.payload;
  const workspaceId = params.workspaceId ?? optimistic.workspaceId;
  yield* put(addCommentAction(optimistic));
  if (!workspaceId) {
    yield* put(removeCommentAction(optimistic.id));
    yield* put(action.success(false));
    return;
  }
  try {
    const command: RespondCommentCommand = {
      kind: 'respond-comment',
      workspaceId,
      noteId,
      params: { ...params, workspaceId },
    };
    const success = (yield* call(enqueueMutation, queue, command, true)) as boolean;
    if (!success) {
      yield* put(removeCommentAction(optimistic.id));
      notify.error(m.comments_writeService_replyFailed_error());
    }
    yield* put(action.success(success));
  } catch (error) {
    yield* put(removeCommentAction(optimistic.id));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleDeleteComment(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof deleteCommentRequested>,
) {
  const [noteId, commentId, explicitWorkspaceId] = action.payload;
  const snapshot = yield* selectCommentById.effect(commentId);
  const workspaceId = explicitWorkspaceId ?? snapshot?.workspaceId;
  yield* put(removeCommentAction(commentId));
  if (!workspaceId) {
    if (snapshot) yield* put(addCommentAction(snapshot));
    yield* put(action.success({ existed: !!snapshot, success: false }));
    return;
  }
  try {
    const command: DeleteCommentCommand = {
      kind: 'delete-comment',
      workspaceId,
      noteId,
      commentId,
    };
    const success = (yield* call(enqueueMutation, queue, command, true)) as boolean;
    if (!success && snapshot) yield* put(addCommentAction(snapshot));
    if (!success) notify.error(m.comments_writeService_deleteFailed_error());
    yield* put(action.success({ existed: !!snapshot, success }));
  } catch (error) {
    if (snapshot) yield* put(addCommentAction(snapshot));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleResolveComment(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof resolveCommentRequested>,
) {
  const [workspaceId, noteId, commentId] = action.payload;
  const snapshot = yield* selectCommentById.effect(commentId);
  if (!snapshot) {
    yield* put(action.success(false));
    return;
  }
  yield* put(updateCommentAction(commentId, { status: 'resolved' }));
  try {
    const command: ResolveCommentCommand = {
      kind: 'resolve-comment',
      workspaceId,
      noteId,
      commentId,
    };
    const success = (yield* call(enqueueMutation, queue, command, true)) as boolean;
    if (!success) yield* put(updateCommentAction(commentId, { status: snapshot.status }));
    yield* put(action.success(success));
  } catch (error) {
    yield* put(updateCommentAction(commentId, { status: snapshot.status }));
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleTitleAction(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof updateNoteTitle>,
) {
  const [workspaceId, noteId, title] = action.payload;
  if (!workspaceId || !noteId || typeof title !== 'string') return;
  const before = yield* selectNoteById.effect(workspaceId, noteId);
  yield* put(applyLocalNoteUpdate(workspaceId, noteId, { title }));
  yield* call(flushPendingNoteContent, workspaceId, noteId);
  yield* enqueueMutation(
    queue,
    {
      kind: 'metadata',
      workspaceId,
      noteId,
      patch: { title },
      rollback: { title: before?.title ?? '' },
      titleOnly: true,
    },
    true,
  );
}

function* handleTitleRequested(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof updateNoteTitlePersistRequested>,
) {
  try {
    yield* call(handleTitleAction, queue, updateNoteTitle(...action.payload));
    yield* put(action.success(undefined as never));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleMetadataAction(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof updateNote>,
) {
  const [workspaceId, noteId, updates] = action.payload;
  if (!workspaceId || !noteId) return;
  const patch: NoteMetadataPatch = {
    ...(updates.title !== undefined ? { title: updates.title } : {}),
    ...(updates.tags !== undefined ? { tags: [...updates.tags] } : {}),
  };
  if (patch.title === undefined && patch.tags === undefined) return;
  const before = yield* selectNoteById.effect(workspaceId, noteId);
  const rollback: NoteMetadataPatch = {
    ...(patch.title !== undefined ? { title: before?.title ?? '' } : {}),
    ...(patch.tags !== undefined ? { tags: before?.tags ? [...before.tags] : [] } : {}),
  };
  yield* put(applyLocalNoteUpdate(workspaceId, noteId, patch));
  yield* call(flushPendingNoteContent, workspaceId, noteId);
  yield* enqueueMutation(
    queue,
    { kind: 'metadata', workspaceId, noteId, patch, rollback, titleOnly: false },
    true,
  );
}

function* handleDeleteAction(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof deleteNote>,
) {
  const [workspaceId, noteId] = action.payload;
  if (!workspaceId || !noteId) return;
  yield* call(flushPendingNoteContent, workspaceId, noteId);
  const snapshot = yield* selectNoteById.effect(workspaceId, noteId);
  yield* put(applyNoteDeleted(workspaceId, noteId));
  yield* enqueueMutation(queue, { kind: 'delete', workspaceId, noteId, snapshot }, true);
}

function* handleDeleteRequested(
  queue: Channel<MutationEnvelope>,
  action: ReturnType<typeof deleteNotePersistRequested>,
) {
  try {
    yield* call(handleDeleteAction, queue, deleteNote(...action.payload));
    yield* put(action.success(undefined as never));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* createNewNote(
  workspaceId: string,
  data: Omit<CreateNoteRequest, 'workspaceId'>,
): SagaGenerator<string | undefined> {
  const tempId = temporaryNoteId();
  const state = yield* selectWorkspaceNotesState.effect(workspaceId);
  const before = new Set(state.notes.ids.map(String));
  const optimistic = optimisticNote(workspaceId, tempId, data);
  let keepOptimistic = true;
  yield* put(addOptimisticNote(workspaceId, optimistic));

  try {
    const result: MutationResult = yield* call(
      [appClient.notes, appClient.notes.create],
      createRequest(workspaceId, data),
    );
    if (!result.success) {
      yield* put(removeOptimisticNote(workspaceId, tempId));
      keepOptimistic = false;
      logger.error('Failed to create note', result.error);
      return undefined;
    }

    try {
      const notes: Note[] = yield* call(relistWorkspaceNotes, workspaceId);
      keepOptimistic = false;
      const created = notes.find((note) => !before.has(String(note.id)));
      if (!created) return undefined;
      yield* put(addOptimisticNote(workspaceId, created));
      return String(created.id);
    } catch (error) {
      keepOptimistic = false;
      logger.error('Failed to refetch notes after creating a note', error);
      return undefined;
    }
  } finally {
    if (keepOptimistic && (yield* cancelled())) {
      yield* put(removeOptimisticNote(workspaceId, tempId));
    }
  }
}

function* handleCreateAction(action: ReturnType<typeof createNote>) {
  const [workspaceId, data] = action.payload;
  if (!workspaceId) return;
  yield* race({
    create: call(createNewNote, workspaceId, data),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* handleCreatePersistRequested(action: ReturnType<typeof createNotePersistRequested>) {
  const [workspaceId, data] = action.payload;
  try {
    const noteId = yield* call(createNewNote, workspaceId, data);
    yield* put(action.success(noteId));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* handleCreateRequested(action: ReturnType<typeof createNoteRequested>) {
  const [workspaceId, options] = action.payload;
  if (!workspaceId) return;
  yield* race({
    create: call(createRequestedNote, workspaceId, options),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* createRequestedNote(
  workspaceId: string,
  options?: { panelLayoutId?: string; panelId?: string },
) {
  const title = m.notes_writeService_newNote_title();
  const noteId = yield* call(createNewNote, workspaceId, { title, content: '', tags: [] });
  if (!noteId) return;
  yield* put(markNoteRead(workspaceId, noteId));
  const panelLayoutId = options?.panelLayoutId ?? workspaceId;
  const tab = {
    type: 'note' as const,
    title,
    closable: true,
    noteId,
    workspaceId,
  };
  yield* put(
    options?.panelId
      ? openTab(panelLayoutId, tab, options.panelId)
      : openTabInRightmostColumnRequested(panelLayoutId, tab),
  );
}

function* cleanupWorkspace(action: WorkspaceCleanupAction) {
  const [workspaceId] = action.payload;
  workspaceMutationGenerations.set(workspaceId, workspaceMutationGeneration(workspaceId) + 1);
  for (const key of pendingContent.keys()) {
    if (key.startsWith(`${workspaceId}:`)) pendingContent.delete(key);
  }
  for (const key of latestEditSeq.keys()) {
    if (key.startsWith(`${workspaceId}:`)) latestEditSeq.delete(key);
  }
  for (const key of draftBaseRev.keys()) {
    if (key.startsWith(`${workspaceId}:`)) draftBaseRev.delete(key);
  }
  for (const key of draftBase.keys()) {
    if (key.startsWith(`${workspaceId}:`)) draftBase.delete(key);
  }
  for (const key of draftOrigin.keys()) {
    if (key.startsWith(`${workspaceId}:`)) draftOrigin.delete(key);
  }
  for (const key of mismatchRebased) {
    if (key.startsWith(`${workspaceId}:`)) mismatchRebased.delete(key);
  }
  for (const key of boundedRefreshAfterSettle) {
    if (key.startsWith(`${workspaceId}:`)) boundedRefreshAfterSettle.delete(key);
  }
  forgetWorkspaceDaemonTexts(workspaceId);
  for (const key of unackedDrafts.keys()) {
    if (key.startsWith(`${workspaceId}:`)) unackedDrafts.delete(key);
  }
}

function* settleDiscardedMutation(envelope: MutationEnvelope) {
  if (envelope.completion) yield* put(envelope.completion, { value: undefined });
}

function* consumeMutation(envelope: MutationEnvelope) {
  const { command, completion, generation } = envelope;
  if (generation !== workspaceMutationGeneration(command.workspaceId)) {
    yield* call(settleDiscardedMutation, envelope);
    return;
  }
  const { mutation } = yield* race({
    mutation: call(runMutation, command),
    cleanup: take((action: ObservedAction) => isWorkspaceCleanup(action, command.workspaceId)),
  });
  if (completion) yield* put(completion, { value: mutation });
}

function* consumeMutations(queue: Channel<MutationEnvelope>) {
  const task = yield* takeEveryByContextFIFO(
    queue,
    ({ command }) => noteKey(command.workspaceId, command.noteId),
    consumeMutation,
    { onDiscardPending: settleDiscardedMutation },
  );
  yield* join(task);
}

export function* notesWriteSaga() {
  const queue = channel<MutationEnvelope>(buffers.expanding());
  noteMutationQueue = queue;
  try {
    // The worker owns keyed replacement. Keeping superseded workers alive until
    // they observe replacement preserves their draft as the next action's
    // rebase baseline; cancelling first would drop an intermediate keystroke.
    yield* takeEvery(updateNoteContent, handleContentAction, queue);
    yield* takeEvery(updateNoteTitle, handleTitleAction, queue);
    yield* takeEvery(updateNoteTitlePersistRequested, handleTitleRequested, queue);
    yield* takeEvery(updateNote, handleMetadataAction, queue);
    yield* takeEvery(deleteNote, handleDeleteAction, queue);
    yield* takeEvery(deleteNotePersistRequested, handleDeleteRequested, queue);
    yield* takeEvery(createNote, handleCreateAction);
    yield* takeEvery(createNotePersistRequested, handleCreatePersistRequested);
    yield* takeEvery(createNoteRequested, handleCreateRequested);
    yield* takeEvery(flushNoteContentRequested, handleFlushRequested);
    yield* takeEvery(settleNoteContentRequested, handleSettleRequested, queue);
    yield* takeEvery(addCommentRequested, handleAddComment, queue);
    yield* takeEvery(respondToCommentRequested, handleRespondComment, queue);
    yield* takeEvery(deleteCommentRequested, handleDeleteComment, queue);
    yield* takeEvery(resolveCommentRequested, handleResolveComment, queue);
    yield* takeEvery(workspaceUnmounted, cleanupWorkspace);
    yield* call(consumeMutations, queue);
  } finally {
    const queued = yield* flush(queue);
    for (const envelope of queued) {
      if (envelope.completion) yield* put(envelope.completion, { value: undefined });
    }
    pendingContent.clear();
    latestEditSeq.clear();
    draftBaseRev.clear();
    draftBase.clear();
    draftOrigin.clear();
    mismatchRebased.clear();
    boundedRefreshAfterSettle.clear();
    clearDaemonTexts();
    unackedDrafts.clear();
    workspaceMutationGenerations.clear();
    queue.close();
    if (noteMutationQueue === queue) noteMutationQueue = undefined;
  }
}
