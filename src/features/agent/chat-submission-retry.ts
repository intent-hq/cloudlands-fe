import {
  agentSessionRetryLastMessageRequested,
  agentSessionRetryWithModelRequested,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { sendMessage } from '$store/renderer/slices/chat-state/chat-state-slice';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import type { LastAttemptedMessage } from '$store/renderer/slices/chat-state/chat-state-types';
import { selectChatLastAttemptedMessage } from '$store/renderer/slices/chat-state/chat-state-selectors';
import { selectPendingSubmissionEntry } from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
import { m } from '$shared/paraglide/messages.js';
import { admitChatMessage, submitChatMessage } from './chat-submission';
import { hydrateAgentQueue } from './agent-queue-read-service';
import { loadChatTranscript } from './chat-read-service';

/** Prior identity is provenance, never permission to reuse an old admission. */
export async function prepareSubmissionRetry(
  agentId: string,
  workspaceId: string,
  attempt: LastAttemptedMessage,
  model?: string,
) {
  const prior = attempt.submission;
  if (!prior) return 'legacy' as const;
  const reference = prior.reference;
  const current = () =>
    reference.scope.agentId === agentId &&
    reference.scope.workspaceId === workspaceId &&
    selectChatLastAttemptedMessage.select(store.state, agentId) === attempt
      ? selectPendingSubmissionEntry.select(store.state, reference.scope)
      : undefined;
  const entry = current();
  if (!entry) return null;
  if (!entry.supported) return 'legacy' as const;
  const payload = {
    wsId: workspaceId,
    text: attempt.text,
    imageBlocks: attempt.options?.imageBlocks,
    fileBlocks: attempt.options?.fileBlocks,
    noteIds: attempt.options?.noteIds,
    messageMetadata: attempt.options?.messageMetadata,
    model: model ?? attempt.options?.model,
  };
  if (prior.outcome === 'rejected') {
    const tombstone = getItem(entry.tombstones, reference.id);
    if (getItem(entry.submissions, reference.id) || (tombstone && tombstone.reason !== 'rejected'))
      return null;
    return admitChatMessage(store, agentId, payload);
  }
  if (prior.outcome === 'accepted') return admitChatMessage(store, agentId, payload);

  // Queue absence is not delivery proof. Read both sources, with their normal
  // ownership/generation fences, before offering an explicitly warned resend.
  await Promise.all([
    hydrateAgentQueue(agentId, workspaceId).catch(() => undefined),
    loadChatTranscript(agentId, workspaceId).catch(() => undefined),
  ]);
  const reconciled = current();
  if (!reconciled || getItem(reconciled.submissions, reference.id)?.status !== 'uncertain')
    return null;
  const { notify } = await import('$lib/components/patterns/notify');
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
        submitChatMessage(store, agentId, payload);
      },
    },
    cancel: { label: m.chat_richInput_cancel_label(), onClick: cancel },
    onDismiss: cancel,
  });
  return null;
}

/** UI retries admit synchronously before the retry can enter the per-agent FIFO. */
export async function requestChatMessageRetry(
  agentId: string,
  workspaceId: string,
  model?: string,
) {
  const attempt = selectChatLastAttemptedMessage.select(store.state, agentId);
  const admission = attempt?.submission
    ? await prepareSubmissionRetry(agentId, workspaceId, attempt, model)
    : 'legacy';
  if (!admission) return;
  if (admission === 'legacy') {
    await store.dispatch(
      model === undefined
        ? agentSessionRetryLastMessageRequested(agentId, workspaceId)
        : agentSessionRetryWithModelRequested(agentId, workspaceId, model),
    );
    return;
  }
  if (!admission.isCurrent() || !attempt) return;
  store.dispatch(
    sendMessage(agentId, {
      wsId: workspaceId,
      text: attempt.text,
      imageBlocks: attempt.options?.imageBlocks,
      fileBlocks: attempt.options?.fileBlocks,
      noteIds: attempt.options?.noteIds,
      messageMetadata: attempt.options?.messageMetadata,
      model: model ?? attempt.options?.model,
      userAppMessageId: admission.submission.appMessageId,
      submission: { scope: admission.scope, id: admission.submission.id },
    }),
  );
}
