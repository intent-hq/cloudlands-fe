import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import { selectAgentProvider } from '../agent-session/agent-session-selectors';
import { selectAgentModelEffortLevels } from '../model/model-selectors';
import { selectPrincipalConnectionContext } from '../principal/principal-selectors';
import { selectIsWorkspaceCollaborator } from '../workspace/workspace-selectors';
import { supportsReasoningEffortProtocol } from '$features/agent/utils/reasoning-effort-protocol';
import { buildLegacyReasoningEffortModelId } from '$features/agent/utils/legacy-reasoning-effort';

export const selectAgentModelMutations = store.createSelector((state, consumerId: string) =>
  getItems(state.agentModel.mutations).filter((entry) => entry.consumerId === consumerId),
);
export const selectAgentModelMutationPending = store.createSelector((state, consumerId: string) =>
  selectAgentModelMutations.select(state, consumerId).some((entry) => entry.status === 'pending'),
);
export const selectAgentModelWriteSnapshot = store.createSelector(
  (state, agentId: string, workspaceId: string) => {
    const session = state.agentSessions.byAgentId[agentId];
    const providerId = selectAgentProvider.select(state, agentId);
    const levels = selectAgentModelEffortLevels.select(state, agentId);
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
      connection: selectPrincipalConnectionContext.select(state),
      canWrite:
        !!session &&
        session.workspaceId === workspaceId &&
        !selectIsWorkspaceCollaborator.select(state, workspaceId),
    };
  },
);
