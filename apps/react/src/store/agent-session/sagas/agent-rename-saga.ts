import { store } from '@/store';
import { backend } from '@/features/backend/backend-transport';
import { createBackendChatCommands } from '$lib/client/live/backend-chat-commands';
import { createAgentRenameSaga } from '../../../../../../src/store/renderer/slices/agent-session/sagas/agent-rename-saga-factory';
import { selectAgentSession } from '../agent-session-selectors';
import {
  selectAgentRenameAuthority,
  selectAgentRenameContext,
  selectAgentRenameRevision,
  selectAgentRenameOperations,
  selectAgentRenameViewCurrent,
} from '../agent-rename-selectors';
const commands = createBackendChatCommands(backend.backendRequest);
export const agentRenameSaga = createAgentRenameSaga({
  rename: (...args) => commands.rename(...args),
  selectSession: (id) => selectAgentSession.effect(id),
  selectRevision: (id) => selectAgentRenameRevision.effect(id),
  admission: {
    selectOperations: (id) => selectAgentRenameOperations.effect(id),
    readRevision: (id) => selectAgentRenameRevision.select(store.state, id),
    isCurrent: (request) =>
      selectAgentRenameViewCurrent.select(store.state, request) &&
      selectAgentRenameAuthority.select(store.state, request.workspaceId, request.agentId) ===
        request.authority &&
      selectAgentRenameContext.select(store.state, request.workspaceId, request.agentId) ===
        request.context,
    canPublish: (request) =>
      selectAgentRenameAuthority.select(store.state, request.workspaceId, request.agentId) ===
      request.authority,
    dispatch: (action) => store.dispatch(action),
  },
});
