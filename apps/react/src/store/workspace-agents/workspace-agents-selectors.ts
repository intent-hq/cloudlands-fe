import { sidebarSearchMatches } from '$lib/components/workspace/sidebar/sidebar-search';
import { store } from '../index';
import * as projections from '../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-projections';

export const selectActiveAgentId = store.createSelector(projections.getActiveAgentId);
export const selectWorkspaceAgentIds = store.createSelector(projections.getWorkspaceAgentIds);
export const selectAllWorkspaceAgents = store.createSelector(projections.getAllWorkspaceAgents);
export const selectForegroundWorkspaceAgents = store.createSelector(
  projections.getForegroundWorkspaceAgents,
);
export const selectAgentsLoaded = store.createSelector(projections.getAgentsLoaded);
export const selectRetiredAgentsLoaded = store.createSelector(projections.getRetiredAgentsLoaded);
export const selectIsLoadingRetiredAgents = store.createSelector(
  projections.getIsLoadingRetiredAgents,
);
export const selectDelegatedAgentsLoaded = store.createSelector(
  projections.getDelegatedAgentsLoaded,
);
export const selectIsLoadingDelegatedAgents = store.createSelector(
  projections.getIsLoadingDelegatedAgents,
);
export const selectBackgroundAgentsLoaded = store.createSelector(
  projections.getBackgroundAgentsLoaded,
);
export const selectIsLoadingBackgroundAgents = store.createSelector(
  projections.getIsLoadingBackgroundAgents,
);
export const selectOrphanedDelegatedAgentsLoaded = store.createSelector(
  projections.getOrphanedDelegatedAgentsLoaded,
);
export const selectIsLoadingOrphanedDelegatedAgents = store.createSelector(
  projections.getIsLoadingOrphanedDelegatedAgents,
);
export const selectDelegatedParentLoaded = store.createSelector(
  projections.getDelegatedParentLoaded,
);
export const selectIsLoadingDelegatedParent = store.createSelector(
  projections.getIsLoadingDelegatedParent,
);
export const selectLoadedDelegatedParentIds = store.createSelector(
  projections.getLoadedDelegatedParentIds,
);
export const selectScopeCounts = store.createSelector(projections.getScopeCounts);
export const selectDelegatedCounts = store.createSelector(projections.getDelegatedCounts);
export const selectScopeCountsGeneration = store.createSelector(
  projections.getScopeCountsGeneration,
);

export const selectAgentCreationOutcome = store.createSelector(projections.getAgentCreationOutcome);

export const selectAgentCreationResource = store.createSelector(
  projections.getAgentCreationResource,
);

export const selectFilteredForegroundWorkspaceAgents = store.createSelector(
  (state, workspaceId: string, query: string) => {
    const agents = selectForegroundWorkspaceAgents.select(state, workspaceId);
    return query.trim()
      ? agents.filter((agent) => sidebarSearchMatches(query, [agent.name]))
      : agents;
  },
);

export const selectWorkspaceAgentMetadataStatus = store.createSelector(
  projections.getWorkspaceAgentMetadataStatus,
);
