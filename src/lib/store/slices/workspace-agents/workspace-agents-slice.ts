import type { AgentId, AgentSession } from "$shared/types";
import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import {
  addItem,
  createCollection,
  getItem,
  removeItem,
  type Collection,
  updateItem,
} from "../../utils/collection-utils";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { omitKey } from "../../utils/utils";

type AgentMessage = AgentSession["messages"][number];
type AgentFileChange = NonNullable<AgentSession["fileChanges"]>[number];

export interface InitialAgentConfig {
  agentId: string;
  config: {
    prompt?: string;
    model?: string;
    specialist?: string | null;
    behaviorPrompt?: string;
    isInitialAgent?: boolean;
    isFirstWorkspaceAgent?: boolean;
    metadata?: Record<string, unknown>;
  };
  timestamp: number;
}

export interface WorkspaceAgentState {
  /** Raw stored agent sessions for this workspace, including background and delegated agents. */
  agents: Collection<AgentSession, "id">;
  agentsLoaded: boolean;
  isLoadingAgents: boolean;
  initialAgentId: string | null;
  initialAgentConfigProcessed: boolean;
  recentlyCreatedAgents: string[];
  isWaitingForFirstMessage: Record<string, boolean>;
  initialAgentConfig: InitialAgentConfig | null;
}

export interface WorkspaceAgentsState {
  byWorkspaceId: Record<string, WorkspaceAgentState>;
}

type WorkspaceAgentSnapshots = Record<string, AgentSession[]>;

function normalizeDateValue(value: Date | string | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeAgentMessage(message: AgentMessage): AgentMessage {
  return {
    ...message,
    timestamp: normalizeDateValue(message.timestamp) ?? message.timestamp,
    toolCalls: message.toolCalls?.map((toolCall) => ({
      ...toolCall,
      timestamp: normalizeDateValue(toolCall.timestamp),
      startedAt: normalizeDateValue(toolCall.startedAt),
      completedAt: normalizeDateValue(toolCall.completedAt),
    })),
    toolResults: message.toolResults?.map((toolResult) => ({
      ...toolResult,
      timestamp: normalizeDateValue(toolResult.timestamp),
    })),
  };
}

function normalizeAgentFileChange(fileChange: AgentFileChange): AgentFileChange {
  return {
    ...fileChange,
    timestamp: normalizeDateValue(fileChange.timestamp),
  };
}

function normalizeAgentSession(agent: AgentSession): AgentSession {
  return {
    ...agent,
    createdAt: normalizeDateValue(agent.createdAt) ?? agent.createdAt,
    updatedAt: normalizeDateValue(agent.updatedAt) ?? agent.updatedAt,
    lastActivity: normalizeDateValue(agent.lastActivity),
    startedAt: normalizeDateValue(agent.startedAt),
    endedAt: normalizeDateValue(agent.endedAt),
    lastViewedAt: normalizeDateValue(agent.lastViewedAt),
    messages: agent.messages.map(normalizeAgentMessage),
    fileChanges: agent.fileChanges?.map(normalizeAgentFileChange),
  };
}

function reconcileWorkspaceAgentSnapshot(
  workspaceState: WorkspaceAgentState,
  agents: AgentSession[]
): WorkspaceAgentState {
  const normalizedAgents = agents.map(normalizeAgentSession);
  const agentIds = new Set(normalizedAgents.map((agent) => agent.id));
  const recentlyCreatedAgents = workspaceState.recentlyCreatedAgents.filter((agentId) =>
    agentIds.has(agentId as AgentId)
  );
  const isWaitingForFirstMessage = Object.fromEntries(
    Object.entries(workspaceState.isWaitingForFirstMessage).filter(([agentId]) =>
      agentIds.has(agentId as AgentId)
    )
  );

  return {
    ...workspaceState,
    agents: createCollection<AgentSession, "id">("id", normalizedAgents),
    recentlyCreatedAgents,
    isWaitingForFirstMessage,
  };
}

function reconcileWorkspaceAgentSnapshots(
  state: WorkspaceAgentsState,
  snapshotsByWorkspace: WorkspaceAgentSnapshots
): WorkspaceAgentsState {
  const workspaceIds = new Set([
    ...Object.keys(state.byWorkspaceId),
    ...Object.keys(snapshotsByWorkspace),
  ]);

  if (workspaceIds.size === 0) {
    return state;
  }

  const byWorkspaceId = Object.fromEntries(
    Array.from(workspaceIds).map((wsId) => {
      const workspaceState = getWorkspaceState(state, wsId);
      return [wsId, reconcileWorkspaceAgentSnapshot(workspaceState, snapshotsByWorkspace[wsId] ?? [])];
    })
  );

  return { byWorkspaceId };
}

export const emptyWorkspaceAgentState: WorkspaceAgentState = {
  agents: createCollection<AgentSession, "id">("id"),
  agentsLoaded: false,
  isLoadingAgents: false,
  initialAgentId: null,
  initialAgentConfigProcessed: false,
  recentlyCreatedAgents: [],
  isWaitingForFirstMessage: {},
  initialAgentConfig: null,
};

export const initialState: WorkspaceAgentsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceAgentState);

export const setAgents = createAction<[wsId: string, agents: AgentSession[]]>(
  "workspaceAgents/setAgents"
);
export const replaceWorkspaceAgentSnapshots = createAction<[snapshotsByWorkspace: WorkspaceAgentSnapshots]>(
  "workspaceAgents/replaceWorkspaceAgentSnapshots"
);
export const addAgent = createAction<[wsId: string, agent: AgentSession]>(
  "workspaceAgents/addAgent"
);
export const removeAgent = createAction<[wsId: string, agentId: string]>(
  "workspaceAgents/removeAgent"
);
export const renameAgent = createAction<[wsId: string, agentId: string, name: string]>(
  "workspaceAgents/renameAgent"
);
export const markAgentRecentlyCreated = createAction<[wsId: string, agentId: string]>(
  "workspaceAgents/markAgentRecentlyCreated"
);
export const clearRecentlyCreatedAgent = createAction<[wsId: string, agentId: string]>(
  "workspaceAgents/clearRecentlyCreatedAgent"
);
export const setInitialAgentId = createAction<[wsId: string, agentId: string | null]>(
  "workspaceAgents/setInitialAgentId"
);
export const setInitialAgentConfigProcessed = createAction<[wsId: string, processed: boolean]>(
  "workspaceAgents/setInitialAgentConfigProcessed"
);
export const setAgentsLoaded = createAction<[wsId: string, loaded: boolean]>(
  "workspaceAgents/setAgentsLoaded"
);
export const setIsLoadingAgents = createAction<[wsId: string, loading: boolean]>(
  "workspaceAgents/setIsLoadingAgents"
);
export const createAgentRequested = createAction<[wsId: string, agentType?: string]>(
  "workspaceAgents/createAgentRequested"
);
export const createAgentWithSpecialistRequested = createAction<
  [wsId: string, specialistId: string | null]
>("workspaceAgents/createAgentWithSpecialistRequested");
export const delegateTaskRequested = createAction<[wsId: string, taskText: string, openAgent?: boolean]>(
  "workspaceAgents/delegateTaskRequested"
);
export const loadAgentsRequested = createAction<[wsId: string]>(
  "workspaceAgents/loadAgentsRequested"
);
export const agentsLoaded = createAction<[wsId: string]>("workspaceAgents/agentsLoaded");
export const setWaitingForFirstMessage = createAction<
  [wsId: string, agentId: string, waiting: boolean]
>("workspaceAgents/setWaitingForFirstMessage");
export const setInitialAgentConfig = createAction<[wsId: string, config: InitialAgentConfig]>(
  "workspaceAgents/setInitialAgentConfig"
);
export const clearInitialAgentConfig = createAction<[wsId: string]>(
  "workspaceAgents/clearInitialAgentConfig"
);
export const clearWorkspaceAgents = createAction<[wsId: string]>(
  "workspaceAgents/clearWorkspaceAgents"
);

export const workspaceAgentsReducer = createReducer<WorkspaceAgentsState>(initialState)
  .with(setAgents, (state, { payload: [wsId, agents] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, reconcileWorkspaceAgentSnapshot(workspaceState, agents));
  })
  .with(replaceWorkspaceAgentSnapshots, (state, { payload: [snapshotsByWorkspace] }) =>
    reconcileWorkspaceAgentSnapshots(state, snapshotsByWorkspace)
  )
  .with(addAgent, (state, { payload: [wsId, agent] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const normalizedAgent = normalizeAgentSession(agent);
    if (getItem(workspaceState.agents, normalizedAgent.id)) {
      return state;
    }
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      agents: addItem(workspaceState.agents, normalizedAgent),
    });
  })
  .with(removeAgent, (state, { payload: [wsId, agentId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const normalizedAgentId = agentId as AgentId;
    const agents = removeItem(workspaceState.agents, normalizedAgentId);
    if (agents === workspaceState.agents) {
      return state;
    }

    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      agents,
      initialAgentId:
        workspaceState.initialAgentId === agentId ? null : workspaceState.initialAgentId,
      recentlyCreatedAgents: workspaceState.recentlyCreatedAgents.filter(
        (recentAgentId) => recentAgentId !== agentId
      ),
      isWaitingForFirstMessage: omitKey(workspaceState.isWaitingForFirstMessage, agentId),
    });
  })
  .with(renameAgent, (state, { payload: [wsId, agentId, name] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const normalizedAgentId = agentId as AgentId;
    const agent = getItem(workspaceState.agents, normalizedAgentId);
    if (!agent || agent.name === name) {
      return state;
    }

    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      agents: updateItem(workspaceState.agents, { id: normalizedAgentId, name }),
    });
  })
  .with(markAgentRecentlyCreated, (state, { payload: [wsId, agentId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.recentlyCreatedAgents.includes(agentId)) {
      return state;
    }
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      recentlyCreatedAgents: [...workspaceState.recentlyCreatedAgents, agentId],
    });
  })
  .with(clearRecentlyCreatedAgent, (state, { payload: [wsId, agentId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const recentlyCreatedAgents = workspaceState.recentlyCreatedAgents.filter(
      (recentAgentId) => recentAgentId !== agentId
    );
    if (recentlyCreatedAgents.length === workspaceState.recentlyCreatedAgents.length) {
      return state;
    }
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      recentlyCreatedAgents,
    });
  })
  .with(setInitialAgentId, (state, { payload: [wsId, initialAgentId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.initialAgentId === initialAgentId) {
      return state;
    }
    return setWorkspaceState(state, wsId, { ...workspaceState, initialAgentId });
  })
  .with(setInitialAgentConfigProcessed, (state, { payload: [wsId, initialAgentConfigProcessed] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.initialAgentConfigProcessed === initialAgentConfigProcessed) {
      return state;
    }
    return setWorkspaceState(state, wsId, { ...workspaceState, initialAgentConfigProcessed });
  })
  .with(setAgentsLoaded, (state, { payload: [wsId, agentsLoaded] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.agentsLoaded === agentsLoaded) {
      return state;
    }
    return setWorkspaceState(state, wsId, { ...workspaceState, agentsLoaded });
  })
  .with(setIsLoadingAgents, (state, { payload: [wsId, isLoadingAgents] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (workspaceState.isLoadingAgents === isLoadingAgents) {
      return state;
    }
    return setWorkspaceState(state, wsId, { ...workspaceState, isLoadingAgents });
  })
  .with(setWaitingForFirstMessage, (state, { payload: [wsId, agentId, waiting] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const currentWaiting = workspaceState.isWaitingForFirstMessage[agentId] ?? false;
    if (currentWaiting === waiting) {
      return state;
    }

    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      isWaitingForFirstMessage: waiting
        ? {
            ...workspaceState.isWaitingForFirstMessage,
            [agentId]: true,
          }
        : omitKey(workspaceState.isWaitingForFirstMessage, agentId),
    });
  })
  .with(setInitialAgentConfig, (state, { payload: [wsId, config] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      initialAgentConfig: config,
    });
  })
  .with(clearInitialAgentConfig, (state, { payload: [wsId] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    if (!workspaceState.initialAgentConfig) return state;
    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      initialAgentConfig: null,
    });
  })
  .with(clearWorkspaceAgents, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));