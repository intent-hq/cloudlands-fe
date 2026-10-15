import { call, cancelled, delay, put, race, take, type SagaGenerator } from 'typed-redux-saga';
import type { AgentSession, Workspace, QueuedMessage } from '$shared/types';
import type { AgentsClient } from '$lib/client/app-client';
import type { createAgentReadOwnership } from '../../../../../features/agent/agent-read-ownership-factory';
import type { createAgentSender } from '../../../../../features/agent/agent-send-factory';
import { hasComposerContextReferences } from '../../../../../features/agent/agent-context';
import { reconcileQueuedMessage } from '../../../../../features/agent/utils/reconcile-queued-message';
import {
  buildRecordedAttempt,
  buildQueuedRecordedAttempt,
} from '../../../../../features/agent/utils/build-recorded-attempt';
import { createChiefVirtualWorkspace } from '../../workspace-agents/chief-virtual-workspace';
import {
  getChiefThreadTitle,
  isPlaceholderChiefThreadName,
} from '../../sidebar-nav/chief-thread-title';
import { CHIEF_WORKSPACE_ID } from '../../sidebar-nav/sidebar-nav-types';
import { clearChatDraft } from '../../transient-ui/transient-ui-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { agentSessionStopChatRequested } from '../../agent-session/agent-session-slice';
import { replaceAgentQueue } from '../../agent-queue/agent-queue-slice';
import {
  pendingSubmissionSending,
  pendingSubmissionSettled,
} from '../../pending-submissions/pending-submissions-slice';
import type {
  PendingSubmissionEntry,
  SubmissionScope,
  SubmissionReference,
} from '../../pending-submissions/pending-submissions-types';
import {
  chatErrorCleared,
  chatLastAttemptedMessageSet,
  chatModelUnavailableCleared,
  chatQueueProcessingReceived,
  chatQueuedRetryRecordSet,
  chatQueuedSendStarted,
  chatSendFailed,
  chatSendStarted,
  chatStopCompleted,
  chatStopInitiated,
  refreshChatTranscriptRequested,
  sendMessage,
  transcriptHydrationSettled,
} from '../chat-state-slice';
import type {
  SendMessagePayload,
  ChatAgentState,
  QueuedMessageSendOutcome,
} from '../chat-state-types';
import { hasSendableMessageContent } from '../chat-send-content';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
type SendAction = ReturnType<typeof sendMessage>;
type StopAction = ReturnType<typeof agentSessionStopChatRequested>;
type EffectReader<Args extends unknown[], R> = { effect(...args: Args): SagaGenerator<R> };
type Images = NonNullable<SendMessagePayload['imageBlocks']>;
type LifecycleSendOptions = {
  submission?: SendMessagePayload['submission'];
  imageBlocks?: SendMessagePayload['imageBlocks'];
  fileBlocks?: SendMessagePayload['fileBlocks'];
  noteIds?: string[];
  contextReferences?: SendMessagePayload['contextReferences'];
  contextItems?: SendMessagePayload['contextItems'];
  noteContextOwnerId?: string;
  composerText?: string;
  queueOwnerId?: string;
  messageMetadata?: SendMessagePayload['messageMetadata'];
  userAppMessageId?: string;
  model?: string;
  priority?: 'interrupt';
};
export function createChatSendWorkers({
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
  prepareImages,
  retryImages,
  noteContextBusyError = m.agent_chatSend_sendNowRejected_error,
  validateQueueAdmission,
}: {
  appClient: { agents: Pick<AgentsClient, 'queue' | 'stop' | 'sendQueuedNow' | 'rename'> };
  captureAgentMutationOwnership: ReturnType<
    typeof createAgentReadOwnership
  >['captureAgentMutationOwnership'];
  selectAgentSessionWorkspaceId: EffectReader<[string], string | undefined>;
  selectAgentSession: EffectReader<[string], AgentSession | undefined>;
  selectWorkspaceById: EffectReader<[string], Workspace | undefined>;
  selectSubmissionIsCurrent: EffectReader<[SubmissionReference], boolean>;
  selectPendingSubmissionEntry: EffectReader<[SubmissionScope], PendingSubmissionEntry | undefined>;
  selectSubmissionObserved: EffectReader<[SubmissionReference], boolean>;
  selectQueueMutationBlocked: EffectReader<[string, string, string?], boolean>;
  selectAgentIsResponding: EffectReader<[string], boolean>;
  selectAgentQueueMessages: EffectReader<[string, string?], QueuedMessage[]>;
  selectTranscriptHydration: EffectReader<[string], ChatAgentState['transcriptHydration']>;
  loadChatTranscript: (agentId: string, wsId?: string) => Promise<void>;
  hydrateAgentQueue: (agentId: string, wsId?: string) => Promise<void>;
  getAgentQueueEventSnapshotSeq: (agentId: string, wsId?: string) => number;
  sendAgentMessage: ReturnType<typeof createAgentSender>;
  prepareImages: (wsId: string, images: Images, agentId: string) => Promise<Images>;
  retryImages: (error: unknown, images: Images) => Images;
  /** Composer references cannot use the daemon queue, which drops per-turn hints.
   * The existing note-specific callback name is retained for compatibility. */
  noteContextBusyError?: () => string;
  validateQueueAdmission?: (
    agentId: string,
    workspaceId: string,
    ownerId: string,
    submission: SubmissionReference | undefined,
  ) => void;
}) {
  const logger = createLogger('ChatSendSaga');
  const CANCELLED_ERROR = 'Chat send operation cancelled';
  function* waitForTranscriptRefresh(agentId: string, wsId: string): SagaGenerator<void> {
    while (true) {
      const { settled, unmounted } = yield* race({
        settled: take(transcriptHydrationSettled),
        unmounted: take(workspaceUnmounted),
      });
      if (unmounted?.payload[0] === wsId) return;
      if (!settled || settled.payload[0] !== agentId) continue;
      yield* delay(0);
      const status = yield* selectTranscriptHydration.effect(agentId);
      if (status !== 'loading') return;
    }
  }

  function* hydrateBeforeSend(agentId: string, wsId: string): SagaGenerator<void> {
    const session = yield* selectAgentSession.effect(agentId);
    if (session && session.messages.length > 0) return;
    const hydration = yield* selectTranscriptHydration.effect(agentId);
    if (session && hydration === 'settled') return;
    yield* put(refreshChatTranscriptRequested(wsId, agentId));
    yield* call(waitForTranscriptRefresh, agentId, wsId);
  }

  function* renameChiefThreadIfPlaceholder(
    agentId: string,
    fallbackText?: string,
  ): SagaGenerator<void> {
    const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
    if (!session || !isPlaceholderChiefThreadName(session.name)) return;
    const hasUserMessage = session.messages.some((message) => message.role === 'user');
    const name = hasUserMessage ? getChiefThreadTitle(session) : (fallbackText?.trim() ?? '');
    if (isPlaceholderChiefThreadName(name)) return;
    try {
      const result = yield* call(
        [appClient.agents, appClient.agents.rename],
        agentId,
        name,
        undefined,
        { skipIfExplicitlySet: true },
      );
      if (!result.success)
        logger.warn('Chief thread rename was not applied', { agentId, error: result.error });
    } catch (error) {
      logger.warn('Chief thread rename failed', { agentId, error });
    }
  }

  function* sendQueuedNow(
    agentId: string,
    wsId: string,
    messageId: string,
  ): SagaGenerator<QueuedMessageSendOutcome> {
    if (yield* selectQueueMutationBlocked.effect(agentId, wsId, messageId))
      throw new Error(m.agent_chatSend_sendNowRejected_error());
    const ownership = captureAgentMutationOwnership(agentId, wsId);
    const result = yield* call([appClient.agents, appClient.agents.sendQueuedNow], {
      agentId,
      workspaceId: wsId,
      messageId,
    });
    if (!result.success) {
      throw new Error(result.error ?? m.agent_chatSend_sendNowRejected_error());
    }
    // A restored/quarantined entry is still queued, NOT a started turn. The
    // daemon's queue events reconcile it; never remove then resend on the FE.
    if (result.quarantined) return 'quarantined';
    if (result.queued) return 'queued';
    if ((yield* mutationIsCurrent(agentId, ownership)) && typeof result.turnId === 'string') {
      yield* put(chatQueueProcessingReceived(agentId, result.turnId));
    }
    return 'delivered';
  }

  function* mutationIsCurrent(
    agentId: string,
    ownership: ReturnType<typeof captureAgentMutationOwnership>,
  ): SagaGenerator<boolean> {
    return ownership.isCurrent(yield* selectAgentSessionWorkspaceId.effect(agentId));
  }

  function* dispatchToLifecycle(
    agentId: string,
    wsId: string,
    text: string,
    workspaceContextStr: string | undefined,
    options: LifecycleSendOptions,
    skipQueueCheck: boolean,
  ): SagaGenerator<void> {
    const ownership = captureAgentMutationOwnership(agentId, wsId);
    const submission = options.submission;
    function* current(): SagaGenerator<boolean> {
      return (
        (yield* mutationIsCurrent(agentId, ownership)) &&
        (!submission || (yield* selectSubmissionIsCurrent.effect(submission)))
      );
    }
    const supported = submission
      ? (yield* selectPendingSubmissionEntry.effect(submission.scope))?.supported === true
      : false;
    function* settle(
      outcome: 'accepted' | 'rejected' | 'uncertain',
      row?: QueuedMessage,
      queued = false,
    ): SagaGenerator<void> {
      if (submission && (yield* current()))
        yield* put(
          pendingSubmissionSettled(
            submission.scope,
            submission.id,
            outcome,
            Date.now(),
            row,
            queued,
          ),
        );
    }
    if (!(yield* current())) return;
    if (options.queueOwnerId) {
      try {
        if (
          !validateQueueAdmission ||
          options.noteIds?.length ||
          options.contextReferences?.length ||
          options.imageBlocks?.length ||
          options.fileBlocks?.length
        )
          throw new Error(m.agent_chatSend_queueRejected_error());
        validateQueueAdmission(agentId, wsId, options.queueOwnerId, submission);
      } catch (error) {
        yield* settle('rejected');
        yield* put(chatSendFailed(agentId, error instanceof Error ? error.message : String(error)));
        return;
      }
    }
    const workspace =
      wsId === CHIEF_WORKSPACE_ID
        ? createChiefVirtualWorkspace()
        : yield* selectWorkspaceById.effect(wsId);
    if (!workspace) {
      yield* settle('rejected');
      yield* put(chatSendFailed(agentId, m.agent_chatSend_workspaceNotFound_error({ id: wsId })));
      return;
    }
    const content = workspaceContextStr ? `${workspaceContextStr}\n\n${text.trim()}` : text.trim();

    // Pre-upload inline images (monorepo#3338): place each one into the
    // workspace's attachment registry (one placement request per image,
    // chunked when large) and swap the wire blocks to attachment references —
    // the send/queue frame stays constant-size. The chief workspace is
    // virtual (no attachment registry), so its sends keep the inline arm.
    // After success the recorded attempt carries the reference blocks (no
    // MB-scale base64 parked in Redux; a retry passes references through
    // untouched). Placement failure fails the send with the per-image reason
    // (never a silent drop) and records the retry blocks — references for the
    // images that did place, the inline blocks tagged with their placement
    // identity for the rest — so "Try again" replays instead of re-placing.
    if ((options.imageBlocks?.length ?? 0) > 0 && wsId !== CHIEF_WORKSPACE_ID) {
      const imageBlocks = options.imageBlocks!;
      try {
        options = {
          ...options,
          imageBlocks: yield* call(prepareImages, wsId, imageBlocks, agentId),
        };
      } catch (error) {
        if (!(yield* current())) return;
        yield* put(
          chatLastAttemptedMessageSet(
            agentId,
            buildRecordedAttempt(content, {
              ...options,
              imageBlocks: retryImages(error, imageBlocks),
            }),
          ),
        );
        yield* settle('rejected');
        yield* put(chatSendFailed(agentId, error instanceof Error ? error.message : String(error)));
        return;
      }
    }

    if (!(yield* current())) return;
    yield* call(hydrateBeforeSend, agentId, wsId);
    if (!(yield* current())) return;
    const recordedAttempt = buildRecordedAttempt(content, options);
    const isResponding = yield* selectAgentIsResponding.effect(agentId);
    if (isResponding && hasComposerContextReferences(options.contextReferences)) {
      yield* put(chatLastAttemptedMessageSet(agentId, recordedAttempt));
      yield* settle('rejected');
      yield* put(chatSendFailed(agentId, noteContextBusyError()));
      return;
    }
    if (options.queueOwnerId || (!skipQueueCheck && isResponding)) {
      if (!submission) yield* put(clearChatDraft(wsId, agentId));
      try {
        const queueOptions = {
          workspaceId: wsId,
          ...(supported && submission ? { messageId: submission.id } : {}),
          ...(options.imageBlocks !== undefined ? { imageBlocks: options.imageBlocks } : {}),
          ...(options.fileBlocks !== undefined ? { fileBlocks: options.fileBlocks } : {}),
          ...(options.messageMetadata !== undefined
            ? { messageMetadata: options.messageMetadata }
            : {}),
          ...(options.queueOwnerId
            ? {
                onDispatch: () => {
                  if (
                    !ownership.isCurrent(wsId) ||
                    !validateQueueAdmission ||
                    !options.queueOwnerId
                  )
                    throw new Error(CANCELLED_ERROR);
                  validateQueueAdmission(agentId, wsId, options.queueOwnerId, submission);
                },
              }
            : {}),
        };
        // Captured BEFORE the wire call: an authoritative snapshot folded while
        // the RPC is in flight — a live agent:queue:updated fold
        // (monorepo#2481) or a hydrate-reconciled fold (monorepo#2486) —
        // advances this seq, and the queue-on-send seed below must then yield
        // to it.
        yield* put(chatQueuedSendStarted(agentId));
        const queueSeqAtSend = getAgentQueueEventSnapshotSeq(agentId, wsId);
        if (submission) yield* put(pendingSubmissionSending(submission.scope, submission.id));
        const result = yield* call(
          [appClient.agents, appClient.agents.queue],
          agentId,
          content,
          queueOptions,
        );
        if (!(yield* current())) return;
        if (!result.success) {
          yield* put(chatLastAttemptedMessageSet(agentId, recordedAttempt));
          yield* settle('rejected');
          yield* put(
            chatSendFailed(agentId, result.error ?? m.agent_chatSend_queueRejected_error()),
          );
          return;
        }
        yield* put(chatErrorCleared(agentId));
        yield* put(chatModelUnavailableCleared(agentId));
        const queuedMessage = result.queuedMessage;
        if (supported) {
          yield* settle('accepted', queuedMessage, true);
          const turnId = result.turnId ?? queuedMessage?.turnId;
          if (queuedMessage && typeof turnId === 'string') {
            const retryMessage = (yield* selectAgentQueueMessages.effect(agentId, wsId)).find(
              (message) => message.id === queuedMessage.id || message.turnId === turnId,
            );
            yield* put(
              chatQueuedRetryRecordSet(
                agentId,
                queuedMessage.id,
                buildQueuedRecordedAttempt(retryMessage ?? queuedMessage, recordedAttempt),
                turnId,
                !retryMessage && (yield* selectSubmissionObserved.effect(submission!)),
              ),
            );
          }
          if (wsId === CHIEF_WORKSPACE_ID)
            yield* call(renameChiefThreadIfPlaceholder, agentId, content);
          void loadChatTranscript(agentId, wsId);
          yield* call(() => hydrateAgentQueue(agentId, wsId).catch(() => undefined));
          return;
        }
        if (queuedMessage) {
          const turnId = result.turnId ?? queuedMessage.turnId;
          let retryMessage: QueuedMessage | undefined = queuedMessage;
          // Seed only when no authoritative snapshot — live agent:queue:updated
          // fold or hydrate-reconciled fold — landed since the send started: a
          // snapshot (including the shrunk-after-drain one) is at least as
          // fresh as this echo, so seeding over it would re-add a just-drained
          // row (monorepo#2481).
          if (
            (yield* current()) &&
            getAgentQueueEventSnapshotSeq(agentId, wsId) === queueSeqAtSend
          ) {
            const existing = yield* selectAgentQueueMessages.effect(agentId, wsId);
            const next = reconcileQueuedMessage(existing, queuedMessage);
            yield* put(replaceAgentQueue(agentId, next, wsId));
          } else if (yield* current()) {
            logger.debug(
              'queue-on-send seed superseded by an authoritative snapshot; reconciling via hydrate',
              { agentId, queuedMessageId: queuedMessage.id },
            );
            // Client-side apply order cannot rank the superseding snapshot
            // against this echo — a hydrate whose getQueue the daemon served
            // BEFORE this send would wrongly suppress a still-queued row
            // (monorepo#2486 review). By now the daemon has processed the
            // enqueue, so one reconciling hydrate returns the true queue in
            // both directions: the row if still queued, without it if drained.
            // Swallowed on failure — the enqueue itself succeeded, so a hydrate
            // error must not surface as chatSendFailed; the service leaves the
            // prior mirror intact on error.
            yield* call(() => hydrateAgentQueue(agentId, wsId).catch(() => undefined));
            retryMessage = (yield* selectAgentQueueMessages.effect(agentId, wsId)).find(
              (message) => message.id === queuedMessage.id || message.turnId === turnId,
            );
          }
          if (typeof turnId === 'string' && (yield* current())) {
            const record = buildQueuedRecordedAttempt(
              retryMessage ?? queuedMessage,
              recordedAttempt,
            );
            yield* put(
              retryMessage
                ? chatQueuedRetryRecordSet(agentId, retryMessage.id, record, turnId)
                : chatQueuedRetryRecordSet(agentId, queuedMessage.id, record, turnId, true),
            );
          }
        }
        if (wsId === CHIEF_WORKSPACE_ID) {
          yield* call(renameChiefThreadIfPlaceholder, agentId, content);
        }
        yield* settle('rejected');
      } catch (error) {
        if (!(yield* current())) return;
        const message = error instanceof Error ? error.message : String(error);
        yield* put(chatLastAttemptedMessageSet(agentId, recordedAttempt));
        yield* settle('uncertain');
        yield* put(chatSendFailed(agentId, m.agent_chatSend_queueFailed_error({ error: message })));
      }
      return;
    }

    yield* put(chatSendStarted(agentId, wsId));
    yield* put(chatLastAttemptedMessageSet(agentId, recordedAttempt));
    if (!submission) yield* put(clearChatDraft(wsId, agentId));
    try {
      if (submission) yield* put(pendingSubmissionSending(submission.scope, submission.id));
      yield* call(sendAgentMessage, agentId, content, workspace, options);
      if ((yield* current()) && wsId === CHIEF_WORKSPACE_ID)
        yield* call(renameChiefThreadIfPlaceholder, agentId);
    } catch (error) {
      if (!(yield* mutationIsCurrent(agentId, ownership))) return;
      if (submission && !(yield* selectPendingSubmissionEntry.effect(submission.scope))) return;
      yield* settle('uncertain');
      yield* put(chatSendFailed(agentId, error instanceof Error ? error.message : String(error)));
    }
  }

  function* handleSend(action: SendAction): SagaGenerator<void> {
    const { agentId, payload } = action.payload;
    if (!agentId || !payload.wsId) return;
    if (payload.queuedMessageId) {
      const ownership = captureAgentMutationOwnership(agentId, payload.wsId);
      try {
        yield* call(sendQueuedNow, agentId, payload.wsId, payload.queuedMessageId);
      } catch (error) {
        if (!(yield* mutationIsCurrent(agentId, ownership))) return;
        yield* put(chatLastAttemptedMessageSet(agentId, null));
        yield* put(chatSendFailed(agentId, error instanceof Error ? error.message : String(error)));
      }
      return;
    }
    if (!hasSendableMessageContent(payload.text, payload)) return;
    const forceSubmit = payload.forceSubmit === true;
    yield* dispatchToLifecycle(
      agentId,
      payload.wsId,
      payload.text,
      payload.workspaceContextStr,
      {
        submission: payload.submission,
        ...(payload.model !== undefined ? { model: payload.model } : {}),
        imageBlocks: payload.imageBlocks,
        fileBlocks: payload.fileBlocks,
        noteIds: payload.noteIds,
        ...(payload.contextReferences !== undefined
          ? { contextReferences: payload.contextReferences }
          : {}),
        ...(hasComposerContextReferences(payload.contextReferences) &&
        payload.contextItems !== undefined
          ? { contextItems: payload.contextItems }
          : {}),
        ...(payload.noteContextOwnerId !== undefined
          ? { noteContextOwnerId: payload.noteContextOwnerId }
          : {}),
        ...(payload.queueOwnerId !== undefined ? { queueOwnerId: payload.queueOwnerId } : {}),
        ...(hasComposerContextReferences(payload.contextReferences)
          ? { composerText: payload.composerText ?? payload.text }
          : {}),
        messageMetadata: payload.messageMetadata,
        userAppMessageId: payload.userAppMessageId,
        priority: forceSubmit ? 'interrupt' : undefined,
      },
      forceSubmit,
    );
  }

  function* performStop(agentId: string): SagaGenerator<void> {
    yield* put(chatStopInitiated(agentId));
    try {
      const result = yield* call(
        [appClient.agents, appClient.agents.stop],
        agentId,
        yield* selectAgentSessionWorkspaceId.effect(agentId),
      );
      if (!result.success)
        logger.warn('Agent stop was not acknowledged', { agentId, error: result.error });
    } finally {
      yield* put(chatStopCompleted(agentId));
    }
  }

  function* handleStop(action: StopAction): SagaGenerator<void> {
    const [agentId] = action.payload;
    let settled = false;
    try {
      const session = yield* selectAgentSession.effect(agentId);
      if (!session) {
        yield* put(action.success(undefined as void));
        settled = true;
        return;
      }
      try {
        yield* call(performStop, agentId);
        yield* put(action.success(undefined as void));
        settled = true;
      } catch (error) {
        yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
        settled = true;
      }
    } finally {
      if (!settled && (yield* cancelled())) {
        yield* put(action.failure(new Error(CANCELLED_ERROR)));
      }
    }
  }
  return {
    dispatchToLifecycle,
    handleSend,
    handleStop,
    mutationIsCurrent,
    performStop,
    sendQueuedNow,
  };
}
