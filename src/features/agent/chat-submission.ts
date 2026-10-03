import type { StoreState } from '$store/renderer/types';
import { admitAgentSubmission } from '$store/renderer/slices/pending-submissions/pending-submissions-admission';
import { selectPrincipalSnapshot } from '$store/renderer/slices/principal/principal-selectors';
import { selectAgentIsResponding } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { sendMessage } from '$store/renderer/slices/chat-state/chat-state-slice';
import type { SendMessagePayload } from '$store/renderer/slices/chat-state/chat-state-types';
import { createAppMessageId } from '$shared/utils/app-message-id';

type SubmissionStore = Parameters<typeof admitAgentSubmission>[0] & {
  state: StoreState;
  dispatch: (action: ReturnType<typeof sendMessage>) => unknown;
};

/** Synchronous admission belongs before both preparation and the per-agent FIFO. */
export function submitChatMessage(
  store: SubmissionStore,
  agentId: string,
  payload: SendMessagePayload & { wsId: string },
): boolean {
  if (!payload.text.trim() && !payload.imageBlocks?.length && !payload.fileBlocks?.length)
    return false;
  const appMessageId = payload.userAppMessageId ?? createAppMessageId();
  const admitted = admitAgentSubmission(
    store,
    agentId,
    payload.wsId,
    selectPrincipalSnapshot.select(store.state)?.capabilities.submissionCorrelation,
    {
      content: payload.text.trim(),
      appMessageId,
      destination:
        !payload.forceSubmit && selectAgentIsResponding.select(store.state, agentId)
          ? 'queue'
          : 'conversation',
      contextItems: payload.contextItems,
      imageBlocks: payload.imageBlocks,
      fileBlocks: payload.fileBlocks,
      messageMetadata: payload.messageMetadata,
    },
  );
  if (!admitted) return false;
  store.dispatch(
    sendMessage(agentId, {
      ...payload,
      userAppMessageId: appMessageId,
      submission: { scope: admitted.scope, id: admitted.submission.id },
    }),
  );
  return true;
}
