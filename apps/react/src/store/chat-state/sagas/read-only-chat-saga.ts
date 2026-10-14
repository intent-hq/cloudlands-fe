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
  readAgentSession,
  contextSelector: selectPrincipalConnectionContext,
  readAdmission: (workspaceId) =>
    selectAdmittedWorkspaceReadContext.select(store.state, workspaceId),
});
