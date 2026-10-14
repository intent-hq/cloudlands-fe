import { call, put, takeEvery, fork, join } from 'typed-redux-saga';
import { takeEveryByContextFIFO } from '../../../../../../src/store/renderer/utils/context-saga-effects';
import { createChatSendWorkers } from '../../../../../../src/store/renderer/slices/chat-state/sagas/chat-send-workers';
import { createAgentActivationWorkers } from '../../../../../../src/store/renderer/slices/agent-session/sagas/agent-activation-workers';
import { runChatDrafts } from '../../../../../../src/store/renderer/slices/chat-drafts/sagas/chat-drafts-worker';
import {
  sendMessage,
  chatSendFailed,
  refreshChatTranscriptRequested,
} from '../../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import {
  activateAgentRequested,
  restoreAgentSessionRequested,
} from '../../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { agentSessionStopChatRequested } from '../../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  selectAgentSession,
  selectAgentSessionWorkspaceId,
  selectAgentIsResponding,
} from '@/store/agent-session/agent-session-selectors';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import { selectTranscriptHydration } from '@/store/chat-state/chat-state-selectors';
import { selectAgentQueueMessages } from '@/store/agent-queue/agent-queue-selectors';
import {
  selectSubmissionIsCurrent,
  selectPendingSubmissionEntry,
  selectSubmissionObserved,
  selectQueueMutationBlocked,
} from '@/store/pending-submissions/pending-submissions-selectors';
import { agentReadOwnership, readAgentSession } from '@/features/agent/agent-read-service';
import {
  chatCommands,
  draftsClient,
  captureDraftOwnership,
  sendAgentMessage,
  chatReads,
  queueReads,
} from '@/features/agent/chat-runtime';
import { m } from '$shared/paraglide/messages.js';
const workers = createChatSendWorkers({
  appClient: { agents: chatCommands },
  captureAgentMutationOwnership: agentReadOwnership.captureAgentMutationOwnership,
  selectAgentSession,
  selectAgentSessionWorkspaceId,
  selectAgentIsResponding,
  selectWorkspaceById,
  selectTranscriptHydration,
  selectAgentQueueMessages,
  selectSubmissionIsCurrent,
  selectPendingSubmissionEntry,
  selectSubmissionObserved,
  selectQueueMutationBlocked,
  loadChatTranscript: chatReads.loadChatTranscript,
  hydrateAgentQueue: queueReads.hydrateAgentQueue,
  getAgentQueueEventSnapshotSeq: queueReads.getAgentQueueEventSnapshotSeq,
  sendAgentMessage,
  // Connected composer currently exposes text only. Inline placement stays with the source upload owner.
  prepareImages: async () => {
    throw new Error(m.agent_streamLifecycle_sendFailed_error());
  },
  retryImages: (_error, images) => images,
});
const activation = createAgentActivationWorkers({
  selectAgentSession,
  captureAgentMutationOwnership: agentReadOwnership.captureAgentMutationOwnership,
  readAgentSession,
});
export function* chatCommandsSaga() {
  try {
    yield* fork(runChatDrafts, draftsClient, captureDraftOwnership);
    yield* takeEvery(restoreAgentSessionRequested, activation.restoreAgent);
    yield* takeEvery(activateAgentRequested, activation.activateAgent);
    yield* takeEvery(agentSessionStopChatRequested, workers.handleStop);
    yield* takeEvery(
      refreshChatTranscriptRequested,
      function* ({ payload: [workspaceId, agentId] }) {
        yield* call(chatReads.loadChatTranscript, agentId, workspaceId);
      },
    );
    const commands = yield* takeEveryByContextFIFO(
      sendMessage,
      (action) => action.payload.agentId,
      function* (action) {
        try {
          yield* call(workers.handleSend, action);
        } catch (error) {
          yield* put(
            chatSendFailed(
              action.payload.agentId,
              error instanceof Error ? error.message : String(error),
            ),
          );
        }
      },
      {},
    );
    yield* join(commands);
  } finally {
    chatReads.dispose();
    queueReads.dispose();
  }
}
