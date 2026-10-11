import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import { createAgentReadOwnership } from './agent-read-ownership-factory';
/** Source read/mutation ownership binding, shared with source deletion and chat readers. */
export const agentReadOwnership = createAgentReadOwnership({
  onBackendReconnected,
  getSessionWorkspace: (agentId) => appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId,
});
export const {
  claimAgentReadOwnership,
  captureAgentMutationOwnership,
  isAgentReadWorkspaceCurrent,
} = agentReadOwnership;
