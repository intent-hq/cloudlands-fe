import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { AgentModelState } from './agent-model-types';
import type { AgentSessionProjectionState } from '../agent-session/agent-session-projections';
import type { WorkspaceAuthorityProjectionState } from '../workspace/workspace-authority-projections';
export type AgentModelProjectionState = AgentSessionProjectionState &
  WorkspaceAuthorityProjectionState & { agentModel: AgentModelState };
import { getAgentSessionProvider } from '../agent-session/agent-session-projections';
import { getAgentModelEffortLevels } from '../model/model-projections';
import { getPrincipalConnectionContext } from '../principal/principal-context';
import { getIsWorkspaceCollaborator } from '../workspace/workspace-authority-projections';
import { supportsReasoningEffortProtocol } from '../../../../features/agent/utils/reasoning-effort-protocol';
import { buildLegacyReasoningEffortModelId } from '../../../../features/agent/utils/legacy-reasoning-effort';

export const getAgentModelMutations = (state: AgentModelProjectionState, consumerId: string) =>
  getItems(state.agentModel.mutations).filter((entry) => entry.consumerId === consumerId);
export const getAgentModelMutationPending = (
  state: AgentModelProjectionState,
  consumerId: string,
) => getAgentModelMutations(state, consumerId).some((entry) => entry.status === 'pending');
export const getAgentModelWriteSnapshot = (
  state: AgentModelProjectionState,
  agentId: string,
  workspaceId: string,
) => {
  const session = state.agentSessions.byAgentId[agentId];
  const providerId = getAgentSessionProvider(state, agentId);
  const levels = getAgentModelEffortLevels(state, agentId);
  const protocol = state.daemonHealth.stats?.protocolVersion;
  const legacy = !!protocol && !supportsReasoningEffortProtocol(protocol);
  const model = legacy
    ? buildLegacyReasoningEffortModelId(session?.model, null, levels)
    : session?.model;
  return {
    session,
    providerId,
    levels,
    legacy,
    identity: JSON.stringify([model, providerId]),
    connection: getPrincipalConnectionContext(state),
    canWrite:
      !!session &&
      session.workspaceId === workspaceId &&
      !getIsWorkspaceCollaborator(state, workspaceId),
  };
};

/** Only the current agent mutation lease can hold its next submission. */
export const getAgentModelSubmissionPending = (
  state: AgentModelProjectionState,
  agentId: string,
  workspaceId: string,
): boolean => {
  const connection = getPrincipalConnectionContext(state);
  return (
    connection !== null &&
    getItems(state.agentModel.mutations).some(
      (entry) =>
        entry.agentId === agentId &&
        entry.workspaceId === workspaceId &&
        entry.connection === connection &&
        entry.status === 'pending',
    )
  );
};
