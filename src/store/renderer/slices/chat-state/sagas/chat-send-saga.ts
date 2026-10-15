import { createChatSendWorkers } from './chat-send-workers';
import { hasSendableMessageContent } from '../chat-send-content';
import { selectQueueMutationBlocked } from '../../pending-submissions/pending-submissions-selectors';
import { prepareSubmissionRetry } from '$features/agent/chat-submission-retry';
import { loadChatTranscript } from '$features/agent/chat-read-service';
import {
  selectSubmissionIsCurrent,
  selectSubmissionObserved,
  selectPendingSubmissionEntry,
} from '../../pending-submissions/pending-submissions-selectors';

import { captureAgentMutationOwnership } from '$features/agent/agent-read-ownership';
import { selectAgentSessionWorkspaceId } from '../../agent-session/agent-session-selectors';
import { call, cancelled, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { agentClient } from '$features/agent/agent.client';
import { sendMessage as sendAgentMessage } from '$features/agent/agent-send';
import {
  getAgentQueueEventSnapshotSeq,
  hydrateAgentQueue,
} from '$features/agent/agent-queue-read-service';

import {
  imageRetryBlocks,
  toImageReferenceBlocks,
  type WireImageBlock,
} from '$lib/components/chat/input/image-attachment-placement';
import { getActiveStalledEvent } from '$lib/components/chat/streaming-status-utils';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { takeEveryByContextFIFO } from '../../../utils/context-saga-effects';
import {
  agentSessionRetryFromStalledRequested,
  agentSessionRetryLastMessageRequested,
  agentSessionRetryWithModelRequested,
  agentSessionRetryWithProviderRequested,
  agentSessionStopChatRequested,
} from '../../agent-session/agent-session-slice';
import {
  selectAgentIsResponding,
  selectAgentSession,
} from '../../agent-session/agent-session-selectors';
import {
  queuedMessageMutationFinished,
  queuedMessageMutationRequested,
  removeQueuedMessageFromAgentQueue,
  upsertQueuedMessageInAgentQueue,
} from '../../agent-queue/agent-queue-slice';
import { selectAgentQueueMessages } from '../../agent-queue/agent-queue-selectors';
import type {
  QueuedMessageMutationRequest,
  QueuedMessageMutationResult,
} from '../../agent-queue/agent-queue-types';
import { getModelsForProviderForLoadingState } from '../../model/model-utils';
import { selectProviderModels } from '../../model/model-selectors';

import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import {
  chatQueuedRetryRecordUpdated,
  chatSendFailed,
  sendMessage,
  sendQueuedMessagesNowRequested,
  clearQueuedMessagesRequested,
} from '../chat-state-slice';
import {
  selectChatLastAttemptedMessage,
  selectChatLastChunkTime,
  selectChatStatusEvents,
  selectTranscriptHydration,
} from '../chat-state-selectors';
import type { QueuedMessageSendOutcome } from '../chat-state-types';

const logger = createLogger('ChatSendSaga');
const CANCELLED_ERROR = 'Chat send operation cancelled';
// Svelte binding; command routing and retry/queue orchestration remain owned here.
const {
  dispatchToLifecycle,
  handleSend,
  handleStop,
  mutationIsCurrent,
  performStop,
  sendQueuedNow,
} = createChatSendWorkers({
  appClient,
  captureAgentMutationOwnership,
  selectAgentSessionWorkspaceId,
  selectAgentSession,
  selectWorkspaceById,
  selectSubmissionIsCurrent,
  selectPendingSubmissionEntry,
  selectSubmissionObserved,
  selectQueueMutationBlocked,
  selectAgentIsResponding,
  selectAgentQueueMessages,
  selectTranscriptHydration,
  loadChatTranscript,
  hydrateAgentQueue,
  getAgentQueueEventSnapshotSeq,
  sendAgentMessage,
  prepareImages: (wsId, images) => toImageReferenceBlocks(wsId, images as WireImageBlock[]),
  retryImages: (error, images) => imageRetryBlocks(error, images as WireImageBlock[]),
});

type SendAction = ReturnType<typeof sendMessage>;
type QueuedMutationAction = ReturnType<typeof queuedMessageMutationRequested>;
type SendQueuedBatchAction = ReturnType<typeof sendQueuedMessagesNowRequested>;
type ClearQueuedAction = ReturnType<typeof clearQueuedMessagesRequested>;
type StopAction = ReturnType<typeof agentSessionStopChatRequested>;
type RetryAction = ReturnType<typeof agentSessionRetryLastMessageRequested>;
type RetryModelAction = ReturnType<typeof agentSessionRetryWithModelRequested>;
type RetryProviderAction = ReturnType<typeof agentSessionRetryWithProviderRequested>;
type RetryFromStalledAction = ReturnType<typeof agentSessionRetryFromStalledRequested>;
type ChatCommand =
  | SendAction
  | QueuedMutationAction
  | SendQueuedBatchAction
  | ClearQueuedAction
  | StopAction
  | RetryAction
  | RetryModelAction
  | RetryProviderAction
  | RetryFromStalledAction;

const ORDINARY_CHAT_COMMANDS = [
  sendMessage,
  queuedMessageMutationRequested,
  sendQueuedMessagesNowRequested,
  clearQueuedMessagesRequested,
  agentSessionRetryLastMessageRequested,
  agentSessionRetryWithModelRequested,
  agentSessionRetryWithProviderRequested,
  agentSessionRetryFromStalledRequested,
];

function* removeQueued(request: QueuedMessageMutationRequest): SagaGenerator<string | undefined> {
  const { agentId, workspaceId, messageId } = request;
  yield* put(removeQueuedMessageFromAgentQueue(agentId, messageId));
  try {
    const result = yield* call(
      [appClient.agents, appClient.agents.removeQueued],
      agentId,
      messageId,
      workspaceId,
    );
    if (result.success) return undefined;
    logger.warn('Queue removal failed; keeping optimistic removal', {
      agentId,
      messageId,
      error: result.error,
    });
    return result.error ?? '';
  } catch (error) {
    logger.error('Queue removal threw; keeping optimistic removal', { agentId, messageId, error });
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Hold, release or save a queued entry. Only the daemon's echoed entry updates the
 * mirror and the parked retry record; without an echo the queue snapshot sync owns it.
 */
function* editQueued(
  request: QueuedMessageMutationRequest,
  content: string,
  editing: boolean | undefined,
): SagaGenerator<QueuedMessageMutationResult> {
  const { agentId, workspaceId, messageId } = request;
  const ownership = captureAgentMutationOwnership(agentId, workspaceId);
  const queueSeqAtEdit = getAgentQueueEventSnapshotSeq(agentId, workspaceId);
  const result = yield* call(
    [appClient.agents, appClient.agents.editQueued],
    agentId,
    messageId,
    content,
    editing,
    workspaceId,
  );
  if (!result.success) {
    logger.error('Failed to edit queued message', { messageId, error: result.error });
    return { status: 'failed', ...(result.error ? { error: result.error } : {}) };
  }
  const echoed = result.queuedMessage;
  if (echoed && (yield* mutationIsCurrent(agentId, ownership))) {
    const existing = yield* selectAgentQueueMessages.effect(agentId, workspaceId);
    if (
      getAgentQueueEventSnapshotSeq(agentId, workspaceId) === queueSeqAtEdit &&
      existing.some((message) => message.id === echoed.id)
    ) {
      yield* put(upsertQueuedMessageInAgentQueue(agentId, echoed));
    }
    yield* put(chatQueuedRetryRecordUpdated(agentId, messageId, echoed.content));
  }
  return { status: 'succeeded' };
}

function* requestIsStale(request: QueuedMessageMutationRequest): SagaGenerator<boolean> {
  const stored = yield* selectAgentSessionWorkspaceId.effect(request.agentId);
  return stored !== undefined && stored !== request.workspaceId;
}

function* performQueuedMutation(
  request: QueuedMessageMutationRequest,
): SagaGenerator<QueuedMessageMutationResult> {
  if (yield* requestIsStale(request)) return { status: 'cancelled' };
  if (
    yield* selectQueueMutationBlocked.effect(
      request.agentId,
      request.workspaceId,
      request.messageId,
    )
  )
    return { status: 'failed', error: m.agent_chatSend_sendNowRejected_error() };
  const { operation } = request;
  if (operation.kind === 'edit') {
    return yield* call(editQueued, request, operation.content, operation.editing);
  }
  if (operation.kind === 'remove') {
    const error = yield* call(removeQueued, request);
    return error === undefined
      ? { status: 'succeeded' }
      : { status: 'failed', ...(error ? { error } : {}) };
  }
  // The row owns a send-now error. Do not replace the running turn's retry
  // payload, clear the composer, or fall back to an ordinary send.
  const sendOutcome = yield* call(
    sendQueuedNow,
    request.agentId,
    request.workspaceId,
    request.messageId,
  );
  return { status: 'succeeded', sendOutcome };
}

function* handleQueuedMutation(action: QueuedMutationAction): SagaGenerator<void> {
  const [request] = action.payload;
  let settled = false;
  try {
    const result = yield* call(performQueuedMutation, request);
    yield* put(queuedMessageMutationFinished(request.requestId, result));
    settled = true;
  } catch (error) {
    yield* put(
      queuedMessageMutationFinished(request.requestId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(queuedMessageMutationFinished(request.requestId, { status: 'cancelled' }));
    }
  }
}

function* handleSendQueuedBatch(action: SendQueuedBatchAction): SagaGenerator<void> {
  const [agentId, wsId, messageIds] = action.payload;
  const ownership = captureAgentMutationOwnership(agentId, wsId);
  let settled = false;
  try {
    if (!(yield* mutationIsCurrent(agentId, ownership))) throw new Error(CANCELLED_ERROR);
    if (yield* selectQueueMutationBlocked.effect(agentId, wsId))
      throw new Error(m.agent_chatSend_sendNowRejected_error());
    const result = yield* call([appClient.agents, appClient.agents.sendQueuedMessagesNow], {
      agentId,
      workspaceId: wsId,
      messageIds,
    });
    if (!result.success) throw new Error(result.error ?? m.agent_chatSend_sendNowRejected_error());
    const outcome: QueuedMessageSendOutcome = result.quarantined
      ? 'quarantined'
      : result.queued
        ? 'queued'
        : 'delivered';
    // The batch RPC emits queue:processing itself; events own turn promotion.
    yield* put(action.success(outcome));
    settled = true;
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) yield* put(action.failure(new Error(CANCELLED_ERROR)));
  }
}

function* handleClearQueued(action: ClearQueuedAction): SagaGenerator<void> {
  const [agentId, wsId, messageIds] = action.payload;
  const ownership = captureAgentMutationOwnership(agentId, wsId);
  let settled = false;
  try {
    for (const messageId of new Set(messageIds)) {
      if (yield* selectQueueMutationBlocked.effect(agentId, wsId))
        throw new Error(m.agent_chatSend_sendNowRejected_error());
      if (!(yield* mutationIsCurrent(agentId, ownership))) throw new Error(CANCELLED_ERROR);
      const result = yield* call(
        { context: appClient.agents, fn: appClient.agents.removeQueued },
        agentId,
        messageId,
        wsId,
      );
      if (!result.success)
        throw new Error(result.error ?? m.agent_chatSend_sendNowRejected_error());
      if (!(yield* mutationIsCurrent(agentId, ownership))) throw new Error(CANCELLED_ERROR);
      yield* put(removeQueuedMessageFromAgentQueue(agentId, messageId));
    }
    yield* put(action.success(undefined as void));
    settled = true;
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) yield* put(action.failure(new Error(CANCELLED_ERROR)));
  }
}

/**
 * Stop the agent's in-flight turn, bracketing the RPC with the
 * chatStopInitiated/chatStopCompleted interrupt flags. chatStopCompleted is
 * put exactly once on every path (success, throw, cancellation).
 */

async function showNothingToRetry(): Promise<void> {
  try {
    const { notify } = await import('$lib/components/patterns/notify');
    notify.info(m.agent_chatSend_nothingToRetry_toast());
  } catch (error) {
    logger.error('Failed to surface retry no-op feedback', error);
  }
}

function* retryLastMessage(
  action: RetryAction | RetryModelAction,
  model?: string,
): SagaGenerator<void> {
  const [agentId, wsId] = action.payload;
  let settled = false;
  try {
    const lastAttempted = yield* selectChatLastAttemptedMessage.effect(agentId);
    if (!lastAttempted || !hasSendableMessageContent(lastAttempted.text, lastAttempted.options)) {
      yield* call(showNothingToRetry);
      yield* put(action.success(undefined as void));
      settled = true;
      return;
    }
    const retry = lastAttempted.submission
      ? yield* call(prepareSubmissionRetry, agentId, wsId, lastAttempted, model)
      : 'legacy';
    if (!retry) {
      yield* put(action.success(undefined as void));
      settled = true;
      return;
    }
    yield* call(
      dispatchToLifecycle,
      agentId,
      wsId,
      lastAttempted.text,
      undefined,
      {
        ...(retry !== 'legacy'
          ? {
              submission: { scope: retry.scope, id: retry.submission.id },
              userAppMessageId: retry.submission.appMessageId,
            }
          : {}),
        imageBlocks: lastAttempted.options?.imageBlocks,
        fileBlocks: lastAttempted.options?.fileBlocks,
        noteIds: lastAttempted.options?.noteIds,
        ...(lastAttempted.options?.composerText !== undefined
          ? { composerText: lastAttempted.options.composerText }
          : {}),
        ...(lastAttempted.options?.contextItems !== undefined
          ? { contextItems: lastAttempted.options.contextItems }
          : {}),
        ...(retry !== 'legacy' && retry.noteContextOwnerId !== undefined
          ? { noteContextOwnerId: retry.noteContextOwnerId }
          : {}),
        ...(lastAttempted.options?.contextReferences !== undefined
          ? { contextReferences: lastAttempted.options.contextReferences }
          : {}),
        messageMetadata: lastAttempted.options?.messageMetadata,
        model: model ?? lastAttempted.options?.model,
      },
      false,
    );
    yield* put(action.success(undefined as void));
    settled = true;
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(CANCELLED_ERROR)));
    }
  }
}

function* handleRetry(action: RetryAction): SagaGenerator<void> {
  yield* call(retryLastMessage, action);
}

function* handleRetryWithModel(action: RetryModelAction): SagaGenerator<void> {
  yield* call(retryLastMessage, action, action.payload[2]);
}

async function showRetryProviderError(message: string): Promise<void> {
  try {
    const { notify } = await import('$lib/components/patterns/notify');
    notify.error(message, { duration: 6000 });
  } catch (error) {
    logger.error('Failed to surface provider-retry failure', error);
  }
}

/**
 * Pick the model to land on when moving a live session to `providerId`
 * (#4455). The banner offers a PROVIDER, but `agent.setModel` only speaks
 * models, so one has to be chosen for the user.
 *
 * The USER'S OWN CHOICE WINS. `persisted` is this provider's entry in the
 * `model.providerDefaults` setting — the model they already told Intent to
 * use for this provider, and the same value the model picker and the
 * daemon's creation-time resolution chain honour. Silently landing on the
 * provider's advertised default instead would override a preference the
 * user had explicitly expressed, which is precisely the complaint that
 * motivates configurable failover.
 *
 * It is still validated against the live catalog: a persisted id the
 * provider no longer serves (renamed, retired, plan downgrade) must not be
 * handed to `agent.setModel`, which would reject it. Falling back then, and
 * when nothing is persisted at all: the provider's advertised default, else
 * the catalog's first row (the daemon returns `models.list` in picker order,
 * so row 0 is the provider's most prominent choice — never a re-sort of our
 * own).
 */
function pickModelForProvider(
  models: AuggieModel[],
  persisted: string | undefined,
): AuggieModel | undefined {
  if (persisted) {
    const chosen = models.find((model) => model.value === persisted);
    if (chosen) return chosen;
  }
  return models.find((model) => model.isDefault === true) ?? models[0];
}

/**
 * Retry the quota-failed turn on a different provider (#4455).
 *
 * Three ordered steps, each a hard gate on the next:
 *   1. Resolve a concrete model on the target provider from its `models.list`
 *      catalog. An empty/failed catalog aborts with a toast rather than
 *      calling setModel with a guessed id the daemon would reject.
 *   2. Switch the LIVE session via `agent.setModel` with an explicit
 *      `providerId` — the only FE→daemon path that carries a provider for a
 *      running agent (the daemon owns the child respawn + history replay).
 *   3. Only on a successful switch, redrive the failed turn through the
 *      retry-with-model path with the picked model as an explicit override,
 *      run inline in this handler so nothing queued behind it on the
 *      per-agent FIFO can move the session again before the redrive goes out.
 *
 * A failed switch must NOT retry — that would re-send to the exhausted
 * provider and fail on quota all over again, which is exactly what the
 * banner exists to avoid.
 */
function* handleRetryWithProvider(action: RetryProviderAction): SagaGenerator<void> {
  const [agentId, wsId, providerId] = action.payload;
  let settled = false;
  try {
    let models: AuggieModel[] = [];
    try {
      const catalog = yield* call(getModelsForProviderForLoadingState, providerId, {
        workspaceId: wsId,
      });
      models = catalog.models;
    } catch (error) {
      logger.warn('Provider retry aborted; model catalog fetch failed', {
        agentId,
        providerId,
        error,
      });
    }
    // The user's configured model for this provider (`model.providerDefaults`,
    // mirrored renderer-side as `providerModels`), so a failover lands where
    // they already said it should.
    const providerModels = yield* selectProviderModels.effect();
    const model = pickModelForProvider(models, providerModels[providerId]);
    if (!model) {
      yield* call(
        showRetryProviderError,
        m.agent_chatSend_retryProviderNoModels_toast({ provider: providerId }),
      );
      yield* put(action.success(undefined as void));
      settled = true;
      return;
    }

    const result = yield* call(
      [agentClient, agentClient.setModel],
      agentId,
      model.value,
      wsId,
      providerId,
    );
    const switchError = result.ok
      ? result.data.success
        ? undefined
        : (result.data.error ?? m.agent_chatSend_retryProviderSwitchRejected_error())
      : result.error;
    if (switchError) {
      logger.warn('Provider retry aborted; setModel failed', {
        agentId,
        providerId,
        model: model.value,
        error: switchError,
      });
      yield* call(
        showRetryProviderError,
        m.agent_chatSend_retryProviderSwitchFailed_toast({
          provider: providerId,
          error: switchError,
        }),
      );
      yield* put(action.failure(new Error(switchError)));
      settled = true;
      return;
    }

    logger.info('Switched session provider for quota retry', {
      agentId,
      providerId,
      model: model.value,
    });
    // Redrive with an EXPLICIT model override rather than the plain
    // last-message retry. The plain path resolves the wire model as
    // `lastAttempted.options?.model ?? session.model` — the first is the
    // exhausted provider's model recorded on the original attempt, and the
    // second is the Redux session, which still holds the old model until the
    // daemon's asynchronous `agent:updated` lands. Either way the redrive
    // would re-send the model we just switched away from, defeating the whole
    // recovery. Passing `model.value` wins that `??` chain outright, so the
    // turn is issued on the provider the user actually picked.
    //
    // Run the redrive INLINE (a `call`, never a `put` back onto the FIFO):
    // the provider buttons stay rendered while this handler's catalog and
    // setModel RPCs are in flight, so a second click may already be queued
    // behind us. A put-back redrive would land AFTER that click, whose own
    // setModel has by then moved the session to a different provider, and
    // `model.value` would be sent against the wrong live provider. Calling
    // here keeps switch + redrive atomic per handler. `retryLastMessage`
    // settles the synthetic action itself and reports retry failures; this
    // handler only awaits the inline worker, not its request promise.
    const redrive = agentSessionRetryWithModelRequested(agentId, wsId, model.value);
    yield* call(retryLastMessage, redrive, model.value);
    yield* put(action.success(undefined as void));
    settled = true;
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(CANCELLED_ERROR)));
    }
  }
}

function matchesUserStop(agentId: string) {
  return (action: { type: string; payload?: unknown }) =>
    action.type === agentSessionStopChatRequested.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === agentId;
}

/**
 * Retry from the stalled state (monorepo#3402): cancel the hung turn and
 * re-send the identical last user input. Guarded on the stall still being
 * active when the command runs — a resumed event, a stream delta, or turn
 * end between the click and this handler makes it a silent no-op, so no
 * duplicate send can race a recovering turn. The re-send goes out through
 * the direct-send arm with `priority: 'interrupt'` (like force-send) so a
 * turn the daemon still considers in flight is preempted instead of the
 * retry auto-queueing behind it (docs/protocol/07-agent-streaming.md).
 */
function* handleRetryFromStalled(action: RetryFromStalledAction): SagaGenerator<void> {
  const [agentId, wsId] = action.payload;
  let settled = false;
  try {
    const statusEvents = yield* selectChatStatusEvents.effect(agentId);
    const lastChunkTime = yield* selectChatLastChunkTime.effect(agentId);
    if (!getActiveStalledEvent(statusEvents, lastChunkTime)) {
      logger.info('Stalled retry skipped; stall no longer active', { agentId });
      yield* put(action.success(undefined as void));
      settled = true;
      return;
    }
    const lastAttempted = yield* selectChatLastAttemptedMessage.effect(agentId);
    if (!lastAttempted || !hasSendableMessageContent(lastAttempted.text, lastAttempted.options)) {
      // Nothing recorded to re-send — just cancel the hung turn.
      yield* call(showNothingToRetry);
      yield* call(performStop, agentId);
      yield* put(action.success(undefined as void));
      settled = true;
      return;
    }
    // A user Cancel (agentSessionStopChatRequested) races the retry: it is
    // handled by a separate takeEvery, so without this guard the retry would
    // still re-send after the user chose to stop. Losing the race abandons
    // the re-send; the concurrent stop handler owns cancelling the turn.
    const { stoppedByUser } = yield* race({
      retried: call(function* retrySequence(): SagaGenerator<void> {
        yield* call(performStop, agentId);
        yield* call(
          dispatchToLifecycle,
          agentId,
          wsId,
          lastAttempted.text,
          undefined,
          {
            imageBlocks: lastAttempted.options?.imageBlocks,
            fileBlocks: lastAttempted.options?.fileBlocks,
            noteIds: lastAttempted.options?.noteIds,
            ...(lastAttempted.options?.composerText !== undefined
              ? { composerText: lastAttempted.options.composerText }
              : {}),
            ...(lastAttempted.options?.contextItems !== undefined
              ? { contextItems: lastAttempted.options.contextItems }
              : {}),
            ...(lastAttempted.options?.contextReferences !== undefined
              ? { contextReferences: lastAttempted.options.contextReferences }
              : {}),
            messageMetadata: lastAttempted.options?.messageMetadata,
            model: lastAttempted.options?.model,
            priority: 'interrupt' as const,
          },
          true,
        );
      }),
      stoppedByUser: take(matchesUserStop(agentId)),
    });
    if (stoppedByUser) {
      logger.info('Stalled retry abandoned; user requested stop', { agentId });
    }
    yield* put(action.success(undefined as void));
    settled = true;
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(CANCELLED_ERROR)));
    }
  }
}

function getCommandAgentId(action: ChatCommand): string {
  if (action.type === sendMessage.type) return (action as SendAction).payload.agentId;
  if (action.type === queuedMessageMutationRequested.type)
    return (action as QueuedMutationAction).payload[0].agentId;
  return (
    action as
      | SendQueuedBatchAction
      | ClearQueuedAction
      | StopAction
      | RetryAction
      | RetryModelAction
      | RetryProviderAction
      | RetryFromStalledAction
  ).payload[0];
}

function* rejectCommand(action: ChatCommand, error: Error): SagaGenerator<void> {
  if (action.type === queuedMessageMutationRequested.type) {
    yield* put(
      queuedMessageMutationFinished(
        (action as QueuedMutationAction).payload[0].requestId,
        error.message === CANCELLED_ERROR
          ? { status: 'cancelled' }
          : { status: 'failed', error: error.message },
      ),
    );
  } else if (action.type === sendQueuedMessagesNowRequested.type) {
    yield* put((action as SendQueuedBatchAction).failure(error));
  } else if (action.type === clearQueuedMessagesRequested.type) {
    yield* put((action as ClearQueuedAction).failure(error));
  } else if (action.type === agentSessionStopChatRequested.type) {
    yield* put((action as StopAction).failure(error));
  } else if (action.type === agentSessionRetryLastMessageRequested.type) {
    yield* put((action as RetryAction).failure(error));
  } else if (action.type === agentSessionRetryWithModelRequested.type) {
    yield* put((action as RetryModelAction).failure(error));
  } else if (action.type === agentSessionRetryWithProviderRequested.type) {
    yield* put((action as RetryProviderAction).failure(error));
  } else if (action.type === agentSessionRetryFromStalledRequested.type) {
    yield* put((action as RetryFromStalledAction).failure(error));
  }
}

function* runChatCommand(action: ChatCommand): SagaGenerator<void> {
  try {
    if (action.type === sendMessage.type) {
      yield* call(handleSend, action as SendAction);
    } else if (action.type === queuedMessageMutationRequested.type) {
      yield* call(handleQueuedMutation, action as QueuedMutationAction);
    } else if (action.type === sendQueuedMessagesNowRequested.type) {
      yield* call(handleSendQueuedBatch, action as SendQueuedBatchAction);
    } else if (action.type === clearQueuedMessagesRequested.type) {
      yield* call(handleClearQueued, action as ClearQueuedAction);
    } else if (action.type === agentSessionStopChatRequested.type) {
      yield* call(handleStop, action as StopAction);
    } else if (action.type === agentSessionRetryLastMessageRequested.type) {
      yield* call(handleRetry, action as RetryAction);
    } else if (action.type === agentSessionRetryFromStalledRequested.type) {
      yield* call(handleRetryFromStalled, action as RetryFromStalledAction);
    } else if (action.type === agentSessionRetryWithProviderRequested.type) {
      yield* call(handleRetryWithProvider, action as RetryProviderAction);
    } else {
      yield* call(handleRetryWithModel, action as RetryModelAction);
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    logger.error('Chat command failed unexpectedly', {
      agentId: getCommandAgentId(action),
      actionType: action.type,
      error: failure,
    });
    if (action.type === sendMessage.type) {
      yield* put(chatSendFailed(getCommandAgentId(action), failure.message));
    } else {
      yield* call(rejectCommand, action, failure);
    }
  }
}

function* discardPendingCommand(action: ChatCommand): SagaGenerator<void> {
  yield* call(rejectCommand, action, new Error(CANCELLED_ERROR));
}

export function* chatSendSaga(): SagaGenerator<void> {
  yield* takeEvery(agentSessionStopChatRequested, runChatCommand);
  yield* takeEveryByContextFIFO(ORDINARY_CHAT_COMMANDS, getCommandAgentId, runChatCommand, {
    onDiscardPending: discardPendingCommand,
  });
}
