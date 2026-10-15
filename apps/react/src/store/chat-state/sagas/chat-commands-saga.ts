import type { StoreAction } from '@themislib/themis/types';
import { store } from '@/store';
import { captureQueueRemovalAuthority } from '@/features/agent/queue-runtime';
import { createQueueRemovalWorkers } from '../../../../../../src/store/renderer/slices/agent-queue/sagas/queue-removal-workers';
import {
  queuedMessageMutationRequested,
  queuedMessageMutationFinished,
  refreshAgentQueueRequested,
} from '../../../../../../src/store/renderer/slices/agent-queue/agent-queue-slice';
import {
  selectQueuedMessageMutation,
  selectQueueRemovalUncertain,
} from '@/store/agent-queue/agent-queue-selectors';
import { selectChatDraftOwnerView } from '@/store/chat-drafts/chat-drafts-selectors';
import { m } from '$shared/paraglide/messages.js';
import { call, put, takeEvery, fork, join } from 'typed-redux-saga';
import { takeEveryByContextFIFO } from '../../../../../../src/store/renderer/utils/context-saga-effects';
import { createChatSendWorkers } from '../../../../../../src/store/renderer/slices/chat-state/sagas/chat-send-workers';
import { createAgentActivationWorkers } from '../../../../../../src/store/renderer/slices/agent-session/sagas/agent-activation-workers';
import { runChatDrafts } from '../../../../../../src/store/renderer/slices/chat-drafts/sagas/chat-drafts-worker';
import { createComposerAttachmentsSaga } from '../../../../../../src/store/renderer/slices/chat-drafts/sagas/composer-attachments-saga-factory';
import {
  selectComposerContextItems,
  selectChatDraft,
} from '@/store/chat-drafts/chat-drafts-selectors';
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
  placeComposerAttachment,
  prepareComposerImages,
  imageRetryBlocks,
  validateQueueAdmission,
} from '@/features/agent/chat-runtime';
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
  prepareImages: prepareComposerImages,
  retryImages: imageRetryBlocks,
  noteContextBusyError: () => m.chat_fileContext_busy_description(),
  validateQueueAdmission,
});
const activation = createAgentActivationWorkers({
  selectAgentSession,
  captureAgentMutationOwnership: agentReadOwnership.captureAgentMutationOwnership,
  readAgentSession,
});
const removal = createQueueRemovalWorkers({
  agents: chatCommands,
  dispatch: (action: StoreAction<unknown>) => store.dispatch(action),
  captureAuthority: captureQueueRemovalAuthority,
  selectQueuedMessageMutation,
  selectQueueRemovalUncertain,
  selectAgentQueueMessages,
  selectQueueMutationBlocked,
  hydrateAgentQueue: queueReads.hydrateAgentQueue,
  noteAgentQueueEventSnapshotApplied: queueReads.noteAgentQueueEventSnapshotApplied,
  getAgentQueueEventSnapshotSeq: queueReads.getAgentQueueEventSnapshotSeq,
});
type Command = ReturnType<typeof sendMessage> | ReturnType<typeof queuedMessageMutationRequested>;
export function* chatCommandsSaga() {
  try {
    yield* fork(runChatDrafts, draftsClient, captureDraftOwnership);
    yield* fork(
      createComposerAttachmentsSaga({
        selectItems: selectComposerContextItems,
        selectText: selectChatDraft,
        captureOwnership: captureDraftOwnership,
        place: placeComposerAttachment,
      }),
    );
    yield* takeEvery(restoreAgentSessionRequested, activation.restoreAgent);
    yield* takeEvery(activateAgentRequested, activation.activateAgent);
    yield* takeEvery(agentSessionStopChatRequested, workers.handleStop);
    yield* takeEvery(
      refreshChatTranscriptRequested,
      function* ({ payload: [workspaceId, agentId] }) {
        yield* call(chatReads.loadChatTranscript, agentId, workspaceId);
      },
    );
    yield* takeEvery(
      refreshAgentQueueRequested,
      function* ({ payload: [agentId, workspaceId, consumerId] }) {
        const view = yield* selectChatDraftOwnerView.effect(consumerId);
        if (view?.restore?.agentId === agentId && view.restore.workspaceId === workspaceId)
          yield* call(queueReads.hydrateAgentQueue, agentId, workspaceId);
      },
    );
    const commands = yield* takeEveryByContextFIFO(
      [sendMessage, queuedMessageMutationRequested],
      (action: Command) => {
        if (action.type === queuedMessageMutationRequested.type) {
          const request = action as ReturnType<typeof queuedMessageMutationRequested>;
          removal.capture(request);
          return request.payload[0].agentId;
        }
        return (action as ReturnType<typeof sendMessage>).payload.agentId;
      },
      function* (command: Command) {
        if (command.type === queuedMessageMutationRequested.type) {
          yield* call(
            removal.handleRemove,
            command as ReturnType<typeof queuedMessageMutationRequested>,
          );
          return;
        }
        const action = command as ReturnType<typeof sendMessage>;
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
      {
        onDiscardPending: function* (action: Command) {
          if (action.type === queuedMessageMutationRequested.type)
            yield* put(
              queuedMessageMutationFinished(
                (action as ReturnType<typeof queuedMessageMutationRequested>).payload[0].requestId,
                { status: 'cancelled' },
              ),
            );
        },
      },
    );
    yield* join(commands);
  } finally {
    chatReads.dispose();
    queueReads.dispose();
  }
}
