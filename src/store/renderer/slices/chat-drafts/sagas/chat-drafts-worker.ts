import { m } from '$shared/paraglide/messages.js';
import type { Task } from 'redux-saga';
import { call, cancel, delay, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import type { DraftsClient } from '$lib/client/app-client';
import { setCachedDraft } from '$lib/components/chat/chat-draft-cache';
import { createLogger } from '$lib/utils/client-logger';
import { takeEveryByContextFIFO } from '../../../utils/context-saga-effects';
import {
  chatDraftClearRequested,
  chatDraftClearStarted,
  chatDraftOwnerReleased,
  chatDraftRestoreRequested,
  chatDraftRestoreSettled,
  chatDraftSaveCancelled,
  chatDraftSaveFlushRequested,
  chatDraftSaveScheduled,
  chatDraftSaveSettled,
  chatDraftSaveStarted,
} from '../chat-drafts-slice';
import type { ChatDraftSaveRequest, ChatDraftSnapshot } from '../chat-drafts-types';

const logger = createLogger('ChatDraftsSaga');

/** Debounce for persisting the draft to the daemon. */
export const CHAT_DRAFT_SAVE_DEBOUNCE_MS = 500;

type ChatDraftsTransport = Pick<DraftsClient, 'get' | 'set' | 'clear'>;
type FlushAction = ReturnType<typeof chatDraftSaveFlushRequested | typeof chatDraftOwnerReleased>;
type ClearRequestAction = ReturnType<typeof chatDraftClearRequested>;
type ClearAction = ReturnType<typeof chatDraftClearStarted>;
type SaveStartedAction = ReturnType<typeof chatDraftSaveStarted>;
type WriteAction = SaveStartedAction | ClearAction;
type CommittedSave = {
  epoch: number;
  rollback: ChatDraftSnapshot | null;
  isCurrent: () => boolean;
};
export type CaptureDraftOwnership = (workspaceId: string, agentId: string) => () => boolean;

const pairKey = (workspaceId: string, agentId: string) => `${workspaceId}\u0000${agentId}`;
const isClear = (action: WriteAction): action is ClearAction =>
  action.type === chatDraftClearStarted.type;
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Owns PROTOCOL §5.16 `drafts.*` I/O for ChatPanel composers: correlated
 * restores, the per-owner save debounce (flushed on switch/unmount), and
 * per-(workspace, agent) FIFO ordering of `drafts.set` / `drafts.clear` so a
 * clear always reaches the daemon after every save committed before it. A
 * clear also bumps the pair's epoch so a save already in flight cannot write
 * its pre-send text back into the switch-back cache.
 */
export function* runChatDrafts(
  drafts: ChatDraftsTransport,
  captureOwnership: CaptureDraftOwnership,
): SagaGenerator<void> {
  const pending: Record<
    string,
    { requestId: string; request: ChatDraftSaveRequest; timer: Task; isCurrent: () => boolean }
  > = {};
  const clears = new WeakMap<ClearAction, () => boolean>();
  const pairs: Record<string, { epoch: number; committed: Record<string, CommittedSave> }> = {};

  const pairState = (key: string) => (pairs[key] ??= { epoch: 0, committed: {} });

  function* commitPending(ownerId: string): SagaGenerator<void> {
    const entry = pending[ownerId];
    if (!entry) return;
    delete pending[ownerId];
    const { requestId, request, isCurrent } = entry;
    // Refresh the switch-back cache synchronously: a flush-at-unmount must be
    // visible to an immediate remount of the same pair.
    if (isCurrent())
      setCachedDraft(request.workspaceId, request.agentId, {
        text: request.text,
        attachments: request.attachments,
      });
    const pair = pairState(pairKey(request.workspaceId, request.agentId));
    pair.committed[requestId] = { epoch: pair.epoch, rollback: request.rollback, isCurrent };
    yield* put(chatDraftSaveStarted(ownerId, requestId, request));
  }

  function* dropPending(ownerId: string): SagaGenerator<void> {
    const entry = pending[ownerId];
    if (!entry) return;
    delete pending[ownerId];
    yield* cancel(entry.timer);
  }

  function* schedule(action: ReturnType<typeof chatDraftSaveScheduled>): SagaGenerator<void> {
    const [ownerId, requestId, request] = action.payload;
    const isCurrent = captureOwnership(request.workspaceId, request.agentId);
    yield* dropPending(ownerId);
    const timer = yield* fork(function* debounceSave() {
      yield* delay(CHAT_DRAFT_SAVE_DEBOUNCE_MS);
      yield* call(commitPending, ownerId);
    });
    pending[ownerId] = { requestId, request, timer, isCurrent };
  }

  function* flush(action: FlushAction): SagaGenerator<void> {
    const ownerId = action.payload[0];
    const entry = pending[ownerId];
    if (!entry) return;
    yield* cancel(entry.timer);
    yield* call(commitPending, ownerId);
  }

  function* cancelPending(action: ReturnType<typeof chatDraftSaveCancelled>): SagaGenerator<void> {
    yield* dropPending(action.payload[0]);
  }

  function* invalidatePair(action: ClearRequestAction): SagaGenerator<void> {
    const [workspaceId, agentId] = action.payload;
    const isCurrent = captureOwnership(workspaceId, agentId);
    if (!isCurrent()) return;
    const key = pairKey(workspaceId, agentId);
    for (const [ownerId, entry] of Object.entries(pending)) {
      if (pairKey(entry.request.workspaceId, entry.request.agentId) === key) {
        yield* dropPending(ownerId);
      }
    }
    const pair = pairs[key];
    if (pair) {
      pair.epoch += 1;
      for (const save of Object.values(pair.committed)) {
        save.rollback = { text: '', attachments: [] };
      }
    }
    setCachedDraft(workspaceId, agentId, { text: '', attachments: [] });
    const clear = chatDraftClearStarted(workspaceId, agentId);
    clears.set(clear, isCurrent);
    yield* put(clear);
  }

  function* restore(action: ReturnType<typeof chatDraftRestoreRequested>): SagaGenerator<void> {
    const [ownerId, requestId, workspaceId, agentId] = action.payload;
    const isCurrent = captureOwnership(workspaceId, agentId);
    try {
      if (!isCurrent()) throw new Error(m.workspace_client_accessChanged_error());
      const draft = yield* call([drafts, drafts.get], workspaceId, agentId);
      if (!isCurrent()) throw new Error(m.workspace_client_accessChanged_error());
      const snapshot = draft ? { text: draft.text, attachments: draft.attachments ?? [] } : null;
      yield* put(chatDraftRestoreSettled(ownerId, requestId, 'restored', snapshot));
    } catch (error) {
      yield* put(chatDraftRestoreSettled(ownerId, requestId, 'failed', null, errorMessage(error)));
    }
  }

  function* write(action: WriteAction): SagaGenerator<void> {
    if (isClear(action)) {
      const [workspaceId, agentId] = action.payload;
      try {
        if (!clears.get(action)?.()) return;
        clears.delete(action);
        yield* call([drafts, drafts.clear], workspaceId, agentId);
      } catch (error) {
        logger.warn('Failed to clear draft', { error: errorMessage(error) });
      }
      return;
    }
    const [ownerId, requestId, request] = action.payload;
    const { workspaceId, agentId, text, attachments } = request;
    const key = pairKey(workspaceId, agentId);
    const pair = pairState(key);
    const save = pair.committed[requestId];
    try {
      if (!save?.isCurrent()) throw new Error(m.workspace_client_accessChanged_error());
      yield* call(
        [drafts, drafts.set],
        workspaceId,
        agentId,
        text,
        attachments.length > 0 ? attachments : undefined,
      );
      if (!save.isCurrent()) throw new Error(m.workspace_client_accessChanged_error());
      delete pair.committed[requestId];
      // A clear splits the pair's rollback history. A successful pre-clear
      // write must not become the rollback baseline for a post-clear draft.
      for (const later of Object.values(pair.committed)) {
        if (later.epoch === save.epoch) later.rollback = { text, attachments };
      }
      // Re-assert on success unless a clear superseded this save.
      if (pair.epoch === save.epoch) setCachedDraft(workspaceId, agentId, { text, attachments });
      yield* put(chatDraftSaveSettled(ownerId, requestId, 'saved'));
    } catch (error) {
      delete pair.committed[requestId];
      // Roll the optimistic cache write back to what the daemon holds.
      if (save?.isCurrent() && pair.epoch === save.epoch && save.rollback) {
        setCachedDraft(workspaceId, agentId, save.rollback);
      }
      yield* put(chatDraftSaveSettled(ownerId, requestId, 'failed', errorMessage(error)));
    } finally {
      if (Object.keys(pair.committed).length === 0) delete pairs[key];
    }
  }

  yield* takeEvery(chatDraftRestoreRequested, restore);
  yield* takeEvery(chatDraftSaveScheduled, schedule);
  yield* takeEvery([chatDraftSaveFlushRequested, chatDraftOwnerReleased], flush);
  yield* takeEvery(chatDraftSaveCancelled, cancelPending);
  yield* takeEvery(chatDraftClearRequested, invalidatePair);
  yield* takeEveryByContextFIFO(
    [chatDraftSaveStarted, chatDraftClearStarted],
    (action: WriteAction) =>
      isClear(action)
        ? pairKey(action.payload[0], action.payload[1])
        : pairKey(action.payload[2].workspaceId, action.payload[2].agentId),
    write,
    {},
  );
}
