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
  return (workspaceId: string, agentId: string): (() => boolean) => {
    const participation = getWorkspaceParticipationContext(appStore.state, workspaceId);
    const principal = getPrincipalSnapshot(appStore.state)?.principal.id;
    const context = getPrincipalConnectionContext(appStore.state);
    const ownership = capture(agentId, workspaceId);
    return () =>
      !!participation &&
      !!principal &&
      !!context &&
      getWorkspaceParticipationContext(appStore.state, workspaceId) === participation &&
      getPrincipalSnapshot(appStore.state)?.principal.id === principal &&
      getPrincipalConnectionContext(appStore.state) === context &&
      appStore.state.agentSessions.byAgentId[agentId]?.workspaceId === workspaceId &&
      ownership.isCurrent(workspaceId);
  };
}
