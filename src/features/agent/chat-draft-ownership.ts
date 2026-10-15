import { getPrincipalConnectionContext } from '../../store/renderer/slices/principal/principal-context';
import { getPrincipalSnapshot } from '../../store/renderer/slices/principal/principal-projections';
import {
  getWorkspaceParticipationContext,
  type WorkspaceAuthorityProjectionState,
} from '../../store/renderer/slices/workspace/workspace-authority-projections';
import type { AgentSessionState } from '../../store/renderer/slices/agent-session/agent-session-types';
import type { createAgentReadOwnership } from './agent-read-ownership-factory';

/** Capture at scheduling time, before debounce/FIFO can outlive an admitted principal. */
export function createChatDraftOwnership(
  appStore: { state: WorkspaceAuthorityProjectionState & { agentSessions: AgentSessionState } },
  capture: ReturnType<typeof createAgentReadOwnership>['captureAgentMutationOwnership'],
) {
  return (workspaceId: string, agentId: string) => {
    const participation = getWorkspaceParticipationContext(appStore.state, workspaceId);
    const snapshot = getPrincipalSnapshot(appStore.state);
    const principal = snapshot?.principal.id;
    const backendId = appStore.state.connections.windowBackendId;
    const context = getPrincipalConnectionContext(appStore.state);
    const ownership = capture(agentId, workspaceId);
    const sameAuthority = () =>
      !!participation &&
      !!principal &&
      !!context &&
      getWorkspaceParticipationContext(appStore.state, workspaceId) !== null &&
      appStore.state.connections.windowBackendId === backendId &&
      getPrincipalSnapshot(appStore.state)?.principal.id === principal &&
      getPrincipalSnapshot(appStore.state)?.principal.hostMembershipRevision ===
        snapshot?.principal.hostMembershipRevision &&
      appStore.state.agentSessions.byAgentId[agentId]?.workspaceId === workspaceId;
    // Same-identity explicit retries may obtain a new mutation lease after reconnect.
    // Queued drafts and in-flight uploads retain their original admission epoch.
    return Object.assign(
      () =>
        sameAuthority() &&
        getWorkspaceParticipationContext(appStore.state, workspaceId) === participation &&
        getPrincipalConnectionContext(appStore.state) === context &&
        ownership.isCurrent(workspaceId),
      {
        sameAuthority,
      },
    );
  };
}
