import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { agentReadOwnership } from './agent-read-ownership';
import { createAgentReadService } from './agent-read-service-factory';
/** Source binding shared by metadata/event/chat consumers; no transcript read is introduced. */
const agentReadService = createAgentReadService({
  appStore,
  getAgent: (...args) => appClient.agents.get(...args),
  onBackendReconnected,
  ownership: agentReadOwnership,
});
export const {
  readAgentSession,
  ensureAgentSession,
  refreshAgentSessionAfterEvent,
  notePendingQuestionMarkerProjection,
} = agentReadService;
