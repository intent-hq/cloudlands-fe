import {
  agentSessionRetryLastMessageRequested,
  agentSessionRetryWithModelRequested,
} from '../../store/renderer/slices/agent-session/agent-session-slice';
import { sendMessage } from '../../store/renderer/slices/chat-state/chat-state-slice';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { LastAttemptedMessage } from '../../store/renderer/slices/chat-state/chat-state-types';
import { m } from '$shared/paraglide/messages.js';

import {
  getPendingSubmissionEntry,
  type SubmissionProjectionState,
} from '../../store/renderer/slices/pending-submissions/pending-submissions-projections';
import { getAgentChatState } from '../../store/renderer/slices/chat-state/chat-state-projections';
import type { ChatStateSlice } from '../../store/renderer/slices/chat-state/chat-state-types';
import type { StoreDispatch } from '@themislib/themis/types';
import type { createChatSubmission } from './chat-submission-factory';
import { hasComposerContextReferences } from './agent-context';
export function createSubmissionRetry({
  store,
  admitChatMessage,
  submitChatMessage,
  hydrateAgentQueue,
  loadChatTranscript,
  getNotify,
}: {
  store: {
    readonly state: SubmissionProjectionState & { chatState: ChatStateSlice };
    dispatch: StoreDispatch;
  };
  admitChatMessage: ReturnType<typeof createChatSubmission>['admitChatMessage'];
  submitChatMessage: ReturnType<typeof createChatSubmission>['submitChatMessage'];
  hydrateAgentQueue: (agentId: string, workspaceId?: string) => Promise<void>;
  loadChatTranscript: (agentId: string, workspaceId?: string) => Promise<void>;
  getNotify: () => Promise<{
    warning(
      message: string,
      options: {
        key: string;
        duration: number;
        action: { label: string; onClick: () => void };
        cancel: { label: string; onClick: () => void };
        onDismiss: () => void;
      },
    ): unknown;
  }>;
}) {
  function retryPayload(
    workspaceId: string,
    attempt: LastAttemptedMessage,
    model?: string,
    noteContextOwnerId?: string,
  ) {
    return {
      wsId: workspaceId,
      text: attempt.text,
      ...(attempt.options?.composerText !== undefined
        ? { composerText: attempt.options.composerText }
        : {}),
      imageBlocks: attempt.options?.imageBlocks,
      fileBlocks: attempt.options?.fileBlocks,
      noteIds: attempt.options?.noteIds,
      ...(attempt.options?.contextItems !== undefined
        ? { contextItems: attempt.options.contextItems }
        : {}),
      ...(attempt.options?.contextReferences !== undefined
        ? { contextReferences: attempt.options.contextReferences }
        : {}),
      ...(noteContextOwnerId !== undefined ? { noteContextOwnerId } : {}),
      messageMetadata: attempt.options?.messageMetadata,
      model: model ?? attempt.options?.model,
    };
  }

  /** Prior identity is provenance, never permission to reuse an old admission. */
  async function prepareSubmissionRetry(
    agentId: string,
    workspaceId: string,
    attempt: LastAttemptedMessage,
    model?: string,
    onAdmitted?: (id: string) => void,
    noteContextOwnerId?: string,
  ) {
    const prior = attempt.submission;
    if (!prior) return 'legacy' as const;
    const reference = prior.reference;
    const current = () =>
      reference.scope.agentId === agentId &&
      reference.scope.workspaceId === workspaceId &&
      getAgentChatState(store.state, agentId).lastAttemptedMessage === attempt
        ? getPendingSubmissionEntry(store.state, reference.scope)
        : undefined;
    const entry = current();
    if (!entry) return null;
    if (!entry.supported) return 'legacy' as const;
    const admitRetry = () => {
      const payload = retryPayload(workspaceId, attempt, model, noteContextOwnerId);
      const admitted = admitChatMessage(store, agentId, payload);
      return admitted ? { ...admitted, noteContextOwnerId: payload.noteContextOwnerId } : null;
    };
    if (prior.outcome === 'rejected') {
      const tombstone = getItem(entry.tombstones, reference.id);
      if (
        getItem(entry.submissions, reference.id) ||
        (tombstone && tombstone.reason !== 'rejected')
      )
        return null;
      return admitRetry();
    }
    if (prior.outcome === 'accepted') return admitRetry();

    // Queue absence is not delivery proof. Read both sources, with their normal
    // ownership/generation fences, before offering an explicitly warned resend.
    await Promise.all([
      hydrateAgentQueue(agentId, workspaceId).catch(() => undefined),
      loadChatTranscript(agentId, workspaceId).catch(() => undefined),
    ]);
    const reconciled = current();
    if (!reconciled || getItem(reconciled.submissions, reference.id)?.status !== 'uncertain')
      return null;
    const notify = await getNotify();
    if (current() !== reconciled) return null;
    let used = false;
    const cancel = () => {
      used = true;
    };
    notify.warning(m.agent_chatSend_uncertainRetry_description(), {
      key: `submission-retry:${workspaceId}:${agentId}:${reference.id}`,
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: m.agent_chatSend_resend_label(),
        onClick: () => {
          if (used) return;
          used = true;
          const latest = current();
          // An open choice cannot outlive new evidence, a newer draft's send,
          // or an access/ownership lifetime. A later retry can reconcile again.
          if (
            !latest ||
            latest.generation !== reconciled.generation ||
            latest.submissions !== reconciled.submissions ||
            latest.observationVersion !== reconciled.observationVersion ||
            getItem(latest.submissions, reference.id)?.status !== 'uncertain'
          )
            return;
          submitChatMessage(
            store,
            agentId,
            retryPayload(workspaceId, attempt, model, noteContextOwnerId),
            onAdmitted,
          );
        },
      },
      cancel: { label: m.chat_richInput_cancel_label(), onClick: cancel },
      onDismiss: cancel,
    });
    return null;
  }

  /** UI retries admit synchronously before the per-agent FIFO. The activating
   * composer's owner is captured once and never rebound after reconciliation. */
  async function requestChatMessageRetry(
    agentId: string,
    workspaceId: string,
    model?: string,
    onAdmitted?: (id: string) => void,
    noteContextOwnerId?: string,
  ) {
    const attempt = getAgentChatState(store.state, agentId).lastAttemptedMessage;
    const admission = attempt?.submission
      ? await prepareSubmissionRetry(
          agentId,
          workspaceId,
          attempt,
          model,
          onAdmitted,
          noteContextOwnerId,
        )
      : 'legacy';
    if (!admission) return;
    if (admission === 'legacy') {
      if (
        attempt &&
        noteContextOwnerId !== undefined &&
        hasComposerContextReferences(attempt.options?.contextReferences)
      ) {
        submitChatMessage(
          store,
          agentId,
          retryPayload(workspaceId, attempt, model, noteContextOwnerId),
          onAdmitted,
        );
        return;
      }
      await store.dispatch(
        model === undefined
          ? agentSessionRetryLastMessageRequested(agentId, workspaceId)
          : agentSessionRetryWithModelRequested(agentId, workspaceId, model),
      );
      return;
    }
    if (!admission.isCurrent() || !attempt) return;
    onAdmitted?.(admission.submission.id);
    store.dispatch(
      sendMessage(agentId, {
        wsId: workspaceId,
        text: attempt.text,
        ...(attempt.options?.composerText !== undefined
          ? { composerText: attempt.options.composerText }
          : {}),
        imageBlocks: attempt.options?.imageBlocks,
        fileBlocks: attempt.options?.fileBlocks,
        noteIds: attempt.options?.noteIds,
        ...(attempt.options?.contextItems !== undefined
          ? { contextItems: attempt.options.contextItems }
          : {}),
        ...(admission.noteContextOwnerId !== undefined
          ? { noteContextOwnerId: admission.noteContextOwnerId }
          : {}),
        ...(attempt.options?.contextReferences !== undefined
          ? { contextReferences: attempt.options.contextReferences }
          : {}),
        messageMetadata: attempt.options?.messageMetadata,
        model: model ?? attempt.options?.model,
        userAppMessageId: admission.submission.appMessageId,
        submission: { scope: admission.scope, id: admission.submission.id },
      }),
    );
  }

  return { prepareSubmissionRetry, requestChatMessageRetry };
}
