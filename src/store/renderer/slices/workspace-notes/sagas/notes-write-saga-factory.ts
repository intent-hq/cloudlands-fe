import { m } from '../../../../../shared/paraglide/messages.js';
import {
  isEditableMarkdownNote,
  isExplicitNoteContentSupported,
} from '../workspace-notes-projections';
import {
  explicitNoteEditorOpened,
  explicitNoteEditorAdmitted,
  explicitNoteEditorReleased,
  explicitNoteEditorRebound,
  explicitNoteSaveReconciled,
  explicitNoteContentAccepted,
  explicitNoteEditorsRetired,
  explicitNoteSaveRequested,
  explicitNoteSaveQueued,
  explicitNoteSaveStarted,
  explicitNoteSaveSettled,
  explicitNoteDraftRebased,
  applyNoteDeleted,
} from '../workspace-notes-slice';
import { buffers, channel, type Channel } from 'redux-saga';
import {
  call,
  cancelled,
  delay,
  flush,
  fork,
  join,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { MutationResult, NotesClient } from '../../../../../lib/client/app-client';
import { rebaseText } from '../../../../../lib/notes/text-rebase';
import type { Note } from '../../../../../shared/types';
import {
  workspaceUnmounted,
  workspaceDeleted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { takeEveryByContextFIFO } from '../../../utils/context-saga-effects';
import type {
  ExplicitNoteEditor,
  ExplicitNoteEditorIdentity,
  ExplicitNoteSaveRequest,
  ExplicitNoteSaveOperation,
  NotesWriteQueue,
} from '../workspace-notes-types';
import {
  applyLocalNoteUpdate,
  updateNoteContent,
  flushNoteContentRequested,
  settleNoteContentRequested,
  setNoteContentPending,
  NOTE_CONTENT_SAVE_DEBOUNCE_MS,
  type AppliedNoteContent,
} from '../workspace-notes-slice';

type PendingContent = {
  kind: 'content';
  workspaceId: string;
  noteId: string;
  content: string;
  seq: number;
  explicit?: {
    request: ExplicitNoteSaveRequest;
    baseRev: number;
    dispatched: boolean;
    active: boolean;
    settled: boolean;
    receipt?: MutationResult;
  };
};
type ContentCommand = PendingContent;
type SiblingCommand = {
  kind: 'sibling';
  workspaceId: string;
  noteId: string;
  run: () => SagaGenerator<unknown>;
};
type MutationCommand =
  ContentCommand | SiblingCommand | { kind: 'barrier'; workspaceId: string; noteId: string };
type MutationCompletion = { value: unknown };
type MutationEnvelope = {
  command: MutationCommand;
  generation: number;
  completion?: Channel<MutationCompletion>;
};
type WorkspaceCleanupAction = ReturnType<typeof workspaceUnmounted>;
type ObservedAction = { type: string; payload?: unknown };

/** One FIFO/content owner. Source binds autosave and sibling mutations; explicit hosts opt in. */
export function createNotesWriteSaga({
  notes,
  selectNoteById,
  source,
  explicit,
}: {
  notes: Pick<NotesClient, 'setContent'>;
  selectNoteById: { effect(workspaceId: string, noteId: string): SagaGenerator<Note | undefined> };
  explicit?: {
    selectEditor: { effect(viewId: string): SagaGenerator<ExplicitNoteEditor | undefined> };
    selectOperations: {
      effect(workspaceId: string, noteId: string): SagaGenerator<ExplicitNoteSaveOperation[]>;
    };
    /** Synchronous final-boundary check of captured authority/context AND the canonical view. */
    isCurrent(identity: ExplicitNoteEditorIdentity): boolean;
    /** Authority check for receipt publication; opening may not yet have a canonical view. */
    canPublish(identity: ExplicitNoteEditorIdentity): boolean;
    dispatch(
      action: ReturnType<
        | typeof explicitNoteEditorAdmitted
        | typeof explicitNoteSaveQueued
        | typeof explicitNoteSaveStarted
        | typeof explicitNoteSaveSettled
      >,
    ): unknown;
  };
  source?: {
    register(queue: NotesWriteQueue): SagaGenerator<void>;
    onContentFailure(workspaceId: string, error: unknown, reported: boolean): SagaGenerator<void>;
  };
}) {
  function* openExplicitEditor(action: ReturnType<typeof explicitNoteEditorOpened>) {
    if (!explicit) return;
    const [identity] = action.payload;
    if (
      !identity.workspaceId ||
      !identity.noteId ||
      !identity.viewId ||
      !identity.authority ||
      !identity.context ||
      !explicit.canPublish(identity)
    )
      return;
    const note = yield* selectNoteById.effect(identity.workspaceId, identity.noteId);
    const existing = yield* explicit.selectEditor.effect(identity.viewId);
    if (
      existing ||
      !isEditableMarkdownNote(note) ||
      String(note.workspaceId) !== identity.workspaceId ||
      String(note.id) !== identity.noteId ||
      !explicit.canPublish(identity)
    )
      return;
    explicit.dispatch(
      explicitNoteEditorAdmitted({
        ...identity,
        baseContent: note.content,
        baseRev: note.rev,
        content: note.content,
        draftSeq: 0,
        retired: false,
        retiredContexts: [],
      }),
    );
  }

  function* admitExplicitSave(
    queue: Channel<MutationEnvelope>,
    action: ReturnType<typeof explicitNoteSaveRequested>,
  ) {
    if (!explicit) return;
    const [request] = action.payload;
    if (!request.requestId || !explicit.isCurrent(request)) return;
    yield* call(reconcileExplicitReceipts, request);
    const editor = yield* explicit.selectEditor.effect(request.viewId);
    const note = yield* selectNoteById.effect(request.workspaceId, request.noteId);
    const operations = yield* explicit.selectOperations.effect(request.workspaceId, request.noteId);
    if (
      !editor ||
      editor.retired ||
      editor.workspaceId !== request.workspaceId ||
      editor.noteId !== request.noteId ||
      editor.authority !== request.authority ||
      editor.context !== request.context ||
      editor.draftSeq !== request.draftSeq ||
      editor.content === editor.baseContent ||
      !isExplicitNoteContentSupported(editor.content) ||
      !isEditableMarkdownNote(note) ||
      String(note.workspaceId) !== request.workspaceId ||
      String(note.id) !== request.noteId ||
      !explicit.isCurrent(request)
    )
      return;
    if (
      operations.some(
        (op) =>
          op.requestId === request.requestId ||
          op.status === 'queued' ||
          op.status === 'running' ||
          op.status === 'unknown' ||
          !!op.deferredRebase,
      )
    )
      return;
    explicit.dispatch(
      explicitNoteSaveQueued({ ...request, baseRev: editor.baseRev, status: 'queued' }),
    );
    const admitted = (yield* explicit.selectOperations.effect(
      request.workspaceId,
      request.noteId,
    )).find((op) => op.requestId === request.requestId);
    if (!admitted || admitted.viewId !== request.viewId || admitted.status !== 'queued') return;
    const command: ContentCommand = {
      kind: 'content',
      workspaceId: request.workspaceId,
      noteId: request.noteId,
      content: editor.content,
      seq: editor.draftSeq,
      explicit: {
        request,
        baseRev: editor.baseRev,
        dispatched: false,
        active: true,
        settled: false,
      },
    };
    try {
      yield* call(enqueueMutation, queue, command, true);
    } finally {
      if (yield* cancelled()) settleExplicitCancellation(command);
    }
  }

  function settleExplicitCancellation(command: ContentCommand) {
    const guard = command.explicit;
    if (!guard || !explicit) return;
    guard.active = false;
    if (!guard.settled)
      explicit.dispatch(
        explicitNoteSaveSettled(
          guard.request.requestId,
          guard.receipt?.success ? 'confirmed' : guard.dispatched ? 'unknown' : 'failed',
          guard.receipt?.success ? guard.receipt.noteRev : undefined,
          undefined,
          guard.receipt?.success
            ? {
                sentContent: command.content,
                content: guard.receipt.newContent as string,
                rev: guard.receipt.noteRev as number,
              }
            : undefined,
        ),
      );
  }

  function explicitCurrent(command: ContentCommand) {
    return !!explicit && !!command.explicit?.active && explicit.isCurrent(command.explicit.request);
  }

  /** The promise retains receipt settlement even after the view or saga has retired. */
  async function writeContent(
    command: ContentCommand,
    rev: number | undefined,
  ): Promise<MutationResult> {
    const guard = command.explicit;
    if (!guard) return notes.setContent(command.noteId, command.content, rev, command.workspaceId);
    if (!explicit) return { success: false, contentOutcome: 'failed' };
    let result: MutationResult;
    try {
      if (!explicitCurrent(command) || !isExplicitNoteContentSupported(command.content))
        throw new Error(m.ui_reversibleActions_cancelled_message());
      result = await notes.setContent(command.noteId, command.content, rev, command.workspaceId, {
        requireContentReceipt: true,
        onDispatch: () => {
          if (guard.dispatched || !explicitCurrent(command))
            throw new Error(m.ui_reversibleActions_cancelled_message());
          explicit.dispatch(explicitNoteSaveStarted(guard.request.requestId));
          if (!explicitCurrent(command) || !isExplicitNoteContentSupported(command.content))
            throw new Error(m.ui_reversibleActions_cancelled_message());
          guard.dispatched = true;
        },
      });
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        contentOutcome: guard.dispatched ? 'unknown' : 'failed',
      };
    }
    const confirmed =
      guard.dispatched &&
      result.success &&
      result.contentOutcome === 'confirmed' &&
      typeof result.newContent === 'string' &&
      typeof result.noteRev === 'number' &&
      Number.isSafeInteger(result.noteRev) &&
      result.noteRev >= guard.baseRev;
    const status = confirmed
      ? 'confirmed'
      : result.contentOutcome === 'unknown'
        ? 'unknown'
        : !guard.dispatched || result.contentOutcome === 'failed'
          ? 'failed'
          : 'unknown';
    const receipt: MutationResult = { ...result, success: confirmed, contentOutcome: status };
    guard.receipt = receipt;
    if (!confirmed || !guard.active) {
      explicit.dispatch(
        explicitNoteSaveSettled(
          guard.request.requestId,
          status,
          confirmed ? result.noteRev : undefined,
          result.error,
          confirmed
            ? {
                sentContent: command.content,
                content: result.newContent as string,
                rev: result.noteRev as number,
              }
            : undefined,
        ),
      );
      guard.settled = true;
    }
    return receipt;
  }

  function* applyExplicitResult(
    command: ContentCommand,
    echoed: string,
    nextRev: number,
  ): SagaGenerator<AppliedNoteContent & { reconciled: boolean }> {
    const guard = command.explicit;
    if (!explicit || !guard || !guard.active || !explicit.canPublish(guard.request))
      return { content: echoed, rev: nextRev, reconciled: false };
    const stored = yield* selectNoteById.effect(command.workspaceId, command.noteId);
    if (!stored || !isEditableMarkdownNote(stored))
      return { content: echoed, rev: nextRev, reconciled: false };
    yield* put(explicitNoteContentAccepted(command.workspaceId, command.noteId, echoed, nextRev));
    // Read after the reducer's revision guard; an authoritative event or edit can arrive
    // synchronously while the accepted content action is being observed.
    const applied = yield* selectNoteById.effect(command.workspaceId, command.noteId);
    const editor = yield* explicit.selectEditor.effect(guard.request.viewId);
    if (!applied || applied.rev === undefined || !explicit.canPublish(guard.request))
      return { content: echoed, rev: nextRev, reconciled: false };
    const storeIsNewer = applied.rev > nextRev;
    const baseContent = storeIsNewer ? applied.content : echoed;
    const baseRev = storeIsNewer ? applied.rev : nextRev;
    if (
      editor &&
      !editor.retired &&
      editor.authority === guard.request.authority &&
      explicit.canPublish(guard.request)
    ) {
      let content =
        editor.draftSeq === command.seq
          ? echoed
          : rebaseText(command.content, echoed, editor.content);
      if (storeIsNewer) content = rebaseText(echoed, baseContent, content);
      yield* put(
        explicitNoteDraftRebased(editor.viewId, editor.draftSeq, content, baseContent, baseRev),
      );
    }
    return { content: baseContent, rev: baseRev, reconciled: true };
  }

  function* reconcileExplicitReceipts(identity: ExplicitNoteEditorIdentity) {
    if (!explicit || !explicit.isCurrent(identity)) return;
    const operations = yield* explicit.selectOperations.effect(
      identity.workspaceId,
      identity.noteId,
    );
    for (const operation of operations) {
      const history = operation.deferredRebase;
      if (
        !history ||
        operation.viewId !== identity.viewId ||
        operation.authority !== identity.authority
      )
        continue;
      const applied = yield* call(
        applyExplicitResult,
        {
          kind: 'content' as const,
          workspaceId: identity.workspaceId,
          noteId: identity.noteId,
          content: history.sentContent,
          seq: operation.draftSeq,
          explicit: {
            request: operation,
            baseRev: operation.baseRev,
            dispatched: true,
            active: true,
            settled: true,
          },
        },
        history.content,
        history.rev,
      );
      if (applied.reconciled) yield* put(explicitNoteSaveReconciled(operation.requestId));
    }
  }
  function* rebindExplicitEditor(action: ReturnType<typeof explicitNoteEditorRebound>) {
    yield* call(reconcileExplicitReceipts, action.payload[0]);
  }

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

  function* setRevisionIfNewer(workspaceId: string, noteId: string, nextRev: number) {
    const current = yield* selectNoteById.effect(workspaceId, noteId);
    if (current?.rev !== undefined && current.rev >= nextRev) return;
    yield* put(applyLocalNoteUpdate(workspaceId, noteId, { rev: nextRev }));
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
  ) {
    const { workspaceId, noteId } = command;
    const key = noteKey(workspaceId, noteId);
    const later = (unackedDrafts.get(key) ?? []).filter((d) => d.seq > command.seq);
    if (echoed !== command.content) {
      for (const draft of later) draft.content = rebaseText(command.content, echoed, draft.content);
    }
    if (echoedRev !== undefined) draftBaseRev.set(key, echoedRev);
    const newest = later[later.length - 1];
    if (!newest) return undefined;
    const stored = yield* selectNoteById.effect(workspaceId, noteId);
    if (!storeIsNewer && stored?.content !== newest.content) {
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
  ): SagaGenerator<AppliedNoteContent & { reconciled?: boolean }> {
    const { workspaceId, noteId, seq } = command;
    if (
      command.explicit &&
      typeof result.newContent === 'string' &&
      typeof result.noteRev === 'number'
    )
      return yield* call(applyExplicitResult, command, result.newContent, result.noteRev);
    const echoed = result.newContent ?? command.content;
    const nextRev = result.noteRev ?? (sentRev !== undefined ? sentRev + 1 : undefined);
    const stored = yield* selectNoteById.effect(workspaceId, noteId);
    const superseded = latestEditSeq.get(noteKey(workspaceId, noteId)) !== seq;
    const storeIsNewer = stored?.rev !== undefined && nextRev !== undefined && stored.rev > nextRev;
    let rebased: string | undefined;
    if (superseded) {
      rebased = yield* call(rebasePendingDrafts, command, echoed, nextRev, storeIsNewer);
    } else if (!storeIsNewer && stored?.content !== echoed) {
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
    const rev = command.explicit?.baseRev ?? draftBaseRev.get(key) ?? note?.rev;
    try {
      const result: MutationResult = yield* call(writeContent, command, rev);
      if (!result.success) {
        if (source && !command.explicit)
          yield* call(source.onContentFailure, workspaceId, result.error, true);
        return undefined;
      }
      const applied = yield* call(applyContentSaveResult, command, rev, result);
      if (command.explicit && explicit) {
        explicit.dispatch(
          explicitNoteSaveSettled(
            command.explicit.request.requestId,
            'confirmed',
            result.noteRev,
            undefined,
            applied.reconciled === false
              ? {
                  sentContent: command.content,
                  content: result.newContent as string,
                  rev: result.noteRev as number,
                }
              : undefined,
          ),
        );
        command.explicit.settled = true;
      }
      return applied;
    } catch (error) {
      if (command.explicit?.receipt?.success && explicit) {
        const receipt = command.explicit.receipt;
        explicit.dispatch(
          explicitNoteSaveSettled(
            command.explicit.request.requestId,
            'confirmed',
            receipt.noteRev,
            undefined,
            {
              sentContent: command.content,
              content: receipt.newContent as string,
              rev: receipt.noteRev as number,
            },
          ),
        );
        command.explicit.settled = true;
      }
      if (source && !command.explicit)
        yield* call(source.onContentFailure, workspaceId, error, false);
      return undefined;
    } finally {
      if (command.explicit) {
        if (yield* cancelled()) settleExplicitCancellation(command);
      } else {
        forgetDraft(key, command);
        // This was the latest edit and nothing later can compare against it; the
        // next edit chain starts from the store's (now in-sync) rev.
        if (latestEditSeq.get(key) === command.seq) {
          latestEditSeq.delete(key);
          draftBaseRev.delete(key);
        }
        if ((unackedDrafts.get(key)?.length ?? 0) === 0) {
          yield* put(setNoteContentPending(workspaceId, noteId, false));
        }
      }
    }
  }

  function* runMutation(command: MutationCommand) {
    if (command.kind === 'content') return yield* call(saveContent, command);
    if (command.kind === 'sibling') return yield* call(command.run);
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
      const barrier: MutationCommand = { kind: 'barrier', workspaceId, noteId };
      yield* call(enqueueMutation, noteMutationQueue, barrier, true);
    }
  }

  function* handleContentAction(
    queue: Channel<MutationEnvelope>,
    action: ReturnType<typeof updateNoteContent>,
  ) {
    const [workspaceId, noteId, initialContent, rawOptions] = action.payload;
    const options =
      typeof rawOptions === 'boolean' ? { immediate: rawOptions } : (rawOptions ?? {});
    let content = initialContent;
    if (!workspaceId || !noteId || typeof content !== 'string') return;
    const key = noteKey(workspaceId, noteId);
    if (!draftBaseRev.has(key)) {
      const baseRev = options.baseRev ?? (yield* selectNoteById.effect(workspaceId, noteId))?.rev;
      if (baseRev !== undefined) draftBaseRev.set(key, baseRev);
    }
    const newest = (unackedDrafts.get(key) ?? []).at(-1);
    if (newest && options.baseContent !== undefined && options.baseContent !== newest.content) {
      content = rebaseText(options.baseContent, newest.content, content);
    }
    yield* put(applyLocalNoteUpdate(workspaceId, noteId, { content }));
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
    } finally {
      if (yield* cancelled())
        yield* put(action.failure(new Error(m.ui_reversibleActions_cancelled_message())));
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
    } finally {
      if (yield* cancelled())
        yield* put(action.failure(new Error(m.ui_reversibleActions_cancelled_message())));
    }
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
    for (const key of unackedDrafts.keys()) {
      if (key.startsWith(`${workspaceId}:`)) unackedDrafts.delete(key);
    }
  }

  function* settleDiscardedMutation(envelope: MutationEnvelope) {
    if (envelope.command.kind === 'content') settleExplicitCancellation(envelope.command);
    if (envelope.completion) yield* put(envelope.completion, { value: undefined });
  }

  function isMutationCleanup(action: ObservedAction, command: MutationCommand): boolean {
    return (
      isWorkspaceCleanup(action, command.workspaceId) ||
      (command.kind === 'content' &&
        command.explicit !== undefined &&
        (action.type === explicitNoteEditorsRetired.type ||
          (action.type === explicitNoteEditorReleased.type &&
            Array.isArray(action.payload) &&
            action.payload[0] === command.explicit.request.viewId) ||
          (action.type === workspaceDeleted.type &&
            Array.isArray(action.payload) &&
            action.payload[0] === command.workspaceId) ||
          (action.type === applyNoteDeleted.type &&
            Array.isArray(action.payload) &&
            action.payload[0] === command.workspaceId &&
            action.payload[1] === command.noteId)))
    );
  }

  function* consumeMutation(envelope: MutationEnvelope) {
    const { command, completion, generation } = envelope;
    if (generation !== workspaceMutationGeneration(command.workspaceId)) {
      yield* call(settleDiscardedMutation, envelope);
      return;
    }
    const { mutation } = yield* race({
      mutation: call(runMutation, command),
      cleanup: take((action: ObservedAction) => isMutationCleanup(action, command)),
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

  return function* notesWriteSaga() {
    const queue = channel<MutationEnvelope>(buffers.expanding());
    noteMutationQueue = queue;
    try {
      if (explicit) {
        yield* takeEvery(explicitNoteEditorOpened, openExplicitEditor);
        yield* takeEvery(explicitNoteEditorRebound, rebindExplicitEditor);
        yield* takeEvery(explicitNoteSaveRequested, admitExplicitSave, queue);
      }
      if (source) {
        yield* takeEvery(updateNoteContent, handleContentAction, queue);
        yield* takeEvery(flushNoteContentRequested, handleFlushRequested);
        yield* takeEvery(settleNoteContentRequested, handleSettleRequested, queue);
        yield* fork(source.register, {
          enqueue: function* (
            workspaceId: string,
            noteId: string,
            run: () => SagaGenerator<unknown>,
          ) {
            return yield* call(
              enqueueMutation,
              queue,
              { kind: 'sibling' as const, workspaceId, noteId, run },
              true,
            );
          },
          flush: flushPendingNoteContent,
        });
      }
      yield* takeEvery(workspaceUnmounted, cleanupWorkspace);
      yield* call(consumeMutations, queue);
    } finally {
      const queued = yield* flush(queue);
      for (const envelope of queued) yield* call(settleDiscardedMutation, envelope);
      pendingContent.clear();
      latestEditSeq.clear();
      draftBaseRev.clear();
      unackedDrafts.clear();
      workspaceMutationGenerations.clear();
      queue.close();
      if (noteMutationQueue === queue) noteMutationQueue = undefined;
    }
  };
}
