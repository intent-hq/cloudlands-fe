import type { AgentSession } from '$shared/types/agent-session';
import type { AgentId } from '$shared/types';
import { getAgentSession } from '../agent-session/agent-session-projections';
import { emptyWorkspaceAgentState } from './workspace-agents-slice';
import type { WorkspaceAgentsProjectionState } from './workspace-agents-types';

export function getWorkspaceAgentState(state: WorkspaceAgentsProjectionState, wsId: string) {
  return state.workspaceAgents.byWorkspaceId[wsId] ?? emptyWorkspaceAgentState;
}

export const getActiveAgentId = (
  state: WorkspaceAgentsProjectionState,
  wsId: string,
): string | null => {
  return getWorkspaceAgentState(state, wsId).activeAgentId;
};

export const getWorkspaceAgentIds = (
  state: WorkspaceAgentsProjectionState,
  wsId: string,
): string[] => {
  return getWorkspaceAgentState(state, wsId).agentIds;
};

export const getAllWorkspaceAgents = (
  state: WorkspaceAgentsProjectionState,
  wsId?: string,
): AgentSession[] => {
  if (!wsId) return [];

  const agentIds = getWorkspaceAgentState(state, wsId).agentIds;
  const result: AgentSession[] = [];
  for (const id of agentIds) {
    const session = getAgentSession(state, id);
    if (session) result.push(session);
  }
  return result;
};

export const getWorkspaceForegroundAgentIds = (
  state: WorkspaceAgentsProjectionState,
  wsId?: string,
): AgentId[] => {
  if (!wsId) return [];
  return getWorkspaceAgentState(state, wsId).foregroundAgentIds;
};

export const getForegroundWorkspaceAgents = (
  state: WorkspaceAgentsProjectionState,
  wsId: string,
) => {
  const foregroundAgentIds = getWorkspaceForegroundAgentIds(state, wsId);
  const result: AgentSession[] = [];
  for (const id of foregroundAgentIds) {
    const session = getAgentSession(state, String(id));
    if (session) result.push(session);
  }
  return result;
};

export const getAgentsLoaded = (state: WorkspaceAgentsProjectionState, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).agentsLoaded;
};

export const getRetiredAgentsLoaded = (state: WorkspaceAgentsProjectionState, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).retiredAgentsLoaded;
};

export const getIsLoadingRetiredAgents = (state: WorkspaceAgentsProjectionState, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).isLoadingRetiredAgents;
};

export const getDelegatedAgentsLoaded = (state: WorkspaceAgentsProjectionState, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).delegatedAgentsLoaded;
};

export const getIsLoadingDelegatedAgents = (
  state: WorkspaceAgentsProjectionState,
  wsId: string,
) => {
  return getWorkspaceAgentState(state, wsId).isLoadingDelegatedAgents;
};

export const getBackgroundAgentsLoaded = (state: WorkspaceAgentsProjectionState, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).backgroundAgentsLoaded;
};

export const getIsLoadingBackgroundAgents = (
  state: WorkspaceAgentsProjectionState,
  wsId: string,
) => {
  return getWorkspaceAgentState(state, wsId).isLoadingBackgroundAgents;
};

export const getOrphanedDelegatedAgentsLoaded = (
  state: WorkspaceAgentsProjectionState,
  wsId: string,
) => {
  return getWorkspaceAgentState(state, wsId).orphanedDelegatedAgentsLoaded;
};

export const getIsLoadingOrphanedDelegatedAgents = (
  state: WorkspaceAgentsProjectionState,
  wsId: string,
) => {
  return getWorkspaceAgentState(state, wsId).isLoadingOrphanedDelegatedAgents;
};

export const getDelegatedParentLoaded = (
  state: WorkspaceAgentsProjectionState,
  wsId: string,
  parentAgentId: string,
) => {
  const workspaceState = getWorkspaceAgentState(state, wsId);
  return (
    workspaceState.delegatedAgentsLoaded ||
    workspaceState.loadedDelegatedParentIds[parentAgentId] === true
  );
};

export const getIsLoadingDelegatedParent = (
  state: WorkspaceAgentsProjectionState,
  wsId: string,
  parentAgentId: string,
) => {
  return getWorkspaceAgentState(state, wsId).loadingDelegatedParentIds[parentAgentId] === true;
};

export const getLoadedDelegatedParentIds = (
  state: WorkspaceAgentsProjectionState,
  wsId: string,
) => {
  return getWorkspaceAgentState(state, wsId).loadedDelegatedParentIds;
};

export const getScopeCounts = (state: WorkspaceAgentsProjectionState, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).scopeCounts;
};

export const getDelegatedCounts = (state: WorkspaceAgentsProjectionState, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).delegatedCounts;
};

export const getScopeCountsGeneration = (state: WorkspaceAgentsProjectionState, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).scopeCountsGeneration;
};
