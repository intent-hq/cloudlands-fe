import { createConversationReader } from '$lib/client/live/backend-conversation-reader';
import { createMessageHistorySeeker } from '../../../../../../src/store/renderer/slices/chat-state/message-history-seeker';
import { isAgentDeletionPending } from '../../../../../../src/features/agent/utils/pending-agent-deletions';
import { createHistoryPageWorkers } from '../../../../../../src/store/renderer/slices/chat-state/sagas/history-page-workers';
import { selectChatAgentState } from '../chat-state-selectors';
import {
  selectAgentHistoryMessages,
  selectAgentMessages,
  selectAgentSession,
  selectHasHistorySegment,
  selectHistorySegmentMeta,
} from '../../agent-session/agent-session-selectors';
import { store } from '@/store';
import { backend } from '@/features/backend/backend-transport';
import { readAgentSession } from '@/features/agent/agent-read-service';
import { selectPrincipalConnectionContext } from '@/store/principal/principal-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { BackendChatClient } from '$lib/client/live/backend-chat-client';
import { createLogger } from '$lib/utils/client-logger';
import { createReadOnlyChatSaga } from '../../../../../../src/store/renderer/slices/chat-state/sagas/read-only-chat-saga-factory';

const logger = createLogger('ReadOnlyChat');
const chat = new BackendChatClient(backend, (diagnostic) =>
  logger.debug('stream-lifecycle', diagnostic),
);

export const readOnlyChatSaga = createReadOnlyChatSaga({
  chat,
  seekMessage: createMessageHistorySeeker({
    getConversation: createConversationReader(backend),
    readChat: (id) => selectChatAgentState.select(store.state, id),
    readSession: (id) => selectAgentSession.select(store.state, id),
    hasMessage: (id, messageId) =>
      [
        ...selectAgentMessages.select(store.state, id),
        ...selectAgentHistoryMessages.select(store.state, id),
      ].some((message) => message.id === messageId),
    dispatch: (action) => store.dispatch(action),
  }),
  historyPages: createHistoryPageWorkers({
    getConversation: createConversationReader(backend),
    readChat: selectChatAgentState.effect,
    readMeta: selectHistorySegmentMeta.effect,
    readHistory: selectAgentHistoryMessages.effect,
    readTail: selectAgentMessages.effect,
    readSession: selectAgentSession.effect,
    hasHistory: selectHasHistorySegment.effect,
    isDeleted: isAgentDeletionPending,
  }),
  readAgentSession,
  contextSelector: selectPrincipalConnectionContext,
  readAdmission: (workspaceId) =>
    selectAdmittedWorkspaceReadContext.select(store.state, workspaceId),
});
