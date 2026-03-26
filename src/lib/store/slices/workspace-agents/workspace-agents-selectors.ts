import type { AgentSession } from "$shared/types";
import type { StoreState } from "../../types";
import { getItems, type Collection } from "../../utils/collection-utils";
import { createSelector } from "../../utils/create-selector";
import { emptyWorkspaceAgentState, type InitialAgentConfig } from "./workspace-agents-slice";

function isBackgroundAgent(agent: AgentSession): boolean {
  return !!(agent.isBackground || agent.metadata?.isBackground);
}

function getWorkspaceAgentState(state: StoreState, wsId: string) {
  return state.workspaceAgents.byWorkspaceId[wsId] ?? emptyWorkspaceAgentState;
}

export const selectWorkspaceAgentState = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId);
});

export const selectWorkspaceAgentsCollection = createSelector(
  (state, wsId: string): Collection<AgentSession, "id"> => {
    return getWorkspaceAgentState(state, wsId).agents;
  }
);

export const selectAllWorkspaceAgentsCollection = selectWorkspaceAgentsCollection;

export const selectAllWorkspaceAgents = createSelector((state, wsId: string) => {
  return getItems(selectWorkspaceAgentsCollection.select(state, wsId));
});

export const selectForegroundWorkspaceAgents = createSelector((state, wsId: string) => {
  return selectAllWorkspaceAgents.select(state, wsId).filter((agent) => !isBackgroundAgent(agent));
});

/**
 * Compatibility selector for existing callers. Prefer `selectAllWorkspaceAgents` for raw state
 * access and `selectForegroundWorkspaceAgents` for UI-visible lists.
 */
export const selectWorkspaceAgents = selectAllWorkspaceAgents;

export const selectAgentsLoaded = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).agentsLoaded;
});

export const selectIsLoadingAgents = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).isLoadingAgents;
});

export const selectInitialAgentId = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).initialAgentId;
});

export const selectInitialAgentConfigProcessed = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).initialAgentConfigProcessed;
});

export const selectRecentlyCreatedAgents = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).recentlyCreatedAgents;
});

export const selectIsAgentRecentlyCreated = createSelector((state, wsId: string, agentId: string) => {
  return getWorkspaceAgentState(state, wsId).recentlyCreatedAgents.includes(agentId);
});

export const selectIsWaitingForFirstMessage = createSelector(
  (state, wsId: string, agentId: string) => {
    return getWorkspaceAgentState(state, wsId).isWaitingForFirstMessage[agentId] ?? false;
  }
);

export const selectWaitingForFirstMessageMap = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).isWaitingForFirstMessage;
});

export const selectInitialAgentConfig = createSelector(
  (state, wsId: string): InitialAgentConfig | null => {
    return getWorkspaceAgentState(state, wsId).initialAgentConfig ?? null;
  }
);

/**
 * Returns true when a workspace has a pending initial agent config,
 * meaning it was just created and hasn't sent its first message yet.
 * Replaces the old `isNewlyCreatedWorkspace` Svelte state flag.
 */
export const selectIsNewlyCreatedWorkspace = createSelector((state, wsId: string) => {
  return getWorkspaceAgentState(state, wsId).initialAgentConfig !== null;
});