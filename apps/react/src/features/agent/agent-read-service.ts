import { store } from '@/store';
import { onBackendReconnected } from '@/features/backend/backend-transport';
import { createAgentReadService } from '../../../../../src/features/agent/agent-read-service-factory';
import { createAgentReadOwnership } from '../../../../../src/features/agent/agent-read-ownership-factory';
import { agentClient } from './agent-client';
export const agentReadOwnership = createAgentReadOwnership({
  onBackendReconnected,
  getSessionWorkspace: (agentId) => store.state.agentSessions.byAgentId[agentId]?.workspaceId,
});
export const agentReadService = createAgentReadService({
  appStore: store,
  getAgent: agentClient.get,
  onBackendReconnected,
  ownership: agentReadOwnership,
});
export const {
  readAgentSession,
  ensureAgentSession,
  refreshAgentSessionAfterEvent,
  notePendingQuestionMarkerProjection,
} = agentReadService;
