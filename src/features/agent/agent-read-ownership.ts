import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import { createAgentReadOwnership } from './agent-read-ownership-factory';
/** Source read/mutation ownership binding, shared with source deletion and chat readers. */
// Resolve source transport exports when called; remove this binding at renderer cutover.
export const agentReadOwnership = createAgentReadOwnership({
  onBackendReconnected: (
    ...args: Parameters<typeof onBackendReconnected>
  ): ReturnType<typeof onBackendReconnected> => onBackendReconnected(...args),
  getSessionWorkspace: (agentId) => appStore.state.agentSessions?.byAgentId[agentId]?.workspaceId,
});
export const {
  claimAgentReadOwnership,
  captureAgentMutationOwnership,
  isAgentReadWorkspaceCurrent,
} = agentReadOwnership;
