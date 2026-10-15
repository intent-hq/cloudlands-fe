import type { SubmissionProjectionState } from '../../store/renderer/slices/pending-submissions/pending-submissions-projections';
import type { createAgentSubmissionAdmitter } from '../../store/renderer/slices/pending-submissions/pending-submissions-admission-factory';
import { getPrincipalSnapshot } from '../../store/renderer/slices/principal/principal-projections';
import { getAgentIsResponding } from '../../store/renderer/slices/agent-session/agent-session-projections';
import { sendMessage } from '../../store/renderer/slices/chat-state/chat-state-slice';
import type { SendMessagePayload } from '../../store/renderer/slices/chat-state/chat-state-types';
import { createAppMessageId } from '$shared/utils/app-message-id';

type SubmissionStore = Parameters<ReturnType<typeof createAgentSubmissionAdmitter>>[0] & {
  state: SubmissionProjectionState;
  dispatch: (action: ReturnType<typeof sendMessage>) => unknown;
};

export function createChatSubmission(
  admitAgentSubmission: ReturnType<typeof createAgentSubmissionAdmitter>,
) {
  /** Synchronous admission shared by composer submission and explicit retry. */
  function admitChatMessage(
    store: SubmissionStore,
    agentId: string,
    payload: SendMessagePayload & { wsId: string },
  ) {
    const content = (payload.composerText ?? payload.text).trim();
    if (!content && !payload.imageBlocks?.length && !payload.fileBlocks?.length) return null;
    const appMessageId = payload.userAppMessageId ?? createAppMessageId();
    const admitted = admitAgentSubmission(
      store,
      agentId,
      payload.wsId,
      getPrincipalSnapshot(store.state)?.capabilities.submissionCorrelation,
      {
        content,
        appMessageId,
        destination:
          !payload.forceSubmit && getAgentIsResponding(store.state, agentId)
            ? 'queue'
            : 'conversation',
        contextItems: payload.contextItems,
        imageBlocks: payload.imageBlocks,
        fileBlocks: payload.fileBlocks,
        messageMetadata: payload.messageMetadata,
      },
    );
    return admitted;
  }

  /** Synchronous admission belongs before both preparation and the per-agent FIFO. */
  function submitChatMessage(
    store: SubmissionStore,
    agentId: string,
    payload: SendMessagePayload & { wsId: string },
    onAdmitted?: (id: string) => void,
  ): boolean {
    const admitted = admitChatMessage(store, agentId, payload);
    if (!admitted) return false;
    onAdmitted?.(admitted.submission.id);
    store.dispatch(
      sendMessage(agentId, {
        ...payload,
        userAppMessageId: admitted.submission.appMessageId,
        submission: { scope: admitted.scope, id: admitted.submission.id },
      }),
    );
    return true;
  }

  return { admitChatMessage, submitChatMessage };
}
